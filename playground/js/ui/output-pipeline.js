/**
 * Output Pipeline — processes MLP outputs before they reach the synth/visualizer.
 *
 * Pipeline stages (in order):
 *   1. Global Curve — power curve applied to all outputs
 *   2. Output Smoothing — per-output EMA (frame-rate-independent)
 *   3. Slew Rate Limiting — max change per second per output
 *   4. Freeze Gate — when frozen, outputs don't update
 *
 * Pure math module — no DOM dependencies.
 *
 * @module output-pipeline
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_GLOBAL_CURVE = 1.0;
const GLOBAL_CURVE_MIN = 0.2;
const GLOBAL_CURVE_MAX = 5.0;

const DEFAULT_SMOOTHING = 0;
const SMOOTHING_MAX = 0.95;

const DEFAULT_SLEW_RATE = Infinity; // unlimited
const SLEW_RATE_MIN = 0.005;

const REFERENCE_DT = 1 / 60; // 60fps reference for frame-rate-independent EMA

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Frame-rate-independent EMA.
 * Same approach as input pipeline: converts per-frame smoothing factor into
 * a time-domain factor so perceived smoothing is consistent regardless of frame rate.
 */
function emaSmooth(prev, raw, smoothing, dt) {
  if (smoothing <= 0) return raw;
  const effectiveDt = dt > 0 ? dt : REFERENCE_DT;
  const alpha = 1 - smoothing;
  const alphaEff = 1 - Math.pow(1 - alpha, effectiveDt / REFERENCE_DT);
  return prev + alphaEff * (raw - prev);
}

// ---------------------------------------------------------------------------
// OutputPipeline
// ---------------------------------------------------------------------------

export class OutputPipeline {
  /**
   * @param {number} [numOutputs=126] — number of MLP outputs
   */
  constructor(numOutputs = 126) {
    this._numOutputs = numOutputs;

    // Configuration
    this._globalCurve = DEFAULT_GLOBAL_CURVE;
    this._smoothing = DEFAULT_SMOOTHING;
    this._slewRate = DEFAULT_SLEW_RATE;
    this._frozen = false;

    // Per-output state
    this._smoothed = new Float32Array(numOutputs);
    this._lastOutput = new Float32Array(numOutputs);
    this._initialized = false;

    // Per-output freeze mask (for parameter pinning)
    this._outputFrozen = new Uint8Array(numOutputs); // 0 = not frozen, 1 = frozen

    // Working buffer for processed output (avoid allocation per frame)
    this._processed = new Float32Array(numOutputs);

    // Store raw outputs separately (for heatmap preview while globally frozen)
    this._lastRawAfterCurve = new Float32Array(numOutputs);
  }

  // -----------------------------------------------------------------------
  // Main processing
  // -----------------------------------------------------------------------

  /**
   * Process raw MLP outputs through the pipeline.
   *
   * @param {number[]|Float32Array} rawOutputs — raw MLP output values in [0,1]
   * @param {number} deltaTime — time since last call in seconds (e.g. 0.016)
   * @returns {Float32Array} — processed outputs
   */
  process(rawOutputs, deltaTime) {
    const dt = Math.max(0, deltaTime || 0);
    const n = Math.min(rawOutputs.length, this._numOutputs);

    // On first call, initialize smoothed state to raw values
    if (!this._initialized) {
      for (let i = 0; i < n; i++) {
        this._smoothed[i] = rawOutputs[i];
        this._lastOutput[i] = rawOutputs[i];
      }
      this._initialized = true;
    }

    // Stage 1: Global Curve
    for (let i = 0; i < n; i++) {
      const raw = clamp(rawOutputs[i], 0, 1);
      this._lastRawAfterCurve[i] = this._globalCurve === 1.0
        ? raw
        : Math.pow(raw, this._globalCurve);
    }

    // If globally frozen, return the last non-frozen output
    // (raw-after-curve is still updated for preview access)
    if (this._frozen) {
      this._processed.set(this._lastOutput);
      return this._processed;
    }

    for (let i = 0; i < n; i++) {
      // Per-output freeze: skip this output if individually pinned
      if (this._outputFrozen[i]) {
        this._processed[i] = this._lastOutput[i];
        continue;
      }

      let value = this._lastRawAfterCurve[i];

      // Stage 2: Output Smoothing (EMA)
      value = emaSmooth(this._smoothed[i], value, this._smoothing, dt);
      this._smoothed[i] = value;

      // Stage 3: Slew Rate Limiting
      if (this._slewRate !== Infinity && isFinite(this._slewRate)) {
        const maxDelta = this._slewRate * dt;
        if (maxDelta > 0) {
          const delta = value - this._lastOutput[i];
          if (Math.abs(delta) > maxDelta) {
            value = this._lastOutput[i] + Math.sign(delta) * maxDelta;
          }
        }
      }

      value = clamp(value, 0, 1);
      this._processed[i] = value;
      this._lastOutput[i] = value;
    }

    return this._processed;
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /**
   * Set global curve exponent.
   * <1 pushes outputs toward extremes (0 and 1), >1 pushes toward center.
   * @param {number} exponent — 0.2 to 5.0, default 1.0 (linear)
   */
  setGlobalCurve(exponent) {
    this._globalCurve = clamp(exponent, GLOBAL_CURVE_MIN, GLOBAL_CURVE_MAX);
  }

  /** @returns {number} current global curve exponent */
  getGlobalCurve() {
    return this._globalCurve;
  }

  /**
   * Set output smoothing factor (EMA).
   * @param {number} factor — 0 (off) to 0.95
   */
  setSmoothing(factor) {
    this._smoothing = clamp(factor, 0, SMOOTHING_MAX);
  }

  /** @returns {number} current smoothing factor */
  getSmoothing() {
    return this._smoothing;
  }

  /**
   * Set slew rate limit (max change per second per output).
   * @param {number} maxChangePerSec — 0.005 to Infinity, default Infinity (unlimited)
   */
  setSlewRate(maxChangePerSec) {
    if (maxChangePerSec >= 1.0 || !isFinite(maxChangePerSec)) {
      this._slewRate = Infinity;
    } else {
      this._slewRate = Math.max(SLEW_RATE_MIN, maxChangePerSec);
    }
  }

  /** @returns {number} current slew rate */
  getSlewRate() {
    return this._slewRate;
  }

  /**
   * Set global freeze state.
   * When frozen, process() returns the last non-frozen output.
   * @param {boolean} frozen
   */
  setFrozen(frozen) {
    this._frozen = !!frozen;
  }

  // -----------------------------------------------------------------------
  // State queries
  // -----------------------------------------------------------------------

  /** @returns {boolean} whether output is globally frozen */
  isFrozen() {
    return this._frozen;
  }

  /** @returns {Float32Array} last processed (post-pipeline) output */
  getLastOutput() {
    return new Float32Array(this._lastOutput);
  }

  /**
   * Get the last raw-after-curve output (useful for heatmap preview while frozen).
   * @returns {Float32Array}
   */
  getRawPreview() {
    return new Float32Array(this._lastRawAfterCurve);
  }

  // -----------------------------------------------------------------------
  // Per-output freeze (parameter pinning)
  // -----------------------------------------------------------------------

  /**
   * Freeze a specific output index (its value will not update).
   * @param {number} index
   */
  freezeOutput(index) {
    if (index >= 0 && index < this._numOutputs) {
      this._outputFrozen[index] = 1;
    }
  }

  /**
   * Unfreeze a specific output index.
   * @param {number} index
   */
  unfreezeOutput(index) {
    if (index >= 0 && index < this._numOutputs) {
      this._outputFrozen[index] = 0;
    }
  }

  /**
   * Check if a specific output is frozen.
   * @param {number} index
   * @returns {boolean}
   */
  isOutputFrozen(index) {
    return index >= 0 && index < this._numOutputs && this._outputFrozen[index] === 1;
  }

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  /** Export configuration as a plain object (no internal state). */
  getConfig() {
    return {
      globalCurve: this._globalCurve,
      smoothing: this._smoothing,
      slewRate: this._slewRate === Infinity ? 1.0 : this._slewRate,
      frozen: this._frozen,
      frozenOutputs: Array.from(this._outputFrozen),
    };
  }

  /** Restore configuration from a plain object. */
  setConfig(config) {
    if (config.globalCurve != null) this.setGlobalCurve(config.globalCurve);
    if (config.smoothing != null) this.setSmoothing(config.smoothing);
    if (config.slewRate != null) this.setSlewRate(config.slewRate);
    if (config.frozen != null) this.setFrozen(config.frozen);
    if (Array.isArray(config.frozenOutputs)) {
      for (let i = 0; i < config.frozenOutputs.length && i < this._numOutputs; i++) {
        this._outputFrozen[i] = config.frozenOutputs[i] ? 1 : 0;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  /** Reset all settings to defaults and clear internal state. */
  reset() {
    this._globalCurve = DEFAULT_GLOBAL_CURVE;
    this._smoothing = DEFAULT_SMOOTHING;
    this._slewRate = DEFAULT_SLEW_RATE;
    this._frozen = false;
    this._smoothed.fill(0);
    this._lastOutput.fill(0);
    this._lastRawAfterCurve.fill(0);
    this._outputFrozen.fill(0);
    this._processed.fill(0);
    this._initialized = false;
  }
}
