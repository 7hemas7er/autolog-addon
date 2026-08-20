'use strict';
var test = require('node:test');
var assert = require('node:assert');
var calc = require('../lib/calc.js');

/*
 * Sequenza di 6 rifornimenti con un parziale e un missed.
 * odo:  1000(P) 1500(P) 1700(parz) 2000(P) 2400(P,missed) 2900(P)
 */
var SEQ = [
  { id: 1, date: '2024-01-01', odo: 1000, liters: 40, total_cost: 70, full: 1, missed: 0 },
  { id: 2, date: '2024-01-10', odo: 1500, liters: 25, total_cost: 45, full: 1, missed: 0 },
  { id: 3, date: '2024-01-15', odo: 1700, liters: 10, total_cost: 18, full: 0, missed: 0 },
  { id: 4, date: '2024-01-20', odo: 2000, liters: 15, total_cost: 27, full: 1, missed: 0 },
  { id: 5, date: '2024-01-28', odo: 2400, liters: 30, total_cost: 54, full: 1, missed: 1 },
  { id: 6, date: '2024-02-05', odo: 2900, liters: 35, total_cost: 63, full: 1, missed: 0 }
];

test('il primo pieno non produce consumo', function () {
  var r = calc.computeConsumption(SEQ);
  assert.strictEqual(r[0].kml, null);
  assert.strictEqual(r[0].l100, null);
});

test('pieno-a-pieno semplice', function () {
  var r = calc.computeConsumption(SEQ);
  // 1000 -> 1500 = 500 km con 25 L
  assert.strictEqual(r[1].dist, 500);
  assert.strictEqual(calc.round(r[1].kml, 4), 20);
  assert.strictEqual(calc.round(r[1].l100, 4), 5);
  assert.strictEqual(calc.round(r[1].eurkm, 4), calc.round(45 / 500, 4));
});

test('il parziale non ha consumo proprio e confluisce nel pieno successivo', function () {
  var r = calc.computeConsumption(SEQ);
  assert.strictEqual(r[2].kml, null);
  // 1500 -> 2000 = 500 km con 10 + 15 = 25 L
  assert.strictEqual(r[3].dist, 500);
  assert.strictEqual(calc.round(r[3].kml, 4), 20);
});

test('missed interrompe la catena ma riparte come riferimento', function () {
  var r = calc.computeConsumption(SEQ);
  assert.strictEqual(r[4].kml, null, 'il pieno con missed non produce consumo');
  // 2400 -> 2900 = 500 km con 35 L
  assert.strictEqual(r[5].dist, 500);
  assert.strictEqual(calc.round(r[5].kml, 4), calc.round(500 / 35, 4));
});

test('media pesata diversa dalla media aritmetica', function () {
  var list = [
    { id: 1, date: '2024-01-01', odo: 0, liters: 10, total_cost: 18, full: 1 },
    { id: 2, date: '2024-01-05', odo: 100, liters: 10, total_cost: 18, full: 1 },  // 10 km/l
    { id: 3, date: '2024-01-10', odo: 1000, liters: 30, total_cost: 54, full: 1 }  // 30 km/l
  ];
  var r = calc.computeConsumption(list);
  var avg = calc.averageConsumption(r);
  var aritmetica = (r[1].kml + r[2].kml) / 2; // 20
  assert.strictEqual(calc.round(aritmetica, 4), 20);
  // pesata: (100 + 900) / (10 + 30) = 25
  assert.strictEqual(calc.round(avg.kml, 4), 25);
  assert.notStrictEqual(calc.round(avg.kml, 4), calc.round(aritmetica, 4));
});

test('odo decrescente o uguale: nessun consumo e avviso', function () {
  var list = [
    { id: 1, date: '2024-01-01', odo: 1000, liters: 40, total_cost: 70, full: 1 },
    { id: 2, date: '2024-01-05', odo: 1000, liters: 20, total_cost: 36, full: 1 }
  ];
  var r = calc.computeConsumption(list);
  assert.strictEqual(r[1].kml, null);
  assert.strictEqual(r[1].odo_warning, true);
});

test('litri a zero non causa divisione per zero', function () {
  var list = [
    { id: 1, date: '2024-01-01', odo: 1000, liters: 40, total_cost: 70, full: 1 },
    { id: 2, date: '2024-01-05', odo: 1500, liters: 0, total_cost: 0, full: 1 }
  ];
  var r = calc.computeConsumption(list);
  assert.strictEqual(r[1].kml, null);
  var avg = calc.averageConsumption(r);
  assert.strictEqual(avg.kml, null);
});

test('lista vuota', function () {
  assert.deepStrictEqual(calc.computeConsumption([]), []);
  assert.strictEqual(calc.averageConsumption([]).kml, null);
});

test('computeStats: totali, €/km e media pesata', function () {
  var v = { start_odo: 1000 };
  var stats = calc.computeStats(v, SEQ, [
    { date: '2024-01-12', cost: 120, category: 'Gomme' },
    { date: '2024-02-01', cost: 80, category: 'Tagliando' }
  ]);
  assert.strictEqual(stats.count_fillups, 6);
  assert.strictEqual(stats.total_km, 1900);           // 2900 - 1000
  assert.strictEqual(stats.total_liters, 155);
  assert.strictEqual(stats.fuel_cost, 277);
  assert.strictEqual(stats.other_cost, 200);
  assert.strictEqual(stats.total_cost, 477);
  assert.strictEqual(stats.eur_km_fuel, calc.round(277 / 1900, 4));
  // km misurati = 500 + 500 + 500 = 1500 con 25 + 25 + 35 = 85 L
  assert.strictEqual(stats.measured_km, 1500);
  assert.strictEqual(stats.measured_liters, 85);
  assert.strictEqual(stats.avg_kml, calc.round(1500 / 85, 2));
  assert.strictEqual(stats.avg_l100, calc.round(100 * 85 / 1500, 2));
  assert.strictEqual(stats.by_category[0].category, 'Gomme');
});

test('computeStats su veicolo vuoto non esplode', function () {
  var stats = calc.computeStats({ start_odo: 0 }, [], []);
  assert.strictEqual(stats.count_fillups, 0);
  assert.strictEqual(stats.total_km, 0);
  assert.strictEqual(stats.avg_kml, null);
});

test('reminderStatus: scaduto / in scadenza / ok', function () {
  var today = '2024-06-01';
  assert.strictEqual(calc.reminderStatus({ due_date: '2024-05-01' }, 1000, today).status, 'scaduto');
  assert.strictEqual(calc.reminderStatus({ due_date: '2024-06-20' }, 1000, today).status, 'in_scadenza');
  assert.strictEqual(calc.reminderStatus({ due_date: '2024-12-01' }, 1000, today).status, 'ok');
  assert.strictEqual(calc.reminderStatus({ due_odo: 10500 }, 10000, today).status, 'in_scadenza');
  assert.strictEqual(calc.reminderStatus({ due_odo: 9000 }, 10000, today).status, 'scaduto');
  assert.strictEqual(calc.reminderStatus({ due_odo: 30000 }, 10000, today).status, 'ok');
  assert.strictEqual(calc.reminderStatus({ done: 1, due_date: '2020-01-01' }, 0, today).status, 'fatto');
});

test('nextOccurrence per promemoria ricorrenti', function () {
  var n = calc.nextOccurrence({ every_months: 12, every_km: 15000 }, '2024-03-15', 50000);
  assert.strictEqual(n.due_date, '2025-03-15');
  assert.strictEqual(n.due_odo, 65000);
  assert.strictEqual(calc.nextOccurrence({}, '2024-03-15', 1000), null);
});
