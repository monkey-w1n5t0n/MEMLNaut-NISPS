/**
 * uSEQ-CV protocol v2 encoder tests (run with `bun test`). These pin the wire
 * layout so it cannot silently drift from firmware/useq-celium/shared/protocol.h.
 */
import { expect, test } from 'bun:test';
import {
  CV_MAX,
  FRAME_IDENTIFY_LEN,
  FRAME_OUTPUT_LEN,
  OFF_CV0,
  OFF_GATES,
  OFF_OXSUM,
  SYNC_HOST,
  cvToWire,
  encodeIdentify,
  encodeOutput,
  xorChecksum,
} from './useq-protocol';

test('frame sizes match the C header', () => {
  expect(FRAME_OUTPUT_LEN).toBe(26); // sync+type + 11×u16 + gate + xor
  expect(FRAME_IDENTIFY_LEN).toBe(3);
  expect(OFF_GATES).toBe(24);
  expect(OFF_OXSUM).toBe(25);
});

test('encodeOutput lays out CV (LE), gate bits, and a valid XOR', () => {
  const cv = Array.from({ length: 11 }, (_, i) => i * 100); // 0,100,...,1000
  const out = new Uint8Array(FRAME_OUTPUT_LEN);
  const n = encodeOutput(out, cv, 0b101); // GATE1 + GATE3
  expect(n).toBe(FRAME_OUTPUT_LEN);
  expect(out[0]).toBe(SYNC_HOST);
  expect(out[1]).toBe(0x01);
  // CV4 (index 3) = 300 → 0x012C little-endian
  expect(out[OFF_CV0 + 3 * 2]).toBe(300 & 0xff);
  expect(out[OFF_CV0 + 3 * 2 + 1]).toBe((300 >> 8) & 0xff);
  expect(out[OFF_GATES]).toBe(0b101);
  expect(out[OFF_OXSUM]).toBe(xorChecksum(out, 1, OFF_OXSUM - 1));
});

test('encodeOutput clamps CV to 12-bit and masks gates to 3 bits', () => {
  const out = new Uint8Array(FRAME_OUTPUT_LEN);
  encodeOutput(out, new Array(11).fill(99999), 0xff);
  expect(out[OFF_CV0] | (out[OFF_CV0 + 1] << 8)).toBe(CV_MAX);
  expect(out[OFF_GATES]).toBe(0x07);
});

test('cvToWire maps the normalised range to 12-bit', () => {
  expect(cvToWire(0)).toBe(0);
  expect(cvToWire(1)).toBe(CV_MAX);
  expect(cvToWire(0.5)).toBe(Math.round(0.5 * CV_MAX));
  expect(cvToWire(-1)).toBe(0);
  expect(cvToWire(2)).toBe(CV_MAX);
});

test('encodeIdentify is [0xAA, 0x03, 0x03]', () => {
  const out = new Uint8Array(FRAME_IDENTIFY_LEN);
  encodeIdentify(out);
  expect(Array.from(out)).toEqual([0xaa, 0x03, 0x03]);
});
