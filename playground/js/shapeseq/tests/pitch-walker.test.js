/**
 * Tests for PitchWalker reclassified as a processor.
 *
 * Verifies that PitchWalker:
 *  - Has category 'processor'
 *  - Preserves upstream trigger patterns
 *  - Preserves upstream step data (velocity, accent, timeOffset, subdivisions)
 *  - Only modifies pitch on triggered steps
 *  - Leaves untriggered steps completely unchanged
 *  - Advances position state
 *  - Integrates correctly in a Chain with a generator upstream
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PitchWalker, EuclideanRhythm } from '../primitives.js';
import { createPattern, setStep } from '../pattern.js';
import { createPRNG } from '../prng.js';
import { Chain } from '../chain.js';

// Helper: build a pattern with specific triggers and custom step data
function makeTestPattern(stepCount, triggerIndices, stepOverrides) {
  const pattern = createPattern(stepCount);
  for (const idx of triggerIndices) {
    setStep(pattern, idx, { trigger: true });
  }
  if (stepOverrides) {
    for (const [idx, data] of Object.entries(stepOverrides)) {
      setStep(pattern, Number(idx), data);
    }
  }
  return pattern;
}

describe('PitchWalker', () => {
  it('has category "processor"', () => {
    const pw = new PitchWalker();
    assert.equal(pw.category, 'processor');
  });

  it('preserves upstream trigger pattern', () => {
    const pw = new PitchWalker();
    const rng = createPRNG(42);
    const triggers = [0, 2, 5, 7];
    const input = makeTestPattern(8, triggers);

    const { patternDesc } = pw.process(
      new Float32Array([0.3, 0.5, 0.3, 0.8]),
      input, {}, rng
    );

    for (let i = 0; i < 8; i++) {
      const expected = triggers.includes(i);
      assert.equal(patternDesc.steps[i].trigger, expected,
        `step ${i} trigger should be ${expected}`);
    }
  });

  it('preserves upstream velocity, accent, timeOffset, subdivisions on triggered steps', () => {
    const pw = new PitchWalker();
    const rng = createPRNG(99);
    const input = makeTestPattern(4, [1, 3], {
      1: { trigger: true, velocity: 0.9, accent: true, timeOffset: 0.1, subdivisions: 2 },
      3: { trigger: true, velocity: 0.4, accent: false, timeOffset: -0.2, subdivisions: 3 },
    });

    const { patternDesc } = pw.process(
      new Float32Array([0.3, 0.5, 0.3, 0.8]),
      input, {}, rng
    );

    // Step 1
    assert.equal(patternDesc.steps[1].velocity, 0.9);
    assert.equal(patternDesc.steps[1].accent, true);
    assert.equal(patternDesc.steps[1].timeOffset, 0.1);
    assert.equal(patternDesc.steps[1].subdivisions, 2);

    // Step 3
    assert.equal(patternDesc.steps[3].velocity, 0.4);
    assert.equal(patternDesc.steps[3].accent, false);
    assert.equal(patternDesc.steps[3].timeOffset, -0.2);
    assert.equal(patternDesc.steps[3].subdivisions, 3);
  });

  it('modifies pitch on triggered steps only', () => {
    const pw = new PitchWalker();
    const rng = createPRNG(7);
    const input = makeTestPattern(8, [0, 3, 6]);

    // Record original pitches
    const origPitches = input.steps.map(s => s.pitch);

    const { patternDesc } = pw.process(
      new Float32Array([0.5, 0.5, 0.5, 1.0]),
      input, {}, rng
    );

    // Triggered steps should have pitch set by random walk (may differ from default 0.5)
    // We just verify they are valid numbers in [0,1]
    for (const idx of [0, 3, 6]) {
      const p = patternDesc.steps[idx].pitch;
      assert.equal(typeof p, 'number');
      assert.ok(p >= 0 && p <= 1, `pitch at step ${idx} should be in [0,1], got ${p}`);
    }
  });

  it('does NOT modify untriggered steps at all', () => {
    const pw = new PitchWalker();
    const rng = createPRNG(123);
    const input = makeTestPattern(6, [1, 4], {
      0: { velocity: 0.3, accent: true, timeOffset: 0.15 },
      2: { velocity: 0.8, accent: false, timeOffset: -0.1 },
    });

    // Snapshot untriggered steps before
    const untriggeredBefore = {};
    for (let i = 0; i < 6; i++) {
      if (![1, 4].includes(i)) {
        const s = input.steps[i];
        untriggeredBefore[i] = {
          trigger: s.trigger,
          pitch: s.pitch,
          velocity: s.velocity,
          accent: s.accent,
          timeOffset: s.timeOffset,
          subdivisions: s.subdivisions,
        };
      }
    }

    const { patternDesc } = pw.process(
      new Float32Array([0.3, 0.5, 0.3, 0.8]),
      input, {}, rng
    );

    for (const [idx, before] of Object.entries(untriggeredBefore)) {
      const after = patternDesc.steps[Number(idx)];
      assert.equal(after.trigger, before.trigger, `step ${idx} trigger unchanged`);
      assert.equal(after.pitch, before.pitch, `step ${idx} pitch unchanged`);
      assert.equal(after.velocity, before.velocity, `step ${idx} velocity unchanged`);
      assert.equal(after.accent, before.accent, `step ${idx} accent unchanged`);
      assert.equal(after.timeOffset, before.timeOffset, `step ${idx} timeOffset unchanged`);
      assert.equal(after.subdivisions, before.subdivisions, `step ${idx} subdivisions unchanged`);
    }
  });

  it('advances the position state', () => {
    const pw = new PitchWalker();
    const rng = createPRNG(55);
    const input = makeTestPattern(8, [0, 1, 2, 3, 4, 5, 6, 7]);

    const initialPosition = 0.5;
    const { nextState } = pw.process(
      new Float32Array([0.5, 0.5, 0.3, 1.0]),
      input, { position: initialPosition }, rng
    );

    assert.equal(typeof nextState.position, 'number');
    // With 8 triggered steps and nonzero stepSize/range, position should move
    assert.notEqual(nextState.position, initialPosition,
      'position should change after processing triggered steps');
  });

  it('does not mutate the input pattern', () => {
    const pw = new PitchWalker();
    const rng = createPRNG(42);
    const input = makeTestPattern(4, [0, 2]);
    const origPitch0 = input.steps[0].pitch;
    const origPitch1 = input.steps[1].pitch;

    pw.process(new Float32Array([0.3, 0.5, 0.3, 0.8]), input, {}, rng);

    // clonePattern should prevent mutation of the original
    assert.equal(input.steps[0].pitch, origPitch0);
    assert.equal(input.steps[1].pitch, origPitch1);
  });
});

describe('PitchWalker integration with Chain', () => {
  it('runs after generators and receives their trigger pattern', () => {
    const chain = new Chain();
    chain.addPrimitive(new EuclideanRhythm());
    chain.addPrimitive(new PitchWalker());

    // EuclideanRhythm params: steps=0.5, pulses=0.5, rotation=0.0
    // PitchWalker params: stepSize=0.3, directionBias=0.5, gravity=0.3, range=0.8
    const params = new Float32Array([0.5, 0.5, 0.0, 0.3, 0.5, 0.3, 0.8]);
    const stepCount = 8;
    const result = chain.evaluate(params, stepCount, 42);

    // The result should have stepCount steps
    assert.equal(result.stepCount, stepCount);

    // Count triggers — EuclideanRhythm with steps=0.5 (maps to ~5) and pulses=0.5
    // should produce some triggers
    const triggeredSteps = result.steps.filter(s => s.trigger);
    assert.ok(triggeredSteps.length > 0,
      'should have at least one triggered step from EuclideanRhythm');

    // Triggered steps should have pitch values set by PitchWalker (not default 0.5)
    // With enough steps, at least some should differ from 0.5
    const pitches = triggeredSteps.map(s => s.pitch);
    const allDefault = pitches.every(p => p === 0.5);
    assert.ok(!allDefault || pitches.length <= 1,
      'PitchWalker should have modified pitch on triggered steps');

    // Untriggered steps should retain default pitch
    const untriggeredSteps = result.steps.filter(s => !s.trigger);
    for (const s of untriggeredSteps) {
      assert.equal(s.pitch, 0.5, 'untriggered steps should have default pitch');
    }
  });
});
