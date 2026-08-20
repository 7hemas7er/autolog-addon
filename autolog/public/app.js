/*
 * AutoLog — stato, viste e form. JS vanilla, nessun build step.
 * Tutti gli URL sono relativi: l'app deve funzionare anche sotto l'Ingress
 * di Home Assistant (/api/hassio_ingress/<token>/).
 */
(function () {
  'use strict';

  var C = window.AutoLogCalc;
  var CH = window.AutoLogCharts;

  /* ---------- preferenze UI (mai dati utente) ---------- */
  var PREF = {
    get: function (k, d) { try { var v = localStorage.getItem('autolog.' + k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('autolog.' + k, v); } catch (e) { /* modalità privata */ } }
  };

  var state = {
    vehicles: [],
    vehicleId: null,
    view: 'riepilogo',
    fillups: [],
    expenses: [],
    reminders: [],
    stats: null,
    pendingImport: null
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- formattazione ---------- */

  function nfmt(n, d) {
    if (n === null || n === undefined || n === '' || !isFinite(n)) return '—';
    return Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function eur(n, d) { return n === null || n === undefined ? '—' : nfmt(n, d === undefined ? 2 : d) + ' €'; }
  function km(n) { return n === null || n === undefined ? '—' : nfmt(n, 0) + ' km'; }
  function dt(iso) { return CH.shortDate(iso); }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /* Accetta la virgola decimale italiana nei campi numerici. */
  function numIn(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim().replace(/\s/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- API ---------- */

  var offline = false;
  function setOffline(v) {
    if (offline === v) return;
    offline = v;
    $('#offline-banner').hidden = !v;
  }

  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    var res;
    try { res = await fetch(path, init); }
    catch (e) { setOffline(true); throw new Error('Server non raggiungibile'); }
    setOffline(false);
    if (res.status === 401) { showLogin(); throw new Error('Non autenticato'); }
    var ct = res.headers.get('content-type') || '';
    var data = ct.indexOf('application/json') >= 0 ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || ('Errore ' + res.status));
    return data;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  /* ---------- tema ---------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    PREF.set('theme', theme);
  }
  function initTheme() {
    var saved = PREF.get('theme', null);
    if (!saved) saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(saved);
  }

  /* ---------- login ---------- */

  function showLogin() {
    $('#login').hidden = false;
    $('#app').hidden = true;
    setTimeout(function () { $('#login-password').focus(); }, 30);
  }
  function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
  }

  /* ---------- caricamento dati ---------- */

  async function loadVehicles() {
    state.vehicles = await api('api/vehicles');
    var sel = $('#vehicle-select');
    sel.textContent = '';
    var active = state.vehicles.filter(function (v) { return !v.archived; });
    var listed = active.length ? active : state.vehicles;
    listed.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.name + (v.archived ? ' (archiviato)' : '');
      sel.appendChild(o);
    });
    var saved = Number(PREF.get('vehicle', 0));
    var ids = listed.map(function (v) { return v.id; });
    state.vehicleId = ids.indexOf(saved) >= 0 ? saved : (ids[0] || null);
    if (state.vehicleId) sel.value = String(state.vehicleId);
    sel.disabled = !listed.length;
  }

  async function loadVehicleData() {
    if (!state.vehicleId) {
      state.fillups = []; state.expenses = []; state.reminders = []; state.stats = null;
      return;
    }
    var v = 'vehicle=' + encodeURIComponent(state.vehicleId);
    var r = await Promise.all([
      api('api/fillups?' + v),
      api('api/expenses?' + v),
      api('api/reminders?' + v),
      api('api/stats?' + v)
    ]);
    state.fillups = r[0]; state.expenses = r[1]; state.reminders = r[2]; state.stats = r[3];
  }

  function currentVehicle() {
    for (var i = 0; i < state.vehicles.length; i++) {
      if (state.vehicles[i].id === state.vehicleId) return state.vehicles[i];
    }
    return null;
  }
  function lastOdo() {
    var m = null;
    state.fillups.forEach(function (f) { if (m === null || f.odo > m) m = f.odo; });
    var v = currentVehicle();
    if (m === null && v && v.start_odo) m = v.start_odo;
    return m;
  }

  /* ---------- render ---------- */

  var VIEWS = {};

  async function render() {
    $$('#tabs .tab').forEach(function (b) {
      if (b.dataset.view === state.view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    var main = $('#main');
    main.textContent = '';
    CH.hideTip();
    var fab = $('#fab');
    var fabMap = {
      riepilogo: ['Aggiungi rifornimento', openFillup],
      rifornimenti: ['Aggiungi rifornimento', openFillup],
      spese: ['Aggiungi spesa', openExpense],
      promemoria: ['Aggiungi promemoria', openReminder],
      veicoli: ['Aggiungi veicolo', openVehicle]
    };
    var cfg = fabMap[state.view];
    fab.hidden = !cfg;
    if (cfg) {
      fab.setAttribute('aria-label', cfg[0]);
      fab.onclick = function () { cfg[1](); };
    }
    (VIEWS[state.view] || VIEWS.riepilogo)(main);
  }

  function card(title, node) {
    var d = document.createElement('section');
    d.className = 'card';
    if (title) {
      var h = document.createElement('h2');
      h.textContent = title;
      d.appendChild(h);
    }
    if (node) d.appendChild(node);
    return d;
  }

  function emptyP(text) {
    var p = document.createElement('p');
    p.className = 'empty';
    p.textContent = text;
    return p;
  }

  function noVehicle(main) {
    var d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = '<h2>Nessun veicolo</h2><p class="muted">Aggiungi il primo veicolo per iniziare a registrare i rifornimenti.</p>';
    var b = document.createElement('button');
    b.className = 'btn primary';
    b.textContent = 'Aggiungi veicolo';
    b.onclick = function () { openVehicle(); };
    d.appendChild(b);
    main.appendChild(d);
  }

  /* --- Riepilogo --- */

  VIEWS.riepilogo = function (main) {
    if (!state.vehicleId) return noVehicle(main);
    var s = state.stats || {};

    var stats = document.createElement('div');
    stats.className = 'stats';
    function stat(label, value, sub) {
      var d = document.createElement('div');
      d.className = 'stat';
      d.innerHTML = '<div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div>' +
        (sub ? '<div class="sub">' + esc(sub) + '</div>' : '');
      stats.appendChild(d);
    }
    stat('Consumo medio', s.avg_kml ? nfmt(s.avg_kml, 2) + ' km/l' : '—',
         s.avg_l100 ? nfmt(s.avg_l100, 2) + ' L/100 km' : 'servono due pieni completi');
    stat('Costo al km', s.eur_km_total ? nfmt(s.eur_km_total, 3) + ' €/km' : '—',
         s.eur_km_fuel ? 'solo carburante ' + nfmt(s.eur_km_fuel, 3) + ' €/km' : '');
    stat('Km totali', km(s.total_km), s.km_month ? nfmt(s.km_month, 0) + ' km/mese' : '');
    stat('Spesa totale', eur(s.total_cost), 'carburante ' + eur(s.fuel_cost));
    stat('Ultimo prezzo', s.last_price_l ? nfmt(s.last_price_l, 3) + ' €/L' : '—',
         s.avg_price_l ? 'medio ' + nfmt(s.avg_price_l, 3) + ' €/L' : '');
    stat('Rifornimenti', String(s.count_fillups || 0),
         s.last_fillup_date ? 'ultimo ' + dt(s.last_fillup_date) : '');
    main.appendChild(stats);

    /* promemoria urgenti */
    var urgent = state.reminders.filter(function (r) { return !r.done && (r.status === 'scaduto' || r.status === 'in_scadenza'); });
    if (urgent.length) {
      var ul = document.createElement('ul');
      ul.className = 'list';
      urgent.slice(0, 5).forEach(function (r) { ul.appendChild(reminderRow(r)); });
      main.appendChild(card('Promemoria in scadenza', ul));
    }

    /* mini-grafico consumo */
    var pts = consumptionPoints();
    var chartBox = document.createElement('div');
    CH.lineChart(chartBox, pts, {
      unit: 'km/l', decimals: 2, average: s.avg_kml, averageLabel: 'media', seriesName: 'Consumo',
      emptyMessage: 'Servono almeno due pieni completi per calcolare un consumo.'
    });
    main.appendChild(card('Consumo (km/l)', chartBox));

    /* ultimi rifornimenti */
    var last = state.fillups.slice(0, 5);
    var ul2 = document.createElement('ul');
    ul2.className = 'list';
    if (!last.length) ul2.appendChild(emptyP('Nessun rifornimento registrato.'));
    else last.forEach(function (f) { ul2.appendChild(fillupRow(f)); });
    main.appendChild(card('Ultimi rifornimenti', ul2));
  };

  function consumptionPoints() {
    return state.fillups
      .filter(function (f) { return f.kml !== null && f.kml !== undefined; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.odo - b.odo; })
      .map(function (f) {
        return { label: dt(f.date), value: f.kml, tip: dt(f.date) + ' · ' + km(f.odo) + ' · ' + nfmt(f.l100, 2) + ' L/100 km' };
      });
  }

  /* --- Rifornimenti --- */

  function fillupRow(f) {
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'row-btn';
    var badge = f.kml
      ? '<span class="badge ok">' + nfmt(f.kml, 2) + ' km/l</span>'
      : (f.full ? '<span class="badge">pieno</span>' : '<span class="badge">parziale</span>');
    var warn = f.odo_warning ? ' <span class="badge danger">km incoerenti</span>' : '';
    var missed = f.missed ? ' <span class="badge warn">catena interrotta</span>' : '';
    b.innerHTML =
      '<span class="row-main">' +
        '<span class="row-title">' + esc(dt(f.date)) + ' · ' + esc(km(f.odo)) + '</span>' +
        '<span class="row-sub">' + esc(nfmt(f.liters, 2)) + ' L · ' + esc(eur(f.total_cost)) + ' · ' +
        esc(nfmt(f.price_l, 3)) + ' €/L' + (f.station ? ' · ' + esc(f.station) : '') + '</span>' +
      '</span>' +
      '<span class="row-side">' + badge + warn + missed + '</span>';
    b.onclick = function () { openFillup(f); };
    li.appendChild(b);
    return li;
  }

  VIEWS.rifornimenti = function (main) {
    if (!state.vehicleId) return noVehicle(main);
    var ul = document.createElement('ul');
    ul.className = 'list';
    if (!state.fillups.length) {
      main.appendChild(card(null, emptyP('Nessun rifornimento. Tocca + per aggiungerne uno.')));
      return;
    }
    state.fillups.forEach(function (f) { ul.appendChild(fillupRow(f)); });
    main.appendChild(card('Rifornimenti (' + state.fillups.length + ')', ul));
  };

  /* --- Spese --- */

  VIEWS.spese = function (main) {
    if (!state.vehicleId) return noVehicle(main);
    if (!state.expenses.length) {
      main.appendChild(card(null, emptyP('Nessuna spesa registrata. Tocca + per aggiungerne una.')));
      return;
    }
    var totals = {};
    state.expenses.forEach(function (e) { totals[e.category || 'Altro'] = (totals[e.category || 'Altro'] || 0) + Number(e.cost || 0); });
    var keys = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });
    var head = document.createElement('div');
    head.className = 'chart-legend';
    head.innerHTML = keys.map(function (k) {
      return '<span><b>' + esc(k) + '</b> ' + esc(eur(totals[k])) + '</span>';
    }).join('');
    main.appendChild(card('Totali per categoria', head));

    var ul = document.createElement('ul');
    ul.className = 'list';
    state.expenses.forEach(function (e) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'row-btn';
      b.innerHTML =
        '<span class="row-main">' +
          '<span class="row-title">' + esc(e.category || 'Altro') + (e.description ? ' · ' + esc(e.description) : '') + '</span>' +
          '<span class="row-sub">' + esc(dt(e.date)) + (e.odo ? ' · ' + esc(km(e.odo)) : '') +
          (e.vendor ? ' · ' + esc(e.vendor) : '') + '</span>' +
        '</span>' +
        '<span class="row-side"><span class="big">' + esc(eur(e.cost)) + '</span></span>';
      b.onclick = function () { openExpense(e); };
      li.appendChild(b);
      ul.appendChild(li);
    });
    main.appendChild(card('Spese (' + state.expenses.length + ')', ul));
  };

  /* --- Promemoria --- */

  function reminderRow(r) {
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'row-btn';
    var cls = r.status === 'scaduto' ? 'danger' : r.status === 'in_scadenza' ? 'warn' : r.status === 'fatto' ? '' : 'ok';
    var label = r.status === 'scaduto' ? 'scaduto' : r.status === 'in_scadenza' ? 'in scadenza' : r.status === 'fatto' ? 'fatto' : 'ok';
    var parts = [];
    if (r.due_date) parts.push('entro ' + dt(r.due_date));
    if (r.due_odo) parts.push('a ' + km(r.due_odo));
    if (r.km_left !== null && r.km_left !== undefined) parts.push(nfmt(r.km_left, 0) + ' km rimanenti');
    if (r.days_left !== null && r.days_left !== undefined) parts.push(nfmt(Math.round(r.days_left), 0) + ' giorni');
    b.innerHTML =
      '<span class="row-main">' +
        '<span class="row-title">' + esc(r.title) + '</span>' +
        '<span class="row-sub">' + esc(parts.join(' · ') || r.category || '') + '</span>' +
      '</span>' +
      '<span class="row-side"><span class="badge ' + cls + '">' + esc(label) + '</span></span>';
    b.onclick = function () { openReminder(r); };
    li.appendChild(b);
    return li;
  }

  VIEWS.promemoria = function (main) {
    if (!state.vehicleId) return noVehicle(main);
    var open = state.reminders.filter(function (r) { return !r.done; });
    var done = state.reminders.filter(function (r) { return r.done; });
    if (!state.reminders.length) {
      main.appendChild(card(null, emptyP('Nessun promemoria. Tocca + per aggiungerne uno.')));
      return;
    }
    if (open.length) {
      var ul = document.createElement('ul');
      ul.className = 'list';
      open.forEach(function (r) {
        var li = reminderRow(r);
        var btn = document.createElement('button');
        btn.className = 'btn small';
        btn.textContent = 'Fatto';
        btn.onclick = async function (ev) {
          ev.stopPropagation();
          try {
            await api('api/reminders/' + r.id, { method: 'PUT', body: { done: 1, done_odo: lastOdo(), done_date: todayISO() } });
            toast('Promemoria completato');
            await refresh();
          } catch (e) { toast(e.message); }
        };
        li.appendChild(btn);
        ul.appendChild(li);
      });
      main.appendChild(card('Da fare (' + open.length + ')', ul));
    }
    if (done.length) {
      var ul2 = document.createElement('ul');
      ul2.className = 'list';
      done.forEach(function (r) { ul2.appendChild(reminderRow(r)); });
      main.appendChild(card('Completati', ul2));
    }
  };

  /* --- Grafici --- */

  VIEWS.grafici = function (main) {
    if (!state.vehicleId) return noVehicle(main);
    var s = state.stats || {};

    var b1 = document.createElement('div');
    CH.lineChart(b1, consumptionPoints(), {
      unit: 'km/l', decimals: 2, average: s.avg_kml, averageLabel: 'media', seriesName: 'Consumo',
      emptyMessage: 'Servono almeno due pieni completi per calcolare un consumo.'
    });
    main.appendChild(card('Consumo nel tempo (km/l)', b1));

    var pricePts = state.fillups
      .filter(function (f) { return f.price_l; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.odo - b.odo; })
      .map(function (f) {
        return { label: dt(f.date), value: f.price_l, tip: dt(f.date) + (f.station ? ' · ' + f.station : '') };
      });
    var b2 = document.createElement('div');
    CH.lineChart(b2, pricePts, {
      unit: '€/L', decimals: 3, average: s.avg_price_l, averageLabel: 'medio', seriesName: 'Prezzo al litro',
      emptyMessage: 'Nessun prezzo registrato.'
    });
    main.appendChild(card('Prezzo al litro (€/L)', b2));

    var b3 = document.createElement('div');
    CH.barsHorizontal(b3, (s.by_category || []).map(function (c) { return { label: c.category, value: c.cost }; }), {
      unit: '€', ariaLabel: 'Spese per categoria', emptyMessage: 'Nessuna spesa registrata.'
    });
    main.appendChild(card('Spese per categoria (€)', b3));

    var b4 = document.createElement('div');
    CH.barsStacked(b4, (s.monthly || []).map(function (m) { return { label: m.month, a: m.fuel, b: m.other }; }), {
      ariaLabel: 'Costi mensili', emptyMessage: 'Nessun costo registrato.'
    });
    main.appendChild(card('Costi mensili (€)', b4));
  };

  /* --- Veicoli --- */

  VIEWS.veicoli = function (main) {
    if (!state.vehicles.length) return noVehicle(main);
    var ul = document.createElement('ul');
    ul.className = 'list';
    state.vehicles.forEach(function (v) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'row-btn';
      var sub = [v.make, v.model, v.year, v.plate].filter(Boolean).join(' · ');
      b.innerHTML =
        '<span class="row-main">' +
          '<span class="row-title">' + esc(v.name) + (v.archived ? ' <span class="badge">archiviato</span>' : '') + '</span>' +
          '<span class="row-sub">' + esc(sub || v.fuel_type || '') + '</span>' +
        '</span>' +
        '<span class="row-side">' + (v.id === state.vehicleId ? '<span class="badge ok">attivo</span>' : '') + '</span>';
      b.onclick = function () { openVehicle(v); };
      li.appendChild(b);

      if (v.id !== state.vehicleId && !v.archived) {
        var pick = document.createElement('button');
        pick.className = 'btn small';
        pick.textContent = 'Seleziona';
        pick.onclick = async function (ev) {
          ev.stopPropagation();
          selectVehicle(v.id);
        };
        li.appendChild(pick);
      }
      ul.appendChild(li);
    });
    main.appendChild(card('Veicoli (' + state.vehicles.length + ')', ul));
  };

  /* --- Dati --- */

  VIEWS.dati = function (main) {
    var v = currentVehicle();

    /* import CSV */
    var imp = document.createElement('div');
    imp.innerHTML =
      '<p class="muted">Importa un CSV di rifornimenti o spese nel veicolo selezionato. ' +
      'L\'import è sempre additivo: non cancella nulla.</p>' +
      '<div class="grid2">' +
        '<p class="field"><label for="imp-type">Tipo di dati</label><select id="imp-type">' +
          '<option value="fillups">Rifornimenti</option><option value="expenses">Spese</option></select></p>' +
        '<p class="field"><label for="imp-date">Formato data ambiguo</label><select id="imp-date">' +
          '<option value="US">MM/GG/AAAA (Fuelly)</option><option value="EU">GG/MM/AAAA</option></select></p>' +
      '</div>' +
      '<p class="check"><label><input type="checkbox" id="imp-miles"> I chilometraggi sono in miglia</label></p>' +
      '<p class="check"><label><input type="checkbox" id="imp-gallons"> I volumi sono in galloni US</label></p>' +
      '<div class="file-row"><input type="file" id="imp-file" accept=".csv,text/csv,text/plain">' +
      '<button class="btn primary" id="imp-go" type="button">Anteprima</button></div>';
    main.appendChild(card('Import CSV', imp));

    $('#imp-go', imp).onclick = async function () {
      var file = $('#imp-file', imp).files[0];
      if (!file) return toast('Scegli prima un file CSV');
      if (!state.vehicleId) return toast('Seleziona un veicolo');
      var text = await file.text();
      var body = {
        vehicle_id: state.vehicleId,
        csv: text,
        type: $('#imp-type', imp).value,
        date_order: $('#imp-date', imp).value,
        miles: $('#imp-miles', imp).checked,
        gallons: $('#imp-gallons', imp).checked,
        preview: true
      };
      try {
        var res = await api('api/import/csv', { method: 'POST', body: body });
        showImportPreview(body, res);
      } catch (e) { toast(e.message); }
    };

    /* export */
    var exp = document.createElement('div');
    exp.className = 'file-row';
    function dl(label, href) {
      var a = document.createElement('a');
      a.className = 'btn';
      a.textContent = label;
      a.href = href;
      a.setAttribute('download', '');
      return a;
    }
    if (v) {
      exp.appendChild(dl('Esporta rifornimenti CSV', 'api/export/csv?type=fillups&vehicle=' + v.id));
      exp.appendChild(dl('Esporta spese CSV', 'api/export/csv?type=expenses&vehicle=' + v.id));
    }
    exp.appendChild(dl('Backup JSON completo', 'api/export/json'));
    main.appendChild(card('Export e backup', exp));

    /* ripristino */
    var res = document.createElement('div');
    res.innerHTML =
      '<p class="muted">Ripristina un backup JSON. Con "sostituisci" il contenuto attuale viene cancellato.</p>' +
      '<p class="check"><label><input type="checkbox" id="res-replace"> Sostituisci i dati esistenti</label></p>' +
      '<div class="file-row"><input type="file" id="res-file" accept=".json,application/json">' +
      '<button class="btn" id="res-go" type="button">Ripristina</button></div>';
    main.appendChild(card('Ripristino', res));

    $('#res-go', res).onclick = async function () {
      var file = $('#res-file', res).files[0];
      if (!file) return toast('Scegli prima un file JSON');
      var replace = $('#res-replace', res).checked;
      if (replace && !confirm('Sostituire tutti i dati esistenti con il backup? L\'operazione non è reversibile.')) return;
      try {
        var data = JSON.parse(await file.text());
        var out = await api('api/import/json', { method: 'POST', body: { data: data, replace: replace } });
        toast('Ripristinati ' + out.vehicles + ' veicoli, ' + out.fillups + ' rifornimenti');
        await boot(true);
      } catch (e) { toast(e.message); }
    };

    /* info DB */
    var info = document.createElement('div');
    info.className = 'muted';
    info.textContent = 'Caricamento…';
    main.appendChild(card('Informazioni', info));
    api('api/info').then(function (i) {
      info.innerHTML =
        'Database: <code>' + esc(i.db_file) + '</code><br>' +
        'Dimensione: ' + nfmt(i.db_size / 1024, 1) + ' kB · schema v' + i.schema_version + ' · Node ' + esc(i.node) + '<br>' +
        'Veicoli ' + i.counts.vehicles + ' · rifornimenti ' + i.counts.fillups +
        ' · spese ' + i.counts.expenses + ' · promemoria ' + i.counts.reminders;
    }).catch(function () { info.textContent = 'Informazioni non disponibili.'; });
  };

  function showImportPreview(body, res) {
    var dlg = $('#dlg-import');
    $('#import-summary').textContent =
      res.total + ' righe interpretate, ' + res.skipped + ' scartate. Anteprima delle prime ' +
      Math.min(5, res.preview.length) + ':';
    var table = $('#import-table');
    table.textContent = '';
    if (res.preview.length) {
      var cols = Object.keys(res.preview[0]);
      var thead = document.createElement('thead');
      var tr = document.createElement('tr');
      cols.forEach(function (c) { var th = document.createElement('th'); th.textContent = c; tr.appendChild(th); });
      thead.appendChild(tr);
      table.appendChild(thead);
      var tbody = document.createElement('tbody');
      res.preview.forEach(function (r) {
        var t = document.createElement('tr');
        cols.forEach(function (c) {
          var td = document.createElement('td');
          td.textContent = r[c] === null || r[c] === undefined ? '' : String(r[c]);
          t.appendChild(td);
        });
        tbody.appendChild(t);
      });
      table.appendChild(tbody);
    }
    var errs = $('#import-errors');
    errs.textContent = '';
    (res.errors || []).forEach(function (e) {
      var li = document.createElement('li');
      li.textContent = e;
      errs.appendChild(li);
    });
    state.pendingImport = body;
    dlg.showModal();
  }

  /* ---------- dialoghi ---------- */

  function setVal(id, v) {
    var n = document.getElementById(id);
    if (!n) return;
    if (n.type === 'checkbox') n.checked = !!Number(v);
    else n.value = v === null || v === undefined ? '' : String(v);
  }
  function getVal(id) {
    var n = document.getElementById(id);
    if (!n) return null;
    return n.type === 'checkbox' ? (n.checked ? 1 : 0) : n.value.trim();
  }

  function wireDialog(dlgId, onSubmit, onDelete) {
    var dlg = document.getElementById(dlgId);
    var form = dlg.querySelector('form');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      onSubmit(dlg);
    });
    dlg.querySelector('[data-action="cancel"]').onclick = function () { dlg.close(); };
    var del = dlg.querySelector('[data-action="delete"]');
    if (del && onDelete) del.onclick = function () { onDelete(dlg); };
    return dlg;
  }

  /* --- rifornimento --- */

  var editingFillup = null;

  function fillupWarnings() {
    var w = [];
    var v = currentVehicle();
    var odo = numIn(getVal('f-odo'));
    var liters = numIn(getVal('f-liters'));
    var price = numIn(getVal('f-price'));
    var date = getVal('f-date');
    var last = lastOdo();
    if (odo !== null && last !== null && odo <= last && (!editingFillup || editingFillup.odo !== odo)) {
      w.push('I chilometri (' + nfmt(odo, 0) + ') non superano l\'ultimo valore registrato (' + nfmt(last, 0) + ').');
    }
    if (liters !== null && v && v.tank_l && liters > v.tank_l * 1.15) {
      w.push('Litri (' + nfmt(liters, 2) + ') oltre la capacità del serbatoio (' + nfmt(v.tank_l, 0) + ' L).');
    }
    if (price !== null && (price < 0.5 || price > 4)) {
      w.push('Prezzo al litro fuori dall\'intervallo plausibile 0,50–4,00 €/L.');
    }
    if (date && date > todayISO()) w.push('La data è nel futuro.');
    var ul = $('#f-warnings');
    ul.textContent = '';
    w.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
  }

  function syncFillupMoney(source) {
    var liters = numIn(getVal('f-liters'));
    var cost = numIn(getVal('f-cost'));
    var price = numIn(getVal('f-price'));
    if (source === 'price' && liters && price) setVal('f-cost', (Math.round(price * liters * 100) / 100).toString().replace('.', ','));
    else if (liters && cost) setVal('f-price', (Math.round(cost / liters * 1000) / 1000).toString().replace('.', ','));
    else if (liters && price) setVal('f-cost', (Math.round(price * liters * 100) / 100).toString().replace('.', ','));
    fillupWarnings();
  }

  function openFillup(f) {
    if (!state.vehicleId) return toast('Crea prima un veicolo');
    editingFillup = f || null;
    var v = currentVehicle();
    $('#fillup-title').textContent = f ? 'Modifica rifornimento' : 'Nuovo rifornimento';
    setVal('f-date', f ? f.date : todayISO());
    setVal('f-odo', f ? f.odo : (lastOdo() !== null ? lastOdo() : ''));
    setVal('f-liters', f ? f.liters : '');
    setVal('f-cost', f ? f.total_cost : '');
    setVal('f-price', f ? f.price_l : '');
    setVal('f-full', f ? f.full : 1);
    setVal('f-missed', f ? f.missed : 0);
    setVal('f-fuel', f ? f.fuel_type : (v ? v.fuel_type : ''));
    setVal('f-station', f ? f.station : '');
    setVal('f-location', f ? f.location : '');
    setVal('f-notes', f ? f.notes : '');
    $('#dlg-fillup [data-action="delete"]').hidden = !f;
    fillupWarnings();
    $('#dlg-fillup').showModal();
    setTimeout(function () { $('#f-' + (f ? 'date' : 'odo')).focus(); }, 30);
  }

  wireDialog('dlg-fillup', async function (dlg) {
    var body = {
      vehicle_id: state.vehicleId,
      date: getVal('f-date'),
      odo: numIn(getVal('f-odo')),
      liters: numIn(getVal('f-liters')),
      total_cost: numIn(getVal('f-cost')),
      price_l: numIn(getVal('f-price')),
      full: getVal('f-full'),
      missed: getVal('f-missed'),
      fuel_type: getVal('f-fuel'),
      station: getVal('f-station'),
      location: getVal('f-location'),
      notes: getVal('f-notes')
    };
    if (!body.date || body.odo === null || !body.liters) return toast('Data, km e litri sono obbligatori');
    if (body.total_cost === null && body.price_l === null) return toast('Serve il costo totale o il prezzo al litro');
    try {
      if (editingFillup) await api('api/fillups/' + editingFillup.id, { method: 'PUT', body: body });
      else await api('api/fillups', { method: 'POST', body: body });
      dlg.close();
      toast(editingFillup ? 'Rifornimento aggiornato' : 'Rifornimento salvato');
      await refresh();
    } catch (e) { toast(e.message); }
  }, async function (dlg) {
    if (!editingFillup || !confirm('Eliminare questo rifornimento?')) return;
    try {
      await api('api/fillups/' + editingFillup.id, { method: 'DELETE' });
      dlg.close();
      toast('Rifornimento eliminato');
      await refresh();
    } catch (e) { toast(e.message); }
  });

  /* --- spesa --- */

  var editingExpense = null;

  function openExpense(e) {
    if (!state.vehicleId) return toast('Crea prima un veicolo');
    editingExpense = e || null;
    $('#expense-title').textContent = e ? 'Modifica spesa' : 'Nuova spesa';
    setVal('e-date', e ? e.date : todayISO());
    setVal('e-odo', e ? e.odo : (lastOdo() !== null ? lastOdo() : ''));
    setVal('e-category', e ? e.category : 'Manutenzione');
    setVal('e-cost', e ? e.cost : '');
    setVal('e-description', e ? e.description : '');
    setVal('e-vendor', e ? e.vendor : '');
    setVal('e-notes', e ? e.notes : '');
    $('#dlg-expense [data-action="delete"]').hidden = !e;
    $('#dlg-expense').showModal();
    setTimeout(function () { $('#e-category').focus(); }, 30);
  }

  wireDialog('dlg-expense', async function (dlg) {
    var body = {
      vehicle_id: state.vehicleId,
      date: getVal('e-date'),
      odo: numIn(getVal('e-odo')),
      category: getVal('e-category') || 'Altro',
      cost: numIn(getVal('e-cost')),
      description: getVal('e-description'),
      vendor: getVal('e-vendor'),
      notes: getVal('e-notes')
    };
    if (!body.date || body.cost === null) return toast('Data e costo sono obbligatori');
    try {
      if (editingExpense) await api('api/expenses/' + editingExpense.id, { method: 'PUT', body: body });
      else await api('api/expenses', { method: 'POST', body: body });
      dlg.close();
      toast('Spesa salvata');
      await refresh();
    } catch (e) { toast(e.message); }
  }, async function (dlg) {
    if (!editingExpense || !confirm('Eliminare questa spesa?')) return;
    try {
      await api('api/expenses/' + editingExpense.id, { method: 'DELETE' });
      dlg.close();
      toast('Spesa eliminata');
      await refresh();
    } catch (e) { toast(e.message); }
  });

  /* --- promemoria --- */

  var editingReminder = null;

  function openReminder(r) {
    if (!state.vehicleId) return toast('Crea prima un veicolo');
    editingReminder = r || null;
    $('#reminder-title').textContent = r ? 'Modifica promemoria' : 'Nuovo promemoria';
    setVal('r-title', r ? r.title : '');
    setVal('r-category', r ? r.category : 'Manutenzione');
    setVal('r-due-date', r && r.due_date ? String(r.due_date).slice(0, 10) : '');
    setVal('r-due-odo', r ? r.due_odo : '');
    setVal('r-every-months', r ? r.every_months : '');
    setVal('r-every-km', r ? r.every_km : '');
    setVal('r-notes', r ? r.notes : '');
    $('#dlg-reminder [data-action="delete"]').hidden = !r;
    $('#dlg-reminder').showModal();
    setTimeout(function () { $('#r-title').focus(); }, 30);
  }

  wireDialog('dlg-reminder', async function (dlg) {
    var body = {
      vehicle_id: state.vehicleId,
      title: getVal('r-title'),
      category: getVal('r-category'),
      due_date: getVal('r-due-date') || null,
      due_odo: numIn(getVal('r-due-odo')),
      every_months: numIn(getVal('r-every-months')),
      every_km: numIn(getVal('r-every-km')),
      notes: getVal('r-notes')
    };
    if (!body.title) return toast('Il titolo è obbligatorio');
    if (!body.due_date && body.due_odo === null) return toast('Serve una scadenza a data o a chilometri');
    try {
      if (editingReminder) await api('api/reminders/' + editingReminder.id, { method: 'PUT', body: body });
      else await api('api/reminders', { method: 'POST', body: body });
      dlg.close();
      toast('Promemoria salvato');
      await refresh();
    } catch (e) { toast(e.message); }
  }, async function (dlg) {
    if (!editingReminder || !confirm('Eliminare questo promemoria?')) return;
    try {
      await api('api/reminders/' + editingReminder.id, { method: 'DELETE' });
      dlg.close();
      toast('Promemoria eliminato');
      await refresh();
    } catch (e) { toast(e.message); }
  });

  /* --- veicolo --- */

  var editingVehicle = null;

  function openVehicle(v) {
    editingVehicle = v || null;
    $('#vehicle-title').textContent = v ? 'Modifica veicolo' : 'Nuovo veicolo';
    setVal('v-name', v ? v.name : '');
    setVal('v-make', v ? v.make : '');
    setVal('v-model', v ? v.model : '');
    setVal('v-year', v ? v.year : '');
    setVal('v-plate', v ? v.plate : '');
    setVal('v-fuel', v ? v.fuel_type : 'Benzina');
    setVal('v-tank', v ? v.tank_l : '');
    setVal('v-start', v ? v.start_odo : '');
    setVal('v-archived', v ? v.archived : 0);
    setVal('v-notes', v ? v.notes : '');
    $('#dlg-vehicle [data-action="delete"]').hidden = !v;
    $('#dlg-vehicle').showModal();
    setTimeout(function () { $('#v-name').focus(); }, 30);
  }

  wireDialog('dlg-vehicle', async function (dlg) {
    var body = {
      name: getVal('v-name'),
      make: getVal('v-make'),
      model: getVal('v-model'),
      year: numIn(getVal('v-year')),
      plate: getVal('v-plate'),
      fuel_type: getVal('v-fuel'),
      tank_l: numIn(getVal('v-tank')),
      start_odo: numIn(getVal('v-start')) || 0,
      archived: getVal('v-archived'),
      notes: getVal('v-notes')
    };
    if (!body.name) return toast('Il nome è obbligatorio');
    try {
      var created;
      if (editingVehicle) await api('api/vehicles/' + editingVehicle.id, { method: 'PUT', body: body });
      else created = await api('api/vehicles', { method: 'POST', body: body });
      dlg.close();
      toast('Veicolo salvato');
      if (created) PREF.set('vehicle', created.id);
      await boot(true);
    } catch (e) { toast(e.message); }
  }, async function (dlg) {
    if (!editingVehicle) return;
    if (!confirm('Eliminare "' + editingVehicle.name + '" con tutti i suoi rifornimenti, spese e promemoria?')) return;
    try {
      await api('api/vehicles/' + editingVehicle.id, { method: 'DELETE' });
      dlg.close();
      toast('Veicolo eliminato');
      PREF.set('vehicle', '0');
      await boot(true);
    } catch (e) { toast(e.message); }
  });

  /* --- import (conferma) --- */

  wireDialog('dlg-import', async function (dlg) {
    var body = state.pendingImport;
    if (!body) return dlg.close();
    body.preview = false;
    try {
      var res = await api('api/import/csv', { method: 'POST', body: body });
      dlg.close();
      toast('Importate ' + res.imported + ' righe (' + res.skipped + ' scartate)');
      state.pendingImport = null;
      await refresh();
    } catch (e) { toast(e.message); }
  });

  /* ---------- eventi globali ---------- */

  async function refresh() {
    try {
      await loadVehicleData();
      await render();
    } catch (e) {
      if (e.message !== 'Non autenticato') toast(e.message);
    }
  }

  function selectVehicle(id) {
    state.vehicleId = Number(id);
    PREF.set('vehicle', state.vehicleId);
    $('#vehicle-select').value = String(state.vehicleId);
    refresh();
  }

  function initEvents() {
    $('#vehicle-select').addEventListener('change', function () { selectVehicle(this.value); });
    $('#theme-toggle').addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      if (state.view === 'grafici' || state.view === 'riepilogo') render();
    });
    $('#tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('.tab');
      if (!b) return;
      state.view = b.dataset.view;
      PREF.set('view', state.view);
      render();
    });
    ['f-liters', 'f-cost'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () { syncFillupMoney('cost'); });
    });
    document.getElementById('f-price').addEventListener('input', function () { syncFillupMoney('price'); });
    ['f-odo', 'f-date'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', fillupWarnings);
    });

    $('#login-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var err = $('#login-error');
      err.hidden = true;
      try {
        await api('api/auth/login', { method: 'POST', body: { password: $('#login-password').value } });
        $('#login-password').value = '';
        await boot(true);
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      }
    });

    /* scorciatoia: apre il form dal manifest shortcut (#new-fillup) */
    window.addEventListener('hashchange', handleHash);
  }

  function handleHash() {
    if (location.hash === '#new-fillup') {
      history.replaceState(null, '', location.pathname + location.search);
      if (state.vehicleId) openFillup();
    }
  }

  /* ---------- avvio ---------- */

  async function boot(skipAuth) {
    try {
      if (!skipAuth) {
        var st = await api('api/auth/status');
        if (st.required && !st.authed) return showLogin();
      }
      showApp();
      await loadVehicles();
      await loadVehicleData();
      var savedView = PREF.get('view', 'riepilogo');
      if (VIEWS[savedView]) state.view = savedView;
      await render();
      handleHash();
    } catch (e) {
      if (e.message === 'Non autenticato') return;
      showApp();
      await render();
      toast(e.message);
    }
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    var ok = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!ok) return;
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () { /* silenzioso */ });
  }

  initTheme();
  initEvents();
  boot();
  registerSW();
})();
