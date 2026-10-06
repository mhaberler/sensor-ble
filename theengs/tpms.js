// Ported from theengs/decoder (ref development), GPL-3.0.
// Sources: src/devices/TPMS_json.h, src/devices/TPMSBR_json.h

// Generic TPMS tire sensor. Matched by device name: bytes 0-1 vary per wheel.
const tpms = (() => {
  function decode(manufacturerData) {
    if (manufacturerData == null || manufacturerData.length !== 18) return null;
    const mac = [];
    for (let i = 2; i < 8; i++) {
      mac.push(manufacturerData[i].toString(16).padStart(2, "0").toUpperCase());
    }
    return {
      count_dimensionless: (manufacturerData[2] & 0x0f) + 1,
      pressure_bar: manufacturerData.readUInt32LE(8) / 100000,
      temperature_C: manufacturerData.readUInt32LE(12) / 100,
      battery_percent: manufacturerData.readInt8(16),
      alarm_dimensionless: manufacturerData[17] & 1,
      mac: mac.join(":"),
    };
  }
  return {
    decoderName: "theengs_tpms",
    name: "TPMS",
    advertisementDecode: decode,
  };
})();

// "BR" TPMS tire sensor. Matched by device name.
const tpmsbr = (() => {
  function decode(manufacturerData) {
    if (manufacturerData == null || manufacturerData.length !== 7) return null;
    return {
      temperature_C: manufacturerData.readInt8(2),
      // raw is psi * 10 absolute -> bar gauge
      pressure_bar: (manufacturerData.readUInt16BE(3) / 10 - 14.5) / 14.5,
      voltage_V: manufacturerData.readInt8(1) / 10,
    };
  }
  return {
    decoderName: "theengs_tpmsbr",
    name: "BR",
    advertisementDecode: decode,
  };
})();

export const decoders = [tpms, tpmsbr];

export const tests = [
  {
    decoderName: "theengs_tpms",
    given: { manufacturerData: "000180eacaddeefff46503007c0c00003300" },
    expected: {
      count_dimensionless: 1,
      pressure_bar: 2.22708,
      temperature_C: 31.96,
      battery_percent: 51,
      alarm_dimensionless: 0,
      mac: "80:EA:CA:DD:EE:FF",
    },
  },
  {
    decoderName: "theengs_tpms",
    given: { manufacturerData: "000182eacaddeeff11fc0300aa0600005300" },
    expected: {
      count_dimensionless: 3,
      pressure_bar: 2.61137,
      temperature_C: 17.06,
      battery_percent: 83,
      alarm_dimensionless: 0,
      mac: "82:EA:CA:DD:EE:FF",
    },
  },
  {
    decoderName: "theengs_tpmsbr",
    given: { manufacturerData: "401e1001a79692" },
    expected: { temperature_C: 16, pressure_bar: 1.9172413793103447, voltage_V: 3 },
  },
  {
    decoderName: "theengs_tpmsbr",
    given: { manufacturerData: "401e0f01a70ffa" },
    expected: { temperature_C: 15, pressure_bar: 1.9172413793103447, voltage_V: 3 },
  },
  {
    decoderName: "theengs_tpmsbr",
    given: { manufacturerData: "281e1401558536" },
    expected: { temperature_C: 20, pressure_bar: 1.3517241379310345, voltage_V: 3 },
  },
];
