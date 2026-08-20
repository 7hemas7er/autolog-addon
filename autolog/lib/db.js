/*
 * AutoLog — accesso al database SQLite (modulo built-in node:sqlite).
 * Il DB è la sola fonte di verità: nessun dato utente vive altrove.
 */
'use strict';

var fs = require('node:fs');
var path = require('node:path');
var { DatabaseSync } = require('node:sqlite');

var SCHEMA_VERSION = 1;

var SCHEMA = `
CREATE TABLE IF NOT EXISTS vehicles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  make       TEXT DEFAULT '',
  model      TEXT DEFAULT '',
  year       INTEGER,
  plate      TEXT DEFAULT '',
  fuel_type  TEXT DEFAULT 'Benzina',
  tank_l     REAL,
  start_odo  REAL DEFAULT 0,
  notes      TEXT DEFAULT '',
  archived   INTEGER DEFAULT 0,
  sort       INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fillups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  odo        REAL NOT NULL,
  liters     REAL NOT NULL,
  total_cost REAL NOT NULL,
  price_l    REAL,
  full       INTEGER DEFAULT 1,
  missed     INTEGER DEFAULT 0,
  fuel_type  TEXT DEFAULT '',
  station    TEXT DEFAULT '',
  location   TEXT DEFAULT '',
  payment    TEXT DEFAULT '',
  notes      TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_fillups_v ON fillups(vehicle_id, odo);

CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  odo         REAL,
  category    TEXT DEFAULT 'Manutenzione',
  description TEXT DEFAULT '',
  cost        REAL NOT NULL DEFAULT 0,
  vendor      TEXT DEFAULT '',
  notes       TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_expenses_v ON expenses(vehicle_id, date);

CREATE TABLE IF NOT EXISTS reminders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  category     TEXT DEFAULT 'Manutenzione',
  due_date     TEXT,
  due_odo      REAL,
  every_months INTEGER,
  every_km     REAL,
  done         INTEGER DEFAULT 0,
  notes        TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_reminders_v ON reminders(vehicle_id, done);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`;

/* Migrazioni versionate: mai droppare dati, solo aggiunte idempotenti. */
var MIGRATIONS = [
  /* [0 -> 1] schema iniziale, già coperto da SCHEMA */
  function (db) { /* no-op */ }
];

var COLUMNS = {
  vehicles: {
    name: 'text', make: 'text', model: 'text', year: 'int', plate: 'text',
    fuel_type: 'text', tank_l: 'real', start_odo: 'real', notes: 'text',
    archived: 'bool', sort: 'int'
  },
  fillups: {
    vehicle_id: 'int', date: 'date', odo: 'real', liters: 'real',
    total_cost: 'real', price_l: 'real', full: 'bool', missed: 'bool',
    fuel_type: 'text', station: 'text', location: 'text', payment: 'text', notes: 'text'
  },
  expenses: {
    vehicle_id: 'int', date: 'date', odo: 'real', category: 'text',
    description: 'text', cost: 'real', vendor: 'text', notes: 'text'
  },
  reminders: {
    vehicle_id: 'int', title: 'text', category: 'text', due_date: 'date',
    due_odo: 'real', every_months: 'int', every_km: 'real', done: 'bool', notes: 'text'
  }
};

function coerce(kind, value) {
  if (value === undefined) return undefined;
  switch (kind) {
    case 'int': {
      if (value === null || value === '') return null;
      var i = Number(value);
      return Number.isFinite(i) ? Math.trunc(i) : null;
    }
    case 'real': {
      if (value === null || value === '') return null;
      var n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'bool':
      return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
    case 'date':
      if (value === null || value === '') return null;
      return String(value).slice(0, 10);
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}

/* Coercizione centralizzata per tabella. */
function coerceRow(table, input) {
  var spec = COLUMNS[table];
  if (!spec) throw new Error('Tabella sconosciuta: ' + table);
  var out = {};
  for (var col in spec) {
    if (Object.prototype.hasOwnProperty.call(input, col)) {
      var v = coerce(spec[col], input[col]);
      if (v !== undefined) out[col] = v;
    }
  }
  /* prezzo/litro coerente: total_cost è la fonte di verità */
  if (table === 'fillups') {
    var L = out.liters, C = out.total_cost, P = out.price_l;
    if (L > 0 && (C === null || C === undefined) && P) out.total_cost = Math.round(P * L * 100) / 100;
    if (L > 0 && out.total_cost !== null && out.total_cost !== undefined) {
      out.price_l = Math.round((out.total_cost / L) * 1000) / 1000;
    }
  }
  return out;
}

function open(dataDir) {
  var dir = dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  var file = path.join(dir, 'autolog.db');
  var db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  db.__file = file;
  return db;
}

function openMemory() {
  var db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  db.__file = ':memory:';
  return db;
}

function migrate(db) {
  var row = db.prepare('PRAGMA user_version').get();
  var current = Number(row.user_version || 0);
  for (var v = current; v < SCHEMA_VERSION; v++) {
    if (MIGRATIONS[v]) MIGRATIONS[v](db);
  }
  if (current < SCHEMA_VERSION) db.exec('PRAGMA user_version = ' + SCHEMA_VERSION);
}

/* ---------- CRUD generico ---------- */

function all(db, table, where, params) {
  var sql = 'SELECT * FROM ' + table + (where ? ' WHERE ' + where : '');
  var st = db.prepare(sql);
  return st.all.apply(st, params || []);
}

function list(db, table, vehicleId, order) {
  var sql = 'SELECT * FROM ' + table;
  var params = [];
  if (vehicleId) { sql += ' WHERE vehicle_id = ?'; params.push(Number(vehicleId)); }
  if (order) sql += ' ORDER BY ' + order;
  var st = db.prepare(sql);
  return params.length ? st.all(params[0]) : st.all();
}

function get(db, table, id) {
  return db.prepare('SELECT * FROM ' + table + ' WHERE id = ?').get(Number(id)) || null;
}

function insert(db, table, data) {
  var row = coerceRow(table, data);
  var cols = Object.keys(row);
  if (!cols.length) throw new Error('Nessun campo valido da inserire');
  var sql = 'INSERT INTO ' + table + ' (' + cols.join(',') + ') VALUES (' +
    cols.map(function () { return '?'; }).join(',') + ')';
  var st = db.prepare(sql);
  var info = st.run.apply(st, cols.map(function (c) { return row[c]; }));
  return get(db, table, info.lastInsertRowid);
}

function update(db, table, id, data) {
  var row = coerceRow(table, data);
  delete row.vehicle_id_locked;
  var cols = Object.keys(row);
  if (!cols.length) return get(db, table, id);
  var sql = 'UPDATE ' + table + ' SET ' + cols.map(function (c) { return c + ' = ?'; }).join(', ') +
    ' WHERE id = ?';
  var values = cols.map(function (c) { return row[c]; }).concat([Number(id)]);
  var st = db.prepare(sql);
  st.run.apply(st, values);
  return get(db, table, id);
}

function remove(db, table, id) {
  var info = db.prepare('DELETE FROM ' + table + ' WHERE id = ?').run(Number(id));
  return info.changes > 0;
}

/* ---------- backup / ripristino ---------- */

var TABLES = ['vehicles', 'fillups', 'expenses', 'reminders'];

function exportAll(db) {
  var out = { app: 'autolog', version: SCHEMA_VERSION, exported_at: new Date().toISOString() };
  TABLES.forEach(function (t) { out[t] = db.prepare('SELECT * FROM ' + t + ' ORDER BY id').all(); });
  out.settings = db.prepare('SELECT * FROM settings').all();
  return out;
}

/*
 * Ripristino. replace=true svuota tutto e reinserisce mantenendo gli id,
 * replace=false aggiunge rimappando gli id dei veicoli.
 */
function importAll(db, data, replace) {
  if (!data || typeof data !== 'object') throw new Error('Backup non valido');
  var counts = { vehicles: 0, fillups: 0, expenses: 0, reminders: 0 };
  db.exec('BEGIN');
  try {
    if (replace) {
      db.exec('DELETE FROM reminders; DELETE FROM expenses; DELETE FROM fillups; DELETE FROM vehicles;');
    }
    var idMap = {};
    (data.vehicles || []).forEach(function (v) {
      var created;
      if (replace && v.id) {
        var row = coerceRow('vehicles', v);
        var cols = ['id'].concat(Object.keys(row));
        var vals = [Number(v.id)].concat(Object.keys(row).map(function (c) { return row[c]; }));
        var sql = 'INSERT INTO vehicles (' + cols.join(',') + ') VALUES (' +
          cols.map(function () { return '?'; }).join(',') + ')';
        var st = db.prepare(sql);
        st.run.apply(st, vals);
        created = { id: Number(v.id) };
      } else {
        created = insert(db, 'vehicles', v);
      }
      idMap[v.id] = created.id;
      counts.vehicles++;
    });
    ['fillups', 'expenses', 'reminders'].forEach(function (t) {
      (data[t] || []).forEach(function (r) {
        var vid = idMap[r.vehicle_id];
        if (!vid) return;
        insert(db, t, Object.assign({}, r, { vehicle_id: vid }));
        counts[t]++;
      });
    });
    (data.settings || []).forEach(function (s) {
      db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(String(s.key), String(s.value));
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return counts;
}

/*
 * Hook centralizzato: OGNI scrittura sul DB passa di qui.
 * In FASE 2 (add-on Home Assistant) qui si aggancia il publisher MQTT.
 */
var changeListeners = [];
function onDataChanged(vehicleId, table, action) {
  for (var i = 0; i < changeListeners.length; i++) {
    try { changeListeners[i](vehicleId, table, action); } catch (e) { /* mai bloccare la richiesta */ }
  }
}
function addChangeListener(fn) { changeListeners.push(fn); }

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  COLUMNS: COLUMNS,
  TABLES: TABLES,
  open: open,
  openMemory: openMemory,
  coerceRow: coerceRow,
  all: all,
  list: list,
  get: get,
  insert: insert,
  update: update,
  remove: remove,
  exportAll: exportAll,
  importAll: importAll,
  onDataChanged: onDataChanged,
  addChangeListener: addChangeListener
};
