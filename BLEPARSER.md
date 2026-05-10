---
name: bleparser_decoder
description: 'Transcribe a Python bleparser decoder for a named device file into a sensor-ble JavaScript decoder module and integrate it. Use when asked to add a new BLE device decoder from a bleparser source file and a bleparser/package/bleparser has a Python file matching the device name'

argument-hint: 'Path to the bleparser Python file (e.g. bleparser/package/bleparser/qingping.py), or device name to search for.'
user-invocable: true
---

# Bleparser Transcription Skill

Transcribe a `bleparser/package/bleparser/<device>.py` file into a `sensor-ble` JavaScript decoder module and integrate it.

Upstream repo: [Ernst79/bleparser](https://github.com/Ernst79/bleparser) — local checkout at `bleparser/`.

## Goal

Given a file like `bleparser/package/bleparser/qingping.py`, produce `devices/<name>.js` following `sensor-ble` conventions and register it in `main.js`.

---

## Bleparser Python Format

Each `.py` file exports a `parse_<device>(self, data, source_mac, rssi)` function. The `data` argument is the **full manufacturer-specific adstruct** as extracted from the raw BLE advertisement:

```text
data[0]  = length byte (total adstruct size - 1)
data[1]  = type byte (0xFF = Manufacturer Specific)
data[2]  = company ID low byte
data[3]  = company ID high byte
data[4:] = payload (actual device data)
```

For **service data** parsers (uuid16-routed), `data` is the full service data adstruct:

```text
data[0]  = length byte
data[1]  = type byte (0x16 = Service Data)
data[2]  = UUID16 low byte
data[3]  = UUID16 high byte
data[4:] = payload
```

### Routing

`bleparser/__init__.py` routes to parsers using:

- `comp_id = (man_spec_data[3] << 8) | man_spec_data[2]` — for manufacturer-specific data
- `uuid16 = (service_data[3] << 8) | service_data[2]` — for service data

The condition check in `__init__.py` (e.g. `comp_id == 0x094F and data_len == 0x15`) tells you what to use for `manufacturer` and the length check.

### Python `struct.unpack` format strings

When translating `unpack("<...", data[n:])`:

- Offset `n` is a **byte offset into the full adstruct** (including len/type/companyID bytes)
- `<` = little-endian, `>` = big-endian
- Format chars: `B`=uint8, `b`=int8, `H`=uint16, `h`=int16, `I`=uint32, `i`=int32, `f`=float32

### Null sentinels

Python parsers check sentinel values (e.g. `if temperature == -128`) and either skip the field or set it to a fallback. Translate these to `field === sentinelValue ? null : value` in JS.

### Service-data parsers with TLV structure

Some parsers (e.g. `qingping.py`) walk a TLV loop:

```python
xdata_point = 14
while xdata_point < msg_length:
    xdata_id = data[xdata_point - 2]
    xdata_size = data[xdata_point - 1]
    ...
    xdata_point += xdata_size + 2
```

This means each record is `[id, size, ...data bytes...]`. Translate as a JS `while` loop reading `buf.readUInt8(offset)` for id and size.

---

## Offset Translation: bleparser -> sensor-ble

**bleparser**: byte offsets into the full adstruct (len byte at [0]).

**sensor-ble**: `advertisementDecode(manufacturerData, serviceData)` receives:

- `manufacturerData`: `Buffer`, byte 0 = first byte of manufacturer data including company ID (equivalent to `data[2]` in bleparser).
- `serviceData`: `Record<uuid, Buffer>` keyed by service UUID string (lowercase hex, e.g. `"fdcd"`), or `undefined`.

**Translation for manufacturer data**:

- bleparser `data[n]` -> sensor-ble `manufacturerData[n - 2]`
- bleparser `data[4:]` (past companyID) -> sensor-ble `manufacturerData[2]` onwards
- bleparser `unpack("<...", data[n:])` -> sensor-ble `manufacturerData.readXxx(n - 2)`

**Translation for service data**:

- bleparser `data[4:]` -> sensor-ble `serviceData["<uuid>"]` buffer starting at offset 0
- bleparser `data[n]` -> sensor-ble `buf[n - 4]` (subtract 4: len+type+uuid16 bytes)
- Use `serviceUUID` field on decoder object instead of `manufacturer`
- Test cases use `given: { serviceData: { "<uuid>": "<hex>" } }` format

**manufacturer field**: derive from the company ID bytes the Python checks (`comp_id == 0x094F` means bytes are `4F 09` in the buffer, so `manufacturer: "4f09"`).

---

## Output Format: sensor-ble decoder module

Follow `devices/ruuvi.js` as template. Key rules:

### Column naming (`SensorValues` keys)

Map Python result dict keys to sensor-ble naming conventions:

- `"temperature"` -> `temperature_C`
- `"humidity"` -> `humidity_percent`
- `"battery"` -> `battery_percent`
- `"uptime"` -> `uptime_s`
- `"acceleration x"` -> `acceleration_x_mg` (replace space with `_`)
- `"acceleration y"` -> `acceleration_y_mg`
- `"acceleration z"` -> `acceleration_z_mg`
- `"voltage"` -> `voltage_V` or `voltage_mV` depending on Python scale
- `"pressure"` -> `pressure_hPa` (check Python units)
- `"co2"` -> `co2_ppm`
- `"pm2.5"` -> `pm2_5_ugm3` (dots not valid in keys)
- `"pm10"` -> `pm10_ugm3`
- `"illuminance"` -> `illuminance_lux`
- Boolean flags: `name_dimensionless` (e.g. `switch_dimensionless`, `tilt_dimensionless`)
- Non-plot string fields: bare name, no underscores (e.g. `macAddress`, `deviceType`)
- Fields not needed by consumers (firmware, type, rssi, mac, packet, data): **omit** — bleparser-internal metadata.

### Null handling

Translate Python sentinel checks to JS null:

```js
const temperature = raw === -128 ? null : raw;
```

Translate Python `result.pop("field")` (remove field on invalid) the same way.

### Module structure

```js
function decode<ModelName>(manufacturerData) {
  // 1. Match condition (length + prefix bytes)
  // 2. Read each field with Buffer methods
  // 3. Apply scaling arithmetic
  // 4. Apply null sentinel checks
  // 5. Return SensorValues object
}

/** @type {Decoder} */
export const decoder = {
  decoderName: "<device_lowercase>",
  manufacturer: "<2-byte company ID hex, e.g. '4f09'>",
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

For service-data decoders, use `serviceUUID` instead of `manufacturer`:

```js
export const decoder = {
  decoderName: "<device_lowercase>",
  serviceUUID: "<uuid_lowercase_hex>",
  advertisementDecode: decode<ModelName>,
};
```

---

## Test Case Derivation

Bleparser test data lives in `bleparser/package/tests/test_<device>.py`. Each test calls `BleParser().parse_raw_data(data_string)` with a full raw HCI event hex string.

**Extracting manufacturer data from raw test packet:**

The raw HCI event format:

```text
04 3E <len> 02 01 <event_type> 00 <MAC 6 bytes LE> <payload_len> <ad structs...> <rssi>
```

Byte 14 (0-indexed) = `adpayload_start` for standard (non-extended) events.

To extract `manufacturerData` for the sensor-ble test:

1. Parse raw hex into bytes
2. Find the `0xFF` adstruct (manufacturer specific) in the ad payload
3. Strip the len+type bytes (first 2 bytes of adstruct): the rest is `manufacturerData`

For the Mikrotik test `"043E2202010300DD7B146E2CDC1615FF4F09010010A90000FDFF010000806BE866000062D5"`:

- Ad payload starts at byte 14 (index `0x0E`)
- `0x16 0x15 0xFF ...` = len=0x16 (22), type=0xFF, then manufacturer data
- `manufacturerData` = bytes starting at `data[16]` for 22 bytes = `"4F09010010A90000FDFF010000806BE866000062"` (company ID included)

**Verify test values** by tracing through the Python decode logic with the extracted bytes.

### Sensorlog scan

After deriving tests from Python test files, scan `sensorlogs/*.json` for real captured advertisements matching this decoder's manufacturer prefix. Add any matches as additional test cases.

### Required: include bleparser test cases

If `bleparser/package/tests/test_<device>.py` exists, **every test case in that file must be represented** in the sensor-ble `tests` array. For each test method:

1. Extract the raw hex `data_string`.
2. Derive `manufacturerData` (or `serviceData`) by locating the `0xFF` (or `0x16`) adstruct in the ad payload and stripping the len+type bytes.
3. Trace the Python decode logic with those bytes to compute expected output values.
4. Map Python result keys to sensor-ble column names (see Column naming above).
5. Omit bleparser-internal fields (`firmware`, `type`, `mac`, `rssi`, `packet`, `data`).
6. Add one `{ given, expected }` entry per Python test method.

---

## Integration Steps

1. Create `devices/<name>.js` with decode function, decoder export, tests export.
2. In `main.js`, add import and include in `decoders` array.
3. Run `npm test` — all tests must pass.
4. Run `npm run decode:update` to capture any sensorlog snapshots.

---

## Example: Mikrotik TG-BT5

Source: `bleparser/package/bleparser/mikrotik.py`
Test: `bleparser/package/tests/test_mikrotik.py`

Key facts:

- Routing: `comp_id == 0x094F and data_len == 0x15` -> `manufacturer: "4f09"` (bytes `4F 09` = `data[2..3]`)
- Data length: `data_len == 0x15` = 21 total payload; actual payload `data[4:]` = 18 bytes
- `data[4:]` decoded: `<BBHBBBBBBBbIBB>` = version(1), user_data(1), salt(2), acc_x_frac(1), acc_x(1), acc_y_frac(1), acc_y(1), acc_z_frac(1), acc_z(1), temp_frac(1), temp(1,signed), uptime(4), flags(1), batt(1) = 18 bytes
- `manufacturer: "4f09"` — first 2 bytes of manufacturerData
- Acceleration: `acc_int + acc_frac/256`; verify units against test values
- Temperature sentinel: `if temperature == -128` -> null (device type TG-BT5-IN)

Derived `manufacturerData` from test `"043E2202010300DD7B146E2CDC1615FF4F09010010A90000FDFF010000806BE866000062D5"`:

- adstruct starts at byte 14: `16 15 FF 4F 09 01 00 10 A9 00 00 FD FF 01 00 00 80 6B E8 66 00 00 62`
- `manufacturerData` = bytes after len+type = `"4F09010010A90000FDFF010000806BE866000062"` (20 bytes)

---

## Gotchas and Lessons Learned

### Offset mapping

- bleparser `data[2]`/`data[3]` = company ID = sensor-ble `manufacturerData[0]`/`manufacturerData[1]`
- bleparser `data[4]` = first payload byte = sensor-ble `manufacturerData[2]`
- Service data: bleparser `data[4]` = sensor-ble `serviceData["<uuid>"][0]`

### Python `struct` unpacking

- Python `unpack` returns a tuple; single-value `(val,) = unpack(...)` — strip the trailing comma in JS
- `<` = LE (use `readUInt16LE`, `readInt16LE`), `>` = BE (use `readUInt16BE`, `readInt16BE`)

### Data length check

- bleparser `msg_length = len(data)` is the full adstruct length
- sensor-ble should check `manufacturerData.length` = `msg_length - 2` (no len/type bytes)

### Flags as dimensionless

- Python bitfield flags (`flags & 1`, `flags & 2`) map to `flag_dimensionless` columns, not booleans
- Return the masked integer (0 or non-zero), not boolean

### Fields to omit

- `firmware`, `type`, `mac`, `rssi`, `packet`, `data` are bleparser-internal: omit from SensorValues output

### Service data UUIDs

- bleparser `uuid16 == 0xFDCD` -> sensor-ble `serviceUUID: "fdcd"` (lowercase, no `0x`)
- UUID key in `serviceData` dict: lowercase hex without `0x`

### TLV parsers

- For variable-format TLV parsers (like qingping), set `variableFormat: true` on the decoder
- Consumer serializes output as `_decoded` with `|` replacing `,`
