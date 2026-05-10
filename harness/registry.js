import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const rootPath = dirname(dirname(__filename));
const devicesDir = join(rootPath, "devices");

const decoders = [];

/**
 * Loads all decoder modules from the devices directory.
 * @returns {Promise<{decoder: Decoder, tests: Test[]}[]>} An array of decoder modules.
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

  return decoders;
}

/**
 * Returns all decoders that match the given BLE advertisement.
 * Multiple decoders can match the same routing key (manufacturer ID or service UUID);
 * callers should try each in order and use the first non-null decode result.
 * @param {object} advertisement - noble advertisement object
 * @param {{decoder: Decoder}[]} allDecoders
 * @returns {Decoder[]}
 */
export function matchingDecoders(advertisement, allDecoders) {
  return allDecoders
    .map((m) => m.decoder)
    .filter((decoder) => {
      if (decoder.name && advertisement.localName) {
        return decoder.name === advertisement.localName;
      }
      if (decoder.manufacturer && advertisement.manufacturerData) {
        const prefix = advertisement.manufacturerData.subarray(0, 2).toString("hex");
        return decoder.manufacturer === prefix;
      }
      if (decoder.serviceUUID && advertisement.serviceData) {
        return advertisement.serviceData.some((sd) => sd.uuid === decoder.serviceUUID);
      }
      return false;
    });
}
