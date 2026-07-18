/**
 * Fixture (re)generator. Run from manifold/:  `bun tests/fixtures/_generate.ts`
 *
 * SCOPE SINCE ONE-CORE-ENGINE P4 (2026-07-18):
 *   - gesture-trace.json — pure deterministic data (regenerated identically).
 *   - curves-golden.json — the exp/log/sigmoid/cubic entries are RE-BASELINED
 *     from the canonical C++/WASM core (nisps/core/math.hpp); the
 *     linear/square/sqrt/centered_power entries are PRESERVED as their original
 *     2026-07-13 f64 TS captures (the C++ core matches them within 1e-5, so
 *     there is no behaviour change to record). Provenance is embedded.
 *
 * The input-pipeline-golden.json / output-pipeline-golden.json fixtures are a
 * FROZEN pre-migration capture — this tool does NOT rewrite them (there is no
 * TS pipeline left to capture from; the regression is proven by driving the
 * WASM chains against the frozen goldens in pipeline-golden.test.ts).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CURVE_ID, CURVE_NAMES, CURVE_DEFAULT_PARAMS, type CurveName } from '../../src/engine/curve-catalog';
import { INPUT_DT_MS, CURVE_SAMPLE_COUNT, buildGestureTrace } from '../pipeline-golden-lib';
import { loadPipelineWasm } from '../wasm-load';

const DIR = dirname(fileURLToPath(import.meta.url));
const write = (name: string, data: unknown) => {
  writeFileSync(join(DIR, name), JSON.stringify(data, null, 2) + '\n');
  console.log('wrote', name);
};

/** Curves whose maths deliberately changed at the P4 migration. */
const REBASELINED: ReadonlyArray<CurveName> = ['exp', 'log', 'sigmoid', 'cubic'];
const UNCHANGED: ReadonlyArray<CurveName> = ['linear', 'square', 'sqrt', 'centered_power'];

async function main(): Promise<void> {
  const wasm = await loadPipelineWasm();

  // 1. Gesture trace (pure data) ---------------------------------------------
  const trace = buildGestureTrace();
  write('gesture-trace.json', {
    description: 'Canonical synthetic pointer trace over the input pipeline native [0,1]^2 domain.',
    captured: '2026-07-13',
    note: 'Pure deterministic data; the input chain (WASM) is driven over it in pipeline-golden.test.ts.',
    dt_ms: INPUT_DT_MS,
    count: trace.length,
    domain: { x: [0, 1], y: [0, 1] },
    segments: ['h-sweep', 'v-sweep', 'diagonal', 'spiral', 'figure-eight', 'dwell+jumps'],
    events: trace,
  });

  // 2. Curves — preserve the unchanged f64 entries, re-baseline the 4 changed --
  const existing = JSON.parse(
    readFileSync(join(DIR, 'curves-golden.json'), 'utf8'),
  ) as { curves: Record<string, number[]> };

  const curves: Record<string, number[]> = {};
  for (const name of CURVE_NAMES) {
    if (UNCHANGED.includes(name)) {
      curves[name] = existing.curves[name]!; // keep the original f64 capture
      continue;
    }
    const id = CURVE_ID[name];
    const param = name === 'centered_power' ? 1.0 : 0;
    const out: number[] = [];
    for (let i = 0; i < CURVE_SAMPLE_COUNT; i++) {
      out.push(wasm.curveApply(id, i / (CURVE_SAMPLE_COUNT - 1), param));
    }
    curves[name] = out;
  }

  write('curves-golden.json', {
    description:
      'Curve catalog sampled at 129 points x in [0,1] inclusive. linear/square/sqrt/centered_power are the original 2026-07-13 f64 TS captures (behaviour unchanged); exp/log/sigmoid/cubic RE-BASELINED from the canonical C++/WASM core (nisps/core/math.hpp) on the 2026-07-18 P4 migration — see provenance and README.',
    captured: '2026-07-13',
    sampleCount: CURVE_SAMPLE_COUNT,
    xStep: 1 / (CURVE_SAMPLE_COUNT - 1),
    defaultParams: CURVE_DEFAULT_PARAMS,
    provenance: {
      unchanged: {
        curves: UNCHANGED,
        source: 'TS f64 capture 2026-07-13; C++ core matches within 1e-5 (no behaviour change).',
      },
      rebaselined: {
        curves: REBASELINED,
        date: '2026-07-18',
        source:
          'nisps/core/math.hpp via nisps_curve_apply (WASM). The old TS curves.ts used k=4 exp/log, slope-8 sigmoid, smoothstep cubic; the canonical catalog uses k=1-normalised exp/log, slope-6 sigmoid, true cubic x^3. The browser now adopts the firmware-exact behaviour.',
      },
    },
    curves,
  });

  console.log('NOTE: input/output pipeline goldens are frozen; not regenerated.');
}

main().catch((err) => {
  console.error('[_generate] error:', err);
  process.exit(1);
});
