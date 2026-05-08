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
- `little_endian`: true → read LE, false → read BE
- `signed`: true → interpret as signed integer

**`bit_static_value`**:
`["bit_static_value", "manufacturerdata", <nibble_offset>, <bit_index>, false, true]`

- Reads byte at `nibble_offset / 2`, extracts bit at `bit_index` (0 = LSB)
- Returns 0 or 1

**`mac_from_hex_data`**:
`["mac_from_hex_data", "manufacturerdata", <nibble_offset>]`

- Reads 6 bytes at offset, formats as `"xx:xx:xx:xx:xx:xx"`

### `post_proc` (sequential arithmetic on decoded value)

Operations applied left-to-right, each consuming next token as operand:

- `"/"` → divide
- `"*"` → multiply
- `"+"` → add
- `"-"` → subtract
- `"%"` → modulo
- `">"` → right-shift (bitwise)
- `"<"` → left-shift (bitwise)
- `"&"` → bitwise AND

### Per-property `condition` (null guard)

`["manufacturerdata", <nibble_offset>, "!", "<sentinel_hex>"]`

If value at offset equals sentinel → property is null (invalid/unavailable).

---

## Offset Translation: Theengs → sensor-ble

**Theengs**: nibble offsets into the full manufacturer data hex string (company ID = bytes 0–1 = nibbles 0–3 included).

**sensor-ble**: `advertisementDecode(manufacturerData)` receives a `Buffer` where byte 0 is the first byte of manufacturer data (company ID byte 0).

**Translation**: Theengs nibble offset N → byte offset `N / 2` into the `manufacturerData` Buffer.

No stripping needed — sensor-ble passes the full manufacturer data buffer unchanged.

---

## Output Format: sensor-ble decoder module

Follow `devices/ruuvi.js` as template. Key rules:

### Column naming (`SensorValues` keys)

- Single value: `name_unit` (e.g. `temperature_C`, `battery_percent`)
- Grouped: `group_name_unit` (e.g. `acceleration_x_mg`)
- Flags/dimensionless: `name_dimensionless` (e.g. `flag_reed_dimensionless`)
- Non-plot string fields: bare name, no underscores (e.g. `macAddress`)
- No extra underscores in group prefix — camelCase the group: `hdrAccelerometer_x_mg` not `hdr_accelerometer_x_mg`

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

The `tag` field in Theengs JSON is the 2-byte company ID (e.g. `"0708"`). Use as `manufacturer` in decoder. The `condition` prefix check goes inside `advertisementDecode`.

---

## Test Case Derivation

Theengs test data lives in `decoder/tests/` as JSON files. Each entry has `"manufacturerdata"` (full hex) and expected property values.

If no test data exists: construct a synthetic hex payload consistent with the condition prefix and realistic sensor values, decode manually, and use as test case.

---

## Integration Steps

1. Create `devices/<model_id>.js` with decode function, decoder export, tests export.
2. In `main.js`, add import and include in `decoders` array.
3. Run `npm test` — all tests must pass.
4. If sensorlogs exist for this device, run `npm run decode:update` to capture snapshot.

---

## Example: Mikrotik TG-BT5

Source: `decoder/src/devices/Mikrotik_json.h`

Key facts:

- Tag/manufacturer: `"0708"`
- Condition: length 40 nibbles (20 bytes), prefix at nibble 0 = `"4f090100"`
- `tempc`: nibbles 24–27 (bytes 12–13), LE, signed, ÷256 → `temperature_C`
- `accx/y/z`: nibbles 12/16/20 (bytes 6/8/10), 4 nibbles, LE, signed, ÷256 → `acceleration_x_mg` etc.
- `flag_*`: `bit_static_value` at bytes 18–19, bits 0–3 → `flag_reed_dimensionless` etc.
- `uptime`: nibbles 28–35 (bytes 14–17), 8 nibbles, LE, unsigned → `uptime_s`
- `batt`: nibbles 38–39 (byte 19), 2 nibbles, unsigned, & 127 → `battery_percent`

---

## Reference Files

- `decoder/src/devices/` — all Theengs device descriptors
- `decoder/tests/` — Theengs test data (if present)
- `devices/ruuvi.js` — advertisement decoder template
- `devices/muse_v3.js` — streaming decoder template
- `types.js` — full JSDoc type definitions
- `main.js` — decoder registry (add import + array entry here)
