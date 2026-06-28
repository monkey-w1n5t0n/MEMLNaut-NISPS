/**
 * Universal per-output baseline mapping (backends-spec §3). Every backend shares
 * ONE mapping from a normalised model output v ∈ [0,1] to a sink value, so
 * behaviour is identical across sinks and the override UI is backend-agnostic.
 *
 * `applyCurve` clamps the input to [0,1] BEFORE the pow (matching the deployed
 * `param-map.js:287` and the verification correction in backends-spec §"minor").
 */
import type { OutputMapping } from './backend';

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0.5 = linear; <0.5 ease-in, >0.5 ease-out. Input clamped to [0,1] first. */
export function applyCurve(v: number, c: number): number {
  const x = clamp01(v);
  if (c === 0.5) return x;
  return Math.pow(x, Math.pow(2, 4 * (c - 0.5)));
}

/**
 * Per-output baseline: curve, then scale into [min,max]. Honours freeze (fixed)
 * but NOT mute (mute is a sink-level skip, handled per backend so the value is
 * still computed/visible). Returns a value in [min,max].
 */
export function mapOutput(v: number, p: OutputMapping): number {
  if (p.state === 'fixed') {
    return p.min + clamp01(p.fixedValue) * (p.max - p.min);
  }
  return p.min + applyCurve(v, p.curve) * (p.max - p.min);
}

/** True when this output must NOT be emitted to the sink (off or muted). */
export function isSilent(p: OutputMapping): boolean {
  return p.state === 'off' || p.muted;
}
