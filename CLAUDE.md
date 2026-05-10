# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                  # Run unit tests (harness/test.js)
npm run test:regression   # Run snapshot regression tests against sensorlogs/
npm run decode:update     # Regenerate regression snapshots
npm run decode            # Decode a log file via harness/decode.js
npm start                 # Interactive BLE scanner (requires Bluetooth hardware)
```

No build step — ES modules, Node.js only.

## Architecture

Two distinct parts:

**`devices/`** — Pure decoder modules, zero external dependencies. Each file exports:
- `decoder` — implements the `Decoder` interface from `types.js`
- `tests` — array of `{ given, expected }` test cases used by `harness/test.js`

After adding a device file, register it in `main.js`.

**`harness/`** — Desktop CLI and test infrastructure using `@abandonware/noble`. Not part of the library surface; consumers bring their own BLE stack.

## Decoder Interface (types.js)

Two decode modes:

1. **Advertisement** (`advertisementDecode(Buffer) → SensorValues`): stateless, called per advertisement packet. Match via `manufacturer` (2-byte hex, e.g. `"9904"`) or `serviceUUID` (hex, e.g. `"fcd2"`) or `name`.

2. **Streaming** (`start` / `notify[]` / `stop`): stateful, multi-characteristic. `notify` entries each specify a `{ service, characteristic, onNotification }`. See `muse_v3.js` as reference.

`SensorValues` = flat `Record<string, number | string | null>`.

## Column Naming Convention

- Single value: `name_unit` (e.g. `temperature_C`)
- Grouped values: `group_name_unit` (e.g. `accelerometer_x_mg`)
- No units: `name_dimensionless`
- Non-plot fields (e.g. timestamp): `name` (no underscores)
- No extra underscores in group prefix — use camelCase: `hdrAccelerometer_x_mg` not `hdr_accelerometer_x_mg`

## Variable Format Decoders

Set `variableFormat: true` when returned keys vary per device (e.g. BTHome). Consumers serialize output as `_decoded` with `|` replacing `,` for CSV safety.

## Regression Tests

`sensorlogs/` holds captured BLE log files (`.json`) and their snapshots (`.snap.json`). Regression test diffs decoded output against snapshot. To add a new log: place `.json` in `sensorlogs/`, run `npm run decode:update` to generate the `.snap.json`, commit both.

## Adding a New Device

Two skills available — use whichever source is richer; cross-check with the other:

**`/theengs_decoder`** — Port a Theengs `.h` descriptor to `devices/<name>.js`.
Source files: `decoder/src/devices/`. Test data: `decoder/tests/BLE/test_ble.cpp`.

**`/bleparser`** (see `BLEPARSER.md`) — Port a bleparser Python decoder to `devices/<name>.js`.
Source files: `bleparser/package/bleparser/`. Test data: `bleparser/package/tests/`.

Both skills handle: offset translation, column naming, null sentinels, test derivation, `main.js` registration, and regression snapshot generation.

Cross-checking between the two implementations catches bugs (sign errors, masking, sentinel handling). When bleparser lacks a device variant, check Theengs as supplement and vice versa.

## Harness Routing

`harness/registry.js` exports `matchingDecoders(advertisement, allDecoders)` — returns all decoders whose `manufacturer`, `serviceUUID`, or `name` matches the advertisement. Multiple decoders can share the same routing key (e.g. different products with the same company ID); `harness/main.js` tries all candidates and uses the first non-null decode result.
