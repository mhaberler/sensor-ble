// Makes a Sensor Logger deep-link QR code for a decoder (needs Sensor Logger 1.68+).
//
//   npm run qr                          local/victron_sbs.js via `npm run serve`
//   npm run qr -- theengs/h5072.js      another file via `npm run serve`
//   npm run qr -- https://host/x.js     any decoder URL
//
// Prints the QR code in the terminal and writes local/<name>_qr.png.
// Requires the `qrencode` command (brew install qrencode / apt install qrencode).
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";

const rootPath = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = process.argv[2] ?? "local/victron_sbs.js";

function lanUrl(file) {
  if (!/^(theengs|local)\/[\w.-]+\.js$/.test(file) || !fs.existsSync(join(rootPath, file))) {
    throw new Error(`${file}: expected an existing theengs/<name>.js or local/<name>.js`);
  }
  const hosts = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))
    .map((i) => i.address);
  if (hosts.length === 0) throw new Error("No network address found");
  return `http://${hosts[0]}:${process.env.PORT ?? 8080}/${file}`;
}

const url = /^https?:\/\//.test(arg) ? arg : lanUrl(arg);
const link = `sensorlogger://decoder/${encodeURIComponent(url)}`;
const png = join(rootPath, "local", `${basename(new URL(url).pathname, ".js")}_qr.png`);

try {
  fs.mkdirSync(dirname(png), { recursive: true });
  execFileSync("qrencode", ["-o", png, "-s", "10", "-m", "4", link]);
  process.stdout.write(execFileSync("qrencode", ["-t", "ANSIUTF8", "-m", "2", link]));
} catch (error) {
  if (error.code === "ENOENT") throw new Error("qrencode not found. Install it: brew install qrencode");
  throw error;
}
console.log(url);
console.log(link);
console.log(`Wrote ${png.slice(rootPath.length + 1)}`);
if (url.startsWith("http://")) console.log("Local URL: `npm run serve` must be running when the phone scans it.");
