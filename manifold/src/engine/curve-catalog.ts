/**
 * Curve catalog — NAMES + ids only (one-core-engine P4).
 *
 * The curve MATHS now lives solely in the C++/WASM core
 * (nisps/core/math.hpp), sampled via `EngineApi.curveApply` /
 * `curveApplyBatch` (bindings `nisps_curve_apply` / `_batch`). The old TS
 * `curves.ts` — which mirrored the maths and drifted from the canonical
 * catalog for exp/log/sigmoid/cubic — is deleted. This module keeps only the
 * NAME↔id contract every consumer needs to talk to the WASM.
 *
 * Curve ids (nisps::Curve enum + centred power):
 *   0 linear · 1 exp · 2 log · 3 square · 4 sqrt · 5 sigmoid · 6 cubic
 *   7 centered_power (param = exponent)
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

/** Canonical name → WASM curve id. */
export const CURVE_ID: Record<CurveName, number> = {
  linear: 0,
  exp: 1,
  log: 2,
  square: 3,
  sqrt: 4,
  sigmoid: 5,
  cubic: 6,
  centered_power: 7,
};

export const CURVE_NAMES: ReadonlyArray<CurveName> = [
  'linear', 'exp', 'log', 'square', 'sqrt', 'sigmoid', 'cubic', 'centered_power',
];

/**
 * Default `param` per curve. Only `centered_power` reads its param (the
 * exponent). The named catalog entries (0..6) ignore param C-side; the value is
 * documentary. Kept for the fixture generator / previews.
 */
export const CURVE_DEFAULT_PARAMS: Record<CurveName, number | null> = {
  linear: null,
  exp: null,
  log: null,
  square: null,
  sqrt: null,
  sigmoid: null,
  cubic: null,
  centered_power: 1.0,
};
