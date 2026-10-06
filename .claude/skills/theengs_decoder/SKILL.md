---
name: theengs_decoder
description: 'Port BLE advertisement decoders from theengs/decoder (src/devices/*_json.h) to self-contained sensor-ble JavaScript decoders with test vectors and Sensor Logger install links. Use when asked to translate, port or add a Theengs decoder or device in the sensor-ble repo. Do not use for GATT or streaming decoders (use gatt-decoder) or for bleparser sources.'
argument-hint: 'Theengs device names, e.g. "H5072 TPMS" (optional)'
user-invocable: true
allowed-tools: Bash(git remote get-url:*), Bash(git branch --show-current:*)
---

# Theengs decoder to sensor-ble

Translate Theengs descriptors into hand-written JavaScript that reads the payload
directly. The Theengs postfix descriptor language is a specification to read, never
something to embed or interpret at runtime.

Repo state at invocation:

- origin: !`git remote get-url origin 2>/dev/null || echo none`
- branch: !`git branch --show-current 2>/dev/null || echo none`

## Procedure

### 1. Get the list of decoders

If the user did not name devices, ask which ones to translate. Show the choices with:

```sh
node .claude/skills/theengs_decoder/scripts/theengs_extract.mjs --list
```

Names are file stems from Theengs `src/devices/` (`VICTRON_SBS`), not model IDs
(`VICTSBS`). If a name does not resolve, find the stem in the list.

### 2. Ask the packaging

Ask with AskUserQuestion, unless already stated:

- **Individual**: one file per sensor, each exporting `decoder`. One install link each.
- **Array**: one file exporting `decoders`. One install link for all. Needs Sensor Logger 1.67+.

For an array, also ask for the bundle file name if it is not obvious.

### 3. Extract descriptors and test vectors

```sh
node .claude/skills/theengs_decoder/scripts/theengs_extract.mjs <name>...
```

Add `--src <path>` to read a local theengs/decoder checkout instead of GitHub.
The output holds, per device file: `descriptors` (one file can hold several variants),
`props` (units), and `tests` already paired with their expected output.
Never copy test vectors or byte offsets from memory or from a summary.

### 4. Translate

Read `.claude/skills/theengs_decoder/references/theengs-language.md` and `.claude/skills/theengs_decoder/references/sensor-ble-output.md` now.

For each descriptor:

1. Map the device condition to `manufacturer` / `serviceUUID` / `name` plus in-code checks.
2. Check for matching-key collisions as described in the output rules. Stop and report a
   collision with a built-in decoder before writing anything for that device.
3. Convert every hex-char index to a byte offset and write one direct `Buffer` read per
   property, then the `post_proc` chain as ordinary arithmetic in the same order.
4. Rename keys to sensor-ble conventions. Drop engine-derived keys.

### 5. Write the files

Write to `theengs/` using the matching template from the output rules.
Do not edit `main.js` or `devices/`.

### 6. Tests

Write the file with `export const tests = [];` first, then run:

```sh
node .claude/skills/theengs_decoder/scripts/theengs_compare.mjs theengs/<file>.js <name>...
```

It prints, per Theengs vector, the `given`, the Theengs values and what the new code
returns. When the `js` values agree with the `theengs` values to their printed
precision, record `given` and the exact `js` object as a test. A vector answered by
more than one decoder in the file, or by none, is a matching bug to fix first.

Add vectors found in `sensorlogs/*.json`.
A decoder with zero Theengs vectors gets at least one synthetic vector, marked
`// synthetic` and reported to the user as unverified against Theengs.

### 7. Verify

```sh
npm test 2>&1 | grep -c "Test passed theengs_"
npm test 2>&1 | grep -A4 -E "Test failed|Error"
```

The first count must equal the number of new vectors. The second must print nothing.
On a mismatch, re-read the descriptor and the engine rule; never edit an expected value
away from the Theengs value.

### 8. Report

For each written file give the install link, built from the repo state above:

```
https://raw.githubusercontent.com/<owner>/<repo>/<branch>/theengs/<file>.js
```

Then state, briefly:

- The links work once the branch is pushed. Do not commit or push unless asked.
- `npm run qr -- <link>` makes a scannable Sensor Logger deep-link QR code, and
  `npm run serve` serves the files locally for a try before pushing.
- Install path: Sensor Logger, Settings, Device Settings, Custom Decoders, Add Decoder.
- Per decoder: how it is matched (`manufacturer`, `serviceUUID` or `name`) and the vector count.
- Anything not ported and why: MAC or name conditions, encryption, collisions, synthetic tests.

## Error handling

- Extractor exits with `unknown device`: show its suggestions and ask the user.
- Extractor cannot reach GitHub: ask for a local checkout and use `--src`.
- `theengs/` not loaded by `npm test` (no `Test passed theengs_` lines): the repo's
  `harness/registry.js` lacks the `theengs` scan. Say so; do not move files into `devices/`.
- A descriptor uses a construct missing from the language reference: read
  `src/decoder.cpp` in the Theengs repo for the exact behaviour before translating.
