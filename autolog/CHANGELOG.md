# Changelog

## 1.1.0

- Integrazione con Home Assistant via MQTT Discovery: un device per veicolo con
  dieci sensori (consumo medio in km/L e L/100 km, costo al km, chilometri e
  litri totali, spesa totale e del mese, ultimo prezzo, ultimo rifornimento,
  prossima scadenza con l'elenco dei promemoria negli attributi).
- Le credenziali del broker arrivano dal Supervisor: con l'add-on Mosquitto
  installato non serve configurare nulla.
- Topic di comando `autolog/<slug>/cmd/fillup` per registrare un rifornimento
  da un'automazione o da un tag NFC.
- Availability con Last Will: se l'add-on si ferma le entità diventano non
  disponibili invece di restare sull'ultimo valore.
- Interfaccia servita dall'Ingress, autenticazione delegata a Home Assistant.
- Voce in barra laterale visibile anche agli utenti non amministratori.

## 1.0.0

- Prima versione: registro di rifornimenti, spese e promemoria per più veicoli.
- Consumi calcolati col metodo pieno-a-pieno, in km/L e L/100 km.
- Grafici SVG di consumo, prezzo al litro, spese per categoria e costi mensili.
- Import CSV compatibile con Fuelly, Fuelio e Drivvo, export CSV e backup JSON.
- Installabile come PWA, funziona con l'interfaccia in cache anche offline.
