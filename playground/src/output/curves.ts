/**
 * Curve catalog — TypeScript mirror of the named curves from
 * nisps/core/math.hpp (forthcoming, stream 1). All inputs and outputs are in
 * [0, 1] unless noted otherwise.
 *
 * IMPORTANT: This file MUST stay in lockstep with the C++ side. The
 * authoritative reference is `nisps/core/math.hpp`. Golden-vector tests
 * (stream 11) compare WASM-computed vs TS-computed outputs and fail on
 * any drift.
 *
 * Architecture §5.3:
 *   linear, exp, log, square, sqrt, sigmoid, cubic, centered_power
 *
 * The "centered_power" variant comes from the legacy input/output pipelines
 * and shapes around 0.5 instead of 0.0. Kept as a named curve because both
 * input and output pipelines use it.
 */

export type CurveName =
  | 'linear'
  | 'exp'
  | 'log'
  | 'square'
  | 'sqrt'
  | 'sigmoid'
  | 'cubic'
  | 'centered_power';

/** Hard clamp to [0, 1]. */
export function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Generic clamp. */
export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Linear: identity. */
export function curveLinear(x: number): number {
  return clamp01(x);
}

/** Exponential: e^(k*x) - 1, normalized to [0,1] over [0,1] input. */
export function curveExp(x: number, k: number = 4.0): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const denom = Math.exp(k) - 1.0;
  if (denom === 0) return x;
  return (Math.exp(k * x) - 1.0) / denom;
}

/** Inverse of curveExp. */
export function curveLog(x: number, k: number = 4.0): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const denom = Math.exp(k) - 1.0;
  if (denom === 0) return x;
  return Math.log(1 + x * denom) / k;
}

/** Square: x^2. */
export function curveSquare(x: number): number {
  const v = clamp01(x);
  return v * v;
}

/** Square-root. */
export function curveSqrt(x: number): number {
  return Math.sqrt(clamp01(x));
}

/** Logistic sigmoid mapped onto [0,1] domain (centered at x=0.5). */
export function curveSigmoid(x: number, slope: number = 8.0): number {
  // Sigmoid centered at 0.5 with given slope. Output is in (0, 1).
  // Normalize so endpoints map exactly to 0 and 1.
  const t = (x - 0.5) * slope;
  const s = 1 / (1 + Math.exp(-t));
  // Anchor: when x=0, t=-slope/2; when x=1, t=+slope/2
  const sLo = 1 / (1 + Math.exp(slope / 2));
  const sHi = 1 / (1 + Math.exp(-slope / 2));
  return (s - sLo) / (sHi - sLo);
}

/** Cubic ease-in-out. */
export function curveCubic(x: number): number {
  const v = clamp01(x);
  // Smoothstep cubic: 3v^2 - 2v^3
  return v * v * (3 - 2 * v);
}

/**
 * Centered power curve. Pivots around 0.5.
 *
 *   exponent < 1 → push toward extremes
 *   exponent = 1 → identity
 *   exponent > 1 → pull toward center
 */
export function curveCenteredPower(x: number, exponent: number): number {
  if (exponent === 1) return clamp01(x);
  const offset = x - 0.5;
  const sign = offset < 0 ? -1 : 1;
  // Range [-0.5, 0.5] -> [-1, 1] for the power op, then halve back.
  const shaped = (sign * Math.pow(Math.abs(offset) * 2, exponent)) / 2;
  return clamp01(shaped + 0.5);
}

/** Apply by name. `param` interpretation depends on the curve. */
export function applyCurve(name: CurveName, x: number, param?: number): number {
  switch (name) {
    case 'linear': return curveLinear(x);
    case 'exp': return curveExp(x, param ?? 4.0);
    case 'log': return curveLog(x, param ?? 4.0);
    case 'square': return curveSquare(x);
    case 'sqrt': return curveSqrt(x);
    case 'sigmoid': return curveSigmoid(x, param ?? 8.0);
    case 'cubic': return curveCubic(x);
    case 'centered_power': return curveCenteredPower(x, param ?? 1.0);
  }
}

export const CURVE_NAMES: ReadonlyArray<CurveName> = [
  'linear', 'exp', 'log', 'square', 'sqrt', 'sigmoid', 'cubic', 'centered_power',
];
