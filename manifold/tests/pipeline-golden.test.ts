/**
 * Pipeline golden regression (run with `bun test`).
 *
 * The one-core-engine P4 migration moved the curve / input-pipeline /
 * output-pipeline maths into the C++/WASM core (nisps/pipeline/*, nisps/core/
 * math.hpp). This test now drives the SAME committed fixtures through the WASM
 * chains and asserts they reproduce the recorded gestures. It is the
 * recorded-gesture pre/post-migration regression the plan (§P4) calls for:
 * same pointer trace → same routed output across the migration.
 *
 * Tolerances (f32 WASM vs f64-captured fixtures):
 *   - Input / output pipelines: 1e-5. Measured max non-momentum drift <5e-7.
 *   - Momentum configs (momentum-gentle / momentum-strong / combined): 1e-2.
 *     This path is NOT float noise in the usual sense: the velocity ring's
 *     window-membership test (`now - t <= window`) is a DISCRETE boundary that
 *     f32 rounding can flip during fast gestures, changing which sample is the
 *     window's oldest by a whole frame (~8 ms) → a step change in the measured
 *     speed → integrated by the momentum-zoom IIR. It is proven-inherent to the
 *     deliberately-f32 core, NOT a core bug: a byte-faithful f32 port of the
 *     exact original TS algorithm reproduces the WASM to <6e-8 while both
 *     diverge from the f64 capture by the same ~7-9e-3 (measured max 8.6e-3 on
 *     momentum-strong). Reconciling it in the core would require f64 momentum
 *     maths, which would break firmware parity. See fixtures/README.md.
 *   - Curves: 1e-5. linear/square/sqrt/centered_power match the ORIGINAL f64
 *     capture (proving no behaviour change); exp/log/sigmoid/cubic were
 *     RE-BASELINED from the WASM on 2026-07-18 (deliberate switch to the
 *     canonical firmware-exact maths — see fixtures/README.md + the
 *     curves-golden.json provenance) so the test asserts WASM stability against
 *     the regenerated values.
 *
 * The fixtures are authoritative: the trace, raw sequence, and configs are read
 * FROM the JSON.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, expect, test } from 'bun:test';

import { CURVE_ID, type CurveName } from '../src/engine/curve-catalog';
import {
  anchorModeToInt,
  momentumModeToInt,
  type InputConfig,
} from '../src/engine/pipeline-types';
import type { GestureEvent, OutputRunSpec } from './pipeline-golden-lib';
import { loadPipelineWasm, type PipelineWasm } from './wasm-load';

const DIR = dirname(fileURLToPath(import.meta.url));
const readFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(DIR, 'fixtures', name), 'utf8')) as T;

const TOL = 1e-5;
/**
 * Momentum configs only: proven-inherent f32 drift of the velocity-ring +
 * momentum-zoom IIR (see the file header). Measured max 8.6e-3; 1e-2 leaves a
 * small margin. The core is still tightly guarded — a byte-faithful f32 port of
 * the original algorithm matches the WASM to <6e-8 — so a real behavioural
 * regression (wrong preset / broken window logic) would blow far past 1e-2.
 */
const MOMENTUM_TOL = 1e-2;
const MOMENTUM_RUNS = new Set(['momentum-gentle', 'momentum-strong', 'combined']);

const close = (a: number, b: number, tol: number, ctx: string) => {
  if (a === b) return;
  expect(Math.abs(a - b), ctx).toBeLessThanOrEqual(tol);
};

/** InputConfig → the 15-float wire layout (nisps_input_set_config). */
function inputConfigToWire(c: InputConfig): number[] {
  return [
    c.zoom,
    c.zoomX ?? 0,
    c.zoomY ?? 0,
    c.anchorX,
    c.anchorY,
    anchorModeToInt(c.anchorMode),
    c.deadzone,
    c.inputCurve,
    c.inputCurveX ?? 0,
    c.inputCurveY ?? 0,
    c.smoothing,
    momentumModeToInt(c.momentumZoom),
    c.velocityWindow / 1000,
    c.invertX ? 1 : 0,
    c.invertY ? 1 : 0,
  ];
}

let wasm: PipelineWasm;
let pipe = 0;
beforeAll(async () => {
  wasm = await loadPipelineWasm();
  pipe = wasm.pipelineCreate();
  expect(pipe).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------

test('gesture trace fixture is well-formed (>=240 events, fixed dt, in-domain)', () => {
  const trace = readFixture<{ dt_ms: number; count: number; events: GestureEvent[] }>('gesture-trace.json');
  expect(trace.events.length).toBe(trace.count);
  expect(trace.events.length).toBeGreaterThanOrEqual(240);
  for (let i = 0; i < trace.events.length; i++) {
    const ev = trace.events[i]!;
    close(ev.t_ms, i * trace.dt_ms, TOL, `event ${i} t_ms`);
    expect(ev.x).toBeGreaterThanOrEqual(0);
    expect(ev.x).toBeLessThanOrEqual(1);
    expect(ev.y).toBeGreaterThanOrEqual(0);
    expect(ev.y).toBeLessThanOrEqual(1);
  }
});

test('curves-golden: WASM curveApply matches the (re-baselined) catalog', () => {
  const fx = readFixture<{ sampleCount: number; curves: Record<string, number[]> }>('curves-golden.json');
  const names = Object.keys(fx.curves) as CurveName[];
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    const golden = fx.curves[name]!;
    const id = CURVE_ID[name];
    const param = name === 'centered_power' ? 1.0 : 0;
    expect(golden.length).toBe(fx.sampleCount);
    for (let i = 0; i < golden.length; i++) {
      const x = i / (fx.sampleCount - 1);
      close(wasm.curveApply(id, x, param), golden[i]!, TOL, `curve ${name}[${i}] (x=${x})`);
    }
  }
});

test('input-pipeline-golden: WASM input chain matches captured outputs', () => {
  const trace = readFixture<{ events: GestureEvent[] }>('gesture-trace.json').events;
  const fx = readFixture<{
    runs: Array<{ id: string; config: InputConfig; outputs: Array<{ x: number; y: number; frozen: boolean }> }>;
  }>('input-pipeline-golden.json');
  expect(fx.runs.length).toBeGreaterThan(0);

  for (const run of fx.runs) {
    const tol = MOMENTUM_RUNS.has(run.id) ? MOMENTUM_TOL : TOL;
    wasm.inputReset(pipe);
    wasm.inputSetConfig(pipe, inputConfigToWire(run.config));
    expect(run.outputs.length, `run ${run.id} length`).toBe(trace.length);

    // Honour the fixture clock contract: dt = per-event t_ms delta in seconds,
    // with the first event's dt = 0 (matches the pre-migration capture).
    let prevT = trace.length > 0 ? trace[0]!.t_ms : 0;
    for (let i = 0; i < trace.length; i++) {
      const ev = trace[i]!;
      const dt = Math.max(0, (ev.t_ms - prevT) / 1000);
      prevT = ev.t_ms;
      const got = wasm.inputProcess(pipe, ev.x, ev.y, dt);
      const want = run.outputs[i]!;
      close(got.x, want.x, tol, `input ${run.id}[${i}].x`);
      close(got.y, want.y, tol, `input ${run.id}[${i}].y`);
      expect(got.frozen, `input ${run.id}[${i}].frozen`).toBe(want.frozen);
    }
  }
});

test('output-pipeline-golden: WASM output chain matches captured outputs', () => {
  const fx = readFixture<{
    dt_ms: number;
    sequence: number[][];
    runs: Array<{ id: string; spec: OutputRunSpec; outputs: number[][] }>;
  }>('output-pipeline-golden.json');
  expect(fx.runs.length).toBeGreaterThan(0);
  expect(fx.sequence.length).toBeGreaterThanOrEqual(100);
  const dtSeconds = fx.dt_ms / 1000; // constant per step (matches the capture)
  const dims = fx.sequence[0]!.length;

  for (const run of fx.runs) {
    const spec = run.spec;
    wasm.outputReset(pipe);
    // Per-output freeze mask (whole-run), applied once.
    let mask: Uint8Array | null = null;
    if (spec.freezeMaskIndices) {
      mask = new Uint8Array(dims);
      for (const i of spec.freezeMaskIndices) if (i >= 0 && i < dims) mask[i] = 1;
    }
    wasm.outputSetFreezeMask(pipe, mask);

    expect(run.outputs.length, `run ${run.id} length`).toBe(fx.sequence.length);
    const slew = spec.slewRate === null ? Infinity : spec.slewRate;
    for (let s = 0; s < fx.sequence.length; s++) {
      const frozen = spec.freezeSteps ? s >= spec.freezeSteps[0] && s < spec.freezeSteps[1] : false;
      wasm.outputSetConfig(pipe, spec.globalCurve, spec.smoothing, slew, frozen);
      const vec = Float32Array.from(fx.sequence[s]!);
      wasm.outputProcess(pipe, vec, dtSeconds);
      const want = run.outputs[s]!;
      expect(vec.length, `output ${run.id}[${s}] width`).toBe(want.length);
      for (let j = 0; j < vec.length; j++) {
        close(vec[j]!, want[j]!, TOL, `output ${run.id}[${s}][${j}]`);
      }
    }
  }
});
