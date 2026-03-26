/**
 * Auto-Explore — automated thumbs-down at regular intervals.
 *
 * "Wander" mode for weight space: the system drifts continuously while
 * the user only gives thumbs-up when it lands on something good.
 *
 * Respects noise cap, spread, zoom-aware feedback — same rules as manual
 * thumbs-down. Intensity scales with zoom: zoomed in = gentler steps,
 * zoomed out = bigger leaps.
 *
 * @module auto-explore
 */

// ---- Constants ----
const MIN_INTERVAL = 0.5;   // seconds
const MAX_INTERVAL = 10;    // seconds
const DEFAULT_INTERVAL = 2; // seconds
const MIN_INTENSITY = 0.1;
const MAX_INTENSITY = 1.0;
const DEFAULT_INTENSITY = 0.5;

export class AutoExplore {
  /**
   * @param {object} [options]
   * @param {number} [options.interval=2]     - seconds between auto-steps
   * @param {number} [options.intensity=0.5]  - 0.1-1.0, scales noise per step
   */
  constructor(options = {}) {
    this._interval = clamp(options.interval ?? DEFAULT_INTERVAL, MIN_INTERVAL, MAX_INTERVAL);
    this._intensity = clamp(options.intensity ?? DEFAULT_INTENSITY, MIN_INTENSITY, MAX_INTENSITY);
    this._active = false;
    this._elapsed = 0; // seconds since last auto-step
    this._callback = null;
  }

  // ---- Control ----

  /** Start auto-exploration. */
  start() {
    this._active = true;
    this._elapsed = 0;
  }

  /** Stop auto-exploration. */
  stop() {
    this._active = false;
    this._elapsed = 0;
  }

  /** Toggle on/off. */
  toggle() {
    if (this._active) this.stop();
    else this.start();
  }

  /** Whether auto-explore is currently running. */
  get active() {
    return this._active;
  }

  // ---- Configuration ----

  /**
   * Set interval between auto-steps.
   * @param {number} seconds - 0.5 to 10
   */
  setInterval(seconds) {
    this._interval = clamp(seconds, MIN_INTERVAL, MAX_INTERVAL);
  }

  /** @returns {number} */
  getInterval() { return this._interval; }

  /**
   * Set exploration intensity.
   * @param {number} intensity - 0.1 to 1.0
   */
  setIntensity(intensity) {
    this._intensity = clamp(intensity, MIN_INTENSITY, MAX_INTENSITY);
  }

  /** @returns {number} */
  getIntensity() { return this._intensity; }

  // ---- Tick (call every frame) ----

  /**
   * Advance the auto-explore timer. When the interval elapses, fires
   * the registered callback with { intensity, zoomLevel }.
   *
   * @param {number} deltaTime - seconds since last frame
   * @param {number} [zoomLevel=1.0] - current zoom level (0-1)
   */
  tick(deltaTime, zoomLevel = 1.0) {
    if (!this._active) return;
    if (deltaTime <= 0) return;

    this._elapsed += deltaTime;

    if (this._elapsed >= this._interval) {
      this._elapsed -= this._interval;
      // Prevent runaway accumulation if tab was backgrounded
      if (this._elapsed > this._interval) this._elapsed = 0;

      this._fireExplore(zoomLevel);
    }
  }

  // ---- Callback ----

  /**
   * Register the explore callback. Called when auto-step fires.
   * @param {function} callback - receives { intensity }
   */
  onExplore(callback) {
    this._callback = callback;
  }

  // ---- Visual state ----

  /**
   * Progress toward next auto-step (0-1).
   * Useful for a countdown/progress ring UI.
   * @returns {number}
   */
  getProgress() {
    if (!this._active) return 0;
    return Math.min(1, this._elapsed / this._interval);
  }

  // ---- Serialization ----

  getConfig() {
    return {
      interval: this._interval,
      intensity: this._intensity,
      active: this._active,
    };
  }

  setConfig(config) {
    if (config.interval != null) this.setInterval(config.interval);
    if (config.intensity != null) this.setIntensity(config.intensity);
    // Note: we don't auto-start from config — caller decides
  }

  // ---- Internal ----

  _fireExplore(zoomLevel) {
    if (!this._callback) return;
    // Scale intensity by zoom: zoomed in = gentler, zoomed out = bigger leaps
    const scaledIntensity = this._intensity * Math.max(0.05, zoomLevel);
    this._callback({ intensity: scaledIntensity });
  }
}

// ---- Utility ----
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
