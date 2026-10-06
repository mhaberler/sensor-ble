#!/usr/bin/env node
// Extract Theengs decoder descriptors and their test vectors as JSON.
//
//   node theengs_extract.mjs --list [--src <checkout>]
//   node theengs_extract.mjs [--src <checkout>] [--ref <git ref>] <name>...
//
// <name> is a device file stem (H5072, TPMS, BM2 ...), case-insensitive.
// --src reads a local theengs/decoder checkout instead of GitHub.
// Output: { ref, devices: [{ file, descriptors, props, tests }] } on stdout.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
let src = null;
let ref = "development";
let list = false;
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--src") src = args[++i];
  else if (args[i] === "--ref") ref = args[++i];
  else if (args[i] === "--list") list = true;
  else names.push(args[i]);
}

async function read(rel) {
  if (src) return fs.readFileSync(path.join(src, rel), "utf8");
  const url = `https://raw.githubusercontent.com/theengs/decoder/${ref}/${rel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.text();
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// Unescape one C string literal body (without the surrounding quotes).
function cString(body) {
  return JSON.parse(`"${body}"`);
}

// Split a C initializer block into rows of string literals.
// Top-level strings become single-element rows; `{...}` groups become rows.
function parseInitializer(text) {
  const rows = [];
  let row = null;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i);
      if (i < 0) break;
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i) + 2;
    } else if (c === "{") {
      row = [];
      i++;
    } else if (c === "}") {
      rows.push(row);
      row = null;
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const s = cString(text.slice(i + 1, j));
      if (row) row.push(s);
      else rows.push([s]);
      i = j + 1;
    } else {
      i++;
    }
  }
  return rows;
}

function arrayBlock(source, name) {
  const m = new RegExp(`\\b${name}\\s*\\[\\](?:\\[\\d+\\])?\\s*=?\\s*\\{`).exec(source);
  if (!m) throw new Error(`array ${name} not found in test_ble.cpp`);
  const start = m.index + m[0].length;
  const end = source.indexOf("\n};", start);
  return source.slice(start, end);
}

// test array -> [expected array, column names]. Column 0 is always a label.
// Taken from the loops in tests/BLE/test_ble.cpp main().
const TABLES = {
  test_servicedata: ["expected_servicedata", ["servicedata"]],
  test_mfgdata: ["expected_mfg", ["name", "manufacturerdata"]],
  test_uuid_name_svcdata: ["expected_uuid_name_svcdata", ["uuid", "name", "servicedata"]],
  test_mac_mfgsvcdata: ["expected_mac_mfgsvcdata", ["mac", "manufacturerdata", "servicedata"]],
  test_name_uuid_mfgsvcdata: ["expected_name_uuid_mfgsvcdata", ["name", "uuid", "manufacturerdata", "servicedata"]],
  test_name_mac_uuid_mfgsvcdata: ["expected_name_mac_uuid_mfgsvcdata", ["mac", "name", "uuid", "manufacturerdata", "servicedata"]],
  test_uuid: ["expected_uuid", ["uuid", "@key", "@value"]],
  test_mac_mfgdata: ["expected_mac_mfg", ["mac", "manufacturerdata"]],
};

function parseExpected(s) {
  try {
    return JSON.parse(s);
  } catch {
    return JSON.parse(s + "}"); // upstream has a few unterminated rows
  }
}

function loadTests(source) {
  const out = [];
  for (const [testName, [expName, cols]] of Object.entries(TABLES)) {
    const inputs = parseInitializer(arrayBlock(source, testName));
    const expected = parseInitializer(arrayBlock(source, expName)).map((r) => r[0]);
    if (inputs.length !== expected.length) {
      throw new Error(`${testName}: ${inputs.length} inputs vs ${expected.length} expected`);
    }
    inputs.forEach((row, i) => {
      const t = { table: testName, index: i, label: row[0] };
      cols.forEach((col, k) => {
        if (col === "@key") t[row[k + 1]] = row[k + 2];
        else if (col !== "@value") t[col] = row[k + 1];
      });
      t.expected = parseExpected(expected[i]);
      out.push(t);
    });
  }
  return out;
}

function parseDeviceFile(text, commonProps) {
  const descriptors = [];
  const props = {};
  const strRe = /const char\*\s+(_\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g;
  for (const m of text.matchAll(strRe)) {
    if (m[2] === "") continue;
    const json = JSON.parse(cString(m[2]));
    if (json.condition) descriptors.push({ symbol: m[1], ...json });
    else if (json.properties) props[m[1]] = json.properties;
  }
  for (const m of text.matchAll(/const char\*\s+(_\w+)\s*=\s*(_\w+)\s*;/g)) {
    if (commonProps[m[2]]) props[m[1]] = commonProps[m[2]];
  }
  return { descriptors, props };
}

const devicesH = await read("src/devices.h");
const files = [...devicesH.matchAll(/#include "devices\/(\w+)_json\.h"/g)].map((m) => m[1]);

if (list) {
  console.log(files.sort((a, b) => a.localeCompare(b)).join("\n"));
  process.exit(0);
}
if (names.length === 0) fail("usage: theengs_extract.mjs [--list] [--src dir] [--ref ref] <name>...");

const resolved = names.map((n) => {
  const hit = files.find((f) => f.toLowerCase() === n.toLowerCase().replace(/_json(\.h)?$/, ""));
  if (hit) return hit;
  const near = files.filter((f) => f.toLowerCase().includes(n.toLowerCase()));
  fail(`unknown device "${n}"${near.length ? `; did you mean: ${near.join(", ")}` : ""}`);
});

const commonProps = parseDeviceFile(await read("src/devices/common_props.h"), {}).props;
const allTests = loadTests(await read("tests/BLE/test_ble.cpp"));
// Registry order decides which descriptor wins when several match.
const order = [...devicesH.matchAll(/\{(_\w+),\s*_\w+\}/g)].map((m) => m[1]);

const devices = [];
for (const stem of resolved) {
  const { descriptors, props } = parseDeviceFile(await read(`src/devices/${stem}_json.h`), commonProps);
  if (descriptors.length === 0) fail(`${stem}: no descriptor found`);
  for (const d of descriptors) d.registryIndex = order.indexOf(d.symbol);
  const ids = new Set(descriptors.map((d) => d.model_id));
  devices.push({
    file: `src/devices/${stem}_json.h`,
    descriptors,
    props,
    tests: allTests.filter((t) => ids.has(t.expected.model_id)),
  });
}

// Pretty-print, but keep arrays of primitives on one line.
const pretty = JSON.stringify({ ref, devices }, null, 2).replace(
  /\[\s*((?:(?:"(?:[^"\\]|\\.)*"|-?[\d.eE+-]+|true|false|null)\s*,?\s*)+)\]/g,
  (_, body) => `[${body.replace(/\s*\n\s*/g, " ").trim()}]`,
);
console.log(pretty);
