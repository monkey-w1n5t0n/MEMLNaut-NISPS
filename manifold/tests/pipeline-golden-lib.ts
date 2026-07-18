/**
 * Fixture-support library for the pipeline golden tests.
 *
 * Since the one-core-engine P4 migration the input/output PROCESSING lives in
 * the C++/WASM core; the golden test (tests/pipeline-golden.test.ts) drives the
 * WASM chains against the committed fixtures. This module no longer runs any TS
 * pipeline maths — it only provides the PURE, deterministic fixture DATA
 * (gesture trace, raw output sequence) + the representative config lists + the
 * curve catalog metadata. The gesture/sequence/config data is embedded in the
 * committed *.json fixtures, so the test re-derives nothing hidden.
 *
 * The gesture/output goldens are a FROZEN pre-migration capture (2026-07-13):
 * the test proves the WASM chains reproduce them within an f32 tolerance. The
 * curve goldens were partly re-baselined on 2026-07-18 (see README + the
 * curves-golden.json provenance field).
 */

import {
  CURVE_DEFAULT_PARAMS,
  CURVE_NAMES,
  type CurveName,
} from '../src/engine/curve-catalog';
import {
  defaultInputConfig,
  type InputConfig,
} from '../src/engine/pipeline-types';

export { CURVE_DEFAULT_PARAMS, CURVE_NAMES };
export type { CurveName, InputConfig };

// ---------------------------------------------------------------------------
// Shared timebases
// ---------------------------------------------------------------------------

/** Input trace step: 120 Hz. */
export const INPUT_DT_MS = 1000 / 120; // 8.3333… ms
/** Output sequence step: 60 Hz. */
export const OUTPUT_DT_MS = 1000 / 60; // 16.6666… ms
/** Output vector width used by the synthetic raw sequence. */
export const OUTPUT_DIMS = 8;

// ---------------------------------------------------------------------------
// Fixture value types
// ---------------------------------------------------------------------------

export interface GestureEvent {
  t_ms: number;
  x: number;
  y: number;
}

export interface InputRunOutput {
  x: number;
  y: number;
  frozen: boolean;
}

/** JSON-serialisable input run: an id + the full InputConfig. */
export interface InputRunSpec {
  id: string;
  config: InputConfig;
}

/**
 * JSON-serialisable output run spec. `slewRate: null` means `Infinity`
 * (JSON has no Infinity). `freezeMaskIndices` freezes those output indices for
 * the whole run. `freezeSteps: [start, end)` toggles the GLOBAL freeze gate on
 * for that half-open step range.
 */
export interface OutputRunSpec {
  id: string;
  globalCurve: number;
  smoothing: number;
  slewRate: number | null;
  freezeMaskIndices: number[] | null;
  freezeSteps: [number, number] | null;
  reuseBuffer: boolean;
}

// ---------------------------------------------------------------------------
// 1. Gesture trace generator (pure formula — no Math.random / Date.now)
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * One canonical synthetic pointer trace over the pipeline's native [0,1]^2
 * input domain. 288 events at a fixed 120 Hz dt. Six segments (48 events each)
 * exercise: horizontal sweep, vertical sweep, diagonal corner-to-corner,
 * growing spiral, a Lissajous figure-eight, and dwell periods punctuated by
 * abrupt corner jumps. Endpoints (0 and 1) are visited so the full range is
 * covered.
 */
export function buildGestureTrace(): GestureEvent[] {
  const seg = 48;
  const events: GestureEvent[] = [];
  const push = (x: number, y: number) => {
    const i = events.length;
    events.push({ t_ms: i * INPUT_DT_MS, x: clamp01(x), y: clamp01(y) });
  };

  // Segment 1 — horizontal sweep left→right at mid height.
  for (let i = 0; i < seg; i++) push(i / (seg - 1), 0.5);
  // Segment 2 — vertical sweep bottom→top at mid width.
  for (let i = 0; i < seg; i++) push(0.5, i / (seg - 1));
  // Segment 3 — diagonal, corner (0,0) → (1,1).
  for (let i = 0; i < seg; i++) {
    const t = i / (seg - 1);
    push(t, t);
  }
  // Segment 4 — outward spiral around centre (radius 0 → 0.5).
  for (let i = 0; i < seg; i++) {
    const t = i / (seg - 1);
    const r = 0.5 * t;
    const ang = TAU * 3 * t;
    push(0.5 + r * Math.cos(ang), 0.5 + r * Math.sin(ang));
  }
  // Segment 5 — Lissajous figure-eight (1:2), amplitude 0.48.
  for (let i = 0; i < seg; i++) {
    const t = i / (seg - 1);
    push(0.5 + 0.48 * Math.sin(TAU * t), 0.5 + 0.48 * Math.sin(TAU * 2 * t));
  }
  // Segment 6 — dwell + abrupt jumps. Hold a point for 8 frames, jump, repeat.
  const stops: Array<[number, number]> = [
    [0.5, 0.5],
    [0.0, 0.0],
    [1.0, 1.0],
    [0.0, 1.0],
    [1.0, 0.0],
    [0.5, 0.5],
  ];
  for (let s = 0; s < stops.length; s++) {
    const [x, y] = stops[s]!;
    for (let h = 0; h < seg / stops.length; h++) push(x, y);
  }

  return events;
}

// ---------------------------------------------------------------------------
// 2. Curve sampling metadata
// ---------------------------------------------------------------------------

export const CURVE_SAMPLE_COUNT = 129; // 0..1 inclusive, step 1/128

// ---------------------------------------------------------------------------
// 3. Input pipeline configs
// ---------------------------------------------------------------------------

function cfg(overrides: Partial<InputConfig>): InputConfig {
  return { ...defaultInputConfig(), ...overrides };
}

/** Representative input configs. Exercises every branch of the input chain. */
export function inputRunSpecs(): InputRunSpec[] {
  return [
    { id: 'default', config: cfg({}) },
    { id: 'deadzone', config: cfg({ deadzone: 0.3 }) },
    { id: 'zoom-narrow', config: cfg({ zoom: 0.4 }) },
    { id: 'zoom-sticky-anchor', config: cfg({ zoom: 0.5, anchorMode: 'sticky', anchorX: 0.3, anchorY: 0.7 }) },
    { id: 'curve-pull-center', config: cfg({ inputCurve: 3.0 }) },
    { id: 'curve-push-extremes', config: cfg({ inputCurve: 0.4 }) },
    { id: 'smoothing', config: cfg({ smoothing: 0.8 }) },
    { id: 'invert-both', config: cfg({ invertX: true, invertY: true }) },
    { id: 'per-axis', config: cfg({ zoomX: 0.6, zoomY: 1.0, inputCurveX: 2.0, inputCurveY: 0.5 }) },
    { id: 'momentum-gentle', config: cfg({ momentumZoom: 'gentle' }) },
    { id: 'momentum-strong', config: cfg({ momentumZoom: 'strong', smoothing: 0.5 }) },
    { id: 'mixed-frozen-axis', config: cfg({ zoomX: 0.005, zoomY: 1.0 }) },
    { id: 'fully-frozen', config: cfg({ zoom: 0.005 }) },
    {
      id: 'combined',
      config: cfg({ deadzone: 0.2, zoom: 0.7, inputCurve: 1.6, smoothing: 0.6, momentumZoom: 'gentle' }),
    },
  ];
}

// ---------------------------------------------------------------------------
// 4. Output raw sequence + configs
// ---------------------------------------------------------------------------

/**
 * A deterministic raw output sequence: 120 vectors of width OUTPUT_DIMS, each
 * channel an offset sine, quantised to f32 (Math.fround) so it matches exactly
 * what the Float32Array pipeline input holds.
 */
export function buildOutputSequence(steps = 120, dims = OUTPUT_DIMS): number[][] {
  const seq: number[][] = [];
  for (let s = 0; s < steps; s++) {
    const row: number[] = [];
    for (let j = 0; j < dims; j++) {
      const freq = (j + 1) * 0.5;
      const phase = j / dims;
      const v = 0.5 + 0.5 * Math.sin(TAU * (freq * (s / steps) + phase));
      row.push(Math.fround(v));
    }
    seq.push(row);
  }
  return seq;
}

/** Representative output configs. */
export function outputRunSpecs(): OutputRunSpec[] {
  return [
    { id: 'default', globalCurve: 1.0, smoothing: 0, slewRate: null, freezeMaskIndices: null, freezeSteps: null, reuseBuffer: false },
    { id: 'curve-pull', globalCurve: 2.5, smoothing: 0, slewRate: null, freezeMaskIndices: null, freezeSteps: null, reuseBuffer: false },
    { id: 'curve-push', globalCurve: 0.4, smoothing: 0, slewRate: null, freezeMaskIndices: null, freezeSteps: null, reuseBuffer: false },
    { id: 'smoothing', globalCurve: 1.0, smoothing: 0.85, slewRate: null, freezeMaskIndices: null, freezeSteps: null, reuseBuffer: false },
    { id: 'slew-limited', globalCurve: 1.0, smoothing: 0, slewRate: 0.5, freezeMaskIndices: null, freezeSteps: null, reuseBuffer: false },
    { id: 'freeze-toggled', globalCurve: 1.0, smoothing: 0, slewRate: null, freezeMaskIndices: null, freezeSteps: [40, 80], reuseBuffer: false },
    { id: 'freeze-mask', globalCurve: 1.0, smoothing: 0, slewRate: null, freezeMaskIndices: [0, 2, 4], freezeSteps: null, reuseBuffer: false },
    { id: 'combined', globalCurve: 1.8, smoothing: 0.7, slewRate: 1.0, freezeMaskIndices: null, freezeSteps: [90, 110], reuseBuffer: false },
  ];
}
