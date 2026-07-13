/**
 * Regenerates the pipeline golden fixtures from the CURRENT TS implementations.
 *
 * Run once, from manifold/:  `bun tests/fixtures/_generate.ts`
 *
 * This is the capture tool. It must only be re-run intentionally (it overwrites
 * the goldens). The drift guard lives in tests/pipeline-golden.test.ts, which
 * re-runs the same code against the committed fixtures without rewriting them.
 *
 * Captured 2026-07-13, before the P4 core migration
 * (docs/specs/plans/one-core-engine-refactor.md §P4).
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CURVE_DEFAULT_PARAMS,
  CURVE_SAMPLE_COUNT,
  INPUT_DT_MS,
  OUTPUT_DIMS,
  OUTPUT_DT_MS,
  buildGestureTrace,
  buildOutputSequence,
  inputRunSpecs,
  outputRunSpecs,
  runInputPipeline,
  runOutputPipeline,
  sampleAllCurves,
} from '../pipeline-golden-lib';

const DIR = dirname(fileURLToPath(import.meta.url));
const write = (name: string, data: unknown) => {
  const path = join(DIR, name);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log('wrote', name);
};

const CAPTURED = '2026-07-13';
const SOURCE_NOTE =
  'Captured from the TS engine implementations before the P4 one-core-engine migration. See tests/fixtures/README.md.';

// 1. Gesture trace ----------------------------------------------------------
const trace = buildGestureTrace();
write('gesture-trace.json', {
  description: 'Canonical synthetic pointer trace over the input pipeline native [0,1]^2 domain.',
  captured: CAPTURED,
  note: SOURCE_NOTE,
  dt_ms: INPUT_DT_MS,
  count: trace.length,
  domain: { x: [0, 1], y: [0, 1] },
  segments: ['h-sweep', 'v-sweep', 'diagonal', 'spiral', 'figure-eight', 'dwell+jumps'],
  events: trace,
});

// 2. Curves -----------------------------------------------------------------
write('curves-golden.json', {
  description: 'applyCurve(name, x) sampled at 129 points x in [0,1] inclusive, using default params.',
  captured: CAPTURED,
  note: SOURCE_NOTE,
  sampleCount: CURVE_SAMPLE_COUNT,
  xStep: 1 / (CURVE_SAMPLE_COUNT - 1),
  defaultParams: CURVE_DEFAULT_PARAMS,
  curves: sampleAllCurves(),
});

// 3. Input pipeline ---------------------------------------------------------
write('input-pipeline-golden.json', {
  description: 'Gesture trace (gesture-trace.json) run through processInput under representative configs.',
  captured: CAPTURED,
  note: SOURCE_NOTE,
  traceRef: 'gesture-trace.json',
  dt_ms: INPUT_DT_MS,
  clockContract: 'performance.now() is pinned to each event t_ms during capture so momentum is deterministic.',
  stateContract: 'State reset to defaultInputState() at step 0 of every run.',
  runs: inputRunSpecs().map(({ id, config }) => ({
    id,
    config,
    outputs: runInputPipeline(trace, config),
  })),
});

// 4. Output pipeline --------------------------------------------------------
const sequence = buildOutputSequence();
write('output-pipeline-golden.json', {
  description: 'Deterministic raw output vectors (offset sines, f32) run through processOutput under representative configs.',
  captured: CAPTURED,
  note: SOURCE_NOTE,
  dt_ms: OUTPUT_DT_MS,
  dims: OUTPUT_DIMS,
  stateContract: 'State reset to defaultOutputState() at step 0 of every run. slewRate null = Infinity.',
  sequence,
  runs: outputRunSpecs().map((spec) => ({
    id: spec.id,
    spec,
    outputs: runOutputPipeline(sequence, spec),
  })),
});
