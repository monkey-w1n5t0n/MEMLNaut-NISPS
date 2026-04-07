/**
 * Weight Health Analysis — ported from playground/js/ui/weight-health.js
 *
 * Analyzes a flat weight array and produces health status + compact histogram.
 * Call update() periodically (not every frame) with the current flat weights.
 *
 * @module weight-health
 */

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Weight magnitude below this is considered "dead" */
export const DEAD_THRESHOLD = 0.01;

/** Weight magnitude above this drives sigmoid >99% saturated */
export const SATURATING_THRESHOLD = 3.0;

/** If more than this fraction of weights are dead, status = 'dead' */
const DEAD_FRACTION_LIMIT = 0.30;

/** If more than this fraction of weights are saturating, status = 'saturating' */
const SATURATED_FRACTION_LIMIT = 0.40;

/** Number of histogram bins for weight magnitude distribution */
export const HISTOGRAM_BINS = 10;

/** Histogram bin range: [0, MAX_HISTOGRAM_MAG] */
export const MAX_HISTOGRAM_MAG = 5.0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WeightHealth = 'healthy' | 'saturating' | 'dead';

export interface WeightHealthStatus {
  health: WeightHealth;
  meanMagnitude: number;
  maxMagnitude: number;
  deadFraction: number;
  saturatedFraction: number;
  /** Normalized histogram — HISTOGRAM_BINS elements, each in [0, 1] */
  histogram: number[];
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const COLOR_HEALTHY    = { r: 100, g: 200, b: 120 } as const;
export const COLOR_SATURATING = { r: 255, g: 120, b: 40  } as const;
export const COLOR_DEAD       = { r: 120, g: 120, b: 120 } as const;

// ---------------------------------------------------------------------------
// WeightHealthIndicator
// ---------------------------------------------------------------------------

export class WeightHealthIndicator {
  private _status: WeightHealthStatus | null = null;
  private _pulsePhase = 0;

  /**
   * Update from current flat weights. Call periodically (e.g. every 500 ms).
   *
   * @param weightsArray — flat array of all network weights
   */
  update(weightsArray: number[] | Float32Array): void {
    if (!weightsArray || weightsArray.length === 0) {
      this._status = null;
      return;
    }

    const n = weightsArray.length;
    let sumMag = 0;
    let maxMag = 0;
    let deadCount = 0;
    let saturatedCount = 0;

    const histogram = new Array<number>(HISTOGRAM_BINS).fill(0);
    const binWidth = MAX_HISTOGRAM_MAG / HISTOGRAM_BINS;

    for (let i = 0; i < n; i++) {
      const mag = Math.abs(weightsArray[i]);
      sumMag += mag;
      if (mag > maxMag) maxMag = mag;

      if (mag < DEAD_THRESHOLD) deadCount++;
      if (mag > SATURATING_THRESHOLD) saturatedCount++;

      const bin = Math.min(Math.floor(mag / binWidth), HISTOGRAM_BINS - 1);
      histogram[bin]++;
    }

    const meanMagnitude = sumMag / n;
    const deadFraction = deadCount / n;
    const saturatedFraction = saturatedCount / n;

    // Normalize histogram to fractions
    for (let i = 0; i < HISTOGRAM_BINS; i++) {
      histogram[i] /= n;
    }

    let health: WeightHealth;
    if (deadFraction > DEAD_FRACTION_LIMIT) {
      health = 'dead';
    } else if (saturatedFraction > SATURATED_FRACTION_LIMIT) {
      health = 'saturating';
    } else {
      health = 'healthy';
    }

    this._status = {
      health,
      meanMagnitude,
      maxMagnitude: maxMag,
      deadFraction,
      saturatedFraction,
      histogram,
    };
  }

  /** Get the current health status, or null if never updated. */
  getStatus(): WeightHealthStatus | null {
    return this._status;
  }

  /**
   * Draw the compact ambient histogram to a canvas context.
   *
   * @param ctx — 2D rendering context
   * @param x — left edge
   * @param y — top edge
   * @param width — total width
   * @param height — total height
   */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
    if (!this._status) {
      ctx.fillStyle = 'rgba(60, 60, 60, 0.4)';
      ctx.fillRect(x, y, width, height);
      return;
    }

    const { health, deadFraction, saturatedFraction, histogram } = this._status;

    // Advance pulse phase
    this._pulsePhase += 0.04;

    let color: { r: number; g: number; b: number };
    let glowAlpha: number;
    let pulseAmount = 0;

    if (health === 'healthy') {
      color = COLOR_HEALTHY;
      glowAlpha = 0.6 + 0.15 * Math.sin(this._pulsePhase * 0.3);
      pulseAmount = 0;
    } else if (health === 'saturating') {
      color = COLOR_SATURATING;
      glowAlpha = 0.7;
      pulseAmount = 0.25 * (0.5 + 0.5 * Math.sin(this._pulsePhase * 1.5));
    } else {
      // dead
      color = COLOR_DEAD;
      glowAlpha = 0.3;
      pulseAmount = 0;
    }

    const alpha = glowAlpha + pulseAmount;

    // Background
    ctx.fillStyle = 'rgba(20, 20, 20, 0.6)';
    ctx.fillRect(x, y, width, height);

    // Draw mini histogram bars
    const barWidth = width / HISTOGRAM_BINS;
    const maxBinVal = Math.max(...histogram, 0.01);

    for (let i = 0; i < HISTOGRAM_BINS; i++) {
      const barH = (histogram[i] / maxBinVal) * height;
      const bx = x + i * barWidth;
      const by = y + height - barH;

      // Color gradient: low-magnitude bins lean dead, high-magnitude bins lean saturating
      const t = i / (HISTOGRAM_BINS - 1);
      let r: number, g: number, b: number;

      if (t < 0.3) {
        const lt = t / 0.3;
        r = COLOR_DEAD.r + (color.r - COLOR_DEAD.r) * lt;
        g = COLOR_DEAD.g + (color.g - COLOR_DEAD.g) * lt;
        b = COLOR_DEAD.b + (color.b - COLOR_DEAD.b) * lt;
      } else if (t > 0.7) {
        const lt = (t - 0.7) / 0.3;
        r = color.r + (COLOR_SATURATING.r - color.r) * lt;
        g = color.g + (COLOR_SATURATING.g - color.g) * lt;
        b = color.b + (COLOR_SATURATING.b - color.b) * lt;
      } else {
        r = color.r;
        g = color.g;
        b = color.b;
      }

      ctx.fillStyle = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha.toFixed(2)})`;
      ctx.fillRect(bx, by, barWidth - 1, barH);
    }

    // Top glow line
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${(alpha * 0.8).toFixed(2)})`;
    ctx.fillRect(x, y, width, 1);

    // Status label
    ctx.font = '8px monospace';
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${(alpha * 0.9).toFixed(2)})`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const label =
      health === 'healthy'
        ? 'W: ok'
        : health === 'saturating'
          ? `W: sat ${(saturatedFraction * 100).toFixed(0)}%`
          : `W: dead ${(deadFraction * 100).toFixed(0)}%`;

    ctx.fillText(label, x + 2, y + 1);
  }
}
