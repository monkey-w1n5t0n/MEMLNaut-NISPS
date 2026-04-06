/**
 * ShapeSeq session state serialization.
 *
 * Captures and restores the complete ShapeSeq state:
 * - Chain configuration (which primitives, in what order)
 * - Primitive states (e.g., PitchWalker position)
 * - Generator combine mode
 * - Projection config (3 knobs)
 * - Voice mode (mono/poly)
 * - Sequence MLP weights (if in dual mode)
 * - Freeze state (mode, frozen params, live flags, seeds)
 * - Clock config (BPM, step count)
 *
 * @module shapeseq/session
 */

import { PRIMITIVE_REGISTRY } from './primitives.js';

/**
 * Serialize ShapeSeq engine state to a plain object (JSON-safe).
 * @param {import('./sequencer.js').ShapeSeqEngine} engine
 * @returns {Object}
 */
export function serializeShapeSeqState(engine) {
  const chain = engine.getChain();
  const prims = chain.getPrimitives();

  return {
    version: 1,
    chain: {
      primitives: prims.map(p => ({
        name: p.name,
      })),
      states: chain.getState(),
      generatorCombineMode: chain.generatorCombineMode,
    },
    projection: engine.getProjection(),
    voiceMode: engine.voiceMode,
    clock: {
      bpm: engine.getClock().bpm,
    },
    // Sequence MLP weights (for dual mode restoration)
    sequenceWeights: engine.getSequenceIML()?.getWeights?.() ?? null,
    // Freeze state
    freeze: serializeFreezeState(engine.freezeManager),
  };
}

/**
 * Serialize freeze manager state to a JSON-safe object.
 * Returns null when not frozen.
 *
 * @param {import('./freeze.js').FreezeManager} fm
 * @returns {Object|null}
 */
function serializeFreezeState(fm) {
  if (!fm.isFrozen) return null;
  return {
    mode: fm.freezeMode,
    frozenParams: fm.getFrozenParams() ? Array.from(fm.getFrozenParams()) : null,
    liveFlags: fm.getLiveFlags() ? Array.from(fm.getLiveFlags()) : null,
    seeds: fm.getFrozenSeeds(),
    states: fm.getFrozenStates(),
    masterSeed: fm.getMasterSeed(),
    // For pattern mode:
    frozenPattern: fm.getFrozenPattern() ?? null,
  };
}

/**
 * Restore ShapeSeq engine state from a serialized object.
 * @param {import('./sequencer.js').ShapeSeqEngine} engine
 * @param {Object} state - from serializeShapeSeqState
 */
export function restoreShapeSeqState(engine, state) {
  if (!state || state.version !== 1) return;

  const chain = engine.getChain();

  // Rebuild chain from primitive names
  if (state.chain?.primitives) {
    // Clear existing
    const existing = chain.getPrimitives();
    for (let i = existing.length - 1; i >= 0; i--) {
      chain.removePrimitive(i);
    }
    // Add from state
    for (const p of state.chain.primitives) {
      const Ctor = PRIMITIVE_REGISTRY[p.name];
      if (Ctor) chain.addPrimitive(new Ctor());
    }
    // Restore states
    if (state.chain.states) chain.setState(state.chain.states);
    if (state.chain.generatorCombineMode) {
      chain.generatorCombineMode = state.chain.generatorCombineMode;
    }
  }

  // Projection
  if (state.projection) engine.setProjection(state.projection);

  // Voice mode
  if (state.voiceMode) engine.setVoiceMode(state.voiceMode);

  // Clock
  if (state.clock?.bpm) engine.setTempo(state.clock.bpm);

  // Sequence MLP weights
  if (state.sequenceWeights) {
    const iml = engine.getSequenceIML();
    if (iml?.setWeights) iml.setWeights(state.sequenceWeights);
  }

  // Freeze state restoration is complex — skip for now, just ensure unfrozen on load
  // TODO: restore freeze state properly
}
