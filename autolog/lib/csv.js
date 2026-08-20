/*
 * AutoLog — parser/serializer CSV tollerante, con mappatura alias Fuelly.
 */
'use strict';

var MI_TO_KM = 1.609344;
var GAL_TO_L = 3.785411784;

/* ---------- parsing di basso livello ---------- */

function stripBom(text) {
  return text && text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function detectDelimiter(firstLine) {
  var inQ = false, c = 0, s = 0, t = 0;
  for (var i = 0; i < firstLine.length; i++) {
    var ch = firstLine[i];
    if (ch === '"') inQ = !inQ;
    else if (!inQ) {
      if (ch === ',') c++;
      else if (ch === ';') s++;
      else if (ch === '\t') t++;
    }
  }
  if (s > c && s >= t) return ';';
  if (t > c && t > s) return '\t';
  return ',';
}

/* Parser CSV completo: virgolette con raddoppio, newline dentro i campi. */
function parseCSV(text, delimiter) {
  text = stripBom(String(text || '')).replace(/\r\n?/g, '\n');
  if (!text.trim()) return { delimiter: delimiter || ',', rows: [] };
  var d = delimiter || detectDelimiter(text.split('\n')[0]);
  var rows = [], row = [], field = '', inQ = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === d) {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  row.push(field);
  rows.push(row);

  /* scarta le righe completamente vuote */
  return {
    delimiter: d,
    rows: rows.filter(function (r) {
      return r.some(function (v) { return String(v).trim() !== ''; });
    })
  };
}

function csvEscape(v, d) {
  var s = v === null || v === undefined ? '' : String(v);
  if (s.indexOf('"') >= 0 || s.indexOf(d) >= 0 || s.indexOf('\n') >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCSV(columns, rows, delimiter) {
  var d = delimiter || ',';
  var out = [columns.map(function (c) { return csvEscape(c, d); }).join(d)];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    out.push(columns.map(function (c) { return csvEscape(r[c], d); }).join(d));
  }
  return out.join('\n') + '\n';
}

/* ---------- numeri e date ---------- */

/*
 * Accetta "1.234,56" (IT), "1,234.56" (EN), "12,5", "12.5", "€ 45,00", "45 L".
 */
function parseNumber(raw, locale) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  var s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[\u20ac$\u00a3\s\u00a0]/g, '').replace(/[a-zA-Z\/]+$/, '');
  if (!s) return null;
  var neg = /^-/.test(s);
  s = s.replace(/^[-+]/, '');
  var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');

  if (locale === 'en') {
    /* file in stile inglese: la virgola separa le migliaia, il punto i decimali */
    s = s.replace(/,/g, '');
  } else if (locale === 'it') {
    /* file in stile italiano: il punto separa le migliaia, la virgola i decimali */
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.'); // IT
    else s = s.replace(/,/g, '');                                        // EN
  } else if (lastComma >= 0) {
    /* "1,234" con esattamente 3 cifre dopo: migliaia in stile inglese */
    if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if (lastDot >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  var n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/* Il separatore del file rivela la convenzione numerica: "," -> EN, ";" -> IT. */
function localeFromDelimiter(d) {
  return d === ',' ? 'en' : 'it';
}

/*
 * dateOrder: 'US' (MM/DD/YYYY, default Fuelly) oppure 'EU' (DD/MM/YYYY).
 * Se il primo gruppo è > 12 è certamente il giorno, qualunque sia l'ordine.
 */
function parseDate(raw, dateOrder) {
  if (!raw) return null;
  var s = String(raw).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return pad(m[1], 4) + '-' + pad(m[2], 2) + '-' + pad(m[3], 2);

  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) {
    var a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    var day, mon;
    if (a > 12) { day = a; mon = b; }
    else if (b > 12) { mon = a; day = b; }
    else if (String(dateOrder).toUpperCase() === 'EU') { day = a; mon = b; }
    else { mon = a; day = b; }
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
    return pad(y, 4) + '-' + pad(mon, 2) + '-' + pad(day, 2);
  }
  var t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

function pad(v, len) {
  var s = String(v);
  while (s.length < len) s = '0' + s;
  return s;
}

function parseBool(raw) {
  if (raw === null || raw === undefined) return null;
  var s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (['1', 'true', 'yes', 'y', 'si', 'sì', 'x', 'full', 'pieno', 'vero'].indexOf(s) >= 0) return 1;
  if (['0', 'false', 'no', 'n', 'partial', 'parziale', 'falso'].indexOf(s) >= 0) return 0;
  return null;
}

/* ---------- mappatura intestazioni ---------- */

function normHeader(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[\s_\-.]/g, '')
    .replace(/[^a-z0-9\/]/g, '')
    .trim();
}

var ALIASES = {
  date: ['fuelupdate', 'date', 'data', 'datarifornimento', 'day', 'datetime', 'fecha'],
  odo: ['odometer', 'odo', 'km', 'kilometers', 'kilometri', 'mileage', 'miles', 'contachilometri', 'odometro'],
  liters: ['totalgallons', 'gallons', 'liters', 'litres', 'litri', 'quantity', 'quantita', 'volume', 'fuelvolume', 'amount'],
  total_cost: ['totalcost', 'cost', 'totale', 'importo', 'costototale', 'price', 'totalprice', 'spesa'],
  price_l: ['price/gallon', 'pricegallon', 'price/liter', 'priceliter', 'prezzo/litro', 'prezzolitro', 'unitprice', 'prezzounitario', 'ppl', 'ppg'],
  full: ['filledup', 'full', 'pieno', 'fullfillup', 'fulltank', 'pienocompleto'],
  partial: ['partialfuelup', 'partial', 'parziale'],
  missed: ['missedfuelup', 'missed', 'nonregistrato', 'saltato'],
  station: ['gasbrand', 'brand', 'distributore', 'station', 'gasstation', 'marca'],
  location: ['location', 'luogo', 'city', 'citta', 'place', 'indirizzo'],
  payment: ['paymenttype', 'payment', 'pagamento', 'metodopagamento'],
  fuel_type: ['octane', 'typeoffuel', 'fueltype', 'carburante', 'tipocarburante'],
  notes: ['notes', 'note', 'comment', 'comments', 'commenti'],
  /* spese */
  category: ['category', 'categoria', 'type', 'tipo', 'servicetype'],
  description: ['description', 'descrizione', 'service', 'servizio', 'item'],
  vendor: ['vendor', 'shop', 'officina', 'fornitore', 'place'],
  cost: ['cost', 'costo', 'totale', 'importo', 'totalcost', 'price', 'spesa']
};

/*
 * La colonna "price" è ambigua: per Drivvo è il totale speso, per Fuelio è il
 * prezzo unitario. Se non c'è una colonna dedicata al prezzo/litro, si decide
 * dai dati: un valore piccolo (<= 5) a fronte di volumi normali (>= 5) è un
 * prezzo unitario, non un pieno da 3 euro.
 */
function disambiguatePrice(map, rows, parseVal) {
  if (map.total_cost === undefined || map.price_l !== undefined) return map;
  var prices = [], vols = [];
  for (var i = 1; i < rows.length && prices.length < 40; i++) {
    var pv = parseVal(rows[i][map.total_cost]);
    var lv = map.liters === undefined ? null : parseVal(rows[i][map.liters]);
    if (pv !== null && pv > 0) prices.push(pv);
    if (lv !== null && lv > 0) vols.push(lv);
  }
  if (!prices.length || !vols.length) return map;
  var med = function (a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; };
  if (med(prices) <= 5 && med(vols) >= 5) {
    map.price_l = map.total_cost;
    delete map.total_cost;
  }
  return map;
}

function mapHeaders(headerRow, aliasSet) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = normHeader(headerRow[i]);
    if (!h) continue;
    for (var key in aliasSet) {
      if (map[key] !== undefined) continue;
      if (aliasSet[key].indexOf(h) >= 0) { map[key] = i; break; }
    }
  }
  return map;
}

/* ---------- import rifornimenti ---------- */

/*
 * opts: {miles: bool, gallons: bool, dateOrder: 'US'|'EU'}
 * Ritorna {rows, skipped, errors, headers, mapped}
 */
function parseFillupsCSV(text, opts) {
  opts = opts || {};
  var parsed = parseCSV(text, opts.delimiter);
  if (!parsed.rows.length) return { rows: [], skipped: 0, errors: ['CSV vuoto'], headers: [], mapped: {} };

  var header = parsed.rows[0];
  var map = mapHeaders(header, ALIASES);
  var rows = [], skipped = 0, errors = [];
  var loc = opts.locale || localeFromDelimiter(parsed.delimiter);
  var pnum = function (v) { return parseNumber(v, loc); };
  if (map.total_cost !== undefined && normHeader(header[map.total_cost]) === 'price') {
    disambiguatePrice(map, parsed.rows, pnum);
  }

  if (map.date === undefined || map.odo === undefined) {
    errors.push('Colonne obbligatorie non trovate (data e chilometraggio)');
    return { rows: [], skipped: parsed.rows.length - 1, errors: errors, headers: header, mapped: map };
  }

  var distFactor = opts.miles ? MI_TO_KM : 1;
  var volFactor = opts.gallons ? GAL_TO_L : 1;

  for (var r = 1; r < parsed.rows.length; r++) {
    var cells = parsed.rows[r];
    var get = function (k) { return map[k] === undefined ? '' : cells[map[k]]; };

    var date = parseDate(get('date'), opts.dateOrder || 'US');
    var odo = pnum(get('odo'));
    var liters = pnum(get('liters'));
    var cost = pnum(get('total_cost'));
    var price = pnum(get('price_l'));

    if (!date || odo === null) { skipped++; errors.push('Riga ' + (r + 1) + ': data o km non validi'); continue; }

    odo = odo * distFactor;
    if (liters !== null) liters = liters * volFactor;
    if (price !== null) price = price / volFactor;

    if (liters === null || liters <= 0) {
      if (cost !== null && price) liters = cost / price;
    }
    if (liters === null || liters <= 0) { skipped++; errors.push('Riga ' + (r + 1) + ': litri mancanti'); continue; }

    if (cost === null && price !== null) cost = price * liters;
    if (cost === null) cost = 0;

    var full = parseBool(get('full'));
    if (full === null) {
      var partial = parseBool(get('partial'));
      full = partial === null ? 1 : (partial ? 0 : 1);
    }
    var missed = parseBool(get('missed'));

    rows.push({
      date: date,
      odo: Math.round(odo * 10) / 10,
      liters: Math.round(liters * 1000) / 1000,
      total_cost: Math.round(cost * 100) / 100,
      price_l: liters > 0 ? Math.round((cost / liters) * 1000) / 1000 : null,
      full: full ? 1 : 0,
      missed: missed ? 1 : 0,
      fuel_type: String(get('fuel_type') || '').trim(),
      station: String(get('station') || '').trim(),
      location: String(get('location') || '').trim(),
      payment: String(get('payment') || '').trim(),
      notes: String(get('notes') || '').trim()
    });
  }

  return { rows: rows, skipped: skipped, errors: errors, headers: header, mapped: map };
}

/* ---------- import spese ---------- */

function parseExpensesCSV(text, opts) {
  opts = opts || {};
  var parsed = parseCSV(text, opts.delimiter);
  if (!parsed.rows.length) return { rows: [], skipped: 0, errors: ['CSV vuoto'], headers: [], mapped: {} };
  var header = parsed.rows[0];
  var map = mapHeaders(header, ALIASES);
  var rows = [], skipped = 0, errors = [];
  var distFactor = opts.miles ? MI_TO_KM : 1;
  var loc = opts.locale || localeFromDelimiter(parsed.delimiter);
  var pnum = function (v) { return parseNumber(v, loc); };

  if (map.date === undefined) {
    errors.push('Colonna data non trovata');
    return { rows: [], skipped: parsed.rows.length - 1, errors: errors, headers: header, mapped: map };
  }

  for (var r = 1; r < parsed.rows.length; r++) {
    var cells = parsed.rows[r];
    var get = function (k) { return map[k] === undefined ? '' : cells[map[k]]; };
    var date = parseDate(get('date'), opts.dateOrder || 'US');
    if (!date) { skipped++; errors.push('Riga ' + (r + 1) + ': data non valida'); continue; }
    var odo = pnum(get('odo'));
    var cost = pnum(get('cost'));
    if (cost === null) cost = pnum(get('total_cost'));
    rows.push({
      date: date,
      odo: odo === null ? null : Math.round(odo * distFactor * 10) / 10,
      category: String(get('category') || 'Manutenzione').trim() || 'Manutenzione',
      description: String(get('description') || '').trim(),
      cost: cost === null ? 0 : Math.round(cost * 100) / 100,
      vendor: String(get('vendor') || '').trim(),
      notes: String(get('notes') || '').trim()
    });
  }
  return { rows: rows, skipped: skipped, errors: errors, headers: header, mapped: map };
}

module.exports = {
  MI_TO_KM: MI_TO_KM,
  GAL_TO_L: GAL_TO_L,
  parseCSV: parseCSV,
  toCSV: toCSV,
  parseNumber: parseNumber,
  localeFromDelimiter: localeFromDelimiter,
  parseDate: parseDate,
  parseBool: parseBool,
  normHeader: normHeader,
  ALIASES: ALIASES,
  mapHeaders: mapHeaders,
  disambiguatePrice: disambiguatePrice,
  parseFillupsCSV: parseFillupsCSV,
  parseExpensesCSV: parseExpensesCSV
};
