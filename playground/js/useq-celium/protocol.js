// uSEQ-Celium wire protocol — browser side.
// Mirrors firmware/useq-celium/include/protocol.h. See docs/useq-celium/protocol.md.
// If you bump the protocol, update BOTH files.

export const UC_SYNC_1 = 0xa7;
export const UC_SYNC_2 = 0x5e;

export const UC_TYPE_STATE_SNAPSHOT = 0x01;
export const UC_TYPE_FW_HELLO = 0x02;
export const UC_TYPE_ACK = 0x03;
export const UC_TYPE_RESET = 0x7f;

export const UC_EXP_I2C_ADDR = 0x42;
export const UC_EXP_TYPE_CV_UPDATE = 0xe1;

export const UC_NUM_HARD_GATES = 3;
export const UC_NUM_MAIN_CV = 3;
export const UC_NUM_EXP_CV = 8;
export const UC_NUM_CV_TOTAL = UC_NUM_MAIN_CV + UC_NUM_EXP_CV; // 11

export const UC_STATE_SNAPSHOT_LEN = 28;
export const UC_EXPANDER_FRAME_LEN = 19;

// CRC8 poly 0x07, init 0x00. Matches firmware.
export function crc8(bytes, start = 0, end = bytes.length) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

/**
 * Encode a StateSnapshot packet.
 *
 * @param {number} seq             rolling counter, caller manages
 * @param {number[]} gates         length 3, boolean-ish (truthy = high)
 * @param {number[]} cvMain        length 3, values in [0, 1]
 * @param {number[]} cvExp         length 8, values in [0, 1]
 * @returns {Uint8Array} 28-byte packet ready to write to the serial port
 */
export function encodeStateSnapshot(seq, gates, cvMain, cvExp) {
  if (gates.length !== UC_NUM_HARD_GATES) throw new Error('gates length');
  if (cvMain.length !== UC_NUM_MAIN_CV) throw new Error('cvMain length');
  if (cvExp.length !== UC_NUM_EXP_CV) throw new Error('cvExp length');

  const buf = new Uint8Array(UC_STATE_SNAPSHOT_LEN);
  const dv = new DataView(buf.buffer);

  buf[0] = UC_SYNC_1;
  buf[1] = UC_SYNC_2;
  buf[2] = UC_TYPE_STATE_SNAPSHOT;
  buf[3] = seq & 0xff;

  let gateBits = 0;
  for (let i = 0; i < UC_NUM_HARD_GATES; i++) {
    if (gates[i]) gateBits |= 1 << i;
  }
  buf[4] = gateBits;

  let o = 5;
  for (let i = 0; i < UC_NUM_MAIN_CV; i++) {
    dv.setUint16(o, toU16(cvMain[i]), /*littleEndian=*/ true);
    o += 2;
  }
  for (let i = 0; i < UC_NUM_EXP_CV; i++) {
    dv.setUint16(o, toU16(cvExp[i]), true);
    o += 2;
  }
  // CRC over bytes [2..26]
  buf[27] = crc8(buf, 2, 27);
  return buf;
}

function toU16(v) {
  if (!Number.isFinite(v)) return 0;
  const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
  return Math.round(clamped * 65535);
}
