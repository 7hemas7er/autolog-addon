'use strict';
var test = require('node:test');
var assert = require('node:assert');
var U = require('../lib/units.js');

function close(a, b, tol) { assert.ok(Math.abs(a - b) < (tol || 1e-9), a + ' ≈ ' + b); }

test('sistema sconosciuto ripiega su metrico', function () {
  assert.strictEqual(U.normalize('klingon'), 'metric');
  assert.strictEqual(U.normalize(undefined), 'metric');
  assert.strictEqual(U.normalize('uk'), 'uk');
});

test('nel sistema metrico non si converte nulla', function () {
  assert.strictEqual(U.distanceFromKm(100, 'metric'), 100);
  assert.strictEqual(U.volumeFromLiters(50, 'metric'), 50);
  assert.strictEqual(U.consumptionFromKml(12.5, 'metric'), 12.5);
  assert.strictEqual(U.distanceUnit('metric'), 'km');
  assert.strictEqual(U.volumeUnit('metric'), 'L');
  assert.strictEqual(U.consumptionUnit('metric'), 'km/L');
});

test('distanza: km <-> miglia, andata e ritorno esatti', function () {
  close(U.distanceFromKm(160.9344, 'us'), 100);
  close(U.distanceToKm(100, 'us'), 160.9344);
  ['us', 'uk'].forEach(function (s) {
    close(U.distanceToKm(U.distanceFromKm(1234.5, s), s), 1234.5, 1e-9);
  });
});

test('volume: galloni US e imperiali sono diversi', function () {
  close(U.volumeFromLiters(U.L_PER_USGAL, 'us'), 1);
  close(U.volumeFromLiters(U.L_PER_IMPGAL, 'uk'), 1);
  assert.ok(U.volumeFromLiters(50, 'us') > U.volumeFromLiters(50, 'uk'),
    'un gallone imperiale è più grande, quindi il numero è più piccolo');
  ['us', 'uk'].forEach(function (s) {
    close(U.volumeToLiters(U.volumeFromLiters(45.7, s), s), 45.7, 1e-9);
  });
});

test('consumo: km/L verso MPG', function () {
  close(U.consumptionFromKml(10, 'us'), 23.5214583, 1e-6);
  close(U.consumptionFromKml(10, 'uk'), 28.2480936, 1e-6);
  assert.strictEqual(U.consumptionUnit('us'), 'mpg');
  assert.strictEqual(U.consumptionFromKml(null, 'us'), null);
  assert.strictEqual(U.consumptionFromKml(Infinity, 'us'), null);
});

test('MPG e km/L vanno nella stessa direzione', function () {
  var a = U.consumptionFromKml(8, 'us');
  var b = U.consumptionFromKml(12, 'us');
  assert.ok(b > a, 'consumare meno deve dare un numero più alto in entrambi i sistemi');
});

test('unità secondaria solo nel sistema metrico', function () {
  assert.deepStrictEqual(U.secondaryConsumption(8.5, 'metric'), { value: 8.5, unit: 'L/100 km' });
  assert.strictEqual(U.secondaryConsumption(8.5, 'us'), null);
  assert.strictEqual(U.secondaryConsumption(null, 'metric'), null);
});

test('costo per distanza e prezzo per volume', function () {
  close(U.costPerDistanceFromKm(0.10, 'us'), 0.1609344);
  close(U.pricePerVolumeFromLiter(1, 'us'), U.L_PER_USGAL);
  close(U.pricePerVolumeFromLiter(1, 'uk'), U.L_PER_IMPGAL);
  ['us', 'uk'].forEach(function (s) {
    close(U.pricePerVolumeToLiter(U.pricePerVolumeFromLiter(1.799, s), s), 1.799, 1e-9);
  });
});

test('coerenza: distanza / volume convertiti danno il consumo convertito', function () {
  ['metric', 'us', 'uk'].forEach(function (s) {
    var km = 600, litri = 50;
    var atteso = U.distanceFromKm(km, s) / U.volumeFromLiters(litri, s);
    close(U.consumptionFromKml(km / litri, s), atteso, 1e-9);
  });
});

test('valute note e ripiego su euro', function () {
  assert.strictEqual(U.currencySymbol('GBP'), '£');
  assert.strictEqual(U.currencySymbol('USD'), '$');
  assert.strictEqual(U.currencySymbol('EUR'), '€');
  assert.strictEqual(U.currencySymbol('XYZ'), '€', 'valuta sconosciuta -> euro');
  assert.strictEqual(U.currency('GBP').code, 'GBP');
});
