/**
 * InputHeatmap — 2D color field on the joy-map showing what the network
 * produces across the entire input space.
 *
 * Samples the MLP at a 16x16 grid of input points, reduces each output
 * vector to a scalar, and renders as a background layer on a canvas.
 *
 * Three color modes:
 *   - luminance:  mean output -> brightness (shows "loud" vs "quiet" regions)
 *   - variance:   output variance -> saturation (shows "interesting" vs "flat")
 *   - divergence: euclidean distance from center output (how each region diverges)
 *
 * Performance: 16x16 = 256 inferences per update. Uses inferBatch for a
 * single WASM call. Throttled to max 5 updates/sec (200ms minimum between
 * updates).
 *
 * Color palette: dark blue/purple → amber → near-white warm.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_RESOLUTION = 16;
export const MIN_RESOLUTION = 4;
export const MAX_RESOLUTION = 32;
export const DEFAULT_THROTTLE = 200; // ms (5 updates/sec max)
export const DEFAULT_OPACITY = 0.55;

export type ColorMode = 'luminance' | 'variance' | 'divergence';
export const COLOR_MODES: ColorMode[] = ['luminance', 'variance', 'divergence'];

// ─── Color palette ────────────────────────────────────────────────────────────
// Dark-to-warm gradient: dark blue/purple → amber → near-white warm.
// Pre-computed HSL stops for linear interpolation.

interface HSLStop {
  h: number;
  s: number;
  l: number;
}

const PALETTE: HSLStop[] = [
  { h: 260, s: 60, l: 8 },   // 0.0 — very dark purple
  { h: 250, s: 65, l: 18 },  // 0.2 — deep blue-purple
  { h: 220, s: 55, l: 30 },  // 0.4 — medium blue
  { h: 35,  s: 80, l: 45 },  // 0.6 — warm amber
  { h: 38,  s: 90, l: 60 },  // 0.8 — bright amber
  { h: 42,  s: 95, l: 85 },  // 1.0 — near-white warm
];

function samplePalette(t: number): HSLStop {
  const clamped = Math.max(0, Math.min(1, t));
  const idx = clamped * (PALETTE.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, PALETTE.length - 1);
  const frac = idx - lo;

  const a = PALETTE[lo];
  const b = PALETTE[hi];
  return {
    h: a.h + (b.h - a.h) * frac,
    s: a.s + (b.s - a.s) * frac,
    l: a.l + (b.l - a.l) * frac,
  };
}

function hslToRGB(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
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

// ─── Utilities ────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ─── ZoomWindow ───────────────────────────────────────────────────────────────

export interface ZoomWindow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface HeatmapConfig {
  enabled?: boolean;
  resolution?: number;
  colorMode?: ColorMode;
  throttle?: number;
  opacity?: number;
}

// ─── InputHeatmap ─────────────────────────────────────────────────────────────

/**
 * Platform-agnostic heatmap computation and rendering class.
 *
 * Rendering is handled via a plain OffscreenCanvas so the class works in both
 * browser main thread and worker contexts.
 *
 * Usage:
 *   const heatmap = new InputHeatmap();
 *   heatmap.setEnabled(true);
 *
 *   // On each animation frame (after weight update):
 *   heatmap.update((points) => mlStore.inferBatch(points), { zoomWindow });
 *
 *   // Draw into the joystick canvas:
 *   heatmap.draw(ctx, canvas.width, canvas.height, zoomWindow);
 */
export class InputHeatmap {
  private _resolution: number;
  private _colorMode: ColorMode;
  private _throttle: number;
  private _opacity: number;
  private _enabled: boolean;
  private _lastUpdate: number;

  // Cached heatmap data
  private _grid: Float32Array | null = null;
  private _gridWindow: ZoomWindow | null = null;
  private _gridRes: number = DEFAULT_RESOLUTION;
  private _imageData: ImageData | null = null;
  private _offscreen: OffscreenCanvas | null = null;
  private _offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

  // Center-point output cache (for divergence mode)
  private _centerOutput: number[] | null = null;

  constructor(options: HeatmapConfig = {}) {
    this._resolution = clamp(options.resolution ?? DEFAULT_RESOLUTION, MIN_RESOLUTION, MAX_RESOLUTION);
    this._colorMode = COLOR_MODES.includes(options.colorMode as ColorMode)
      ? (options.colorMode as ColorMode)
      : 'luminance';
    this._throttle = Math.max(50, options.throttle ?? DEFAULT_THROTTLE);
    this._opacity = Math.max(0, Math.min(1, options.opacity ?? DEFAULT_OPACITY));
    this._enabled = options.enabled ?? false;
    this._lastUpdate = 0;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Recompute the heatmap.
   *
   * @param inferBatchFn - Takes array of [x,y] pairs, returns array of output arrays.
   *   Use mlStore.inferBatch for an efficient single WASM call.
   * @param options.zoomWindow - Visible input subregion { x1, y1, x2, y2 } in [0,1].
   *   When provided, only that subregion is sampled (zoom-aware resampling).
   * @param options.resolution - Override grid resolution for this update.
   */
  update(
    inferBatchFn: (points: number[][]) => number[][],
    options: {
      zoomWindow?: ZoomWindow;
      resolution?: number;
    } = {}
  ): void {
    if (!this._enabled) return;

    const now = performance.now();
    if (now - this._lastUpdate < this._throttle) return;
    this._lastUpdate = now;

    const res = clamp(options.resolution ?? this._resolution, MIN_RESOLUTION, MAX_RESOLUTION);
    const zw: ZoomWindow = options.zoomWindow ?? { x1: 0, y1: 0, x2: 1, y2: 1 };

    const needsCenter = this._colorMode === 'divergence';
    const points: number[][] = [];

    // In divergence mode, prepend center point as first in batch
    if (needsCenter) {
      const cx = (zw.x1 + zw.x2) / 2;
      const cy = (zw.y1 + zw.y2) / 2;
      points.push([cx, cy]);
    }

    // Grid points — row-major, y=0 is bottom of input space
    for (let gy = 0; gy < res; gy++) {
      for (let gx = 0; gx < res; gx++) {
        const inputX = zw.x1 + (gx + 0.5) / res * (zw.x2 - zw.x1);
        const inputY = zw.y1 + (gy + 0.5) / res * (zw.y2 - zw.y1);
        points.push([inputX, inputY]);
      }
    }

    const allOutputs = inferBatchFn(points);

    let outputs: number[][];
    if (needsCenter) {
      this._centerOutput = allOutputs[0] ?? null;
      outputs = allOutputs.slice(1);
    } else {
      outputs = allOutputs;
    }

    // Reduce each output vector to a scalar
    const grid = new Float32Array(res * res);
    let minVal = Infinity;
    let maxVal = -Infinity;

    for (let i = 0; i < outputs.length; i++) {
      const val = this._reduceOutput(outputs[i]);
      grid[i] = val;
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
    }

    // Normalize to [0,1] for palette mapping
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

    this._buildImageData(res);
  }

  /**
   * Draw the heatmap onto a canvas context as a background layer.
   * Call before other canvas layers so it appears underneath.
   *
   * @param ctx - 2D rendering context of the target canvas
   * @param canvasWidth - canvas width in pixels
   * @param canvasHeight - canvas height in pixels
   */
  draw(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    if (!this._enabled || !this._imageData) return;

    const res = this._gridRes;

    // Recreate offscreen canvas if resolution changed
    if (!this._offscreen || this._offscreen.width !== res || this._offscreen.height !== res) {
      this._offscreen = new OffscreenCanvas(res, res);
      this._offscreenCtx = this._offscreen.getContext('2d') as OffscreenCanvasRenderingContext2D;
    }

    this._offscreenCtx!.putImageData(this._imageData, 0, 0);

    // Map heatmap grid window to canvas pixel rect.
    // Canvas Y is inverted (y=0 is top, but our y1 is bottom of input space).
    const gw = this._gridWindow ?? { x1: 0, y1: 0, x2: 1, y2: 1 };
    const dx = gw.x1 * canvasWidth;
    const dy = (1 - gw.y2) * canvasHeight;
    const dw = (gw.x2 - gw.x1) * canvasWidth;
    const dh = (gw.y2 - gw.y1) * canvasHeight;

    ctx.save();
    ctx.globalAlpha = this._opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(this._offscreen, dx, dy, dw, dh);
    ctx.restore();
  }

  // ─── Color mode ─────────────────────────────────────────────────────────────

  setColorMode(mode: ColorMode): void {
    if (!COLOR_MODES.includes(mode)) return;
    this._colorMode = mode;
    // Invalidate so next update() recomputes
    this._grid = null;
    this._imageData = null;
  }

  getColorMode(): ColorMode {
    return this._colorMode;
  }

  cycleColorMode(): ColorMode {
    const idx = COLOR_MODES.indexOf(this._colorMode);
    const next = COLOR_MODES[(idx + 1) % COLOR_MODES.length];
    this.setColorMode(next);
    return next;
  }

  // ─── Toggle ─────────────────────────────────────────────────────────────────

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!this._enabled) {
      this._grid = null;
      this._imageData = null;
      this._centerOutput = null;
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  // ─── Configuration ──────────────────────────────────────────────────────────

  setThrottle(ms: number): void {
    this._throttle = Math.max(50, ms);
  }

  setResolution(res: number): void {
    this._resolution = clamp(res, MIN_RESOLUTION, MAX_RESOLUTION);
  }

  getResolution(): number {
    return this._resolution;
  }

  setOpacity(alpha: number): void {
    this._opacity = Math.max(0, Math.min(1, alpha));
  }

  /** Force a recompute on next update() call (clears throttle timer). */
  invalidate(): void {
    this._lastUpdate = 0;
  }

  // ─── Serialization ──────────────────────────────────────────────────────────

  getConfig(): Required<HeatmapConfig> {
    return {
      enabled: this._enabled,
      resolution: this._resolution,
      colorMode: this._colorMode,
      throttle: this._throttle,
      opacity: this._opacity,
    };
  }

  setConfig(config: HeatmapConfig): void {
    if (config.enabled != null)    this.setEnabled(config.enabled);
    if (config.resolution != null) this.setResolution(config.resolution);
    if (config.colorMode != null)  this.setColorMode(config.colorMode);
    if (config.throttle != null)   this.setThrottle(config.throttle);
    if (config.opacity != null)    this.setOpacity(config.opacity);
  }

  // ─── Private: reduction ─────────────────────────────────────────────────────

  private _reduceOutput(output: number[]): number {
    switch (this._colorMode) {
      case 'luminance':  return this._meanOutput(output);
      case 'variance':   return this._varianceOutput(output);
      case 'divergence': return this._divergenceOutput(output);
      default:           return this._meanOutput(output);
    }
  }

  /** Mean of all output values. */
  private _meanOutput(output: number[]): number {
    if (output.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < output.length; i++) sum += output[i];
    return sum / output.length;
  }

  /** Variance of output values (how "interesting" / spread out they are). */
  private _varianceOutput(output: number[]): number {
    if (output.length === 0) return 0;
    const mean = this._meanOutput(output);
    let sumSq = 0;
    for (let i = 0; i < output.length; i++) {
      const d = output[i] - mean;
      sumSq += d * d;
    }
    return sumSq / output.length;
  }

  /**
   * Euclidean distance from the center-point output, normalized by dimension.
   * Falls back to mean if center output is unavailable.
   */
  private _divergenceOutput(output: number[]): number {
    if (!this._centerOutput || this._centerOutput.length !== output.length) {
      return this._meanOutput(output);
    }
    let sumSq = 0;
    for (let i = 0; i < output.length; i++) {
      const d = output[i] - this._centerOutput[i];
      sumSq += d * d;
    }
    // Max possible distance for [0,1] outputs = sqrt(N); normalize by mean dim
    return Math.sqrt(sumSq / output.length);
  }

  // ─── Private: rendering ─────────────────────────────────────────────────────

  /** Build an ImageData from the normalized grid values. */
  private _buildImageData(res: number): void {
    if (!this._grid) return;

    this._imageData = new ImageData(res, res);
    const data = this._imageData.data;

    for (let gy = 0; gy < res; gy++) {
      for (let gx = 0; gx < res; gx++) {
        // Grid is stored bottom-to-top (y=0 is bottom of input space).
        // ImageData is top-to-bottom, so flip Y.
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
