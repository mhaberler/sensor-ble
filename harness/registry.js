import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const rootPath = dirname(dirname(__filename));
const devicesDir = join(rootPath, "devices");
// Custom-load decoders (not registered in main.js), one `decoder` or a `decoders` array per file.
const customDir = join(rootPath, "theengs");

const decoders = [];

/**
 * Loads all decoder modules from the devices directory, plus custom decoders from theengs/.
 * @returns {Promise<{decoder: Decoder, tests: Test[], custom?: boolean}[]>} One entry per decoder.
 */
export async function getDecoders() {
  if (decoders.length > 0) return decoders;

  for (const file of fs.readdirSync(devicesDir)) {
    if (file.endsWith(".js")) {
      const filePath = join(devicesDir, file);
      const fileUrl = pathToFileURL(filePath);
      const decoderModule = await import(fileUrl.href);
      decoders.push(decoderModule);
    }
  }

  if (fs.existsSync(customDir)) {
    for (const file of fs.readdirSync(customDir)) {
      if (!file.endsWith(".js")) continue;
      const mod = await import(pathToFileURL(join(customDir, file)).href);
      const list = mod.decoders ?? [mod.decoder];
      const names = list.map((d) => d.decoderName);
      if (new Set(names).size !== names.length) {
        throw new Error(`Duplicate decoderName in theengs/${file}`);
      }
      for (const decoder of list) {
        const tests = (mod.tests ?? []).filter(
          (t) => mod.decoders == null || t.decoderName === decoder.decoderName
        );
        if (tests.length === 0) {
          throw new Error(`No tests for ${decoder.decoderName} in theengs/${file}`);
        }
        decoders.push({ decoder, tests, custom: true });
      }
    }
  }

  return decoders;
}
