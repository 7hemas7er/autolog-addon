# AutoLog — Home Assistant add-on

A self-hosted logbook for vehicle fuel-ups, running costs and maintenance,
with every figure exposed to Home Assistant as a proper sensor. A personal
replacement for Fuelly that lives in your own house.

![AutoLog](autolog/logo.png)

- **Tank-to-tank** fuel economy, in km/L and L/100 km
- Expenses, maintenance and reminders that fall due by date **or** by distance
- Multiple vehicles, each with its own statistics
- Charts for consumption, fuel price, spending by category and monthly costs
- CSV import from **Fuelly, Fuelio and Drivvo**, CSV export and JSON backup
- **One Home Assistant device per vehicle**, with ten long-term-statistics sensors
- Served in the sidebar through Ingress, visible to non-admin users too
- Installable as a PWA on your phone

> **The interface is in Italian, and units are km / litres / €.** That is a
> deliberate design decision, not an oversight — see [Scope](#scope) below.
> The documentation is in English so that the code and the Home Assistant
> integration are useful to everyone.

## Installation

1. In Home Assistant go to **Settings → Add-ons → Add-on Store**
2. Open the **⋮** menu, choose **Repositories**, and paste:

   ```
   https://github.com/7hemas7er/autolog-addon
   ```

3. Install **AutoLog** and start it.

If you already run the **Mosquitto** add-on there is nothing to configure: the
broker credentials are requested from the Supervisor at startup. Every option
is documented in [autolog/DOCS.md](autolog/DOCS.md).

## Entities

One device per vehicle, carrying: average consumption (km/L and L/100 km),
cost per kilometre, total distance, total litres, total spend, spend this
month, last price per litre, last fuel-up and next due reminder. Numeric
sensors declare the correct `state_class` and `unit_of_measurement`, so Home
Assistant records long-term statistics for them without any extra setup.

Availability is published on `autolog/status` and backed by an MQTT Last Will,
so if the add-on dies the entities become unavailable instead of silently
holding a stale value.

To log a fuel-up from an automation or an NFC tag on the filler flap:

```yaml
action: mqtt.publish
data:
  topic: autolog/van/cmd/fillup
  payload: '{"odo": 136000, "liters": 45.2, "total_cost": 78.40, "full": 1}'
```

The slug is the vehicle name, lowercased, with every non-alphanumeric character
replaced by `_`. Omit `date` and today is used.

## How fuel economy is calculated

Tank-to-tank, the same method Fuelly uses: the distance between two full tanks
divided by the litres put in over that interval. It follows that:

- the **first** full tank never yields a figure — there is nothing to measure from;
- a **partial** fill-up has no figure of its own; its litres roll into the next
  full tank;
- ticking **"previous fuel-up not recorded"** breaks the chain rather than
  producing a fabricated number;
- the **overall average** is distance-weighted (Σ distance / Σ litres), not the
  mean of the individual figures. Getting that wrong is the classic mistake, so
  there is a test for it.

## Design

**Zero npm dependencies, no build step, no external resources** — the app works
with the internet unplugged. Storage is a single SQLite file through Node's
built-in `node:sqlite`. The charts are hand-written SVG and the MQTT client is
implemented from scratch (just the subset of MQTT 3.1.1 that is needed). The
files under `autolog/public/` *are* the artefact: open one, edit it, reload.

The reasoning behind the non-obvious choices is recorded in
[autolog/DECISIONS.md](autolog/DECISIONS.md).

## Tests

```sh
cd autolog && npm test
```

60 tests covering the consumption maths (partial fills, broken chains,
weighted average, non-increasing odometer, division by zero), the CSV parser
(Fuelly in miles and US gallons, Fuelio, Italian CSV, malformed rows), the
JSON export/import round-trip, MQTT packet encoding including packets split
across TCP chunks, and the full publisher flow against a stub broker.

## Scope

Worth knowing before you install it:

- **The interface is Italian only.** Labels, dates and number formatting are
  Italian; units are kilometres, litres and euros. There is no translation
  layer, and adding one would touch every view.
- **It is single-user by design.** Anyone who can reach the Ingress panel sees
  and edits every vehicle. There are no per-person profiles.
- **Architectures: `amd64` and `aarch64`.** The `node:24-alpine` base image is
  not published for armv7, so 32-bit Raspberry Pi installs are not supported.
- **This is a personal project.** It is used daily by its author, but no
  support is promised. Issues and pull requests are welcome; replies may be slow.

## Licence

MIT — see [LICENSE](LICENSE).
