---
name: theengs_decoder
description: 'Transcribe a Theengs/decoder device .h file into a sensor-ble JavaScript decoder module and integrate it. Use when asked to add a new BLE device decoder from a Theengs .h source file, or when given a Theengs device descriptor to port.'
argument-hint: 'Path to the Theengs .h file (e.g. decoder/src/devices/Mikrotik_json.h), or device name to search for.'
user-invocable: true
---

# Theengs Decoder Transcription Skill

Transcribe a Theengs/decoder device `.h` file into a `sensor-ble` JavaScript decoder module and integrate it.

## Goal

Given a file like `decoder/src/devices/Mikrotik_json.h`, produce `devices/<name>.js` following `sensor-ble` conventions and register it in `main.js`.

---

## Theengs Decoder Format (postfix language)

Each `.h` file embeds a JSON descriptor with:

```json
{
  "brand": "...",
  "model": "...",
  "model_id": "...",
  "tag": "0708",
  "condition": [...],
  "properties": {
    "field": {
      "condition": [...],
      "decoder": [...],
      "post_proc": [...]
    }
  }
}
```

### `condition` (device match)

`["manufacturerdata", "=", <len_nibbles>, "index", <nibble_offset>, "<hex_prefix>"]`

- `len_nibbles`: total length of manufacturer data in nibbles (hex chars). Divide by 2 for byte length.
- `"index", <nibble_offset>, "<hex_prefix>"`: match hex string at nibble offset.

### `decoder` primitives

**`value_from_hex_data`**:

`["value_from_hex_data", "manufacturerdata", <nibble_offset>, <nibble_count>, <little_endian>, <signed>]`

- `nibble_offset` / 2 = byte offset into full manufacturer data buffer (includes company ID bytes)
- `nibble_count` / 2 = byte count
- `little_endian`: true -> read LE, false -> read BE
- `signed`: true -> interpret as signed integer

**`bit_static_value`**:

`["bit_static_value", "manufacturerdata", <nibble_offset>, <bit_index>, false, true]`

- Selects a **nibble** (not a byte): even nibble_offset = high nibble of byte `nibble_offset/2`, odd = low nibble
- Extracts `bit_index` (0 = LSB of that nibble)
- Returns 0 or 1
- **Critical**: two consecutive nibble offsets (e.g. 36 and 37) refer to the two nibbles of the same byte -- high and low respectively. Do NOT treat nibble offset as byte offset for bit operations.

**`static_value`**:

`["static_value", "<string>"]`

- Returns a fixed string constant regardless of payload content. Map to a bare-name key (no unit suffix), e.g. `device: "BM6 Tracker"`.

**`mac_from_hex_data`**:

`["mac_from_hex_data", "manufacturerdata", <nibble_offset>]`

- Reads 6 bytes at offset, formats as `"xx:xx:xx:xx:xx:xx"` (normal byte order)

**`revmac_from_hex_data`**:

`["revmac_from_hex_data", "servicedata", <nibble_offset>]`

- Same as `mac_from_hex_data` but reverses byte order before formatting

### `post_proc` (sequential arithmetic on decoded value)

Operations applied left-to-right, each consuming next token as operand:

- `"/"` -> divide
- `"*"` -> multiply
- `"+"` -> add
- `"-"` -> subtract
- `"%"` -> modulo
- `">"` -> right-shift (bitwise)
- `"<"` -> left-shift (bitwise)
- `"&"` -> bitwise AND
- `"abs"` -> absolute value (standalone token, no operand)

### Per-property `condition` (null guard)

`["manufacturerdata", <nibble_offset>, "!", "<sentinel_hex>"]`

If value at offset equals sentinel -> property is null (invalid/unavailable).

Per-property condition can also gate on **payload length**:

`["manufacturerdata", "=", <len_nibbles>]` -- property only decoded when payload is exactly this length.

### OR condition (multi-format devices)

Top-level `condition` can use `|` to match multiple payload variants:

`["manufacturerdata", "=", 42, "index", 0, "b103", "|", "manufacturerdata", "=", 48, "index", 0, "b103"]`

Implement in JS by checking length first, then dispatching to per-format decode logic. Return different key sets per variant (use length as the discriminator).

---

## Offset Translation: Theengs -> sensor-ble

**Theengs**: nibble offsets into the full manufacturer data hex string (company ID = bytes 0-1 = nibbles 0-3 included).

**sensor-ble**: `advertisementDecode(manufacturerData, serviceData)` receives:

- `manufacturerData`: `Buffer`, byte 0 = first byte of manufacturer data (company ID included)
- `serviceData`: `Record<uuid, Buffer>` keyed by service UUID string (e.g. `"fdcd"`), or `undefined`

**Translation**: Theengs nibble offset N -> byte offset `N / 2` into the respective Buffer. Same rule applies to both `manufacturerdata` and `servicedata` sources.

No stripping needed -- sensor-ble passes the full buffers unchanged.

### servicedata decoders

When Theengs `condition` references `"servicedata"` and `"uuid"`:

- Match `serviceData[uuid]` buffer by UUID key
- Check length and any index conditions against that buffer
- Use `serviceUUID` field on the decoder object (instead of `manufacturer`) for harness routing
- Test cases use `given: { serviceData: { "<uuid>": "<hex>" } }` format

### Inverted bit fields

Some `bit_static_value` fields are inverted (5th param `true` in Theengs = invert). Cross-check against test expectations to detect inversion. When `1 - raw_bit` matches expected output, apply inversion.

---

## Output Format: sensor-ble decoder module

Follow `devices/ruuvi.js` as template. Key rules:

### Column naming (`SensorValues` keys)

- Single value: `name_unit` (e.g. `temperature_C`, `battery_percent`)
- Grouped: `group_name_unit` (e.g. `acceleration_x_mg`)
- Flags/dimensionless: `name_dimensionless` (e.g. `flag_reed_dimensionless`)
- Non-plot string fields: bare name, no underscores (e.g. `macAddress`)
- No extra underscores in group prefix -- camelCase the group: `hdrAccelerometer_x_mg` not `hdr_accelerometer_x_mg`

### Null handling

Apply per-property `condition` sentinel check: return `null` for that field if sentinel matches.

### Module structure

```js
function decode<ModelName>(manufacturerData) {
  // 1. Match condition (length + prefix bytes)
  // 2. Read each property with Buffer methods
  // 3. Apply post_proc arithmetic
  // 4. Apply null sentinel checks
  // 5. Return SensorValues object
}

/** @type {Decoder} */
export const decoder = {
  decoderName: "<model_id_lowercase>",
  manufacturer: "<2-byte company ID hex, e.g. '0708'>",
  advertisementDecode: decode<ModelName>,
};

/** @type {Test[]} */
export const tests = [
  {
    given: { manufacturerData: "<hex string>" },
    expected: { ... },
  },
];
```

### `manufacturer` field

**Do NOT use the Theengs `tag` field directly.** The `tag` is the Bluetooth SIG company ID in little-endian (e.g. `"0708"` = company `0x0807`), but sensor-ble's `manufacturer` must match the **first 2 bytes of the actual manufacturer data payload** as seen on the wire.

Determine `manufacturer` from the `condition` prefix: e.g. condition prefix `"4f090100"` -> `manufacturer: "4f09"`.

The prefix match inside `advertisementDecode` handles full disambiguation; `manufacturer` is only used for fast routing by the harness.

---

## Test Case Derivation

Theengs test data lives in `decoder/tests/BLE/test_ble.cpp` (C++ array, not JSON files). Search for the device name with `grep -i <name> decoder/tests/BLE/test_ble.cpp`. Entries look like:

```cpp
{"Mikrotik", "TG-BT5-IN/-OUT", "4f090100..."},   // raw hex payload
"{\"tempc\":28.625,...}",                           // expected JSON (preceding line)
```

The expected JSON line immediately precedes the raw hex line for each test case.

If no test data exists: construct a synthetic hex payload consistent with the condition prefix and realistic sensor values, decode manually, and use as test case.

### Sensorlog scan

After deriving tests from `test_ble.cpp`, scan `sensorlogs/*.json` for real captured advertisements matching this decoder's manufacturer prefix. For each match found, decode the `manufacturerData` field manually and add as an additional test case. This catches real-world payloads that differ from synthetic test data and verifies the decoder against actual hardware.

---

## Integration Steps

1. Create `devices/<model_id>.js` with decode function, decoder export, tests export.
2. In `main.js`, add import and include in `decoders` array.
3. Run `npm test` -- all tests must pass.
4. If sensorlogs exist for this device, run `npm run decode:update` to capture snapshot.

---

## Example: Mikrotik TG-BT5

Source: `decoder/src/devices/Mikrotik_json.h`

Key facts:

- Theengs tag: `"0708"` (BT company ID, little-endian -- do not use directly)
- `manufacturer: "4f09"` -- first 2 bytes of condition prefix `"4f090100"`
- Condition: length 40 nibbles (20 bytes), prefix at nibble 0 = `"4f090100"`
- `tempc`: nibbles 24-27 (bytes 12-13), LE, signed, /256 -> `temperature_C`
- `accx/y/z`: nibbles 12/16/20 (bytes 6/8/10), 4 nibbles, LE, signed, /256 -> `acceleration_x_mg` etc.
- `flag_*`: `bit_static_value` at bytes 18-19, bits 0-3 -> `flag_reed_dimensionless` etc.
- `uptime`: nibbles 28-35 (bytes 14-17), 8 nibbles, LE, unsigned -> `uptime_s`
- `batt`: nibbles 38-39 (byte 19), 2 nibbles, unsigned, & 127 -> `battery_percent`

---

## Reference Files

- `decoder/src/devices/` -- all Theengs device descriptors
- `decoder/tests/` -- Theengs test data (if present)
- `devices/ruuvi.js` -- advertisement decoder template
- `devices/muse_v3.js` -- streaming decoder template
- `types.js` -- full JSDoc type definitions
- `main.js` -- decoder registry (add import + array entry here)

---

## Gotchas and Lessons Learned

### Tooling

- UTF-8 arrows in comments break string replacement tools. Use plain ASCII `->` in all comments.
- If a file was previously created (even with errors), use Edit/heredoc instead of Write on existing files.

### Technical

- Test hex strings must be exact length: an extra `00` byte causes the decoder to return `null` because the length check fails.
- Sentinel values produce extreme decoded outputs (e.g. `0x80` temp -> `-128 C`). Correct behavior; the per-property null guard handles it when present.
- Use `>>> 0` not `>> 0` for unsigned bit flag conversion -- ensures result is always unsigned even if source byte has high bits set.

### Workflow

- After adding a new decoder: run `npm run decode:update` **before** `npm run test:regression` -- no snapshot yet means regression will fail.
- Verify hex encodings: `value * scale_factor = raw_int16`, convert to LE hex bytes, check byte count matches condition length.

### Offset gotchas

- Theengs tag is not the sensor-ble manufacturer; derive `manufacturer` from the 2-byte prefix in the top-level condition.
- Nibble offsets map to byte offsets by dividing by 2 for both manufacturerdata and servicedata.
- `bit_static_value` operates on a nibble -- consecutive nibble offsets can share the same byte and require nibble-level extraction.
- Inverted bits: check Theengs invert flag (5th param) against expected test values; apply `1 - raw_bit` when needed.
- `static_value` maps to bare-name string fields in SensorValues (no unit suffix).
- Multi-format OR conditions: dispatch on payload length, separate decode paths per variant.
