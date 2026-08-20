/*
 * AutoLog — conversione delle unità di misura.
 *
 * Il database resta SEMPRE metrico: chilometri, litri e importi grezzi.
 * Qui si converte solo per la visualizzazione e per i valori pubblicati su
 * MQTT, e si riconverte quello che l'utente digita. Così cambiare sistema non
 * riscrive un solo record e non c'è modo di corrompere lo storico.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoLogUnits = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KM_PER_MI = 1.609344;
  var L_PER_USGAL = 3.785411784;
  var L_PER_IMPGAL = 4.54609;

  /*
   * metric  km, litri, km/L (+ L/100 km)
   * us      miglia, galloni US, MPG US
   * uk      miglia, galloni imperiali, MPG imperiali
   */
  var SYSTEMS = ['metric', 'us', 'uk'];

  function isImperial(system) { return system === 'us' || system === 'uk'; }
  function litersPerGallon(system) { return system === 'uk' ? L_PER_IMPGAL : L_PER_USGAL; }

  function normalize(system) { return SYSTEMS.indexOf(system) >= 0 ? system : 'metric'; }

  /* ---------- distanza ---------- */

  function distanceFromKm(km, system) {
    if (km === null || km === undefined || km === '') return null;
    return isImperial(system) ? Number(km) / KM_PER_MI : Number(km);
  }
  function distanceToKm(value, system) {
    if (value === null || value === undefined || value === '') return null;
    return isImperial(system) ? Number(value) * KM_PER_MI : Number(value);
  }
  function distanceUnit(system) { return isImperial(system) ? 'mi' : 'km'; }

  /* ---------- volume ---------- */

  function volumeFromLiters(l, system) {
    if (l === null || l === undefined || l === '') return null;
    return isImperial(system) ? Number(l) / litersPerGallon(system) : Number(l);
  }
  function volumeToLiters(value, system) {
    if (value === null || value === undefined || value === '') return null;
    return isImperial(system) ? Number(value) * litersPerGallon(system) : Number(value);
  }
  function volumeUnit(system) { return isImperial(system) ? 'gal' : 'L'; }

  /* ---------- consumo ---------- */

  /*
   * Dal km/L del motore di calcolo al valore mostrato.
   * In imperiale diventa MPG, che è "più alto = meglio" come km/L: la
   * direzione non si inverte, a differenza di L/100 km.
   */
  function consumptionFromKml(kml, system) {
    if (kml === null || kml === undefined || !isFinite(kml)) return null;
    if (!isImperial(system)) return Number(kml);
    return Number(kml) / KM_PER_MI * litersPerGallon(system);
  }
  function consumptionUnit(system) { return isImperial(system) ? 'mpg' : 'km/L'; }

  /* Unità secondaria: solo il sistema metrico ne ha una sensata. */
  function secondaryConsumption(l100, system) {
    if (isImperial(system)) return null;
    if (l100 === null || l100 === undefined || !isFinite(l100)) return null;
    return { value: Number(l100), unit: 'L/100 km' };
  }

  /* ---------- costi ---------- */

  function costPerDistanceFromKm(perKm, system) {
    if (perKm === null || perKm === undefined || !isFinite(perKm)) return null;
    return isImperial(system) ? Number(perKm) * KM_PER_MI : Number(perKm);
  }
  function pricePerVolumeFromLiter(perLiter, system) {
    if (perLiter === null || perLiter === undefined || !isFinite(perLiter)) return null;
    return isImperial(system) ? Number(perLiter) * litersPerGallon(system) : Number(perLiter);
  }
  function pricePerVolumeToLiter(perVolume, system) {
    if (perVolume === null || perVolume === undefined || perVolume === '') return null;
    return isImperial(system) ? Number(perVolume) / litersPerGallon(system) : Number(perVolume);
  }

  /* ---------- valuta ---------- */

  var CURRENCIES = {
    EUR: { code: 'EUR', symbol: '€' },
    GBP: { code: 'GBP', symbol: '£' },
    USD: { code: 'USD', symbol: '$' },
    CHF: { code: 'CHF', symbol: 'CHF' },
    SEK: { code: 'SEK', symbol: 'kr' },
    PLN: { code: 'PLN', symbol: 'zł' },
    CZK: { code: 'CZK', symbol: 'Kč' },
    DKK: { code: 'DKK', symbol: 'kr' },
    NOK: { code: 'NOK', symbol: 'kr' },
    CAD: { code: 'CAD', symbol: '$' },
    AUD: { code: 'AUD', symbol: '$' }
  };
  function currency(code) { return CURRENCIES[code] || CURRENCIES.EUR; }
  function currencySymbol(code) { return currency(code).symbol; }

  return {
    KM_PER_MI: KM_PER_MI,
    L_PER_USGAL: L_PER_USGAL,
    L_PER_IMPGAL: L_PER_IMPGAL,
    SYSTEMS: SYSTEMS,
    CURRENCIES: CURRENCIES,
    normalize: normalize,
    isImperial: isImperial,
    litersPerGallon: litersPerGallon,
    distanceFromKm: distanceFromKm,
    distanceToKm: distanceToKm,
    distanceUnit: distanceUnit,
    volumeFromLiters: volumeFromLiters,
    volumeToLiters: volumeToLiters,
    volumeUnit: volumeUnit,
    consumptionFromKml: consumptionFromKml,
    consumptionUnit: consumptionUnit,
    secondaryConsumption: secondaryConsumption,
    costPerDistanceFromKm: costPerDistanceFromKm,
    pricePerVolumeFromLiter: pricePerVolumeFromLiter,
    pricePerVolumeToLiter: pricePerVolumeToLiter,
    currency: currency,
    currencySymbol: currencySymbol
  };
});
