'use strict';
var test = require('node:test');
var assert = require('node:assert');
var net = require('node:net');
var mqtt = require('../lib/mqtt.js');
var HASS = require('../lib/hass.js');
var DB = require('../lib/db.js');

/*
 * Broker finto: accetta la CONNECT, risponde CONNACK e registra tutto quello
 * che riceve. Serve a provare il giro completo senza un Mosquitto vero.
 */
function fakeBroker() {
  var received = [];
  var subscriptions = [];
  var connectPacket = null;
  var sockets = [];

  var server = net.createServer(function (sock) {
    sockets.push(sock);
    var parser = new mqtt.Parser();
    sock.on('error', function () { /* chiusure brusche nei test */ });
    sock.on('data', function (chunk) {
      parser.push(chunk).forEach(function (p) {
        if (p.type === mqtt.TYPE.CONNECT) {
          connectPacket = p;
          sock.write(Buffer.from([0x20, 0x02, 0x00, 0x00])); // CONNACK ok
        } else if (p.type === mqtt.TYPE.PUBLISH) {
          var m = mqtt.parsePublish(p);
          received.push(m);
          if (m.qos === 1) {
            var ack = Buffer.alloc(4);
            ack[0] = 0x40; ack[1] = 0x02; ack.writeUInt16BE(m.packetId, 2);
            sock.write(ack);
          }
        } else if (p.type === mqtt.TYPE.SUBSCRIBE) {
          var id = p.body.readUInt16BE(0);
          subscriptions.push(p.body.subarray(2 + 2).toString('utf8', 0, p.body.length - 5));
          var suback = Buffer.alloc(5);
          suback[0] = 0x90; suback[1] = 0x03; suback.writeUInt16BE(id, 2); suback[4] = 0x00;
          sock.write(suback);
        }
      });
    });
  });

  return {
    server: server,
    received: received,
    subscriptions: subscriptions,
    connect: function () { return connectPacket; },
    sockets: sockets,
    listen: function () {
      return new Promise(function (res) {
        server.listen(0, '127.0.0.1', function () { res(server.address().port); });
      });
    },
    close: function () {
      sockets.forEach(function (s) { s.destroy(); });
      return new Promise(function (res) { server.close(res); });
    },
    /* attende che arrivi un messaggio su un topic, o va in timeout */
    wait: function (predicate, ms) {
      var self = this;
      return new Promise(function (res, rej) {
        var t0 = Date.now();
        var iv = setInterval(function () {
          var hit = self.received.filter(predicate);
          if (hit.length) { clearInterval(iv); res(hit); }
          else if (Date.now() - t0 > (ms || 3000)) { clearInterval(iv); rej(new Error('timeout')); }
        }, 20);
      });
    }
  };
}

function seedDb() {
  var db = DB.openMemory();
  var v = DB.insert(db, 'vehicles', { name: 'Furgone', make: 'Marca', model: 'Modello', start_odo: 65000 });
  DB.insert(db, 'fillups', { vehicle_id: v.id, date: '2024-01-01', odo: 65000, liters: 60, total_cost: 100, full: 1 });
  DB.insert(db, 'fillups', { vehicle_id: v.id, date: '2024-01-20', odo: 65600, liters: 60, total_cost: 110, full: 1 });
  DB.insert(db, 'reminders', { vehicle_id: v.id, title: 'Tagliando', due_odo: 66000 });
  return { db: db, vehicleId: v.id };
}

test('il publisher annuncia il device, pubblica lo stato e si sottoscrive ai comandi', async function () {
  var broker = fakeBroker();
  var port = await broker.listen();
  var s = seedDb();
  var pub = new HASS.Publisher(s.db, { host: '127.0.0.1', port: port, quiet: true, version: '1.1.0' });

  try {
    pub.start();

    /* availability online */
    var status = await broker.wait(function (m) { return m.topic === 'autolog/status'; });
    assert.strictEqual(status[0].payload, 'online');
    assert.strictEqual(status[0].retain, true, 'la availability deve essere retained');

    /* discovery di tutti i sensori */
    var disc = await broker.wait(function (m) { return /^homeassistant\/sensor\/.*\/config$/.test(m.topic); });
    await broker.wait(function (m) { return m.topic.indexOf('autolog_furgone_prossima_scadenza') >= 0; });
    disc = broker.received.filter(function (m) { return /^homeassistant\/sensor\/.*\/config$/.test(m.topic); });
    assert.strictEqual(disc.length, HASS.SENSORS.length, 'un topic di discovery per sensore');
    disc.forEach(function (m) {
      assert.strictEqual(m.retain, true, 'la discovery deve essere retained: ' + m.topic);
      var payload = JSON.parse(m.payload);
      assert.deepStrictEqual(payload.device.identifiers, ['autolog_furgone']);
      assert.ok(payload.unique_id.startsWith('autolog_furgone_'));
    });

    /* stato */
    var state = await broker.wait(function (m) { return m.topic === 'autolog/furgone/state'; });
    var body = JSON.parse(state[0].payload);
    assert.strictEqual(body.km_totali, 600);
    assert.strictEqual(body.consumo_medio, 10);
    assert.strictEqual(body.scadenze.aperte, 1);
    assert.strictEqual(state[0].retain, true);

    /* sottoscrizione al topic di comando */
    assert.ok(broker.subscriptions.some(function (t) { return t.indexOf('cmd/fillup') >= 0; }),
      'deve sottoscrivere autolog/+/cmd/fillup');

    /* la CONNECT porta il Last Will su autolog/status */
    var cp = broker.connect();
    assert.ok(cp, 'CONNECT ricevuta');
    assert.ok(cp.body.includes(Buffer.from('autolog/status')), 'will topic presente nella CONNECT');
    assert.ok(cp.body.includes(Buffer.from('offline')), 'will payload presente nella CONNECT');
  } finally {
    pub.stop();
    await broker.close();
    s.db.close();
  }
});

test('un comando MQTT registra il rifornimento sul veicolo giusto', async function () {
  var broker = fakeBroker();
  var port = await broker.listen();
  var s = seedDb();
  var pub = new HASS.Publisher(s.db, { host: '127.0.0.1', port: port, quiet: true });

  try {
    pub.start();
    await broker.wait(function (m) { return m.topic === 'autolog/furgone/state'; });

    var before = s.db.prepare('SELECT COUNT(*) c FROM fillups').get().c;
    pub.onCommand('autolog/furgone/cmd/fillup',
      JSON.stringify({ date: '2024-02-01', odo: 66200, liters: 55, total_cost: 99 }));

    var after = s.db.prepare('SELECT COUNT(*) c FROM fillups').get().c;
    assert.strictEqual(after, before + 1);
    var row = s.db.prepare('SELECT * FROM fillups ORDER BY id DESC LIMIT 1').get();
    assert.strictEqual(row.vehicle_id, s.vehicleId);
    assert.strictEqual(row.odo, 66200);
    assert.strictEqual(row.price_l, 1.8, 'il prezzo al litro viene ricavato dal totale');

    /* payload non valido o slug sconosciuto: nessuna scrittura, nessun crash */
    pub.onCommand('autolog/furgone/cmd/fillup', 'non-json');
    pub.onCommand('autolog/inesistente/cmd/fillup', JSON.stringify({ odo: 1, liters: 1, total_cost: 1 }));
    assert.strictEqual(s.db.prepare('SELECT COUNT(*) c FROM fillups').get().c, after);
  } finally {
    pub.stop();
    await broker.close();
    s.db.close();
  }
});

test('un veicolo archiviato viene ritirato con payload vuoto', async function () {
  var broker = fakeBroker();
  var port = await broker.listen();
  var s = seedDb();
  var pub = new HASS.Publisher(s.db, { host: '127.0.0.1', port: port, quiet: true });

  try {
    pub.start();
    await broker.wait(function (m) { return m.topic === 'autolog/furgone/state'; });

    DB.update(s.db, 'vehicles', s.vehicleId, { archived: 1 });
    pub.publishAll(false);
    /* la scrittura sul socket è asincrona: si attende che il broker riceva */
    await broker.wait(function (m) {
      return m.topic.indexOf('autolog_furgone_') >= 0 && m.payload === '';
    });

    var retracted = broker.received.filter(function (m) {
      return /^homeassistant\/sensor\/autolog_furgone_.*\/config$/.test(m.topic) && m.payload === '';
    });
    assert.strictEqual(retracted.length, HASS.SENSORS.length,
      'ogni sensore va rimosso con un payload vuoto retained');
  } finally {
    pub.stop();
    await broker.close();
    s.db.close();
  }
});
