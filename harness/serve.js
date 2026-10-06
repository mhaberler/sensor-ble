// Serves decoder files from theengs/ and local/ over HTTP so Sensor Logger on the same
// network can load them. local/ holds private keys: only run this on a network you trust.
import fs from "fs";
import http from "http";
import os from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const rootPath = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT ?? 8080);
const dirs = ["theengs", "local"];

function listFiles() {
  return dirs.flatMap((dir) => {
    const path = join(rootPath, dir);
    if (!fs.existsSync(path)) return [];
    return fs.readdirSync(path).filter((f) => f.endsWith(".js")).map((f) => `/${dir}/${f}`);
  });
}

const server = http.createServer((req, res) => {
  const match = /^\/(theengs|local)\/([\w.-]+\.js)$/.exec(req.url.split("?")[0]);
  const file = match && join(rootPath, match[1], match[2]);
  if (req.method !== "GET" || !file || !fs.existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found\n");
    return;
  }
  console.log(new Date().toISOString(), req.socket.remoteAddress, req.url);
  res.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(fs.readFileSync(file));
});

server.listen(port, () => {
  const hosts = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
  console.log("Serving decoders. Add one of these URLs in Sensor Logger:");
  for (const host of hosts) {
    for (const file of listFiles()) console.log(`  http://${host}:${port}${file}`);
  }
});
