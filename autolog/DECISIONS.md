# Decisioni prese durante lo sviluppo

Registro delle scelte fatte dove SPEC.md lasciava margine. Criterio applicato:
l'opzione più semplice che rispetta i vincoli non negoziabili.

## Architettura

- **`lib/calc.js` è servito al browser sulla route `calc.js`.** Il file usa un
  wrapper UMD minimale (`module.exports` in Node, `window.AutoLogCalc` nel
  browser). Un solo algoritmo di calcolo, testato una volta sola, nessuna
  duplicazione. La route è gestita da `server.js` prima dello static di
  `public/`.
- **`onDataChanged(vehicleId, table, action)` in `lib/db.js`** è l'hook unico
  attraversato da ogni scrittura via API. Oggi non fa nulla: in FASE 2 ci si
  aggancia il publisher MQTT con `DB.addChangeListener(fn)`.
- **Le opzioni dell'add-on** vengono già lette da `<DATA_DIR>/options.json` se il
  file esiste (chiavi `password`, `secret`), con precedenza alle variabili
  d'ambiente. Così in FASE 2 non serve toccare il bootstrap.

## Calcolo

- **Ordinamento canonico** dei rifornimenti: `odo` crescente, tie-break su
  `date` e poi `id`. Il metodo pieno-a-pieno è definito sulla progressione del
  contachilometri, non su quella delle date.
- **Odo uguale o decrescente** rispetto al pieno precedente: nessun consumo e
  flag `odo_warning` sul rifornimento, mostrato in lista come badge rosso
  "km incoerenti". Il pieno resta comunque il nuovo riferimento.
- **`missed` interrompe la catena** ma il rifornimento stesso diventa il nuovo
  `lastFull`, come da specifica.
- **Media generale**: `Σ distanze valide / Σ litri validi`. In `computeStats`
  sono esposti anche `measured_km` e `measured_liters`, cioè i totali su cui la
  media è calcolata, che sono un sottoinsieme dei totali complessivi.
- **Km totali**: `max(odo) − start_odo`, con fallback su `min(odo)` quando
  `start_odo` è 0 o assente. Anche l'`odo` delle spese concorre al massimo.
- **km/mese e €/mese** sono normalizzati sull'arco temporale effettivo dei dati
  (dalla prima all'ultima data registrata) diviso 30,44 giorni.

## Import CSV

- **La convenzione numerica si deduce dal separatore**: file con `,` come
  separatore di colonna sono trattati come inglesi (`.` decimale), file con `;`
  o tabulazione come italiani (`,` decimale). Senza questa regola `10.000`
  galloni di un export Fuelly diventerebbe diecimila litri. `parseNumber` da
  sola, senza indicazione di locale, mantiene l'euristica generica.
- **`price_l` è sempre ricalcolato da `total_cost / liters`** quando entrambi
  sono noti, sia all'import sia nella coercizione del DB: il totale è la fonte
  di verità.
- **Righe senza data o senza km sono scartate** e conteggiate in `skipped`, con
  il motivo nell'elenco `errors` (mostrato in anteprima, primi 10).
- **Volume mancante ricavato da costo e prezzo** quando possibile, prima di
  scartare la riga.

## Frontend

- **Nessun router**: la vista corrente è uno stato in memoria, salvato in
  `localStorage` solo come preferenza UI. L'unica eccezione all'hash è
  `#new-fillup`, usata dallo shortcut del manifest e subito ripulita.
- **Campi numerici come `type="text"` con `inputmode="decimal"`**: `type=number`
  rifiuta la virgola decimale italiana su diverse tastiere mobili. La
  conversione avviene in `numIn()`.
- **Tema**: la scelta esplicita dell'utente vince, altrimenti si segue
  `prefers-color-scheme`. Entrambe le palette sono definite come custom
  properties, il tema scuro non è un'inversione.
- **`[hidden] { display: none !important; }`** in CSS: senza questa regola le
  classi con `display` esplicito (`.login`) ignorano l'attributo `hidden`.
- **Grafici**: gli assi Y usano tacche "gradevoli" calcolate a runtime; le
  etichette numeriche compaiono solo su primo, ultimo, massimo e minimo punto.
  Il tooltip è un elemento HTML condiviso posizionato in `fixed`, così funziona
  identico con mouse, dito e tastiera (focus sui punti).

## Sicurezza

- La password, se impostata, è confrontata in tempo costante sui digest SHA-256.
  Il cookie di sessione è `HttpOnly; SameSite=Lax` con token
  `<scadenza>.<HMAC(scadenza)>` valido 90 giorni.
- Se `AUTOLOG_SECRET` non è impostata ne viene generata una casuale all'avvio:
  di conseguenza un riavvio invalida le sessioni. Documentato nel README.

## FASE 2 — Home Assistant

- **Client MQTT scritto a mano** (`lib/mqtt.js`, ~250 righe). Il vincolo "zero
  dipendenze npm" vale anche qui, quindi niente `mqtt.js`: è implementato il
  sottoinsieme di MQTT 3.1.1 che serve (CONNECT con Last Will, PUBLISH QoS 0/1,
  SUBSCRIBE, PINGREQ, riconnessione con backoff esponenziale fino a 30 s).
  Niente QoS 2 e niente TLS: il broker è raggiungibile sulla rete interna di
  Docker. Il Supervisor dichiara `protocol: "3.1.1"` come massimo, quindi non
  serve MQTT 5.
- **Il parser accumula i byte**: TCP non garantisce che un chunk corrisponda a
  un pacchetto, e con dieci payload di discovery pubblicati in fila è la norma
  riceverne più d'uno nello stesso chunk. Coperto da test espliciti.
- **Coda dei messaggi offline** (max 500): se il broker non è raggiungibile gli
  aggiornamenti non si perdono, vengono ripubblicati alla riconnessione.
- **Debounce di 1,5 s** sulle pubblicazioni. L'import di 170 rifornimenti
  genera 170 eventi `onDataChanged`: senza debounce sarebbero 170 ricalcoli
  completi delle statistiche e altrettante pubblicazioni.
- **Un solo topic di stato per veicolo** (`autolog/<slug>/state`) con un JSON
  che contiene tutti i valori; ogni sensore lo legge con un `value_template`.
  Dieci sensori con dieci topic separati sarebbero dieci volte il traffico per
  lo stesso ricalcolo.
- **Discovery e stato sono `retained`**: dopo un riavvio di Home Assistant le
  entità si ricreano da sole senza aspettare il prossimo aggiornamento. Il
  rovescio è che un veicolo eliminato lascerebbe entità fantasma, perciò
  archiviazione ed eliminazione pubblicano un payload vuoto sul topic di
  discovery, che è il modo previsto da HA per rimuoverle.
- **Unità dei sensori monetari**: `EUR`, non `€`. Il device class `monetary`
  richiede un codice valuta ISO 4217 e ammette solo `state_class` `total` o
  `total_increasing`; `spesa_mese` usa `total` perché si azzera ogni mese,
  `spesa_totale` usa `total_increasing`. Verificato da un test che fallisce se
  qualcuno aggiunge un sensore monetario con lo state_class sbagliato.
- **I timestamp sono ISO 8601 con fuso** (`2024-01-05T00:00:00+00:00`): il
  device class `timestamp` di HA rifiuta le date secche.
- **Slug del veicolo con `_`**: `node_id` e `object_id` dei topic di discovery
  ammettono solo `[a-zA-Z0-9_-]`, quindi lo slug qui è diverso da quello usato
  per i nomi dei file CSV (che usa `-`). Due veicoli con lo stesso nome
  ricevono il suffisso dell'id per non collidere sullo stesso device.
- **Autenticazione disattivata sotto Ingress**: se `SUPERVISOR_TOKEN` è
  presente, la password interna si spegne da sola perché l'autenticazione la fa
  Home Assistant. Resta l'opzione `force_password` per chi espone anche la
  porta 8099 in chiaro.
- **Credenziali MQTT dal Supervisor**: `GET http://supervisor/services/mqtt`
  con `Authorization: Bearer $SUPERVISOR_TOKEN`, campi `host`, `port`,
  `username`, `password` (verificati sul sorgente del Supervisor). Le opzioni
  manuali hanno la precedenza, così si può puntare a un broker esterno.
- **`services: mqtt:want`, non `mqtt:need`**: con `need` l'add-on si rifiuta di
  partire se manca il broker. Con `want` l'interfaccia resta comunque usabile e
  i sensori semplicemente non compaiono.
- **`addon/` contiene una copia dell'applicazione**, sincronizzata da
  `scripts/build-addon.sh`. Il Supervisor usa la cartella dell'add-on come
  contesto di build di Docker e non può risalire alla radice del repository:
  o si duplica, o si pubblica un'immagine su un registry. La copia è generata,
  quindi è in `.gitignore`.

- **`panel_admin: false`**: di default la voce dell'add-on in barra laterale e'
  riservata al gruppo admin (`require_admin: true` in `get_panels`). Con
  `panel_admin: false` la vedono anche gli utenti non amministratori, che e'
  il caso d'uso normale di AutoLog: chi registra un rifornimento non ha motivo
  di essere admin di Home Assistant. Attenzione: il permesso e' per gruppo,
  non per utente, quindi vale per *tutti* i non admin.
- **Il valore viene letto da HA Core all'avvio**: cambiare `config.yaml` e
  ricostruire l'add-on non basta, serve un riavvio di Home Assistant Core
  perche' il pannello venga registrato di nuovo.
