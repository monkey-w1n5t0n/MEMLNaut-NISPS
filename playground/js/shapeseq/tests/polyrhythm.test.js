import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  createPattern, setStep, clonePattern, mergePatterns,
  lcm, tilePattern, lcmOfPatterns,
} from '../pattern.js';

// ---------------------------------------------------------------------------
// lcm
// ---------------------------------------------------------------------------

describe('lcm', () => {
  it('lcm(3, 4) = 12', () => assert.equal(lcm(3, 4), 12));
  it('lcm(5, 8) = 40', () => assert.equal(lcm(5, 8), 40));
  it('lcm(6, 6) = 6', () => assert.equal(lcm(6, 6), 6));
  it('lcm(1, 7) = 7', () => assert.equal(lcm(1, 7), 7));
  it('lcm(7, 1) = 7', () => assert.equal(lcm(7, 1), 7));
});

// ---------------------------------------------------------------------------
// tilePattern
// ---------------------------------------------------------------------------

describe('tilePattern', () => {
  /** Build a 3-step pattern with distinct triggers on each step. */
  function make3StepPattern() {
    const p = createPattern(3);
    setStep(p, 0, { trigger: true, pitch: 0.1, velocity: 0.2, accent: true, timeOffset: 0.05, subdivisions: 2, midiNote: 60 });
    setStep(p, 1, { trigger: false, pitch: 0.3, velocity: 0.4, accent: false, timeOffset: -0.1, subdivisions: 1, midiNote: null });
    setStep(p, 2, { trigger: true, pitch: 0.9, velocity: 0.8, accent: true, timeOffset: 0.0, subdivisions: 3, midiNote: 72 });
    return p;
  }

  it('tiles a 3-step pattern to 12 steps by wrapping', () => {
    const src = make3StepPattern();
    const tiled = tilePattern(src, 12);

    assert.equal(tiled.stepCount, 12);
    assert.equal(tiled.steps.length, 12);

    for (let i = 0; i < 12; i++) {
      const srcStep = src.steps[i % 3];
      const tiledStep = tiled.steps[i];
      assert.equal(tiledStep.trigger, srcStep.trigger, `step ${i} trigger`);
      assert.equal(tiledStep.pitch, srcStep.pitch, `step ${i} pitch`);
      assert.equal(tiledStep.velocity, srcStep.velocity, `step ${i} velocity`);
      assert.equal(tiledStep.accent, srcStep.accent, `step ${i} accent`);
      assert.equal(tiledStep.timeOffset, srcStep.timeOffset, `step ${i} timeOffset`);
      assert.equal(tiledStep.subdivisions, srcStep.subdivisions, `step ${i} subdivisions`);
      assert.equal(tiledStep.midiNote, srcStep.midiNote, `step ${i} midiNote`);
    }
  });

  it('same length returns a clone (no-op)', () => {
    const src = make3StepPattern();
    const tiled = tilePattern(src, 3);

    assert.equal(tiled.stepCount, 3);
    // Must be a separate object (clone), not the same reference
    assert.notEqual(tiled, src);
    assert.notEqual(tiled.steps, src.steps);
    assert.notEqual(tiled.steps[0], src.steps[0]);
    // But values match
    assert.equal(tiled.steps[0].pitch, src.steps[0].pitch);
  });

  it('preserves all step fields (trigger, pitch, velocity, accent, timeOffset, subdivisions, midiNote)', () => {
    const src = make3StepPattern();
    const tiled = tilePattern(src, 6);

    const step0 = tiled.steps[0];
    assert.equal(step0.trigger, true);
    assert.equal(step0.pitch, 0.1);
    assert.equal(step0.velocity, 0.2);
    assert.equal(step0.accent, true);
    assert.equal(step0.timeOffset, 0.05);
    assert.equal(step0.subdivisions, 2);
    assert.equal(step0.midiNote, 60);

    // Step 4 should be a copy of step 1 (4 % 3 = 1)
    const step4 = tiled.steps[4];
    assert.equal(step4.trigger, false);
    assert.equal(step4.pitch, 0.3);
    assert.equal(step4.velocity, 0.4);
    assert.equal(step4.midiNote, null);
  });

  it('throws if targetStepCount < pattern.stepCount', () => {
    const src = make3StepPattern();
    assert.throws(
      () => tilePattern(src, 2),
      { name: 'RangeError' }
    );
  });
});

// ---------------------------------------------------------------------------
// mergePatterns — backward compatibility (same step counts)
// ---------------------------------------------------------------------------

describe('mergePatterns — same step count (backward compat)', () => {
  it('merges two 4-step patterns additively', () => {
    const a = createPattern(4);
    setStep(a, 0, { trigger: true, pitch: 0.8, velocity: 0.6 });
    setStep(a, 2, { trigger: true, pitch: 0.3, velocity: 0.9 });

    const b = createPattern(4);
    setStep(b, 1, { trigger: true, pitch: 0.5, velocity: 0.7 });
    setStep(b, 2, { trigger: true, pitch: 0.7, velocity: 0.5 });

    const merged = mergePatterns(a, b, 'additive');
    assert.equal(merged.stepCount, 4);
    assert.equal(merged.steps[0].trigger, true);  // A only
    assert.equal(merged.steps[1].trigger, true);  // B only
    assert.equal(merged.steps[2].trigger, true);  // both
    assert.equal(merged.steps[3].trigger, false);  // neither
  });
});

// ---------------------------------------------------------------------------
// mergePatterns — different step counts (polyrhythm)
// ---------------------------------------------------------------------------

describe('mergePatterns — different step counts (polyrhythm)', () => {
  it('3+4 step patterns produce LCM=12 length result', () => {
    const a = createPattern(3);
    setStep(a, 0, { trigger: true, pitch: 0.2, velocity: 0.8 });
    // Steps 1, 2 are default (trigger: false)

    const b = createPattern(4);
    setStep(b, 0, { trigger: true, pitch: 0.6, velocity: 0.4 });
    // Steps 1, 2, 3 are default (trigger: false)

    const merged = mergePatterns(a, b, 'additive');
    assert.equal(merged.stepCount, 12);
    assert.equal(merged.steps.length, 12);
  });

  it('tiled pattern has correct trigger patterns from both inputs', () => {
    // A: 3 steps, triggers on 0 and 2 → tiled to 12: triggers at 0,2,3,5,6,8,9,11
    const a = createPattern(3);
    setStep(a, 0, { trigger: true });
    setStep(a, 2, { trigger: true });

    // B: 4 steps, trigger on 1 → tiled to 12: triggers at 1,5,9
    const b = createPattern(4);
    setStep(b, 1, { trigger: true });

    const merged = mergePatterns(a, b, 'additive');
    assert.equal(merged.stepCount, 12);

    // A triggers at positions where i%3 is 0 or 2: 0,2,3,5,6,8,9,11
    // B triggers at positions where i%4 is 1: 1,5,9
    // Combined (additive = OR): 0,1,2,3,5,6,8,9,11
    const expectedTriggers = [true, true, true, true, false, true, true, false, true, true, false, true];
    for (let i = 0; i < 12; i++) {
      assert.equal(merged.steps[i].trigger, expectedTriggers[i], `step ${i} trigger`);
    }
  });
});

// ---------------------------------------------------------------------------
// lcmOfPatterns
// ---------------------------------------------------------------------------

describe('lcmOfPatterns', () => {
  it('single pattern returns its stepCount', () => {
    const p = createPattern(5);
    assert.equal(lcmOfPatterns([p]), 5);
  });

  it('multiple patterns returns LCM of all step counts', () => {
    const a = createPattern(3);
    const b = createPattern(4);
    const c = createPattern(6);
    // lcm(3,4) = 12, lcm(12,6) = 12
    assert.equal(lcmOfPatterns([a, b, c]), 12);
  });

  it('empty array returns 1', () => {
    assert.equal(lcmOfPatterns([]), 1);
  });
});
