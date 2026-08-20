'use strict';
var test = require('node:test');
var assert = require('node:assert');
var DB = require('../lib/db.js');
var calc = require('../lib/calc.js');

function seed(db) {
  var v = DB.insert(db, 'vehicles', { name: 'Panda', make: 'Fiat', tank_l: 38, start_odo: 1000 });
  DB.insert(db, 'fillups', { vehicle_id: v.id, date: '2024-01-01', odo: 1000, liters: 30, total_cost: 54, full: 1 });
  DB.insert(db, 'fillups', { vehicle_id: v.id, date: '2024-01-20', odo: 1500, liters: 25, total_cost: 45, full: 1 });
  DB.insert(db, 'expenses', { vehicle_id: v.id, date: '2024-02-01', category: 'Gomme', cost: 300 });
  DB.insert(db, 'reminders', { vehicle_id: v.id, title: 'Tagliando', due_odo: 16000, every_km: 15000 });
  return v;
}

test('schema idempotente e migrazione versionata', function () {
  var db = DB.openMemory();
  assert.strictEqual(Number(db.prepare('PRAGMA user_version').get().user_version), DB.SCHEMA_VERSION);
  db.close();
});

test('coercizione: price_l ricavato da total_cost', function () {
  var row = DB.coerceRow('fillups', { vehicle_id: 1, date: '2024-01-01T10:00:00Z', odo: '1000', liters: '40', total_cost: '70' });
  assert.strictEqual(row.date, '2024-01-01');
  assert.strictEqual(row.odo, 1000);
  assert.strictEqual(row.price_l, 1.75);
});

test('coercizione: total_cost ricavato da price_l e litri', function () {
  var row = DB.coerceRow('fillups', { vehicle_id: 1, date: '2024-01-01', odo: 1000, liters: 40, price_l: 1.75 });
  assert.strictEqual(row.total_cost, 70);
  assert.strictEqual(row.price_l, 1.75);
});

test('coercizione: total_cost vince su price_l incoerente', function () {
  var row = DB.coerceRow('fillups', { vehicle_id: 1, date: '2024-01-01', odo: 1000, liters: 40, total_cost: 80, price_l: 1.75 });
  assert.strictEqual(row.total_cost, 80);
  assert.strictEqual(row.price_l, 2);
});

test('stringa vuota diventa null sui numerici', function () {
  var row = DB.coerceRow('expenses', { vehicle_id: 1, date: '2024-01-01', odo: '', cost: '12,5' });
  assert.strictEqual(row.odo, null);
  assert.strictEqual(row.cost, null, 'la virgola decimale non è compito del DB layer');
});

test('CASCADE sulla cancellazione del veicolo', function () {
  var db = DB.openMemory();
  var v = seed(db);
  DB.remove(db, 'vehicles', v.id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM fillups').get().c, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM expenses').get().c, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM reminders').get().c, 0);
  db.close();
});

test('round-trip: export JSON -> import su DB vuoto -> i conteggi coincidono', function () {
  var src = DB.openMemory();
  seed(src);
  var dump = DB.exportAll(src);

  var dst = DB.openMemory();
  var counts = DB.importAll(dst, dump, true);

  DB.TABLES.forEach(function (t) {
    var a = src.prepare('SELECT COUNT(*) c FROM ' + t).get().c;
    var b = dst.prepare('SELECT COUNT(*) c FROM ' + t).get().c;
    assert.strictEqual(b, a, 'conteggio diverso per ' + t);
  });
  assert.strictEqual(counts.vehicles, 1);
  assert.strictEqual(counts.fillups, 2);

  /* le statistiche devono coincidere */
  var vSrc = src.prepare('SELECT * FROM vehicles').get();
  var vDst = dst.prepare('SELECT * FROM vehicles').get();
  var sSrc = calc.computeStats(vSrc, DB.list(src, 'fillups', vSrc.id), DB.list(src, 'expenses', vSrc.id));
  var sDst = calc.computeStats(vDst, DB.list(dst, 'fillups', vDst.id), DB.list(dst, 'expenses', vDst.id));
  assert.deepStrictEqual(sDst.avg_kml, sSrc.avg_kml);
  assert.deepStrictEqual(sDst.total_cost, sSrc.total_cost);

  src.close(); dst.close();
});

test('import additivo: gli id dei veicoli vengono rimappati', function () {
  var db = DB.openMemory();
  seed(db);
  var dump = DB.exportAll(db);
  DB.importAll(db, dump, false);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM vehicles').get().c, 2);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM fillups').get().c, 4);
  var ids = db.prepare('SELECT DISTINCT vehicle_id v FROM fillups ORDER BY v').all();
  assert.strictEqual(ids.length, 2);
  db.close();
});

test('update parziale non azzera i campi non inviati', function () {
  var db = DB.openMemory();
  var v = seed(db);
  DB.update(db, 'vehicles', v.id, { notes: 'auto di casa' });
  var after = DB.get(db, 'vehicles', v.id);
  assert.strictEqual(after.name, 'Panda');
  assert.strictEqual(after.tank_l, 38);
  assert.strictEqual(after.notes, 'auto di casa');
  db.close();
});

test('hook onDataChanged centralizzato (predisposizione FASE 2)', function () {
  var seen = [];
  DB.addChangeListener(function (vid, table, action) { seen.push([vid, table, action]); });
  DB.onDataChanged(1, 'fillups', 'insert');
  assert.deepStrictEqual(seen, [[1, 'fillups', 'insert']]);
});
