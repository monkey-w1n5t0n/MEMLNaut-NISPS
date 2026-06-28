/**
 * uSEQ-CV wire protocol v2 — TypeScript mirror of
 * `firmware/useq-celium/shared/protocol.h`. Any change here MUST track the C
 * header; useq-protocol.test.ts asserts the frame sizes match.
 *
 * Pure + framework-neutral (no navigator / DOM) so it is unit-testable and safe
 * to import from anywhere. See docs/useq-celium/protocol.md.
 */

// ─── Sync bytes ──────────────────────────────────────────────────────────────
export const SYNC_HOST = 0xaa; // host → uSEQ
export const SYNC_DEV = 0xbb; // uSEQ → host
export const SYNC_I2C = 0xcc;
export const SYNC_I2C_IDENTIFY = 0xdd;

// ─── Message types ───────────────────────────────────────────────────────────
export const MSG_OUTPUT = 0x01; // host → uSEQ
export const MSG_IDENTIFY = 0x03; // host ↔ uSEQ
export const MSG_INPUT = 0x01; // uSEQ → host (on SYNC_DEV)

// ─── Topology ────────────────────────────────────────────────────────────────
export const NUM_CV = 11; // CV1..CV11
export const NUM_GATE = 3; // GATE1..GATE3
export const NUM_MAIN_CV = 3; // CV1..CV3 on the main board
export const NUM_EXP_CV = 8; // CV4..CV11 on the expander

// ─── Ranges ──────────────────────────────────────────────────────────────────
export const CV_MAX = 4095; // 12-bit canonical wire value
export const PWM_MAX = 2047; // 11-bit hardware PWM

// ─── Frame sizes ─────────────────────────────────────────────────────────────
export const FRAME_OUTPUT_LEN = 2 + NUM_CV * 2 + 1 + 1; // 26
export const FRAME_IDENTIFY_LEN = 3;
export const FRAME_ACK_LEN = 4;
export const FRAME_INPUT_LEN = 11;
export const FRAME_I2C_LEN = 1 + NUM_EXP_CV * 2 + 1; // 18

// ─── Offsets (OUTPUT frame) ──────────────────────────────────────────────────
export const OFF_CV0 = 2;
export const OFF_GATES = 2 + NUM_CV * 2; // 24
export const OFF_OXSUM = FRAME_OUTPUT_LEN - 1; // 25

/** Streaming cadence the backend targets (Hz). */
export const STREAM_HZ = 100;

/** XOR checksum over buf[start..end] inclusive. */
export function xorChecksum(buf: Uint8Array, start: number, end: number): number {
  let cs = 0;
  for (let i = start; i <= end; i++) cs ^= buf[i];
  return cs & 0xff;
}

/** Clamp + round a normalised 0..1 value to a 12-bit wire CV (0..CV_MAX). */
export function cvToWire(v: number): number {
  const x = v < 0 ? 0 : v > 1 ? 1 : v;
  return Math.round(x * CV_MAX);
}

/**
 * Encode an OUTPUT frame into `out` (length >= FRAME_OUTPUT_LEN). `cv` holds
 * NUM_CV wire values (0..CV_MAX, already scaled); `gateBits` packs GATE1..3 in
 * bits 0..2. Returns the number of bytes written (FRAME_OUTPUT_LEN).
 */
export function encodeOutput(out: Uint8Array, cv: ArrayLike<number>, gateBits: number): number {
  out[0] = SYNC_HOST;
  out[1] = MSG_OUTPUT;
  for (let i = 0; i < NUM_CV; i++) {
    const v = cv[i] | 0;
    const c = v < 0 ? 0 : v > CV_MAX ? CV_MAX : v;
    out[OFF_CV0 + i * 2] = c & 0xff;
    out[OFF_CV0 + i * 2 + 1] = (c >> 8) & 0xff;
  }
  out[OFF_GATES] = gateBits & 0x07;
  out[OFF_OXSUM] = xorChecksum(out, 1, OFF_OXSUM - 1);
  return FRAME_OUTPUT_LEN;
}

/** Encode the 3-byte IDENTIFY frame into `out`. */
export function encodeIdentify(out: Uint8Array): number {
  out[0] = SYNC_HOST;
  out[1] = MSG_IDENTIFY;
  out[2] = xorChecksum(out, 1, 1);
  return FRAME_IDENTIFY_LEN;
}

/** Device→host input readings, decoded from an INPUT frame. */
export interface UseqInputs {
  i1: number;
  i2: number;
  ai1: number;
  ai2: number;
}

/**
 * Tiny resync-capable parser for the device→host stream (SYNC_DEV). Feed bytes
 * as they arrive; supplies decoded INPUT readings and IDENTIFY acks via the
 * callbacks. Lean state machine, no allocation in steady state.
 */
export class UseqRxParser {
  private buf = new Uint8Array(FRAME_INPUT_LEN);
  private idx = 0;
  private synced = false;

  constructor(
    private readonly onInputs: (v: UseqInputs) => void,
    private readonly onAck: (ok: boolean) => void,
  ) {}

  push(chunk: Uint8Array): void {
    for (let k = 0; k < chunk.length; k++) {
      const b = chunk[k];
      if (!this.synced) {
        if (b === SYNC_DEV) {
          this.buf[0] = b;
          this.idx = 1;
          this.synced = true;
        }
        continue;
      }
      this.buf[this.idx++] = b;
      if (this.idx === 2 && this.buf[1] !== MSG_INPUT && this.buf[1] !== MSG_IDENTIFY) {
        this.synced = false; // unknown type → resync
        continue;
      }
      const want = this.buf[1] === MSG_INPUT ? FRAME_INPUT_LEN : FRAME_ACK_LEN;
      if (this.idx >= want) {
        this.dispatch(want);
        this.synced = false;
      }
    }
  }

  private dispatch(len: number): void {
    if (this.buf[1] === MSG_INPUT) {
      if (xorChecksum(this.buf, 1, len - 2) !== this.buf[len - 1]) return;
      const rd = (o: number) => this.buf[o] | (this.buf[o + 1] << 8);
      this.onInputs({ i1: rd(2), i2: rd(4), ai1: rd(6), ai2: rd(8) });
    } else {
      if (this.buf[3] !== (this.buf[1] ^ this.buf[2])) return;
      this.onAck(this.buf[2] === 0x01);
    }
  }
}
