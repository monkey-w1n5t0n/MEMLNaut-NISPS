// Control Surface — Compound Axes + Parameter Override System
// Phase 1: Boldness, Memory, Precision axes with offset-based overrides.
//
// Each compound axis maps a single 0-1 slider to multiple underlying parameters.
// Users can override individual params; the offset from axis-derived value persists
// as the axis moves (trim-pot model). Double-tap an axis to re-link (clear offsets).

// ---- Interpolation tables ----
// Each row: [axisValue, { param: value, ... }]
// Linear interpolation between adjacent rows.

const BOLDNESS_TABLE = [
  [0.0, { zoom: 0.1, noiseCap: 0.02, noiseGrowth: 1.1, learningRate: 0.1, weightDecay: 0.15, noiseDistribution: 'gaussian' }],
  [0.5, { zoom: 0.5, noiseCap: 0.12, noiseGrowth: 1.5, learningRate: 1.0, weightDecay: 0.06, noiseDistribution: 'gaussian' }],
  [1.0, { zoom: 1.0, noiseCap: 0.30, noiseGrowth: 2.5, learningRate: 3.0, weightDecay: 0.00, noiseDistribution: 'cauchy' }],
];

const MEMORY_TABLE = [
  [0.0, { maxExamples: 5,   exampleDecay: 0.3, memoryWeightDecay: 0.20, noiseDecay: 0.85,  convergenceThreshold: 1e-3 }],
  [0.5, { maxExamples: 50,  exampleDecay: 0.7, memoryWeightDecay: 0.06, noiseDecay: 0.97,  convergenceThreshold: 1e-5 }],
  [1.0, { maxExamples: 500, exampleDecay: 1.0, memoryWeightDecay: 0.00, noiseDecay: 0.995, convergenceThreshold: 1e-8 }],
];

const PRECISION_TABLE = [
  [0.0, { inputCurve: 1.0, deadzone: 0.0,  smoothing: 0.0,  slewRate: 1.0, momentumZoom: 'off' }],
  [0.5, { inputCurve: 1.5, deadzone: 0.05, smoothing: 0.15, slewRate: 0.3, momentumZoom: 'off' }],
  [1.0, { inputCurve: 3.0, deadzone: 0.15, smoothing: 0.40, slewRate: 0.1, momentumZoom: 'off' }],
];

// ---- Control Presets ----

const CONTROL_PRESETS = {
  'default':     { boldness: 0.5, memory: 0.5, precision: 0.3 },
  'first-touch': { boldness: 0.2, memory: 0.7, precision: 0.6 },
  'jazz-hands':  { boldness: 0.8, memory: 0.2, precision: 0.0 },
  'sculptor':    { boldness: 0.3, memory: 0.9, precision: 0.8 },
  'improviser':  { boldness: 0.6, memory: 0.3, precision: 0.2 },
  'microscope':  { boldness: 0.1, memory: 1.0, precision: 1.0 },
};

// ---- Default values for all parameters ----
// These are used when no axis or override controls a parameter.

const PARAM_DEFAULTS = {
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

// Valid ranges for clamping (min, max, step). Discrete params use null.
const PARAM_RANGES = {
  zoom:               [0.01, 1.0, 0.01],
  deadzone:           [0, 0.4, 0.01],
  inputCurve:         [0.2, 5.0, 0.1],
  smoothing:          [0, 1.0, 0.01],
  momentumZoom:       null, // discrete: 'off' | 'gentle' | 'strong'
  invertX:            null, // boolean
  invertY:            null, // boolean
  learningRate:       [0.01, 10.0, 0.01],
  maxIterations:      [10, 10000, 10],
  convergenceThreshold: [1e-8, 1e-2, null], // log scale
  rlTrainIntensity:   [0.1, 5.0, 0.1],
  maxExamples:        [1, 500, 1],
  exampleDecay:       [0, 1.0, 0.01],
  spread:             [0, 1.0, 0.01],
  noiseFloor:         [0, 0.1, 0.001],
  noiseCap:           [0.01, 0.5, 0.01],
  noiseGrowth:        [1.0, 5.0, 0.1],
  noiseDecay:         [0.5, 1.0, 0.001],
  weightDecay:        [0, 0.5, 0.01],
  noiseDistribution:  null, // discrete: 'gaussian' | 'cauchy'
  layerAwareNoise:    null, // boolean
  zoomAwareFeedback:  null, // boolean
  outputSmoothing:    [0, 1.0, 0.01],
  outputSlewRate:     [0.01, 1.0, 0.01],
  tame:               [0, 1.0, 0.01],
  globalCurve:        [0.2, 5.0, 0.1],
};

// Which parameters are log-scale in the UI
const LOG_SCALE_PARAMS = new Set(['zoom', 'learningRate', 'convergenceThreshold']);

// ---- Helpers ----

/**
 * Linearly interpolate a value from a table.
 * Table rows: [axisValue, { paramName: value, ... }]
 * For discrete params (strings), snaps at 0.75 threshold toward the higher row.
 */
function interpolateTable(table, axisValue) {
  const v = Math.max(0, Math.min(1, axisValue));
  const result = {};

  // Find the two bracketing rows
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

  for (const key of Object.keys(loParams)) {
    const a = loParams[key];
    const b = hiParams[key];
    if (typeof a === 'number' && typeof b === 'number') {
      result[key] = a + (b - a) * t;
    } else {
      // Discrete: snap at 75% toward the higher value
      result[key] = t < 0.75 ? a : b;
    }
  }

  return result;
}

/**
 * Clamp a numeric value to its valid range.
 */
function clampParam(name, value) {
  const range = PARAM_RANGES[name];
  if (!range) return value; // discrete, no clamping
  return Math.max(range[0], Math.min(range[1], value));
}


// ---- ControlSurface ----

export class ControlSurface {
  constructor() {
    // Axis values (0-1)
    this._axes = {
      boldness: 0.5,
      memory: 0.5,
      precision: 0.3,
    };

    // Per-parameter offsets (trim-pot overrides)
    // key = paramName, value = offset from axis-derived value
    this._offsets = {};

    // Change listeners
    this._listeners = [];

    // Compute initial derived params
    this._derivedCache = null;
    this._resolvedCache = null;
    this._dirty = true;
  }

  // ---- Compound axes ----

  setBoldness(value) {
    this._axes.boldness = Math.max(0, Math.min(1, value));
    this._dirty = true;
    this._notify();
  }

  setMemory(value) {
    this._axes.memory = Math.max(0, Math.min(1, value));
    this._dirty = true;
    this._notify();
  }

  setPrecision(value) {
    this._axes.precision = Math.max(0, Math.min(1, value));
    this._dirty = true;
    this._notify();
  }

  getBoldness() { return this._axes.boldness; }
  getMemory() { return this._axes.memory; }
  getPrecision() { return this._axes.precision; }

  // ---- Individual overrides (offset model) ----

  /**
   * Set an override for a specific parameter.
   * Computes offset = manualValue - axisDerivedValue, so moving the
   * axis later shifts the base while the offset persists.
   */
  setOverride(paramName, value) {
    const derived = this._getDerived();
    const base = derived[paramName] ?? PARAM_DEFAULTS[paramName];
    if (typeof base === 'number' && typeof value === 'number') {
      this._offsets[paramName] = value - base;
    } else {
      // For discrete params, store the literal value (not an offset)
      this._offsets[paramName] = value;
    }
    this._dirty = true;
    this._notify();
  }

  clearOverride(paramName) {
    delete this._offsets[paramName];
    this._dirty = true;
    this._notify();
  }

  clearAllOverrides() {
    this._offsets = {};
    this._dirty = true;
    this._notify();
  }

  hasOverride(paramName) {
    return paramName in this._offsets;
  }

  // ---- Resolved parameter values ----

  /**
   * Returns a flat object of all resolved parameter values.
   * axis-derived + offsets, clamped to valid ranges.
   */
  getParams() {
    if (!this._dirty && this._resolvedCache) return this._resolvedCache;

    const derived = this._getDerived();
    const resolved = {};

    for (const name of Object.keys(PARAM_DEFAULTS)) {
      const base = derived[name] ?? PARAM_DEFAULTS[name];

      if (name in this._offsets) {
        const range = PARAM_RANGES[name];
        if (range && typeof base === 'number') {
          // Numeric with offset
          resolved[name] = clampParam(name, base + this._offsets[name]);
        } else {
          // Discrete override: stored as literal value
          resolved[name] = this._offsets[name];
        }
      } else {
        resolved[name] = base;
      }
    }

    this._resolvedCache = resolved;
    this._dirty = false;
    return resolved;
  }

  getParam(name) {
    return this.getParams()[name];
  }

  // ---- Presets ----

  applyPreset(presetId) {
    const preset = CONTROL_PRESETS[presetId];
    if (!preset) {
      console.warn(`[ControlSurface] Unknown preset: ${presetId}`);
      return;
    }
    this._axes.boldness = preset.boldness;
    this._axes.memory = preset.memory;
    this._axes.precision = preset.precision;
    this._offsets = {};
    this._dirty = true;
    this._notify();
  }

  getPresetList() {
    return Object.entries(CONTROL_PRESETS).map(([id, values]) => ({
      id,
      ...values,
    }));
  }

  // ---- Events ----

  onChange(callback) {
    this._listeners.push(callback);
    return () => {
      const idx = this._listeners.indexOf(callback);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  // ---- Serialization ----

  getState() {
    return {
      axes: { ...this._axes },
      offsets: { ...this._offsets },
    };
  }

  setState(state) {
    if (state.axes) {
      this._axes.boldness = state.axes.boldness ?? 0.5;
      this._axes.memory = state.axes.memory ?? 0.5;
      this._axes.precision = state.axes.precision ?? 0.3;
    }
    if (state.offsets) {
      this._offsets = { ...state.offsets };
    }
    this._dirty = true;
    this._notify();
  }

  // ---- Internal ----

  /**
   * Compute axis-derived values (before offsets).
   * Merges all three axis interpolation tables plus defaults.
   */
  _getDerived() {
    if (!this._dirty && this._derivedCache) return this._derivedCache;

    const boldness = interpolateTable(BOLDNESS_TABLE, this._axes.boldness);
    const memory = interpolateTable(MEMORY_TABLE, this._axes.memory);
    const precision = interpolateTable(PRECISION_TABLE, this._axes.precision);

    // Start from defaults, overlay axis-derived values.
    // Memory table uses 'memoryWeightDecay' to avoid conflict with Boldness 'weightDecay'.
    // Resolve: Boldness controls main weightDecay; Memory's memoryWeightDecay is additive context.
    // For the resolved param, we take the max of the two weight decay influences.
    const derived = { ...PARAM_DEFAULTS };

    // Boldness params
    derived.zoom = boldness.zoom;
    derived.noiseCap = boldness.noiseCap;
    derived.noiseGrowth = boldness.noiseGrowth;
    derived.learningRate = boldness.learningRate;
    derived.weightDecay = boldness.weightDecay;
    derived.noiseDistribution = boldness.noiseDistribution;

    // Memory params
    derived.maxExamples = Math.round(memory.maxExamples);
    derived.exampleDecay = memory.exampleDecay;
    derived.noiseDecay = memory.noiseDecay;
    derived.convergenceThreshold = memory.convergenceThreshold;
    // Memory weight decay: blend with boldness weight decay (take the larger influence)
    derived.weightDecay = Math.max(boldness.weightDecay, memory.memoryWeightDecay);

    // Precision params
    derived.inputCurve = precision.inputCurve;
    derived.deadzone = precision.deadzone;
    derived.smoothing = precision.smoothing;
    derived.outputSlewRate = precision.slewRate;
    derived.momentumZoom = precision.momentumZoom;

    this._derivedCache = derived;
    return derived;
  }

  _notify() {
    const params = this.getParams();

    // Dispatch DOM event for app-level wiring
    document.dispatchEvent(new CustomEvent('controlsurface:change', {
      detail: params,
    }));

    // Direct listeners
    for (const fn of this._listeners) {
      try { fn(params); } catch (e) { console.error('[ControlSurface] listener error:', e); }
    }
  }
}

// Re-export constants for UI module
export { CONTROL_PRESETS, PARAM_DEFAULTS, PARAM_RANGES, LOG_SCALE_PARAMS };
