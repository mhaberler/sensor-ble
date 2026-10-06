# Theengs descriptor language

Verified against `src/decoder.cpp` (branch `development`). Where the upstream doc
(`docs/participate/adding-decoders.md`) and the engine differ, the engine wins.

Inputs to the engine are lowercase hex **strings**. Every index and length below is
counted in **hex characters**, not bytes.

- byte offset = index / 2, byte count = length / 2
- an odd index or odd length is nibble-aligned: read the byte(s) and shift/mask
- `manufacturerdata` includes the 2 company-ID bytes at index 0-3

## Device `condition`

Flat array evaluated left to right. No precedence: `A | B & C` means `(A | B) & C`.
On a true term followed by `|` the rest of the `|` alternatives are skipped up to the
next `&`. A nested array is one term.

| Form | Meaning |
|---|---|
| `src, OP, N, ...` | length of `src` in hex chars `OP` N (`=`, `>=`, `>`, `<=`, `<`), then continues with the test below. Without it: mfg >= 10, svc >= 4 chars |
| `src, "index", I, "hex"` | `src` has `hex` at index I |
| `src, "index", I, "!", "hex"` | negated |
| `src, "contain", "hex"` | substring anywhere. Hex-string substring: may match at an odd nibble |
| `"name", "index", I, "str"` / `"name", "contain", "str"` | device name test |
| `"uuid", "index", 0, "0xfe95"` / `"contain"` | service-data UUID; a leading `0x` is ignored |
| `src, "mac@index", I` / `"revmac@index"` | payload holds the device MAC. Not usable: see `conditionnomac` |
| `"no-mfgdata"` | advertisement has no manufacturer data |

`src` is `manufacturerdata` or `servicedata`. If the descriptor has `conditionnomac`,
translate **that** instead of `condition`; sensor-ble never sees the MAC.

Several descriptors can match the same payload. The engine takes the first in
`devices.h` order (`registryIndex` in the extractor output).

## Property `condition`

Property is emitted only when true. Terms chain with `|` / `&`, left to right.

| Form | Meaning |
|---|---|
| `src, I, "hex"` | `src` has `hex` at index I |
| `src, I, "!", "hex"` | negated (sentinel guard) |
| `src, I, "bit", B, S` | bit B (0-3) of the single hex digit at index I equals S |
| `src, OP, N` | length test |
| `"name", "contain" / "not_contain", "str"` | device name test |

## Property keys

- Leading underscores are stripped: `tempc`, `_tempc`, `__tempc` are alternative
  branches of one key, normally with mutually exclusive conditions. Later wins.
- `.cal` is not emitted; it is a scratch value for later `post_proc`.
- Properties run in file order. If a numeric decoder's data range is past the end of
  the payload, the engine stops and **drops all remaining properties**, not just that one.
- The engine adds `tempf` for every `tempc*` key (and `_in` for `_cm`). Do not port these.

## `decoder` functions

**`["value_from_hex_data", src, I, L, reverse, signed = true, float = false]`**
- `reverse` true = little-endian, false = big-endian.
- `signed` defaults to **true**, but sign extension only happens when L <= 2 (int8)
  or L == 4 (int16). Any other length is unsigned whatever the flag says.
- `float` true: the bits are an IEEE-754 32-bit float.

| L | reverse | signed | JS |
|---|---|---|---|
| 2 | - | true / false | `readInt8` / `readUInt8` |
| 4 | false | true / false | `readInt16BE` / `readUInt16BE` |
| 4 | true | true / false | `readInt16LE` / `readUInt16LE` |
| 6 | false / true | any | `readUIntBE(o, 3)` / `readUIntLE(o, 3)` |
| 8 | false / true | any | `readUInt32BE` / `readUInt32LE` |
| 8 | false / true | float | `readFloatBE` / `readFloatLE` |
| 1 | - | any | one nibble: even I `b[o] >> 4`, odd I `b[o] & 15`; unsigned (0-15 never exceeds 127) |

**`["bf_value_from_hex_data", src, I, L, reverse, signed = true]`**
Raw unsigned value `v`: result = `(v >> 8) + (v & 0xff) / 100`. If signed, L == 4 and
`v > 0x7fff`: result = `-result + 128`.

**`["value_from_bit_data", src, bitOffset, bitLength, signed = true]`**
Bit offsets, not hex chars. Bit 0 is the LSB of byte 0; the field is LSB-first across
bytes. Signed = two's complement at `bitLength`.

**`["bit_static_value", src, I, B, value0, value1]`**
Bit B (0-3) of the hex digit at index I picks `value0` or `value1`. These are return
values (often `false, true`, sometimes strings), not flags.
JS: `nibble = I % 2 ? b[I >> 1] & 15 : b[I >> 1] >> 4`, then `(nibble >> B) & 1`.

**`["static_value", value]`** constant.

**`["string_from_hex_data", src, I, L]`** the hex substring itself.
`reverse_string_from_hex_data` reverses it byte-wise. With `lookup` (pairs
`hex, value`): mapped value; no match means the key is **omitted**.

**`["ascii_from_hex_data", src, I, L]`** bytes as ASCII text; with `"is_double"` parse as number.

**`["mac_from_hex_data", src, I]`** 6 bytes, uppercase, colon separated.
`revmac_from_hex_data` reverses the byte order first.

## `post_proc`

Strict `(op, operand)` pairs applied left to right on a double. No precedence.

| Op | Effect |
|---|---|
| `/ * + -` | float arithmetic |
| `%` | truncate to integer, then modulo |
| `<` `>` | truncate to integer, then shift left / right. `">", 0` is the idiom for truncation: use `Math.trunc` |
| `&` `^` | truncate to integer, then bitwise. For values >= 2^31 use `>>> 0` or BigInt-free masking on the raw bytes instead |
| `!` | logical not |
| `abs` | truncate to integer, absolute value |
| `max`, N | clamp to at most N |
| `min`, N | clamp to at least N |
| `±`, N | value < 0 ? value + N : value - N |
| operand `".cal"` | use the `.cal` property's value (only `/ * + -`). If `.cal` is 0 the operand acts as 0: guard the division |
| `SBBT-dir` | negative "down", positive "up", zero "—" |

Truncation is toward zero (C cast): `Math.trunc`, not `Math.floor`.

After `post_proc`: numeric `lookup` (keys are hex strings compared to the truncated
value) replaces the number with a string. `"is_bool"` casts to boolean.

## `tag`

Type and scan hints only. Not the company ID. Never use it for matching.

## Test vectors

`tests/BLE/test_ble.cpp` keeps inputs and expected output in separate arrays paired
**by index**. `scripts/theengs_extract.mjs` does the pairing; do not pair by hand.
Expected numbers are printed rounded (about 9 significant digits) and include engine
extras (`brand`, `model`, `model_id`, `type`, `cidc`, `acts`, `tempf` ...) to drop.
