/**
 * Gradient Flow Analysis — ported from playground/js/ui/gradient-flow.js
 *
 * Uses the weight-delta approach: snapshot weights before/after training,
 * compute per-layer L2 norm of the delta.  No WASM changes needed.
 *
 * @module gradient-flow
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** If next layer's norm < VANISHING_RATIO * previous, it's vanishing */
const VANISHING_RATIO = 0.5;

/** If next layer's norm > EXPLODING_RATIO * previous, it's exploding */
const EXPLODING_RATIO = 2.0;

/** If all gradient norms are below this, network has converged */
const CONVERGED_THRESHOLD = 1e-6;

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const COLOR_HEALTHY   = { r: 100, g: 200, b: 120 } as const;
export const COLOR_WARNING   = { r: 230, g: 200, b: 60  } as const;
export const COLOR_DANGER    = { r: 240, g: 80,  b: 60  } as const;
export const COLOR_CONVERGED = { r: 100, g: 140, b: 200 } as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GradientFlowStatus = 'healthy' | 'vanishing' | 'exploding' | 'converged';

export interface GradientFlowLayer {
  /** Human-readable label e.g. "L1 (2→32)" */
  name: string;
  /** L2 norm of the weight delta for this layer */
  gradientNorm: number;
  /** Norm relative to the layer with highest norm — in [0, 1] */
  relativeFlow: number;
}

export interface GradientFlow {
  layers: GradientFlowLayer[];
  status: GradientFlowStatus;
}

// ---------------------------------------------------------------------------
// GradientFlowIndicator
// ---------------------------------------------------------------------------

export class GradientFlowIndicator {
  private readonly _layerSizes: number[];
  private readonly _numLayers: number;
  private readonly _layerWeightCounts: number[];
  private readonly _layerOffsets: number[];
  private readonly _totalWeights: number;
  private readonly _layerLabels: string[];

  private _beforeWeights: Float32Array | null = null;
  private _afterWeights: Float32Array | null = null;
  private _flow: GradientFlow | null = null;

  /**
   * @param layerSizes — e.g. [2, 32, 48, 64, 20] (inputs + hidden + outputs)
   */
  constructor(layerSizes: number[]) {
    this._layerSizes = layerSizes;
    this._numLayers = layerSizes.length - 1; // number of weight matrices

    // Per-layer weight counts: layer i has layerSizes[i] * layerSizes[i+1] weights + layerSizes[i+1] biases
    this._layerWeightCounts = [];
    this._layerOffsets = [];
    let offset = 0;
    for (let i = 0; i < this._numLayers; i++) {
      const count = layerSizes[i] * layerSizes[i + 1] + layerSizes[i + 1];
      this._layerWeightCounts.push(count);
      this._layerOffsets.push(offset);
      offset += count;
    }
    this._totalWeights = offset;

    // Build layer labels
    this._layerLabels = [];
    for (let i = 0; i < this._numLayers; i++) {
      this._layerLabels.push(i === this._numLayers - 1 ? 'Out' : `L${i + 1}`);
    }
  }

  get totalWeights(): number {
    return this._totalWeights;
  }

  /**
   * Capture weight snapshot before training.
   *
   * @param weightsArray — flat array of all weights
   */
  captureBeforeTrain(weightsArray: number[] | Float32Array): void {
    if (!weightsArray) return;
    this._beforeWeights =
      weightsArray instanceof Float32Array
        ? new Float32Array(weightsArray)
        : new Float32Array(weightsArray);
  }

  /**
   * Capture weight snapshot after training and compute gradient flow.
   *
   * @param weightsArray — flat array of all weights
   */
  captureAfterTrain(weightsArray: number[] | Float32Array): void {
    if (!weightsArray || !this._beforeWeights) return;

    this._afterWeights =
      weightsArray instanceof Float32Array
        ? weightsArray
        : new Float32Array(weightsArray);

    this._computeFlow();
  }

  /** Get per-layer gradient flow info, or null if not yet computed. */
  getFlow(): GradientFlow | null {
    return this._flow;
  }

  /**
   * Draw per-layer gradient flow bars to a canvas context.
   *
   * @param ctx — 2D rendering context
   * @param x — left edge
   * @param y — top edge
   * @param width — total width
   * @param height — total height
   */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
    if (!this._flow) {
      ctx.fillStyle = 'rgba(60, 60, 60, 0.4)';
      ctx.fillRect(x, y, width, height);
      ctx.font = '8px monospace';
      ctx.fillStyle = 'rgba(120, 120, 120, 0.6)';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText('no grad data', x + width / 2, y + height / 2);
      return;
    }

    const { layers, status } = this._flow;
    const n = layers.length;
    if (n === 0) return;

    // Background
    ctx.fillStyle = 'rgba(20, 20, 20, 0.6)';
    ctx.fillRect(x, y, width, height);

    const labelHeight = 12;
    const barAreaHeight = height - labelHeight - 2;
    const barWidth = Math.floor((width - 4) / n);
    const startX = x + 2 + (width - 4 - barWidth * n) / 2;

    for (let i = 0; i < n; i++) {
      const layer = layers[i];
      const barH = Math.max(1, layer.relativeFlow * barAreaHeight);
      const bx = startX + i * barWidth;
      const by = y + barAreaHeight - barH + 1;

      let color: { r: number; g: number; b: number };
      if (status === 'converged') {
        color = COLOR_CONVERGED;
      } else if (layer.relativeFlow < 0.15 && i > 0) {
        color = COLOR_DANGER; // vanishing at this layer
      } else if (layer.relativeFlow > 0.85 && i === n - 1 && n > 1) {
        color = COLOR_WARNING; // potential explosion
      } else {
        color = COLOR_HEALTHY;
      }

      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.75)`;
      ctx.fillRect(bx + 1, by, barWidth - 2, barH);

      // Layer label
      ctx.font = '7px monospace';
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.7)`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      ctx.fillText(this._layerLabels[i], bx + barWidth / 2, y + barAreaHeight + 2);
    }

    // Status label at top-left
    ctx.font = '8px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    let statusColor: { r: number; g: number; b: number };
    if (status === 'healthy') statusColor = COLOR_HEALTHY;
    else if (status === 'vanishing') statusColor = COLOR_DANGER;
    else if (status === 'exploding') statusColor = COLOR_WARNING;
    else statusColor = COLOR_CONVERGED;

    ctx.fillStyle = `rgba(${statusColor.r}, ${statusColor.g}, ${statusColor.b}, 0.8)`;
    ctx.fillText(`G: ${status}`, x + 2, y + 1);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private _computeFlow(): void {
    const before = this._beforeWeights;
    const after = this._afterWeights;

    if (!before || !after || before.length !== after.length) {
      this._flow = null;
      return;
    }

    const layers: GradientFlowLayer[] = [];
    const norms: number[] = [];

    for (let li = 0; li < this._numLayers; li++) {
      const offset = this._layerOffsets[li];
      const count = this._layerWeightCounts[li];

      // Compute L2 norm of weight delta for this layer
      let sumSq = 0;
      for (let j = 0; j < count; j++) {
        const idx = offset + j;
        if (idx < before.length && idx < after.length) {
          const delta = after[idx] - before[idx];
          sumSq += delta * delta;
        }
      }
      const norm = Math.sqrt(sumSq);
      norms.push(norm);

      layers.push({
        name: `${this._layerLabels[li]} (${this._layerSizes[li]}\u2192${this._layerSizes[li + 1]})`,
        gradientNorm: norm,
        relativeFlow: 0, // filled in below
      });
    }

    // Normalize to max norm
    const maxNorm = Math.max(...norms, 1e-12);
    for (let i = 0; i < layers.length; i++) {
      layers[i].relativeFlow = norms[i] / maxNorm;
    }

    // Determine overall status
    let status: GradientFlowStatus = 'healthy';

    if (norms.every(n => n < CONVERGED_THRESHOLD)) {
      status = 'converged';
    } else if (norms.length >= 2) {
      let vanishing = true;
      let exploding = true;

      for (let i = 1; i < norms.length; i++) {
        const prev = norms[i - 1];
        const curr = norms[i];

        if (prev <= CONVERGED_THRESHOLD) {
          vanishing = false;
          exploding = false;
          break;
        }

        const ratio = curr / prev;
        if (ratio >= VANISHING_RATIO) vanishing = false;
        if (ratio <= EXPLODING_RATIO) exploding = false;
      }

      if (vanishing) status = 'vanishing';
      else if (exploding) status = 'exploding';
    }

    this._flow = { layers, status };
  }
}
