# Design decisions

A record of the choices made where more than one option was defensible, and
why. The guiding rule was: the simplest option that satisfies the hard
constraints (zero npm dependencies, no build step, no external resources, all
URLs relative).

## Architecture

- **`lib/calc.js` is served to the browser** on the relative route `calc.js`.
  The file uses a minimal UMD wrapper (`module.exports` under Node,
  `window.AutoLogCalc` in the browser). One consumption algorithm, tested once,
  never duplicated between server and client.
- **`onDataChanged(vehicleId, table, action)` in `lib/db.js`** is the single
  hook every write passes through. It was added empty in phase one purely so
  the MQTT publisher could be attached later without touching the CRUD layer.
- **Add-on options are read from `<DATA_DIR>/options.json`** when present, with
  environment variables taking precedence.

## Consumption maths

- **Canonical ordering** of fuel-ups is by odometer ascending, tie-broken on
  date then id. Tank-to-tank is defined by odometer progression, not by dates.
- **Non-increasing odometer** against the previous full tank produces no figure
  and raises an `odo_warning` flag, shown in the list as a red badge. The
  fill-up still becomes the new reference point.
- **`missed` breaks the chain**, but the fill-up carrying the flag becomes the
  new reference.
- **The overall average** is Σ valid distance / Σ valid litres. `computeStats`
  also exposes `measured_km` and `measured_liters` — the subset the average was
  actually computed over, which is smaller than the totals.
- **Total distance** is `max(odo) − start_odo`, falling back to `min(odo)` when
  `start_odo` is zero or absent. Expense odometer readings count towards the
  maximum too.
- **Distance and cost per month** are normalised over the real span of the data
  divided by 30.44 days.

## CSV import

- **The numeric convention is inferred from the column separator**: files using
  `,` are treated as English (`.` is the decimal mark), files using `;` or tab
  as Italian (`,` is the decimal mark). Without this rule, `10.000` gallons in
  a Fuelly export would import as ten thousand litres.
- **A column literally named `price` is ambiguous** between exports: in the
  schema Fuelly documents at fuelly.com/csv-import it is the unit price, while
  other exports use it for the total paid. When no dedicated unit-price column
  exists, the decision is made from the data: a small median value (≤ 5)
  against normal volumes (≥ 5) is a unit price, not a three-euro fill-up.
- **`price_l` is always recomputed** as `total_cost / liters` when both are
  known, at import and in the database coercion layer. The total is the source
  of truth.
- **Rows without a date or an odometer reading are skipped**, counted, and the
  reason is listed in the preview.

## Frontend

- **No router.** The current view is in-memory state, persisted to
  `localStorage` only as a UI preference. The one exception is `#new-fillup`,
  used by the PWA manifest shortcut and cleared immediately.
- **Numeric fields are `type="text"` with `inputmode="decimal"`.** `type=number`
  rejects the Italian decimal comma on several mobile keyboards.
- **Theme**: an explicit user choice wins, otherwise `prefers-color-scheme`.
  Both palettes are defined as custom properties; the dark theme is a designed
  palette, not an inversion.
- **`[hidden] { display: none !important; }`** is required: without it, classes
  carrying an explicit `display` ignore the `hidden` attribute.
- **Charts** compute readable axis ticks at runtime and label only the first,
  last, highest and lowest point. The average is drawn as a dashed line and
  labelled in a legend *outside* the plot — inside, it collided with the value
  labels. The tooltip is a single shared HTML element positioned `fixed`, so it
  behaves identically for mouse, touch and keyboard focus.

## Security

- The optional password is compared in constant time over SHA-256 digests. The
  session cookie is `HttpOnly; SameSite=Lax`, carrying
  `<expiry>.<HMAC(expiry)>`, valid for 90 days.
- If `AUTOLOG_SECRET` is unset a random one is generated at startup, so a
  restart invalidates sessions.

## Home Assistant

- **The MQTT client is written from scratch** (`lib/mqtt.js`, ~250 lines). The
  zero-dependency constraint applies here too, so instead of `mqtt.js` there is
  the subset of MQTT 3.1.1 that is actually needed: CONNECT with Last Will,
  PUBLISH at QoS 0/1, SUBSCRIBE, PINGREQ, and reconnection with exponential
  backoff capped at 30 s. No QoS 2 and no TLS — the broker is reachable on the
  internal Docker network. The Supervisor advertises `protocol: "3.1.1"` as its
  maximum, so MQTT 5 would be pointless.
- **The parser accumulates bytes.** TCP makes no promise that one chunk is one
  packet, and with ten discovery payloads published back to back, receiving
  several in a single chunk is the norm rather than the exception. Both cases
  have explicit tests.
- **An offline queue** (capped at 500 messages) means updates are not lost while
  the broker is unreachable; they are republished on reconnect.
- **Publishing is debounced by 1.5 s.** Importing 170 fuel-ups fires 170
  `onDataChanged` events; without the debounce that would be 170 full statistics
  recomputations and 170 publishes.
- **One state topic per vehicle** (`autolog/<slug>/state`) carrying a single
  JSON document that every sensor reads through a `value_template`. Ten
  separate topics would mean ten times the traffic for the same recomputation.
- **Discovery and state are retained**, so entities reappear by themselves after
  a Home Assistant restart. The flip side is that a deleted vehicle would leave
  ghost entities behind, so archiving or deleting publishes an empty payload to
  the discovery topic — the mechanism Home Assistant defines for removal.
- **Monetary sensors use `EUR`, not `€`.** The `monetary` device class requires
  an ISO 4217 currency code and accepts only `total` or `total_increasing`;
  `spesa_mese` uses `total` because it resets monthly, `spesa_totale` uses
  `total_increasing`. A test fails if anyone adds a monetary sensor with the
  wrong state class.
- **Timestamps are full ISO 8601 with an offset** (`2024-01-05T00:00:00+00:00`);
  the `timestamp` device class rejects bare dates.
- **The vehicle slug uses `_`**: `node_id` and `object_id` in discovery topics
  accept only `[a-zA-Z0-9_-]`, so this slug differs from the one used for CSV
  filenames (which uses `-`). Two vehicles sharing a name get the id appended so
  they cannot collide on the same device.
- **Built-in authentication switches itself off under Ingress**: when
  `SUPERVISOR_TOKEN` is present, Home Assistant is doing the authenticating.
  `force_password` exists for anyone also exposing port 8099 in the clear.
- **Broker credentials come from `GET http://supervisor/services/mqtt`** with
  `Authorization: Bearer $SUPERVISOR_TOKEN`, returning `host`, `port`,
  `username` and `password`. Manual options take precedence, so an external
  broker can be used instead.
- **`services: mqtt:want`, not `mqtt:need`.** With `need`, the add-on refuses to
  start when no broker is present. With `want`, the interface still works and
  the sensors simply do not appear.
- **The base image is pinned in the Dockerfile.** The Supervisor passes
  `BUILD_FROM=ghcr.io/home-assistant/base:latest` and ignores a `build_from`
  declared in `build.yaml`, accepting only images from its own registry. The
  Home Assistant base image ships no Node, so the container exited with
  `node: not found` (exit 127) until the image was declared directly.
- **`arch` lists only `aarch64` and `amd64`.** `node:24-alpine` is not published
  for armv7, so declaring it would fail the build on a 32-bit Raspberry Pi.
- **`panel_admin: false`**: by default the sidebar entry is restricted to the
  admin group (`require_admin: true` in `get_panels`). Whoever logs a fuel-up
  has no reason to be a Home Assistant administrator. Note the permission is
  per *group*, not per user: it applies to every non-admin.
- **That value is read by Home Assistant Core when the panel is registered**, so
  changing `config.yaml` and rebuilding the add-on is not enough — Core has to
  restart before the new value takes effect.

## Localisation

- **Detection, then explicit choice.** The language is negotiated from
  `Accept-Language` on the server (and `navigator.languages` client-side when
  the API is unreachable), and an explicit choice always wins. Home Assistant
  does not forward the user's profile language to an Ingress add-on — only the
  browser's `Accept-Language` survives the proxy — so this is as close to
  "follow Home Assistant" as the platform allows.
- **The preference is stored per Home Assistant user**, not per browser. The
  Ingress proxy sets `X-Remote-User-Id`, so the choice is keyed on it in the
  `settings` table and follows the person across devices. Outside Ingress there
  is no user, and a single instance-wide preference is used.
- **Dictionaries live in `public/i18n.js`**, served to the browser and required
  by the server for `Accept-Language` negotiation — one file, one source of
  truth, same trick already used for `calc.js`.
- **The tests enforce the contract**: every locale must carry exactly the same
  keys, no empty values, and matching placeholders. A separate test greps
  `app.js` and `charts.js` for Italian string literals, so a hardcoded label
  fails the build rather than shipping untranslated.
- **Numbers and dates go through `Intl`**, never a hand-rolled formatter. Note
  that Italian correctly omits digit grouping for four-digit integers (`1250`,
  not `1.250`) while English groups them — that is the locale being right, not
  a bug.
- **Categories and fuel types are user data.** Only the suggestion lists are
  translated; values already stored keep the wording they were entered with.
  Translating them retroactively would rewrite the user's own records, and a
  chart would silently merge or split categories on a language switch.
- **MQTT sensor names are not localised.** The name feeds Home Assistant's
  entity naming, so changing it would rename existing entities and break their
  recorded history. Localising them would need a separate, opt-in setting.

## Units

- **The database is always metric.** Kilometres, litres and raw amounts,
  whatever the user has selected. Conversion happens on the way out (screen and
  MQTT) and on the way back in (forms), never in storage. Switching units
  therefore cannot rewrite or corrupt a single record, and `calc.js` never has
  to know a unit system exists.
- **Units are instance-wide, language is per user.** Language is cosmetic, so
  two people can differ. Units drive the `unit_of_measurement` of the Home
  Assistant sensors, and one sensor cannot carry two units, so they must be a
  single setting for the whole instance.
- **Imperial drops the L/100 km sensor** rather than publishing a metric figure
  under an imperial system. MPG also keeps the same direction as km/L (higher is
  better), unlike L/100 km, so the summary tiles do not have to invert anything.
- **US and UK gallons are different** (3.785 L vs 4.546 L) and both are offered:
  reporting UK mileage in US gallons is a classic silent 20% error.
- **Currency formatting goes through `Intl` with `currencyDisplay: 'narrowSymbol'`**,
  so the symbol lands where the language expects it (`$771.90` in English,
  `771,90 $` in Italian) and USD does not render as `US$` outside America.
- **Axis tick decimals are derived from the tick step.** A price axis spanning
  1.830 to 1.911 was rendering "1.9 1.9 1.9 1.8" before, because the label
  precision was fixed instead of following the interval.
