/**
 * Tests for seq-iml.js configuration logic.
 *
 * These tests verify the architecture scaling and validation functions
 * without instantiating WasmIML (which requires a browser WASM runtime).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeHiddenLayers,
  validateOutputCount,
  SEQ_DEFAULT_OUTPUT_COUNT,
} from '../seq-iml.js';

// ── computeHiddenLayers ─────────────────────────────────────────────

describe('computeHiddenLayers', () => {
  it('returns [8,8,8] for outputCount <= 8', () => {
    assert.deepStrictEqual(computeHiddenLayers(1), [8, 8, 8]);
    assert.deepStrictEqual(computeHiddenLayers(4), [8, 8, 8]);
    assert.deepStrictEqual(computeHiddenLayers(8), [8, 8, 8]);
  });

  it('returns [16,16,16] for outputCount 9–16', () => {
    assert.deepStrictEqual(computeHiddenLayers(9), [16, 16, 16]);
    assert.deepStrictEqual(computeHiddenLayers(16), [16, 16, 16]);
  });

  it('returns [24,24,32] for outputCount 17–32', () => {
    assert.deepStrictEqual(computeHiddenLayers(17), [24, 24, 32]);
    assert.deepStrictEqual(computeHiddenLayers(24), [24, 24, 32]);
    assert.deepStrictEqual(computeHiddenLayers(32), [24, 24, 32]);
  });

  it('returns [n,n,n] for outputCount > 32', () => {
    assert.deepStrictEqual(computeHiddenLayers(48), [48, 48, 48]);
    assert.deepStrictEqual(computeHiddenLayers(64), [64, 64, 64]);
    assert.deepStrictEqual(computeHiddenLayers(128), [128, 128, 128]);
  });

  it('always returns exactly 3 hidden layers', () => {
    for (const n of [1, 8, 16, 32, 64]) {
      assert.strictEqual(computeHiddenLayers(n).length, 3);
    }
  });
});

// ── validateOutputCount ─────────────────────────────────────────────

describe('validateOutputCount', () => {
  it('accepts positive integers', () => {
    assert.strictEqual(validateOutputCount(1), 1);
    assert.strictEqual(validateOutputCount(8), 8);
    assert.strictEqual(validateOutputCount(16), 16);
    assert.strictEqual(validateOutputCount(32), 32);
  });

  it('rounds fractional values to nearest integer', () => {
    assert.strictEqual(validateOutputCount(15.7), 16);
    assert.strictEqual(validateOutputCount(8.3), 8);
  });

  it('rejects zero', () => {
    assert.throws(() => validateOutputCount(0), RangeError);
  });

  it('rejects negative values', () => {
    assert.throws(() => validateOutputCount(-1), RangeError);
    assert.throws(() => validateOutputCount(-16), RangeError);
  });

  it('rejects NaN and Infinity', () => {
    assert.throws(() => validateOutputCount(NaN), RangeError);
    assert.throws(() => validateOutputCount(Infinity), RangeError);
    assert.throws(() => validateOutputCount(-Infinity), RangeError);
  });
});

// ── SEQ_DEFAULT_OUTPUT_COUNT ────────────────────────────────────────

describe('SEQ_DEFAULT_OUTPUT_COUNT', () => {
  it('equals 16 (backward compatible default)', () => {
    assert.strictEqual(SEQ_DEFAULT_OUTPUT_COUNT, 16);
  });
});
