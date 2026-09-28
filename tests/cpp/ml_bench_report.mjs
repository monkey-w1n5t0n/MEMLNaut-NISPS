#!/usr/bin/env node
/**
 * tests/cpp/ml_bench_report.mjs — print one or two `ml_bench` reports as a
 * per-scenario table and (with --compare) the delta against a previous report.
 *
 * Sibling of bench_report.mjs: the C++ produces the numbers, node does the
 * presentation. scripts/bench-ml.sh calls it with the native report and, when
 * emcc exists, the wasm report of the same commit.
 *
 *   node ml_bench_report.mjs <native.json> [<wasm.json>] [--compare previous.json]
 *                            [--only SCENARIO_ID_PREFIX]
 *
 * Columns: the first report's value; the second report's relative difference
 * when two are given (native vs wasm); Δ% against --compare when given.
 * Multi-config sweeps are lab/ml/sweep.mjs's job, not this tool's.
 *
 * Exit codes: 0 on a readable report (this tool asserts nothing — see the
 * NOTHING HERE ASSERTS note in ml_bench.cpp), 2 on bad input.
 */

import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const inputs = [];
let comparePath = null;
let only = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--compare') comparePath = argv[++i];
  else if (a === '--only') only = argv[++i];
  else if (a.startsWith('--')) {
    console.error(`[ml_bench_report] unknown flag ${a}`);
    process.exit(2);
  } else inputs.push(a);
}
if (inputs.length === 0 || inputs.length > 2) {
  console.error('[ml_bench_report] usage: ml_bench_report.mjs <report.json> [<report.json>] [--compare FILE] [--only PREFIX]');
  process.exit(2);
}

function load(p) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`[ml_bench_report] cannot read ${p}: ${e.message}`);
    process.exit(2);
  }
  if (!Array.isArray(doc.scenarios)) {
    console.error(`[ml_bench_report] ${p} is not an ml_bench report (no "scenarios" array)`);
    process.exit(2);
  }
  const byId = new Map(doc.scenarios.map((s) => [s.id, s]));
  return { doc, byId };
}

const [a, b] = inputs.map(load);
const prev = comparePath ? load(comparePath) : null;

const fmt = (v) => (typeof v !== 'number' ? String(v) : Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(3) : v.toPrecision(4));
const rel = (x, y) => {
  if (typeof x !== 'number' || typeof y !== 'number') return '';
  if (x === y) return '=';
  const d = Math.abs(y) > 1e-12 ? (x - y) / Math.abs(y) : x - y;
  return `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%`;
};

const hdr = a.doc;
const shape = hdr.shape ? `${hdr.shape.n_in}-${hdr.shape.hidden.join('-')}-${hdr.shape.n_out}` : '?';
console.log(`ml_bench ${hdr.schema ?? ''}  target=${hdr.target}  shape=${shape}  seed=${hdr.seed}${hdr.smoke ? '  (smoke)' : ''}`);
if (hdr.params) {
  const knobs = Object.entries(hdr.params).filter(([k]) => !k.startsWith('shape.') && k !== 'bench.seed');
  console.log("params: " + knobs.map(([k, v]) => `${k}=${v}`).join(' '));
}
if (b) console.log(`second column: ${b.doc.target} relative to ${hdr.target}`);
if (prev) console.log(`Δ column: against ${comparePath}`);
console.log('');

const w = 34;
for (const s of hdr.scenarios) {
  if (only && !s.id.startsWith(only)) continue;
  console.log(`${s.id} — ${s.what}`);
  const other = b?.byId.get(s.id);
  const old = prev?.byId.get(s.id);
  for (const [k, v] of Object.entries(s.metrics)) {
    const cols = [fmt(v).padStart(12)];
    if (b) cols.push((other ? rel(other.metrics[k], v) : 'missing').padStart(9));
    if (prev) cols.push((old && k in old.metrics ? rel(v, old.metrics[k]) : 'new').padStart(9));
    console.log(`  ${k.padEnd(w)}${cols.join(' ')}`);
  }
}
if (prev) {
  const gone = [...prev.byId.keys()].filter((id) => !a.byId.has(id) && (!only || id.startsWith(only)));
  if (gone.length) console.log(`\nscenarios in --compare but not here: ${gone.join(', ')}`);
}
