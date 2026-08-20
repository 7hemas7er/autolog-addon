'use strict';
var test = require('node:test');
var assert = require('node:assert');
var HASS = require('../lib/hass.js');

var VEHICLE = { id: 1, name: 'Furgone', make: 'Marca', model: 'Modello', year: 2015, start_odo: 65000 };
var FILLUPS = [
  { id: 1, date: '2024-01-01', odo: 65000, liters: 60, total_cost: 100, full: 1, missed: 0 },
  { id: 2, date: '2024-01-20', odo: 65600, liters: 60, total_cost: 110, full: 1, missed: 0 }
];
var EXPENSES = [{ id: 1, date: '2024-01-15', category: 'Gomme', cost: 400 }];
var REMINDERS = [
  { id: 1, vehicle_id: 1, title: 'Tagliando', due_odo: 66000, done: 0 },
  { id: 2, vehicle_id: 1, title: 'Revisione', due_date: '2024-02-10', done: 0 },
  { id: 3, vehicle_id: 1, title: 'Bollo', due_date: '2023-01-01', done: 1 }
];

test('slug ammette solo i caratteri validi per un topic di discovery', function () {
  assert.strictEqual(HASS.slug('Furgone'), 'furgone');
  assert.strictEqual(HASS.slug('Città Nuova'), 'citta_nuova');
  assert.strictEqual(HASS.slug('Panda 4x4!'), 'panda_4x4');
  assert.match(HASS.slug('Ã¨ â€” strano'), /^[a-z0-9_-]+$/);
  assert.strictEqual(HASS.slug(''), 'veicolo');
});

test('topic conformi alla specifica', function () {
  assert.strictEqual(HASS.stateTopic('furgone'), 'autolog/furgone/state');
  assert.strictEqual(HASS.commandTopic('furgone'), 'autolog/furgone/cmd/fillup');
  assert.strictEqual(HASS.discoveryTopic('furgone', 'km_totali'),
    'homeassistant/sensor/autolog_furgone_km_totali/config');
  assert.strictEqual(HASS.STATUS_TOPIC, 'autolog/status');
});

test('ogni object_id del topic rispetta [a-zA-Z0-9_-]', function () {
  HASS.SENSORS.forEach(function (s) {
    var t = HASS.discoveryTopic('furgone', s.key);
    var objectId = t.split('/')[2];
    assert.match(objectId, /^[a-zA-Z0-9_-]+$/, 'object_id non valido: ' + objectId);
  });
});

test('payload di discovery: chiavi obbligatorie e device condiviso', function () {
  var p = HASS.discoveryPayload(VEHICLE, 'furgone', HASS.SENSORS[0], '1.1.0');
  assert.strictEqual(p.unique_id, 'autolog_furgone_consumo_medio');
  assert.strictEqual(p.state_topic, 'autolog/furgone/state');
  assert.strictEqual(p.value_template, '{{ value_json.consumo_medio }}');
  assert.strictEqual(p.availability_topic, 'autolog/status');
  assert.strictEqual(p.payload_available, 'online');
  assert.strictEqual(p.payload_not_available, 'offline');
  assert.deepStrictEqual(p.device.identifiers, ['autolog_furgone']);
  assert.strictEqual(p.device.name, 'Furgone');
  assert.strictEqual(p.device.manufacturer, 'Marca');
  assert.strictEqual(p.device.model, 'Modello 2015');
  assert.strictEqual(p.device.sw_version, '1.1.0');
});

test('i sensori numerici hanno unità e state_class per le statistiche a lungo termine', function () {
  var required = ['consumo_medio', 'consumo_l100', 'costo_km', 'km_totali',
                  'litri_totali', 'spesa_totale', 'spesa_mese', 'ultimo_prezzo'];
  required.forEach(function (key) {
    var s = HASS.SENSORS.find(function (x) { return x.key === key; });
    assert.ok(s, 'sensore mancante: ' + key);
    var p = HASS.discoveryPayload(VEHICLE, 'furgone', s);
    assert.ok(p.unit_of_measurement, key + ' senza unit_of_measurement');
    assert.ok(p.state_class, key + ' senza state_class');
  });
});

test('i sensori monetari usano il codice valuta e uno state_class ammesso', function () {
  HASS.SENSORS.filter(function (s) { return s.device_class === 'monetary'; }).forEach(function (s) {
    assert.strictEqual(s.unit, 'EUR', s.key + ': device_class monetary richiede una valuta ISO');
    assert.ok(['total', 'total_increasing'].indexOf(s.state_class) >= 0,
      s.key + ': monetary ammette solo total o total_increasing');
  });
});

test('i sensori timestamp non hanno unità né state_class', function () {
  HASS.SENSORS.filter(function (s) { return s.device_class === 'timestamp'; }).forEach(function (s) {
    var p = HASS.discoveryPayload(VEHICLE, 'furgone', s);
    assert.strictEqual(p.unit_of_measurement, undefined, s.key);
    assert.strictEqual(p.state_class, undefined, s.key);
  });
});

test('il sensore delle scadenze espone gli attributi', function () {
  var s = HASS.SENSORS.find(function (x) { return x.key === 'prossima_scadenza'; });
  var p = HASS.discoveryPayload(VEHICLE, 'furgone', s);
  assert.strictEqual(p.json_attributes_topic, 'autolog/furgone/state');
  assert.strictEqual(p.json_attributes_template, '{{ value_json.scadenze | tojson }}');
});

test('isoTimestamp produce un ISO 8601 con fuso, come richiede HA', function () {
  assert.strictEqual(HASS.isoTimestamp('2024-01-05'), '2024-01-05T00:00:00+00:00');
  assert.strictEqual(HASS.isoTimestamp(null), null);
  assert.strictEqual(HASS.isoTimestamp('non una data'), null);
});

test('payload di stato: valori coerenti con le statistiche', function () {
  var st = HASS.statePayload(VEHICLE, FILLUPS, EXPENSES, REMINDERS, '2024-01-25');
  assert.strictEqual(st.km_totali, 600);
  assert.strictEqual(st.litri_totali, 120);
  assert.strictEqual(st.spesa_totale, 610);       // 210 carburante + 400 gomme
  assert.strictEqual(st.consumo_medio, 10);       // 600 km / 60 L del secondo pieno
  assert.strictEqual(st.spesa_mese, 610);         // tutto a gennaio 2024
  assert.strictEqual(st.ultimo_rifornimento, '2024-01-20T00:00:00+00:00');
  assert.strictEqual(st.rifornimenti, 2);
});

test('payload di stato: scadenze ordinate, completate escluse', function () {
  var st = HASS.statePayload(VEHICLE, FILLUPS, EXPENSES, REMINDERS, '2024-01-25');
  assert.strictEqual(st.scadenze.aperte, 2, 'il promemoria completato non compare');
  var titoli = st.scadenze.elenco.map(function (r) { return r.titolo; });
  assert.deepStrictEqual(titoli.sort(), ['Revisione', 'Tagliando']);
  var rev = st.scadenze.elenco.find(function (r) { return r.titolo === 'Revisione'; });
  assert.strictEqual(rev.giorni_rimanenti, 16);
  var tag = st.scadenze.elenco.find(function (r) { return r.titolo === 'Tagliando'; });
  assert.strictEqual(tag.km_rimanenti, 400);      // 66000 - 65600
  assert.strictEqual(st.prossima_scadenza, '2024-02-10T00:00:00+00:00');
});

test('veicolo senza dati produce un payload valido, non un errore', function () {
  var st = HASS.statePayload({ id: 9, name: 'Nuovo', start_odo: 0 }, [], [], [], '2024-01-25');
  assert.strictEqual(st.consumo_medio, null);
  assert.strictEqual(st.km_totali, 0);
  assert.strictEqual(st.prossima_scadenza, null);
  assert.deepStrictEqual(st.scadenze.elenco, []);
  assert.doesNotThrow(function () { JSON.stringify(st); });
});

/* ---------- unità imperiali ---------- */

var US = { system: 'us', currency: 'USD', distance: 'mi', volume: 'gal', consumption: 'mpg' };

test('in imperiale i sensori cambiano unità e L/100 km sparisce', function () {
  var list = HASS.sensorList(US);
  var byKey = {};
  list.forEach(function (s) { byKey[s.key] = s; });
  assert.strictEqual(byKey.consumo_l100, undefined, 'L/100 km non ha senso in imperiale');
  assert.strictEqual(byKey.consumo_medio.unit, 'mpg');
  assert.strictEqual(byKey.km_totali.unit, 'mi');
  assert.strictEqual(byKey.litri_totali.unit, 'gal');
  assert.strictEqual(byKey.spesa_totale.unit, 'USD');
  assert.strictEqual(byKey.costo_km.unit, 'USD/mi');
  assert.strictEqual(byKey.ultimo_prezzo.unit, 'USD/gal');
  assert.strictEqual(list.length, HASS.SENSORS.length - 1);
});

test('il payload di stato è convertito, il database resta metrico', function () {
  var metrico = HASS.statePayload(VEHICLE, FILLUPS, EXPENSES, REMINDERS, '2024-01-25');
  var imperiale = HASS.statePayload(VEHICLE, FILLUPS, EXPENSES, REMINDERS, '2024-01-25', US);

  assert.strictEqual(metrico.km_totali, 600);
  assert.strictEqual(imperiale.km_totali, 372.82, '600 km sono 372,82 miglia');
  assert.strictEqual(metrico.consumo_medio, 10);
  assert.strictEqual(imperiale.consumo_medio, 23.52, '10 km/L sono 23,52 mpg US');
  assert.strictEqual(imperiale.consumo_l100, undefined);
  assert.strictEqual(metrico.litri_totali, 120);
  assert.strictEqual(imperiale.litri_totali, 31.7, '120 litri sono 31,7 galloni US');

  /* la spesa non si converte: è già una valuta */
  assert.strictEqual(imperiale.spesa_totale, metrico.spesa_totale);

  /* il costo per unità di distanza sì */
  assert.ok(imperiale.costo_km > metrico.costo_km, 'un miglio costa più di un chilometro');
});

test('anche le scadenze a chilometraggio seguono le unità', function () {
  var imperiale = HASS.statePayload(VEHICLE, FILLUPS, EXPENSES, REMINDERS, '2024-01-25', US);
  var tag = imperiale.scadenze.elenco.find(function (r) { return r.titolo === 'Tagliando'; });
  assert.strictEqual(tag.scadenza_km, 41010.5, '66000 km in miglia');
  assert.strictEqual(tag.km_rimanenti, 248.55, '400 km rimanenti in miglia');
});
