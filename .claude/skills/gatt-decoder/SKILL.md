---
name: gatt-decoder
description: 'Add a sensor-ble decoder for a connectable BLE device that is queried via GATT read/notify (not a broadcast-advertisement sensor). Use when given a device to support that requires connecting, subscribing to notifications, or reading characteristics -- e.g. "add a decoder for <device>, here is the reference app / datasheet / spec". Do not use for advertisement-only broadcast sensors (see theengs_decoder skill instead) or for non-sensor-ble BLE work.'
argument-hint: 'Device name, plus any reference app/spec/datasheet path or URL.'
user-invocable: true
---

# GATT-Based Decoder Skill

Add a `sensor-ble` decoder for a device you must **connect to** and read via GATT (read/notify), as opposed to a device that broadcasts everything in its advertisement packet. If the device only needs advertisement parsing, use the `theengs_decoder` skill instead -- this skill is for the `notify[]`/`onConnect`/`start`/`stop` path.

## Why verify against real hardware

Reference apps and vendor apps encode assumptions that can be wrong or stale (wrong byte count, wrong field width, an app targeting a different firmware revision). If a live device is reachable, treat the protocol as unverified until you've confirmed it three ways: reference source, official spec/datasheet, and a live capture. Do not skip the live check just because a reference app exists -- see "Lessons learned" below for a concrete case where this mattered.

## Workflow

### 1. Gather sources

- Find a reference implementation if one exists (an app, a driver, a vendor SDK) and read the *exact* parsing code -- not a summary of it. Byte offsets are exactly the kind of detail that gets mangled in paraphrase.
- Find the official protocol spec/datasheet/software manual if one exists (often a PDF). Fetch it and read it directly (`Read` handles PDFs up to 20 pages; for a URL, download first if `WebFetch` reports the PDF as unparseable -- it still saves the raw file, which `Read` can then open with a `pages` range).
- If a live device is reachable via the `ble` MCP server (ble-mcp), use it to verify the GATT table and capture a real payload before writing any decode logic. See `references/ble-mcp-verification.md` for the exact tool sequence and what to check.

### 2. Resolve any conflict between sources

If the reference app and the spec disagree, or a live capture doesn't match what either says, do not guess -- recheck your own byte-counting first (hex string length ÷ 2 is the most common self-inflicted error), then treat the official spec as authoritative if the conflict persists. Surface the discrepancy and its resolution to the user rather than silently picking one.

### 3. Determine what's actually reachable

`sensor-ble`'s `BleApi` (see `types.js`) exposes **only `write`** -- there is no `read` primitive. Before including a field in your decoder's scope, check the real characteristic's properties (via `ble_discover`, or the spec's read/write/notify table):

- **read + notify**: fully usable via a `notify[]` entry, even if a reference app only ever polled it with a plain read.
- **read only**: unreachable through this library. Exclude from decoder scope -- do not invent an `onConnect` read path that isn't supported by `BleApi`.
- **write required to start streaming** (e.g. a command/response protocol): use `onConnect`/`start` to send the init sequence via `bleApi.write`, matching the pattern in `devices/muse_v3.js`.

### 4. Study the existing decoder API and pick a template

Read `types.js` for the full `Decoder`/`NotifyEntry`/`Test` JSDoc shapes. Pick the closest existing template in `devices/`:

- `devices/hrs.js` or `devices/rscs.js` -- simplest case: pure notify, no `onConnect`, no-op `start`/`stop`.
- `devices/cscs.js` -- notify plus per-device state (`stateById`) for derived/delta values across notifications.
- `devices/muse_v3.js` -- `onConnect` reads device info via write+await-notify round-trips, and `start` writes a command to kick off streaming.

### 5. Implement

Follow the field-naming convention in `README.md` under "Decoded Data Conventions" (`group_name_unit`, `name_unit` for single ungrouped values, `dimensionless` for unitless, no extra underscores beyond the group boundary -- e.g. `hdrAccelerometer_x_mg` not `hdr_accelerometer_x_mg`). Do not invent derived/converted-unit fields (e.g. psi alongside Pa) unless asked -- emit the native unit from the spec and let consumers convert.

Write the `decoder` object and inline `tests` array in one new file `devices/<name>.js`. Register it in `main.js` (import + append to the `decoders` array) -- `harness/test.js` will fail the whole suite if a device file exists but isn't registered there.

Include at minimum:
- One normal-value test, ideally using bytes captured from a real device.
- One test for documented error/sentinel values, if the spec defines any (e.g. `0x7FFF`/`0x7FFFFFFF` as "erroneous" sentinels are common in TE Connectivity-style protocols).

### 6. Verify

Run `npm test` (`node harness/test.js`) -- it re-registers all decoders and runs every inline `tests` array. All must pass, including pre-existing decoders (a naming collision or registry mistake breaks the whole suite, not just yours). There are no other test/regression npm scripts in this repo -- do not invent calls to `npm run decode:update` or similar; only `test`, `start`, and `decode` exist (check `package.json` if unsure).

If you captured live bytes in step 1, do a final sanity check by importing the finished decoder and running its `onNotification` functions directly against those bytes, confirming the output matches what you observed live.

## Reference Files

- `types.js` -- full JSDoc type definitions for `Decoder`, `NotifyEntry`, `BleApi`, `Test`.
- `README.md` -- "Adding a device", "Sensor BLE API", and "Decoded Data Conventions" sections.
- `main.js` -- decoder registry.
- `harness/main.js` -- reference implementation of `BleApi` (shows exactly what a consumer does with `notify`/`start`/`stop`/`onConnect`; confirms `write` is the only write-side primitive).
- `references/ble-mcp-verification.md` -- exact ble-mcp tool sequence for verifying a GATT protocol against real hardware.

## Lessons learned

- A reference app assuming a 1-byte battery characteristic was wrong -- the real device (and its official spec) used 2 bytes (level + charge-status). Live GATT discovery caught this; the reference app's source code alone would not have.
- An apparent 15-byte-vs-14-byte payload mismatch turned out to be a hex-string miscount on the analysis side, not a real protocol discrepancy -- always recount `hex.length / 2` before concluding the wire format differs from spec.
- Characteristics a reference app only ever plain-`read`s may still support `notify` on the real device (check properties, don't assume the app's chosen access pattern is the only one available) -- and the reverse also happens: some fields are genuinely read-only and must be dropped from scope rather than worked around.
