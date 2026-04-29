/**
 * Heatmap sampler — samples MLP across a 2D input window, reduces outputs
 * to a scalar per cell.
 *
 * Three color modes:
 *   - 'luminance' → mean output magnitude
 *   - 'variance'  → output variance
 *   - 'divergence' → distance from a reference (center) output
 *
 * Sampler is throttled: `update` no-ops if called more than once per
 * `MIN_INTERVAL_MS`. Caller drives updates via `coreBus.on('ml.delta_update')`
 * and `coreBus.on('ml.trained')` events plus the input `zoom` accessor.
 *
 * The sampler returns a `Float32Array` of length `resolution * resolution`
 * directly consumable by the `Heatmap` primitive. Stale grid values stay
 * around between updates so the canvas doesn't blank.
 */

import { mlStore } from '../stores/ml-store';

export type HeatmapColorMode = 'luminance' | 'variance' | 'divergence';

const MIN_INTERVAL_MS = 200; // 5 updates / sec

export interface HeatmapSamplerOptions {
  /** Grid size N×N. Default 16. */
  resolution?: number;
  /** Initial color mode. */
  colorMode?: HeatmapColorMode;
}

export interface HeatmapWindow {
  /** Anchor point in input space [0,1]. */
  cx: number;
  cy: number;
  /** Side length of the sampled window (zoom level). */
  zoom: number;
}

export class HeatmapSampler {
  resolution: number;
  colorMode: HeatmapColorMode;
  private cells: Float32Array;
  private lastSampleMs = 0;
  private pending = false;

  constructor(opts: HeatmapSamplerOptions = {}) {
    this.resolution = Math.max(2, Math.min(64, opts.resolution ?? 16));
    this.colorMode = opts.colorMode ?? 'luminance';
    this.cells = new Float32Array(this.resolution * this.resolution);
  }

  /** Current grid for binding to the Heatmap primitive. */
  getCells(): Float32Array {
    return this.cells;
  }

  setColorMode(mode: HeatmapColorMode): void {
    this.colorMode = mode;
  }

  setResolution(n: number): void {
    const r = Math.max(2, Math.min(64, n | 0));
    if (r === this.resolution) return;
    this.resolution = r;
    this.cells = new Float32Array(r * r);
  }

  /**
   * Refresh the grid. Throttled to MIN_INTERVAL_MS.
   *
   * Returns `true` if a fresh sample was taken, `false` if throttled.
   * Reads MLP via `mlStore.inferBatch` (no-op if WASM not ready).
   */
  update(window: HeatmapWindow, force: boolean = false): boolean {
    const now = performance.now();
    if (!force && now - this.lastSampleMs < MIN_INTERVAL_MS) {
      this.pending = true;
      return false;
    }
    this.lastSampleMs = now;
    this.pending = false;

    const N = this.resolution;
    const total = N * N;
    const points: Array<readonly [number, number]> = new Array(total);

    const z = Math.max(0.01, Math.min(1, window.zoom));
    const half = z * 0.5;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = N > 1 ? x / (N - 1) : 0.5;
        const v = N > 1 ? y / (N - 1) : 0.5;
        const px = window.cx + (u - 0.5) * z; // could go negative; the sampler clamps
        const py = window.cy + (v - 0.5) * z;
        points[y * N + x] = [
          Math.max(0, Math.min(1, px)),
          Math.max(0, Math.min(1, py)),
        ];
        // Note: we'd love to compute half-based bounds but the existing input
        // pipeline already clamps, so just clamp here.
        void half;
      }
    }

    const flat = mlStore.inferBatch(points);
    if (flat.length === 0) {
      // WASM not ready — cells remain at last value.
      return false;
    }
    const outSize = mlStore.state.outputSize;

    // Reduce per cell.
    let referenceMean = 0;
    if (this.colorMode === 'divergence') {
      // Reference = center cell (closest to N/2, N/2).
      const cy = Math.floor(N / 2);
      const cx = Math.floor(N / 2);
      const base = (cy * N + cx) * outSize;
      let sum = 0;
      for (let i = 0; i < outSize; i++) sum += flat[base + i] ?? 0;
      referenceMean = sum / outSize;
    }

    for (let i = 0; i < total; i++) {
      const base = i * outSize;
      let sum = 0;
      let sumSq = 0;
      for (let j = 0; j < outSize; j++) {
        const v = flat[base + j] ?? 0;
        sum += v;
        sumSq += v * v;
      }
      const mean = sum / outSize;
      const variance = Math.max(0, sumSq / outSize - mean * mean);
      switch (this.colorMode) {
        case 'luminance':
          this.cells[i] = mean;
          break;
        case 'variance':
          this.cells[i] = variance;
          break;
        case 'divergence':
          this.cells[i] = Math.abs(mean - referenceMean);
          break;
      }
    }
    return true;
  }

  /** True if a call is queued behind throttling. */
  hasPendingUpdate(): boolean {
    return this.pending;
  }

  reset(): void {
    this.cells.fill(0);
    this.lastSampleMs = 0;
  }
}
