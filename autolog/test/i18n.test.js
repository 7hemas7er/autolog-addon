'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');
var I = require('../public/i18n.js');

test('ogni lingua ha esattamente le stesse chiavi', function () {
  var reference = Object.keys(I.DICT[I.FALLBACK]).sort();
  I.LOCALES.forEach(function (code) {
    var keys = Object.keys(I.DICT[code]).sort();
    var missing = reference.filter(function (k) { return keys.indexOf(k) < 0; });
    var extra = keys.filter(function (k) { return reference.indexOf(k) < 0; });
    assert.deepStrictEqual(missing, [], 'chiavi mancanti in "' + code + '"');
    assert.deepStrictEqual(extra, [], 'chiavi di troppo in "' + code + '"');
  });
});

test('nessuna traduzione vuota', function () {
  I.LOCALES.forEach(function (code) {
    Object.keys(I.DICT[code]).forEach(function (k) {
      assert.ok(String(I.DICT[code][k]).trim().length > 0, code + '/' + k + ' è vuota');
    });
  });
});

test('i segnaposto coincidono fra le lingue', function () {
  var ph = function (s) {
    return (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  };
  Object.keys(I.DICT[I.FALLBACK]).forEach(function (k) {
    var ref = ph(I.DICT[I.FALLBACK][k]);
    I.LOCALES.forEach(function (code) {
      assert.strictEqual(ph(I.DICT[code][k]), ref,
        'segnaposto diversi per ' + k + ' in "' + code + '"');
    });
  });
});

test('ogni lingua dichiara nome e tag Intl', function () {
  I.LOCALES.forEach(function (code) {
    assert.ok(I.NAMES[code], 'manca il nome per ' + code);
    assert.ok(I.intlTag(code).indexOf('-') > 0, 'tag Intl non valido per ' + code);
  });
});

test('t() sostituisce i segnaposto e ripiega sulla lingua di riserva', function () {
  I.setLocale('it');
  assert.strictEqual(I.t('msg.imported', { n: 5, skipped: 2 }), 'Importate 5 righe (2 scartate)');
  I.setLocale('en');
  assert.strictEqual(I.t('msg.imported', { n: 5, skipped: 2 }), 'Imported 5 rows (2 skipped)');
  assert.strictEqual(I.t('chiave.inesistente'), 'chiave.inesistente', 'chiave sconosciuta restituita com\'è');
});

test('setLocale ignora le lingue non supportate', function () {
  assert.strictEqual(I.setLocale('de'), I.FALLBACK);
  assert.strictEqual(I.setLocale('it'), 'it');
});

test('negoziazione di Accept-Language', function () {
  assert.strictEqual(I.negotiate('it-IT,it;q=0.9,en;q=0.8'), 'it');
  assert.strictEqual(I.negotiate('en-GB,en;q=0.9'), 'en');
  assert.strictEqual(I.negotiate('de-DE,de;q=0.9,en;q=0.5'), 'en', 'ripiega sulla prima supportata');
  assert.strictEqual(I.negotiate('de-DE'), null);
  assert.strictEqual(I.negotiate(''), null);
  assert.strictEqual(I.negotiate(null), null);
});

test('numeri e date seguono la lingua', function () {
  I.setLocale('it');
  assert.strictEqual(I.num(1234.5, 2), '1234,50');
  I.setLocale('en');
  assert.strictEqual(I.num(1234.5, 2), '1,234.50');
  assert.strictEqual(I.num(null, 2), '—');
});

/* Rete di sicurezza: nessuna stringa italiana dimenticata nel codice della UI */
test('il codice della UI non contiene stringhe italiane hardcoded', function () {
  var sospette = /'(Nuovo|Nuova|Modifica|Eliminare|Aggiungi|Nessun|Nessuna|Servono|Salva|Annulla|Elimina|Importa|Ripristina|Seleziona) /;
  ['app.js', 'charts.js'].forEach(function (f) {
    var src = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    var righe = src.split('\n');
    var colpevoli = [];
    righe.forEach(function (r, i) {
      if (sospette.test(r) && r.indexOf('//') !== 0) colpevoli.push(f + ':' + (i + 1) + ' ' + r.trim().slice(0, 70));
    });
    assert.deepStrictEqual(colpevoli, [], 'stringhe da tradurre ancora nel codice');
  });
});
