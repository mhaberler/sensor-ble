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
| [harness/serve.js](harness/serve.js) | `npm run serve`: serves `theengs/` and `local/` to phones on the same network |
| [harness/qr.js](harness/qr.js) | `npm run qr`: Sensor Logger deep-link QR code for a decoder |
| [harness/victron-key.js](harness/victron-key.js) | `npm run victron:key`: writes the keyed Victron decoder from `.env` |
| `local/` | Git-ignored output: keyed decoder copies and QR images |

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

To skip the typing, make a QR code of the
[deep link](https://github.com/tszheichoi/awesome-sensor-logger/blob/main/DEEP_LINKS.md#custom-ble-decoders)
`sensorlogger://decoder/<encoded link>` and scan it with the phone (Sensor Logger 1.68
or later). This needs the `qrencode` command:

```sh
npm run qr -- https://raw.githubusercontent.com/<owner>/<repo>/<branch>/theengs/<file>.js
```

To try a decoder before pushing, serve it from this checkout and scan a code for the
local address. The phone must be on the same network. The address is plain HTTP, which
Sensor Logger may refuse.

```sh
npm run serve                       # leave running
npm run qr -- theengs/<file>.js     # in a second terminal
```

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
- **Encrypted devices** (`*_ENCR` descriptors) are not portable as they stand. The
  Victron example below shows what adding decryption by hand takes.

## Worked example: Victron Smart Battery Sense

Finished decoder: [theengs/victron_sbs.js](theengs/victron_sbs.js). It covers the
Victron Battery Monitor, Smart Battery Sense and SmartShunt, which share one record
format.

```
https://raw.githubusercontent.com/mhaberler/sensor-ble/victron-smart-battery-sense/theengs/victron_sbs.js
```

That published file holds no key. It only decodes clear-text payloads, so on its own
it shows nothing for a real device. Follow [Setup](#setup) to get a working copy.

### How it was translated

1. **Extract.** The Theengs model ID is `VICTSBS`, but the extractor takes file names:

   ```sh
   node .claude/skills/theengs_decoder/scripts/theengs_extract.mjs VICTRON_SBS
   ```

   This gave one descriptor and six test vectors.

2. **Matching.** The device condition is 50 hex characters, prefix `e10211` at index 0
   and `02ffff` at index 12. That became `manufacturer: "e102"` plus checks in code for
   a 25-byte length, byte 2, record type `02` at byte 6 and `ffff` at bytes 7-8. No
   other decoder uses `e102`.

3. **Fields.** The descriptor uses `value_from_bit_data`, whose offsets are in bits:

   | Theengs | Bits | Read as | Key |
   |---|---|---|---|
   | `ttg` | 80, 16 unsigned | bytes 10-11 | `timeToGo_min` |
   | `volt` | 96, 16 signed, / 100 | bytes 12-13 | `voltage_V` |
   | `alarm_reason` | hex index 28, 4 chars | bytes 14-15 | `alarmReason_dimensionless` |
   | `volt_aux`, `volt_mid`, `tempc` | 128, 16 signed | bytes 16-17 | `auxVoltage_V`, `midVoltage_V`, `temperature_C` |
   | `current` | 146, 22 signed, / 1000 | byte 18 from bit 2, bytes 19-20 | `current_A` |
   | `consumed_ah` | 168, 20 signed, / -10 | bytes 21-22, low nibble of 23 | `consumed_Ah` |
   | `soc` | 188, 10 unsigned, / 10 | high nibble of 23, low 6 bits of 24 | `stateOfCharge_percent` |

   Bits 0-1 of byte 18 say which of the three meanings bytes 16-17 have. The property
   conditions that test for `ff` patterns became "all bits set means not available",
   returned as `null`.

4. **Compare and test.** All six vectors agreed with Theengs and were recorded as tests:

   ```sh
   node .claude/skills/theengs_decoder/scripts/theengs_compare.mjs theengs/victron_sbs.js VICTRON_SBS
   npm test
   ```

5. **Encryption, added by hand.** Real devices send prefix `e10210` with the payload
   encrypted. The Theengs descriptor describes only the decrypted form that Theengs
   Gateway produces, so decryption is not part of the port. The decoder adds it:
   AES-128 in counter mode, one block, written in plain JavaScript because custom
   decoders cannot import a crypto library. The nonce is bytes 7-8, byte 9 is the first
   byte of the key, and the encrypted payload starts at byte 10.

### Setup

Sensor Logger gives a custom decoder no settings and no storage, so the key has to be
inside the decoder file. To keep it out of the repo, the key lives in `.env` and a
script writes a private keyed copy.

1. **Get the key.** In VictronConnect open the device, then Settings, Product info,
   Instant readout via Bluetooth, Encryption data, Show. The key is 32 hex characters.

2. **Put it in `.env`** at the repo root. `.env` is git-ignored. See
   [.env.example](.env.example).

   ```
   VICTRON_SBS_KEY=<32 hex characters>
   ```

   For several units, separate the keys with commas. Each advertisement carries the
   first byte of its key, and the decoder uses that to pick the key. Two keys that
   start with the same byte cannot be told apart, and the script refuses them.

3. **Build the keyed copy.**

   ```sh
   npm run victron:key
   ```

   This writes `local/victron_sbs.js`, which is git-ignored. It then encrypts every test
   vector with each key using Node's own AES and checks that the keyed copy decodes
   them.

4. **Serve the keyed copy.** Either from this repo on your own network:

   ```sh
   npm run serve
   ```

   This serves `theengs/*.js` and `local/*.js` on port 8080 (set `PORT` to change) and
   prints the URLs to paste, for example `http://192.168.1.20:8080/local/victron_sbs.js`.
   The phone must be on the same network. Anyone on that network can fetch the key
   while the server runs. The link is plain HTTP; if Sensor Logger refuses it, use a
   gist instead.

   With the server running, make a QR code for the phone to scan:

   ```sh
   npm run qr
   ```

   It prints the code in the terminal and writes `local/victron_sbs_qr.png`. Scanning it
   opens Sensor Logger (1.68 or newer) with the address filled in. Pass another file or
   a full URL to make a code for that instead, for example
   `npm run qr -- theengs/h5072.js`. This needs the `qrencode` command.

   Or from a secret gist, which gives an HTTPS link:

   ```sh
   gh gist create local/victron_sbs.js
   ```

   Open the gist, choose Raw, and use that link. A secret gist is unlisted, not
   protected: anyone who has the link can read the key. The key only unlocks the
   read-only broadcast values. It does not allow connecting to the device.

5. **Add it in Sensor Logger** under Settings, Device Settings, Custom Decoders, Add
   Decoder. After changing keys, rebuild, update the gist and tap refresh on the
   decoder entry.

### Known gaps

- The encrypted layout has been checked against Node's AES, not yet against a captured
  advertisement from a real device. Compare the voltage with VictronConnect after
  installing.
- The payload has no checksum, so a wrong key gives wrong values, not an error.
- Temperature is read as signed 16-bit, as Theengs does, which tops out at 54.5 C.

## Licence

Theengs Decoder and this repo are both GPL-3.0. Ported files name their source
descriptor in a header comment.
