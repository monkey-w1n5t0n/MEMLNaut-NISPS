import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Primitive } from '../primitive.js';
import { PitchWalker, EuclideanRhythm, ProbabilityGate } from '../primitives.js';
import { Chain } from '../chain.js';

// ---------------------------------------------------------------------------
// Primitive.reEvalOnLoop default
// ---------------------------------------------------------------------------

describe('Primitive.reEvalOnLoop', () => {
  it('defaults to false on the base class', () => {
    // Use a concrete subclass that does not override reEvalOnLoop
    const prim = new EuclideanRhythm();
    assert.strictEqual(prim.reEvalOnLoop, false);
  });

  it('defaults to false for non-stateful primitives', () => {
    const gate = new ProbabilityGate();
    assert.strictEqual(gate.reEvalOnLoop, false);
  });
});

// ---------------------------------------------------------------------------
// PitchWalker.reEvalOnLoop
// ---------------------------------------------------------------------------

describe('PitchWalker.reEvalOnLoop', () => {
  it('is true', () => {
    const walker = new PitchWalker();
    assert.strictEqual(walker.reEvalOnLoop, true);
  });
});

// ---------------------------------------------------------------------------
// Chain.hasReEvalPrimitives()
// ---------------------------------------------------------------------------

describe('Chain.hasReEvalPrimitives()', () => {
  it('returns false for an empty chain', () => {
    const chain = new Chain();
    assert.strictEqual(chain.hasReEvalPrimitives(), false);
  });

  it('returns false when no primitives have reEvalOnLoop', () => {
    const chain = new Chain();
    chain.addPrimitive(new EuclideanRhythm());
    chain.addPrimitive(new ProbabilityGate());
    assert.strictEqual(chain.hasReEvalPrimitives(), false);
  });

  it('returns true when at least one primitive has reEvalOnLoop', () => {
    const chain = new Chain();
    chain.addPrimitive(new EuclideanRhythm());
    chain.addPrimitive(new PitchWalker());
    assert.strictEqual(chain.hasReEvalPrimitives(), true);
  });

  it('returns false after removing the only reEvalOnLoop primitive', () => {
    const chain = new Chain();
    chain.addPrimitive(new EuclideanRhythm());
    chain.addPrimitive(new PitchWalker());
    assert.strictEqual(chain.hasReEvalPrimitives(), true);

    // PitchWalker is at index 1
    chain.removePrimitive(1);
    assert.strictEqual(chain.hasReEvalPrimitives(), false);
  });
});

// ---------------------------------------------------------------------------
// Sequencer integration (requires browser APIs: AudioContext, WASM, etc.)
// ---------------------------------------------------------------------------

// NOTE: ShapeSeqEngine integration tests for loop-start re-evaluation
// require browser APIs (AudioContext, WASM IML, ClockEngine with
// requestAnimationFrame). These must be tested in a browser environment
// or with appropriate mocks (e.g. Playwright e2e tests).
//
// Key behaviors to verify in integration tests:
//   1. seq.loopStart event triggers _handleLoopStart()
//   2. _handleLoopStart() bumps generation and calls setSequenceInputs()
//      when chain.hasReEvalPrimitives() is true
//   3. _handleLoopStart() is a no-op when chain has no reEval primitives
//   4. Unsubscribes from seq.loopStart on destroy()
//   5. freeze-as-algorithm (meml-9h1) suppresses re-evaluation (future)
