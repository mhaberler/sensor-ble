// Writes local/victron_sbs.js: theengs/victron_sbs.js with the keys from .env filled in.
// The result holds private keys. local/ is git-ignored; do not publish it.
import crypto from "crypto";
import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const rootPath = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(rootPath, "theengs", "victron_sbs.js");
const target = join(rootPath, "local", "victron_sbs.js");
const MARKER = "const KEYS = [];";

function readKeys() {
  let value = process.env.VICTRON_SBS_KEY;
  const envFile = join(rootPath, ".env");
  if (value == null && fs.existsSync(envFile)) {
    const line = fs
      .readFileSync(envFile, "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith("VICTRON_SBS_KEY="));
    value = line?.slice(line.indexOf("=") + 1);
  }
  const keys = (value ?? "")
    .split(",")
    .map((k) => k.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter((k) => k !== "");
  if (keys.length === 0) {
    throw new Error("VICTRON_SBS_KEY is not set. Put it in .env, see .env.example");
  }
  for (const key of keys) {
    if (!/^[0-9a-f]{32}$/.test(key)) {
      throw new Error("VICTRON_SBS_KEY: each key must be 32 hex characters");
    }
  }
  const first = keys.map((k) => k.slice(0, 2));
  if (new Set(first).size !== first.length) {
    throw new Error("VICTRON_SBS_KEY: two keys start with the same byte and cannot be told apart");
  }
  return keys;
}

// Encrypt each clear-text test vector with each key and check the keyed file decodes it.
async function selfCheck(keys) {
  const { decoder, tests } = await import(`${pathToFileURL(target).href}?t=${Date.now()}`);
  for (const key of keys) {
    const keyBytes = Buffer.from(key, "hex");
    for (const test of tests) {
      const clear = Buffer.from(test.given.manufacturerData, "hex");
      const nonce = crypto.randomBytes(2);
      const iv = Buffer.alloc(16);
      nonce.copy(iv);
      const encrypted = Buffer.from(clear);
      encrypted[2] = 0x10;
      nonce.copy(encrypted, 7);
      encrypted[9] = keyBytes[0];
      crypto.createCipheriv("aes-128-ctr", keyBytes, iv).update(clear.subarray(10)).copy(encrypted, 10);
      const decoded = decoder.advertisementDecode(encrypted);
      if (JSON.stringify(decoded) !== JSON.stringify(test.expected)) {
        throw new Error("Self-check failed: keyed decoder did not decrypt a test vector");
      }
    }
  }
  return keys.length * tests.length;
}

const keys = readKeys();
const text = fs.readFileSync(source, "utf8");
if (!text.includes(MARKER)) {
  throw new Error(`Marker "${MARKER}" not found in theengs/victron_sbs.js`);
}
fs.mkdirSync(dirname(target), { recursive: true });
fs.writeFileSync(target, text.replace(MARKER, `const KEYS = ${JSON.stringify(keys)};`));
const checked = await selfCheck(keys);
console.log(`Wrote local/victron_sbs.js with ${keys.length} key(s), ${checked} encrypted vectors checked.`);
console.log("This file contains private keys. Do not commit or publish it.");
