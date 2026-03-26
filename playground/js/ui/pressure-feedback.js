/**
 * Pressure / Hold-Duration Feedback
 *
 * Combines touch pressure (Force Touch, stylus) and hold duration into a
 * single intensity multiplier (0-1). Applied to noise growth on thumbs-down
 * and train intensity on thumbs-up.
 *
 * When disabled, getIntensity() returns 1.0 (passthrough).
 *
 * @module pressure-feedback
 */

export class PressureFeedback {
  /**
   * @param {object} [options]
   * @param {boolean} [options.pressureEnabled=false]  - use event.pressure
   * @param {boolean} [options.holdEnabled=true]        - ramp intensity by hold duration
   * @param {number}  [options.holdCurve=2]             - seconds to reach max intensity
   * @param {number}  [options.minIntensity=0.15]       - floor when active (quick tap)
   */
  constructor(options = {}) {
    this._pressureEnabled = options.pressureEnabled ?? false;
    this._holdEnabled = options.holdEnabled ?? true;
    this._holdCurve = Math.max(0.1, options.holdCurve ?? 2);
    this._minIntensity = Math.max(0, Math.min(1, options.minIntensity ?? 0.15));

    // Runtime state
    this._active = false;          // pointer is currently down
    this._startTime = 0;           // timestamp of pointerdown (ms)
    this._currentPressure = 0;     // latest event.pressure (0-1)
    this._holdIntensity = 0;       // computed hold intensity (0-1)
  }

  // ---- Pointer event handlers ----

  /**
   * Call on pointerdown. Starts tracking hold duration and pressure.
   * @param {PointerEvent} event
   */
  onPointerDown(event) {
    this._active = true;
    this._startTime = performance.now();
    this._currentPressure = this._extractPressure(event);
    this._holdIntensity = 0;
  }

  /**
   * Call on pointermove while pointer is down.
   * Updates pressure reading.
   * @param {PointerEvent} event
   */
  onPointerMove(event) {
    if (!this._active) return;
    this._currentPressure = this._extractPressure(event);
    this._updateHold();
  }

  /**
   * Call on pointerup / pointercancel.
   */
  onPointerUp(_event) {
    this.reset();
  }

  // ---- Queries ----

  /**
   * Get current intensity multiplier.
   *
   * - If both pressure and hold are disabled, returns 1.0 (passthrough).
   * - If active and at least one source is enabled, returns max(pressure, holdIntensity).
   * - If not active (no pointer down), returns the minIntensity floor.
   *
   * @returns {number} 0-1
   */
  getIntensity() {
    if (!this._pressureEnabled && !this._holdEnabled) return 1.0;
    if (!this._active) return this._minIntensity;

    this._updateHold();

    let intensity = 0;

    if (this._pressureEnabled) {
      intensity = Math.max(intensity, this._currentPressure);
    }

    if (this._holdEnabled) {
      intensity = Math.max(intensity, this._holdIntensity);
    }

    // Ensure at least minIntensity when active
    return Math.max(this._minIntensity, intensity);
  }

  /**
   * Whether a pointer is currently held down.
   * @returns {boolean}
   */
  get active() {
    return this._active;
  }

  /**
   * Whether any source is enabled.
   * @returns {boolean}
   */
  get enabled() {
    return this._pressureEnabled || this._holdEnabled;
  }

  // ---- Configuration ----

  /**
   * Toggle pressure and hold-duration sources independently.
   * @param {boolean} pressure
   * @param {boolean} holdDuration
   */
  setEnabled(pressure, holdDuration) {
    this._pressureEnabled = !!pressure;
    this._holdEnabled = !!holdDuration;
  }

  /**
   * Set the hold-duration ramp time.
   * @param {number} seconds - time to reach max intensity (0.1-10)
   */
  setHoldCurve(seconds) {
    this._holdCurve = Math.max(0.1, Math.min(10, seconds));
  }

  /** @returns {number} */
  getHoldCurve() { return this._holdCurve; }
  /** @returns {boolean} */
  getPressureEnabled() { return this._pressureEnabled; }
  /** @returns {boolean} */
  getHoldEnabled() { return this._holdEnabled; }

  /**
   * Reset state (called on pointer up).
   */
  reset() {
    this._active = false;
    this._startTime = 0;
    this._currentPressure = 0;
    this._holdIntensity = 0;
  }

  // ---- Serialization ----

  getConfig() {
    return {
      pressureEnabled: this._pressureEnabled,
      holdEnabled: this._holdEnabled,
      holdCurve: this._holdCurve,
      minIntensity: this._minIntensity,
    };
  }

  setConfig(config) {
    if (config.pressureEnabled != null) this._pressureEnabled = !!config.pressureEnabled;
    if (config.holdEnabled != null) this._holdEnabled = !!config.holdEnabled;
    if (config.holdCurve != null) this.setHoldCurve(config.holdCurve);
    if (config.minIntensity != null) this._minIntensity = Math.max(0, Math.min(1, config.minIntensity));
  }

  // ---- Internal ----

  /**
   * Extract pressure from a pointer event.
   * Falls back to 1.0 on devices without pressure support.
   * A pressure of 0 on non-touch events means "no pressure data" — treat as 1.0.
   */
  _extractPressure(event) {
    if (!event) return 1.0;
    const p = event.pressure;
    // Most mouse/touch events report 0.5 for button-down without pressure sensing.
    // A true 0 means "no pressure data" (mouse hover, etc.) — fall back to 1.0.
    if (typeof p !== 'number' || p === 0) return 1.0;
    return Math.max(0, Math.min(1, p));
  }

  /**
   * Update hold intensity based on elapsed time since pointer down.
   * Uses an ease-in curve (quadratic).
   */
  _updateHold() {
    if (!this._active || !this._holdEnabled) return;
    const elapsed = (performance.now() - this._startTime) / 1000; // seconds
    const t = Math.min(1, elapsed / this._holdCurve);
    // Ease-in (quadratic) — slow start, fast finish
    this._holdIntensity = t * t;
  }
}
