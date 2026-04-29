/**
 * Weight health + gradient flow analysis.
 *
 * Pure functions over Float32Array weight buffers and `LayerStats[]` from
 * the WasmIML. Mode UI binds these to the WeightHealth and GradientFlow
 * primitives.
 */

import type { LayerStats } from '../ml/types';
import type { WeightStatus } from '../primitives/WeightHealth';
import type { GradientStatus } from '../primitives/GradientFlow';

const HISTOGRAM_BINS = 10;
/** Magnitude bin edges: [0, 0.01, 0.05, 0.15, 0.4, 0.8, 1.5, 2.5, 4, 7, ∞] */
const BIN_EDGES = [0, 0.01, 0.05, 0.15, 0.4, 0.8, 1.5, 2.5, 4, 7];

/** Build a 10-bin histogram of weight magnitudes from a flat weight array. */
export function weightHistogram(weights: Float32Array): number[] {
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
  if (weights.length === 0) return bins;
  for (let i = 0; i < weights.length; ++i) {
    const m = Math.abs(weights[i]!);
    let bin = HISTOGRAM_BINS - 1;
    for (let b = 0; b < HISTOGRAM_BINS - 1; ++b) {
      if (m < BIN_EDGES[b + 1]!) {
        bin = b;
        break;
      }
    }
    bins[bin]++;
  }
  return bins;
}

/** Determine overall network health status. */
export function weightStatus(weights: Float32Array): WeightStatus {
  if (weights.length === 0) return 'healthy';
  let dead = 0;
  let saturating = 0;
  for (let i = 0; i < weights.length; ++i) {
    const m = Math.abs(weights[i]!);
    if (m < 0.01) dead++;
    else if (m > 3.0) saturating++;
  }
  const deadFrac = dead / weights.length;
  const satFrac = saturating / weights.length;
  if (satFrac > 0.4) return 'saturating';
  if (deadFrac > 0.3) return 'dead';
  return 'healthy';
}

/**
 * Per-layer L2 norm of weight delta (after - before). Used to populate
 * GradientFlow primitive.
 */
export function layerNorms(beforeWeights: Float32Array, afterWeights: Float32Array, layerSizes: ReadonlyArray<number>): number[] {
  const out: number[] = [];
  let offset = 0;
  for (const sz of layerSizes) {
    let sum = 0;
    const end = Math.min(beforeWeights.length, afterWeights.length, offset + sz);
    for (let i = offset; i < end; ++i) {
      const d = (afterWeights[i] ?? 0) - (beforeWeights[i] ?? 0);
      sum += d * d;
    }
    out.push(Math.sqrt(sum));
    offset += sz;
  }
  return out;
}

/**
 * Detect vanishing/exploding/converged gradient flow given per-layer norms.
 */
export function gradientStatuses(norms: ReadonlyArray<number>): GradientStatus[] {
  if (norms.length === 0) return [];
  // Converged check first: all near-zero.
  const allTiny = norms.every((n) => n < 1e-6);
  if (allTiny) return norms.map(() => 'converged' as GradientStatus);

  const out: GradientStatus[] = [];
  for (let i = 0; i < norms.length; ++i) {
    if (i === 0) {
      out.push('healthy');
      continue;
    }
    const prev = norms[i - 1] ?? 0;
    const curr = norms[i] ?? 0;
    if (prev <= 1e-12) {
      out.push('healthy');
    } else if (curr < 0.5 * prev) {
      out.push('vanishing');
    } else if (curr > 2.0 * prev) {
      out.push('exploding');
    } else {
      out.push('healthy');
    }
  }
  return out;
}

/**
 * Estimate per-layer weight count given an MLP architecture.
 *
 * MLP layout: layer i has weights = inputs * outputs + outputs (bias).
 * `[inputSize, ...hidden, outputSize]` — N+1 layer sizes, N layers.
 */
export function layerWeightCounts(arch: { inputSize: number; hidden: ReadonlyArray<number>; outputSize: number }): number[] {
  const sizes = [arch.inputSize, ...arch.hidden, arch.outputSize];
  const counts: number[] = [];
  for (let i = 0; i < sizes.length - 1; ++i) {
    const ins = sizes[i]!;
    const outs = sizes[i + 1]!;
    counts.push(ins * outs + outs);
  }
  return counts;
}

/** Map LayerStats to a healthy/dead/saturating per-layer status. */
export function layerStatsToStatus(stats: LayerStats): WeightStatus {
  if (stats.saturatingFrac > 0.4) return 'saturating';
  if (stats.deadFrac > 0.3) return 'dead';
  return 'healthy';
}
