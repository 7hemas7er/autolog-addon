/*
 * AutoLog — localizzazione dell'interfaccia.
 *
 * Nessuna dipendenza e nessun build step: i dizionari sono qui dentro e la
 * formattazione di numeri e date usa Intl, che il browser ha già.
 *
 * Per aggiungere una lingua: copiare un blocco, tradurre i valori, aggiungere
 * il codice a LOCALES. Il test i18n.test.js fallisce se una chiave manca.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoLogI18n = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DICT = {
    it: {
      'app.name': 'AutoLog',
      'app.offline': 'Dati non raggiungibili: il server non risponde.',
      'app.loading': 'Caricamento…',

      'nav.summary': 'Riepilogo',
      'nav.fillups': 'Rifornimenti',
      'nav.expenses': 'Spese',
      'nav.reminders': 'Promemoria',
      'nav.charts': 'Grafici',
      'nav.vehicles': 'Veicoli',
      'nav.data': 'Dati',
      'nav.sections': 'Sezioni',

      'login.password': 'Password',
      'login.submit': 'Entra',

      'topbar.vehicle': 'Veicolo',
      'topbar.selected': 'Veicolo selezionato',
      'topbar.theme': 'Cambia tema',

      'stat.consumption': 'Consumo medio',
      'stat.consumption.hint': 'servono due pieni completi',
      'stat.costkm': 'Costo al km',
      'stat.costkm.fuel': 'solo carburante {v}',
      'stat.distance': 'Km totali',
      'stat.distance.month': '{v} km/mese',
      'stat.spend': 'Spesa totale',
      'stat.spend.fuel': 'carburante {v}',
      'stat.lastprice': 'Ultimo prezzo',
      'stat.avgprice': 'medio {v}',
      'stat.fillups': 'Rifornimenti',
      'stat.lastfillup': 'ultimo {v}',

      'section.dueReminders': 'Promemoria in scadenza',
      'section.lastFillups': 'Ultimi rifornimenti',
      'section.fillups': 'Rifornimenti ({n})',
      'section.expenses': 'Spese ({n})',
      'section.byCategory': 'Totali per categoria',
      'section.todo': 'Da fare ({n})',
      'section.done': 'Completati',
      'section.vehicles': 'Veicoli ({n})',

      'chart.consumption': 'Consumo (km/L)',
      'chart.consumptionOverTime': 'Consumo nel tempo (km/L)',
      'chart.price': 'Prezzo al litro (€/L)',
      'chart.byCategory': 'Spese per categoria (€)',
      'chart.monthly': 'Costi mensili (€)',
      'chart.series.consumption': 'Consumo',
      'chart.series.fuel': 'Carburante',
      'chart.series.other': 'Altre spese',
      'chart.average': 'media',
      'chart.averagePrice': 'medio',
      'chart.empty.consumption': 'Servono almeno due pieni completi per calcolare un consumo.',
      'chart.empty.price': 'Nessun prezzo registrato.',
      'chart.empty.category': 'Nessuna spesa registrata.',
      'chart.empty.monthly': 'Nessun costo registrato.',
      'chart.empty.generic': 'Dati insufficienti per il grafico.',

      'empty.noVehicle': 'Nessun veicolo',
      'empty.noVehicle.hint': 'Aggiungi il primo veicolo per iniziare a registrare i rifornimenti.',
      'empty.fillups': 'Nessun rifornimento. Tocca + per aggiungerne uno.',
      'empty.fillupsShort': 'Nessun rifornimento registrato.',
      'empty.expenses': 'Nessuna spesa registrata. Tocca + per aggiungerne una.',
      'empty.reminders': 'Nessun promemoria. Tocca + per aggiungerne uno.',

      'badge.full': 'pieno',
      'badge.partial': 'parziale',
      'badge.odoWarning': 'km incoerenti',
      'badge.chainBroken': 'catena interrotta',
      'badge.active': 'attivo',
      'badge.archived': 'archiviato',
      'badge.overdue': 'scaduto',
      'badge.dueSoon': 'in scadenza',
      'badge.ok': 'ok',
      'badge.done': 'fatto',

      'reminder.byDate': 'entro {v}',
      'reminder.byOdo': 'a {v}',
      'reminder.kmLeft': '{v} km rimanenti',
      'reminder.daysLeft': '{v} giorni',

      'title.newFillup': 'Nuovo rifornimento',
      'title.editFillup': 'Modifica rifornimento',
      'title.newExpense': 'Nuova spesa',
      'title.editExpense': 'Modifica spesa',
      'title.newReminder': 'Nuovo promemoria',
      'title.editReminder': 'Modifica promemoria',
      'title.newVehicle': 'Nuovo veicolo',
      'title.editVehicle': 'Modifica veicolo',
      'title.importPreview': 'Anteprima import',

      'field.date': 'Data',
      'field.odo': 'Chilometri',
      'field.liters': 'Litri',
      'field.totalCost': 'Costo totale ({cur})',
      'field.pricePerLiter': 'Prezzo/litro ({cur}/L)',
      'field.fuelType': 'Carburante',
      'field.full': 'Pieno completo',
      'field.missed': 'Rifornimento precedente non registrato',
      'field.station': 'Distributore',
      'field.location': 'Luogo',
      'field.notes': 'Note',
      'field.category': 'Categoria',
      'field.cost': 'Costo ({cur})',
      'field.description': 'Descrizione',
      'field.vendor': 'Officina / fornitore',
      'field.title': 'Titolo',
      'field.dueDate': 'Scadenza (data)',
      'field.dueOdo': 'Scadenza (km)',
      'field.everyMonths': 'Ricorre ogni (mesi)',
      'field.everyKm': 'Ricorre ogni (km)',
      'field.name': 'Nome',
      'field.make': 'Marca',
      'field.model': 'Modello',
      'field.year': 'Anno',
      'field.plate': 'Targa',
      'field.tank': 'Serbatoio (L)',
      'field.startOdo': 'Km iniziali',
      'field.archived': 'Archiviato',

      'action.save': 'Salva',
      'action.cancel': 'Annulla',
      'action.delete': 'Elimina',
      'action.import': 'Importa',
      'action.preview': 'Anteprima',
      'action.restore': 'Ripristina',
      'action.select': 'Seleziona',
      'action.done': 'Fatto',
      'action.addFillup': 'Aggiungi rifornimento',
      'action.addExpense': 'Aggiungi spesa',
      'action.addReminder': 'Aggiungi promemoria',
      'action.addVehicle': 'Aggiungi veicolo',

      'data.import': 'Import CSV',
      'data.import.hint': 'Importa un CSV di rifornimenti o spese nel veicolo selezionato. L\'import è sempre additivo: non cancella nulla.',
      'data.import.type': 'Tipo di dati',
      'data.import.dateFormat': 'Formato data ambiguo',
      'data.import.miles': 'I chilometraggi sono in miglia',
      'data.import.gallons': 'I volumi sono in galloni US',
      'data.export': 'Export e backup',
      'data.export.fillups': 'Esporta rifornimenti CSV',
      'data.export.expenses': 'Esporta spese CSV',
      'data.export.json': 'Backup JSON completo',
      'data.restore': 'Ripristino',
      'data.restore.hint': 'Ripristina un backup JSON. Con "sostituisci" il contenuto attuale viene cancellato.',
      'data.restore.replace': 'Sostituisci i dati esistenti',
      'data.info': 'Informazioni',
      'data.info.unavailable': 'Informazioni non disponibili.',
      'data.language': 'Lingua',
      'data.language.hint': 'La scelta vale per il tuo utente Home Assistant, su tutti i dispositivi.',
      'data.language.auto': 'Automatica ({v})',

      'import.summary': '{total} righe interpretate, {skipped} scartate. Anteprima delle prime {n}:',

      'msg.needVehicle': 'Crea prima un veicolo',
      'msg.selectVehicle': 'Seleziona un veicolo',
      'msg.chooseCsv': 'Scegli prima un file CSV',
      'msg.chooseJson': 'Scegli prima un file JSON',
      'msg.requiredFillup': 'Data, km e litri sono obbligatori',
      'msg.requiredCost': 'Serve il costo totale o il prezzo al litro',
      'msg.requiredExpense': 'Data e costo sono obbligatori',
      'msg.requiredTitle': 'Il titolo è obbligatorio',
      'msg.requiredDue': 'Serve una scadenza a data o a chilometri',
      'msg.requiredName': 'Il nome è obbligatorio',
      'msg.savedFillup': 'Rifornimento salvato',
      'msg.updatedFillup': 'Rifornimento aggiornato',
      'msg.deletedFillup': 'Rifornimento eliminato',
      'msg.savedExpense': 'Spesa salvata',
      'msg.deletedExpense': 'Spesa eliminata',
      'msg.savedReminder': 'Promemoria salvato',
      'msg.deletedReminder': 'Promemoria eliminato',
      'msg.doneReminder': 'Promemoria completato',
      'msg.savedVehicle': 'Veicolo salvato',
      'msg.deletedVehicle': 'Veicolo eliminato',
      'msg.imported': 'Importate {n} righe ({skipped} scartate)',
      'msg.restored': 'Ripristinati {v} veicoli, {f} rifornimenti',
      'msg.unreachable': 'Server non raggiungibile',
      'msg.unauthenticated': 'Non autenticato',
      'msg.error': 'Errore {code}',

      'confirm.deleteFillup': 'Eliminare questo rifornimento?',
      'confirm.deleteExpense': 'Eliminare questa spesa?',
      'confirm.deleteReminder': 'Eliminare questo promemoria?',
      'confirm.deleteVehicle': 'Eliminare "{name}" con tutti i suoi rifornimenti, spese e promemoria?',
      'confirm.replace': 'Sostituire tutti i dati esistenti con il backup? L\'operazione non è reversibile.',

      'warn.odoNotHigher': 'I chilometri ({v}) non superano l\'ultimo valore registrato ({last}).',
      'warn.tooManyLiters': 'Litri ({v}) oltre la capacità del serbatoio ({tank} L).',
      'warn.priceRange': 'Prezzo al litro fuori dall\'intervallo plausibile {min}–{max}.',
      'warn.futureDate': 'La data è nel futuro.',

      'category.maintenance': 'Manutenzione',
      'category.service': 'Tagliando',
      'category.tyres': 'Gomme',
      'category.insurance': 'Assicurazione',
      'category.tax': 'Bollo',
      'category.inspection': 'Revisione',
      'category.repair': 'Riparazione',
      'category.fine': 'Multa',
      'category.toll': 'Autostrada',
      'category.parking': 'Parcheggio',
      'category.wash': 'Lavaggio',
      'category.accessories': 'Accessori',
      'category.other': 'Altro',

      'fuel.petrol': 'Benzina',
      'fuel.diesel': 'Diesel',
      'fuel.lpg': 'GPL',
      'fuel.cng': 'Metano',
      'fuel.electric': 'Elettrico',
      'fuel.hybrid': 'Ibrido'
    },

    en: {
      'app.name': 'AutoLog',
      'app.offline': 'Data unreachable: the server is not responding.',
      'app.loading': 'Loading…',

      'nav.summary': 'Summary',
      'nav.fillups': 'Fuel-ups',
      'nav.expenses': 'Expenses',
      'nav.reminders': 'Reminders',
      'nav.charts': 'Charts',
      'nav.vehicles': 'Vehicles',
      'nav.data': 'Data',
      'nav.sections': 'Sections',

      'login.password': 'Password',
      'login.submit': 'Sign in',

      'topbar.vehicle': 'Vehicle',
      'topbar.selected': 'Selected vehicle',
      'topbar.theme': 'Switch theme',

      'stat.consumption': 'Average consumption',
      'stat.consumption.hint': 'two full tanks are needed',
      'stat.costkm': 'Cost per km',
      'stat.costkm.fuel': 'fuel only {v}',
      'stat.distance': 'Total distance',
      'stat.distance.month': '{v} km/month',
      'stat.spend': 'Total spend',
      'stat.spend.fuel': 'fuel {v}',
      'stat.lastprice': 'Last price',
      'stat.avgprice': 'average {v}',
      'stat.fillups': 'Fuel-ups',
      'stat.lastfillup': 'last {v}',

      'section.dueReminders': 'Reminders due',
      'section.lastFillups': 'Latest fuel-ups',
      'section.fillups': 'Fuel-ups ({n})',
      'section.expenses': 'Expenses ({n})',
      'section.byCategory': 'Totals by category',
      'section.todo': 'To do ({n})',
      'section.done': 'Completed',
      'section.vehicles': 'Vehicles ({n})',

      'chart.consumption': 'Consumption (km/L)',
      'chart.consumptionOverTime': 'Consumption over time (km/L)',
      'chart.price': 'Price per litre (€/L)',
      'chart.byCategory': 'Spending by category (€)',
      'chart.monthly': 'Monthly costs (€)',
      'chart.series.consumption': 'Consumption',
      'chart.series.fuel': 'Fuel',
      'chart.series.other': 'Other expenses',
      'chart.average': 'average',
      'chart.averagePrice': 'average',
      'chart.empty.consumption': 'At least two full tanks are needed to calculate consumption.',
      'chart.empty.price': 'No prices recorded.',
      'chart.empty.category': 'No expenses recorded.',
      'chart.empty.monthly': 'No costs recorded.',
      'chart.empty.generic': 'Not enough data for this chart.',

      'empty.noVehicle': 'No vehicle yet',
      'empty.noVehicle.hint': 'Add your first vehicle to start logging fuel-ups.',
      'empty.fillups': 'No fuel-ups yet. Tap + to add one.',
      'empty.fillupsShort': 'No fuel-ups recorded.',
      'empty.expenses': 'No expenses yet. Tap + to add one.',
      'empty.reminders': 'No reminders yet. Tap + to add one.',

      'badge.full': 'full',
      'badge.partial': 'partial',
      'badge.odoWarning': 'odometer inconsistent',
      'badge.chainBroken': 'chain broken',
      'badge.active': 'active',
      'badge.archived': 'archived',
      'badge.overdue': 'overdue',
      'badge.dueSoon': 'due soon',
      'badge.ok': 'ok',
      'badge.done': 'done',

      'reminder.byDate': 'by {v}',
      'reminder.byOdo': 'at {v}',
      'reminder.kmLeft': '{v} km left',
      'reminder.daysLeft': '{v} days',

      'title.newFillup': 'New fuel-up',
      'title.editFillup': 'Edit fuel-up',
      'title.newExpense': 'New expense',
      'title.editExpense': 'Edit expense',
      'title.newReminder': 'New reminder',
      'title.editReminder': 'Edit reminder',
      'title.newVehicle': 'New vehicle',
      'title.editVehicle': 'Edit vehicle',
      'title.importPreview': 'Import preview',

      'field.date': 'Date',
      'field.odo': 'Odometer',
      'field.liters': 'Litres',
      'field.totalCost': 'Total cost ({cur})',
      'field.pricePerLiter': 'Price per litre ({cur}/L)',
      'field.fuelType': 'Fuel',
      'field.full': 'Filled up completely',
      'field.missed': 'Previous fuel-up not recorded',
      'field.station': 'Station',
      'field.location': 'Location',
      'field.notes': 'Notes',
      'field.category': 'Category',
      'field.cost': 'Cost ({cur})',
      'field.description': 'Description',
      'field.vendor': 'Garage / vendor',
      'field.title': 'Title',
      'field.dueDate': 'Due (date)',
      'field.dueOdo': 'Due (km)',
      'field.everyMonths': 'Repeats every (months)',
      'field.everyKm': 'Repeats every (km)',
      'field.name': 'Name',
      'field.make': 'Make',
      'field.model': 'Model',
      'field.year': 'Year',
      'field.plate': 'Plate',
      'field.tank': 'Tank (L)',
      'field.startOdo': 'Starting odometer',
      'field.archived': 'Archived',

      'action.save': 'Save',
      'action.cancel': 'Cancel',
      'action.delete': 'Delete',
      'action.import': 'Import',
      'action.preview': 'Preview',
      'action.restore': 'Restore',
      'action.select': 'Select',
      'action.done': 'Done',
      'action.addFillup': 'Add fuel-up',
      'action.addExpense': 'Add expense',
      'action.addReminder': 'Add reminder',
      'action.addVehicle': 'Add vehicle',

      'data.import': 'CSV import',
      'data.import.hint': 'Import a CSV of fuel-ups or expenses into the selected vehicle. Importing only adds: nothing is deleted.',
      'data.import.type': 'Type of data',
      'data.import.dateFormat': 'Ambiguous date format',
      'data.import.miles': 'Distances are in miles',
      'data.import.gallons': 'Volumes are in US gallons',
      'data.export': 'Export and backup',
      'data.export.fillups': 'Export fuel-ups as CSV',
      'data.export.expenses': 'Export expenses as CSV',
      'data.export.json': 'Full JSON backup',
      'data.restore': 'Restore',
      'data.restore.hint': 'Restore a JSON backup. With "replace", the current contents are deleted.',
      'data.restore.replace': 'Replace existing data',
      'data.info': 'Information',
      'data.info.unavailable': 'Information unavailable.',
      'data.language': 'Language',
      'data.language.hint': 'The choice applies to your Home Assistant user, on every device.',
      'data.language.auto': 'Automatic ({v})',

      'import.summary': '{total} rows parsed, {skipped} skipped. Preview of the first {n}:',

      'msg.needVehicle': 'Create a vehicle first',
      'msg.selectVehicle': 'Select a vehicle',
      'msg.chooseCsv': 'Choose a CSV file first',
      'msg.chooseJson': 'Choose a JSON file first',
      'msg.requiredFillup': 'Date, odometer and litres are required',
      'msg.requiredCost': 'Either the total cost or the price per litre is required',
      'msg.requiredExpense': 'Date and cost are required',
      'msg.requiredTitle': 'The title is required',
      'msg.requiredDue': 'A due date or a due odometer reading is required',
      'msg.requiredName': 'The name is required',
      'msg.savedFillup': 'Fuel-up saved',
      'msg.updatedFillup': 'Fuel-up updated',
      'msg.deletedFillup': 'Fuel-up deleted',
      'msg.savedExpense': 'Expense saved',
      'msg.deletedExpense': 'Expense deleted',
      'msg.savedReminder': 'Reminder saved',
      'msg.deletedReminder': 'Reminder deleted',
      'msg.doneReminder': 'Reminder completed',
      'msg.savedVehicle': 'Vehicle saved',
      'msg.deletedVehicle': 'Vehicle deleted',
      'msg.imported': 'Imported {n} rows ({skipped} skipped)',
      'msg.restored': 'Restored {v} vehicles, {f} fuel-ups',
      'msg.unreachable': 'Server unreachable',
      'msg.unauthenticated': 'Not authenticated',
      'msg.error': 'Error {code}',

      'confirm.deleteFillup': 'Delete this fuel-up?',
      'confirm.deleteExpense': 'Delete this expense?',
      'confirm.deleteReminder': 'Delete this reminder?',
      'confirm.deleteVehicle': 'Delete "{name}" along with all its fuel-ups, expenses and reminders?',
      'confirm.replace': 'Replace all existing data with the backup? This cannot be undone.',

      'warn.odoNotHigher': 'The odometer reading ({v}) is not higher than the last recorded one ({last}).',
      'warn.tooManyLiters': 'Litres ({v}) exceed the tank capacity ({tank} L).',
      'warn.priceRange': 'Price per litre outside the plausible range {min}–{max}.',
      'warn.futureDate': 'The date is in the future.',

      'category.maintenance': 'Maintenance',
      'category.service': 'Service',
      'category.tyres': 'Tyres',
      'category.insurance': 'Insurance',
      'category.tax': 'Road tax',
      'category.inspection': 'Inspection',
      'category.repair': 'Repair',
      'category.fine': 'Fine',
      'category.toll': 'Toll',
      'category.parking': 'Parking',
      'category.wash': 'Car wash',
      'category.accessories': 'Accessories',
      'category.other': 'Other',

      'fuel.petrol': 'Petrol',
      'fuel.diesel': 'Diesel',
      'fuel.lpg': 'LPG',
      'fuel.cng': 'CNG',
      'fuel.electric': 'Electric',
      'fuel.hybrid': 'Hybrid'
    }
  };

  var LOCALES = Object.keys(DICT);
  var NAMES = { it: 'Italiano', en: 'English' };
  var INTL = { it: 'it-IT', en: 'en-GB' };
  var FALLBACK = 'en';

  var current = FALLBACK;

  /* "it-IT,it;q=0.9,en;q=0.8" -> 'it' se supportata */
  function negotiate(acceptLanguage) {
    if (!acceptLanguage) return null;
    var parts = String(acceptLanguage).split(',').map(function (p) {
      var bits = p.trim().split(';');
      var q = 1;
      for (var i = 1; i < bits.length; i++) {
        var m = bits[i].trim().match(/^q=([0-9.]+)$/);
        if (m) q = parseFloat(m[1]);
      }
      return { tag: bits[0].trim().toLowerCase(), q: q };
    }).filter(function (p) { return p.tag; })
      .sort(function (a, b) { return b.q - a.q; });

    for (var j = 0; j < parts.length; j++) {
      var base = parts[j].tag.split('-')[0];
      if (LOCALES.indexOf(parts[j].tag) >= 0) return parts[j].tag;
      if (LOCALES.indexOf(base) >= 0) return base;
    }
    return null;
  }

  function setLocale(code) {
    current = LOCALES.indexOf(code) >= 0 ? code : FALLBACK;
    return current;
  }
  function getLocale() { return current; }
  function intlTag(code) { return INTL[code || current] || 'en-GB'; }

  /* t('msg.imported', {n: 5, skipped: 0}) */
  function t(key, params) {
    var table = DICT[current] || DICT[FALLBACK];
    var s = table[key];
    if (s === undefined) s = DICT[FALLBACK][key];
    if (s === undefined) return key;
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, function (m, name) {
      return params[name] === undefined ? m : String(params[name]);
    });
  }

  function num(n, decimals) {
    if (n === null || n === undefined || n === '' || !isFinite(n)) return '—';
    return Number(n).toLocaleString(intlTag(), {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals
    });
  }

  function date(iso) {
    if (!iso) return '';
    var d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat(intlTag(), {
      day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC'
    }).format(d);
  }

  function month(ym) {
    var p = String(ym).split('-');
    if (p.length < 2) return String(ym);
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, 1));
    return new Intl.DateTimeFormat(intlTag(), {
      month: 'short', year: '2-digit', timeZone: 'UTC'
    }).format(d);
  }

  return {
    DICT: DICT,
    LOCALES: LOCALES,
    NAMES: NAMES,
    FALLBACK: FALLBACK,
    negotiate: negotiate,
    setLocale: setLocale,
    getLocale: getLocale,
    intlTag: intlTag,
    t: t,
    num: num,
    date: date,
    month: month
  };
});
