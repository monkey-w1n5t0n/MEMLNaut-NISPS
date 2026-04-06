import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { Chain } from '../chain.js';
import { EuclideanRhythm, DensityMorph, VelocityShaper } from '../primitives.js';
import { lcm } from '../pattern.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a chain with two EuclideanRhythm generators.
 * Returns { chain, gen0Index, gen1Index }.
 */
function twoGeneratorChain() {
  const chain = new Chain();
  chain.addPrimitive(new EuclideanRhythm()); // index 0
  chain.addPrimitive(new EuclideanRhythm()); // index 1
  return { chain, gen0Index: 0, gen1Index: 1 };
}

/**
 * Count triggered steps in a pattern.
 */
function countTriggers(pattern) {
  let count = 0;
  for (let i = 0; i < pattern.stepCount; i++) {
    if (pattern.steps[i].trigger) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Default behavior: all generators use global stepCount (backward compat)
// ---------------------------------------------------------------------------

describe('polyrhythm chain — backward compatibility', () => {
  it('without per-generator step counts, all generators use global stepCount', () => {
    const { chain } = twoGeneratorChain();

    // Both generators: steps=1.0 (max), pulses=0.5, rotation=0
    // With stepCount=8, steps param maps to 8, pulses maps to ~4
    const params = new Float32Array([1.0, 0.5, 0.0, 1.0, 0.5, 0.0]);
    const pattern = chain.evaluate(params, 8, 42);

    // Both use the same stepCount, so merged pattern should be 8 steps
    assert.equal(pattern.stepCount, 8);
  });

  it('clearGeneratorStepCounts resets to default behavior', () => {
    const { chain, gen0Index } = twoGeneratorChain();

    // Set a custom step count
    chain.setGeneratorStepCount(gen0Index, 3);
    assert.equal(chain.getGeneratorStepCount(gen0Index), 3);

    // Clear
    chain.clearGeneratorStepCounts();
    assert.equal(chain.getGeneratorStepCount(gen0Index), null);

    // Evaluate — should use global stepCount for both
    const params = new Float32Array([1.0, 0.5, 0.0, 1.0, 0.5, 0.0]);
    const pattern = chain.evaluate(params, 8, 42);
    assert.equal(pattern.stepCount, 8);
  });
});

// ---------------------------------------------------------------------------
// Per-generator step counts
// ---------------------------------------------------------------------------

describe('polyrhythm chain — per-generator step counts', () => {
  it('two generators with different step counts produce LCM-length pattern', () => {
    const { chain, gen0Index, gen1Index } = twoGeneratorChain();

    chain.setGeneratorStepCount(gen0Index, 3);
    chain.setGeneratorStepCount(gen1Index, 4);

    // All pulses high so we get triggers
    const params = new Float32Array([1.0, 1.0, 0.0, 1.0, 1.0, 0.0]);
    const pattern = chain.evaluate(params, 8, 42);

    // LCM(3, 4) = 12
    assert.equal(pattern.stepCount, lcm(3, 4));
    assert.equal(pattern.stepCount, 12);
  });

  it('triggers from both generators are present in merged output', () => {
    const { chain, gen0Index, gen1Index } = twoGeneratorChain();

    // Gen0: 3 steps with all triggers (steps=1.0 maps to max=3, pulses=1.0 fills all)
    chain.setGeneratorStepCount(gen0Index, 3);
    // Gen1: 4 steps with all triggers
    chain.setGeneratorStepCount(gen1Index, 4);

    const params = new Float32Array([1.0, 1.0, 0.0, 1.0, 1.0, 0.0]);
    const pattern = chain.evaluate(params, 8, 42);

    assert.equal(pattern.stepCount, 12);

    // With all pulses, both generators trigger every step in their respective
    // cycle lengths. Tiled to 12:
    //   Gen0 (3-step cycle, all on): every step has a trigger
    //   Gen1 (4-step cycle, all on): every step has a trigger
    // Additive merge: every step should be triggered
    for (let i = 0; i < 12; i++) {
      assert.equal(pattern.steps[i].trigger, true, `step ${i} should be triggered`);
    }
  });

  it('only one generator with custom step count, other uses global', () => {
    const { chain, gen0Index } = twoGeneratorChain();

    // Gen0 gets 3 steps, Gen1 uses global (4)
    chain.setGeneratorStepCount(gen0Index, 3);

    const params = new Float32Array([1.0, 1.0, 0.0, 1.0, 1.0, 0.0]);
    const pattern = chain.evaluate(params, 4, 42);

    // LCM(3, 4) = 12
    assert.equal(pattern.stepCount, 12);
  });

  it('generatorStepCounts passed as evaluate() argument overrides instance map', () => {
    const { chain, gen0Index, gen1Index } = twoGeneratorChain();

    // Instance map says 3 and 4
    chain.setGeneratorStepCount(gen0Index, 3);
    chain.setGeneratorStepCount(gen1Index, 4);

    // But explicit arg says 5 and 7
    const explicitMap = new Map([[gen0Index, 5], [gen1Index, 7]]);
    const params = new Float32Array([1.0, 1.0, 0.0, 1.0, 1.0, 0.0]);
    const pattern = chain.evaluate(params, 8, 42, explicitMap);

    // LCM(5, 7) = 35
    assert.equal(pattern.stepCount, lcm(5, 7));
    assert.equal(pattern.stepCount, 35);
  });

  it('getGeneratorStepCount returns null for unset generators', () => {
    const { chain, gen1Index } = twoGeneratorChain();
    assert.equal(chain.getGeneratorStepCount(gen1Index), null);
  });

  it('setGeneratorStepCount validates chain index', () => {
    const { chain } = twoGeneratorChain();
    assert.throws(() => chain.setGeneratorStepCount(99, 4), { name: 'RangeError' });
    assert.throws(() => chain.setGeneratorStepCount(-1, 4), { name: 'RangeError' });
  });

  it('setGeneratorStepCount validates step count', () => {
    const { chain } = twoGeneratorChain();
    assert.throws(() => chain.setGeneratorStepCount(0, 0), { name: 'RangeError' });
    assert.throws(() => chain.setGeneratorStepCount(0, -1), { name: 'RangeError' });
  });
});

// ---------------------------------------------------------------------------
// Processors run on LCM-length pattern
// ---------------------------------------------------------------------------

describe('polyrhythm chain — processors on LCM-length pattern', () => {
  it('processor receives and outputs the LCM-length pattern', () => {
    const chain = new Chain();
    chain.addPrimitive(new EuclideanRhythm());  // index 0 — generator
    chain.addPrimitive(new EuclideanRhythm());  // index 1 — generator
    chain.addPrimitive(new VelocityShaper());   // index 2 — processor

    chain.setGeneratorStepCount(0, 3);
    chain.setGeneratorStepCount(1, 4);

    // EuclideanRhythm: 3 params each, VelocityShaper: 3 params
    // Fill all with moderate values
    const params = new Float32Array([
      1.0, 1.0, 0.0,  // gen0: all triggers
      1.0, 1.0, 0.0,  // gen1: all triggers
      0.0, 0.5, 0.0,  // velocity shaper: flat curve, half depth, no phase
    ]);
    const pattern = chain.evaluate(params, 8, 42);

    // LCM(3, 4) = 12 — processor should preserve that length
    assert.equal(pattern.stepCount, 12);

    // Velocity shaper should have modified velocities (not all default 0.7)
    // With flat curve (idx 0) and depth 0.5, velocity = 0.7 * 0.5 + 1.0 * 0.5 = 0.85
    const triggeredSteps = pattern.steps.filter(s => s.trigger);
    assert.ok(triggeredSteps.length > 0, 'should have triggered steps');
  });
});

// ---------------------------------------------------------------------------
// Single generator with per-generator step count
// ---------------------------------------------------------------------------

describe('polyrhythm chain — single generator', () => {
  it('single generator uses its per-generator step count', () => {
    const chain = new Chain();
    chain.addPrimitive(new EuclideanRhythm()); // index 0

    chain.setGeneratorStepCount(0, 5);

    const params = new Float32Array([1.0, 1.0, 0.0]);
    const pattern = chain.evaluate(params, 8, 42);

    // Single generator with 5 steps — no merge, output is 5 steps
    assert.equal(pattern.stepCount, 5);
  });
});
