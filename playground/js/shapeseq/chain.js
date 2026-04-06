/**
 * ShapeSeq Chain — sequential pipeline runner with generator combination modes
 *
 * Evaluates an ordered list of primitives as a sequential pipeline:
 *   1. Generators run first, combined via additive or multiplicative merge
 *   2. Processors transform the pattern in chain order
 *   3. Converters run in chain order
 *   4. Timing modifiers annotate last
 *
 * Params are distributed flat across primitives in chain order.
 * Each primitive gets a deterministic PRNG stream via fork(masterPRNG, index).
 *
 * Port-ready: explicit state, typed arrays, no closures in hot path.
 *
 * @module shapeseq/chain
 */

import { createPattern, mergePatterns } from './pattern.js';
import { createPRNG, fork } from './prng.js';

// ── Category execution order ────────────────────────────────────────

const PHASE_ORDER = ['generator', 'processor', 'converter', 'timing'];

// ── Chain class ─────────────────────────────────────────────────────

export class Chain {
  constructor() {
    /** @private @type {Array<import('./primitive.js').Primitive>} */
    this._primitives = [];

    /** @type {'additive'|'multiplicative'} */
    this.generatorCombineMode = 'additive';

    /**
     * Per-generator step counts for polyrhythm support.
     * Maps chain index → step count. Generators not in this map
     * use the global stepCount passed to evaluate().
     * @private @type {Map<number, number>}
     */
    this._generatorStepCounts = new Map();

    /** @private @type {number} */
    this._masterSeed = 0;

    /**
     * Per-primitive state objects, indexed by position in chain.
     * Populated after evaluate() calls; used for freeze support.
     * @private @type {Array<Object>}
     */
    this._primitiveStates = [];
  }

  // ── Primitive management ────────────────────────────────────────

  /**
   * Append a primitive to the end of the chain.
   * @param {import('./primitive.js').Primitive} primitive
   */
  addPrimitive(primitive) {
    this._primitives.push(primitive);
    this._primitiveStates.push(primitive.getState());
  }

  /**
   * Remove the primitive at the given index.
   * @param {number} index
   */
  removePrimitive(index) {
    const idx = index | 0;
    if (idx < 0 || idx >= this._primitives.length) {
      throw new RangeError('removePrimitive: index ' + index + ' out of range [0, ' + (this._primitives.length - 1) + ']');
    }
    this._primitives.splice(idx, 1);
    this._primitiveStates.splice(idx, 1);
  }

  /**
   * Insert a primitive at the given index, shifting others right.
   * @param {number} index
   * @param {import('./primitive.js').Primitive} primitive
   */
  insertPrimitive(index, primitive) {
    const idx = index | 0;
    if (idx < 0 || idx > this._primitives.length) {
      throw new RangeError('insertPrimitive: index ' + index + ' out of range [0, ' + this._primitives.length + ']');
    }
    this._primitives.splice(idx, 0, primitive);
    this._primitiveStates.splice(idx, 0, primitive.getState());
  }

  /**
   * Move a primitive from one position to another.
   * @param {number} fromIndex
   * @param {number} toIndex
   */
  movePrimitive(fromIndex, toIndex) {
    const from = fromIndex | 0;
    const to = toIndex | 0;
    const len = this._primitives.length;
    if (from < 0 || from >= len) {
      throw new RangeError('movePrimitive: fromIndex ' + fromIndex + ' out of range [0, ' + (len - 1) + ']');
    }
    if (to < 0 || to >= len) {
      throw new RangeError('movePrimitive: toIndex ' + toIndex + ' out of range [0, ' + (len - 1) + ']');
    }

    const [prim] = this._primitives.splice(from, 1);
    const [state] = this._primitiveStates.splice(from, 1);
    this._primitives.splice(to, 0, prim);
    this._primitiveStates.splice(to, 0, state);
  }

  /**
   * Get the current list of primitives (shallow copy).
   * @returns {Array<import('./primitive.js').Primitive>}
   */
  getPrimitives() {
    return this._primitives.slice();
  }

  // ── Per-generator step counts (polyrhythm) ─────────────────────

  /**
   * Set a per-generator step count for polyrhythm.
   * The chain index must refer to a primitive in the chain.
   *
   * @param {number} chainIndex - Index in the chain's primitive list
   * @param {number} stepCount - Step count for this generator (positive integer)
   */
  setGeneratorStepCount(chainIndex, stepCount) {
    const idx = chainIndex | 0;
    const sc = stepCount | 0;
    if (idx < 0 || idx >= this._primitives.length) {
      throw new RangeError('setGeneratorStepCount: chainIndex ' + chainIndex + ' out of range [0, ' + (this._primitives.length - 1) + ']');
    }
    if (sc < 1) {
      throw new RangeError('setGeneratorStepCount: stepCount must be >= 1, got ' + stepCount);
    }
    this._generatorStepCounts.set(idx, sc);
  }

  /**
   * Get the per-generator step count, or null if using global.
   *
   * @param {number} chainIndex
   * @returns {number|null}
   */
  getGeneratorStepCount(chainIndex) {
    const idx = chainIndex | 0;
    return this._generatorStepCounts.has(idx) ? this._generatorStepCounts.get(idx) : null;
  }

  /**
   * Clear all per-generator step counts, reverting to global stepCount.
   */
  clearGeneratorStepCounts() {
    this._generatorStepCounts.clear();
  }

  // ── Configuration ───────────────────────────────────────────────

  /**
   * Total parameter count across all primitives in the chain.
   * @returns {number}
   */
  get totalParamCount() {
    let total = 0;
    for (let i = 0; i < this._primitives.length; i++) {
      total += this._primitives[i].paramCount;
    }
    return total;
  }

  /**
   * Get a flat list of all param schemas across all primitives,
   * annotated with their primitive and param indices.
   *
   * @returns {Array<{ primitiveIndex: number, paramIndex: number, schema: Object }>}
   */
  getParamSchemas() {
    const result = [];
    for (let pi = 0; pi < this._primitives.length; pi++) {
      const prim = this._primitives[pi];
      const schema = prim.paramSchema;
      for (let si = 0; si < schema.length; si++) {
        result.push({
          primitiveIndex: pi,
          paramIndex: si,
          schema: schema[si],
        });
      }
    }
    return result;
  }

  // ── Evaluation ──────────────────────────────────────────────────

  /**
   * Evaluate the chain, producing a pattern description.
   *
   * Pipeline order:
   *   1. Generators — combined via generatorCombineMode
   *   2. Processors — sequential transform
   *   3. Converters — sequential transform
   *   4. Timing modifiers — annotate last
   *
   * @param {Float32Array|Array<number>} params - flat param array distributed across primitives
   * @param {number} stepCount - number of steps in the output pattern
   * @param {number} masterSeed - seed for the master PRNG
   * @param {Map<number,number>|null} [generatorStepCounts=null] - optional per-generator step counts (chain index → step count). If null, uses this._generatorStepCounts.
   * @returns {{ steps: Array, stepCount: number, metadata: Object }}
   */
  evaluate(params, stepCount, masterSeed, generatorStepCounts = null) {
    const primitives = this._primitives;
    const primCount = primitives.length;

    // Create master PRNG from seed
    const masterPRNG = createPRNG(masterSeed >>> 0);

    // ── Bucket primitives by category, preserving chain order ──

    /** @type {Array<{ index: number, prim: Object }>} */
    const generators = [];
    const processors = [];
    const converters = [];
    const timingMods = [];

    for (let i = 0; i < primCount; i++) {
      const entry = { index: i, prim: primitives[i] };
      switch (primitives[i].category) {
        case 'generator':  generators.push(entry); break;
        case 'processor':  processors.push(entry); break;
        case 'converter':  converters.push(entry); break;
        case 'timing':     timingMods.push(entry); break;
      }
    }

    // ── Compute param offsets per primitive ──

    const paramOffsets = new Array(primCount);
    let offset = 0;
    for (let i = 0; i < primCount; i++) {
      paramOffsets[i] = offset;
      offset += primitives[i].paramCount;
    }

    // ── Helper: run a single primitive ──

    const self = this;

    function runPrimitive(entry, inputPattern) {
      const idx = entry.index;
      const prim = entry.prim;
      const pOffset = paramOffsets[idx];
      const pCount = prim.paramCount;

      // Slice params for this primitive
      const primParams = new Float32Array(pCount);
      for (let p = 0; p < pCount; p++) {
        primParams[p] = pOffset + p < params.length ? +params[pOffset + p] : prim.paramSchema[p].default;
      }

      // Fork a deterministic PRNG for this primitive
      const primRNG = fork(masterPRNG, idx);

      // Get current state
      const state = self._primitiveStates[idx] || prim.getState();

      // Process
      const result = prim.process(primParams, inputPattern, state, primRNG);

      // Store updated state
      self._primitiveStates[idx] = result.nextState;

      return result.patternDesc;
    }

    // ── Phase 1: Generators ──

    // Resolve per-generator step counts: explicit arg > instance map > global
    const genStepMap = generatorStepCounts || this._generatorStepCounts;

    /** Look up the step count for a generator by its chain index. */
    function genStepsFor(chainIndex) {
      if (genStepMap && genStepMap.size > 0) {
        const override = genStepMap.get(chainIndex);
        if (override != null) return override;
      }
      return stepCount;
    }

    let pattern;

    if (generators.length === 0) {
      // Default pattern: all steps triggered
      pattern = createPattern(stepCount);
      for (let i = 0; i < stepCount; i++) {
        pattern.steps[i].trigger = true;
      }
    } else if (generators.length === 1) {
      // Single generator — no merge needed
      const gs = genStepsFor(generators[0].index);
      pattern = runPrimitive(generators[0], createPattern(gs));
    } else {
      // Multiple generators — run each with its own step count, then merge
      let merged = runPrimitive(generators[0], createPattern(genStepsFor(generators[0].index)));
      for (let g = 1; g < generators.length; g++) {
        const gs = genStepsFor(generators[g].index);
        const next = runPrimitive(generators[g], createPattern(gs));
        merged = mergePatterns(merged, next, this.generatorCombineMode);
      }
      pattern = merged;
    }

    // ── Phase 2: Processors ──

    for (let i = 0; i < processors.length; i++) {
      pattern = runPrimitive(processors[i], pattern);
    }

    // ── Phase 3: Converters ──

    for (let i = 0; i < converters.length; i++) {
      pattern = runPrimitive(converters[i], pattern);
    }

    // ── Phase 4: Timing modifiers ──

    for (let i = 0; i < timingMods.length; i++) {
      pattern = runPrimitive(timingMods[i], pattern);
    }

    return pattern;
  }

  // ── State management (for freeze) ──────────────────────────────

  /**
   * Get serializable state for all primitives in the chain.
   * @returns {Array<Object>}
   */
  getState() {
    const states = new Array(this._primitives.length);
    for (let i = 0; i < this._primitives.length; i++) {
      states[i] = this._primitiveStates[i] || this._primitives[i].getState();
    }
    return states;
  }

  /**
   * Restore all primitive states from a previously serialized state array.
   * @param {Array<Object>} states
   */
  setState(states) {
    if (!Array.isArray(states)) {
      throw new TypeError('setState expects an array of state objects');
    }
    const len = Math.min(states.length, this._primitives.length);
    for (let i = 0; i < len; i++) {
      this._primitives[i].setState(states[i]);
      this._primitiveStates[i] = states[i];
    }
  }

  /**
   * Get the master PRNG seed.
   * @returns {number}
   */
  getMasterSeed() {
    return this._masterSeed;
  }

  /**
   * Set the master PRNG seed.
   * @param {number} seed - 32-bit integer seed
   */
  setMasterSeed(seed) {
    this._masterSeed = seed >>> 0;
  }
}
