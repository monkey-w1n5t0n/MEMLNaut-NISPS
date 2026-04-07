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
// Types
// ---------------------------------------------------------------------------

export interface OutputPipelineConfig {
  /** Power curve exponent applied to all outputs. Range: [0.2, 5.0]. Default: 1.0 (linear). */
  globalCurve: number;
  /** Per-output EMA smoothing factor. Range: [0, 0.95]. Default: 0 (off). */
  smoothing: number;
  /**
   * Max change per second per output (slew rate limit).
   * Use Infinity for unlimited. Values >= 1.0 are treated as Infinity.
   * Minimum enforced value: 0.005.
   */
  slewRate: number;
  /** When true, process() returns the last non-frozen output. */
  frozen: boolean;
  /**
   * Per-output freeze mask. 1 = frozen (pinned), 0 = live.
   * Length must equal numOutputs.
   */
  frozenMask: Uint8Array;
}

/** Serializable form of config — frozenOutputs is a plain number array. */
export interface OutputPipelineConfigSerial {
  globalCurve?: number;
  smoothing?: number;
  slewRate?: number;
  frozen?: boolean;
  frozenOutputs?: number[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Frame-rate-independent EMA.
 * Same approach as input pipeline: converts per-frame smoothing factor into
 * a time-domain factor so perceived smoothing is consistent regardless of frame rate.
 */
function emaSmooth(
  prev: number,
  raw: number,
  smoothing: number,
  dt: number,
): number {
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
  private readonly _numOutputs: number;

  // Configuration
  private _globalCurve: number;
  private _smoothing: number;
  private _slewRate: number;
  private _frozen: boolean;

  // Per-output state
  private _smoothed: Float32Array;
  private _lastOutput: Float32Array;
  private _initialized: boolean;

  // Per-output freeze mask (parameter pinning): 0 = live, 1 = frozen
  private _outputFrozen: Uint8Array;

  // Working buffer — avoids allocation per frame
  private _processed: Float32Array;

  // Stores raw-after-curve values for heatmap preview while globally frozen
  private _lastRawAfterCurve: Float32Array;

  /**
   * @param numOutputs — number of MLP outputs (default: 126)
   */
  constructor(numOutputs = 126) {
    this._numOutputs = numOutputs;

    this._globalCurve = DEFAULT_GLOBAL_CURVE;
    this._smoothing = DEFAULT_SMOOTHING;
    this._slewRate = DEFAULT_SLEW_RATE;
    this._frozen = false;

    this._smoothed = new Float32Array(numOutputs);
    this._lastOutput = new Float32Array(numOutputs);
    this._initialized = false;

    this._outputFrozen = new Uint8Array(numOutputs);

    this._processed = new Float32Array(numOutputs);
    this._lastRawAfterCurve = new Float32Array(numOutputs);
  }

  // -----------------------------------------------------------------------
  // Main processing
  // -----------------------------------------------------------------------

  /**
   * Process raw MLP outputs through the pipeline.
   *
   * @param rawOutputs — raw MLP output values in [0, 1]
   * @param dt — time since last call in seconds (e.g. 0.016)
   * @returns processed outputs (shared internal buffer — copy if you need to store it)
   */
  process(rawOutputs: Float32Array | number[], dt: number): Float32Array {
    const safeDt = Math.max(0, dt || 0);
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
      this._lastRawAfterCurve[i] =
        this._globalCurve === 1.0 ? raw : Math.pow(raw, this._globalCurve);
    }

    // If globally frozen, return the last non-frozen output.
    // raw-after-curve is still updated for preview access via getRawPreview().
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
      value = emaSmooth(this._smoothed[i], value, this._smoothing, safeDt);
      this._smoothed[i] = value;

      // Stage 3: Slew Rate Limiting
      if (this._slewRate !== Infinity && isFinite(this._slewRate)) {
        const maxDelta = this._slewRate * safeDt;
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
  // Configuration setters / getters
  // -----------------------------------------------------------------------

  /**
   * Set global curve exponent.
   * <1 pushes outputs toward extremes (0 and 1), >1 pushes toward center.
   * @param exponent — [0.2, 5.0], default 1.0 (linear)
   */
  setGlobalCurve(exponent: number): void {
    this._globalCurve = clamp(exponent, GLOBAL_CURVE_MIN, GLOBAL_CURVE_MAX);
  }

  /** Returns the current global curve exponent. */
  getGlobalCurve(): number {
    return this._globalCurve;
  }

  /**
   * Set output smoothing factor (EMA).
   * @param factor — [0, 0.95]; 0 = off
   */
  setSmoothing(factor: number): void {
    this._smoothing = clamp(factor, 0, SMOOTHING_MAX);
  }

  /** Returns the current smoothing factor. */
  getSmoothing(): number {
    return this._smoothing;
  }

  /**
   * Set slew rate limit (max change per second per output).
   * Values >= 1.0 or non-finite are treated as Infinity (unlimited).
   * @param maxChangePerSec — [0.005, Infinity], default Infinity
   */
  setSlewRate(maxChangePerSec: number): void {
    if (maxChangePerSec >= 1.0 || !isFinite(maxChangePerSec)) {
      this._slewRate = Infinity;
    } else {
      this._slewRate = Math.max(SLEW_RATE_MIN, maxChangePerSec);
    }
  }

  /** Returns the current slew rate (Infinity = unlimited). */
  getSlewRate(): number {
    return this._slewRate;
  }

  /**
   * Set global freeze state.
   * When frozen, process() returns the last non-frozen output unchanged.
   */
  setFrozen(frozen: boolean): void {
    this._frozen = !!frozen;
  }

  // -----------------------------------------------------------------------
  // State queries
  // -----------------------------------------------------------------------

  /** Returns whether output is globally frozen. */
  isFrozen(): boolean {
    return this._frozen;
  }

  /** Returns a copy of the last processed (post-pipeline) output array. */
  getLastOutput(): Float32Array {
    return new Float32Array(this._lastOutput);
  }

  /**
   * Returns a copy of the last raw-after-curve output.
   * Useful for heatmap preview while globally frozen.
   */
  getRawPreview(): Float32Array {
    return new Float32Array(this._lastRawAfterCurve);
  }

  // -----------------------------------------------------------------------
  // Per-output freeze (parameter pinning)
  // -----------------------------------------------------------------------

  /**
   * Freeze a specific output index so its value will not update.
   * @param index — output index [0, numOutputs)
   */
  freezeOutput(index: number): void {
    if (index >= 0 && index < this._numOutputs) {
      this._outputFrozen[index] = 1;
    }
  }

  /**
   * Unfreeze a specific output index so it resumes updating.
   * @param index — output index [0, numOutputs)
   */
  unfreezeOutput(index: number): void {
    if (index >= 0 && index < this._numOutputs) {
      this._outputFrozen[index] = 0;
    }
  }

  /**
   * Returns true if a specific output is individually frozen.
   * @param index — output index [0, numOutputs)
   */
  isOutputFrozen(index: number): boolean {
    return (
      index >= 0 && index < this._numOutputs && this._outputFrozen[index] === 1
    );
  }

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  /** Export configuration as a plain serializable object (no internal state). */
  getConfig(): OutputPipelineConfigSerial {
    return {
      globalCurve: this._globalCurve,
      smoothing: this._smoothing,
      // Infinity is not JSON-serializable; represent as 1.0 (treated as unlimited on restore)
      slewRate: this._slewRate === Infinity ? 1.0 : this._slewRate,
      frozen: this._frozen,
      frozenOutputs: Array.from(this._outputFrozen),
    };
  }

  /** Restore configuration from a plain object (as produced by getConfig). */
  setConfig(config: OutputPipelineConfigSerial): void {
    if (config.globalCurve != null) this.setGlobalCurve(config.globalCurve);
    if (config.smoothing != null) this.setSmoothing(config.smoothing);
    if (config.slewRate != null) this.setSlewRate(config.slewRate);
    if (config.frozen != null) this.setFrozen(config.frozen);
    if (Array.isArray(config.frozenOutputs)) {
      for (
        let i = 0;
        i < config.frozenOutputs.length && i < this._numOutputs;
        i++
      ) {
        this._outputFrozen[i] = config.frozenOutputs[i] ? 1 : 0;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  /** Reset all settings to defaults and clear all internal state. */
  reset(): void {
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
