/**
 * PressureFeedback — combines stylus/touch pressure and hold duration into a
 * single intensity multiplier [0, 1].
 *
 * Applied to noise growth on thumbs-down and train intensity on thumbs-up.
 *
 * When both sources are disabled, getIntensity() returns 1.0 (passthrough).
 * When active and at least one source is enabled, returns max(pressure, holdIntensity).
 * When not active (no pointer down), returns the minIntensity floor.
 *
 * Pure logic — no DOM access, no SolidJS signals.
 *
 * Ported from playground/js/ui/pressure-feedback.js.
 */

// ---- Types ----

export type PressureMode = 'pressure-only' | 'hold-only' | 'combined' | 'disabled';

export interface PressureFeedbackOptions {
  /** Use PointerEvent.pressure as an input source. Default: false. */
  pressureEnabled?: boolean;
  /** Ramp intensity by hold duration. Default: true. */
  holdEnabled?: boolean;
  /** Seconds to reach max intensity via hold ramp. Default: 2. */
  holdCurve?: number;
  /** Minimum intensity when active (quick tap floor). Default: 0.15. */
  minIntensity?: number;
}

export interface PressureFeedbackConfig {
  pressureEnabled: boolean;
  holdEnabled: boolean;
  holdCurve: number;
  minIntensity: number;
}

// ---- Implementation ----

export interface PressureFeedback {
  // Pointer event handlers
  onPointerDown(event: PointerEvent): void;
  onPointerMove(event: PointerEvent): void;
  onPointerUp(event: PointerEvent): void;

  // Queries
  getIntensity(): number;
  readonly active: boolean;
  readonly enabled: boolean;

  // Configuration
  setEnabled(pressure: boolean, holdDuration: boolean): void;
  setHoldCurve(seconds: number): void;
  getHoldCurve(): number;
  getPressureEnabled(): boolean;
  getHoldEnabled(): boolean;

  /** Reset runtime state (called on pointer up). */
  reset(): void;

  // Serialization
  getConfig(): PressureFeedbackConfig;
  setConfig(config: Partial<PressureFeedbackConfig>): void;
}

export function createPressureFeedback(options: PressureFeedbackOptions = {}): PressureFeedback {
  let _pressureEnabled = options.pressureEnabled ?? false;
  let _holdEnabled = options.holdEnabled ?? true;
  let _holdCurve = Math.max(0.1, options.holdCurve ?? 2);
  let _minIntensity = Math.max(0, Math.min(1, options.minIntensity ?? 0.15));

  // Runtime state
  let _active = false;
  let _startTime = 0;          // ms (performance.now())
  let _currentPressure = 0;   // latest event.pressure [0,1]
  let _holdIntensity = 0;     // computed hold ramp [0,1]

  // ---- Internal helpers ----

  function _extractPressure(event: PointerEvent): number {
    if (!event) return 1.0;
    const p = event.pressure;
    // A true 0 means "no pressure data" (mouse hover etc.) — fall back to 1.0.
    if (typeof p !== 'number' || p === 0) return 1.0;
    return Math.max(0, Math.min(1, p));
  }

  function _updateHold(): void {
    if (!_active || !_holdEnabled) return;
    const elapsed = (performance.now() - _startTime) / 1000; // seconds
    const t = Math.min(1, elapsed / _holdCurve);
    // Ease-in quadratic: slow start, fast finish
    _holdIntensity = t * t;
  }

  // ---- Public API ----

  return {
    onPointerDown(event: PointerEvent): void {
      _active = true;
      _startTime = performance.now();
      _currentPressure = _extractPressure(event);
      _holdIntensity = 0;
    },

    onPointerMove(event: PointerEvent): void {
      if (!_active) return;
      _currentPressure = _extractPressure(event);
      _updateHold();
    },

    onPointerUp(_event: PointerEvent): void {
      this.reset();
    },

    getIntensity(): number {
      if (!_pressureEnabled && !_holdEnabled) return 1.0;
      if (!_active) return _minIntensity;

      _updateHold();

      let intensity = 0;
      if (_pressureEnabled) intensity = Math.max(intensity, _currentPressure);
      if (_holdEnabled) intensity = Math.max(intensity, _holdIntensity);

      return Math.max(_minIntensity, intensity);
    },

    get active(): boolean {
      return _active;
    },

    get enabled(): boolean {
      return _pressureEnabled || _holdEnabled;
    },

    setEnabled(pressure: boolean, holdDuration: boolean): void {
      _pressureEnabled = !!pressure;
      _holdEnabled = !!holdDuration;
    },

    setHoldCurve(seconds: number): void {
      _holdCurve = Math.max(0.1, Math.min(10, seconds));
    },

    getHoldCurve(): number { return _holdCurve; },
    getPressureEnabled(): boolean { return _pressureEnabled; },
    getHoldEnabled(): boolean { return _holdEnabled; },

    reset(): void {
      _active = false;
      _startTime = 0;
      _currentPressure = 0;
      _holdIntensity = 0;
    },

    getConfig(): PressureFeedbackConfig {
      return {
        pressureEnabled: _pressureEnabled,
        holdEnabled: _holdEnabled,
        holdCurve: _holdCurve,
        minIntensity: _minIntensity,
      };
    },

    setConfig(config: Partial<PressureFeedbackConfig>): void {
      if (config.pressureEnabled != null) _pressureEnabled = !!config.pressureEnabled;
      if (config.holdEnabled != null) _holdEnabled = !!config.holdEnabled;
      if (config.holdCurve != null) this.setHoldCurve(config.holdCurve);
      if (config.minIntensity != null) {
        _minIntensity = Math.max(0, Math.min(1, config.minIntensity));
      }
    },
  };
}
