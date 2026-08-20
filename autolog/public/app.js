/*
 * AutoLog — stato, viste e form. JS vanilla, nessun build step.
 * Tutti gli URL sono relativi: l'app deve funzionare anche sotto l'Ingress
 * di Home Assistant (/api/hassio_ingress/<token>/).
 */
(function () {
  'use strict';

  var C = window.AutoLogCalc;
  var CH = window.AutoLogCharts;
  var I = window.AutoLogI18n;
  var U = window.AutoLogUnits;
  var t = I.t;

  /* Impostazioni di unità correnti; il database resta sempre metrico. */
  var UN = { system: 'metric', currency: 'EUR', symbol: '€', distance: 'km', volume: 'L', consumption: 'km/L' };
  function uDist(km) { return U.distanceFromKm(km, UN.system); }
  function uVol(l) { return U.volumeFromLiters(l, UN.system); }
  function uCons(kml) { return U.consumptionFromKml(kml, UN.system); }
  function inDist(v) { return U.distanceToKm(v, UN.system); }
  function inVol(v) { return U.volumeToLiters(v, UN.system); }

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
    pendingImport: null,
    lang: { locale: null, explicit: null, detected: null, available: [] }
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- formattazione ---------- */

  function nfmt(n, d) { return I.num(n, d); }
  function eur(n, d) { return I.money(n, UN.currency, d === undefined ? 2 : d); }
  function km(n) { return n === null || n === undefined ? '—' : nfmt(uDist(n), 0) + ' ' + UN.distance; }
  function vol(n) { return n === null || n === undefined ? '—' : nfmt(uVol(n), 2) + ' ' + UN.volume; }
  function cons(kml) { return kml === null || kml === undefined ? '—' : nfmt(uCons(kml), 2) + ' ' + UN.consumption; }
  function dt(iso) { return I.date(iso); }
  function CUR() { return UN.symbol; }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /* Accetta la virgola decimale italiana nei campi numerici. */
  function round(n, d) {
    if (n === null || n === undefined || !isFinite(n)) return '';
    var f = Math.pow(10, d);
    return String(Math.round(n * f) / f).replace('.', ',');
  }
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

  var UNAUTH = 'unauthenticated';
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
    catch (e) { setOffline(true); throw new Error(t('msg.unreachable')); }
    setOffline(false);
    if (res.status === 401) { showLogin(); throw new Error(UNAUTH); }
    var ct = res.headers.get('content-type') || '';
    var data = ct.indexOf('application/json') >= 0 ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || t('msg.error', { code: res.status }));
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

  /* ---------- lingua ---------- */

  /*
   * Ordine di precedenza: scelta esplicita dell'utente HA (salvata sul server),
   * poi Accept-Language, poi la lingua del browser, infine la lingua di riserva.
   * Il server conosce l'utente grazie all'header X-Remote-User-Id dell'Ingress.
   */
  async function loadUnits() {
    try {
      UN = await api('api/settings/units');
    } catch (e) { /* si resta sui default metrici */ }
    translateStatic();
  }

  async function loadLocale() {
    var fallback = I.negotiate(navigator.language + ',' + (navigator.languages || []).join(',')) || I.FALLBACK;
    try {
      var info = await api('api/lang');
      state.lang = info;
      applyLocale(info.locale, info);
    } catch (e) {
      state.lang = { locale: fallback, explicit: null, detected: fallback, available: I.LOCALES.map(function (c) {
        return { code: c, name: I.NAMES[c] };
      }) };
      applyLocale(fallback, state.lang);
    }
  }

  function applyLocale(code, info) {
    I.setLocale(code);
    if (info) state.lang = Object.assign({}, state.lang, info, { locale: I.getLocale() });
    document.documentElement.setAttribute('lang', I.getLocale());
    translateStatic();
    fillDatalists();
  }

  /* Traduce tutto ciò che in index.html porta una marcatura data-i18n. */
  function translateStatic() {
    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-aria-label]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });
    $$('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    /* Etichette che dipendono da valuta o unità: vanno tradotte con i parametri,
       dopo il passaggio generico qui sopra che le lascerebbe con i segnaposto. */
    var params = {
      'f-cost': ['field.totalCost', { cur: CUR() }],
      'e-cost': ['field.cost', { cur: CUR() }],
      'f-price': ['field.pricePerLiter', { cur: CUR(), unit: UN.volume }],
      'f-odo': ['field.odo', { unit: UN.distance }],
      'e-odo': ['field.odo', { unit: UN.distance }],
      'f-liters': ['field.liters', { unit: UN.volume }],
      'v-tank': ['field.tank', { unit: UN.volume }],
      'v-start': ['field.startOdo', { unit: UN.distance }],
      'r-due-odo': ['field.dueOdo', { unit: UN.distance }],
      'r-every-km': ['field.everyKm', { unit: UN.distance }]
    };
    Object.keys(params).forEach(function (id) {
      var lab = document.querySelector('label[for="' + id + '"]');
      if (lab) lab.textContent = t(params[id][0], params[id][1]);
    });
  }

  /*
   * Le categorie e i tipi di carburante sono testo libero salvato nel database:
   * qui si traducono solo i suggerimenti per le nuove voci. I valori già
   * registrati restano nella lingua in cui sono stati scritti.
   */
  var CATEGORY_KEYS = ['category.maintenance', 'category.service', 'category.tyres', 'category.insurance',
    'category.tax', 'category.inspection', 'category.repair', 'category.fine', 'category.toll',
    'category.parking', 'category.wash', 'category.accessories', 'category.other'];
  var FUEL_KEYS = ['fuel.petrol', 'fuel.diesel', 'fuel.lpg', 'fuel.cng', 'fuel.electric', 'fuel.hybrid'];

  function fillDatalists() {
    function fill(id, keys) {
      var dl = document.getElementById(id);
      if (!dl) return;
      dl.textContent = '';
      keys.forEach(function (k) {
        var o = document.createElement('option');
        o.value = t(k);
        dl.appendChild(o);
      });
    }
    fill('category-list', CATEGORY_KEYS);
    fill('fuel-list', FUEL_KEYS);
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
      riepilogo: [t('action.addFillup'), openFillup],
      rifornimenti: [t('action.addFillup'), openFillup],
      spese: [t('action.addExpense'), openExpense],
      promemoria: [t('action.addReminder'), openReminder],
      veicoli: [t('action.addVehicle'), openVehicle]
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
    d.innerHTML = '<h2>' + esc(t('empty.noVehicle')) + '</h2><p class="muted">' +
      esc(t('empty.noVehicle.hint')) + '</p>';
    var b = document.createElement('button');
    b.className = 'btn primary';
    b.textContent = t('action.addVehicle');
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
    var sec = U.secondaryConsumption(s.avg_l100, UN.system);
    var perDist = function (v) { return nfmt(U.costPerDistanceFromKm(v, UN.system), 3) + ' ' + CUR() + '/' + UN.distance; };
    var perVol = function (v) { return nfmt(U.pricePerVolumeFromLiter(v, UN.system), 3) + ' ' + CUR() + '/' + UN.volume; };

    stat(t('stat.consumption'), s.avg_kml ? cons(s.avg_kml) : '—',
         sec ? nfmt(sec.value, 2) + ' ' + sec.unit : t('stat.consumption.hint'));
    stat(t('stat.costkm', { unit: UN.distance }), s.eur_km_total ? perDist(s.eur_km_total) : '—',
         s.eur_km_fuel ? t('stat.costkm.fuel', { v: perDist(s.eur_km_fuel) }) : '');
    stat(t('stat.distance'), km(s.total_km),
         s.km_month ? t('stat.distance.month', { v: nfmt(uDist(s.km_month), 0), unit: UN.distance }) : '');
    stat(t('stat.spend'), eur(s.total_cost), t('stat.spend.fuel', { v: eur(s.fuel_cost) }));
    stat(t('stat.lastprice'), s.last_price_l ? perVol(s.last_price_l) : '—',
         s.avg_price_l ? t('stat.avgprice', { v: perVol(s.avg_price_l) }) : '');
    stat(t('stat.fillups'), String(s.count_fillups || 0),
         s.last_fillup_date ? t('stat.lastfillup', { v: dt(s.last_fillup_date) }) : '');
    main.appendChild(stats);

    /* promemoria urgenti */
    var urgent = state.reminders.filter(function (r) { return !r.done && (r.status === 'scaduto' || r.status === 'in_scadenza'); });
    if (urgent.length) {
      var ul = document.createElement('ul');
      ul.className = 'list';
      urgent.slice(0, 5).forEach(function (r) { ul.appendChild(reminderRow(r)); });
      main.appendChild(card(t('section.dueReminders'), ul));
    }

    /* mini-grafico consumo */
    var pts = consumptionPoints();
    var chartBox = document.createElement('div');
    CH.lineChart(chartBox, pts, {
      unit: UN.consumption, decimals: 2, average: uCons(s.avg_kml),
      averageLabel: t('chart.average'), seriesName: t('chart.series.consumption'),
      emptyMessage: t('chart.empty.consumption')
    });
    main.appendChild(card(t('chart.consumption', { unit: UN.consumption }), chartBox));

    /* ultimi rifornimenti */
    var last = state.fillups.slice(0, 5);
    var ul2 = document.createElement('ul');
    ul2.className = 'list';
    if (!last.length) ul2.appendChild(emptyP(t('empty.fillupsShort')));
    else last.forEach(function (f) { ul2.appendChild(fillupRow(f)); });
    main.appendChild(card(t('section.lastFillups'), ul2));
  };

  function consumptionPoints() {
    return state.fillups
      .filter(function (f) { return f.kml !== null && f.kml !== undefined; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.odo - b.odo; })
      .map(function (f) {
        var sec2 = U.secondaryConsumption(f.l100, UN.system);
        return {
          label: dt(f.date), value: uCons(f.kml),
          tip: dt(f.date) + ' · ' + km(f.odo) + (sec2 ? ' · ' + nfmt(sec2.value, 2) + ' ' + sec2.unit : '')
        };
      });
  }

  /* --- Rifornimenti --- */

  function fillupRow(f) {
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'row-btn';
    var badge = f.kml
      ? '<span class="badge ok">' + esc(cons(f.kml)) + '</span>'
      : '<span class="badge">' + esc(t(f.full ? 'badge.full' : 'badge.partial')) + '</span>';
    var warn = f.odo_warning ? ' <span class="badge danger">' + esc(t('badge.odoWarning')) + '</span>' : '';
    var missed = f.missed ? ' <span class="badge warn">' + esc(t('badge.chainBroken')) + '</span>' : '';
    b.innerHTML =
      '<span class="row-main">' +
        '<span class="row-title">' + esc(dt(f.date)) + ' · ' + esc(km(f.odo)) + '</span>' +
        '<span class="row-sub">' + esc(vol(f.liters)) + ' · ' + esc(eur(f.total_cost)) + ' · ' +
        esc(nfmt(U.pricePerVolumeFromLiter(f.price_l, UN.system), 3) + ' ' + CUR() + '/' + UN.volume) +
        (f.station ? ' · ' + esc(f.station) : '') + '</span>' +
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
      main.appendChild(card(null, emptyP(t('empty.fillups'))));
      return;
    }
    state.fillups.forEach(function (f) { ul.appendChild(fillupRow(f)); });
    main.appendChild(card(t('section.fillups', { n: state.fillups.length }), ul));
  };

  /* --- Spese --- */

  VIEWS.spese = function (main) {
    if (!state.vehicleId) return noVehicle(main);
    if (!state.expenses.length) {
      main.appendChild(card(null, emptyP(t('empty.expenses'))));
      return;
    }
    var totals = {};
    state.expenses.forEach(function (e) { var cat = e.category || t('category.other');
      totals[cat] = (totals[cat] || 0) + Number(e.cost || 0); });
    var keys = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });
    var head = document.createElement('div');
    head.className = 'chart-legend';
    head.innerHTML = keys.map(function (k) {
      return '<span><b>' + esc(k) + '</b> ' + esc(eur(totals[k])) + '</span>';
    }).join('');
    main.appendChild(card(t('section.byCategory'), head));

    var ul = document.createElement('ul');
    ul.className = 'list';
    state.expenses.forEach(function (e) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'row-btn';
      b.innerHTML =
        '<span class="row-main">' +
          '<span class="row-title">' + esc(e.category || t('category.other')) + (e.description ? ' · ' + esc(e.description) : '') + '</span>' +
          '<span class="row-sub">' + esc(dt(e.date)) + (e.odo ? ' · ' + esc(km(e.odo)) : '') +
          (e.vendor ? ' · ' + esc(e.vendor) : '') + '</span>' +
        '</span>' +
        '<span class="row-side"><span class="big">' + esc(eur(e.cost)) + '</span></span>';
      b.onclick = function () { openExpense(e); };
      li.appendChild(b);
      ul.appendChild(li);
    });
    main.appendChild(card(t('section.expenses', { n: state.expenses.length }), ul));
  };

  /* --- Promemoria --- */

  function reminderRow(r) {
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'row-btn';
    var cls = r.status === 'scaduto' ? 'danger' : r.status === 'in_scadenza' ? 'warn' : r.status === 'fatto' ? '' : 'ok';
    var label = t(r.status === 'scaduto' ? 'badge.overdue' :
                  r.status === 'in_scadenza' ? 'badge.dueSoon' :
                  r.status === 'fatto' ? 'badge.done' : 'badge.ok');
    var parts = [];
    if (r.due_date) parts.push(t('reminder.byDate', { v: dt(r.due_date) }));
    if (r.due_odo) parts.push(t('reminder.byOdo', { v: km(r.due_odo) }));
    if (r.km_left !== null && r.km_left !== undefined) parts.push(t('reminder.kmLeft', { v: nfmt(uDist(r.km_left), 0), unit: UN.distance }));
    if (r.days_left !== null && r.days_left !== undefined) parts.push(t('reminder.daysLeft', { v: nfmt(Math.round(r.days_left), 0) }));
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
      main.appendChild(card(null, emptyP(t('empty.reminders'))));
      return;
    }
    if (open.length) {
      var ul = document.createElement('ul');
      ul.className = 'list';
      open.forEach(function (r) {
        var li = reminderRow(r);
        var btn = document.createElement('button');
        btn.className = 'btn small';
        btn.textContent = t('action.done');
        btn.onclick = async function (ev) {
          ev.stopPropagation();
          try {
            await api('api/reminders/' + r.id, { method: 'PUT', body: { done: 1, done_odo: lastOdo(), done_date: todayISO() } });
            toast(t('msg.doneReminder'));
            await refresh();
          } catch (e) { toast(e.message); }
        };
        li.appendChild(btn);
        ul.appendChild(li);
      });
      main.appendChild(card(t('section.todo', { n: open.length }), ul));
    }
    if (done.length) {
      var ul2 = document.createElement('ul');
      ul2.className = 'list';
      done.forEach(function (r) { ul2.appendChild(reminderRow(r)); });
      main.appendChild(card(t('section.done'), ul2));
    }
  };

  /* --- Grafici --- */

  VIEWS.grafici = function (main) {
    if (!state.vehicleId) return noVehicle(main);
    var s = state.stats || {};

    var b1 = document.createElement('div');
    CH.lineChart(b1, consumptionPoints(), {
      unit: UN.consumption, decimals: 2, average: uCons(s.avg_kml),
      averageLabel: t('chart.average'), seriesName: t('chart.series.consumption'),
      emptyMessage: t('chart.empty.consumption')
    });
    main.appendChild(card(t('chart.consumptionOverTime', { unit: UN.consumption }), b1));

    var pricePts = state.fillups
      .filter(function (f) { return f.price_l; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.odo - b.odo; })
      .map(function (f) {
        return { label: dt(f.date), value: U.pricePerVolumeFromLiter(f.price_l, UN.system), tip: dt(f.date) + (f.station ? ' · ' + f.station : '') };
      });
    var b2 = document.createElement('div');
    CH.lineChart(b2, pricePts, {
      unit: CUR() + '/' + UN.volume, decimals: 3, average: U.pricePerVolumeFromLiter(s.avg_price_l, UN.system),
      averageLabel: t('chart.averagePrice'), seriesName: t('chart.price', { cur: CUR(), unit: UN.volume }),
      emptyMessage: t('chart.empty.price')
    });
    main.appendChild(card(t('chart.price', { cur: CUR(), unit: UN.volume }), b2));

    var b3 = document.createElement('div');
    CH.barsHorizontal(b3, (s.by_category || []).map(function (c) { return { label: c.category, value: c.cost }; }), {
      currency: UN.currency, ariaLabel: t('chart.byCategory', { cur: CUR() }), emptyMessage: t('chart.empty.category')
    });
    main.appendChild(card(t('chart.byCategory', { cur: CUR() }), b3));

    var b4 = document.createElement('div');
    CH.barsStacked(b4, (s.monthly || []).map(function (m) { return { label: m.month, a: m.fuel, b: m.other }; }), {
      currency: UN.currency, ariaLabel: t('chart.monthly', { cur: CUR() }), emptyMessage: t('chart.empty.monthly')
    });
    main.appendChild(card(t('chart.monthly', { cur: CUR() }), b4));
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
          '<span class="row-title">' + esc(v.name) + (v.archived ? ' <span class="badge">' + esc(t('badge.archived')) + '</span>' : '') + '</span>' +
          '<span class="row-sub">' + esc(sub || v.fuel_type || '') + '</span>' +
        '</span>' +
        '<span class="row-side">' + (v.id === state.vehicleId ? '<span class="badge ok">' + esc(t('badge.active')) + '</span>' : '') + '</span>';
      b.onclick = function () { openVehicle(v); };
      li.appendChild(b);

      if (v.id !== state.vehicleId && !v.archived) {
        var pick = document.createElement('button');
        pick.className = 'btn small';
        pick.textContent = t('action.select');
        pick.onclick = async function (ev) {
          ev.stopPropagation();
          selectVehicle(v.id);
        };
        li.appendChild(pick);
      }
      ul.appendChild(li);
    });
    main.appendChild(card(t('section.vehicles', { n: state.vehicles.length }), ul));
  };

  /* --- Dati --- */

  VIEWS.dati = function (main) {
    var v = currentVehicle();

    /* lingua */
    var lang = document.createElement('div');
    var opts = [{ code: '', name: t('data.language.auto', { v: I.NAMES[state.lang.detected] || state.lang.detected || '—' }) }]
      .concat(state.lang.available || []);
    lang.innerHTML =
      '<p class="muted">' + esc(t('data.language.hint')) + '</p>' +
      '<p class="field"><label for="lang-select">' + esc(t('data.language')) + '</label>' +
      '<select id="lang-select">' +
      opts.map(function (o) {
        var sel = (state.lang.explicit || '') === o.code ? ' selected' : '';
        return '<option value="' + esc(o.code) + '"' + sel + '>' + esc(o.name) + '</option>';
      }).join('') + '</select></p>';
    main.appendChild(card(t('data.language'), lang));

    $('#lang-select', lang).onchange = async function () {
      try {
        var out = await api('api/lang', { method: 'PUT', body: { locale: this.value || null } });
        await applyLocale(out.locale, out);
        await render();
      } catch (e) { toast(e.message); }
    };

    /* unità e valuta */
    var un = document.createElement('div');
    un.innerHTML =
      '<p class="muted">' + esc(t('data.units.hint')) + '</p>' +
      '<div class="grid2">' +
      '<p class="field"><label for="unit-system">' + esc(t('data.units.system')) + '</label><select id="unit-system">' +
      (UN.systems || U.SYSTEMS).map(function (sys) {
        return '<option value="' + sys + '"' + (UN.system === sys ? ' selected' : '') + '>' +
          esc(t('units.' + sys)) + '</option>';
      }).join('') + '</select></p>' +
      '<p class="field"><label for="unit-currency">' + esc(t('data.units.currency')) + '</label><select id="unit-currency">' +
      (UN.currencies || Object.keys(U.CURRENCIES)).map(function (c) {
        return '<option value="' + c + '"' + (UN.currency === c ? ' selected' : '') + '>' +
          esc(c + ' ' + U.currencySymbol(c)) + '</option>';
      }).join('') + '</select></p>' +
      '</div>';
    main.appendChild(card(t('data.units'), un));

    async function saveUnits() {
      try {
        UN = await api('api/settings/units', { method: 'PUT', body: {
          system: $('#unit-system', un).value,
          currency: $('#unit-currency', un).value
        } });
        translateStatic();
        await render();
      } catch (e) { toast(e.message); }
    }
    $('#unit-system', un).onchange = saveUnits;
    $('#unit-currency', un).onchange = saveUnits;

    /* import CSV */
    var imp = document.createElement('div');
    imp.innerHTML =
      '<p class="muted">' + esc(t('data.import.hint')) + '</p>' +
      '<div class="grid2">' +
        '<p class="field"><label for="imp-type">' + esc(t('data.import.type')) + '</label><select id="imp-type">' +
          '<option value="fillups">' + esc(t('nav.fillups')) + '</option>' +
          '<option value="expenses">' + esc(t('nav.expenses')) + '</option></select></p>' +
        '<p class="field"><label for="imp-date">' + esc(t('data.import.dateFormat')) + '</label><select id="imp-date">' +
          '<option value="US">MM/DD/YYYY (Fuelly)</option><option value="EU">DD/MM/YYYY</option></select></p>' +
      '</div>' +
      '<p class="check"><label><input type="checkbox" id="imp-miles"> ' + esc(t('data.import.miles')) + '</label></p>' +
      '<p class="check"><label><input type="checkbox" id="imp-gallons"> ' + esc(t('data.import.gallons')) + '</label></p>' +
      '<div class="file-row"><input type="file" id="imp-file" accept=".csv,text/csv,text/plain">' +
      '<button class="btn primary" id="imp-go" type="button">' + esc(t('action.preview')) + '</button></div>';
    main.appendChild(card(t('data.import'), imp));

    $('#imp-go', imp).onclick = async function () {
      var file = $('#imp-file', imp).files[0];
      if (!file) return toast(t('msg.chooseCsv'));
      if (!state.vehicleId) return toast(t('msg.selectVehicle'));
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
      exp.appendChild(dl(t('data.export.fillups'), 'api/export/csv?type=fillups&vehicle=' + v.id));
      exp.appendChild(dl(t('data.export.expenses'), 'api/export/csv?type=expenses&vehicle=' + v.id));
    }
    exp.appendChild(dl(t('data.export.json'), 'api/export/json'));
    main.appendChild(card(t('data.export'), exp));

    /* ripristino */
    var res = document.createElement('div');
    res.innerHTML =
      '<p class="muted">' + esc(t('data.restore.hint')) + '</p>' +
      '<p class="check"><label><input type="checkbox" id="res-replace"> ' + esc(t('data.restore.replace')) + '</label></p>' +
      '<div class="file-row"><input type="file" id="res-file" accept=".json,application/json">' +
      '<button class="btn" id="res-go" type="button">' + esc(t('action.restore')) + '</button></div>';
    main.appendChild(card(t('data.restore'), res));

    $('#res-go', res).onclick = async function () {
      var file = $('#res-file', res).files[0];
      if (!file) return toast(t('msg.chooseJson'));
      var replace = $('#res-replace', res).checked;
      if (replace && !confirm(t('confirm.replace'))) return;
      try {
        var data = JSON.parse(await file.text());
        var out = await api('api/import/json', { method: 'POST', body: { data: data, replace: replace } });
        toast(t('msg.restored', { v: out.vehicles, f: out.fillups }));
        await boot(true);
      } catch (e) { toast(e.message); }
    };

    /* info DB */
    var info = document.createElement('div');
    info.className = 'muted';
    info.textContent = t('app.loading');
    main.appendChild(card(t('data.info'), info));
    api('api/info').then(function (i) {
      info.innerHTML =
        'Database: <code>' + esc(i.db_file) + '</code><br>' +
        nfmt(i.db_size / 1024, 1) + ' kB · schema v' + i.schema_version + ' · Node ' + esc(i.node) + '<br>' +
        esc(t('nav.vehicles')) + ' ' + i.counts.vehicles + ' · ' +
        esc(t('nav.fillups')) + ' ' + i.counts.fillups + ' · ' +
        esc(t('nav.expenses')) + ' ' + i.counts.expenses + ' · ' +
        esc(t('nav.reminders')) + ' ' + i.counts.reminders;
    }).catch(function () { info.textContent = t('data.info.unavailable'); });
  };

  function showImportPreview(body, res) {
    var dlg = $('#dlg-import');
    $('#import-summary').textContent = t('import.summary', {
      total: res.total, skipped: res.skipped, n: Math.min(5, res.preview.length)
    });
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
    var odo = inDist(numIn(getVal('f-odo')));
    var liters = inVol(numIn(getVal('f-liters')));
    var price = U.pricePerVolumeToLiter(numIn(getVal('f-price')), UN.system);
    var date = getVal('f-date');
    var last = lastOdo();
    if (odo !== null && last !== null && odo <= last && (!editingFillup || editingFillup.odo !== odo)) {
      w.push(t('warn.odoNotHigher', { v: nfmt(uDist(odo), 0), last: nfmt(uDist(last), 0) }));
    }
    if (liters !== null && v && v.tank_l && liters > v.tank_l * 1.15) {
      w.push(t('warn.tooManyLiters', { v: vol(liters), tank: vol(v.tank_l) }));
    }
    if (price !== null && (price < 0.5 || price > 4)) {
      w.push(t('warn.priceRange', {
        min: nfmt(U.pricePerVolumeFromLiter(0.5, UN.system), 2) + ' ' + CUR() + '/' + UN.volume,
        max: nfmt(U.pricePerVolumeFromLiter(4, UN.system), 2) + ' ' + CUR() + '/' + UN.volume
      }));
    }
    if (date && date > todayISO()) w.push(t('warn.futureDate'));
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
    if (!state.vehicleId) return toast(t('msg.needVehicle'));
    editingFillup = f || null;
    var v = currentVehicle();
    $('#fillup-title').textContent = t(f ? 'title.editFillup' : 'title.newFillup');
    setVal('f-date', f ? f.date : todayISO());
    setVal('f-odo', f ? round(uDist(f.odo), 1) : (lastOdo() !== null ? round(uDist(lastOdo()), 1) : ''));
    setVal('f-liters', f ? round(uVol(f.liters), 3) : '');
    setVal('f-cost', f ? f.total_cost : '');
    setVal('f-price', f ? round(U.pricePerVolumeFromLiter(f.price_l, UN.system), 3) : '');
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
      odo: inDist(numIn(getVal('f-odo'))),
      liters: inVol(numIn(getVal('f-liters'))),
      total_cost: numIn(getVal('f-cost')),
      price_l: U.pricePerVolumeToLiter(numIn(getVal('f-price')), UN.system),
      full: getVal('f-full'),
      missed: getVal('f-missed'),
      fuel_type: getVal('f-fuel'),
      station: getVal('f-station'),
      location: getVal('f-location'),
      notes: getVal('f-notes')
    };
    if (!body.date || body.odo === null || !body.liters) return toast(t('msg.requiredFillup'));
    if (body.total_cost === null && body.price_l === null) return toast(t('msg.requiredCost'));
    try {
      if (editingFillup) await api('api/fillups/' + editingFillup.id, { method: 'PUT', body: body });
      else await api('api/fillups', { method: 'POST', body: body });
      dlg.close();
      toast(t(editingFillup ? 'msg.updatedFillup' : 'msg.savedFillup'));
      await refresh();
    } catch (e) { toast(e.message); }
  }, async function (dlg) {
    if (!editingFillup || !confirm(t('confirm.deleteFillup'))) return;
    try {
      await api('api/fillups/' + editingFillup.id, { method: 'DELETE' });
      dlg.close();
      toast(t('msg.deletedFillup'));
      await refresh();
    } catch (e) { toast(e.message); }
  });

  /* --- spesa --- */

  var editingExpense = null;

  function openExpense(e) {
    if (!state.vehicleId) return toast(t('msg.needVehicle'));
    editingExpense = e || null;
    $('#expense-title').textContent = t(e ? 'title.editExpense' : 'title.newExpense');
    setVal('e-date', e ? e.date : todayISO());
    setVal('e-odo', e ? round(uDist(e.odo), 1) : (lastOdo() !== null ? round(uDist(lastOdo()), 1) : ''));
    setVal('e-category', e ? e.category : t('category.maintenance'));
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
      odo: inDist(numIn(getVal('e-odo'))),
      category: getVal('e-category') || t('category.other'),
      cost: numIn(getVal('e-cost')),
      description: getVal('e-description'),
      vendor: getVal('e-vendor'),
      notes: getVal('e-notes')
    };
    if (!body.date || body.cost === null) return toast(t('msg.requiredExpense'));
    try {
      if (editingExpense) await api('api/expenses/' + editingExpense.id, { method: 'PUT', body: body });
      else await api('api/expenses', { method: 'POST', body: body });
      dlg.close();
      toast(t('msg.savedExpense'));
      await refresh();
    } catch (e) { toast(e.message); }
  }, async function (dlg) {
    if (!editingExpense || !confirm(t('confirm.deleteExpense'))) return;
    try {
      await api('api/expenses/' + editingExpense.id, { method: 'DELETE' });
      dlg.close();
      toast(t('msg.deletedExpense'));
      await refresh();
    } catch (e) { toast(e.message); }
  });

  /* --- promemoria --- */

  var editingReminder = null;

  function openReminder(r) {
    if (!state.vehicleId) return toast(t('msg.needVehicle'));
    editingReminder = r || null;
    $('#reminder-title').textContent = t(r ? 'title.editReminder' : 'title.newReminder');
    setVal('r-title', r ? r.title : '');
    setVal('r-category', r ? r.category : t('category.maintenance'));
    setVal('r-due-date', r && r.due_date ? String(r.due_date).slice(0, 10) : '');
    setVal('r-due-odo', r ? round(uDist(r.due_odo), 1) : '');
    setVal('r-every-months', r ? r.every_months : '');
    setVal('r-every-km', r ? round(uDist(r.every_km), 1) : '');
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
      due_odo: inDist(numIn(getVal('r-due-odo'))),
      every_months: numIn(getVal('r-every-months')),
      every_km: inDist(numIn(getVal('r-every-km'))),
      notes: getVal('r-notes')
    };
    if (!body.title) return toast(t('msg.requiredTitle'));
    if (!body.due_date && body.due_odo === null) return toast(t('msg.requiredDue'));
    try {
      if (editingReminder) await api('api/reminders/' + editingReminder.id, { method: 'PUT', body: body });
      else await api('api/reminders', { method: 'POST', body: body });
      dlg.close();
      toast(t('msg.savedReminder'));
      await refresh();
    } catch (e) { toast(e.message); }
  }, async function (dlg) {
    if (!editingReminder || !confirm(t('confirm.deleteReminder'))) return;
    try {
      await api('api/reminders/' + editingReminder.id, { method: 'DELETE' });
      dlg.close();
      toast(t('msg.deletedReminder'));
      await refresh();
    } catch (e) { toast(e.message); }
  });

  /* --- veicolo --- */

  var editingVehicle = null;

  function openVehicle(v) {
    editingVehicle = v || null;
    $('#vehicle-title').textContent = t(v ? 'title.editVehicle' : 'title.newVehicle');
    setVal('v-name', v ? v.name : '');
    setVal('v-make', v ? v.make : '');
    setVal('v-model', v ? v.model : '');
    setVal('v-year', v ? v.year : '');
    setVal('v-plate', v ? v.plate : '');
    setVal('v-fuel', v ? v.fuel_type : t('fuel.petrol'));
    setVal('v-tank', v ? round(uVol(v.tank_l), 2) : '');
    setVal('v-start', v ? round(uDist(v.start_odo), 1) : '');
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
      tank_l: inVol(numIn(getVal('v-tank'))),
      start_odo: inDist(numIn(getVal('v-start'))) || 0,
      archived: getVal('v-archived'),
      notes: getVal('v-notes')
    };
    if (!body.name) return toast(t('msg.requiredName'));
    try {
      var created;
      if (editingVehicle) await api('api/vehicles/' + editingVehicle.id, { method: 'PUT', body: body });
      else created = await api('api/vehicles', { method: 'POST', body: body });
      dlg.close();
      toast(t('msg.savedVehicle'));
      if (created) PREF.set('vehicle', created.id);
      await boot(true);
    } catch (e) { toast(e.message); }
  }, async function (dlg) {
    if (!editingVehicle) return;
    if (!confirm(t('confirm.deleteVehicle', { name: editingVehicle.name }))) return;
    try {
      await api('api/vehicles/' + editingVehicle.id, { method: 'DELETE' });
      dlg.close();
      toast(t('msg.deletedVehicle'));
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
      toast(t('msg.imported', { n: res.imported, skipped: res.skipped }));
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
      if (e.message !== UNAUTH) toast(e.message);
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
      await loadLocale();
      await loadUnits();
      await loadVehicles();
      await loadVehicleData();
      var savedView = PREF.get('view', 'riepilogo');
      if (VIEWS[savedView]) state.view = savedView;
      await render();
      handleHash();
    } catch (e) {
      if (e.message === UNAUTH) return;
      showApp();
      await loadLocale();
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
  I.setLocale(I.negotiate(navigator.language + ',' + (navigator.languages || []).join(',')) || I.FALLBACK);
  document.documentElement.setAttribute('lang', I.getLocale());
  translateStatic();
  fillDatalists();
  initEvents();
  boot();
  registerSW();
})();
