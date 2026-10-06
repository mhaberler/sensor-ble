// Ported from theengs/decoder src/devices/H5072_json.h (ref development), GPL-3.0.
// Govee H5072 / H5075 thermo-hygrometer.
function decode(manufacturerData) {
  if (manufacturerData == null || manufacturerData.length < 8) return null;
  if (manufacturerData[0] !== 0x88 || manufacturerData[1] !== 0xec) return null;

  // 24-bit big-endian: top bit = negative temperature, rest = temp * 10000 + hum * 10
  const raw = manufacturerData.readUIntBE(3, 3);
  const value = raw & 0x7fffff;
  const temperature =
    raw & 0x800000 ? -value / 10000 : Math.trunc(raw / 1000) / 10;

  return {
    temperature_C: temperature,
    humidity_percent: (value % 1000) / 10,
    battery_percent: manufacturerData[6],
  };
}

export const decoder = {
  decoderName: "theengs_h5072_75",
  manufacturer: "88ec",
  advertisementDecode: decode,
};

export const tests = [
  {
    given: { manufacturerData: "88ec000418ee6400" },
    expected: { temperature_C: 26.8, humidity_percent: 52.6, battery_percent: 100 },
  },
  {
    // negative temperature (sign bit set)
    given: { manufacturerData: "88ec00811f096400" },
    expected: { temperature_C: -7.3481, humidity_percent: 48.1, battery_percent: 100 },
  },
  {
    given: { manufacturerData: "88ec0004344b6400" },
    expected: { temperature_C: 27.5, humidity_percent: 53.1, battery_percent: 100 },
  },
  {
    // trailing iBeacon block after the Govee data
    given: {
      manufacturerData:
        "88ec000384e45c004c000215494e54454c4c495f524f434b535f48575075f2ffc2",
    },
    expected: { temperature_C: 23, humidity_percent: 62.8, battery_percent: 92 },
  },
];
