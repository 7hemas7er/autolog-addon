# AutoLog — add-on per Home Assistant

Registro self-hosted di rifornimenti, consumi e manutenzione dei veicoli, in
italiano, in km / litri / €. Un sostituto personale di Fuelly che gira in casa
tua, con i sensori esposti a Home Assistant.

![AutoLog](autolog/logo.png)

- Consumi col metodo **pieno-a-pieno**, in km/L e L/100 km
- Spese, manutenzione e promemoria a scadenza chilometrica o temporale
- Più veicoli, con statistiche separate
- Grafici di consumo, prezzo al litro, spese per categoria e costi mensili
- Import CSV da **Fuelly, Fuelio e Drivvo**, export CSV e backup JSON
- Un **device Home Assistant per veicolo**, con dieci sensori storicizzati
- Interfaccia nella barra laterale via Ingress, anche per utenti non admin
- Installabile come PWA sul telefono

## Installazione

1. In Home Assistant: **Impostazioni → Add-on → Add-on Store**
2. Menu **⋮ → Repository** e incolla:

   ```
   https://github.com/7hemas7er/autolog-addon
   ```

3. Installa **AutoLog** e avvialo.

Con l'add-on **Mosquitto** installato non serve configurare niente: le
credenziali del broker vengono richieste al Supervisor all'avvio. Le opzioni
disponibili sono documentate in [autolog/DOCS.md](autolog/DOCS.md).

## Entità create

Un device per veicolo, con: consumo medio (km/L e L/100 km), costo al km,
chilometri totali, litri totali, spesa totale, spesa del mese, ultimo prezzo al
litro, ultimo rifornimento e prossima scadenza. I sensori numerici hanno
`state_class` e `unit_of_measurement` corretti, quindi entrano da soli nelle
statistiche a lungo termine.

Per registrare un rifornimento da un'automazione o da un tag NFC:

```yaml
action: mqtt.publish
data:
  topic: autolog/furgone/cmd/fillup
  payload: '{"odo": 136000, "liters": 45.2, "total_cost": 78.40, "full": 1}'
```

## Come sono calcolati i consumi

Metodo pieno-a-pieno, lo stesso di Fuelly: la distanza fra due pieni completi
divisa per i litri erogati nell'intervallo. Di conseguenza:

- il **primo** pieno non produce mai un consumo, gli manca il riferimento;
- un rifornimento **parziale** non ha un consumo proprio: i suoi litri
  confluiscono nel pieno successivo;
- spuntando **"rifornimento precedente non registrato"** la catena si
  interrompe, invece di produrre un valore falso;
- la **media generale** è una media pesata (Σ distanze / Σ litri), non la media
  dei singoli consumi.

## Scelte tecniche

**Zero dipendenze npm**, nessun build step, nessuna risorsa esterna: l'app
funziona a Internet spento. Database SQLite in un file singolo tramite il
modulo integrato `node:sqlite`. I grafici sono SVG generati a mano e il client
MQTT è scritto da zero (il sottoinsieme di MQTT 3.1.1 che serve). I file in
`autolog/public/` sono già l'artefatto: si aprono e si modificano, senza
compilare niente.

Le decisioni prese durante lo sviluppo sono in
[autolog/DECISIONS.md](autolog/DECISIONS.md).

## Test

```sh
cd autolog && npm test
```

Coprono il calcolo dei consumi (parziali, catene interrotte, media pesata,
chilometraggio incoerente, divisione per zero), il parser CSV (Fuelly in miglia
e galloni, Fuelio, CSV italiano, righe malformate), il round-trip
export/import JSON, la codifica dei pacchetti MQTT e il giro completo del
publisher contro un broker finto.

## Limiti da conoscere prima di installarlo

- **È monoutente per scelta.** Chiunque acceda all'Ingress vede e modifica
  tutti i veicoli: non ci sono profili separati per persona.
- **Architetture supportate: `amd64` e `aarch64`.** L'immagine base
  `node:24-alpine` non esiste per armv7, quindi su un Raspberry Pi a 32 bit
  non si installa.
- **Progetto personale.** È usato quotidianamente da chi lo ha scritto, ma non
  c'è alcuna garanzia di supporto: issue e pull request sono benvenute, le
  risposte possono tardare.

## Licenza

MIT — vedi [LICENSE](LICENSE).
