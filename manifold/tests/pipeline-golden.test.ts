/**
 * Pipeline golden drift guard (run with `bun test`).
 *
 * Re-runs the CURRENT TS curve / input-pipeline / output-pipeline
 * implementations against the committed fixtures in ./fixtures and asserts
 * exact equality (tolerance 1e-9). It pins:
 *   - the pointer trace (gesture-trace.json) → routed input output,
 *   - applyCurve(name, x) over the curve catalog,
 *   - the raw-output sequence → processed output.
 *
 * Purpose: guard the TS implementations against silent drift until P4
 * (docs/specs/plans/one-core-engine-refactor.md §P4) flips these assertions to
 * the C++/WASM implementations. See fixtures/README.md for the migration
 * playbook and the f32-vs-f64 tolerance note.
 *
 * The fixtures are authoritative: configs, trace, and raw sequence are read
 * FROM the JSON, so editing pipeline-golden-lib.ts config lists cannot mask a
 * regression here — only re-running fixtures/_generate.ts updates the goldens.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { expect, test } from 'bun:test';

import type { CurveName } from '../src/engine/curves';
import { applyCurve } from '../src/engine/curves';
import type { InputConfig } from '../src/engine/input-pipeline';
import {
  runInputPipeline,
  runOutputPipeline,
  type GestureEvent,
  type OutputRunSpec,
} from './pipeline-golden-lib';

const DIR = dirname(fileURLToPath(import.meta.url));
const readFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(DIR, 'fixtures', name), 'utf8')) as T;

const TOL = 1e-9;
const close = (a: number, b: number, ctx: string) => {
  if (a === b) return;
  expect(Math.abs(a - b), ctx).toBeLessThanOrEqual(TOL);
};

// ---------------------------------------------------------------------------

test('gesture trace fixture is well-formed (>=240 events, fixed dt, in-domain)', () => {
  const trace = readFixture<{ dt_ms: number; count: number; events: GestureEvent[] }>('gesture-trace.json');
  expect(trace.events.length).toBe(trace.count);
  expect(trace.events.length).toBeGreaterThanOrEqual(240);
  for (let i = 0; i < trace.events.length; i++) {
    const ev = trace.events[i]!;
    close(ev.t_ms, i * trace.dt_ms, `event ${i} t_ms`);
    expect(ev.x).toBeGreaterThanOrEqual(0);
    expect(ev.x).toBeLessThanOrEqual(1);
    expect(ev.y).toBeGreaterThanOrEqual(0);
    expect(ev.y).toBeLessThanOrEqual(1);
  }
});

test('curves-golden: applyCurve matches captured samples', () => {
  const fx = readFixture<{ sampleCount: number; curves: Record<string, number[]> }>('curves-golden.json');
  const names = Object.keys(fx.curves) as CurveName[];
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    const golden = fx.curves[name]!;
    expect(golden.length).toBe(fx.sampleCount);
    for (let i = 0; i < golden.length; i++) {
      const x = i / (fx.sampleCount - 1);
      close(applyCurve(name, x), golden[i]!, `curve ${name}[${i}] (x=${x})`);
    }
  }
});

test('input-pipeline-golden: processInput matches captured outputs', () => {
  const trace = readFixture<{ events: GestureEvent[] }>('gesture-trace.json').events;
  const fx = readFixture<{
    runs: Array<{ id: string; config: InputConfig; outputs: Array<{ x: number; y: number; frozen: boolean }> }>;
  }>('input-pipeline-golden.json');
  expect(fx.runs.length).toBeGreaterThan(0);
  for (const run of fx.runs) {
    const got = runInputPipeline(trace, run.config);
    expect(got.length, `run ${run.id} length`).toBe(run.outputs.length);
    for (let i = 0; i < got.length; i++) {
      close(got[i]!.x, run.outputs[i]!.x, `input ${run.id}[${i}].x`);
      close(got[i]!.y, run.outputs[i]!.y, `input ${run.id}[${i}].y`);
      expect(got[i]!.frozen, `input ${run.id}[${i}].frozen`).toBe(run.outputs[i]!.frozen);
    }
  }
});

test('output-pipeline-golden: processOutput matches captured outputs', () => {
  const fx = readFixture<{
    sequence: number[][];
    runs: Array<{ id: string; spec: OutputRunSpec; outputs: number[][] }>;
  }>('output-pipeline-golden.json');
  expect(fx.runs.length).toBeGreaterThan(0);
  expect(fx.sequence.length).toBeGreaterThanOrEqual(100);
  for (const run of fx.runs) {
    const got = runOutputPipeline(fx.sequence, run.spec);
    expect(got.length, `run ${run.id} length`).toBe(run.outputs.length);
    for (let s = 0; s < got.length; s++) {
      const gotRow = got[s]!;
      const wantRow = run.outputs[s]!;
      expect(gotRow.length, `output ${run.id}[${s}] width`).toBe(wantRow.length);
      for (let j = 0; j < gotRow.length; j++) {
        close(gotRow[j]!, wantRow[j]!, `output ${run.id}[${s}][${j}]`);
      }
    }
  }
});
