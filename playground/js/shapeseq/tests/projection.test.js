/**
 * Tests for the simplified 3-knob projection layer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createProjection, applyProjection, VELOCITY_CURVES } from '../projection.js';
import { createPattern, setStep } from '../pattern.js';

// ---------------------------------------------------------------------------
// createProjection
// ---------------------------------------------------------------------------

describe('createProjection', () => {
  it('returns correct defaults', () => {
    const p = createProjection();
    assert.equal(p.velocityCurve, 'linear');
    assert.equal(p.gateThreshold, 0);
    assert.deepStrictEqual(p.pitchRange, { low: 0, high: 127 });
  });

  it('accepts custom values', () => {
    const p = createProjection({
      velocityCurve: 'sCurve',
      gateThreshold: 0.4,
      pitchRange: { low: 36, high: 72 },
    });
    assert.equal(p.velocityCurve, 'sCurve');
    assert.equal(p.gateThreshold, 0.4);
    assert.deepStrictEqual(p.pitchRange, { low: 36, high: 72 });
  });

  it('fills partial pitchRange with defaults', () => {
    const p = createProjection({ pitchRange: { low: 24 } });
    assert.equal(p.pitchRange.low, 24);
    assert.equal(p.pitchRange.high, 127);
  });
});

// ---------------------------------------------------------------------------
// VELOCITY_CURVES constant
// ---------------------------------------------------------------------------

describe('VELOCITY_CURVES', () => {
  it('contains the three expected curves', () => {
    assert.deepStrictEqual(VELOCITY_CURVES, ['linear', 'exponential', 'sCurve']);
  });
});

// ---------------------------------------------------------------------------
// Velocity curves
// ---------------------------------------------------------------------------

describe('velocity curves', () => {
  it('linear is passthrough', () => {
    const config = createProjection({ velocityCurve: 'linear' });
    const pattern = createPattern(1);
    setStep(pattern, 0, { trigger: true, velocity: 0.7 });
    const out = applyProjection(config, pattern);
    assert.equal(out.steps[0].velocity, 0.7);
  });

  it('exponential squares the value', () => {
    const config = createProjection({ velocityCurve: 'exponential' });
    const pattern = createPattern(1);
    setStep(pattern, 0, { trigger: true, velocity: 0.5 });
    const out = applyProjection(config, pattern);
    assert.ok(Math.abs(out.steps[0].velocity - 0.25) < 1e-9);
  });

  it('sCurve applies smoothstep', () => {
    const config = createProjection({ velocityCurve: 'sCurve' });
    const pattern = createPattern(1);
    setStep(pattern, 0, { trigger: true, velocity: 0.5 });
    const out = applyProjection(config, pattern);
    // smoothstep(0.5) = (3 - 2*0.5) * 0.5 * 0.5 = 2 * 0.25 = 0.5
    assert.ok(Math.abs(out.steps[0].velocity - 0.5) < 1e-9);
  });

  it('sCurve at 0 and 1 are identity', () => {
    const config = createProjection({ velocityCurve: 'sCurve' });
    const pattern = createPattern(2);
    setStep(pattern, 0, { trigger: true, velocity: 0.0 });
    setStep(pattern, 1, { trigger: true, velocity: 1.0 });
    const out = applyProjection(config, pattern);
    assert.ok(Math.abs(out.steps[0].velocity - 0.0) < 1e-9);
    assert.ok(Math.abs(out.steps[1].velocity - 1.0) < 1e-9);
  });
});

// ---------------------------------------------------------------------------
// Gate threshold
// ---------------------------------------------------------------------------

describe('gate threshold', () => {
  it('steps below threshold get trigger=false', () => {
    const config = createProjection({ gateThreshold: 0.5 });
    const pattern = createPattern(3);
    setStep(pattern, 0, { trigger: true, velocity: 0.3 });
    setStep(pattern, 1, { trigger: true, velocity: 0.6 });
    setStep(pattern, 2, { trigger: true, velocity: 0.5 }); // exactly at threshold
    const out = applyProjection(config, pattern);
    assert.equal(out.steps[0].trigger, false); // 0.3 < 0.5 → muted
    assert.equal(out.steps[1].trigger, true);  // 0.6 >= 0.5 → kept
    assert.equal(out.steps[2].trigger, true);  // 0.5 is not < 0.5 → kept (at threshold)
  });

  it('threshold 0 mutes nothing', () => {
    const config = createProjection({ gateThreshold: 0 });
    const pattern = createPattern(2);
    setStep(pattern, 0, { trigger: true, velocity: 0.01 });
    setStep(pattern, 1, { trigger: true, velocity: 0.0 });
    const out = applyProjection(config, pattern);
    assert.equal(out.steps[0].trigger, true);
    // velocity 0.0 is not < 0, so stays true
    assert.equal(out.steps[1].trigger, true);
  });

  it('threshold 1 mutes everything below 1', () => {
    const config = createProjection({ gateThreshold: 1 });
    const pattern = createPattern(2);
    setStep(pattern, 0, { trigger: true, velocity: 0.99 });
    setStep(pattern, 1, { trigger: true, velocity: 1.0 });
    const out = applyProjection(config, pattern);
    assert.equal(out.steps[0].trigger, false);
    assert.equal(out.steps[1].trigger, true);
  });
});

// ---------------------------------------------------------------------------
// Pitch range (octave fold)
// ---------------------------------------------------------------------------

describe('pitch range', () => {
  it('clamps midiNote into range by octave folding', () => {
    const config = createProjection({ pitchRange: { low: 48, high: 72 } });
    const pattern = createPattern(1);
    setStep(pattern, 0, { trigger: true, midiNote: 84 }); // C6, should fold down
    const out = applyProjection(config, pattern);
    // 84 - 12 = 72 (within range)
    assert.equal(out.steps[0].midiNote, 72);
  });

  it('folds up when below range', () => {
    const config = createProjection({ pitchRange: { low: 48, high: 72 } });
    const pattern = createPattern(1);
    setStep(pattern, 0, { trigger: true, midiNote: 36 }); // C2
    const out = applyProjection(config, pattern);
    // 36 + 12 = 48 (within range)
    assert.equal(out.steps[0].midiNote, 48);
  });

  it('leaves note in range untouched', () => {
    const config = createProjection({ pitchRange: { low: 48, high: 72 } });
    const pattern = createPattern(1);
    setStep(pattern, 0, { trigger: true, midiNote: 60 });
    const out = applyProjection(config, pattern);
    assert.equal(out.steps[0].midiNote, 60);
  });

  it('steps without midiNote (null) are unaffected', () => {
    const config = createProjection({ pitchRange: { low: 48, high: 72 } });
    const pattern = createPattern(1);
    // midiNote defaults to null from createStep
    setStep(pattern, 0, { trigger: true });
    const out = applyProjection(config, pattern);
    assert.equal(out.steps[0].midiNote, null);
  });

  it('handles narrow range (< 12 semitones) with clamping', () => {
    const config = createProjection({ pitchRange: { low: 60, high: 65 } });
    const pattern = createPattern(1);
    setStep(pattern, 0, { trigger: true, midiNote: 80 });
    const out = applyProjection(config, pattern);
    // 80 - 12 = 68 > 65, -12 = 56 < 60, clamp to 60
    assert.ok(out.steps[0].midiNote >= 60 && out.steps[0].midiNote <= 65);
  });
});

// ---------------------------------------------------------------------------
// No mutation
// ---------------------------------------------------------------------------

describe('applyProjection immutability', () => {
  it('does not mutate the input pattern', () => {
    const config = createProjection({
      velocityCurve: 'exponential',
      gateThreshold: 0.5,
      pitchRange: { low: 48, high: 72 },
    });
    const pattern = createPattern(2);
    setStep(pattern, 0, { trigger: true, velocity: 0.3, midiNote: 84 });
    setStep(pattern, 1, { trigger: true, velocity: 0.8, midiNote: 60 });

    // Snapshot original values
    const origVel0 = pattern.steps[0].velocity;
    const origVel1 = pattern.steps[1].velocity;
    const origTrig0 = pattern.steps[0].trigger;
    const origNote0 = pattern.steps[0].midiNote;

    applyProjection(config, pattern);

    assert.equal(pattern.steps[0].velocity, origVel0);
    assert.equal(pattern.steps[1].velocity, origVel1);
    assert.equal(pattern.steps[0].trigger, origTrig0);
    assert.equal(pattern.steps[0].midiNote, origNote0);
  });
});
