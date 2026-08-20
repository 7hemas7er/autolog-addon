# Changelog

## 1.1.0

- Home Assistant integration over MQTT Discovery: one device per vehicle with
  ten sensors (average consumption in km/L and L/100 km, cost per kilometre,
  total distance and litres, total and monthly spend, last price, last fuel-up,
  and next due reminder with the full reminder list in its attributes).
- Broker credentials are taken from the Supervisor: with the Mosquitto add-on
  installed, nothing needs configuring.
- Command topic `autolog/<slug>/cmd/fillup` to log a fuel-up from an automation
  or an NFC tag.
- Availability backed by an MQTT Last Will: if the add-on stops, the entities
  become unavailable instead of holding a stale value.
- Interface served through Ingress, authentication delegated to Home Assistant.
- Sidebar entry visible to non-admin users.

## 1.0.0

- First release: fuel-ups, expenses and reminders for multiple vehicles.
- Tank-to-tank fuel economy, in km/L and L/100 km.
- SVG charts for consumption, price per litre, spending by category and
  monthly costs.
- CSV import compatible with Fuelly, Fuelio and Drivvo; CSV export and JSON
  backup.
- Installable as a PWA; the interface keeps working offline from cache.
