# AutoLog

Registro di rifornimenti, consumi e manutenzione dei veicoli, con sensori
Home Assistant creati automaticamente via MQTT Discovery.

## Installazione

L'add-on si apre dalla barra laterale (Ingress): non serve aprire porte e non
serve una password, l'autenticazione la fa Home Assistant.

Il database vive in `/data/autolog.db`, dentro il volume persistente
dell'add-on: sopravvive ad aggiornamenti e riavvii ed è incluso nei backup
di Home Assistant.

## Opzioni

| Opzione | Default | Descrizione |
|---|---|---|
| `mqtt_enabled` | `true` | Pubblica i sensori su MQTT. Mettilo a `false` per usare solo l'interfaccia. |
| `force_password` | `false` | Riattiva la password interna anche sotto Ingress. Serve solo se esponi la porta 8099 direttamente. |
| `password` | — | La password interna, quando `force_password` è attiva. |
| `mqtt_host` | — | Broker MQTT alternativo. Se lasciato vuoto, le credenziali arrivano dal Supervisor. |
| `mqtt_port` | `1883` | Porta del broker alternativo. |
| `mqtt_username` | — | Utente del broker alternativo. |
| `mqtt_password` | — | Password del broker alternativo. |

Con l'add-on Mosquitto installato non serve configurare niente: le credenziali
vengono richieste al Supervisor all'avvio.

## Entità create

Per ogni veicolo non archiviato viene creato un **device** con dieci sensori:

| Sensore | Unità | Note |
|---|---|---|
| Consumo medio | km/L | media pesata pieno-a-pieno |
| Consumo medio L/100 km | L/100 km | stessa media, altra unità |
| Costo al km | EUR/km | carburante più altre spese |
| Chilometri totali | km | `total_increasing`, storicizzato |
| Litri totali | L | `total_increasing` |
| Spesa totale | EUR | `total_increasing` |
| Spesa del mese | EUR | si azzera ogni mese |
| Ultimo prezzo al litro | EUR/L | |
| Ultimo rifornimento | timestamp | |
| Prossima scadenza | timestamp | l'elenco completo dei promemoria è negli attributi |

I sensori numerici hanno `state_class` e `unit_of_measurement` corretti, quindi
Home Assistant li include da solo nelle statistiche a lungo termine.

I device restano disponibili finché l'add-on è in esecuzione: alla chiusura
viene pubblicato `offline` sul topic di availability `autolog/status`, e lo
stesso avviene tramite Last Will se l'add-on si interrompe di colpo.

## Registrare un rifornimento da un'automazione

Pubblica su `autolog/<slug-del-veicolo>/cmd/fillup` lo stesso corpo JSON che
accetta l'API. Lo slug è il nome del veicolo in minuscolo con i caratteri non
alfanumerici sostituiti da `_` (per esempio `Furgone` → `furgone`).

```yaml
action: mqtt.publish
data:
  topic: autolog/furgone/cmd/fillup
  payload: >
    {"date": "{{ now().strftime('%Y-%m-%d') }}",
     "odo": {{ states('sensor.auto_contachilometri') | float }},
     "liters": 45.2, "total_cost": 78.40, "full": 1}
```

Se ometti `date` viene usata la data di oggi. Utile con un tag NFC attaccato
allo sportello del serbatoio.

## Backup

L'add-on è incluso nei backup di Home Assistant. In più, da **Dati > Backup
JSON completo** scarichi un file leggibile con tutto il contenuto, ripristinabile
dalla stessa schermata.
