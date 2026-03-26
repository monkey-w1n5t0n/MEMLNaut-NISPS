/**
 * Gradient Flow Indicator — per-layer gradient magnitude visualization.
 *
 * Uses the weight-delta approach: snapshot weights before training, snapshot after,
 * compute per-layer L2 norm of the delta. No WASM changes needed.
 *
 * @module gradient-flow
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ratio threshold: if next layer's gradient < VANISHING_RATIO * previous, it's vanishing */
const VANISHING_RATIO = 0.5;

/** Ratio threshold: if next layer's gradient > EXPLODING_RATIO * previous, it's exploding */
const EXPLODING_RATIO = 2.0;

/** Absolute threshold: if all gradient norms below this, network has converged */
const CONVERGED_THRESHOLD = 1e-6;

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COLOR_HEALTHY   = { r: 100, g: 200, b: 120 };
const COLOR_WARNING   = { r: 230, g: 200, b: 60 };
const COLOR_DANGER    = { r: 240, g: 80, b: 60 };
const COLOR_CONVERGED = { r: 100, g: 140, b: 200 };

// ---------------------------------------------------------------------------
// GradientFlowIndicator
// ---------------------------------------------------------------------------

export class GradientFlowIndicator {
  /**
   * @param {number[]} layerSizes — e.g. [3, 32, 48, 64, 126]
   */
  constructor(layerSizes) {
    this._layerSizes = layerSizes;
    this._numLayers = layerSizes.length - 1; // number of weight matrices

    // Compute per-layer weight counts: layer i has layerSizes[i] * layerSizes[i+1] weights + layerSizes[i+1] biases
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
      if (i === this._numLayers - 1) {
        this._layerLabels.push('Out');
      } else {
        this._layerLabels.push(`L${i + 1}`);
      }
    }

    // Weight snapshots
    this._beforeWeights = null;
    this._afterWeights = null;
    this._flow = null;
  }

  /**
   * Capture weight snapshot before training.
   * @param {number[]|Float32Array} weightsArray — flat array of all weights
   */
  captureBeforeTrain(weightsArray) {
    if (!weightsArray) return;
    this._beforeWeights = weightsArray instanceof Float32Array
      ? new Float32Array(weightsArray)
      : new Float32Array(weightsArray);
  }

  /**
   * Capture weight snapshot after training and compute gradient flow.
   * @param {number[]|Float32Array} weightsArray — flat array of all weights
   */
  captureAfterTrain(weightsArray) {
    if (!weightsArray || !this._beforeWeights) return;

    this._afterWeights = weightsArray instanceof Float32Array
      ? weightsArray
      : new Float32Array(weightsArray);

    this._computeFlow();
  }

  /**
   * Get per-layer gradient flow info.
   * @returns {object|null}
   */
  getFlow() {
    return this._flow;
  }

  /**
   * Draw per-layer gradient flow bars.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   */
  draw(ctx, x, y, width, height) {
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

      // Color based on per-layer health
      let color;
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

    // Status label at top
    ctx.font = '8px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    let statusColor;
    if (status === 'healthy') statusColor = COLOR_HEALTHY;
    else if (status === 'vanishing') statusColor = COLOR_DANGER;
    else if (status === 'exploding') statusColor = COLOR_WARNING;
    else statusColor = COLOR_CONVERGED;

    ctx.fillStyle = `rgba(${statusColor.r}, ${statusColor.g}, ${statusColor.b}, 0.8)`;
    ctx.fillText(`G: ${status}`, x + 2, y + 1);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  _computeFlow() {
    const before = this._beforeWeights;
    const after = this._afterWeights;

    if (!before || !after || before.length !== after.length) {
      this._flow = null;
      return;
    }

    const layers = [];
    const norms = [];

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
        relativeFlow: 0, // computed below
      });
    }

    // Compute relative flow (normalize to max)
    const maxNorm = Math.max(...norms, 1e-12);
    for (let i = 0; i < layers.length; i++) {
      layers[i].relativeFlow = norms[i] / maxNorm;
    }

    // Detect status
    let status = 'healthy';

    // Check convergence: all norms very small
    if (norms.every(n => n < CONVERGED_THRESHOLD)) {
      status = 'converged';
    } else if (norms.length >= 2) {
      // Check vanishing: each successive layer < VANISHING_RATIO of previous
      let vanishing = true;
      let exploding = true;

      for (let i = 1; i < norms.length; i++) {
        const prev = norms[i - 1];
        const curr = norms[i];

        if (prev <= CONVERGED_THRESHOLD) {
          // Can't assess ratio with near-zero denominator
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
