/**
 * Output pipeline — pure TS port of legacy `js/ui/output-pipeline.js`.
 *
 * Stages (in order) for each output:
 *   1. Global power curve (raw^exponent, exponent in [0.2, 5.0])
 *   2. Per-output EMA smoothing (frame-rate-independent)
 *   3. Slew-rate limiting (max change per second per output)
 *   4. Freeze gate (global) and per-output freeze mask
 *
 * `processOutput` is a pure function: takes the raw output vector, the prior
 * processed vector (or null on first call), and config; returns a new
 * Float32Array. Consumer (output-store) holds prev between frames.
 *
 * NOTE: Reuses an internal scratch buffer ONLY when a prev buffer of the
 * exact same length is supplied AND `cfg.reuseBuffer === true`. Otherwise it
 * allocates a fresh Float32Array (safer for cross-component sharing).
 */

import { clamp, clamp01 } from './curves';

export const GLOBAL_CURVE_MIN = 0.2;
export const GLOBAL_CURVE_MAX = 5.0;
export const SMOOTHING_MAX = 0.95;
export const SLEW_RATE_MIN = 0.005;

const REFERENCE_DT = 1 / 60;

export interface OutputConfig {
  /** Power curve exponent applied to ALL outputs. 1 = linear. */
  globalCurve: number;
  /** EMA smoothing factor [0, 0.95]. */
  smoothing: number;
  /** Max change per second per output. Infinity = unlimited. */
  slewRate: number;
  /** Global freeze gate. */
  freezeOutput: boolean;
  /** Per-output freeze mask (1 = frozen). Length must match output vector. */
  freezeMask: Uint8Array | null;
  /** If true and prev buffer matches length, reuse it for processed output. */
  reuseBuffer: boolean;
}

export interface OutputState {
  /** Last processed output (kept here for slew/freeze logic). */
  prev: Float32Array | null;
  /** Last EMA-smoothed values per output. */
  smoothed: Float32Array | null;
}

export function defaultOutputConfig(): OutputConfig {
  return {
    globalCurve: 1.0,
    smoothing: 0,
    slewRate: Infinity,
    freezeOutput: false,
    freezeMask: null,
    reuseBuffer: false,
  };
}

export function defaultOutputState(): OutputState {
  return { prev: null, smoothed: null };
}

function emaSmooth(prev: number, raw: number, smoothing: number, dt: number): number {
  if (smoothing <= 0) return raw;
  const effectiveDt = dt > 0 ? dt : REFERENCE_DT;
  const alpha = 1 - smoothing;
  const alphaEff = 1 - Math.pow(1 - alpha, effectiveDt / REFERENCE_DT);
  return prev + alphaEff * (raw - prev);
}

/**
 * Process raw outputs through global curve → smoothing → slew → freeze gate.
 *
 * @param raw      raw output vector (Float32Array of size N)
 * @param cfg      pipeline config
 * @param state    prior state (use {@link defaultOutputState} first call)
 * @param dtMs     time since last call in milliseconds
 * @returns        { processed, state } with the new outputs and updated state
 */
export function processOutput(
  raw: Float32Array,
  cfg: OutputConfig,
  state: OutputState,
  dtMs: number,
): { processed: Float32Array; state: OutputState } {
  const n = raw.length;
  const dt = Math.max(0, dtMs / 1000);

  let prev = state.prev;
  let smoothed = state.smoothed;
  if (!prev || prev.length !== n) {
    prev = new Float32Array(n);
    // Seed from raw on first call
    for (let i = 0; i < n; i++) prev[i] = clamp01(raw[i] ?? 0);
  }
  if (!smoothed || smoothed.length !== n) {
    smoothed = new Float32Array(n);
    for (let i = 0; i < n; i++) smoothed[i] = clamp01(raw[i] ?? 0);
  }

  let processed: Float32Array;
  if (cfg.reuseBuffer && prev.length === n) {
    processed = prev;
  } else {
    processed = new Float32Array(n);
  }

  // Stage 1: global curve (mutates a working scratch via direct compute)
  const exp = cfg.globalCurve;

  if (cfg.freezeOutput) {
    // Output frozen: hold prior values.
    if (processed !== prev) {
      processed.set(prev);
    }
    return { processed, state: { prev: processed, smoothed } };
  }

  for (let i = 0; i < n; i++) {
    const r = clamp01(raw[i] ?? 0);
    const curved = exp === 1.0 ? r : Math.pow(r, exp);

    // Per-output freeze
    if (cfg.freezeMask && cfg.freezeMask[i]) {
      processed[i] = prev[i] ?? curved;
      continue;
    }

    // Stage 2: EMA smoothing
    let value = emaSmooth(smoothed[i] ?? curved, curved, cfg.smoothing, dt);
    smoothed[i] = value;

    // Stage 3: slew-rate limit
    if (isFinite(cfg.slewRate) && cfg.slewRate > 0) {
      const maxDelta = cfg.slewRate * dt;
      const delta = value - (prev[i] ?? value);
      if (Math.abs(delta) > maxDelta) {
        value = (prev[i] ?? value) + Math.sign(delta) * maxDelta;
      }
    }

    processed[i] = clamp01(value);
  }

  // Update prev for next call
  if (processed !== prev) {
    prev = new Float32Array(processed); // copy so caller can hold processed buffer freely
  }

  return { processed, state: { prev, smoothed } };
}
