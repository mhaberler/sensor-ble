// Format A: 21 bytes, returns level_percent + status_dimensionless
function decodeRC1010FormatA(manufacturerData) {
  const level = manufacturerData.readUInt16LE(11) / 100;
  const status = manufacturerData.readUInt16LE(13);
  return { level_percent: level, status_dimensionless: status };
}

// Format B: 24 bytes, returns serial_dimensionless + modeltype_dimensionless
function decodeRC1010FormatB(manufacturerData) {
  const serial = Math.abs(manufacturerData.readUInt32LE(9));
  const modeltype = Math.abs(manufacturerData.readUInt32LE(20));
  return { serial_dimensionless: serial, modeltype_dimensionless: modeltype };
}

function decodeRC1010(manufacturerData) {

  if (
    manufacturerData.length < 2 ||
    manufacturerData[0] !== 0xb1 ||
    manufacturerData[1] !== 0x03
  ) {
    return null;
  }
  if (manufacturerData.length === 21) return decodeRC1010FormatA(manufacturerData);
  if (manufacturerData.length === 24) return decodeRC1010FormatB(manufacturerData);

  return null;
}

/** @type {Decoder} */
export const decoder = {
  decoderName: "rc1010",
  manufacturer: "b103",
  advertisementDecode: decodeRC1010,
};

/** @type {Test[]} */
export const tests = [
  {
    given: { manufacturerData: "b1034f544f54454c45020010270000366e0f000000" },
    expected: { level_percent: 100, status_dimensionless: 0 },
  },
  {
    given: { manufacturerData: "b1034f544f54454c4502006b260000366e0f000000" },
    expected: { level_percent: 98.35, status_dimensionless: 0 },
  },
  {
    given: { manufacturerData: "b1034f544f3332383148845603132111010400022af20304" },
    expected: { serial_dimensionless: 56001608, modeltype_dimensionless: 67367466 },
  },
  // from sensorlogs/otodata.json, device F8:EE:CC:42:AF:8D
  {
    given: { manufacturerData: "b1034f544f54454c450200500f000037760f000000" },
    expected: { level_percent: 39.2, status_dimensionless: 0 },
  },
  // from sensorlogs/otodata.json, device D8:2C:C3:C6:5D:32
  {
    given: { manufacturerData: "b1034f544f54454c4502007e0e000037760f000000" },
    expected: { level_percent: 37.1, status_dimensionless: 0 },
  },
];
