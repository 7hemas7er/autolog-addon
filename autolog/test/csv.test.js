'use strict';
var test = require('node:test');
var assert = require('node:assert');
var csv = require('../lib/csv.js');

test('numeri in formato italiano e inglese', function () {
  assert.strictEqual(csv.parseNumber('1.234,56'), 1234.56);
  assert.strictEqual(csv.parseNumber('1,234.56'), 1234.56);
  assert.strictEqual(csv.parseNumber('12,5'), 12.5);
  assert.strictEqual(csv.parseNumber('12.5'), 12.5);
  assert.strictEqual(csv.parseNumber('€ 45,00'), 45);
  assert.strictEqual(csv.parseNumber('1,234'), 1234);
  assert.strictEqual(csv.parseNumber('-3,5'), -3.5);
  assert.strictEqual(csv.parseNumber(''), null);
  assert.strictEqual(csv.parseNumber('abc'), null);
});

test('date US, EU e ISO', function () {
  assert.strictEqual(csv.parseDate('2024-03-04'), '2024-03-04');
  assert.strictEqual(csv.parseDate('03/04/2024', 'US'), '2024-03-04');
  assert.strictEqual(csv.parseDate('03/04/2024', 'EU'), '2024-04-03');
  assert.strictEqual(csv.parseDate('25/12/2023', 'US'), '2023-12-25', 'primo gruppo > 12 = giorno');
  assert.strictEqual(csv.parseDate('non una data'), null);
});

test('BOM, virgolette raddoppiate e separatore ;', function () {
  var text = '﻿data;km;litri;totale\n' +
             '01/02/2024;10.000,5;"38,20";"65,10"\n' +
             '15/02/2024;10.500,0;"nota con ""virgolette""";70,00\n';
  var p = csv.parseCSV(text);
  assert.strictEqual(p.delimiter, ';');
  assert.strictEqual(p.rows.length, 3);
  assert.strictEqual(p.rows[0][0], 'data');
  assert.strictEqual(p.rows[2][2], 'nota con "virgolette"');
});

/*
 * Export in unità americane: miglia, galloni US, date MM/GG/AAAA, con totale e
 * prezzo per gallone in due colonne separate. Serve a coprire la conversione,
 * non a rappresentare una specifica app.
 */
var US_EXPORT = [
  'Fuel-up Date,Odometer (mi),Total Gallons,Total Cost,Price/Gallon,Filled Up,Missed Fuel-up,Gas Brand,Location,Payment Type,Octane,Notes',
  '01/15/2024,10000,10.000,40.00,4.000,Yes,No,Shell,Roma,Credit,95,',
  '02/01/2024,10310,10.000,42.00,4.200,Yes,No,Q8,Roma,Cash,95,pieno',
  ''
].join('\n');

test('import in unità americane con conversione miglia/galloni', function () {
  var r = csv.parseFillupsCSV(US_EXPORT, { miles: true, gallons: true, dateOrder: 'US' });
  assert.strictEqual(r.skipped, 0);
  assert.strictEqual(r.rows.length, 2);

  var a = r.rows[0];
  assert.strictEqual(a.date, '2024-01-15');
  assert.strictEqual(a.odo, Math.round(10000 * csv.MI_TO_KM * 10) / 10);   // 16093.4
  assert.strictEqual(a.liters, Math.round(10 * csv.GAL_TO_L * 1000) / 1000); // 37.854
  assert.strictEqual(a.total_cost, 40);
  assert.strictEqual(a.full, 1);
  assert.strictEqual(a.missed, 0);
  assert.strictEqual(a.station, 'Shell');
  assert.strictEqual(a.location, 'Roma');
  // prezzo/gallone diviso per il fattore di conversione = prezzo/litro
  assert.ok(Math.abs(a.price_l - 4 / csv.GAL_TO_L) < 0.002);

  // 310 miglia fra i due -> distanza in km coerente
  var dist = r.rows[1].odo - r.rows[0].odo;
  assert.ok(Math.abs(dist - 310 * csv.MI_TO_KM) < 0.2);
});

test('senza conversione i valori restano invariati', function () {
  var r = csv.parseFillupsCSV(US_EXPORT, { miles: false, gallons: false, dateOrder: 'US' });
  assert.strictEqual(r.rows[0].odo, 10000);
  assert.strictEqual(r.rows[0].liters, 10);
  assert.strictEqual(r.rows[0].price_l, 4);
});

test('CSV italiano con ; virgola decimale e parziale', function () {
  var text = [
    'Data;Km;Litri;Totale;Pieno;Distributore;Note',
    '01/02/2024;10.000,5;38,20;65,10;Si;Eni;primo',
    '15/02/2024;10.500,0;20,00;34,00;No;IP;parziale',
    ''
  ].join('\n');
  var r = csv.parseFillupsCSV(text, { dateOrder: 'EU' });
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.rows[0].date, '2024-02-01');
  assert.strictEqual(r.rows[0].odo, 10000.5);
  assert.strictEqual(r.rows[0].liters, 38.2);
  assert.strictEqual(r.rows[0].total_cost, 65.1);
  assert.strictEqual(r.rows[0].full, 1);
  assert.strictEqual(r.rows[1].full, 0);
  assert.strictEqual(r.rows[1].station, 'IP');
});

test('riga malformata scartata senza interrompere l import', function () {
  var text = [
    'Data,Km,Litri,Totale',
    '2024-01-01,1000,40,70',
    'riga,rotta,,',
    '2024-01-10,1500,25,45',
    ',2000,10,18',
    ''
  ].join('\n');
  var r = csv.parseFillupsCSV(text, { dateOrder: 'EU' });
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.skipped, 2);
  assert.ok(r.errors.length >= 2);
});

test('colonna prezzo usata per ricavare i litri mancanti', function () {
  var text = [
    'Data,Km,Totale,Prezzo/litro',
    '2024-01-01,1000,70.00,1.750',
    ''
  ].join('\n');
  var r = csv.parseFillupsCSV(text, { dateOrder: 'EU' });
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].liters, 40);
});

test('colonne obbligatorie mancanti', function () {
  var r = csv.parseFillupsCSV('a,b,c\n1,2,3\n', {});
  assert.strictEqual(r.rows.length, 0);
  assert.ok(r.errors.length > 0);
});

test('import spese', function () {
  var text = [
    'Data;Categoria;Descrizione;Costo;Officina',
    '10/03/2024;Gomme;4 pneumatici estivi;480,00;Gommista Rossi',
    ''
  ].join('\n');
  var r = csv.parseExpensesCSV(text, { dateOrder: 'EU' });
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].category, 'Gomme');
  assert.strictEqual(r.rows[0].cost, 480);
  assert.strictEqual(r.rows[0].vendor, 'Gommista Rossi');
});

test('serializzazione CSV con escape', function () {
  var out = csv.toCSV(['a', 'b'], [{ a: 'x,y', b: 'dice "ciao"' }], ',');
  assert.strictEqual(out, 'a,b\n"x,y","dice ""ciao"""\n');
  var back = csv.parseCSV(out);
  assert.strictEqual(back.rows[1][0], 'x,y');
  assert.strictEqual(back.rows[1][1], 'dice "ciao"');
});

/*
 * Export Fuelly scaricato dal sito: colonne come documentate su
 * fuelly.com/csv-import, con "price" come prezzo unitario e nessun totale.
 */
var FUELLY_WEB = [
  'car_name, model, km/l,  odometer, km, litres, price, city_percentage, fuelup_date, date_added, tags, notes, missed_fuelup, partial_fuelup, latitude, longitude, brand',
  '"Furgone","Marca Modello",8.64,120000.0,293.0,33.9,2.212,50,2024-03-18,2024-03-18 17:08:47,"","",0,0,,,"Eni"',
  '"Furgone","Marca Modello",0,120651.0,651.0,14.434,2.44,50,2024-03-19,2024-03-19 12:52:51,"","",0,1,,,""',
  ''
].join('\n');

test('export Fuelly: colonna "price" riconosciuta come prezzo unitario', function () {
  var r = csv.parseFillupsCSV(FUELLY_WEB, {});
  assert.strictEqual(r.skipped, 0);
  assert.strictEqual(r.rows.length, 2);
  var a = r.rows[0];
  assert.strictEqual(a.date, '2024-03-18');
  assert.strictEqual(a.odo, 120000, 'usa odometer, non la distanza parziale');
  assert.strictEqual(a.liters, 33.9);
  assert.strictEqual(a.price_l, 2.212);
  assert.strictEqual(a.total_cost, Math.round(33.9 * 2.212 * 100) / 100);
  assert.strictEqual(a.station, 'Eni');
  assert.strictEqual(a.full, 1);
  assert.strictEqual(r.rows[1].full, 0, 'partial_fuelup = 1 -> non è un pieno');
});

test('colonna "price" come totale resta un totale', function () {
  var text = [
    'Date,Odometer,Liters,Price',
    '2024-01-01,1000,40,70.00',
    '2024-01-10,1500,38,66.50',
    ''
  ].join('\n');
  var r = csv.parseFillupsCSV(text, {});
  assert.strictEqual(r.rows[0].total_cost, 70);
  assert.strictEqual(r.rows[0].price_l, 1.75);
});
