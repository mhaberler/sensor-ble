# sensor-ble output rules

## Decoder API

```js
advertisementDecode(manufacturerData, serviceData)
```

- `manufacturerData`: `Buffer | undefined`, full payload, company ID in bytes 0-1.
- `serviceData`: `Record<uuid, Buffer> | undefined`, keyed by lowercase short UUID (`"fe95"`).
- Return a flat object, or `null` when the payload is not this device.
- Device name, service UUID list and MAC are **not** passed in. Guard every buffer
  access: the function is called with data from unrelated devices.

## Matching: Theengs condition to decoder fields

Sensor Logger selects a decoder by `manufacturer`, then `serviceUUID`, then `name`
(substring of the device name). `advertisementDecode` then re-checks what it can.

| Theengs condition term | sensor-ble |
|---|---|
| `manufacturerdata, index, 0, "<4+ hex>"` fixed | `manufacturer: "<first 4 hex>"`; remaining prefix checked in code |
| `uuid, index/contain, "0xfe95"` | `serviceUUID: "fe95"`; read `serviceData?.["fe95"]` |
| `name, index/contain, "X"` | `name: "X"`; cannot be re-checked in code |
| length tests, other `index` tests | checked in code (`buf.length === N / 2`) |
| `contain` on data | `buf.toString("hex").includes(...)` only if no fixed offset can be derived |
| `mac@index` | drop; use `conditionnomac` |

Rules:

- `manufacturer` is the first 2 wire bytes, taken from an index-0 condition. Never the `tag`.
- If bytes 0-1 are not fixed by the condition, do not set `manufacturer`; rely on
  `serviceUUID` or `name`.
- A decoder with none of the three fields is never selected. Report it as not portable.
- **Collisions.** Only the first decoder per `manufacturer` code is ever used, built-ins
  first. Before writing, run
  `grep -n -E "^\s*(manufacturer|serviceUUID|name):" devices/*.js theengs/*.js`.
  - Collision between requested descriptors: merge into one decoder that tries each
    layout in `registryIndex` order.
  - Collision with a built-in in `devices/`: the custom decoder would never run.
    Tell the user; do not silently produce a dead decoder.
- Name-only property conditions (`name contain`) cannot be evaluated. Prefer a data
  discriminator; otherwise tell the user which fields are affected.
- Descriptors whose `tag` third byte (`encr`) is set, or files named `*_ENCR`, need a
  key: not portable.

## Keys and values

README convention: `name_unit`, `group_name_unit`, unit `dimensionless` if none, and a
bare camelCase name with no underscore for non-plotted strings.
Units come from the extractor's `props` block.

| Theengs | sensor-ble |
|---|---|
| `tempc`, `tempc2`, `tempc_probe` | `temperature_C`, `temperature2_C`, `temperatureProbe_C` |
| `tempf` and other derived keys | drop |
| `hum` | `humidity_percent` |
| `batt` | `battery_percent` |
| `volt` | `voltage_V` |
| `pres` | `pressure_<unit from props>` (`hPa`, `bar`, ...) |
| `accx/y/z` | `acceleration_x_<unit>` ... |
| `lux`, `moi`, `fer` | `illuminance_lx`, `moisture_percent`, `fertility_uScm` |
| counters, raw ints | `<name>_dimensionless` |
| booleans (`alarm`, `open`, `lowbatt`) | `<name>_dimensionless` as 0/1 |
| strings (`mac`, `device`, `state`) | bare name: `mac`, `device`, `state` |
| `brand`, `model`, `model_id`, `type`, tag flags | drop |

- Fixed key set per decoder: a property whose condition is false is `null`, not absent.
- If layouts or packet types carry different key sets, return only the present keys and
  set `variableFormat: true`.
- No rounding in the decoder.

## Code style

- Direct `Buffer` reads and plain arithmetic. No descriptor JSON, no interpreter, no
  post_proc arrays, no hex-string slicing in the hot path.
- Check length and prefix first, return `null` early.
- Plain ASCII in comments. `const` / `let` only.
- Sandbox: single self-contained file, no `import` / `require`, only `Buffer` and
  `console` globals, no I/O.
- `decoderName`: `theengs_<model_id lowercased, non-alphanumerics to _>`. Must not equal
  a built-in name unless the user wants to override it.

## File templates

Files go in `theengs/` at the repo root. `harness/registry.js` loads every `theengs/*.js`
and `npm test` fails loudly if a decoder there has no tests. Do not touch `main.js`.

### Individual: `theengs/<model>.js`

```js
// Ported from theengs/decoder src/devices/<File>_json.h (ref <ref>), GPL-3.0.
function decode(manufacturerData) {
  if (manufacturerData == null || manufacturerData.length < 8) return null;
  if (manufacturerData[0] !== 0x88 || manufacturerData[1] !== 0xec) return null;
  // ...
  return { temperature_C: t, humidity_percent: h, battery_percent: manufacturerData[6] };
}

export const decoder = {
  decoderName: "theengs_<model>",
  manufacturer: "88ec",
  advertisementDecode: decode,
};

export const tests = [
  { given: { manufacturerData: "88ec000418ee6400" }, expected: { /* ... */ } },
];
```

### Array: `theengs/<bundle>.js`

One IIFE per decoder so helpers stay private. Each test names its decoder.

```js
// Ported from theengs/decoder (ref <ref>), GPL-3.0. Sources: A_json.h, B_json.h
const a = (() => {
  function decode(manufacturerData) { /* ... */ }
  return { decoderName: "theengs_a", name: "A", advertisementDecode: decode };
})();

const b = (() => { /* ... */ })();

export const decoders = [a, b];

export const tests = [
  { decoderName: "theengs_a", given: { manufacturerData: "..." }, expected: { /* ... */ } },
  { decoderName: "theengs_b", given: { serviceData: { fe95: "..." } }, expected: { /* ... */ } },
];
```

## Tests

- `given`: `manufacturerData` hex and/or `serviceData: { "<uuid>": "<hex>" }`, taken
  verbatim from the extractor. `name` and `mac` inputs have no place in `given`.
- `expected`: compared with `JSON.stringify`, so key order and exact float value matter.
  Compute the value the JS produces, confirm it agrees with the Theengs expected value
  to its printed precision, then record the exact JS value. Never record a value that
  disagrees with Theengs to make a test pass: fix the decoder.
- Add one negative check mentally: a foreign payload must return `null`, not throw.
- Extra vectors: scan `sensorlogs/*.json` for records whose `manufacturerData` starts
  with the decoder's `manufacturer` or whose `serviceData` starts with `<uuid>:`.
- `harness/test.js` prints `Test failed` but still exits 0. Check the output text.
