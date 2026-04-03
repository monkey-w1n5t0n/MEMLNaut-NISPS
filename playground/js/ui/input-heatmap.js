/**
 * Input Space Heatmap — 2D color field on the joy-map showing what the
 * network produces across the entire input space.
 *
 * Samples the MLP at a grid of input points, reduces the output vector
 * to a color, and renders as a background layer on the joy-map canvas.
 *
 * Three color modes:
 *   - luminance:  mean output -> brightness (shows "loud" vs "quiet" regions)
 *   - variance:   output variance -> saturation (shows "interesting" vs "flat")
 *   - divergence: difference from center point output (how each region diverges)
 *
 * Performance: 16x16 = 256 inferences. When inferBatchFn is provided,
 * all points are evaluated in a single WASM call. Falls back to per-point
 * inferFn (~20us each = ~5ms). Throttled to max 5 updates/sec by default.
 *
 * @module input-heatmap
 */

// ---- Constants ----
const DEFAULT_RESOLUTION = 16;
const MIN_RESOLUTION = 4;
const MAX_RESOLUTION = 32;
const DEFAULT_THROTTLE = 200; // ms
const COLOR_MODES = ['luminance', 'variance', 'divergence'];

// ---- Color palette ----
// Dark-to-warm gradient: dark blue/purple -> amber -> white
// Pre-computed as HSL stops for fast interpolation
const PALETTE = [
  { h: 260, s: 60, l: 8 },   // 0.0 — very dark purple
  { h: 250, s: 65, l: 18 },  // 0.2 — deep blue-purple
  { h: 220, s: 55, l: 30 },  // 0.4 — medium blue
  { h: 35,  s: 80, l: 45 },  // 0.6 — warm amber
  { h: 38,  s: 90, l: 60 },  // 0.8 — bright amber
  { h: 42,  s: 95, l: 85 },  // 1.0 — near-white warm
];

function samplePalette(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const idx = clamped * (PALETTE.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, PALETTE.length - 1);
  const frac = idx - lo;

  const a = PALETTE[lo];
  const b = PALETTE[hi];
  const h = a.h + (b.h - a.h) * frac;
  const s = a.s + (b.s - a.s) * frac;
  const l = a.l + (b.l - a.l) * frac;
  return { h, s, l };
}

function hslToRGB(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export class InputHeatmap {
  /**
   * @param {object} [options]
   * @param {number} [options.resolution=16]    - grid points per axis
   * @param {string} [options.colorMode='luminance'] - 'luminance'|'variance'|'divergence'
   * @param {number} [options.throttle=200]     - min ms between recomputes
   * @param {number} [options.opacity=0.55]     - heatmap alpha
   */
  constructor(options = {}) {
    this._resolution = clamp(options.resolution ?? DEFAULT_RESOLUTION, MIN_RESOLUTION, MAX_RESOLUTION);
    this._colorMode = COLOR_MODES.includes(options.colorMode) ? options.colorMode : 'luminance';
    this._throttle = Math.max(50, options.throttle ?? DEFAULT_THROTTLE);
    this._opacity = Math.max(0, Math.min(1, options.opacity ?? 0.55));
    this._enabled = false;
    this._lastUpdate = 0;

    // Cached heatmap data: Float32Array of reduced values (resolution x resolution)
    this._grid = null;          // raw reduced values per cell
    this._gridWindow = null;    // zoom window used when computing this grid
    this._imageData = null;     // cached ImageData for rendering
    this._offscreen = null;     // offscreen canvas for compositing
    this._offscreenCtx = null;

    // Center-point output cache (for divergence mode)
    this._centerOutput = null;
  }

  // ---- Public API ----

  /**
   * Recompute the heatmap. Call on weight changes (train, randomize, moveWeights).
   *
   * @param {function} inferFn - (inputArray: number[]) => number[]
   *   Runs inference for a given 2D input. Must NOT corrupt the main inference state.
   * @param {object} [options]
   * @param {object} [options.zoomWindow] - { x1, y1, x2, y2 } in [0,1] space
   * @param {number} [options.resolution] - override resolution for this update
   * @param {function} [options.inferBatchFn] - (inputPoints: number[][]) => number[][]
   *   Batch inference: takes array of [x,y] pairs, returns array of output arrays.
   *   When provided, used instead of per-point inferFn for better performance.
   */
  update(inferFn, options = {}) {
    if (!this._enabled) return;

    const now = performance.now();
    if (now - this._lastUpdate < this._throttle) return;
    this._lastUpdate = now;

    const res = clamp(options.resolution ?? this._resolution, MIN_RESOLUTION, MAX_RESOLUTION);
    const zw = options.zoomWindow || { x1: 0, y1: 0, x2: 1, y2: 1 };
    const inferBatchFn = options.inferBatchFn || null;

    // Sample grid
    const grid = new Float32Array(res * res);
    let outputs;

    if (inferBatchFn) {
      // ---- Batch path: build all input points, call once ----
      const needsCenter = this._colorMode === 'divergence';
      const points = [];

      // If divergence mode, first point is the center
      if (needsCenter) {
        const cx = (zw.x1 + zw.x2) / 2;
        const cy = (zw.y1 + zw.y2) / 2;
        points.push([cx, cy]);
      }

      // Grid points
      for (let gy = 0; gy < res; gy++) {
        for (let gx = 0; gx < res; gx++) {
          const inputX = zw.x1 + (gx + 0.5) / res * (zw.x2 - zw.x1);
          const inputY = zw.y1 + (gy + 0.5) / res * (zw.y2 - zw.y1);
          points.push([inputX, inputY]);
        }
      }

      const allOutputs = inferBatchFn(points);

      if (needsCenter) {
        this._centerOutput = allOutputs[0];
        outputs = allOutputs.slice(1);
      } else {
        outputs = allOutputs;
      }
    } else {
      // ---- Per-point fallback path ----
      outputs = [];

      // Pre-compute center output for divergence mode
      if (this._colorMode === 'divergence') {
        const cx = (zw.x1 + zw.x2) / 2;
        const cy = (zw.y1 + zw.y2) / 2;
        this._centerOutput = inferFn([cx, cy]);
      }

      // Collect all outputs for normalization
      for (let gy = 0; gy < res; gy++) {
        for (let gx = 0; gx < res; gx++) {
          const inputX = zw.x1 + (gx + 0.5) / res * (zw.x2 - zw.x1);
          const inputY = zw.y1 + (gy + 0.5) / res * (zw.y2 - zw.y1);
          const out = inferFn([inputX, inputY]);
          outputs.push(out);
        }
      }
    }

    // Reduce outputs to scalar values based on color mode
    let minVal = Infinity;
    let maxVal = -Infinity;

    for (let i = 0; i < outputs.length; i++) {
      const val = this._reduceOutput(outputs[i]);
      grid[i] = val;
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
    }

    // Normalize to [0,1]
    const range = maxVal - minVal;
    if (range > 1e-8) {
      for (let i = 0; i < grid.length; i++) {
        grid[i] = (grid[i] - minVal) / range;
      }
    } else {
      grid.fill(0.5);
    }

    this._grid = grid;
    this._gridWindow = { ...zw };
    this._gridRes = res;

    // Build ImageData
    this._buildImageData(res);
  }

  /**
   * Draw the heatmap onto a canvas context as a background layer.
   * Should be called before other joy-map layers.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasWidth  - CSS pixel width
   * @param {number} canvasHeight - CSS pixel height
   * @param {object} [zoomWindow] - current zoom window { x1, y1, x2, y2 }
   */
  draw(ctx, canvasWidth, canvasHeight, zoomWindow) {
    if (!this._enabled || !this._imageData) return;

    const res = this._gridRes;
    if (!this._offscreen || this._offscreen.width !== res || this._offscreen.height !== res) {
      this._offscreen = new OffscreenCanvas(res, res);
      this._offscreenCtx = this._offscreen.getContext('2d');
    }

    this._offscreenCtx.putImageData(this._imageData, 0, 0);

    // Determine draw rect: if the heatmap was computed for a zoom window,
    // draw it into that region of the canvas
    const gw = this._gridWindow || { x1: 0, y1: 0, x2: 1, y2: 1 };

    // Canvas Y is inverted (y=0 is top, but our y1 is bottom of input space)
    const dx = gw.x1 * canvasWidth;
    const dy = (1 - gw.y2) * canvasHeight;
    const dw = (gw.x2 - gw.x1) * canvasWidth;
    const dh = (gw.y2 - gw.y1) * canvasHeight;

    ctx.save();
    ctx.globalAlpha = this._opacity;
    // Use bilinear interpolation for smooth gradients
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(this._offscreen, dx, dy, dw, dh);
    ctx.restore();
  }

  // ---- Color mode ----

  /**
   * Set the color reduction mode.
   * @param {string} mode - 'luminance' | 'variance' | 'divergence'
   */
  setColorMode(mode) {
    if (!COLOR_MODES.includes(mode)) return;
    this._colorMode = mode;
    // Invalidate cache so next update recomputes
    this._grid = null;
    this._imageData = null;
  }

  /** @returns {string} */
  getColorMode() { return this._colorMode; }

  /**
   * Cycle to next color mode.
   * @returns {string} the new mode
   */
  cycleColorMode() {
    const idx = COLOR_MODES.indexOf(this._colorMode);
    const next = COLOR_MODES[(idx + 1) % COLOR_MODES.length];
    this.setColorMode(next);
    return next;
  }

  // ---- Toggle ----

  /** @param {boolean} enabled */
  setEnabled(enabled) {
    this._enabled = !!enabled;
    if (!this._enabled) {
      this._grid = null;
      this._imageData = null;
    }
  }

  /** @returns {boolean} */
  get enabled() { return this._enabled; }

  // ---- Configuration ----

  /** @param {number} ms - minimum time between recomputes */
  setThrottle(ms) {
    this._throttle = Math.max(50, ms);
  }

  /** @param {number} res - grid points per axis (4-32) */
  setResolution(res) {
    this._resolution = clamp(res, MIN_RESOLUTION, MAX_RESOLUTION);
  }

  /** @returns {number} */
  getResolution() { return this._resolution; }

  /** @param {number} alpha - 0-1 */
  setOpacity(alpha) {
    this._opacity = Math.max(0, Math.min(1, alpha));
  }

  /**
   * Force a recompute on next update() call (clears throttle timer).
   */
  invalidate() {
    this._lastUpdate = 0;
  }

  // ---- Serialization ----

  getConfig() {
    return {
      enabled: this._enabled,
      resolution: this._resolution,
      colorMode: this._colorMode,
      throttle: this._throttle,
      opacity: this._opacity,
    };
  }

  setConfig(config) {
    if (config.enabled != null) this.setEnabled(config.enabled);
    if (config.resolution != null) this.setResolution(config.resolution);
    if (config.colorMode != null) this.setColorMode(config.colorMode);
    if (config.throttle != null) this.setThrottle(config.throttle);
    if (config.opacity != null) this.setOpacity(config.opacity);
  }

  // ---- Internal ----

  /**
   * Reduce an output vector to a single scalar based on color mode.
   */
  _reduceOutput(output) {
    switch (this._colorMode) {
      case 'luminance':
        return this._meanOutput(output);
      case 'variance':
        return this._varianceOutput(output);
      case 'divergence':
        return this._divergenceOutput(output);
      default:
        return this._meanOutput(output);
    }
  }

  /** Mean of all outputs. */
  _meanOutput(output) {
    let sum = 0;
    for (let i = 0; i < output.length; i++) sum += output[i];
    return sum / output.length;
  }

  /** Variance of outputs (how "interesting" / spread out the values are). */
  _varianceOutput(output) {
    const mean = this._meanOutput(output);
    let sumSq = 0;
    for (let i = 0; i < output.length; i++) {
      const d = output[i] - mean;
      sumSq += d * d;
    }
    return sumSq / output.length;
  }

  /** Euclidean distance from center-point output (normalized by dimension). */
  _divergenceOutput(output) {
    if (!this._centerOutput || this._centerOutput.length !== output.length) {
      return this._meanOutput(output);
    }
    let sumSq = 0;
    for (let i = 0; i < output.length; i++) {
      const d = output[i] - this._centerOutput[i];
      sumSq += d * d;
    }
    // Normalize: max possible distance for [0,1] outputs = sqrt(N)
    return Math.sqrt(sumSq / output.length);
  }

  /**
   * Build an ImageData from the normalized grid values.
   */
  _buildImageData(res) {
    if (!this._grid) return;

    this._imageData = new ImageData(res, res);
    const data = this._imageData.data;

    for (let gy = 0; gy < res; gy++) {
      for (let gx = 0; gx < res; gx++) {
        // Grid is stored bottom-to-top (y=0 is bottom of input space)
        // ImageData is top-to-bottom, so flip Y
        const gridIdx = (res - 1 - gy) * res + gx;
        const val = this._grid[gridIdx];

        const { h, s, l } = samplePalette(val);
        const { r, g, b } = hslToRGB(h, s, l);

        const pixIdx = (gy * res + gx) * 4;
        data[pixIdx + 0] = r;
        data[pixIdx + 1] = g;
        data[pixIdx + 2] = b;
        data[pixIdx + 3] = 255;
      }
    }
  }
}

// ---- Utility ----
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
