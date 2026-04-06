/**
 * Tests for mlp-mode.js — MLPModeManager and MLP_MODES.
 *
 * Covers mode switching, output slicing, and configuration.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MLPModeManager, MLP_MODES } from '../mlp-mode.js';

/** Approximate equality for Float32 values. */
function assertClose(actual, expected, eps = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `Expected ${actual} to be close to ${expected} (eps=${eps})`
  );
}

// ── MLP_MODES constant ─────────────────────────────────────────────

describe('MLP_MODES', () => {
  it('has UNIFIED and DUAL values', () => {
    assert.equal(MLP_MODES.UNIFIED, 'unified');
    assert.equal(MLP_MODES.DUAL, 'dual');
  });

  it('is frozen', () => {
    assert.throws(() => { MLP_MODES.FOO = 'bar'; }, TypeError);
  });
});

// ── MLPModeManager ──────────────────────────────────────────────────

describe('MLPModeManager', () => {
  it('defaults to dual mode', () => {
    const mgr = new MLPModeManager();
    assert.equal(mgr.mode, MLP_MODES.DUAL);
  });

  it('setMode switches to unified', () => {
    const mgr = new MLPModeManager();
    mgr.setMode(MLP_MODES.UNIFIED);
    assert.equal(mgr.mode, MLP_MODES.UNIFIED);
  });

  it('setMode switches back to dual', () => {
    const mgr = new MLPModeManager();
    mgr.setMode(MLP_MODES.UNIFIED);
    mgr.setMode(MLP_MODES.DUAL);
    assert.equal(mgr.mode, MLP_MODES.DUAL);
  });

  it('setMode throws on invalid mode', () => {
    const mgr = new MLPModeManager();
    assert.throws(() => mgr.setMode('invalid'), TypeError);
    assert.throws(() => mgr.setMode(''), TypeError);
    assert.throws(() => mgr.setMode(null), TypeError);
    assert.throws(() => mgr.setMode(undefined), TypeError);
  });

  it('setUnifiedConfig changes the slice window', () => {
    const mgr = new MLPModeManager();
    assert.equal(mgr.unifiedSliceStart, 0);
    assert.equal(mgr.unifiedSliceCount, 16);

    mgr.setUnifiedConfig(64, 32);
    assert.equal(mgr.unifiedSliceStart, 64);
    assert.equal(mgr.unifiedSliceCount, 32);
  });
});

// ── extractSequenceOutputs ──────────────────────────────────────────

describe('extractSequenceOutputs', () => {
  it('slices the correct range from timbre outputs', () => {
    const mgr = new MLPModeManager();
    mgr.setUnifiedConfig(2, 4);

    const timbre = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    const result = mgr.extractSequenceOutputs(timbre);

    assert.equal(result.length, 4);
    assertClose(result[0], 0.3);  // index 2
    assertClose(result[1], 0.4);  // index 3
    assertClose(result[2], 0.5);  // index 4
    assertClose(result[3], 0.6);  // index 5
  });

  it('uses default slice (start=0, count=16)', () => {
    const mgr = new MLPModeManager();
    const timbre = new Float32Array(126);
    for (let i = 0; i < 126; i++) timbre[i] = i / 126;

    const result = mgr.extractSequenceOutputs(timbre);
    assert.equal(result.length, 16);
    assert.equal(result[0], timbre[0]);
    assert.equal(result[15], timbre[15]);
  });

  it('fills with 0.5 when slice extends beyond timbre outputs', () => {
    const mgr = new MLPModeManager();
    mgr.setUnifiedConfig(5, 4);

    // Only 6 elements — slice starts at 5, needs 4 (indices 5,6,7,8)
    const timbre = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.9]);
    const result = mgr.extractSequenceOutputs(timbre);

    assert.equal(result.length, 4);
    assertClose(result[0], 0.9);  // index 5 — last valid
    assert.equal(result[1], 0.5);  // index 6 — out of bounds
    assert.equal(result[2], 0.5);  // index 7 — out of bounds
    assert.equal(result[3], 0.5);  // index 8 — out of bounds
  });

  it('fills entirely with 0.5 when start is beyond array length', () => {
    const mgr = new MLPModeManager();
    mgr.setUnifiedConfig(100, 3);

    const timbre = new Float32Array([0.1, 0.2, 0.3]);
    const result = mgr.extractSequenceOutputs(timbre);

    assert.equal(result.length, 3);
    assert.equal(result[0], 0.5);
    assert.equal(result[1], 0.5);
    assert.equal(result[2], 0.5);
  });

  it('returns Float32Array', () => {
    const mgr = new MLPModeManager();
    const timbre = new Float32Array(20);
    const result = mgr.extractSequenceOutputs(timbre);
    assert.ok(result instanceof Float32Array);
  });

  it('handles empty timbre array', () => {
    const mgr = new MLPModeManager();
    mgr.setUnifiedConfig(0, 4);

    const timbre = new Float32Array(0);
    const result = mgr.extractSequenceOutputs(timbre);

    assert.equal(result.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.equal(result[i], 0.5);
    }
  });
});
