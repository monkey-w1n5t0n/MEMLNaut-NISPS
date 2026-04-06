import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { FreezeManager } from '../freeze.js';
import { Chain } from '../chain.js';
import { EuclideanRhythm, ProbabilityGate, PitchWalker } from '../primitives.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a chain with known primitives for testing.
 * Returns { chain, paramCount }.
 */
function makeTestChain() {
  const chain = new Chain();
  chain.addPrimitive(new EuclideanRhythm());
  chain.addPrimitive(new ProbabilityGate());
  chain.addPrimitive(new PitchWalker());
  return { chain, paramCount: chain.totalParamCount };
}

/**
 * Create a Float32Array of params with sequential values for easy identification.
 */
function makeParams(count) {
  const params = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    params[i] = (i + 1) / (count + 1); // spread across (0, 1)
  }
  return params;
}

// ---------------------------------------------------------------------------
// freeze() captures params, seeds, states correctly
// ---------------------------------------------------------------------------

describe('FreezeManager.freeze()', () => {
  it('captures params as a Float32Array copy', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    const params = makeParams(paramCount);
    const masterSeed = 42;

    fm.freeze(chain, params, masterSeed);

    const frozen = fm.getFrozenParams();
    assert.ok(frozen instanceof Float32Array, 'should be Float32Array');
    assert.strictEqual(frozen.length, paramCount);

    // Values should match
    for (let i = 0; i < paramCount; i++) {
      assert.strictEqual(frozen[i], params[i], 'param ' + i + ' should match');
    }

    // Should be a copy, not the same reference
    assert.notStrictEqual(frozen, params);
  });

  it('captures per-primitive seeds', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    const params = makeParams(paramCount);

    // Set known seeds
    const prims = chain.getPrimitives();
    prims[0].setSeed(100);
    prims[1].setSeed(200);
    prims[2].setSeed(300);

    fm.freeze(chain, params, 42);

    const seeds = fm.getFrozenSeeds();
    assert.ok(Array.isArray(seeds));
    assert.strictEqual(seeds.length, 3);
    assert.strictEqual(seeds[0], 100);
    assert.strictEqual(seeds[1], 200);
    assert.strictEqual(seeds[2], 300);
  });

  it('captures per-primitive states', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    const params = makeParams(paramCount);

    fm.freeze(chain, params, 42);

    const states = fm.getFrozenStates();
    assert.ok(Array.isArray(states));
    assert.strictEqual(states.length, 3);
  });

  it('captures master seed', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    const params = makeParams(paramCount);

    fm.freeze(chain, params, 12345);
    assert.strictEqual(fm.getMasterSeed(), 12345);
  });

  it('initializes all live flags to 0 (frozen)', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    const params = makeParams(paramCount);

    fm.freeze(chain, params, 42);

    const flags = fm.getLiveFlags();
    assert.ok(flags instanceof Uint8Array);
    assert.strictEqual(flags.length, paramCount);
    for (let i = 0; i < paramCount; i++) {
      assert.strictEqual(flags[i], 0, 'param ' + i + ' should be frozen');
    }
  });
});

// ---------------------------------------------------------------------------
// isFrozen
// ---------------------------------------------------------------------------

describe('FreezeManager.isFrozen', () => {
  it('returns false initially', () => {
    const fm = new FreezeManager();
    assert.strictEqual(fm.isFrozen, false);
  });

  it('returns true after freeze()', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    fm.freeze(chain, makeParams(paramCount), 42);
    assert.strictEqual(fm.isFrozen, true);
  });
});

// ---------------------------------------------------------------------------
// toggleParam
// ---------------------------------------------------------------------------

describe('FreezeManager.toggleParam()', () => {
  it('flips a param from frozen to live and back', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    fm.freeze(chain, makeParams(paramCount), 42);

    assert.strictEqual(fm.getLiveFlags()[0], 0);

    fm.toggleParam(0);
    assert.strictEqual(fm.getLiveFlags()[0], 1);

    fm.toggleParam(0);
    assert.strictEqual(fm.getLiveFlags()[0], 0);
  });

  it('only affects the targeted param', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    fm.freeze(chain, makeParams(paramCount), 42);

    fm.toggleParam(2);
    const flags = fm.getLiveFlags();
    assert.strictEqual(flags[0], 0);
    assert.strictEqual(flags[1], 0);
    assert.strictEqual(flags[2], 1);
    assert.strictEqual(flags[3], 0);
  });

  it('throws when not frozen', () => {
    const fm = new FreezeManager();
    assert.throws(() => fm.toggleParam(0), /cannot toggle when not frozen/);
  });

  it('throws on out-of-range index', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    fm.freeze(chain, makeParams(paramCount), 42);
    assert.throws(() => fm.toggleParam(paramCount + 10), /out of range/);
  });
});

// ---------------------------------------------------------------------------
// setParamLive
// ---------------------------------------------------------------------------

describe('FreezeManager.setParamLive()', () => {
  it('explicitly sets live state', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    fm.freeze(chain, makeParams(paramCount), 42);

    fm.setParamLive(1, true);
    assert.strictEqual(fm.getLiveFlags()[1], 1);

    fm.setParamLive(1, false);
    assert.strictEqual(fm.getLiveFlags()[1], 0);
  });

  it('throws when not frozen', () => {
    const fm = new FreezeManager();
    assert.throws(() => fm.setParamLive(0, true), /cannot set when not frozen/);
  });
});

// ---------------------------------------------------------------------------
// getEffectiveParams
// ---------------------------------------------------------------------------

describe('FreezeManager.getEffectiveParams()', () => {
  it('returns frozen values for frozen params, current for live', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    const frozenParams = makeParams(paramCount);

    fm.freeze(chain, frozenParams, 42);

    // Make param 2 live
    fm.toggleParam(2);

    // Create different "current" ML params
    const currentParams = new Float32Array(paramCount);
    for (let i = 0; i < paramCount; i++) {
      currentParams[i] = 0.99;
    }

    const effective = fm.getEffectiveParams(currentParams);
    assert.ok(effective instanceof Float32Array);
    assert.strictEqual(effective.length, paramCount);

    // Param 0: frozen -> uses frozen value
    assert.strictEqual(effective[0], frozenParams[0]);
    // Param 1: frozen -> uses frozen value
    assert.strictEqual(effective[1], frozenParams[1]);
    // Param 2: live -> uses current ML value (Float32 precision)
    assert.ok(Math.abs(effective[2] - 0.99) < 1e-5, 'live param should use current ML value');
    // Param 3: frozen -> uses frozen value
    assert.strictEqual(effective[3], frozenParams[3]);
  });

  it('returns null when not frozen', () => {
    const fm = new FreezeManager();
    const result = fm.getEffectiveParams(new Float32Array(4));
    assert.strictEqual(result, null);
  });
});

// ---------------------------------------------------------------------------
// unfreeze
// ---------------------------------------------------------------------------

describe('FreezeManager.unfreeze()', () => {
  it('clears all captured state', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    fm.freeze(chain, makeParams(paramCount), 42);

    assert.strictEqual(fm.isFrozen, true);

    fm.unfreeze();

    assert.strictEqual(fm.isFrozen, false);
    assert.strictEqual(fm.getFrozenParams(), null);
    assert.strictEqual(fm.getLiveFlags(), null);
    assert.strictEqual(fm.getFrozenSeeds(), null);
    assert.strictEqual(fm.getFrozenStates(), null);
    assert.strictEqual(fm.getMasterSeed(), null);
  });
});

// ---------------------------------------------------------------------------
// shouldSuppressReEval
// ---------------------------------------------------------------------------

describe('FreezeManager.shouldSuppressReEval()', () => {
  it('returns true when frozen', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    fm.freeze(chain, makeParams(paramCount), 42);
    assert.strictEqual(fm.shouldSuppressReEval(), true);
  });

  it('returns false when not frozen', () => {
    const fm = new FreezeManager();
    assert.strictEqual(fm.shouldSuppressReEval(), false);
  });

  it('returns false after unfreeze', () => {
    const fm = new FreezeManager();
    const { chain, paramCount } = makeTestChain();
    fm.freeze(chain, makeParams(paramCount), 42);
    fm.unfreeze();
    assert.strictEqual(fm.shouldSuppressReEval(), false);
  });
});
