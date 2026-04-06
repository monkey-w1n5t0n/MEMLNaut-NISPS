import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { serializeShapeSeqState, restoreShapeSeqState } from '../session.js';
import { Chain } from '../chain.js';
import { FreezeManager } from '../freeze.js';
import {
  EuclideanRhythm,
  ProbabilityGate,
  PitchWalker,
  IntervalLock,
  VelocityShaper,
  PRIMITIVE_REGISTRY,
} from '../primitives.js';
import { createProjection } from '../projection.js';

// ---------------------------------------------------------------------------
// Helpers — minimal engine stub
// ---------------------------------------------------------------------------

/**
 * Build a fake ShapeSeqEngine with the same accessor shape the session
 * module expects, but without AudioContext/EventBus/C15 dependencies.
 */
function makeFakeEngine(opts = {}) {
  const chain = new Chain();
  const prims = opts.primitives ?? [
    new EuclideanRhythm(),
    new ProbabilityGate(),
    new PitchWalker(),
    new IntervalLock(),
    new VelocityShaper(),
  ];
  for (const p of prims) chain.addPrimitive(p);
  if (opts.combineMode) chain.generatorCombineMode = opts.combineMode;

  const projection = opts.projection ?? createProjection();
  const fm = new FreezeManager();

  let voiceMode = opts.voiceMode ?? 'mono';
  const bpm = opts.bpm ?? 120;
  let seqWeights = opts.sequenceWeights ?? null;

  return {
    getChain: () => chain,
    getClock: () => ({ bpm }),
    getSequenceIML: () => seqWeights
      ? { getWeights: () => seqWeights, setWeights: (w) => { seqWeights = w; } }
      : null,
    getProjection: () => projection,
    get voiceMode() { return voiceMode; },
    setVoiceMode: (m) => { voiceMode = m; },
    setProjection: (p) => { /* stub */ },
    setTempo: (t) => { /* stub */ },
    get freezeManager() { return fm; },
  };
}

// ---------------------------------------------------------------------------
// serializeShapeSeqState
// ---------------------------------------------------------------------------

describe('serializeShapeSeqState', () => {
  it('produces a version-1 object with all expected top-level keys', () => {
    const engine = makeFakeEngine();
    const state = serializeShapeSeqState(engine);

    assert.strictEqual(state.version, 1);
    assert.ok('chain' in state);
    assert.ok('projection' in state);
    assert.ok('voiceMode' in state);
    assert.ok('clock' in state);
    assert.ok('sequenceWeights' in state);
    assert.ok('freeze' in state);
  });

  it('serializes chain primitives by name', () => {
    const engine = makeFakeEngine({
      primitives: [new EuclideanRhythm(), new PitchWalker()],
    });
    const state = serializeShapeSeqState(engine);

    assert.strictEqual(state.chain.primitives.length, 2);
    assert.strictEqual(state.chain.primitives[0].name, 'EuclideanRhythm');
    assert.strictEqual(state.chain.primitives[1].name, 'PitchWalker');
  });

  it('captures generator combine mode', () => {
    const engine = makeFakeEngine({ combineMode: 'multiplicative' });
    const state = serializeShapeSeqState(engine);

    assert.strictEqual(state.chain.generatorCombineMode, 'multiplicative');
  });

  it('captures primitive states array', () => {
    const engine = makeFakeEngine({
      primitives: [new PitchWalker()],
    });
    const state = serializeShapeSeqState(engine);

    assert.ok(Array.isArray(state.chain.states));
    assert.strictEqual(state.chain.states.length, 1);
    // PitchWalker default state has position
    assert.strictEqual(typeof state.chain.states[0].position, 'number');
  });

  it('captures projection config', () => {
    const proj = createProjection({
      velocityCurve: 'exponential',
      gateThreshold: 0.25,
      pitchRange: { low: 36, high: 84 },
    });
    const engine = makeFakeEngine({ projection: proj });
    const state = serializeShapeSeqState(engine);

    assert.strictEqual(state.projection.velocityCurve, 'exponential');
    assert.strictEqual(state.projection.gateThreshold, 0.25);
    assert.strictEqual(state.projection.pitchRange.low, 36);
    assert.strictEqual(state.projection.pitchRange.high, 84);
  });

  it('captures voice mode', () => {
    const engine = makeFakeEngine({ voiceMode: 'poly' });
    const state = serializeShapeSeqState(engine);

    assert.strictEqual(state.voiceMode, 'poly');
  });

  it('captures clock BPM', () => {
    const engine = makeFakeEngine({ bpm: 140 });
    const state = serializeShapeSeqState(engine);

    assert.strictEqual(state.clock.bpm, 140);
  });

  it('captures sequence MLP weights when available', () => {
    const weights = [[1, 2], [3, 4]];
    const engine = makeFakeEngine({ sequenceWeights: weights });
    const state = serializeShapeSeqState(engine);

    assert.deepStrictEqual(state.sequenceWeights, weights);
  });

  it('sets sequenceWeights to null when IML is unavailable', () => {
    const engine = makeFakeEngine(); // no sequenceWeights
    const state = serializeShapeSeqState(engine);

    assert.strictEqual(state.sequenceWeights, null);
  });

  it('freeze is null when not frozen', () => {
    const engine = makeFakeEngine();
    const state = serializeShapeSeqState(engine);

    assert.strictEqual(state.freeze, null);
  });

  it('freeze state is serialized when frozen in algorithm mode', () => {
    const engine = makeFakeEngine({
      primitives: [new EuclideanRhythm(), new ProbabilityGate()],
    });
    const chain = engine.getChain();
    const paramCount = chain.totalParamCount;
    const params = new Float32Array(paramCount);
    for (let i = 0; i < paramCount; i++) params[i] = i / paramCount;

    engine.freezeManager.freeze(chain, params, 42);

    const state = serializeShapeSeqState(engine);

    assert.ok(state.freeze !== null);
    assert.strictEqual(state.freeze.mode, 'algorithm');
    assert.ok(Array.isArray(state.freeze.frozenParams));
    assert.strictEqual(state.freeze.frozenParams.length, paramCount);
    assert.ok(Array.isArray(state.freeze.liveFlags));
    assert.strictEqual(state.freeze.masterSeed, 42);
  });
});

// ---------------------------------------------------------------------------
// restoreShapeSeqState
// ---------------------------------------------------------------------------

describe('restoreShapeSeqState', () => {
  it('rebuilds chain from primitive names', () => {
    const engine = makeFakeEngine({ primitives: [] });
    assert.strictEqual(engine.getChain().getPrimitives().length, 0);

    const state = {
      version: 1,
      chain: {
        primitives: [
          { name: 'PitchWalker' },
          { name: 'EuclideanRhythm' },
          { name: 'VelocityShaper' },
        ],
        states: null,
        generatorCombineMode: 'additive',
      },
      projection: null,
      voiceMode: null,
      clock: null,
      sequenceWeights: null,
      freeze: null,
    };

    restoreShapeSeqState(engine, state);

    const prims = engine.getChain().getPrimitives();
    assert.strictEqual(prims.length, 3);
    assert.strictEqual(prims[0].name, 'PitchWalker');
    assert.strictEqual(prims[1].name, 'EuclideanRhythm');
    assert.strictEqual(prims[2].name, 'VelocityShaper');
  });

  it('restores generator combine mode', () => {
    const engine = makeFakeEngine();
    const state = {
      version: 1,
      chain: {
        primitives: [{ name: 'EuclideanRhythm' }],
        states: null,
        generatorCombineMode: 'multiplicative',
      },
      projection: null,
      voiceMode: null,
      clock: null,
      sequenceWeights: null,
      freeze: null,
    };

    restoreShapeSeqState(engine, state);
    assert.strictEqual(engine.getChain().generatorCombineMode, 'multiplicative');
  });

  it('restores projection config', () => {
    let capturedProjection = null;
    const engine = makeFakeEngine();
    engine.setProjection = (p) => { capturedProjection = p; };

    const proj = {
      velocityCurve: 'sCurve',
      gateThreshold: 0.4,
      pitchRange: { low: 24, high: 96 },
    };

    restoreShapeSeqState(engine, {
      version: 1,
      chain: null,
      projection: proj,
      voiceMode: null,
      clock: null,
      sequenceWeights: null,
      freeze: null,
    });

    assert.deepStrictEqual(capturedProjection, proj);
  });

  it('restores voice mode', () => {
    let capturedMode = null;
    const engine = makeFakeEngine();
    engine.setVoiceMode = (m) => { capturedMode = m; };

    restoreShapeSeqState(engine, {
      version: 1,
      chain: null,
      projection: null,
      voiceMode: 'poly',
      clock: null,
      sequenceWeights: null,
      freeze: null,
    });

    assert.strictEqual(capturedMode, 'poly');
  });

  it('restores clock BPM', () => {
    let capturedBPM = null;
    const engine = makeFakeEngine();
    engine.setTempo = (t) => { capturedBPM = t; };

    restoreShapeSeqState(engine, {
      version: 1,
      chain: null,
      projection: null,
      voiceMode: null,
      clock: { bpm: 90 },
      sequenceWeights: null,
      freeze: null,
    });

    assert.strictEqual(capturedBPM, 90);
  });

  it('restores sequence MLP weights when IML available', () => {
    const weights = [[5, 6], [7, 8]];
    const engine = makeFakeEngine({ sequenceWeights: [[0, 0]] });

    restoreShapeSeqState(engine, {
      version: 1,
      chain: null,
      projection: null,
      voiceMode: null,
      clock: null,
      sequenceWeights: weights,
      freeze: null,
    });

    // The stub's setWeights should have been called
    assert.deepStrictEqual(engine.getSequenceIML().getWeights(), weights);
  });

  it('skips unknown primitive names gracefully', () => {
    const engine = makeFakeEngine({ primitives: [] });

    const state = {
      version: 1,
      chain: {
        primitives: [
          { name: 'EuclideanRhythm' },
          { name: 'NonExistentPrimitive' },
          { name: 'PitchWalker' },
        ],
        states: null,
        generatorCombineMode: 'additive',
      },
      projection: null,
      voiceMode: null,
      clock: null,
      sequenceWeights: null,
      freeze: null,
    };

    // Should not throw
    restoreShapeSeqState(engine, state);

    // Unknown primitive skipped, only valid ones added
    const prims = engine.getChain().getPrimitives();
    assert.strictEqual(prims.length, 2);
    assert.strictEqual(prims[0].name, 'EuclideanRhythm');
    assert.strictEqual(prims[1].name, 'PitchWalker');
  });

  it('handles null state without throwing', () => {
    const engine = makeFakeEngine();
    // Should not throw
    restoreShapeSeqState(engine, null);
    restoreShapeSeqState(engine, undefined);
  });

  it('handles wrong version without throwing', () => {
    const engine = makeFakeEngine();
    restoreShapeSeqState(engine, { version: 99 });
    // Chain should be untouched
    assert.strictEqual(engine.getChain().getPrimitives().length, 5);
  });

  it('handles state with missing optional fields', () => {
    const engine = makeFakeEngine({ primitives: [] });

    // Minimal valid state — only version and chain
    restoreShapeSeqState(engine, {
      version: 1,
      chain: {
        primitives: [{ name: 'EuclideanRhythm' }],
      },
    });

    assert.strictEqual(engine.getChain().getPrimitives().length, 1);
  });

  it('restores primitive states alongside chain rebuild', () => {
    const engine = makeFakeEngine({ primitives: [] });

    const state = {
      version: 1,
      chain: {
        primitives: [{ name: 'PitchWalker' }],
        states: [{ position: 0.75 }],
        generatorCombineMode: 'additive',
      },
      projection: null,
      voiceMode: null,
      clock: null,
      sequenceWeights: null,
      freeze: null,
    };

    restoreShapeSeqState(engine, state);

    const chainStates = engine.getChain().getState();
    assert.strictEqual(chainStates[0].position, 0.75);
  });
});
