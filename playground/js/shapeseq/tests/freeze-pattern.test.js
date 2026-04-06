import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { FreezeManager } from '../freeze.js';
import { Chain } from '../chain.js';
import { EuclideanRhythm, ProbabilityGate, PitchWalker } from '../primitives.js';
import { createPattern, clonePattern } from '../pattern.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestChain() {
  const chain = new Chain();
  chain.addPrimitive(new EuclideanRhythm());
  chain.addPrimitive(new ProbabilityGate());
  chain.addPrimitive(new PitchWalker());
  return { chain, paramCount: chain.totalParamCount };
}

function makeParams(count) {
  const params = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    params[i] = (i + 1) / (count + 1);
  }
  return params;
}

/**
 * Create a pattern with some non-default step data for testing.
 */
function makeTestPattern(stepCount) {
  const pattern = createPattern(stepCount);
  for (let i = 0; i < stepCount; i++) {
    pattern.steps[i].trigger = i % 2 === 0;
    pattern.steps[i].pitch = (i + 1) / (stepCount + 1);
    pattern.steps[i].velocity = 0.5 + (i * 0.05);
    pattern.steps[i].accent = i === 0;
    pattern.steps[i].midiNote = 60 + i;
  }
  pattern.metadata.source = 'test';
  return pattern;
}

// ---------------------------------------------------------------------------
// freeze with mode='pattern' captures the pattern
// ---------------------------------------------------------------------------

describe('FreezeManager freeze-as-pattern', () => {
  it('freeze with mode=pattern captures the pattern', () => {
    const fm = new FreezeManager();
    const pattern = makeTestPattern(8);

    fm.freeze(null, null, null, 'pattern', pattern);

    assert.strictEqual(fm.isFrozen, true);
    const frozen = fm.getFrozenPattern();
    assert.ok(frozen !== null, 'frozen pattern should not be null');
    assert.strictEqual(frozen.stepCount, 8);
    assert.strictEqual(frozen.steps.length, 8);
  });

  it('getFrozenPattern returns the captured pattern', () => {
    const fm = new FreezeManager();
    const pattern = makeTestPattern(4);

    fm.freeze(null, null, null, 'pattern', pattern);

    const frozen = fm.getFrozenPattern();
    // Verify step data matches
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(frozen.steps[i].trigger, pattern.steps[i].trigger,
        'step ' + i + ' trigger should match');
      assert.strictEqual(frozen.steps[i].pitch, pattern.steps[i].pitch,
        'step ' + i + ' pitch should match');
      assert.strictEqual(frozen.steps[i].velocity, pattern.steps[i].velocity,
        'step ' + i + ' velocity should match');
      assert.strictEqual(frozen.steps[i].midiNote, pattern.steps[i].midiNote,
        'step ' + i + ' midiNote should match');
    }
    assert.strictEqual(frozen.metadata.source, 'test');
  });

  it('freezeMode is pattern', () => {
    const fm = new FreezeManager();
    const pattern = makeTestPattern(8);

    fm.freeze(null, null, null, 'pattern', pattern);

    assert.strictEqual(fm.freezeMode, 'pattern');
  });

  it('getEffectiveParams returns null in pattern mode', () => {
    const fm = new FreezeManager();
    const pattern = makeTestPattern(8);

    fm.freeze(null, null, null, 'pattern', pattern);

    const result = fm.getEffectiveParams(new Float32Array(8));
    assert.strictEqual(result, null);
  });

  it('shouldSuppressReEval returns true in pattern mode', () => {
    const fm = new FreezeManager();
    const pattern = makeTestPattern(8);

    fm.freeze(null, null, null, 'pattern', pattern);

    assert.strictEqual(fm.shouldSuppressReEval(), true);
  });

  it('unfreeze clears frozen pattern', () => {
    const fm = new FreezeManager();
    const pattern = makeTestPattern(8);

    fm.freeze(null, null, null, 'pattern', pattern);
    assert.strictEqual(fm.isFrozen, true);
    assert.ok(fm.getFrozenPattern() !== null);

    fm.unfreeze();

    assert.strictEqual(fm.isFrozen, false);
    assert.strictEqual(fm.freezeMode, null);
    assert.strictEqual(fm.getFrozenPattern(), null);
    assert.strictEqual(fm.getFrozenParams(), null);
    assert.strictEqual(fm.getFrozenSeeds(), null);
    assert.strictEqual(fm.getFrozenStates(), null);
    assert.strictEqual(fm.getMasterSeed(), null);
  });

  it('freeze with mode=algorithm still works (backward compat)', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    const params = makeParams(paramCount);

    fm.freeze(chain, params, 42, 'algorithm');

    assert.strictEqual(fm.isFrozen, true);
    assert.strictEqual(fm.freezeMode, 'algorithm');
    assert.ok(fm.getFrozenParams() instanceof Float32Array);
    assert.strictEqual(fm.getFrozenParams().length, paramCount);
    assert.ok(Array.isArray(fm.getFrozenSeeds()));
    assert.ok(Array.isArray(fm.getFrozenStates()));
    assert.strictEqual(fm.getMasterSeed(), 42);
    assert.strictEqual(fm.getFrozenPattern(), null);
  });

  it('freeze with default mode is algorithm (backward compat)', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    const params = makeParams(paramCount);

    // Call without mode argument — should default to 'algorithm'
    fm.freeze(chain, params, 42);

    assert.strictEqual(fm.freezeMode, 'algorithm');
    assert.ok(fm.getFrozenParams() instanceof Float32Array);
    assert.strictEqual(fm.getFrozenPattern(), null);
  });

  it('frozen pattern is a deep clone (mutating original does not affect frozen)', () => {
    const fm = new FreezeManager();
    const pattern = makeTestPattern(4);

    fm.freeze(null, null, null, 'pattern', pattern);

    // Mutate the original
    pattern.steps[0].trigger = !pattern.steps[0].trigger;
    pattern.steps[0].pitch = 0.999;
    pattern.steps[0].midiNote = 127;
    pattern.metadata.source = 'mutated';

    // Frozen should be unaffected
    const frozen = fm.getFrozenPattern();
    assert.strictEqual(frozen.steps[0].trigger, true, 'frozen trigger should be unchanged');
    assert.notStrictEqual(frozen.steps[0].pitch, 0.999, 'frozen pitch should be unchanged');
    assert.strictEqual(frozen.steps[0].midiNote, 60, 'frozen midiNote should be unchanged');
    assert.strictEqual(frozen.metadata.source, 'test', 'frozen metadata should be unchanged');
  });

  it('pattern mode throws if currentPattern is null', () => {
    const fm = new FreezeManager();
    assert.throws(
      () => fm.freeze(null, null, null, 'pattern', null),
      /pattern mode requires a currentPattern/
    );
  });

  it('freezeMode is null when not frozen', () => {
    const fm = new FreezeManager();
    assert.strictEqual(fm.freezeMode, null);
  });

  it('getFrozenPattern returns null when not frozen', () => {
    const fm = new FreezeManager();
    assert.strictEqual(fm.getFrozenPattern(), null);
  });

  it('getFrozenPattern returns null in algorithm mode', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    fm.freeze(chain, makeParams(paramCount), 42, 'algorithm');
    assert.strictEqual(fm.getFrozenPattern(), null);
  });

  it('algorithm-mode state is null in pattern mode', () => {
    const fm = new FreezeManager();
    const pattern = makeTestPattern(8);

    fm.freeze(null, null, null, 'pattern', pattern);

    assert.strictEqual(fm.getFrozenParams(), null);
    assert.strictEqual(fm.getFrozenSeeds(), null);
    assert.strictEqual(fm.getFrozenStates(), null);
    assert.strictEqual(fm.getLiveFlags(), null);
    assert.strictEqual(fm.getMasterSeed(), null);
  });
});
