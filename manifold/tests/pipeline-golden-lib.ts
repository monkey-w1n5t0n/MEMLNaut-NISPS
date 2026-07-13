/**
 * Shared runner + generator library for the pipeline golden fixtures.
 *
 * Captured 2026-07-13, BEFORE the P4 "one core engine" migration
 * (docs/specs/plans/one-core-engine-refactor.md §P4) replaces the TS
 * curve/input/output implementations with C++/WASM calls.
 *
 * This module is imported by BOTH:
 *   - tests/fixtures/_generate.ts  — writes the *.json fixtures once, and
 *   - tests/pipeline-golden.test.ts — re-runs the CURRENT TS implementations
 *     against the committed fixtures and asserts exact equality.
 *
 * The `run*` functions are the single source of truth for how a fixture was
 * produced. The fixtures embed the trace / raw sequence / configs, so the test
 * re-derives outputs purely from committed data — no hidden inputs.
 *
 * --- Determinism / clock contract -----------------------------------------
 * `input-pipeline.ts`'s momentum-zoom path reads `performance.now()` (wall
 * clock) for its velocity ring. To make the momentum configs reproducible,
 * `runInputPipeline` overrides `performance.now` with a synthetic clock driven
 * by the trace's own `t_ms`: before processing event i, the clock is pinned to
 * `events[i].t_ms`. The velocity window (150 ms) therefore slides over the
 * gesture's own timescale, deterministically. The original `performance.now`
 * is restored afterwards. `output-pipeline.ts` uses no wall clock.
 *
 * --- State contract --------------------------------------------------------
 * Both pipelines are STATEFUL (input: EMA smoothing + velocity ring + momentum
 * multiplier; output: prev + smoothed buffers for slew/freeze). Each config run
 * RESETS state to `defaultInputState()` / `defaultOutputState()` at step 0, so
 * runs are independent and order-free.
 */

import { CURVE_NAMES, applyCurve, type CurveName } from '../src/engine/curves';
import {
  defaultInputConfig,
  defaultInputState,
  processInput,
  type InputConfig,
} from '../src/engine/input-pipeline';
import {
  defaultOutputState,
  processOutput,
  type OutputConfig,
} from '../src/engine/output-pipeline';

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
// 2. Curve sampling
// ---------------------------------------------------------------------------

export const CURVE_SAMPLE_COUNT = 129; // 0..1 inclusive, step 1/128

/** Default `param` used per curve (mirrors applyCurve's `?? default`). */
export const CURVE_DEFAULT_PARAMS: Record<CurveName, number | null> = {
  linear: null,
  exp: 4.0,
  log: 4.0,
  square: null,
  sqrt: null,
  sigmoid: 8.0,
  cubic: null,
  centered_power: 1.0,
};

export function sampleCurve(name: CurveName): number[] {
  const out: number[] = [];
  for (let i = 0; i < CURVE_SAMPLE_COUNT; i++) {
    const x = i / (CURVE_SAMPLE_COUNT - 1); // inclusive endpoints
    out.push(applyCurve(name, x));
  }
  return out;
}

export function sampleAllCurves(): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const name of CURVE_NAMES) out[name] = sampleCurve(name);
  return out;
}

// ---------------------------------------------------------------------------
// 3. Input pipeline configs + runner
// ---------------------------------------------------------------------------

function cfg(overrides: Partial<InputConfig>): InputConfig {
  return { ...defaultInputConfig(), ...overrides };
}

/** Representative input configs. Exercises every branch of processInput. */
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

/**
 * Run the gesture trace through the input pipeline under one config.
 * Resets state at step 0. Drives a synthetic `performance.now` from the trace's
 * t_ms so the momentum path is deterministic (see clock contract above).
 */
export function runInputPipeline(trace: readonly GestureEvent[], config: InputConfig): InputRunOutput[] {
  const perf = globalThis.performance as { now(): number };
  const realNow = perf.now;
  let clock = 0;
  perf.now = () => clock;
  try {
    let state = defaultInputState();
    const outputs: InputRunOutput[] = [];
    let prevT = trace.length > 0 ? trace[0]!.t_ms : 0;
    for (const ev of trace) {
      clock = ev.t_ms;
      const dt = Math.max(0, (ev.t_ms - prevT) / 1000);
      prevT = ev.t_ms;
      const res = processInput([ev.x, ev.y], config, state, dt);
      outputs.push({ x: res.x, y: res.y, frozen: res.frozen });
      state = res.state;
    }
    return outputs;
  } finally {
    perf.now = realNow;
  }
}

// ---------------------------------------------------------------------------
// 4. Output raw sequence + configs + runner
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

function outputConfigForStep(spec: OutputRunSpec, step: number, dims: number): OutputConfig {
  const frozen = spec.freezeSteps ? step >= spec.freezeSteps[0] && step < spec.freezeSteps[1] : false;
  let mask: Uint8Array | null = null;
  if (spec.freezeMaskIndices) {
    mask = new Uint8Array(dims);
    for (const i of spec.freezeMaskIndices) if (i >= 0 && i < dims) mask[i] = 1;
  }
  return {
    globalCurve: spec.globalCurve,
    smoothing: spec.smoothing,
    slewRate: spec.slewRate === null ? Infinity : spec.slewRate,
    freezeOutput: frozen,
    freezeMask: mask,
    reuseBuffer: spec.reuseBuffer,
  };
}

/**
 * Run the raw sequence through the output pipeline under one spec. Resets state
 * at step 0. The global-freeze gate follows `spec.freezeSteps`.
 */
export function runOutputPipeline(sequence: readonly number[][], spec: OutputRunSpec): number[][] {
  const dims = sequence.length > 0 ? sequence[0]!.length : 0;
  let state = defaultOutputState();
  const outputs: number[][] = [];
  for (let s = 0; s < sequence.length; s++) {
    const raw = Float32Array.from(sequence[s]!);
    const config = outputConfigForStep(spec, s, dims);
    const res = processOutput(raw, config, state, OUTPUT_DT_MS);
    outputs.push(Array.from(res.processed));
    state = res.state;
  }
  return outputs;
}
