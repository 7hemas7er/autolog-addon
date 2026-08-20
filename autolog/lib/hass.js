/*
 * AutoLog — integrazione con Home Assistant via MQTT Discovery.
 *
 * Un device HA per veicolo, sensori numerici con unit_of_measurement e
 * state_class corretti (così HA li storicizza da solo), availability con LWT,
 * e un topic di comando per registrare un rifornimento da un'automazione.
 *
 * Si aggancia all'hook DB.addChangeListener predisposto in FASE 1.
 */
'use strict';

var mqtt = require('./mqtt.js');
var calc = require('./calc.js');
var DB = require('./db.js');
var UNITS = require('./units.js');

var DISCOVERY_PREFIX = 'homeassistant';
var BASE = 'autolog';
var STATUS_TOPIC = BASE + '/status';

/* object_id e node_id ammettono solo [a-zA-Z0-9_-] */
function slug(s) {
  return String(s || 'veicolo').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'veicolo';
}

/* HA richiede un timestamp ISO 8601 completo di fuso, non una data secca. */
function isoTimestamp(date) {
  if (!date) return null;
  var d = String(date).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T00:00:00+00:00' : null;
}

/*
 * Definizione dei sensori. L'ordine è quello in cui compaiono nel device.
 * `key` è sia la chiave nel payload di stato sia il suffisso dell'unique_id.
 */
function sensorList(u) {
  u = u || { distance: 'km', volume: 'L', consumption: 'km/L', currency: 'EUR', system: 'metric' };
  var list = [
    { key: 'consumo_medio', name: 'Consumo medio', unit: u.consumption, state_class: 'measurement', icon: 'mdi:gas-station' },
    { key: 'consumo_l100', name: 'Consumo medio L/100 km', unit: 'L/100 km', state_class: 'measurement', icon: 'mdi:gas-station-outline' },
    { key: 'costo_km', name: 'Costo al km', unit: u.currency + '/' + u.distance, state_class: 'measurement', icon: 'mdi:cash' },
    { key: 'km_totali', name: 'Chilometri totali', unit: u.distance, device_class: 'distance', state_class: 'total_increasing', icon: 'mdi:counter' },
    { key: 'litri_totali', name: 'Litri totali', unit: u.volume, device_class: 'volume', state_class: 'total_increasing', icon: 'mdi:fuel' },
    { key: 'spesa_totale', name: 'Spesa totale', unit: u.currency, device_class: 'monetary', state_class: 'total_increasing' },
    { key: 'spesa_mese', name: 'Spesa del mese', unit: u.currency, device_class: 'monetary', state_class: 'total' },
    { key: 'ultimo_prezzo', name: 'Ultimo prezzo al litro', unit: u.currency + '/' + u.volume, state_class: 'measurement', icon: 'mdi:currency-eur' },
    { key: 'ultimo_rifornimento', name: 'Ultimo rifornimento', device_class: 'timestamp', icon: 'mdi:calendar-clock' },
    { key: 'prossima_scadenza', name: 'Prossima scadenza', device_class: 'timestamp', icon: 'mdi:calendar-alert', attributes: true }
  ];
  /*
   * L/100 km non ha senso fuori dal sistema metrico: in imperiale il sensore
   * sparisce invece di pubblicare un numero senza significato.
   */
  if (UNITS.isImperial(u.system)) {
    list = list.filter(function (x) { return x.key !== 'consumo_l100'; });
  }
  return list;
}

/* Elenco di default, usato dai test e come riferimento. */
var SENSORS = sensorList();

function stateTopic(vslug) { return BASE + '/' + vslug + '/state'; }
function commandTopic(vslug) { return BASE + '/' + vslug + '/cmd/fillup'; }
function discoveryTopic(vslug, key) {
  return DISCOVERY_PREFIX + '/sensor/' + BASE + '_' + vslug + '_' + key + '/config';
}

/* Payload di discovery di un singolo sensore. */
function discoveryPayload(vehicle, vslug, sensor, swVersion) {
  var uid = BASE + '_' + vslug + '_' + sensor.key;
  var payload = {
    name: sensor.name,
    unique_id: uid,
    object_id: uid,
    state_topic: stateTopic(vslug),
    value_template: '{{ value_json.' + sensor.key + ' }}',
    availability_topic: STATUS_TOPIC,
    payload_available: 'online',
    payload_not_available: 'offline',
    device: {
      identifiers: [BASE + '_' + vslug],
      name: vehicle.name,
      manufacturer: vehicle.make || 'AutoLog',
      model: [vehicle.model, vehicle.year].filter(Boolean).join(' ') || 'Veicolo',
      sw_version: swVersion || '1.0.0'
    }
  };
  if (sensor.unit) payload.unit_of_measurement = sensor.unit;
  if (sensor.device_class) payload.device_class = sensor.device_class;
  if (sensor.state_class) payload.state_class = sensor.state_class;
  if (sensor.icon) payload.icon = sensor.icon;
  if (sensor.attributes) {
    payload.json_attributes_topic = stateTopic(vslug);
    payload.json_attributes_template = '{{ value_json.scadenze | tojson }}';
  }
  return payload;
}

/* Payload di stato: un solo JSON per veicolo, letto da tutti i sensori. */
function statePayload(vehicle, fillups, expenses, reminders, today, units) {
  var u = units || { system: 'metric', currency: 'EUR' };
  var sys = u.system || 'metric';
  var r3 = function (v) { return v === null || v === undefined ? null : Math.round(v * 1000) / 1000; };
  var r2 = function (v) { return v === null || v === undefined ? null : Math.round(v * 100) / 100; };
  var r4 = function (v) { return v === null || v === undefined ? null : Math.round(v * 10000) / 10000; };
  var s = calc.computeStats(vehicle, fillups, expenses);
  var currentOdo = s.last_odo;
  var month = String(today).slice(0, 7);
  var spesaMese = 0;
  (s.monthly || []).forEach(function (m) { if (m.month === month) spesaMese = m.total; });

  var open = (reminders || []).filter(function (r) { return !Number(r.done); })
    .map(function (r) {
      var st = calc.reminderStatus(r, currentOdo, today);
      return {
        titolo: r.title,
        categoria: r.category || '',
        scadenza_data: r.due_date ? String(r.due_date).slice(0, 10) : null,
        scadenza_km: r.due_odo === null || r.due_odo === undefined ? null : r2(UNITS.distanceFromKm(Number(r.due_odo), sys)),
        giorni_rimanenti: st.days_left === null ? null : Math.round(st.days_left),
        km_rimanenti: st.km_left === null ? null : r2(UNITS.distanceFromKm(st.km_left, sys)),
        stato: st.status
      };
    });

  /* ordine: prima le scadenze più vicine, a km o a data indifferentemente */
  open.sort(function (a, b) {
    var av = a.giorni_rimanenti !== null ? a.giorni_rimanenti : (a.km_rimanenti !== null ? a.km_rimanenti / 50 : 1e9);
    var bv = b.giorni_rimanenti !== null ? b.giorni_rimanenti : (b.km_rimanenti !== null ? b.km_rimanenti / 50 : 1e9);
    return av - bv;
  });

  var nextDated = open.find(function (r) { return r.scadenza_data; });

  return {
    consumo_medio: r2(UNITS.consumptionFromKml(s.avg_kml, sys)),
    consumo_l100: UNITS.isImperial(sys) ? undefined : s.avg_l100,
    costo_km: r4(UNITS.costPerDistanceFromKm(s.eur_km_total, sys)),
    costo_km_carburante: r4(UNITS.costPerDistanceFromKm(s.eur_km_fuel, sys)),
    km_totali: r2(UNITS.distanceFromKm(s.total_km, sys)),
    litri_totali: r2(UNITS.volumeFromLiters(s.total_liters, sys)),
    spesa_totale: s.total_cost,
    spesa_carburante: s.fuel_cost,
    spesa_mese: spesaMese,
    ultimo_prezzo: r3(UNITS.pricePerVolumeFromLiter(s.last_price_l, sys)),
    prezzo_medio: r3(UNITS.pricePerVolumeFromLiter(s.avg_price_l, sys)),
    ultimo_rifornimento: isoTimestamp(s.last_fillup_date),
    ultimo_km: r2(UNITS.distanceFromKm(s.last_odo, sys)),
    rifornimenti: s.count_fillups,
    prossima_scadenza: nextDated ? isoTimestamp(nextDated.scadenza_data) : null,
    scadenze: { elenco: open, aperte: open.length,
                scadute: open.filter(function (r) { return r.stato === 'scaduto'; }).length }
  };
}

/* ---------- publisher ---------- */

function Publisher(db, opts) {
  this.db = db;
  this.opts = opts || {};
  this.client = null;
  this.announced = {};   // slug -> true, discovery già pubblicata
  this.timer = null;
  this.slugById = {};
}

Publisher.prototype.start = function () {
  var self = this;
  var o = this.opts;
  this.client = new mqtt.Client({
    host: o.host, port: o.port, username: o.username, password: o.password,
    clientId: o.clientId || ('autolog-' + Math.random().toString(16).slice(2, 10)),
    keepalive: 60,
    will: { topic: STATUS_TOPIC, payload: 'offline', retain: true, qos: 1 }
  });

  this.client.on('connect', function () {
    self.log('MQTT connesso a ' + o.host + ':' + o.port);
    self.client.publish(STATUS_TOPIC, 'online', { retain: true, qos: 1 });
    self.client.subscribe(BASE + '/+/cmd/fillup', 1);
    self.publishAll(true);
  });

  this.client.on('message', function (topic, payload) { self.onCommand(topic, payload); });
  this.client.on('error', function (err) { self.log('MQTT: ' + err.message); });
  this.client.on('close', function () { self.log('MQTT disconnesso, riprovo…'); });

  this.client.connect();
  return this;
};

Publisher.prototype.log = function (msg) {
  if (this.opts.quiet) return;
  console.log('[autolog/mqtt] ' + msg);
};

Publisher.prototype.stop = function () {
  if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  if (this.client) {
    this.client.publish(STATUS_TOPIC, 'offline', { retain: true, qos: 1 });
    this.client.end();
  }
};

/* L'import massivo genera centinaia di eventi: si pubblica una volta sola. */
Publisher.prototype.schedule = function () {
  var self = this;
  if (this.timer) return;
  this.timer = setTimeout(function () {
    self.timer = null;
    try { self.publishAll(false); }
    catch (e) { self.log('pubblicazione fallita: ' + e.message); }
  }, this.opts.debounce === undefined ? 1500 : this.opts.debounce);
  if (this.timer.unref) this.timer.unref();
};

Publisher.prototype.units = function () {
  return this.opts.unitSettings ? this.opts.unitSettings()
    : { system: 'metric', currency: 'EUR', distance: 'km', volume: 'L', consumption: 'km/L' };
};

Publisher.prototype.publishAll = function (forceDiscovery) {
  if (!this.client || !this.client.connected) return;
  var db = this.db;
  var u = this.units();
  var today = new Date().toISOString().slice(0, 10);
  /* cambiare unità cambia i payload di discovery: vanno ripubblicati */
  var unitKey = u.system + '|' + u.currency;
  if (this.lastUnitKey && this.lastUnitKey !== unitKey) forceDiscovery = true;
  this.lastUnitKey = unitKey;
  var vehicles = db.prepare('SELECT * FROM vehicles WHERE archived = 0 ORDER BY id').all();
  var seen = {};

  for (var i = 0; i < vehicles.length; i++) {
    var v = vehicles[i];
    var vs = slug(v.name);
    /* due veicoli con lo stesso nome non devono collidere sullo stesso device */
    if (seen[vs]) vs = vs + '_' + v.id;
    seen[vs] = true;
    this.slugById[v.id] = vs;

    if (forceDiscovery || !this.announced[vs]) {
      this.announce(v, vs, u);
      this.announced[vs] = true;
    }
    var f = DB.list(db, 'fillups', v.id, 'odo ASC, date ASC, id ASC');
    var e = DB.list(db, 'expenses', v.id, 'date ASC, id ASC');
    var r = DB.list(db, 'reminders', v.id, 'id ASC');
    var payload = statePayload(v, f, e, r, today, u);
    this.client.publish(stateTopic(vs), JSON.stringify(payload), { retain: true, qos: 1 });
  }

  /* veicoli spariti o archiviati: si rimuovono le entità con payload vuoto */
  for (var known in this.announced) {
    if (!seen[known]) {
      this.retract(known);
      delete this.announced[known];
    }
  }
};

Publisher.prototype.announce = function (vehicle, vs, u) {
  var self = this;
  sensorList(u).forEach(function (s) {
    var payload = discoveryPayload(vehicle, vs, s, self.opts.version);
    self.client.publish(discoveryTopic(vs, s.key), JSON.stringify(payload), { retain: true, qos: 1 });
  });
  self.log('device pubblicato: ' + vehicle.name + ' (' + vs + ')');
};

Publisher.prototype.retract = function (vs) {
  var self = this;
  sensorList().forEach(function (s) {
    self.client.publish(discoveryTopic(vs, s.key), '', { retain: true, qos: 1 });
  });
  self.log('device rimosso: ' + vs);
};

/*
 * Comando da HA: autolog/<slug>/cmd/fillup con lo stesso body di
 * POST api/fillups (vehicle_id è dedotto dallo slug nel topic).
 */
Publisher.prototype.onCommand = function (topic, payload) {
  var m = String(topic).match(/^autolog\/([^/]+)\/cmd\/fillup$/);
  if (!m) return;
  var vs = m[1];
  var vehicleId = null;
  for (var id in this.slugById) if (this.slugById[id] === vs) vehicleId = Number(id);
  if (!vehicleId) { this.log('comando per uno slug sconosciuto: ' + vs); return; }

  var data;
  try { data = JSON.parse(payload); }
  catch (e) { this.log('payload del comando non è JSON valido'); return; }

  try {
    if (!data.date) data.date = new Date().toISOString().slice(0, 10);
    data.vehicle_id = vehicleId;
    var row = DB.insert(this.db, 'fillups', data);
    this.log('rifornimento registrato da HA: ' + row.date + ' ' + row.odo + ' km');
    DB.onDataChanged(vehicleId, 'fillups', 'insert');
  } catch (e) {
    this.log('comando rifiutato: ' + e.message);
  }
};

module.exports = {
  DISCOVERY_PREFIX: DISCOVERY_PREFIX,
  BASE: BASE,
  STATUS_TOPIC: STATUS_TOPIC,
  SENSORS: SENSORS,
  sensorList: sensorList,
  slug: slug,
  isoTimestamp: isoTimestamp,
  stateTopic: stateTopic,
  commandTopic: commandTopic,
  discoveryTopic: discoveryTopic,
  discoveryPayload: discoveryPayload,
  statePayload: statePayload,
  Publisher: Publisher
};
