/**
 * ShapeSeq Primitive Base Class and Param Schema System
 *
 * Base class for all sequencing primitives (generators, processors,
 * timing modifiers, converters). Defines the param schema format,
 * symbolic process() interface, and state management for freeze support.
 *
 * Port-ready: explicit state, no closures, typed arrays where possible.
 *
 * @module shapeseq/primitive
 */

// ── Valid primitive categories ──────────────────────────────────────

export const CATEGORIES = Object.freeze([
  'generator',
  'processor',
  'timing',
  'converter',
]);

// ── Param schema defaults ───────────────────────────────────────────

const DEFAULT_SCALED_RANGE = 0.3;

// ── Boundary enforcement helpers ────────────────────────────────────

/**
 * Clamp a value to [0, 1].
 * @param {number} v
 * @returns {number}
 */
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Wrap a value into [0, 1) with modular arithmetic.
 * @param {number} v
 * @returns {number}
 */
function wrap01(v) {
  const m = v % 1;
  return m < 0 ? m + 1 : m;
}

/**
 * Apply boundary enforcement to a raw param value.
 *
 * @param {number} value - raw [0,1] value (or delta-adjusted value)
 * @param {{ boundary: string, scaledRange?: number }} schema - param schema entry
 * @param {number|null} frozenValue - frozen value for 'scaled' boundary (null if not frozen)
 * @returns {number}
 */
export function applyBoundary(value, schema, frozenValue) {
  switch (schema.boundary) {
    case 'wrap':
      return wrap01(value);
    case 'scaled': {
      if (frozenValue === null || frozenValue === undefined) {
        return clamp01(value);
      }
      const range = schema.scaledRange !== undefined ? schema.scaledRange : DEFAULT_SCALED_RANGE;
      const lo = frozenValue - range;
      const hi = frozenValue + range;
      // Map [0,1] input to [lo, hi], then clamp to [0,1]
      const mapped = lo + value * (hi - lo);
      return clamp01(mapped);
    }
    case 'clamp':
    default:
      return clamp01(value);
  }
}

// ── Param schema validation ─────────────────────────────────────────

/**
 * Validate a single param schema entry.
 * Throws on invalid entries for fast fail during development.
 *
 * @param {{ name: string, default: number, boundary: string, scaledRange?: number }} entry
 * @param {number} index - position in schema array (for error messages)
 */
function validateSchemaEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('paramSchema[' + index + '] must be an object');
  }
  if (typeof entry.name !== 'string' || entry.name.length === 0) {
    throw new TypeError('paramSchema[' + index + '].name must be a non-empty string');
  }
  if (typeof entry.default !== 'number' || entry.default < 0 || entry.default > 1) {
    throw new RangeError('paramSchema[' + index + '].default must be in [0,1], got ' + entry.default);
  }
  if (entry.boundary !== 'clamp' && entry.boundary !== 'wrap' && entry.boundary !== 'scaled') {
    throw new TypeError(
      "paramSchema[" + index + "].boundary must be 'clamp', 'wrap', or 'scaled', got '" + entry.boundary + "'"
    );
  }
  if (entry.boundary === 'scaled') {
    const sr = entry.scaledRange;
    if (sr !== undefined && (typeof sr !== 'number' || sr <= 0 || sr > 1)) {
      throw new RangeError('paramSchema[' + index + '].scaledRange must be in (0,1], got ' + sr);
    }
  }
}

// ── Primitive base class ────────────────────────────────────────────

export class Primitive {
  /**
   * @param {string} name - unique identifier for this primitive type
   * @param {string} category - one of CATEGORIES
   * @param {Array<{ name: string, default: number, boundary: string, scaledRange?: number }>} paramSchema
   */
  constructor(name, category, paramSchema) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError('Primitive name must be a non-empty string');
    }
    if (CATEGORIES.indexOf(category) === -1) {
      throw new TypeError(
        "Primitive category must be one of [" + CATEGORIES.join(', ') + "], got '" + category + "'"
      );
    }
    if (!Array.isArray(paramSchema)) {
      throw new TypeError('paramSchema must be an array');
    }

    // Validate each entry
    for (let i = 0; i < paramSchema.length; i++) {
      validateSchemaEntry(paramSchema[i], i);
    }

    /** @type {string} */
    this.name = name;

    /** @type {string} */
    this.category = category;

    /**
     * Frozen copy of the param schema. Each entry:
     *   { name: string, default: number, boundary: 'clamp'|'wrap'|'scaled', scaledRange?: number }
     * @type {Array<Object>}
     */
    this.paramSchema = Object.freeze(paramSchema.map(function (entry) {
      const frozen = {
        name: entry.name,
        default: entry.default,
        boundary: entry.boundary,
      };
      if (entry.boundary === 'scaled') {
        frozen.scaledRange = entry.scaledRange !== undefined ? entry.scaledRange : DEFAULT_SCALED_RANGE;
      }
      return Object.freeze(frozen);
    }));

    /** @private */
    this._seed = 0;
  }

  // ── Param utilities ─────────────────────────────────────────────

  /**
   * Total number of parameters this primitive exposes.
   * @returns {number}
   */
  get paramCount() {
    return this.paramSchema.length;
  }

  /**
   * Get default param values as a Float32Array, one per schema entry.
   * @returns {Float32Array}
   */
  getDefaults() {
    const count = this.paramSchema.length;
    const defaults = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      defaults[i] = this.paramSchema[i].default;
    }
    return defaults;
  }

  // ── Symbolic processing ─────────────────────────────────────────

  /**
   * Transform a pattern description. Subclasses MUST override this.
   *
   * - Generators ignore patternDesc and create a new one (using createPattern())
   * - Processors/timing modifiers clone and transform patternDesc
   * - The rng param is a PRNG state from prng.js; consume via next(rng)
   *   and return the consumed state in the result
   *
   * @param {Float32Array|Array<number>} params - param values, one per schema entry, each [0,1]
   * @param {{ steps: Array, stepCount: number, metadata: Object }} patternDesc - input pattern
   * @param {Object} state - primitive-specific state (from previous process() call or getState())
   * @param {{ state: number }} rng - PRNG state object from prng.js
   * @returns {{ patternDesc: { steps: Array, stepCount: number, metadata: Object }, nextState: Object }}
   */
  process(params, patternDesc, state, rng) {
    void params; void patternDesc; void state; void rng;
    throw new Error(this.name + '.process() must be overridden by subclass');
  }

  // ── State management (for freeze) ──────────────────────────────

  /**
   * Get serializable state for this primitive.
   * Stateless primitives return {}. Stateful primitives (e.g. Pitch Walker)
   * override to include their internal state.
   *
   * @returns {Object}
   */
  getState() {
    return {};
  }

  /**
   * Restore primitive state from a previously serialized state object.
   * Stateless primitives are a no-op. Stateful primitives override.
   *
   * @param {Object} _state
   */
  setState(_state) {
    // no-op for stateless primitives
  }

  /**
   * Get the PRNG seed associated with this primitive.
   * Used by freeze-as-algorithm to replay identical sequences.
   *
   * @returns {number}
   */
  getSeed() {
    return this._seed;
  }

  /**
   * Set the PRNG seed for this primitive.
   *
   * @param {number} seed - 32-bit integer seed
   */
  setSeed(seed) {
    this._seed = seed >>> 0;
  }
}
