# Changelog

## 1.3.0

- **Metric, US customary and Imperial UK units**, plus a choice of currency
  (EUR, GBP, USD, CHF, SEK, PLN, CZK, DKK, NOK, CAD, AUD), under
  **Data → Units**.
- The database always stays metric: conversion happens on display, on the MQTT
  sensors and on form input, so switching units never rewrites a record.
- The Home Assistant sensors follow the chosen units, and the L/100 km sensor
  is dropped under imperial rather than publishing a metric figure.
- US and imperial gallons are handled separately — reporting UK mileage in US
  gallons is a silent 20% error.
- Amounts are formatted with `Intl`, so the currency symbol lands where the
  language expects it.
- Fixed a chart axis that repeated the same label when the value range was
  narrower than the label precision.

## 1.2.0

- The interface is now available in **English and Italian**. The language is
  negotiated from `Accept-Language` on first load and can be overridden under
  **Data → Language**.
- Behind Ingress the choice is stored per Home Assistant user (via the
  `X-Remote-User-Id` header), so two people sharing an instance can each use
  their own language on every device.
- Numbers, dates and month names are formatted with `Intl` in the active
  locale.
- Category and fuel-type suggestions follow the interface language; values
  already saved keep the wording they were entered with.
- MQTT sensor names are deliberately unchanged, so existing entities and their
  history are untouched.

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
