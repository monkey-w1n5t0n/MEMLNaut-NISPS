/**
 * ShapeSeq FreezeManager — freeze-as-algorithm and freeze-as-pattern
 *
 * Two freeze modes:
 *
 * - **algorithm**: Captures all primitive param values + PRNG seeds.
 *   Frozen params hold their captured values; individual params can
 *   be selectively re-exposed as "live" for ML-driven exploration.
 *
 * - **pattern**: Captures the realized note pattern (the actual step
 *   events for one full loop). The sequencer bypasses the primitive
 *   chain entirely and just loops the frozen pattern.
 *
 * Delta math (proper delta+boundary logic) is a separate issue (meml-7goy).
 * This module provides the simple version: frozen params use captured values,
 * live params pass through current ML values.
 *
 * @module shapeseq/freeze
 */

import { clonePattern } from './pattern.js';

export class FreezeManager {
  constructor() {
    /** @private */ this._frozen = false;
    /** @private @type {'algorithm'|'pattern'|null} */ this._freezeMode = null;
    /** @private @type {Float32Array|null} */ this._frozenParams = null;
    /** @private @type {Array<number>|null} */ this._frozenSeeds = null;
    /** @private @type {Array<Object>|null} */ this._frozenStates = null;
    /** @private @type {Uint8Array|null} */ this._liveFlags = null;
    /** @private @type {number|null} */ this._masterSeed = null;
    /** @private @type {Object|null} */ this._frozenPattern = null;
  }

  // ── Freeze / unfreeze ───────────────────────────────────────────────

  /**
   * Capture a full snapshot of the current state.
   *
   * In **algorithm** mode (default): captures params, seeds, and states.
   * All params start frozen (liveFlags = 0); use toggleParam() or
   * setParamLive() to selectively re-expose params for ML control.
   *
   * In **pattern** mode: captures the realized note pattern via deep clone.
   * The primitive chain is bypassed entirely — the sequencer just loops
   * the frozen pattern.
   *
   * @param {import('./chain.js').Chain|null} chain
   * @param {Float32Array|Array<number>|null} currentParams - flat param array
   * @param {number|null} masterSeed
   * @param {'algorithm'|'pattern'} [mode='algorithm']
   * @param {Object|null} [currentPattern=null] - required when mode is 'pattern'
   */
  freeze(chain, currentParams, masterSeed, mode = 'algorithm', currentPattern = null) {
    this._freezeMode = mode;

    if (mode === 'pattern') {
      // Pattern mode: capture the realized pattern, bypass chain
      if (!currentPattern) {
        throw new Error('freeze: pattern mode requires a currentPattern');
      }
      this._frozenPattern = clonePattern(currentPattern);
      // Clear algorithm-mode state
      this._frozenParams = null;
      this._frozenSeeds = null;
      this._frozenStates = null;
      this._liveFlags = null;
      this._masterSeed = null;
    } else {
      // Algorithm mode: existing behavior
      // Copy param values
      this._frozenParams = new Float32Array(currentParams.length);
      for (let i = 0; i < currentParams.length; i++) {
        this._frozenParams[i] = currentParams[i];
      }

      // Capture per-primitive seeds
      this._frozenSeeds = chain.getPrimitives().map(p => p.getSeed());

      // Capture per-primitive states
      this._frozenStates = chain.getState();

      // Store master seed
      this._masterSeed = masterSeed;

      // All params frozen by default
      this._liveFlags = new Uint8Array(currentParams.length);

      // Clear pattern-mode state
      this._frozenPattern = null;
    }

    this._frozen = true;
  }

  /**
   * Clear all captured state and return to unfrozen mode.
   */
  unfreeze() {
    this._frozen = false;
    this._freezeMode = null;
    this._frozenParams = null;
    this._frozenSeeds = null;
    this._frozenStates = null;
    this._liveFlags = null;
    this._masterSeed = null;
    this._frozenPattern = null;
  }

  // ── Per-param live/frozen control ──────────────────────────────────

  /**
   * Toggle a param between frozen (0) and live (1).
   * Only valid when frozen; throws if not frozen.
   *
   * @param {number} flatIndex - index into the flat param array
   */
  toggleParam(flatIndex) {
    if (!this._frozen) {
      throw new Error('toggleParam: cannot toggle when not frozen');
    }
    const idx = flatIndex | 0;
    if (idx < 0 || idx >= this._liveFlags.length) {
      throw new RangeError('toggleParam: index ' + flatIndex + ' out of range [0, ' + (this._liveFlags.length - 1) + ']');
    }
    this._liveFlags[idx] = this._liveFlags[idx] ? 0 : 1;
  }

  /**
   * Explicitly set a param's live state.
   * Only valid when frozen; throws if not frozen.
   *
   * @param {number} flatIndex - index into the flat param array
   * @param {boolean} isLive - true = live (receives ML values), false = frozen
   */
  setParamLive(flatIndex, isLive) {
    if (!this._frozen) {
      throw new Error('setParamLive: cannot set when not frozen');
    }
    const idx = flatIndex | 0;
    if (idx < 0 || idx >= this._liveFlags.length) {
      throw new RangeError('setParamLive: index ' + flatIndex + ' out of range [0, ' + (this._liveFlags.length - 1) + ']');
    }
    this._liveFlags[idx] = isLive ? 1 : 0;
  }

  // ── Getters ────────────────────────────────────────────────────────

  /** @returns {boolean} */
  get isFrozen() {
    return this._frozen;
  }

  /**
   * Returns the current freeze mode, or null if not frozen.
   * @returns {'algorithm'|'pattern'|null}
   */
  get freezeMode() {
    return this._freezeMode;
  }

  /**
   * Returns the captured pattern (pattern mode only), or null.
   * @returns {Object|null}
   */
  getFrozenPattern() {
    return this._frozenPattern;
  }

  /**
   * Returns the captured param values, or null if not frozen.
   * @returns {Float32Array|null}
   */
  getFrozenParams() {
    return this._frozenParams;
  }

  /**
   * Returns the live flags array, or null if not frozen.
   * @returns {Uint8Array|null}
   */
  getLiveFlags() {
    return this._liveFlags;
  }

  /**
   * Returns the captured per-primitive PRNG seeds, or null if not frozen.
   * @returns {Array<number>|null}
   */
  getFrozenSeeds() {
    return this._frozenSeeds;
  }

  /**
   * Returns the captured per-primitive states, or null if not frozen.
   * @returns {Array<Object>|null}
   */
  getFrozenStates() {
    return this._frozenStates;
  }

  /**
   * Returns the captured master seed, or null if not frozen.
   * @returns {number|null}
   */
  getMasterSeed() {
    return this._masterSeed;
  }

  // ── Effective params ───────────────────────────────────────────────

  /**
   * Given current MLP-derived params, return the effective param array:
   * frozen params use captured values, live params use currentMLParams.
   *
   * This is the simple version. The delta controller (meml-7goy) will
   * replace this with proper delta+boundary logic later.
   *
   * Returns null if not frozen.
   *
   * @param {Float32Array|Array<number>} currentMLParams
   * @returns {Float32Array|null}
   */
  getEffectiveParams(currentMLParams) {
    if (!this._frozen) return null;
    if (this._freezeMode === 'pattern') return null;

    const result = new Float32Array(this._frozenParams.length);
    for (let i = 0; i < result.length; i++) {
      result[i] = this._liveFlags[i] ? currentMLParams[i] : this._frozenParams[i];
    }
    return result;
  }

  // ── Sequencer integration ──────────────────────────────────────────

  /**
   * Returns true when frozen — freeze-as-algorithm suppresses per-loop
   * re-evaluation. The sequencer's _handleLoopStart should check this.
   *
   * @returns {boolean}
   */
  shouldSuppressReEval() {
    return this._frozen;
  }
}
