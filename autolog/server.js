/*
 * AutoLog — entrypoint HTTP e routing.
 */
'use strict';

/* --- Node 22.x: node:sqlite richiede --experimental-sqlite -> rilancio --- */
var sqlite;
try { sqlite = require('node:sqlite'); }
catch (e) {
  if (!process.env.__AUTOLOG_RESPAWNED) {
    var spawnSync = require('node:child_process').spawnSync;
    var r = spawnSync(process.execPath,
      ['--experimental-sqlite', __filename].concat(process.argv.slice(2)),
      { stdio: 'inherit', env: Object.assign({}, process.env, { __AUTOLOG_RESPAWNED: '1' }) });
    process.exit(r.status === null || r.status === undefined ? 1 : r.status);
  }
  console.error('Serve Node >= 22.5');
  process.exit(1);
}

var http = require('node:http');
var fs = require('node:fs');
var path = require('node:path');
var crypto = require('node:crypto');

var DB = require('./lib/db.js');
var calc = require('./lib/calc.js');
var csvlib = require('./lib/csv.js');
var H = require('./lib/http.js');
var HASS = require('./lib/hass.js');
var I18N = require('./public/i18n.js');
var UNITS = require('./lib/units.js');

var VERSION = '1.3.0';

/* --- configurazione --- */
var PORT = Number(process.env.PORT || 8099);
var HOST = process.env.HOST || '0.0.0.0';
var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

/* Opzioni da add-on Home Assistant (FASE 2): /data/options.json se presente. */
var options = {};
try {
  var optFile = path.join(DATA_DIR, 'options.json');
  if (fs.existsSync(optFile)) options = JSON.parse(fs.readFileSync(optFile, 'utf8')) || {};
} catch (e) { options = {}; }

/*
 * Sotto l'Ingress di Home Assistant l'autenticazione la fa HA: quella interna
 * si disattiva da sola, a meno di non forzarla esplicitamente.
 */
var IS_ADDON = !!process.env.SUPERVISOR_TOKEN;
var PASSWORD = process.env.AUTOLOG_PASSWORD || options.password || '';
if (IS_ADDON && !options.force_password) PASSWORD = '';

var SECRET = process.env.AUTOLOG_SECRET || options.secret || crypto.randomBytes(32).toString('hex');
var COOKIE = 'autolog_session';
var PUBLIC_DIR = path.join(__dirname, 'public');

var db = DB.open(DATA_DIR);

/* Hook centralizzato: ogni scrittura passa di qui e risveglia il publisher. */
function changed(vehicleId, table, action) { DB.onDataChanged(vehicleId, table, action); }

/* ---------- Home Assistant: credenziali MQTT ---------- */

/*
 * In add-on le credenziali arrivano dal Supervisor (services: mqtt:need),
 * altrimenti si leggono da options.json o dalle variabili d'ambiente.
 */
async function mqttConfig() {
  if (options.mqtt_host || process.env.MQTT_HOST) {
    return {
      host: options.mqtt_host || process.env.MQTT_HOST,
      port: Number(options.mqtt_port || process.env.MQTT_PORT || 1883),
      username: options.mqtt_username || process.env.MQTT_USERNAME || '',
      password: options.mqtt_password || process.env.MQTT_PASSWORD || '',
      source: 'configurazione'
    };
  }
  if (!process.env.SUPERVISOR_TOKEN) return null;
  try {
    var res = await fetch('http://supervisor/services/mqtt', {
      headers: { Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var body = await res.json();
    var d = body.data || {};
    if (!d.host) throw new Error('nessun broker MQTT configurato in Home Assistant');
    return {
      host: d.host, port: Number(d.port || 1883),
      username: d.username || '', password: d.password || '',
      source: 'Supervisor'
    };
  } catch (e) {
    console.error('[autolog/mqtt] credenziali non disponibili: ' + e.message);
    return null;
  }
}

var publisher = null;

async function startPublisher() {
  if (options.mqtt_enabled === false) return;
  var cfg = await mqttConfig();
  if (!cfg) return;
  cfg.version = VERSION;
  cfg.unitSettings = readUnitSettings;
  publisher = new HASS.Publisher(db, cfg);
  publisher.start();
  DB.addChangeListener(function () { publisher.schedule(); });
  console.log('[autolog/mqtt] credenziali da ' + cfg.source + ': ' + cfg.host + ':' + cfg.port);
}

/* --- helper di routing --- */

function authed(req) {
  if (!PASSWORD) return true;
  var cookies = H.parseCookies(req);
  return H.tokenValid(cookies[COOKIE], SECRET);
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

/* Unità e valuta correnti, con i default metrici/euro. */
function readUnitSettings() {
  var u = db.prepare('SELECT value FROM settings WHERE key = ?').get('units');
  var c = db.prepare('SELECT value FROM settings WHERE key = ?').get('currency');
  var system = UNITS.normalize(u && u.value);
  var code = (c && c.value && UNITS.CURRENCIES[c.value]) ? c.value : 'EUR';
  return {
    system: system,
    currency: code,
    symbol: UNITS.currencySymbol(code),
    distance: UNITS.distanceUnit(system),
    volume: UNITS.volumeUnit(system),
    consumption: UNITS.consumptionUnit(system),
    systems: UNITS.SYSTEMS,
    currencies: Object.keys(UNITS.CURRENCIES)
  };
}

function vehicleOr404(res, id) {
  var v = DB.get(db, 'vehicles', id);
  if (!v) { H.error(res, 404, 'Veicolo non trovato'); return null; }
  return v;
}

function currentOdo(vehicleId) {
  var row = db.prepare('SELECT MAX(odo) AS m FROM fillups WHERE vehicle_id = ?').get(Number(vehicleId));
  var v = DB.get(db, 'vehicles', vehicleId);
  var m = row && row.m !== null ? Number(row.m) : null;
  var s = v && v.start_odo ? Number(v.start_odo) : null;
  if (m === null) return s;
  return s !== null ? Math.max(m, s) : m;
}

var COLLECTIONS = {
  fillups: 'date DESC, odo DESC, id DESC',
  expenses: 'date DESC, id DESC',
  reminders: 'done ASC, due_date ASC, due_odo ASC, id ASC'
};

/* --- API --- */

async function handleApi(req, res, url) {
  var seg = url.pathname.replace(/^\/+/, '').split('/'); // ['api', ...]
  var q = url.searchParams;
  var method = req.method.toUpperCase();
  var r1 = seg[1], r2 = seg[2], r3 = seg[3];

  /* auth */
  if (r1 === 'auth') {
    if (r2 === 'status') return H.json(res, 200, { required: !!PASSWORD, authed: authed(req) });
    if (r2 === 'login' && method === 'POST') {
      var body = await H.readJson(req);
      if (!PASSWORD) return H.json(res, 200, { authed: true });
      if (!H.passwordMatches(body.password, PASSWORD)) return H.error(res, 401, 'Password errata');
      var token = H.makeToken(SECRET, 90);
      return H.json(res, 200, { authed: true }, { 'Set-Cookie': H.cookieHeader(COOKIE, token, 90 * 86400) });
    }
    if (r2 === 'logout') {
      return H.json(res, 200, { authed: false }, { 'Set-Cookie': H.cookieHeader(COOKIE, '', 0) });
    }
    return H.error(res, 404, 'Endpoint non trovato');
  }

  if (!authed(req)) return H.error(res, 401, 'Non autenticato');

  /* veicoli */
  if (r1 === 'vehicles') {
    if (!r2) {
      if (method === 'GET') {
        return H.json(res, 200, db.prepare('SELECT * FROM vehicles ORDER BY archived ASC, sort ASC, id ASC').all());
      }
      if (method === 'POST') {
        var payload = await H.readJson(req);
        var items = Array.isArray(payload) ? payload : [payload];
        var created = items.map(function (it) {
          if (!it || !String(it.name || '').trim()) throw new Error('Il nome del veicolo è obbligatorio');
          var v = DB.insert(db, 'vehicles', it);
          changed(v.id, 'vehicles', 'insert');
          return v;
        });
        return H.json(res, 201, Array.isArray(payload) ? created : created[0]);
      }
      return H.error(res, 405, 'Metodo non consentito');
    }
    var vid = Number(r2);
    if (method === 'GET') {
      var v = vehicleOr404(res, vid); if (!v) return;
      return H.json(res, 200, v);
    }
    if (method === 'PUT') {
      if (!vehicleOr404(res, vid)) return;
      var upd = DB.update(db, 'vehicles', vid, await H.readJson(req));
      changed(vid, 'vehicles', 'update');
      return H.json(res, 200, upd);
    }
    if (method === 'DELETE') {
      if (!vehicleOr404(res, vid)) return;
      DB.remove(db, 'vehicles', vid);
      changed(vid, 'vehicles', 'delete');
      return H.json(res, 200, { deleted: true });
    }
    return H.error(res, 405, 'Metodo non consentito');
  }

  /* collezioni legate a un veicolo */
  if (COLLECTIONS[r1]) {
    var table = r1;
    if (!r2) {
      if (method === 'GET') {
        var vq = q.get('vehicle');
        var rows = DB.list(db, table, vq ? Number(vq) : null, COLLECTIONS[table]);
        if (table === 'fillups' && vq) {
          var computed = calc.computeConsumption(rows);
          var byId = {};
          computed.forEach(function (c) { byId[c.id] = c; });
          rows = rows.map(function (r) {
            var c = byId[r.id] || {};
            return Object.assign({}, r, {
              kml: calc.round(c.kml, 2), l100: calc.round(c.l100, 2),
              eurkm: calc.round(c.eurkm, 4), dist: calc.round(c.dist, 1),
              odo_warning: !!c.odo_warning
            });
          });
        }
        if (table === 'reminders' && vq) {
          var odo = currentOdo(Number(vq));
          var today = todayISO();
          rows = rows.map(function (r) {
            return Object.assign({}, r, calc.reminderStatus(r, odo, today));
          });
        }
        return H.json(res, 200, rows);
      }
      if (method === 'POST') {
        var payload2 = await H.readJson(req);
        var items2 = Array.isArray(payload2) ? payload2 : [payload2];
        var out = items2.map(function (it) {
          if (!it || !it.vehicle_id) throw new Error('vehicle_id obbligatorio');
          if (!DB.get(db, 'vehicles', it.vehicle_id)) throw new Error('Veicolo inesistente');
          var row = DB.insert(db, table, it);
          changed(row.vehicle_id, table, 'insert');
          return row;
        });
        return H.json(res, 201, Array.isArray(payload2) ? out : out[0]);
      }
      return H.error(res, 405, 'Metodo non consentito');
    }
    var id = Number(r2);
    var existing = DB.get(db, table, id);
    if (!existing) return H.error(res, 404, 'Elemento non trovato');

    if (method === 'GET') return H.json(res, 200, existing);
    if (method === 'PUT') {
      var data = await H.readJson(req);
      /* completamento di un promemoria ricorrente -> genera il successivo */
      if (table === 'reminders' && Number(data.done) === 1 && !Number(existing.done)) {
        var next = calc.nextOccurrence(existing, data.done_date || todayISO(),
          data.done_odo !== undefined ? data.done_odo : currentOdo(existing.vehicle_id));
        if (next && (next.due_date || next.due_odo !== null)) {
          DB.insert(db, 'reminders', Object.assign({}, existing, {
            id: undefined, done: 0, due_date: next.due_date, due_odo: next.due_odo
          }));
        }
      }
      var updated = DB.update(db, table, id, data);
      changed(updated.vehicle_id, table, 'update');
      return H.json(res, 200, updated);
    }
    if (method === 'DELETE') {
      DB.remove(db, table, id);
      changed(existing.vehicle_id, table, 'delete');
      return H.json(res, 200, { deleted: true });
    }
    return H.error(res, 405, 'Metodo non consentito');
  }

  /*
   * Unità e valuta.
   *
   * A differenza della lingua queste valgono per l'intera istanza, non per
   * utente: determinano anche l'unità dei sensori MQTT, e in Home Assistant
   * due utenti non possono vedere lo stesso sensore in unità diverse.
   */
  if (r1 === 'settings' && r2 === 'units') {
    if (method === 'GET') {
      return H.json(res, 200, readUnitSettings());
    }
    if (method === 'PUT') {
      var b = await H.readJson(req);
      if (b.system !== undefined) {
        if (UNITS.SYSTEMS.indexOf(b.system) < 0) return H.error(res, 400, 'Sistema di unità non valido');
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('units', String(b.system));
      }
      if (b.currency !== undefined) {
        if (!UNITS.CURRENCIES[b.currency]) return H.error(res, 400, 'Valuta non supportata');
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('currency', String(b.currency));
      }
      changed(null, 'settings', 'update');
      return H.json(res, 200, readUnitSettings());
    }
    return H.error(res, 405, 'Metodo non consentito');
  }

  /*
   * Lingua dell'interfaccia.
   *
   * L'Ingress di Home Assistant imposta X-Remote-User-Id, quindi la
   * preferenza si salva per utente HA invece che per browser: chi sceglie
   * l'inglese se lo ritrova su ogni dispositivo. Fuori dall'add-on la
   * preferenza è unica per l'istanza.
   */
  if (r1 === 'lang') {
    var userKey = 'lang:' + (req.headers['x-remote-user-id'] || 'default');

    if (method === 'GET') {
      var saved = db.prepare('SELECT value FROM settings WHERE key = ?').get(userKey);
      var detected = I18N.negotiate(req.headers['accept-language']);
      var chosen = saved && saved.value ? saved.value : null;
      return H.json(res, 200, {
        locale: chosen || detected || I18N.FALLBACK,
        explicit: chosen,
        detected: detected,
        user: req.headers['x-remote-user-name'] || null,
        available: I18N.LOCALES.map(function (c) { return { code: c, name: I18N.NAMES[c] }; })
      });
    }

    if (method === 'PUT') {
      var body3 = await H.readJson(req);
      var wanted = body3.locale;
      if (!wanted) {
        db.prepare('DELETE FROM settings WHERE key = ?').run(userKey);
      } else {
        if (I18N.LOCALES.indexOf(wanted) < 0) return H.error(res, 400, 'Lingua non supportata');
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(userKey, String(wanted));
      }
      var detected2 = I18N.negotiate(req.headers['accept-language']);
      return H.json(res, 200, {
        locale: wanted || detected2 || I18N.FALLBACK,
        explicit: wanted || null,
        detected: detected2
      });
    }
    return H.error(res, 405, 'Metodo non consentito');
  }

  /* statistiche */
  if (r1 === 'stats') {
    var sv = q.get('vehicle');
    if (!sv) return H.error(res, 400, 'Parametro vehicle obbligatorio');
    var veh = vehicleOr404(res, Number(sv)); if (!veh) return;
    var f = DB.list(db, 'fillups', Number(sv), 'odo ASC, date ASC, id ASC');
    var e = DB.list(db, 'expenses', Number(sv), 'date ASC, id ASC');
    var stats = calc.computeStats(veh, f, e);
    stats.vehicle_id = veh.id;
    stats.vehicle_name = veh.name;
    return H.json(res, 200, stats);
  }

  /* export / import */
  if (r1 === 'export' && r2 === 'json') {
    var data2 = DB.exportAll(db);
    var body2 = JSON.stringify(data2, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="autolog-backup-' + todayISO() + '.json"',
      'Content-Length': Buffer.byteLength(body2)
    });
    return res.end(body2);
  }

  if (r1 === 'import' && r2 === 'json' && method === 'POST') {
    var payload3 = await H.readJson(req);
    var counts = DB.importAll(db, payload3.data || payload3, !!payload3.replace);
    changed(null, 'all', 'import');
    return H.json(res, 200, counts);
  }

  if (r1 === 'export' && r2 === 'csv') {
    var evid = q.get('vehicle');
    var type = q.get('type') === 'expenses' ? 'expenses' : 'fillups';
    if (!evid) return H.error(res, 400, 'Parametro vehicle obbligatorio');
    var veh2 = vehicleOr404(res, Number(evid)); if (!veh2) return;
    var cols = type === 'fillups'
      ? ['date', 'odo', 'liters', 'total_cost', 'price_l', 'full', 'missed', 'fuel_type', 'station', 'location', 'payment', 'notes']
      : ['date', 'odo', 'category', 'description', 'cost', 'vendor', 'notes'];
    var rows2 = DB.list(db, type, Number(evid), 'date ASC, id ASC');
    var csvText = csvlib.toCSV(cols, rows2, ',');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="autolog-' + type + '-' + slug(veh2.name) + '.csv"',
      'Content-Length': Buffer.byteLength(csvText)
    });
    return res.end(csvText);
  }

  if (r1 === 'import' && r2 === 'csv' && method === 'POST') {
    var p = await H.readJson(req);
    var vidc = Number(p.vehicle_id);
    if (!vidc || !DB.get(db, 'vehicles', vidc)) return H.error(res, 400, 'Veicolo non valido');
    var kind = p.type === 'expenses' ? 'expenses' : 'fillups';
    var opts = { miles: !!p.miles, gallons: !!p.gallons, dateOrder: p.date_order || 'US' };
    var parsed = kind === 'fillups'
      ? csvlib.parseFillupsCSV(p.csv || '', opts)
      : csvlib.parseExpensesCSV(p.csv || '', opts);

    if (p.preview) {
      return H.json(res, 200, {
        preview: parsed.rows.slice(0, 5),
        total: parsed.rows.length,
        skipped: parsed.skipped,
        errors: parsed.errors.slice(0, 10),
        headers: parsed.headers,
        mapped: parsed.mapped
      });
    }

    var imported = 0;
    db.exec('BEGIN');
    try {
      parsed.rows.forEach(function (row) {
        DB.insert(db, kind, Object.assign({}, row, { vehicle_id: vidc }));
        imported++;
      });
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    changed(vidc, kind, 'import');
    return H.json(res, 200, { imported: imported, skipped: parsed.skipped, errors: parsed.errors.slice(0, 10) });
  }

  if (r1 === 'info') {
    var size = 0;
    try { size = fs.statSync(db.__file).size; } catch (e) { size = 0; }
    return H.json(res, 200, {
      db_file: db.__file,
      db_size: size,
      schema_version: DB.SCHEMA_VERSION,
      node: process.version,
      version: VERSION,
      addon: IS_ADDON,
      mqtt: publisher ? (publisher.client && publisher.client.connected ? 'connesso' : 'disconnesso') : 'non configurato',
      counts: {
        vehicles: db.prepare('SELECT COUNT(*) c FROM vehicles').get().c,
        fillups: db.prepare('SELECT COUNT(*) c FROM fillups').get().c,
        expenses: db.prepare('SELECT COUNT(*) c FROM expenses').get().c,
        reminders: db.prepare('SELECT COUNT(*) c FROM reminders').get().c
      }
    });
  }

  return H.error(res, 404, 'Endpoint non trovato');
}

function slug(s) {
  return String(s || 'veicolo').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'veicolo';
}

/* --- server --- */

var server = http.createServer(function (req, res) {
  var url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch (e) { return H.error(res, 400, 'URL non valido'); }

  var p = url.pathname.replace(/^\/+/, '');

  if (p === 'api' || p.indexOf('api/') === 0) {
    Promise.resolve(handleApi(req, res, url)).catch(function (err) {
      if (!res.headersSent) H.error(res, 400, err && err.message ? err.message : 'Errore');
      else res.end();
    });
    return;
  }

  /* calc.js: un solo file, condiviso fra server e browser */
  if (p === 'calc.js') {
    var f = path.join(__dirname, 'lib', 'calc.js');
    try { return void H.sendFile(f, fs.statSync(f), res); }
    catch (e) { return H.error(res, 404, 'File non trovato'); }
  }

  if (p === '' || p === 'index.html') {
    var idx = path.join(PUBLIC_DIR, 'index.html');
    try { return void H.sendFile(idx, fs.statSync(idx), res); }
    catch (e) { return H.error(res, 500, 'index.html mancante'); }
  }

  if (H.serveStatic(PUBLIC_DIR, p, res)) return;

  H.error(res, 404, 'Non trovato');
});

if (require.main === module) {
  server.listen(PORT, HOST, function () {
    console.log('AutoLog ' + VERSION + ' in ascolto su http://' + HOST + ':' + PORT);
    console.log('Database: ' + db.__file);
    if (IS_ADDON) console.log('Modalità add-on Home Assistant: autenticazione delegata all\'Ingress.');
    else if (PASSWORD) console.log('Autenticazione con password attiva.');
    startPublisher();
  });

  ['SIGTERM', 'SIGINT'].forEach(function (sig) {
    process.on(sig, function () {
      if (publisher) publisher.stop();
      server.close(function () { process.exit(0); });
      setTimeout(function () { process.exit(0); }, 2000).unref();
    });
  });
}

module.exports = { server: server, db: db };
