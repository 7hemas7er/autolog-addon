/*
 * AutoLog — calcoli puri su rifornimenti, spese e promemoria.
 *
 * Questo file è l'UNICA implementazione dei calcoli: viene usato dal server
 * (require) e servito al browser tale e quale sulla route relativa `calc.js`.
 * Per questo usa un wrapper UMD minimale e nessuna sintassi di modulo.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoLogCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAYS_PER_MONTH = 30.44;

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function round(n, d) {
    if (n === null || n === undefined || !Number.isFinite(n)) return null;
    var f = Math.pow(10, d === undefined ? 3 : d);
    return Math.round(n * f) / f;
  }

  /* Ordinamento canonico: odo crescente, poi data, poi id. */
  function sortFillups(list) {
    return list.slice().sort(function (a, b) {
      var ao = num(a.odo) || 0, bo = num(b.odo) || 0;
      if (ao !== bo) return ao - bo;
      var ad = String(a.date || ''), bd = String(b.date || '');
      if (ad !== bd) return ad < bd ? -1 : 1;
      return (num(a.id) || 0) - (num(b.id) || 0);
    });
  }

  /*
   * Metodo pieno-a-pieno (tank-to-tank), identico a Fuelly.
   * Ritorna una NUOVA lista ordinata per odo, con kml / l100 / eurkm / dist
   * valorizzati solo sui pieni che chiudono un intervallo valido.
   */
  function computeConsumption(fillups) {
    var list = sortFillups(fillups || []).map(function (f) {
      return Object.assign({}, f, {
        odo: num(f.odo),
        liters: num(f.liters) || 0,
        total_cost: num(f.total_cost) || 0,
        full: Number(f.full) ? 1 : 0,
        missed: Number(f.missed) ? 1 : 0,
        kml: null, l100: null, eurkm: null, dist: null,
        odo_warning: false
      });
    });

    var lastFull = null, accL = 0, accC = 0, broken = false;

    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      accL += f.liters;
      accC += f.total_cost;
      if (f.missed) broken = true;

      if (f.full) {
        if (lastFull && !broken && f.odo !== null && lastFull.odo !== null && accL > 0) {
          var dist = f.odo - lastFull.odo;
          if (dist > 0) {
            f.dist = dist;
            f.kml = dist / accL;
            f.l100 = 100 * accL / dist;
            f.eurkm = accC / dist;
          } else {
            f.odo_warning = true;
          }
        }
        lastFull = f;
        accL = 0; accC = 0; broken = false;
      }
    }
    return list;
  }

  /* Media pesata: Σ distanze valide / Σ litri validi. NON la media dei consumi. */
  function averageConsumption(computed) {
    var dist = 0, liters = 0;
    for (var i = 0; i < computed.length; i++) {
      var f = computed[i];
      if (f.kml !== null && f.dist > 0) {
        dist += f.dist;
        liters += f.dist / f.kml;
      }
    }
    if (liters <= 0) return { kml: null, l100: null, dist: 0, liters: 0 };
    return { kml: dist / liters, l100: 100 * liters / dist, dist: dist, liters: liters };
  }

  function monthKey(date) { return String(date || '').slice(0, 7); }

  function daysBetween(a, b) {
    var ta = Date.parse(a + 'T00:00:00Z'), tb = Date.parse(b + 'T00:00:00Z');
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
    return (tb - ta) / 86400000;
  }

  /*
   * Statistiche aggregate di un veicolo.
   * vehicle: {start_odo}; fillups/expenses: liste grezze dal DB.
   */
  function computeStats(vehicle, fillups, expenses) {
    var computed = computeConsumption(fillups || []);
    var exp = (expenses || []).map(function (e) {
      return Object.assign({}, e, { cost: num(e.cost) || 0 });
    });

    var n = computed.length;
    var totalLiters = 0, fuelCost = 0, priceSum = 0, priceCount = 0;
    var firstDate = null, lastDate = null;
    var minOdo = null, maxOdo = null;
    var best = null, worst = null;
    var lastPrice = null, lastFillup = null;
    var monthly = {};

    for (var i = 0; i < n; i++) {
      var f = computed[i];
      totalLiters += f.liters;
      fuelCost += f.total_cost;
      var pl = f.liters > 0 ? f.total_cost / f.liters : null;
      if (pl !== null) { priceSum += pl; priceCount++; }
      if (f.odo !== null) {
        if (minOdo === null || f.odo < minOdo) minOdo = f.odo;
        if (maxOdo === null || f.odo > maxOdo) maxOdo = f.odo;
      }
      if (f.date) {
        if (!firstDate || f.date < firstDate) firstDate = f.date;
        if (!lastDate || f.date > lastDate) { lastDate = f.date; }
      }
      if (f.kml !== null) {
        if (!best || f.kml > best.kml) best = f;
        if (!worst || f.kml < worst.kml) worst = f;
      }
      var mk = monthKey(f.date);
      if (mk) {
        monthly[mk] = monthly[mk] || { month: mk, fuel: 0, other: 0 };
        monthly[mk].fuel += f.total_cost;
      }
    }

    /* Ultimo rifornimento per data (tie-break odo). */
    for (var j = 0; j < n; j++) {
      var g = computed[j];
      if (!lastFillup) { lastFillup = g; continue; }
      if (String(g.date) > String(lastFillup.date) ||
         (String(g.date) === String(lastFillup.date) && (g.odo || 0) >= (lastFillup.odo || 0))) {
        lastFillup = g;
      }
    }
    if (lastFillup && lastFillup.liters > 0) lastPrice = lastFillup.total_cost / lastFillup.liters;

    var otherCost = 0;
    var byCategory = {};
    for (var k = 0; k < exp.length; k++) {
      var e = exp[k];
      otherCost += e.cost;
      var cat = e.category || 'Altro';
      byCategory[cat] = (byCategory[cat] || 0) + e.cost;
      var em = monthKey(e.date);
      if (em) {
        monthly[em] = monthly[em] || { month: em, fuel: 0, other: 0 };
        monthly[em].other += e.cost;
      }
      if (e.date) {
        if (!firstDate || e.date < firstDate) firstDate = e.date;
        if (!lastDate || e.date > lastDate) lastDate = e.date;
      }
      var eo = num(e.odo);
      if (eo !== null && eo > 0) {
        if (maxOdo === null || eo > maxOdo) maxOdo = eo;
        if (minOdo === null || eo < minOdo) minOdo = eo;
      }
    }

    var startOdo = num(vehicle && vehicle.start_odo);
    var baseOdo = (startOdo !== null && startOdo > 0) ? startOdo : minOdo;
    var totalKm = (maxOdo !== null && baseOdo !== null) ? Math.max(0, maxOdo - baseOdo) : 0;

    var avg = averageConsumption(computed);
    var totalCost = fuelCost + otherCost;

    var span = (firstDate && lastDate) ? daysBetween(firstDate, lastDate) : null;
    var months = (span !== null && span > 0) ? span / DAYS_PER_MONTH : null;

    var monthlyList = Object.keys(monthly).sort().map(function (m) {
      return { month: m, fuel: round(monthly[m].fuel, 2), other: round(monthly[m].other, 2),
               total: round(monthly[m].fuel + monthly[m].other, 2) };
    });

    var categoryList = Object.keys(byCategory).map(function (c) {
      return { category: c, cost: round(byCategory[c], 2) };
    }).sort(function (a, b) { return b.cost - a.cost; });

    return {
      count_fillups: n,
      count_expenses: exp.length,
      total_km: round(totalKm, 1),
      total_liters: round(totalLiters, 2),
      fuel_cost: round(fuelCost, 2),
      other_cost: round(otherCost, 2),
      total_cost: round(totalCost, 2),
      eur_km_fuel: totalKm > 0 ? round(fuelCost / totalKm, 4) : null,
      eur_km_total: totalKm > 0 ? round(totalCost / totalKm, 4) : null,
      avg_kml: round(avg.kml, 2),
      avg_l100: round(avg.l100, 2),
      measured_km: round(avg.dist, 1),
      measured_liters: round(avg.liters, 2),
      best_kml: best ? round(best.kml, 2) : null,
      best_date: best ? best.date : null,
      worst_kml: worst ? round(worst.kml, 2) : null,
      worst_date: worst ? worst.date : null,
      avg_price_l: priceCount ? round(priceSum / priceCount, 3) : null,
      last_price_l: lastPrice !== null ? round(lastPrice, 3) : null,
      last_fillup_date: lastFillup ? lastFillup.date : null,
      last_odo: maxOdo !== null ? round(maxOdo, 1) : null,
      first_date: firstDate,
      last_date: lastDate,
      km_month: (months && months > 0) ? round(totalKm / months, 1) : null,
      eur_month: (months && months > 0) ? round(totalCost / months, 2) : null,
      monthly: monthlyList,
      by_category: categoryList
    };
  }

  /*
   * Stato di un promemoria: 'scaduto' | 'in_scadenza' | 'ok' | 'fatto'.
   * Soglie: 30 giorni oppure 1000 km.
   */
  function reminderStatus(reminder, currentOdo, today) {
    if (Number(reminder.done)) return { status: 'fatto', days_left: null, km_left: null };
    var daysLeft = null, kmLeft = null;
    if (reminder.due_date && today) daysLeft = daysBetween(today, String(reminder.due_date).slice(0, 10));
    var due = num(reminder.due_odo), odo = num(currentOdo);
    if (due !== null && odo !== null) kmLeft = due - odo;

    var status = 'ok';
    if ((daysLeft !== null && daysLeft < 0) || (kmLeft !== null && kmLeft < 0)) status = 'scaduto';
    else if ((daysLeft !== null && daysLeft <= 30) || (kmLeft !== null && kmLeft <= 1000)) status = 'in_scadenza';
    return { status: status, days_left: daysLeft, km_left: kmLeft === null ? null : round(kmLeft, 0) };
  }

  /* Prossima occorrenza di un promemoria ricorrente, dopo il completamento. */
  function nextOccurrence(reminder, doneDate, doneOdo) {
    var months = num(reminder.every_months), km = num(reminder.every_km);
    if (!months && !km) return null;
    var next = { due_date: null, due_odo: null };
    if (months) {
      var base = doneDate ? new Date(doneDate + 'T00:00:00Z') : new Date();
      var d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()));
      next.due_date = d.toISOString().slice(0, 10);
    }
    if (km) {
      var o = num(doneOdo);
      if (o !== null) next.due_odo = o + km;
    }
    return next;
  }

  return {
    DAYS_PER_MONTH: DAYS_PER_MONTH,
    num: num,
    round: round,
    sortFillups: sortFillups,
    computeConsumption: computeConsumption,
    averageConsumption: averageConsumption,
    computeStats: computeStats,
    reminderStatus: reminderStatus,
    nextOccurrence: nextOccurrence
  };
});
