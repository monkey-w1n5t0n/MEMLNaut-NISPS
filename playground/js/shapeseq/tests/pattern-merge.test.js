import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createPattern, setStep, mergePatterns } from '../pattern.js';

/**
 * Helper: build a 4-step pattern and configure specific steps.
 * stepConfigs is an array of { index, ...stepData } objects.
 */
function buildPattern(stepConfigs) {
  const p = createPattern(4);
  for (const { index, ...data } of stepConfigs) {
    setStep(p, index, data);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Additive mode
// ---------------------------------------------------------------------------

describe('mergePatterns — additive mode', () => {
  it('both trigger: averages pitch, velocity, timeOffset; ORs accent; max subdivisions', () => {
    const a = buildPattern([
      { index: 0, trigger: true, pitch: 0.8, velocity: 0.6, accent: true, timeOffset: 0.1, subdivisions: 2 },
    ]);
    const b = buildPattern([
      { index: 0, trigger: true, pitch: 0.4, velocity: 1.0, accent: false, timeOffset: -0.1, subdivisions: 3 },
    ]);

    const merged = mergePatterns(a, b, 'additive');
    const s = merged.steps[0];

    assert.equal(s.trigger, true);
    assert.ok(Math.abs(s.pitch - 0.6) < 1e-9, `pitch should be 0.6, got ${s.pitch}`);
    assert.ok(Math.abs(s.velocity - 0.8) < 1e-9, `velocity should be 0.8, got ${s.velocity}`);
    assert.equal(s.accent, true); // OR
    assert.ok(Math.abs(s.timeOffset - 0.0) < 1e-9, `timeOffset should be 0.0, got ${s.timeOffset}`);
    assert.equal(s.subdivisions, 3); // max
  });

  it('only A triggers: uses A values directly', () => {
    const a = buildPattern([
      { index: 1, trigger: true, pitch: 0.9, velocity: 0.3, accent: true, timeOffset: 0.2, subdivisions: 2 },
    ]);
    const b = buildPattern([]); // step 1 stays default (trigger: false)

    const merged = mergePatterns(a, b, 'additive');
    const s = merged.steps[1];

    assert.equal(s.trigger, true);
    assert.equal(s.pitch, 0.9);
    assert.equal(s.velocity, 0.3);
    assert.equal(s.accent, true);
    assert.equal(s.timeOffset, 0.2);
    assert.equal(s.subdivisions, 2);
  });

  it('only B triggers: uses B values directly', () => {
    const a = buildPattern([]); // step 2 stays default (trigger: false)
    const b = buildPattern([
      { index: 2, trigger: true, pitch: 0.1, velocity: 0.95, accent: false, timeOffset: -0.3, subdivisions: 4 },
    ]);

    const merged = mergePatterns(a, b, 'additive');
    const s = merged.steps[2];

    assert.equal(s.trigger, true);
    assert.equal(s.pitch, 0.1);
    assert.equal(s.velocity, 0.95);
    assert.equal(s.accent, false);
    assert.equal(s.timeOffset, -0.3);
    assert.equal(s.subdivisions, 4);
  });

  it('neither triggers: step stays untriggered with defaults', () => {
    const a = buildPattern([]);
    const b = buildPattern([]);

    const merged = mergePatterns(a, b, 'additive');
    const s = merged.steps[0];

    assert.equal(s.trigger, false);
    assert.equal(s.pitch, 0.5);      // DEFAULT_PITCH
    assert.equal(s.velocity, 0.7);   // DEFAULT_VELOCITY
    assert.equal(s.accent, false);   // DEFAULT_ACCENT
    assert.equal(s.timeOffset, 0.0); // DEFAULT_TIME_OFFSET
    assert.equal(s.subdivisions, 1); // DEFAULT_SUBDIVISIONS
  });

  it('timeOffset averaged when both trigger', () => {
    const a = buildPattern([{ index: 0, trigger: true, timeOffset: 0.4 }]);
    const b = buildPattern([{ index: 0, trigger: true, timeOffset: -0.2 }]);

    const merged = mergePatterns(a, b, 'additive');
    assert.ok(Math.abs(merged.steps[0].timeOffset - 0.1) < 1e-9);
  });

  it('subdivisions: max when both trigger, sole value when one triggers', () => {
    const a = buildPattern([
      { index: 0, trigger: true, subdivisions: 1 },
      { index: 1, trigger: true, subdivisions: 3 },
    ]);
    const b = buildPattern([
      { index: 0, trigger: true, subdivisions: 4 },
      // step 1: not triggered
    ]);

    const merged = mergePatterns(a, b, 'additive');
    assert.equal(merged.steps[0].subdivisions, 4); // max(1, 4)
    assert.equal(merged.steps[1].subdivisions, 3); // only A triggered
  });
});

// ---------------------------------------------------------------------------
// Multiplicative mode
// ---------------------------------------------------------------------------

describe('mergePatterns — multiplicative mode', () => {
  it('both trigger: triggers, averages values, ANDs accent', () => {
    const a = buildPattern([
      { index: 0, trigger: true, pitch: 0.8, velocity: 0.6, accent: true, timeOffset: 0.1, subdivisions: 2 },
    ]);
    const b = buildPattern([
      { index: 0, trigger: true, pitch: 0.4, velocity: 1.0, accent: false, timeOffset: -0.1, subdivisions: 3 },
    ]);

    const merged = mergePatterns(a, b, 'multiplicative');
    const s = merged.steps[0];

    assert.equal(s.trigger, true);
    assert.ok(Math.abs(s.pitch - 0.6) < 1e-9);
    assert.ok(Math.abs(s.velocity - 0.8) < 1e-9);
    assert.equal(s.accent, false); // AND: true && false
    assert.ok(Math.abs(s.timeOffset - 0.0) < 1e-9);
    assert.equal(s.subdivisions, 3);
  });

  it('only A triggers: no trigger in multiplicative (AND)', () => {
    const a = buildPattern([
      { index: 0, trigger: true, pitch: 0.9, velocity: 0.3, accent: true },
    ]);
    const b = buildPattern([]);

    const merged = mergePatterns(a, b, 'multiplicative');
    const s = merged.steps[0];

    // AND: true && false = false, so step not triggered
    assert.equal(s.trigger, false);
    // Since only A triggered (but result is untriggered due to AND),
    // values come from the A-only branch
    assert.equal(s.pitch, 0.9);
    assert.equal(s.velocity, 0.3);
  });

  it('only B triggers: no trigger in multiplicative (AND)', () => {
    const a = buildPattern([]);
    const b = buildPattern([
      { index: 0, trigger: true, pitch: 0.1, velocity: 0.95, accent: false, timeOffset: -0.3, subdivisions: 4 },
    ]);

    const merged = mergePatterns(a, b, 'multiplicative');
    const s = merged.steps[0];

    assert.equal(s.trigger, false);
    // Values from the B-only branch
    assert.equal(s.pitch, 0.1);
    assert.equal(s.velocity, 0.95);
  });

  it('neither triggers: untriggered with defaults', () => {
    const a = buildPattern([]);
    const b = buildPattern([]);

    const merged = mergePatterns(a, b, 'multiplicative');
    const s = merged.steps[0];

    assert.equal(s.trigger, false);
    assert.equal(s.pitch, 0.5);
    assert.equal(s.velocity, 0.7);
    assert.equal(s.accent, false);
    assert.equal(s.timeOffset, 0.0);
    assert.equal(s.subdivisions, 1);
  });

  it('timeOffset from sole triggering generator in multiplicative', () => {
    const a = buildPattern([{ index: 0, trigger: true, timeOffset: 0.4 }]);
    const b = buildPattern([]);

    const merged = mergePatterns(a, b, 'multiplicative');
    assert.equal(merged.steps[0].timeOffset, 0.4);
  });

  it('subdivisions from sole triggering generator in multiplicative', () => {
    const a = buildPattern([]);
    const b = buildPattern([{ index: 0, trigger: true, subdivisions: 3 }]);

    const merged = mergePatterns(a, b, 'multiplicative');
    assert.equal(merged.steps[0].subdivisions, 3);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('mergePatterns — edge cases', () => {
  it('tiles mismatched step counts to LCM instead of rejecting', () => {
    const a = createPattern(4);
    const b = createPattern(8);
    const merged = mergePatterns(a, b, 'additive');
    assert.equal(merged.stepCount, 8); // lcm(4, 8) = 8
  });

  it('rejects invalid mode', () => {
    const a = createPattern(4);
    const b = createPattern(4);
    assert.throws(() => mergePatterns(a, b, 'xor'), TypeError);
  });

  it('does not mutate input patterns', () => {
    const a = buildPattern([{ index: 0, trigger: true, pitch: 0.2 }]);
    const b = buildPattern([{ index: 0, trigger: true, pitch: 0.8 }]);

    mergePatterns(a, b, 'additive');

    assert.equal(a.steps[0].pitch, 0.2);
    assert.equal(b.steps[0].pitch, 0.8);
  });
});
