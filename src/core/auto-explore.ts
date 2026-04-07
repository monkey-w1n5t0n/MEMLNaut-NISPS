/**
 * AutoExplore — automated thumbs-down at regular intervals.
 *
 * "Wander" mode for weight space: the system drifts continuously while
 * the user only gives thumbs-up when it lands on something good.
 *
 * Intensity scales with zoom level: zoomed in = gentler steps,
 * zoomed out = bigger leaps.
 *
 * Uses setInterval internally. Call start()/stop() or toggle() to control.
 *
 * Ported from playground/js/ui/auto-explore.js.
 */

// ---- Constants ----

const MIN_INTERVAL = 0.5;    // seconds
const MAX_INTERVAL = 10;     // seconds
const DEFAULT_INTERVAL = 2;  // seconds
const MIN_INTENSITY = 0.1;
const MAX_INTENSITY = 1.0;
const DEFAULT_INTENSITY = 0.5;

// ---- Types ----

export interface AutoExploreOptions {
  /** Seconds between auto-steps. Default: 2. Range: [0.5, 10]. */
  interval?: number;
  /** Noise intensity per step. Default: 0.5. Range: [0.1, 1.0]. */
  intensity?: number;
}

export interface AutoExploreConfig {
  interval: number;
  intensity: number;
  active: boolean;
}

export interface ExploreEvent {
  /** Effective intensity after zoom scaling. */
  intensity: number;
}

export interface AutoExplore {
  // Control
  start(): void;
  stop(): void;
  toggle(): void;
  readonly active: boolean;

  // Configuration
  setInterval(seconds: number): void;
  getInterval(): number;
  setIntensity(intensity: number): void;
  getIntensity(): number;

  /**
   * Register the explore callback. Called each time an auto-step fires.
   * Receives current zoom level so the step can be scaled accordingly.
   */
  onExplore(callback: (event: ExploreEvent) => void): void;

  /**
   * Set the zoom level provider. AutoExplore calls this to retrieve the
   * current zoom value at each step — keeping the interface dependency-free.
   * If not set, zoom defaults to 1.0.
   */
  setZoomProvider(fn: () => number): void;

  /** Progress toward next auto-step [0, 1]. Useful for a progress ring. */
  getProgress(): number;

  // Serialization
  getConfig(): AutoExploreConfig;
  setConfig(config: Partial<Omit<AutoExploreConfig, 'active'>>): void;
}

// ---- Utility ----

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---- Implementation ----

export function createAutoExplore(options: AutoExploreOptions = {}): AutoExplore {
  let _interval = clamp(options.interval ?? DEFAULT_INTERVAL, MIN_INTERVAL, MAX_INTERVAL);
  let _intensity = clamp(options.intensity ?? DEFAULT_INTENSITY, MIN_INTENSITY, MAX_INTENSITY);
  let _active = false;
  let _timerId: ReturnType<typeof setInterval> | null = null;
  let _stepStartedAt = 0; // performance.now() at the start of the current interval
  let _callback: ((event: ExploreEvent) => void) | null = null;
  let _zoomProvider: (() => number) | null = null;

  function _clearTimer(): void {
    if (_timerId !== null) {
      clearInterval(_timerId);
      _timerId = null;
    }
  }

  function _fireExplore(): void {
    if (!_callback) return;
    const zoomLevel = _zoomProvider ? _zoomProvider() : 1.0;
    // Scale intensity by zoom: zoomed in = gentler, zoomed out = bigger leaps
    const scaledIntensity = _intensity * Math.max(0.05, zoomLevel);
    _stepStartedAt = performance.now();
    _callback({ intensity: scaledIntensity });
  }

  function _startTimer(): void {
    _clearTimer();
    _stepStartedAt = performance.now();
    _timerId = setInterval(() => {
      if (!_active) return;
      _fireExplore();
    }, _interval * 1000);
  }

  return {
    start(): void {
      if (_active) return;
      _active = true;
      _startTimer();
    },

    stop(): void {
      _active = false;
      _clearTimer();
      _stepStartedAt = 0;
    },

    toggle(): void {
      if (_active) this.stop();
      else this.start();
    },

    get active(): boolean {
      return _active;
    },

    setInterval(seconds: number): void {
      _interval = clamp(seconds, MIN_INTERVAL, MAX_INTERVAL);
      // Restart timer with new interval if currently running
      if (_active) _startTimer();
    },

    getInterval(): number { return _interval; },

    setIntensity(intensity: number): void {
      _intensity = clamp(intensity, MIN_INTENSITY, MAX_INTENSITY);
    },

    getIntensity(): number { return _intensity; },

    onExplore(callback: (event: ExploreEvent) => void): void {
      _callback = callback;
    },

    setZoomProvider(fn: () => number): void {
      _zoomProvider = fn;
    },

    getProgress(): number {
      if (!_active || _stepStartedAt === 0) return 0;
      const elapsed = (performance.now() - _stepStartedAt) / 1000; // seconds
      return Math.min(1, elapsed / _interval);
    },

    getConfig(): AutoExploreConfig {
      return {
        interval: _interval,
        intensity: _intensity,
        active: _active,
      };
    },

    setConfig(config: Partial<Omit<AutoExploreConfig, 'active'>>): void {
      if (config.interval != null) this.setInterval(config.interval);
      if (config.intensity != null) this.setIntensity(config.intensity);
      // Note: we don't auto-start from config — caller decides
    },
  };
}
