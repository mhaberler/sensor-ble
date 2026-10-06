#!/usr/bin/env node
// Run a written decoder file against the Theengs vectors and print both results.
//
//   node theengs_compare.mjs <decoder file> [--src dir] [--ref ref] <name>...
//
// For every vector, each decoder in the file is tried; all non-null results are shown
// next to the Theengs expected output. The "js" line is the exact value to record
// as `expected` once it agrees with the "theengs" line.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [file, ...rest] = process.argv.slice(2);
if (!file || rest.length === 0) {
  console.error("usage: theengs_compare.mjs <decoder file> [--src dir] [--ref ref] <name>...");
  process.exit(1);
}
const extractor = path.join(path.dirname(fileURLToPath(import.meta.url)), "theengs_extract.mjs");
const extracted = JSON.parse(
  execFileSync("node", [extractor, ...rest], { maxBuffer: 64 * 1024 * 1024 }),
);
const mod = await import(pathToFileURL(path.resolve(file)).href);
const decoders = mod.decoders ?? [mod.decoder];

const hex = (s) => (s ? Buffer.from(s, "hex") : undefined);
const DROP = new Set(["brand", "model", "model_id", "type", "cidc", "acts", "cont", "track", "prmac", "ctrl", "bvpp", "encr"]);

for (const dev of extracted.devices) {
  for (const t of dev.tests) {
    const uuid = (t.uuid ?? "").replace(/^0x/, "").toLowerCase();
    const given = {};
    if (t.manufacturerdata) given.manufacturerData = t.manufacturerdata;
    if (t.servicedata) given.serviceData = { [uuid]: t.servicedata };
    const serviceData = t.servicedata ? { [uuid]: hex(t.servicedata) } : undefined;

    const theengs = Object.fromEntries(Object.entries(t.expected).filter(([k]) => !DROP.has(k)));
    console.log(`${t.expected.model_id}  ${t.table}[${t.index}]${t.name ? `  name=${t.name}` : ""}`);
    console.log(`  given    ${JSON.stringify(given)}`);
    console.log(`  theengs  ${JSON.stringify(theengs)}`);
    let hits = 0;
    for (const d of decoders) {
      let out;
      try {
        out = d.advertisementDecode(hex(t.manufacturerdata), serviceData);
      } catch (e) {
        out = `THREW ${e.message}`;
      }
      if (out == null) continue;
      hits++;
      console.log(`  js       ${JSON.stringify(out)}  (${d.decoderName})`);
    }
    if (hits === 0) console.log("  js       null from every decoder");
  }
}
