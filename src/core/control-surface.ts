/**
 * Control Surface — Compound Axes + Parameter Override System
 *
 * Ported from playground/js/ui/control-surface.js
 *
 * Pure logic module — NO DOM, NO UI.
 *
 * Three compound axes map a single 0-1 slider value to multiple underlying
 * parameters via lookup tables with linear interpolation:
 *   - Boldness  (Caution ↔ Bold):     zoom, noiseCap, noiseGrowth, learningRate, weightDecay, noiseDistribution
 *   - Memory    (Amnesia ↔ Elephant): maxExamples, exampleDecay, weightDecay, noiseDecay, convergenceThreshold
 *   - Precision (Raw ↔ Precise):      inputCurve, deadzone, smoothing, slewRate, momentumZoom
 *
 * Offset-based override system (trim-pot model): when a user manually sets an
 * individual param, the delta from the axis-derived value is stored and persists
 * as the axis moves. Call clearAllOverrides() (double-tap an axis) to re-link.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type MomentumZoomMode = 'off' | 'gentle' | 'strong';
export type NoiseDistribution = 'gaussian' | 'cauchy';

/** All parameters managed by the control surface. */
export interface ControlSurfaceParams {
  // Input pipeline
  zoom: number;
  deadzone: number;
  inputCurve: number;
  smoothing: number;
  momentumZoom: MomentumZoomMode;
  invertX: boolean;
  invertY: boolean;

  // Training
  learningRate: number;
  maxIterations: number;
  convergenceThreshold: number;
  rlTrainIntensity: number;
  maxExamples: number;
  exampleDecay: number;

  // Noise / exploration
  spread: number;
  noiseFloor: number;
  noiseCap: number;
  noiseGrowth: number;
  noiseDecay: number;
  weightDecay: number;
  noiseDistribution: NoiseDistribution;
  layerAwareNoise: boolean;
  zoomAwareFeedback: boolean;

  // Output pipeline
  outputSmoothing: number;
  outputSlewRate: number;
  tame: number;
  globalCurve: number;
}

/** A single preset that sets all three compound axis positions. */
export interface ControlPreset {
  id: string;
  boldness: number;
  memory: number;
  precision: number;
}

/** Axis positions snapshot (used for serialization). */
export interface AxisState {
  boldness: number;
  memory: number;
  precision: number;
}

/** Serializable state for persistence / hydration. */
export interface ControlSurfaceState {
  axes: AxisState;
  /** Offset map: paramName → numeric offset (or literal for discrete params). */
  offsets: Record<string, number | string | boolean>;
}

/** Numeric range descriptor [min, max, step]. */
type NumericRange = [number, number, number | null];

// ─── Interpolation Tables ────────────────────────────────────────────────────
// Each row: [axisValue, { paramName: value, … }]
// Linear interpolation between adjacent rows.
// For discrete string/boolean params, snaps at t ≥ 0.75 toward the higher row.

type BoldnessRow = {
  zoom: number;
  noiseCap: number;
  noiseGrowth: number;
  learningRate: number;
  weightDecay: number;
  noiseDistribution: NoiseDistribution;
};

type MemoryRow = {
  maxExamples: number;
  exampleDecay: number;
  memoryWeightDecay: number;
  noiseDecay: number;
  convergenceThreshold: number;
};

type PrecisionRow = {
  inputCurve: number;
  deadzone: number;
  smoothing: number;
  slewRate: number;
  momentumZoom: MomentumZoomMode;
};

const BOLDNESS_TABLE: Array<[number, BoldnessRow]> = [
  [0.0, { zoom: 0.1,  noiseCap: 0.02, noiseGrowth: 1.1, learningRate: 0.1, weightDecay: 0.15, noiseDistribution: 'gaussian' }],
  [0.5, { zoom: 0.5,  noiseCap: 0.12, noiseGrowth: 1.5, learningRate: 1.0, weightDecay: 0.06, noiseDistribution: 'gaussian' }],
  [1.0, { zoom: 1.0,  noiseCap: 0.30, noiseGrowth: 2.5, learningRate: 3.0, weightDecay: 0.00, noiseDistribution: 'cauchy'   }],
];

const MEMORY_TABLE: Array<[number, MemoryRow]> = [
  [0.0, { maxExamples: 5,   exampleDecay: 0.3, memoryWeightDecay: 0.20, noiseDecay: 0.85,  convergenceThreshold: 1e-3 }],
  [0.5, { maxExamples: 50,  exampleDecay: 0.7, memoryWeightDecay: 0.06, noiseDecay: 0.97,  convergenceThreshold: 1e-5 }],
  [1.0, { maxExamples: 500, exampleDecay: 1.0, memoryWeightDecay: 0.00, noiseDecay: 0.995, convergenceThreshold: 1e-8 }],
];

const PRECISION_TABLE: Array<[number, PrecisionRow]> = [
  [0.0, { inputCurve: 1.0, deadzone: 0.0,  smoothing: 0.0,  slewRate: 1.0, momentumZoom: 'off' }],
  [0.5, { inputCurve: 1.5, deadzone: 0.05, smoothing: 0.15, slewRate: 0.3, momentumZoom: 'off' }],
  [1.0, { inputCurve: 3.0, deadzone: 0.15, smoothing: 0.40, slewRate: 0.1, momentumZoom: 'off' }],
];

// ─── Control Presets ─────────────────────────────────────────────────────────

export const CONTROL_PRESETS: Record<string, Omit<ControlPreset, 'id'>> = {
  'default':     { boldness: 0.5, memory: 0.5, precision: 0.3 },
  'first-touch': { boldness: 0.2, memory: 0.7, precision: 0.6 },
  'jazz-hands':  { boldness: 0.8, memory: 0.2, precision: 0.0 },
  'sculptor':    { boldness: 0.3, memory: 0.9, precision: 0.8 },
  'improviser':  { boldness: 0.6, memory: 0.3, precision: 0.2 },
  'microscope':  { boldness: 0.1, memory: 1.0, precision: 1.0 },
};

// ─── Parameter Defaults ───────────────────────────────────────────────────────

export const PARAM_DEFAULTS: ControlSurfaceParams = {
  // Input pipeline
  zoom:               1.0,
  deadzone:           0.0,
  inputCurve:         1.0,
  smoothing:          0.0,
  momentumZoom:       'off',
  invertX:            false,
  invertY:            false,

  // Training
  learningRate:       1.0,
  maxIterations:      1000,
  convergenceThreshold: 1e-5,
  rlTrainIntensity:   1.0,
  maxExamples:        50,
  exampleDecay:       0.7,

  // Noise / exploration
  spread:             0.6,
  noiseFloor:         0.005,
  noiseCap:           0.12,
  noiseGrowth:        1.5,
  noiseDecay:         0.97,
  weightDecay:        0.06,
  noiseDistribution:  'gaussian',
  layerAwareNoise:    true,
  zoomAwareFeedback:  true,

  // Output pipeline
  outputSmoothing:    0.0,
  outputSlewRate:     1.0,
  tame:               1.0,
  globalCurve:        1.0,
};

/**
 * Valid ranges for clamping numeric parameters [min, max, step].
 * null = discrete param (string or boolean) — no clamping applied.
 */
export const PARAM_RANGES: Record<keyof ControlSurfaceParams, NumericRange | null> = {
  zoom:                 [0.01, 1.0,   0.01],
  deadzone:             [0,    0.4,   0.01],
  inputCurve:           [0.2,  5.0,   0.1 ],
  smoothing:            [0,    1.0,   0.01],
  momentumZoom:         null,
  invertX:              null,
  invertY:              null,
  learningRate:         [0.01, 10.0,  0.01],
  maxIterations:        [10,   10000, 10  ],
  convergenceThreshold: [1e-8, 1e-2,  null],
  rlTrainIntensity:     [0.1,  5.0,   0.1 ],
  maxExamples:          [1,    500,   1   ],
  exampleDecay:         [0,    1.0,   0.01],
  spread:               [0,    1.0,   0.01],
  noiseFloor:           [0,    0.1,   0.001],
  noiseCap:             [0.01, 0.5,   0.01],
  noiseGrowth:          [1.0,  5.0,   0.1 ],
  noiseDecay:           [0.5,  1.0,   0.001],
  weightDecay:          [0,    0.5,   0.01],
  noiseDistribution:    null,
  layerAwareNoise:      null,
  zoomAwareFeedback:    null,
  outputSmoothing:      [0,    1.0,   0.01],
  outputSlewRate:       [0.01, 1.0,   0.01],
  tame:                 [0,    1.0,   0.01],
  globalCurve:          [0.2,  5.0,   0.1 ],
};

/** Parameters displayed on a log scale in UI. */
export const LOG_SCALE_PARAMS = new Set<keyof ControlSurfaceParams>([
  'zoom',
  'learningRate',
  'convergenceThreshold',
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Linearly interpolate a value from a typed lookup table.
 * For numeric params, interpolates between adjacent rows.
 * For discrete params (string/boolean), snaps at t ≥ 0.75 toward the higher row.
 */
function interpolateTable<T extends Record<string, number | string | boolean>>(
  table: Array<[number, T]>,
  axisValue: number,
): T {
  const v = Math.max(0, Math.min(1, axisValue));
  let lo = 0;
  let hi = table.length - 1;

  for (let i = 0; i < table.length - 1; i++) {
    if (v >= table[i][0] && v <= table[i + 1][0]) {
      lo = i;
      hi = i + 1;
      break;
    }
  }

  const loVal = table[lo][0];
  const hiVal = table[hi][0];
  const t = hiVal === loVal ? 0 : (v - loVal) / (hiVal - loVal);

  const loParams = table[lo][1];
  const hiParams = table[hi][1];
  const result = {} as T;

  for (const key of Object.keys(loParams) as Array<keyof T>) {
    const a = loParams[key];
    const b = hiParams[key];
    if (typeof a === 'number' && typeof b === 'number') {
      (result as Record<keyof T, unknown>)[key] = a + (b - a) * t;
    } else {
      // Discrete: snap at 75% toward the higher-row value
      (result as Record<keyof T, unknown>)[key] = t < 0.75 ? a : b;
    }
  }

  return result;
}

/**
 * Clamp a numeric parameter to its declared valid range.
 * No-ops for discrete (null range) parameters.
 */
function clampParam(name: keyof ControlSurfaceParams, value: number): number {
  const range = PARAM_RANGES[name];
  if (!range) return value;
  return Math.max(range[0], Math.min(range[1], value));
}

// ─── ControlSurface ──────────────────────────────────────────────────────────

export class ControlSurface {
  private _axes: AxisState;
  /** Offset map: paramName → numeric offset (or literal override for discrete params). */
  private _offsets: Record<string, number | string | boolean>;
  private _listeners: Array<(params: ControlSurfaceParams) => void>;
  private _derivedCache: ControlSurfaceParams | null;
  private _resolvedCache: ControlSurfaceParams | null;
  private _dirty: boolean;

  constructor() {
    this._axes = { boldness: 0.5, memory: 0.5, precision: 0.3 };
    this._offsets = {};
    this._listeners = [];
    this._derivedCache = null;
    this._resolvedCache = null;
    this._dirty = true;
  }

  // ── Compound axis setters / getters ────────────────────────────────────────

  setBoldness(value: number): void {
    this._axes.boldness = Math.max(0, Math.min(1, value));
    this._dirty = true;
    this._notify();
  }

  setMemory(value: number): void {
    this._axes.memory = Math.max(0, Math.min(1, value));
    this._dirty = true;
    this._notify();
  }

  setPrecision(value: number): void {
    this._axes.precision = Math.max(0, Math.min(1, value));
    this._dirty = true;
    this._notify();
  }

  getBoldness(): number  { return this._axes.boldness;  }
  getMemory():   number  { return this._axes.memory;    }
  getPrecision(): number { return this._axes.precision; }

  // ── Individual overrides (offset / trim-pot model) ─────────────────────────

  /**
   * Override a specific parameter.
   *
   * For numeric params the delta (manualValue − axisDerivedValue) is stored, so
   * subsequent axis movements shift the base while the offset persists.
   * For discrete params the literal value is stored directly.
   */
  setOverride(paramName: keyof ControlSurfaceParams, value: number | string | boolean): void {
    const derived = this._getDerived();
    const base = (derived as unknown as Record<string, unknown>)[paramName] ??
                 (PARAM_DEFAULTS as unknown as Record<string, unknown>)[paramName];

    if (typeof base === 'number' && typeof value === 'number') {
      this._offsets[paramName] = value - base;
    } else {
      // Discrete: store literal value
      this._offsets[paramName] = value;
    }
    this._dirty = true;
    this._notify();
  }

  clearOverride(paramName: keyof ControlSurfaceParams): void {
    delete this._offsets[paramName];
    this._dirty = true;
    this._notify();
  }

  /** Clear all offsets (re-link all params to axis-derived values). */
  clearAllOverrides(): void {
    this._offsets = {};
    this._dirty = true;
    this._notify();
  }

  hasOverride(paramName: keyof ControlSurfaceParams): boolean {
    return paramName in this._offsets;
  }

  // ── Resolved parameter values ──────────────────────────────────────────────

  /**
   * Returns a flat object with all resolved parameter values:
   * axis-derived values + offsets, clamped to valid ranges.
   */
  getParams(): ControlSurfaceParams {
    if (!this._dirty && this._resolvedCache) return this._resolvedCache;

    const derived = this._getDerived();
    const resolved = { ...PARAM_DEFAULTS } as ControlSurfaceParams;

    for (const name of Object.keys(PARAM_DEFAULTS) as Array<keyof ControlSurfaceParams>) {
      const base = (derived as unknown as Record<string, unknown>)[name] ??
                   (PARAM_DEFAULTS as unknown as Record<string, unknown>)[name];

      if (name in this._offsets) {
        const range = PARAM_RANGES[name];
        if (range && typeof base === 'number') {
          (resolved as unknown as Record<string, unknown>)[name] =
            clampParam(name, (base as number) + (this._offsets[name] as number));
        } else {
          // Discrete override: stored as literal
          (resolved as unknown as Record<string, unknown>)[name] = this._offsets[name];
        }
      } else {
        (resolved as unknown as Record<string, unknown>)[name] = base;
      }
    }

    this._resolvedCache = resolved;
    this._dirty = false;
    return resolved;
  }

  getParam<K extends keyof ControlSurfaceParams>(name: K): ControlSurfaceParams[K] {
    return this.getParams()[name];
  }

  // ── Presets ────────────────────────────────────────────────────────────────

  applyPreset(presetId: string): void {
    const preset = CONTROL_PRESETS[presetId];
    if (!preset) {
      console.warn(`[ControlSurface] Unknown preset: ${presetId}`);
      return;
    }
    this._axes.boldness  = preset.boldness;
    this._axes.memory    = preset.memory;
    this._axes.precision = preset.precision;
    this._offsets = {};
    this._dirty = true;
    this._notify();
  }

  /** Returns a list of all built-in presets with their id included. */
  getPresetList(): ControlPreset[] {
    return Object.entries(CONTROL_PRESETS).map(([id, values]) => ({ id, ...values }));
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  /**
   * Register a listener for parameter changes.
   * @returns Unsubscribe function.
   */
  onChange(callback: (params: ControlSurfaceParams) => void): () => void {
    this._listeners.push(callback);
    return () => {
      const idx = this._listeners.indexOf(callback);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  getState(): ControlSurfaceState {
    return {
      axes:    { ...this._axes },
      offsets: { ...this._offsets },
    };
  }

  setState(state: Partial<ControlSurfaceState>): void {
    if (state.axes) {
      this._axes.boldness  = state.axes.boldness  ?? 0.5;
      this._axes.memory    = state.axes.memory    ?? 0.5;
      this._axes.precision = state.axes.precision ?? 0.3;
    }
    if (state.offsets) {
      this._offsets = { ...state.offsets };
    }
    this._dirty = true;
    this._notify();
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  /**
   * Compute axis-derived parameter values (before offsets).
   * Merges all three interpolation tables on top of PARAM_DEFAULTS.
   *
   * Conflict resolution for weightDecay: both Boldness and Memory tables
   * contribute a weight-decay influence. We take the larger of the two.
   */
  private _getDerived(): ControlSurfaceParams {
    if (!this._dirty && this._derivedCache) return this._derivedCache;

    const boldness  = interpolateTable(BOLDNESS_TABLE,  this._axes.boldness);
    const memory    = interpolateTable(MEMORY_TABLE,    this._axes.memory);
    const precision = interpolateTable(PRECISION_TABLE, this._axes.precision);

    const derived: ControlSurfaceParams = { ...PARAM_DEFAULTS };

    // Boldness params
    derived.zoom              = boldness.zoom;
    derived.noiseCap          = boldness.noiseCap;
    derived.noiseGrowth       = boldness.noiseGrowth;
    derived.learningRate      = boldness.learningRate;
    derived.weightDecay       = boldness.weightDecay;
    derived.noiseDistribution = boldness.noiseDistribution;

    // Memory params
    derived.maxExamples          = Math.round(memory.maxExamples);
    derived.exampleDecay         = memory.exampleDecay;
    derived.noiseDecay           = memory.noiseDecay;
    derived.convergenceThreshold = memory.convergenceThreshold;
    // Weight decay: take the larger influence from Boldness and Memory
    derived.weightDecay = Math.max(boldness.weightDecay, memory.memoryWeightDecay);

    // Precision params
    derived.inputCurve    = precision.inputCurve;
    derived.deadzone      = precision.deadzone;
    derived.smoothing     = precision.smoothing;
    derived.outputSlewRate = precision.slewRate;
    derived.momentumZoom  = precision.momentumZoom;

    this._derivedCache = derived;
    return derived;
  }

  private _notify(): void {
    const params = this.getParams();
    for (const fn of this._listeners) {
      try {
        fn(params);
      } catch (e) {
        console.error('[ControlSurface] listener error:', e);
      }
    }
  }
}
