'use strict';
var test = require('node:test');
var assert = require('node:assert');
var mqtt = require('../lib/mqtt.js');

test('lunghezza remota codificata come varint', function () {
  assert.deepStrictEqual([...mqtt.encodeLength(0)], [0x00]);
  assert.deepStrictEqual([...mqtt.encodeLength(127)], [0x7f]);
  assert.deepStrictEqual([...mqtt.encodeLength(128)], [0x80, 0x01]);
  assert.deepStrictEqual([...mqtt.encodeLength(16383)], [0xff, 0x7f]);
  assert.deepStrictEqual([...mqtt.encodeLength(16384)], [0x80, 0x80, 0x01]);
});

test('stringhe con prefisso di lunghezza a 16 bit, UTF-8', function () {
  var b = mqtt.encodeString('così');
  assert.strictEqual(b.readUInt16BE(0), Buffer.byteLength('così', 'utf8'));
  assert.strictEqual(b.subarray(2).toString('utf8'), 'così');
});

test('CONNECT: protocollo MQTT 3.1.1 e flag corretti', function () {
  var p = mqtt.buildConnect({
    clientId: 'autolog-test', username: 'u', password: 'p',
    keepalive: 60, will: { topic: 'autolog/status', payload: 'offline', retain: true, qos: 1 }
  });
  assert.strictEqual(p[0] >> 4, mqtt.TYPE.CONNECT);
  var body = p.subarray(2);
  assert.strictEqual(body.readUInt16BE(0), 4);
  assert.strictEqual(body.toString('utf8', 2, 6), 'MQTT');
  assert.strictEqual(body[6], 4, 'livello di protocollo 4 = MQTT 3.1.1');
  var flags = body[7];
  assert.strictEqual((flags & 0x80) !== 0, true, 'username');
  assert.strictEqual((flags & 0x40) !== 0, true, 'password');
  assert.strictEqual((flags & 0x20) !== 0, true, 'will retain');
  assert.strictEqual((flags >> 3) & 0x03, 1, 'will QoS 1');
  assert.strictEqual((flags & 0x04) !== 0, true, 'will flag');
  assert.strictEqual((flags & 0x02) !== 0, true, 'clean session');
  assert.strictEqual(body.readUInt16BE(8), 60, 'keepalive');
});

test('CONNECT senza credenziali non alza i flag username/password', function () {
  var p = mqtt.buildConnect({ clientId: 'x', keepalive: 60 });
  var flags = p.subarray(2)[7];
  assert.strictEqual(flags & 0x80, 0);
  assert.strictEqual(flags & 0x40, 0);
  assert.strictEqual(flags & 0x04, 0, 'nessun will');
});

test('PUBLISH: flag retain e QoS nel primo byte', function () {
  var pkt = mqtt.packet(mqtt.TYPE.PUBLISH, (1 << 1) | 1, mqtt.encodeString('a/b'), Buffer.from('ciao'));
  assert.strictEqual(pkt[0] >> 4, mqtt.TYPE.PUBLISH);
  assert.strictEqual(pkt[0] & 0x01, 1, 'retain');
  assert.strictEqual((pkt[0] >> 1) & 0x03, 1, 'QoS 1');
});

test('parser: pacchetto spezzato su più chunk TCP', function () {
  var full = mqtt.packet(mqtt.TYPE.PUBLISH, 0, mqtt.encodeString('autolog/panda/state'), Buffer.from('{"a":1}'));
  var parser = new mqtt.Parser();
  assert.strictEqual(parser.push(full.subarray(0, 3)).length, 0, 'niente finché è incompleto');
  var out = parser.push(full.subarray(3));
  assert.strictEqual(out.length, 1);
  var msg = mqtt.parsePublish(out[0]);
  assert.strictEqual(msg.topic, 'autolog/panda/state');
  assert.strictEqual(msg.payload, '{"a":1}');
});

test('parser: più pacchetti in un solo chunk', function () {
  var a = mqtt.packet(mqtt.TYPE.PINGRESP, 0);
  var b = mqtt.packet(mqtt.TYPE.PUBLISH, 0, mqtt.encodeString('t'), Buffer.from('x'));
  var out = new mqtt.Parser().push(Buffer.concat([a, b, a]));
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].type, mqtt.TYPE.PINGRESP);
  assert.strictEqual(mqtt.parsePublish(out[1]).payload, 'x');
});

test('parser: payload oltre i 127 byte (lunghezza a 2 varint)', function () {
  var big = 'x'.repeat(300);
  var pkt = mqtt.packet(mqtt.TYPE.PUBLISH, 0, mqtt.encodeString('t'), Buffer.from(big));
  var out = new mqtt.Parser().push(pkt);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(mqtt.parsePublish(out[0]).payload.length, 300);
});

test('parsePublish estrae il packetId solo con QoS > 0', function () {
  var id = Buffer.alloc(2); id.writeUInt16BE(42, 0);
  var q1 = mqtt.packet(mqtt.TYPE.PUBLISH, 1 << 1,
    Buffer.concat([mqtt.encodeString('t'), id]), Buffer.from('y'));
  var m = mqtt.parsePublish(new mqtt.Parser().push(q1)[0]);
  assert.strictEqual(m.packetId, 42);
  assert.strictEqual(m.payload, 'y');

  var q0 = mqtt.packet(mqtt.TYPE.PUBLISH, 0, mqtt.encodeString('t'), Buffer.from('y'));
  assert.strictEqual(mqtt.parsePublish(new mqtt.Parser().push(q0)[0]).packetId, null);
});

test('la coda trattiene i messaggi finché il broker non è connesso', function () {
  var c = new mqtt.Client({ host: '127.0.0.1', port: 1 });
  assert.strictEqual(c.publish('t', 'a'), false);
  assert.strictEqual(c.queue.length, 1);
  c.end();
});
