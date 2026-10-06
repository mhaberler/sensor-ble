# Porting Theengs decoders

[Theengs Decoder](https://github.com/theengs/decoder) describes about 120 BLE devices
in a small JSON descriptor language. This repo can turn those descriptors into plain
JavaScript decoders that [Sensor Logger](https://www.tszheichoi.com/sensorlogger) loads
as custom decoders.

The descriptors are treated as a specification. Each one is rewritten by hand as direct
`Buffer` reads and ordinary arithmetic. Nothing from the descriptor language is
interpreted at runtime.

## What is where

| Path | Purpose |
|---|---|
| [theengs/](theengs/) | Ported decoders. Custom-load files, not registered in [main.js](main.js) |
| [.claude/skills/theengs_decoder/](.claude/skills/theengs_decoder/) | Claude Code skill that drives the port |
| `.claude/skills/theengs_decoder/scripts/theengs_extract.mjs` | Fetches descriptors and their test vectors |
| `.claude/skills/theengs_decoder/scripts/theengs_compare.mjs` | Runs a ported decoder against the Theengs vectors |
| `.claude/skills/theengs_decoder/references/theengs-language.md` | The descriptor language, as the Theengs engine implements it |
| `.claude/skills/theengs_decoder/references/sensor-ble-output.md` | Matching, key naming and file templates for the output |

## With Claude Code

In this repo, run:

```
/theengs_decoder H5072 TPMS
```

or ask for a Theengs device to be ported. The skill then:

1. Asks which devices to port, if none were named.
2. Asks whether to write one file per sensor or one file with a `decoders` array.
3. Extracts descriptors and test vectors.
4. Writes the decoders and tests into `theengs/`.
5. Runs `npm test`.
6. Prints the Sensor Logger install links and lists anything it could not port.

It does not commit or push.

## By hand

The scripts need Node 18 or later and no dependencies.

**1. Pick devices.** Names are the file stems from Theengs `src/devices/`.

```sh
node .claude/skills/theengs_decoder/scripts/theengs_extract.mjs --list
```

**2. Extract.** The output has the descriptors, the units, and every test vector for
those devices with its expected result.

```sh
node .claude/skills/theengs_decoder/scripts/theengs_extract.mjs H5072
```

Add `--src <dir>` to read a local Theengs checkout instead of GitHub, or `--ref <ref>`
for another branch or commit.

**3. Translate.** Follow the two reference files above. The points that most often go
wrong:

- Every index and length in a descriptor counts hex characters. Divide by two for bytes.
  An odd index addresses a single nibble.
- Values are signed by default, but only 1-byte and 2-byte values are ever sign-extended.
- `post_proc` runs strictly left to right, with no operator precedence.
- The `tag` field is not the company ID. Take `manufacturer` from the first two bytes of
  the payload prefix in the device condition.
- Use `conditionnomac` when a descriptor has one. Decoders here never see the MAC address.

**4. Write the file** in `theengs/`, in one of two shapes.

One sensor per file, as in [theengs/h5072.js](theengs/h5072.js):

```js
export const decoder = { decoderName: "theengs_h5072_75", manufacturer: "88ec", advertisementDecode: decode };
export const tests = [{ given: { manufacturerData: "88ec000418ee6400" }, expected: { /* ... */ } }];
```

Several sensors in one file, as in [theengs/tpms.js](theengs/tpms.js). Each test names
its decoder:

```js
export const decoders = [tpms, tpmsbr];
export const tests = [{ decoderName: "theengs_tpms", given: { /* ... */ }, expected: { /* ... */ } }];
```

Files must be self-contained: no `import`, no `require`. See
[Loading a Custom Decoder into Sensor Logger](README.md#loading-a-custom-decoder-into-sensor-logger)
for the sandbox rules.

**5. Check against Theengs.**

```sh
node .claude/skills/theengs_decoder/scripts/theengs_compare.mjs theengs/h5072.js H5072
```

For each vector this prints the input, the Theengs result and the result of the new
code. Theengs prints rounded numbers, so compare to that precision, then record the
exact JavaScript value as `expected`. If the two disagree, fix the decoder, not the
expected value.

**6. Run the tests.**

```sh
npm test
```

`npm test` loads every file in `theengs/` and refuses a decoder there that has no
tests. It prints `Test failed` on a mismatch but still exits with status 0, so read the
output.

## Installing in Sensor Logger

After pushing, the link for a file is:

```
https://raw.githubusercontent.com/<owner>/<repo>/<branch>/theengs/<file>.js
```

In Sensor Logger go to Settings, Device Settings, Custom Decoders, Add Decoder, and
paste the link. Files exporting a `decoders` array need Sensor Logger 1.67 or later.

## Limits

- **Matching.** Sensor Logger picks a decoder by `manufacturer`, then `serviceUUID`,
  then `name`. A Theengs device that is identified some other way cannot be selected.
- **One decoder per manufacturer code.** Built-in decoders win. A ported decoder that
  shares a code with a built-in never runs. Theengs BM2 is an example: it uses Apple's
  `4c00`, which the built-in `airpods` decoder holds.
- **Name-matched decoders are loose.** Devices whose first bytes vary, such as the TPMS
  sensors, are matched by a substring of the device name and then only by payload length.
- **No MAC, no name inside the decoder.** Conditions on either cannot be evaluated in
  code.
- **Encrypted devices** (`*_ENCR` descriptors) are not portable.

## Licence

Theengs Decoder and this repo are both GPL-3.0. Ported files name their source
descriptor in a header comment.
