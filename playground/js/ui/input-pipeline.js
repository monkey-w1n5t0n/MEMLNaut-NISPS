/**
 * Input Pipeline — data processing layer between physical input and the MLP.
 *
 * Pipeline stages (in order):
 *   1. Deadzone — suppress jitter near center, remap to full [0,1]
 *   2. Zoom — narrow effective input window around an anchor point
 *   3. Input Curve — centered power curve (exponent)
 *   4. Smoothing — exponential moving average (frame-rate-independent)
 *   5. Momentum-as-zoom — movement speed modulates effective zoom
 *
 * Pure math module — no DOM dependencies.
 *
 * @module input-pipeline
 */

// ---------------------------------------------------------------------------
// Default constants
// ---------------------------------------------------------------------------

/** @type {number} Default zoom level (1.0 = full range, no zoom) */
export const DEFAULT_ZOOM = 1.0;
/** @type {number} Minimum zoom before input is frozen */
export const ZOOM_MIN = 0.01;
/** @type {number} Maximum zoom level */
export const ZOOM_MAX = 1.0;
/** @type {number} Default deadzone (0 = off) */
export const DEFAULT_DEADZONE = 0;
/** @type {number} Maximum allowed deadzone */
export const DEADZONE_MAX = 0.4;
/** @type {number} Default input curve exponent (1.0 = linear) */
export const DEFAULT_INPUT_CURVE = 1.0;
/** @type {number} Minimum input curve exponent */
export const INPUT_CURVE_MIN = 0.2;
/** @type {number} Maximum input curve exponent */
export const INPUT_CURVE_MAX = 5.0;
/** @type {number} Default smoothing factor (0 = no smoothing) */
export const DEFAULT_SMOOTHING = 0;
/** @type {number} Maximum smoothing factor */
export const SMOOTHING_MAX = 0.95;
/** @type {string} Default momentum-zoom mode */
export const DEFAULT_MOMENTUM_ZOOM = 'off';
/** @type {string} Default anchor mode */
export const DEFAULT_ANCHOR_MODE = 'center';
/** @type {number} Default velocity estimation window in ms */
export const DEFAULT_VELOCITY_WINDOW = 150;

/** @type {number} Freeze threshold — zoom at or below this value freezes input */
const FREEZE_THRESHOLD = ZOOM_MIN;

// Momentum-zoom presets: { factor, minZoomMul, maxZoomMul }
// factor controls how much velocity scales zoom (higher = more effect)
const MOMENTUM_PRESETS = {
  off:     null,
  gentle:  { factor: 0.6, minZoomMul: 0.3,  maxZoomMul: 1.0 },
  strong:  { factor: 1.5, minZoomMul: 0.15, maxZoomMul: 1.0 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp value to [lo, hi]. */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Sign-preserving centered power curve (spec 2.3). Input and output in [0,1]. */
function centeredPowerCurve(input, exponent) {
  if (exponent === 1) return input;
  const offset = input - 0.5;
  const sign = offset < 0 ? -1 : 1;
  const shaped = sign * Math.pow(Math.abs(offset) * 2, exponent) / 2;
  return shaped + 0.5;
}

/**
 * Apply deadzone then remap live zone to [0,1].
 * Deadzone is a fraction of half-travel from center (0.5).
 * Returns value in [0,1].
 */
function applyDeadzone(input, deadzone) {
  if (deadzone <= 0) return input;
  const offset = input - 0.5;            // [-0.5, 0.5]
  const absOff = Math.abs(offset);
  const halfDz = deadzone * 0.5;         // deadzone fraction of half-travel (0.5)
  if (absOff <= halfDz) return 0.5;
  const sign = offset < 0 ? -1 : 1;
  // Remap [halfDz, 0.5] -> [0, 0.5]
  const remapped = (absOff - halfDz) / (0.5 - halfDz) * 0.5;
  return 0.5 + sign * remapped;
}

/**
 * Apply zoom around anchor for a single axis.
 * effective = anchor + (raw - 0.5) * zoomLevel, clamped [0,1]
 */
function applyZoom(input, anchor, zoomLevel) {
  return clamp(anchor + (input - 0.5) * zoomLevel, 0, 1);
}

/**
 * Frame-rate-independent EMA.
 * Converts a per-frame smoothing factor into a time-domain factor so
 * the perceived smoothing is consistent regardless of frame rate.
 *
 * Reference frame rate is 60 fps (≈16.67 ms).
 */
function emaSmooth(prev, raw, smoothing, dt) {
  if (smoothing <= 0) return raw;
  // Convert from "per-frame at 60fps" to time-constant-based
  const refDt = 1 / 60;
  const effectiveDt = dt > 0 ? dt : refDt;
  // alpha is the fraction of the new value to blend in per reference frame
  // For frame-rate independence: alpha_eff = 1 - (1 - alpha)^(dt/refDt)
  const alpha = 1 - smoothing;           // per-reference-frame new-value weight
  const alphaEff = 1 - Math.pow(1 - alpha, effectiveDt / refDt);
  return prev + alphaEff * (raw - prev);
}

// ---------------------------------------------------------------------------
// InputPipeline
// ---------------------------------------------------------------------------

/**
 * Configurable input processing pipeline.
 *
 * Transforms raw 2D input (e.g. joystick X/Y in [0,1]) through deadzone,
 * zoom, curve shaping, smoothing, and optional momentum-zoom, producing a
 * processed {x, y, frozen} result suitable for feeding into the MLP.
 */
export class InputPipeline {
  /**
   * @param {object} [config] — initial configuration (all optional)
   * @param {number} [config.zoom=1.0]
   * @param {number} [config.zoomX]           per-axis zoom override
   * @param {number} [config.zoomY]           per-axis zoom override
   * @param {number} [config.deadzone=0]
   * @param {number} [config.inputCurve=1.0]
   * @param {number} [config.inputCurveX]     per-axis curve override
   * @param {number} [config.inputCurveY]     per-axis curve override
   * @param {number} [config.smoothing=0]
   * @param {string} [config.momentumZoom='off']  'off' | 'gentle' | 'strong'
   * @param {number} [config.velocityWindow=150]  velocity estimation window in ms
   * @param {string} [config.anchorMode='auto']   'auto' | 'sticky' | 'center'
   * @param {number} [config.anchorX]         explicit anchor X (for sticky mode)
   * @param {number} [config.anchorY]         explicit anchor Y (for sticky mode)
   * @param {boolean} [config.invertX=false]
   * @param {boolean} [config.invertY=false]
   */
  constructor(config = {}) {
    // --- Configuration ---
    this._zoom = DEFAULT_ZOOM;
    this._zoomX = null;  // null = use global zoom
    this._zoomY = null;
    this._deadzone = DEFAULT_DEADZONE;
    this._inputCurve = DEFAULT_INPUT_CURVE;
    this._inputCurveX = null;
    this._inputCurveY = null;
    this._smoothing = DEFAULT_SMOOTHING;
    this._momentumZoom = DEFAULT_MOMENTUM_ZOOM;
    this._velocityWindow = DEFAULT_VELOCITY_WINDOW;
    this._anchorMode = DEFAULT_ANCHOR_MODE;
    this._anchorX = 0.5;
    this._anchorY = 0.5;
    this._invertX = false;
    this._invertY = false;

    // --- Internal state ---
    this._smoothedX = 0.5;
    this._smoothedY = 0.5;
    this._frozen = false;

    // Velocity estimation ring buffer: { x, y, t }
    this._velocityHistory = [];
    this._currentVelocity = 0;        // magnitude, [0,1]-space units per second
    this._momentumZoomMultiplier = 1;  // current momentum zoom factor

    // Apply any initial config overrides
    if (config && typeof config === 'object') {
      this.setConfig(config);
    }
  }

  // -----------------------------------------------------------------------
  // Main processing
  // -----------------------------------------------------------------------

  /**
   * Process raw input through the full pipeline.
   *
   * @param {number} rawX — raw input X in [0,1]
   * @param {number} rawY — raw input Y in [0,1]
   * @param {number} deltaTime — time since last call in seconds (e.g. 0.016)
   * @returns {{ x: number, y: number, frozen: boolean }}
   */
  process(rawX, rawY, deltaTime) {
    const dt = Math.max(0, deltaTime || 0);

    // Resolve effective zoom per-axis
    const baseZoomX = this._zoomX != null ? this._zoomX : this._zoom;
    const baseZoomY = this._zoomY != null ? this._zoomY : this._zoom;

    // Check freeze *before* momentum modulation
    const frozenX = baseZoomX <= FREEZE_THRESHOLD;
    const frozenY = baseZoomY <= FREEZE_THRESHOLD;
    this._frozen = frozenX && frozenY;

    if (this._frozen) {
      // Both axes frozen — return last smoothed output, skip everything
      return { x: this._smoothedX, y: this._smoothedY, frozen: true };
    }

    // --- 0. Invert ---
    let x = this._invertX ? 1 - rawX : rawX;
    let y = this._invertY ? 1 - rawY : rawY;

    // --- 1. Deadzone ---
    x = applyDeadzone(x, this._deadzone);
    y = applyDeadzone(y, this._deadzone);

    // --- 1.5. Circular clamp ---
    // Constrain input to a unit circle (radius 0.5 centered at 0.5,0.5)
    // so the reachable input space matches the circular joystick UI.
    const cx = x - 0.5;
    const cy = y - 0.5;
    const dist = Math.sqrt(cx * cx + cy * cy);
    if (dist > 0.5) {
      const scale = 0.5 / dist;
      x = 0.5 + cx * scale;
      y = 0.5 + cy * scale;
    }

    // --- 2. Zoom ---
    const anchorX = this._resolveAnchorX();
    const anchorY = this._resolveAnchorY();

    // Apply momentum-zoom multiplier to base zoom
    const effZoomX = frozenX ? FREEZE_THRESHOLD : clamp(baseZoomX * this._momentumZoomMultiplier, ZOOM_MIN, ZOOM_MAX);
    const effZoomY = frozenY ? FREEZE_THRESHOLD : clamp(baseZoomY * this._momentumZoomMultiplier, ZOOM_MIN, ZOOM_MAX);

    x = frozenX ? this._smoothedX : applyZoom(x, anchorX, effZoomX);
    y = frozenY ? this._smoothedY : applyZoom(y, anchorY, effZoomY);

    // --- 3. Input Curve ---
    const curveX = this._inputCurveX != null ? this._inputCurveX : this._inputCurve;
    const curveY = this._inputCurveY != null ? this._inputCurveY : this._inputCurve;
    if (!frozenX) x = centeredPowerCurve(x, curveX);
    if (!frozenY) y = centeredPowerCurve(y, curveY);

    // --- 4. Smoothing ---
    if (!frozenX) this._smoothedX = emaSmooth(this._smoothedX, x, this._smoothing, dt);
    if (!frozenY) this._smoothedY = emaSmooth(this._smoothedY, y, this._smoothing, dt);

    // --- 5. Momentum-as-zoom (update for *next* frame) ---
    this._updateMomentum(rawX, rawY, dt);

    return {
      x: this._smoothedX,
      y: this._smoothedY,
      frozen: false,
    };
  }

  // -----------------------------------------------------------------------
  // Configuration setters
  // -----------------------------------------------------------------------

  /**
   * Set global zoom level.
   * In 'auto' anchor mode, updates the anchor to the current smoothed position
   * when zoom changes.
   * @param {number} level — 0.01 to 1.0
   */
  setZoom(level) {
    const prev = this._zoom;
    this._zoom = clamp(level, ZOOM_MIN, ZOOM_MAX);
    if (this._anchorMode === 'auto' && prev !== this._zoom) {
      this._anchorX = this._smoothedX;
      this._anchorY = this._smoothedY;
    }
  }

  /**
   * Set per-axis zoom overrides. Pass null to clear an axis override.
   * @param {number|null} x — zoom for X axis (0.01-1.0), or null
   * @param {number|null} y — zoom for Y axis (0.01-1.0), or null
   */
  setZoomPerAxis(x, y) {
    this._zoomX = x != null ? clamp(x, ZOOM_MIN, ZOOM_MAX) : null;
    this._zoomY = y != null ? clamp(y, ZOOM_MIN, ZOOM_MAX) : null;
    if (this._anchorMode === 'auto') {
      this._anchorX = this._smoothedX;
      this._anchorY = this._smoothedY;
    }
  }

  /**
   * Set explicit anchor point (used in sticky mode, also sets anchor for auto).
   * @param {number} x — anchor X in [0,1]
   * @param {number} y — anchor Y in [0,1]
   */
  setAnchor(x, y) {
    this._anchorX = clamp(x, 0, 1);
    this._anchorY = clamp(y, 0, 1);
  }

  /**
   * Set anchor mode.
   * @param {'auto'|'sticky'|'center'} mode
   */
  setAnchorMode(mode) {
    if (mode !== 'auto' && mode !== 'sticky' && mode !== 'center') return;
    this._anchorMode = mode;
    if (mode === 'center') {
      this._anchorX = 0.5;
      this._anchorY = 0.5;
    } else if (mode === 'auto') {
      // Snap anchor to current position
      this._anchorX = this._smoothedX;
      this._anchorY = this._smoothedY;
    }
  }

  /**
   * Set deadzone as a fraction of half-travel.
   * @param {number} pct — 0 to 0.4
   */
  setDeadzone(pct) {
    this._deadzone = clamp(pct, 0, DEADZONE_MAX);
  }

  /**
   * Set input curve exponent (applies to both axes unless per-axis is set).
   * @param {number} exp — 0.2 to 5.0 (1.0 = linear)
   */
  setInputCurve(exp) {
    this._inputCurve = clamp(exp, INPUT_CURVE_MIN, INPUT_CURVE_MAX);
  }

  /**
   * Set per-axis input curve overrides. Pass null to clear.
   * @param {number|null} expX — curve exponent for X, or null
   * @param {number|null} expY — curve exponent for Y, or null
   */
  setInputCurvePerAxis(expX, expY) {
    this._inputCurveX = expX != null ? clamp(expX, INPUT_CURVE_MIN, INPUT_CURVE_MAX) : null;
    this._inputCurveY = expY != null ? clamp(expY, INPUT_CURVE_MIN, INPUT_CURVE_MAX) : null;
  }

  /**
   * Set EMA smoothing factor.
   * @param {number} factor — 0 (off) to 0.95
   */
  setSmoothing(factor) {
    this._smoothing = clamp(factor, 0, SMOOTHING_MAX);
  }

  /**
   * Set momentum-zoom mode.
   * @param {'off'|'gentle'|'strong'} mode
   */
  setMomentumZoom(mode) {
    if (!MOMENTUM_PRESETS.hasOwnProperty(mode)) return;
    this._momentumZoom = mode;
    if (mode === 'off') {
      this._momentumZoomMultiplier = 1;
      this._velocityHistory = [];
      this._currentVelocity = 0;
    }
  }

  /**
   * Set axis inversion.
   * @param {boolean} invertX
   * @param {boolean} invertY
   */
  setInvert(invertX, invertY) {
    this._invertX = !!invertX;
    this._invertY = !!invertY;
  }

  /**
   * Set velocity estimation window for momentum-zoom.
   * @param {number} ms — window in milliseconds (50-500)
   */
  setVelocityWindow(ms) {
    this._velocityWindow = clamp(ms, 50, 500);
  }

  // -----------------------------------------------------------------------
  // State queries
  // -----------------------------------------------------------------------

  /**
   * Get current effective zoom level (after momentum modulation).
   * Returns the *minimum* of X and Y effective zoom if they differ.
   * @returns {number}
   */
  getZoomLevel() {
    const baseX = this._zoomX != null ? this._zoomX : this._zoom;
    const baseY = this._zoomY != null ? this._zoomY : this._zoom;
    const effX = clamp(baseX * this._momentumZoomMultiplier, ZOOM_MIN, ZOOM_MAX);
    const effY = clamp(baseY * this._momentumZoomMultiplier, ZOOM_MIN, ZOOM_MAX);
    return Math.min(effX, effY);
  }

  /**
   * Get current anchor position.
   * @returns {{ x: number, y: number }}
   */
  getAnchor() {
    return { x: this._resolveAnchorX(), y: this._resolveAnchorY() };
  }

  /**
   * Get the zoom window as a circle in [0,1] space — for minimap rendering.
   * Returns center + radius of the input space the joystick currently covers.
   * @returns {{ cx: number, cy: number, r: number }}
   */
  getZoomWindow() {
    const anchorX = this._resolveAnchorX();
    const anchorY = this._resolveAnchorY();
    const baseZoom = this._zoomX != null ? this._zoomX : this._zoom;
    const effZoom = clamp(baseZoom * this._momentumZoomMultiplier, ZOOM_MIN, ZOOM_MAX);
    return {
      cx: anchorX,
      cy: anchorY,
      r: effZoom / 2,
    };
  }

  /**
   * Get the zoom window as an axis-aligned bounding rect in [0,1] space.
   * For consumers that need {x1, y1, x2, y2} (heatmap, region pinning).
   * @returns {{ x1: number, y1: number, x2: number, y2: number }}
   */
  getZoomWindowRect() {
    const { cx, cy, r } = this.getZoomWindow();
    return {
      x1: clamp(cx - r, 0, 1),
      y1: clamp(cy - r, 0, 1),
      x2: clamp(cx + r, 0, 1),
      y2: clamp(cy + r, 0, 1),
    };
  }

  /**
   * Whether input is effectively frozen (zoom at or below minimum).
   * @returns {boolean}
   */
  isFrozen() {
    return this._frozen;
  }

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  /**
   * Export all settings as a plain object (no internal state).
   * @returns {object}
   */
  getConfig() {
    return {
      zoom: this._zoom,
      zoomX: this._zoomX,
      zoomY: this._zoomY,
      deadzone: this._deadzone,
      inputCurve: this._inputCurve,
      inputCurveX: this._inputCurveX,
      inputCurveY: this._inputCurveY,
      smoothing: this._smoothing,
      momentumZoom: this._momentumZoom,
      velocityWindow: this._velocityWindow,
      anchorMode: this._anchorMode,
      anchorX: this._anchorX,
      anchorY: this._anchorY,
      invertX: this._invertX,
      invertY: this._invertY,
    };
  }

  /**
   * Restore configuration from a plain object. Unknown keys are ignored.
   * Only updates settings that are present in the object.
   * @param {object} config
   */
  setConfig(config) {
    if (config.zoom != null)          this.setZoom(config.zoom);
    if (config.deadzone != null)      this.setDeadzone(config.deadzone);
    if (config.inputCurve != null)    this.setInputCurve(config.inputCurve);
    if (config.smoothing != null)     this.setSmoothing(config.smoothing);
    if (config.momentumZoom != null)  this.setMomentumZoom(config.momentumZoom);
    if (config.velocityWindow != null) this.setVelocityWindow(config.velocityWindow);
    if (config.anchorMode != null)    this.setAnchorMode(config.anchorMode);
    if (config.invertX != null || config.invertY != null) {
      this.setInvert(
        config.invertX != null ? config.invertX : this._invertX,
        config.invertY != null ? config.invertY : this._invertY,
      );
    }
    // Per-axis overrides (allow explicit null to clear)
    if ('zoomX' in config || 'zoomY' in config) {
      this.setZoomPerAxis(
        'zoomX' in config ? config.zoomX : this._zoomX,
        'zoomY' in config ? config.zoomY : this._zoomY,
      );
    }
    if ('inputCurveX' in config || 'inputCurveY' in config) {
      this.setInputCurvePerAxis(
        'inputCurveX' in config ? config.inputCurveX : this._inputCurveX,
        'inputCurveY' in config ? config.inputCurveY : this._inputCurveY,
      );
    }
    // Explicit anchor (set after anchorMode so sticky mode is already active)
    if (config.anchorX != null && config.anchorY != null) {
      this.setAnchor(config.anchorX, config.anchorY);
    }
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  /**
   * Reset all settings to defaults and clear internal state.
   */
  reset() {
    this._zoom = DEFAULT_ZOOM;
    this._zoomX = null;
    this._zoomY = null;
    this._deadzone = DEFAULT_DEADZONE;
    this._inputCurve = DEFAULT_INPUT_CURVE;
    this._inputCurveX = null;
    this._inputCurveY = null;
    this._smoothing = DEFAULT_SMOOTHING;
    this._momentumZoom = DEFAULT_MOMENTUM_ZOOM;
    this._velocityWindow = DEFAULT_VELOCITY_WINDOW;
    this._anchorMode = DEFAULT_ANCHOR_MODE;
    this._anchorX = 0.5;
    this._anchorY = 0.5;
    this._invertX = false;
    this._invertY = false;

    this._smoothedX = 0.5;
    this._smoothedY = 0.5;
    this._frozen = false;
    this._velocityHistory = [];
    this._currentVelocity = 0;
    this._momentumZoomMultiplier = 1;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Resolve anchor X based on current mode. */
  _resolveAnchorX() {
    if (this._anchorMode === 'center') return 0.5;
    return this._anchorX;
  }

  /** Resolve anchor Y based on current mode. */
  _resolveAnchorY() {
    if (this._anchorMode === 'center') return 0.5;
    return this._anchorY;
  }

  /**
   * Update velocity estimation and momentum-zoom multiplier.
   * Called at the end of each process() with the *raw* (pre-pipeline) input
   * so velocity reflects actual physical movement, not processed output.
   */
  _updateMomentum(rawX, rawY, dt) {
    const preset = MOMENTUM_PRESETS[this._momentumZoom];
    if (!preset) {
      this._momentumZoomMultiplier = 1;
      return;
    }

    const now = performance.now();

    // Push current sample
    this._velocityHistory.push({ x: rawX, y: rawY, t: now });

    // Prune samples outside the velocity window
    const windowStart = now - this._velocityWindow;
    while (this._velocityHistory.length > 1 && this._velocityHistory[0].t < windowStart) {
      this._velocityHistory.shift();
    }

    // Estimate velocity (distance in [0,1] space per second)
    if (this._velocityHistory.length >= 2) {
      const first = this._velocityHistory[0];
      const last = this._velocityHistory[this._velocityHistory.length - 1];
      const elapsed = (last.t - first.t) / 1000; // seconds
      if (elapsed > 0.001) {
        const dx = last.x - first.x;
        const dy = last.y - first.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        this._currentVelocity = dist / elapsed;
      }
    }

    // Map velocity to zoom multiplier.
    // Slow movement (velocity ~ 0) → low multiplier (zoomed in, fine control)
    // Fast movement (velocity high) → high multiplier (zoomed out, broad traversal)
    //
    // Velocity is in [0,1]-space units per second.
    // Typical slow movement: 0.1–0.5 u/s
    // Typical fast sweep:    2–6 u/s
    //
    // We use a sigmoid-like mapping so the transition feels smooth.
    const v = this._currentVelocity;
    const { factor, minZoomMul, maxZoomMul } = preset;

    // Normalised speed: 0 at rest, approaches 1 at high velocity
    // Using 1 - exp(-factor * v) which is smooth and bounded
    const normalised = 1 - Math.exp(-factor * v);

    // Interpolate between minZoomMul (slow) and maxZoomMul (fast)
    const target = minZoomMul + normalised * (maxZoomMul - minZoomMul);

    // Smooth the multiplier itself to avoid jitter
    // Use a fast-attack, slow-release envelope so zoom-out is instant
    // but zoom-in (slowing down) ramps gently
    const attackRate = 12;  // per second — fast response to speed increase
    const releaseRate = 3;  // per second — gentle return when slowing down
    const rate = target > this._momentumZoomMultiplier ? attackRate : releaseRate;
    const blend = 1 - Math.exp(-rate * dt);
    this._momentumZoomMultiplier += blend * (target - this._momentumZoomMultiplier);
  }
}
