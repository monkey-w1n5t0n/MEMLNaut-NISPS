// SynthEngine — base interface that all synth engines implement.
//
// Engines are duck-typed in JavaScript, but this base class documents the
// contract and provides default no-op stubs so subclasses only override what
// they need. All engines must satisfy this interface for hot-swapping to work.
//
// Usage:
//   import { SynthEngine } from './engine-interface.js';
//   class MyEngine extends SynthEngine { ... }

export class SynthEngine {
  // ---------------------------------------------------------------------------
  // Identity (override in subclass)
  // ---------------------------------------------------------------------------

  /**
   * Stable machine ID, e.g. 'shaper-feedback' | 'additive' | 'fm'.
   * Used for persistence keys and engine-switcher logic.
   * @returns {string}
   */
  get id() {
    throw new Error(`${this.constructor.name}: id not implemented`);
  }

  /**
   * Human-readable label shown in the engine-switcher UI.
   * @returns {string}
   */
  get displayName() {
    throw new Error(`${this.constructor.name}: displayName not implemented`);
  }

  // ---------------------------------------------------------------------------
  // Parameter schema
  // ---------------------------------------------------------------------------

  /**
   * Number of continuous parameters this engine exposes (= MLP output count).
   * @returns {number}
   */
  get paramCount() {
    return this.paramMeta.length;
  }

  /**
   * Array of parameter descriptors, one per MLP output index.
   *
   * Each entry must have:
   *   id        {string}  — stable machine ID (used for presets)
   *   name      {string}  — short display name
   *   min       {number}  — normalised lower bound [0,1]
   *   max       {number}  — normalised upper bound [0,1]
   *   init      {number}  — default normalised value [0,1]
   *   curve     {number}  — power-curve bias: 0.5 = linear, <0.5 = log, >0.5 = exp
   *   group     {string}  — section label (for group drawer / colour coding)
   *
   * @returns {Array<{id:string, name:string, min:number, max:number, init:number, curve:number, group:string}>}
   */
  get paramMeta() {
    throw new Error(`${this.constructor.name}: paramMeta not implemented`);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Load WASM / worklet, connect the output node to audioCtx.destination.
   * Must be idempotent — calling init() twice should be safe.
   *
   * @param {AudioContext} audioCtx
   * @returns {Promise<void>}
   */
  async init(audioCtx) {        // eslint-disable-line no-unused-vars
    throw new Error(`${this.constructor.name}: init() not implemented`);
  }

  /**
   * Release all AudioNodes, Workers, and WASM memory.
   * The engine should be unusable after dispose().
   */
  dispose() {
    // default no-op — override when cleanup is needed
  }

  // ---------------------------------------------------------------------------
  // Real-time control
  // ---------------------------------------------------------------------------

  /**
   * Set a single parameter by MLP output index.
   *
   * @param {number} index          — 0-based index into paramMeta
   * @param {number} normalizedValue — [0, 1]
   */
  setParam(index, normalizedValue) { // eslint-disable-line no-unused-vars
    // default no-op
  }

  /**
   * Trigger a note.
   *
   * @param {number} note     — MIDI note number 0–127
   * @param {number} velocity — [0, 1]
   */
  noteOn(note, velocity = 0.7) { // eslint-disable-line no-unused-vars
    // default no-op
  }

  /**
   * Release a note.
   *
   * @param {number} note — MIDI note number 0–127
   */
  noteOff(note) { // eslint-disable-line no-unused-vars
    // default no-op
  }

  // ---------------------------------------------------------------------------
  // Audio graph
  // ---------------------------------------------------------------------------

  /**
   * Return the AudioNode that should be connected downstream (e.g. to a
   * compressor or the AudioContext destination).
   *
   * @returns {AudioNode}
   */
  getOutputNode() {
    throw new Error(`${this.constructor.name}: getOutputNode() not implemented`);
  }

  // ---------------------------------------------------------------------------
  // Status (mirrors C15Bridge.running for backward compat)
  // ---------------------------------------------------------------------------

  /**
   * True once init() has completed successfully and the engine is producing
   * audio. Engines should set this themselves after init().
   * @type {boolean}
   */
  get running() {
    return this._running ?? false;
  }
}
