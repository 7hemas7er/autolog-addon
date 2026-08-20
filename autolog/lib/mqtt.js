/*
 * AutoLog — client MQTT 3.1.1 minimale, senza dipendenze.
 *
 * Implementa solo quello che serve al publisher di Home Assistant:
 * CONNECT (con Last Will), PUBLISH QoS 0/1, SUBSCRIBE, PING, riconnessione
 * con backoff. Niente QoS 2, niente sessioni persistenti, niente TLS
 * (il broker Mosquitto dell'add-on è raggiungibile in chiaro sulla rete
 * interna di Docker).
 */
'use strict';

var net = require('node:net');
var EventEmitter = require('node:events');

var TYPE = {
  CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4,
  SUBSCRIBE: 8, SUBACK: 9, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14
};

var CONNACK_ERRORS = {
  1: 'versione del protocollo non supportata',
  2: 'client id rifiutato',
  3: 'broker non disponibile',
  4: 'utente o password errati',
  5: 'non autorizzato'
};

/* ---------- codifica ---------- */

function encodeLength(n) {
  var out = [];
  do {
    var b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b = b | 0x80;
    out.push(b);
  } while (n > 0);
  return Buffer.from(out);
}

function encodeString(s) {
  var body = Buffer.from(String(s), 'utf8');
  var len = Buffer.alloc(2);
  len.writeUInt16BE(body.length, 0);
  return Buffer.concat([len, body]);
}

function packet(type, flags, variable, payload) {
  var body = Buffer.concat([variable || Buffer.alloc(0), payload || Buffer.alloc(0)]);
  var header = Buffer.from([(type << 4) | (flags & 0x0f)]);
  return Buffer.concat([header, encodeLength(body.length), body]);
}

function buildConnect(opts) {
  var flags = 0;
  var payload = [encodeString(opts.clientId)];

  if (opts.will && opts.will.topic) {
    flags |= 0x04;                                   // will flag
    flags |= (Math.min(1, opts.will.qos || 0) << 3); // will QoS
    if (opts.will.retain) flags |= 0x20;
    payload.push(encodeString(opts.will.topic));
    var wp = Buffer.from(String(opts.will.payload === undefined ? '' : opts.will.payload), 'utf8');
    var wl = Buffer.alloc(2);
    wl.writeUInt16BE(wp.length, 0);
    payload.push(wl, wp);
  }
  if (opts.username) { flags |= 0x80; payload.push(encodeString(opts.username)); }
  if (opts.username && opts.password) { flags |= 0x40; payload.push(encodeString(opts.password)); }
  flags |= 0x02;                                     // clean session

  var keepalive = Buffer.alloc(2);
  keepalive.writeUInt16BE(opts.keepalive || 60, 0);
  var variable = Buffer.concat([
    encodeString('MQTT'),
    Buffer.from([4, flags]),                         // livello 4 = MQTT 3.1.1
    keepalive
  ]);
  return packet(TYPE.CONNECT, 0, variable, Buffer.concat(payload));
}

/* ---------- decodifica ---------- */

/*
 * Accumula i byte in arrivo e restituisce i pacchetti completi.
 * TCP non garantisce che un chunk corrisponda a un pacchetto.
 */
function Parser() {
  this.buf = Buffer.alloc(0);
}
Parser.prototype.push = function (chunk) {
  this.buf = Buffer.concat([this.buf, chunk]);
  var out = [];
  for (;;) {
    if (this.buf.length < 2) break;
    var multiplier = 1, len = 0, i = 1, byte;
    do {
      if (i >= this.buf.length || i > 4) return out;   // lunghezza incompleta
      byte = this.buf[i++];
      len += (byte & 0x7f) * multiplier;
      multiplier *= 128;
    } while ((byte & 0x80) !== 0);

    var total = i + len;
    if (this.buf.length < total) break;                // pacchetto incompleto

    out.push({
      type: this.buf[0] >> 4,
      flags: this.buf[0] & 0x0f,
      body: this.buf.subarray(i, total)
    });
    this.buf = this.buf.subarray(total);
  }
  return out;
};

function parsePublish(pkt) {
  var body = pkt.body;
  var topicLen = body.readUInt16BE(0);
  var topic = body.toString('utf8', 2, 2 + topicLen);
  var offset = 2 + topicLen;
  var qos = (pkt.flags >> 1) & 0x03;
  var packetId = null;
  if (qos > 0) { packetId = body.readUInt16BE(offset); offset += 2; }
  return {
    topic: topic,
    payload: body.subarray(offset).toString('utf8'),
    qos: qos,
    retain: (pkt.flags & 0x01) === 1,
    packetId: packetId
  };
}

/* ---------- client ---------- */

function Client(opts) {
  EventEmitter.call(this);
  this.opts = opts || {};
  this.opts.keepalive = this.opts.keepalive || 60;
  this.clientId = this.opts.clientId || ('autolog-' + Math.random().toString(16).slice(2, 10));
  this.connected = false;
  this.stopped = false;
  this.nextId = 1;
  this.subscriptions = [];
  this.queue = [];
  this.attempt = 0;
  this.sock = null;
  this.pingTimer = null;
  this.reconnectTimer = null;
}
Client.prototype = Object.create(EventEmitter.prototype);
Client.prototype.constructor = Client;

Client.prototype._id = function () {
  this.nextId = this.nextId >= 65535 ? 1 : this.nextId + 1;
  return this.nextId;
};

Client.prototype.connect = function () {
  var self = this;
  if (this.stopped) return this;
  this._cleanup();

  var parser = new Parser();
  var sock = net.createConnection({
    host: this.opts.host || 'localhost',
    port: Number(this.opts.port || 1883)
  });
  this.sock = sock;
  sock.setNoDelay(true);

  sock.on('connect', function () {
    sock.write(buildConnect({
      clientId: self.clientId,
      username: self.opts.username,
      password: self.opts.password,
      keepalive: self.opts.keepalive,
      will: self.opts.will
    }));
  });

  sock.on('data', function (chunk) {
    var packets;
    try { packets = parser.push(chunk); }
    catch (e) { self.emit('error', e); return; }
    packets.forEach(function (p) { self._handle(p); });
  });

  sock.on('error', function (err) { self.emit('error', err); });
  sock.on('close', function () {
    var was = self.connected;
    self.connected = false;
    self._stopPing();
    if (was) self.emit('close');
    self._scheduleReconnect();
  });

  return this;
};

Client.prototype._handle = function (p) {
  var self = this;
  switch (p.type) {
    case TYPE.CONNACK: {
      var code = p.body[1];
      if (code !== 0) {
        this.emit('error', new Error('CONNACK: ' + (CONNACK_ERRORS[code] || ('codice ' + code))));
        this.sock.destroy();
        return;
      }
      this.connected = true;
      this.attempt = 0;
      this._startPing();
      /* ripristina le sottoscrizioni e svuota la coda accumulata offline */
      this.subscriptions.forEach(function (s) { self._sendSubscribe(s.topic, s.qos); });
      var pending = this.queue;
      this.queue = [];
      pending.forEach(function (m) { self.publish(m.topic, m.payload, m.opts); });
      this.emit('connect');
      break;
    }
    case TYPE.PUBLISH: {
      var msg = parsePublish(p);
      if (msg.qos === 1 && msg.packetId !== null) {
        var ack = Buffer.alloc(2);
        ack.writeUInt16BE(msg.packetId, 0);
        this._write(packet(TYPE.PUBACK, 0, ack));
      }
      this.emit('message', msg.topic, msg.payload, msg);
      break;
    }
    case TYPE.PINGRESP:
    case TYPE.PUBACK:
    case TYPE.SUBACK:
      break;
    default:
      break;
  }
};

Client.prototype._write = function (buf) {
  if (!this.sock || this.sock.destroyed) return false;
  try { this.sock.write(buf); return true; }
  catch (e) { this.emit('error', e); return false; }
};

Client.prototype.publish = function (topic, payload, opts) {
  opts = opts || {};
  if (!this.connected) {
    /* la coda evita di perdere gli aggiornamenti mentre il broker è giù */
    if (this.queue.length < 500) this.queue.push({ topic: topic, payload: payload, opts: opts });
    return false;
  }
  var qos = Math.min(1, opts.qos || 0);
  var flags = (qos << 1) | (opts.retain ? 1 : 0);
  var parts = [encodeString(topic)];
  if (qos > 0) {
    var id = Buffer.alloc(2);
    id.writeUInt16BE(this._id(), 0);
    parts.push(id);
  }
  var body = Buffer.from(payload === undefined || payload === null ? '' : String(payload), 'utf8');
  return this._write(packet(TYPE.PUBLISH, flags, Buffer.concat(parts), body));
};

Client.prototype.subscribe = function (topic, qos) {
  qos = qos === undefined ? 0 : qos;
  if (!this.subscriptions.some(function (s) { return s.topic === topic; })) {
    this.subscriptions.push({ topic: topic, qos: qos });
  }
  if (this.connected) this._sendSubscribe(topic, qos);
  return this;
};

Client.prototype._sendSubscribe = function (topic, qos) {
  var id = Buffer.alloc(2);
  id.writeUInt16BE(this._id(), 0);
  var payload = Buffer.concat([encodeString(topic), Buffer.from([Math.min(1, qos)])]);
  this._write(packet(TYPE.SUBSCRIBE, 0x02, id, payload));
};

Client.prototype._startPing = function () {
  var self = this;
  this._stopPing();
  this.pingTimer = setInterval(function () {
    self._write(packet(TYPE.PINGREQ, 0));
  }, this.opts.keepalive * 1000 * 0.75);
  if (this.pingTimer.unref) this.pingTimer.unref();
};

Client.prototype._stopPing = function () {
  if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
};

Client.prototype._scheduleReconnect = function () {
  var self = this;
  if (this.stopped || this.reconnectTimer) return;
  this.attempt++;
  var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(this.attempt, 5)));
  this.reconnectTimer = setTimeout(function () {
    self.reconnectTimer = null;
    self.connect();
  }, delay);
  if (this.reconnectTimer.unref) this.reconnectTimer.unref();
};

Client.prototype._cleanup = function () {
  this._stopPing();
  if (this.sock) {
    this.sock.removeAllListeners();
    this.sock.destroy();
    this.sock = null;
  }
};

Client.prototype.end = function () {
  this.stopped = true;
  if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  if (this.connected) this._write(packet(TYPE.DISCONNECT, 0));
  this.connected = false;
  this._cleanup();
};

module.exports = {
  TYPE: TYPE,
  Client: Client,
  Parser: Parser,
  encodeLength: encodeLength,
  encodeString: encodeString,
  packet: packet,
  buildConnect: buildConnect,
  parsePublish: parsePublish,
  connect: function (opts) { return new Client(opts).connect(); }
};
