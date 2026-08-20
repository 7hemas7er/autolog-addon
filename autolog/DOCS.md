# AutoLog

A logbook for vehicle fuel-ups, running costs and maintenance, with Home
Assistant sensors created automatically over MQTT Discovery.

> **The interface is in Italian**, with kilometres, litres and euros. This
> documentation is in English; the app itself is not translated.

## Installation

Open the add-on from the sidebar (Ingress): there are no ports to expose and
no password to set — Home Assistant handles authentication.

The database lives at `/data/autolog.db`, inside the add-on's persistent
volume. It survives restarts and updates, and it is included in Home Assistant
backups.

## Options

| Option | Default | Description |
|---|---|---|
| `mqtt_enabled` | `true` | Publish the sensors over MQTT. Set to `false` to use the web interface only. |
| `force_password` | `false` | Re-enable the built-in password even behind Ingress. Only needed if you also expose port 8099 directly. |
| `password` | — | The built-in password, when `force_password` is on. |
| `mqtt_host` | — | Alternative MQTT broker. Leave empty to take the credentials from the Supervisor. |
| `mqtt_port` | `1883` | Port of the alternative broker. |
| `mqtt_username` | — | Username for the alternative broker. |
| `mqtt_password` | — | Password for the alternative broker. |

With the Mosquitto add-on installed there is nothing to configure: the
credentials are requested from the Supervisor at startup.

## Entities

Every non-archived vehicle gets a **device** carrying ten sensors:

| Sensor | Unit | Notes |
|---|---|---|
| Consumo medio | km/L | distance-weighted tank-to-tank average |
| Consumo medio L/100 km | L/100 km | same average, other unit |
| Costo al km | EUR/km | fuel plus other expenses |
| Chilometri totali | km | `total_increasing`, recorded as statistics |
| Litri totali | L | `total_increasing` |
| Spesa totale | EUR | `total_increasing` |
| Spesa del mese | EUR | resets each month |
| Ultimo prezzo al litro | EUR/L | |
| Ultimo rifornimento | timestamp | |
| Prossima scadenza | timestamp | the full reminder list is in the attributes |

Entity names follow the Italian interface. Numeric sensors declare the correct
`state_class` and `unit_of_measurement`, so Home Assistant records long-term
statistics for them on its own.

Availability is published on `autolog/status`, backed by an MQTT Last Will: if
the add-on stops or crashes the entities become unavailable rather than
holding a stale value.

## Logging a fuel-up from an automation

Publish to `autolog/<vehicle-slug>/cmd/fillup` the same JSON body the REST API
accepts. The slug is the vehicle name, lowercased, with every non-alphanumeric
character replaced by `_` (for example `Van` becomes `van`).

```yaml
action: mqtt.publish
data:
  topic: autolog/van/cmd/fillup
  payload: >
    {"date": "{{ now().strftime('%Y-%m-%d') }}",
     "odo": {{ states('sensor.car_odometer') | float }},
     "liters": 45.2, "total_cost": 78.40, "full": 1}
```

Omit `date` and today is used. Handy with an NFC tag stuck on the filler flap.

## Backups

The add-on is included in Home Assistant backups. On top of that, **Dati →
Backup JSON completo** downloads a readable file containing everything, which
can be restored from the same screen.
