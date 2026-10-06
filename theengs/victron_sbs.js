// Ported from theengs/decoder src/devices/VICTRON_SBS_json.h (ref development), GPL-3.0.
// Victron Battery Monitor / Smart Battery Sense / SmartShunt, record type 0x02.
//
// Live devices broadcast AES-128-CTR encrypted data (prefix e10210) and need a key per
// device. This published file holds none: `npm run victron:key` writes a private copy
// with the keys from .env (VICTRON_SBS_KEY) filled in. See THEENGS.md.
// The advertisement carries the first key byte, which selects the key.
const KEYS = [];

// --- AES-128 single block encryption (all CTR mode needs) ---
const SBOX = (() => {
  const sbox = new Uint8Array(256);
  let p = 1;
  let q = 1;
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const x = q ^ (q << 1) ^ (q << 2) ^ (q << 3) ^ (q << 4);
    sbox[p] = (x ^ (x >> 8) ^ 0x63) & 0xff;
  } while (p !== 1);
  sbox[0] = 0x63;
  return sbox;
})();

function expandKey(hex) {
  const w = new Uint8Array(176);
  for (let i = 0; i < 16; i++) w[i] = parseInt(hex.substr(i * 2, 2), 16);
  let rcon = 1;
  for (let i = 16; i < 176; i += 4) {
    let t0 = w[i - 4];
    let t1 = w[i - 3];
    let t2 = w[i - 2];
    let t3 = w[i - 1];
    if (i % 16 === 0) {
      const t = t0;
      t0 = SBOX[t1] ^ rcon;
      t1 = SBOX[t2];
      t2 = SBOX[t3];
      t3 = SBOX[t];
      rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x1b : 0)) & 0xff;
    }
    w[i] = w[i - 16] ^ t0;
    w[i + 1] = w[i - 15] ^ t1;
    w[i + 2] = w[i - 14] ^ t2;
    w[i + 3] = w[i - 13] ^ t3;
  }
  return w;
}

const xtime = (a) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;

function encryptBlock(w, block) {
  const s = Uint8Array.from(block);
  const t = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] ^= w[i];
  for (let round = 1; round <= 10; round++) {
    // SubBytes + ShiftRows
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) t[c * 4 + r] = SBOX[s[((c + r) % 4) * 4 + r]];
    }
    if (round < 10) {
      // MixColumns
      for (let c = 0; c < 16; c += 4) {
        const a0 = t[c];
        const a1 = t[c + 1];
        const a2 = t[c + 2];
        const a3 = t[c + 3];
        const x = a0 ^ a1 ^ a2 ^ a3;
        t[c] = a0 ^ x ^ xtime(a0 ^ a1);
        t[c + 1] = a1 ^ x ^ xtime(a1 ^ a2);
        t[c + 2] = a2 ^ x ^ xtime(a2 ^ a3);
        t[c + 3] = a3 ^ x ^ xtime(a3 ^ a0);
      }
    }
    for (let i = 0; i < 16; i++) s[i] = t[i] ^ w[round * 16 + i];
  }
  return s;
}

const ROUND_KEYS = KEYS.map((k) => ({ first: parseInt(k.substr(0, 2), 16), w: expandKey(k) }));

// Encrypted layout: e102 10 <model 2> <readout 1> <record 1> <nonce 2 LE> <key[0]> <cipher>.
// Returns the clear-text form Theengs uses: prefix e10211, nonce ffff, payload padded with ff.
function decrypt(m) {
  const key = ROUND_KEYS.find((k) => k.first === m[9]);
  if (key == null) return null;
  const counter = new Uint8Array(16);
  counter[0] = m[7];
  counter[1] = m[8];
  const stream = encryptBlock(key.w, counter);
  const out = Buffer.alloc(25, 0xff);
  m.copy(out, 0, 0, 7);
  out[2] = 0x11;
  out[9] = m[9];
  for (let i = 10; i < m.length; i++) out[i] = m[i] ^ stream[i - 10];
  return out;
}

function decode(manufacturerData) {
  let b = manufacturerData;
  if (b == null || b.length < 20 || b.length > 25) return null;
  if (b[0] !== 0xe1 || b[1] !== 0x02 || b[6] !== 0x02) return null;
  if (b[2] === 0x10) {
    b = decrypt(b);
    if (b == null) return null;
  } else if (b[2] !== 0x11 || b.length !== 25 || b[7] !== 0xff || b[8] !== 0xff) {
    return null;
  }

  const ttg = b.readUInt16LE(10);

  // byte 18 bits 0-1 select what bytes 16-17 hold
  const auxMode = b[18] & 0x03;

  // 22-bit signed, starts at bit 2 of byte 18
  let current = (b[18] | (b[19] << 8) | (b[20] << 16)) >> 2;
  if (current & 0x200000) current -= 0x400000;

  // 20-bit signed: bytes 21-22 and low nibble of byte 23
  let consumed = b[21] | (b[22] << 8) | ((b[23] & 0x0f) << 16);
  const consumedValid = consumed !== 0xfffff;
  if (consumed & 0x80000) consumed -= 0x100000;

  // 10-bit unsigned: high nibble of byte 23 and low 6 bits of byte 24
  const soc = (b[23] >> 4) | ((b[24] & 0x3f) << 4);

  return {
    timeToGo_min: ttg !== 0xffff ? ttg : null,
    voltage_V: b.readInt16LE(12) / 100,
    auxVoltage_V: auxMode === 0 ? b.readInt16LE(16) / 100 : null,
    midVoltage_V: auxMode === 1 ? b.readInt16LE(16) / 100 : null,
    // unit is 0.01 K
    temperature_C: auxMode === 2 ? (b.readInt16LE(16) - 27315) / 100 : null,
    current_A: b[19] !== 0xff ? current / 1000 : null,
    consumed_Ah: consumedValid ? consumed / -10 : null,
    stateOfCharge_percent: soc !== 0x3ff ? soc / 10 : null,
    alarmReason_dimensionless: b.readUInt16LE(14),
  };
}

export const decoder = {
  decoderName: "theengs_victsbs",
  manufacturer: "e102",
  advertisementDecode: decode,
};

export const tests = [
  {
    // Smart Battery Sense: voltage + temperature
    given: { manufacturerData: "e1021180a5a302ffff7bffff130500008971feff7fffffffff" },
    expected: {
      timeToGo_min: null,
      voltage_V: 12.99,
      auxVoltage_V: null,
      midVoltage_V: null,
      temperature_C: 17.5,
      current_A: null,
      consumed_Ah: null,
      stateOfCharge_percent: null,
      alarmReason_dimensionless: 0,
    },
  },
  {
    // Smart Battery Sense
    given: { manufacturerData: "e1021180a5a302ffff7bffff790500008971feff7fffffffff" },
    expected: {
      timeToGo_min: null,
      voltage_V: 14.01,
      auxVoltage_V: null,
      midVoltage_V: null,
      temperature_C: 17.5,
      current_A: null,
      consumed_Ah: null,
      stateOfCharge_percent: null,
      alarmReason_dimensionless: 0,
    },
  },
  {
    // Smart Battery Sense
    given: { manufacturerData: "e1021100a4a302ffff7cffffc60400007d73feff7fffffffff" },
    expected: {
      timeToGo_min: null,
      voltage_V: 12.22,
      auxVoltage_V: null,
      midVoltage_V: null,
      temperature_C: 22.5,
      current_A: null,
      consumed_Ah: null,
      stateOfCharge_percent: null,
      alarmReason_dimensionless: 0,
    },
  },
  {
    // Battery Monitor: all fields, aux voltage
    given: { manufacturerData: "e102110283a302ffff8d403830050000df0430feffc90080f9" },
    expected: {
      timeToGo_min: 14400,
      voltage_V: 13.28,
      auxVoltage_V: 12.47,
      midVoltage_V: null,
      temperature_C: null,
      current_A: -0.116,
      consumed_Ah: -20.1,
      stateOfCharge_percent: 92,
      alarmReason_dimensionless: 0,
    },
  },
  {
    // SmartShunt
    given: { manufacturerData: "e102110238c002ffffa6790870050000000078e3ff010070fe" },
    expected: {
      timeToGo_min: 2169,
      voltage_V: 13.92,
      auxVoltage_V: 0,
      midVoltage_V: null,
      temperature_C: null,
      current_A: -1.826,
      consumed_Ah: -0.1,
      stateOfCharge_percent: 99.9,
      alarmReason_dimensionless: 0,
    },
  },
  {
    // SmartShunt: no time-to-go, consumed or SoC
    given: { manufacturerData: "e102110238c002ffffa6ffff0d0500000000b8e0ffffffffff" },
    expected: {
      timeToGo_min: null,
      voltage_V: 12.93,
      auxVoltage_V: 0,
      midVoltage_V: null,
      temperature_C: null,
      current_A: -2.002,
      consumed_Ah: null,
      stateOfCharge_percent: null,
      alarmReason_dimensionless: 0,
    },
  },
];
