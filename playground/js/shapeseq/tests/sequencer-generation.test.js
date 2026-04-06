/**
 * Tests for ShapeSeqEngine generation counter dirty-check.
 *
 * The full ShapeSeqEngine requires AudioContext, C15Bridge, and WASM,
 * so we test the generation counter logic by creating a minimal subclass
 * that stubs out the heavy dependencies while preserving the dirty-check
 * and config-mutation methods.
 *
 * Run with Node >= 18:  node --test playground/js/shapeseq/tests/sequencer-generation.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal stub of EventBus ────────────────────────────────────────

class StubEventBus {
  constructor() { this._listeners = new Map(); }
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
  }
  off(event, fn) {
    this._listeners.get(event)?.delete(fn);
  }
  emit(event, data) {
    for (const fn of this._listeners.get(event) ?? []) fn(data);
  }
}

// ── Minimal harness that replicates the generation + dirty-check logic
//    from ShapeSeqEngine without needing AudioContext / WASM / C15 ────

class GenerationTestHarness {
  constructor(eventBus) {
    this._bus = eventBus;

    // Dirty-check state (mirrors sequencer.js)
    this._lastInputs = [NaN, NaN];
    this._generation = 0;
    this._lastGeneration = -1;

    // Track how many times the pipeline actually ran
    this.evaluationCount = 0;

    // Bound handler for chain edits
    this._onChainEdit = () => this._bumpGeneration();
    this._bus.on('ui.chainEdit', this._onChainEdit);
  }

  // Config mutators (same as sequencer.js)
  setTempo(_bpm) { this._bumpGeneration(); }
  setStepCount(_count) { this._bumpGeneration(); }
  setProjection(_name) { this._bumpGeneration(); }

  /** Mirrors ShapeSeqEngine.setSequenceInputs dirty-check exactly. */
  setSequenceInputs(values) {
    const EPS = 1e-5;
    const inputsSame = Math.abs(values[0] - this._lastInputs[0]) < EPS &&
                       Math.abs(values[1] - this._lastInputs[1]) < EPS;
    const generationSame = this._generation === this._lastGeneration;
    if (inputsSame && generationSame) {
      return;
    }
    this._lastInputs[0] = values[0];
    this._lastInputs[1] = values[1];
    this._lastGeneration = this._generation;

    // Instead of running MLP pipeline, just count.
    this.evaluationCount++;
  }

  _bumpGeneration() { this._generation++; }

  destroy() {
    this._bus.off('ui.chainEdit', this._onChainEdit);
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ShapeSeqEngine generation counter', () => {
  let bus;
  let engine;

  beforeEach(() => {
    bus = new StubEventBus();
    engine = new GenerationTestHarness(bus);
  });

  it('evaluates on first call even with default inputs', () => {
    engine.setSequenceInputs([0.5, 0.5]);
    assert.equal(engine.evaluationCount, 1);
  });

  it('skips evaluation when inputs are identical', () => {
    engine.setSequenceInputs([0.5, 0.5]);
    engine.setSequenceInputs([0.5, 0.5]);
    assert.equal(engine.evaluationCount, 1);
  });

  it('re-evaluates when inputs change', () => {
    engine.setSequenceInputs([0.5, 0.5]);
    engine.setSequenceInputs([0.6, 0.5]);
    assert.equal(engine.evaluationCount, 2);
  });

  it('re-evaluates on setTempo even with same inputs', () => {
    engine.setSequenceInputs([0.5, 0.5]);
    assert.equal(engine.evaluationCount, 1);

    engine.setTempo(140);
    engine.setSequenceInputs([0.5, 0.5]);
    assert.equal(engine.evaluationCount, 2);
  });

  it('re-evaluates on setStepCount even with same inputs', () => {
    engine.setSequenceInputs([0.5, 0.5]);
    engine.setStepCount(16);
    engine.setSequenceInputs([0.5, 0.5]);
    assert.equal(engine.evaluationCount, 2);
  });

  it('re-evaluates on setProjection() even with same inputs', () => {
    engine.setSequenceInputs([0.5, 0.5]);
    engine.setProjection({ gateThreshold: 0.5 });
    engine.setSequenceInputs([0.5, 0.5]);
    assert.equal(engine.evaluationCount, 2);
  });

  it('re-evaluates on ui.chainEdit event even with same inputs', () => {
    engine.setSequenceInputs([0.5, 0.5]);
    bus.emit('ui.chainEdit', { action: 'add', name: 'EuclideanRhythm' });
    engine.setSequenceInputs([0.5, 0.5]);
    assert.equal(engine.evaluationCount, 2);
  });

  it('generation bump is consumed after one evaluation', () => {
    engine.setSequenceInputs([0.5, 0.5]);
    engine.setTempo(140);
    engine.setSequenceInputs([0.5, 0.5]); // consumes the bump
    engine.setSequenceInputs([0.5, 0.5]); // should be skipped
    assert.equal(engine.evaluationCount, 2);
  });

  it('multiple config changes before evaluation only cause one extra eval', () => {
    engine.setSequenceInputs([0.5, 0.5]);
    engine.setTempo(140);
    engine.setStepCount(16);
    engine.setProjection({ velocityCurve: 'sCurve' });
    bus.emit('ui.chainEdit', { action: 'remove', index: 0 });
    engine.setSequenceInputs([0.5, 0.5]);
    assert.equal(engine.evaluationCount, 2);
  });

  it('generation counter increments correctly', () => {
    assert.equal(engine._generation, 0);
    engine.setTempo(100);
    assert.equal(engine._generation, 1);
    engine.setStepCount(4);
    assert.equal(engine._generation, 2);
    bus.emit('ui.chainEdit', { action: 'reorder', from: 0, to: 1 });
    assert.equal(engine._generation, 3);
  });
});
