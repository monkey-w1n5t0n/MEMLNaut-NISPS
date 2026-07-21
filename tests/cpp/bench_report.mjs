#!/usr/bin/env node
/**
 * tests/cpp/bench_report.mjs — merge one or more `engine_bench --json` runs
 * into a single report, print a side-by-side table, and (with --compare)
 * diff against a previous report.
 *
 * Sibling of parity_diff.mjs: same place, same job shape — the C++ produces
 * the numbers, node does the presentation.
 *
 *   node bench_report.mjs <run.json> [<run.json> ...]
 *                         [--out combined.json] [--compare previous.json]
 *
 * Each input is the JSON object `engine_bench --json` writes; its "target"
 * field ("native" / "wasm") names the column. The combined document is
 *   { "generated": ISO8601, "runs": [ <run>, ... ] }
 * and that is also what --compare expects to read.
 *
 * Exit codes: 0 always on a readable report (this tool asserts nothing —
 * see the REPORTING, NOT ASSERTING note in engine_bench.cpp), 2 on bad input.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const inputs = [];
let outPath = null;
let comparePath = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') outPath = argv[++i];
  else if (a === '--compare') comparePath = argv[++i];
  else if (a.startsWith('--')) {
    console.error(`[bench_report] unknown flag ${a}`);
    process.exit(2);
  } else inputs.push(a);
}

if (inputs.length === 0) {
  console.error('[bench_report] usage: bench_report.mjs <run.json>... [--out FILE] [--compare FILE]');
  process.exit(2);
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`[bench_report] cannot read ${p}: ${e.message}`);
    process.exit(2);
  }
}

// An input is normally a bare `engine_bench --json` object, but accepting a
// previously combined report too costs one line and removes the obvious trap
// of feeding this tool its own output.
const runs = [];
for (const p of inputs) {
  const doc = readJson(p);
  if (Array.isArray(doc.runs)) runs.push(...doc.runs);
  else runs.push(doc);
}
if (runs.some((r) => !Array.isArray(r.engines))) {
  console.error('[bench_report] input is not an engine_bench report (no "engines" array)');
  process.exit(2);
}
const combined = { generated: new Date().toISOString(), runs };

if (outPath) {
  writeFileSync(outPath, JSON.stringify(combined, null, 2) + '\n');
}

// --- previous report, indexed [target][engine] -> ns_per_sample -------------
let prev = null;
if (comparePath) {
  const doc = readJson(comparePath);
  const byTarget = new Map();
  for (const r of doc.runs ?? [doc]) {
    const m = new Map();
    for (const e of r.engines ?? []) m.set(e.engine, e);
    byTarget.set(r.target, m);
  }
  prev = { byTarget, generated: doc.generated ?? '(unknown date)' };
}

// --- table -----------------------------------------------------------------
const engines = [];
for (const r of runs) for (const e of r.engines ?? []) {
  if (!engines.includes(e.engine)) engines.push(e.engine);
}

const pad = (s, n) => String(s).padStart(n);
const padr = (s, n) => String(s).padEnd(n);

console.log('nisps engine benchmark — combined report');
for (const r of runs) {
  console.log(`  ${padr(r.target, 8)} block=${r.block_size} sr=${r.sample_rate} ` +
              `repeats=${r.repeats} target_ms=${r.target_ms} seed=${r.seed} ` +
              `ref=${Number(r.ref_ns_per_op).toFixed(3)} ns/op`);
}
if (prev) console.log(`  compared against ${comparePath} (${prev.generated})`);
console.log('');

let header = padr('engine', 14);
for (const r of runs) {
  header += ' | ' + padr(`${r.target} ns/smp`, 14) + pad('xRT', 8);
  if (prev) header += pad('Δ%', 8);
}
if (runs.length === 2) header += ' | ' + pad(`${runs[1].target}/${runs[0].target}`, 12);
console.log(header);
console.log('-'.repeat(header.length));

for (const id of engines) {
  let line = padr(id, 14);
  const nsByTarget = [];
  for (const r of runs) {
    const e = (r.engines ?? []).find((x) => x.engine === id);
    if (!e) {
      line += ' | ' + padr('-', 14) + pad('-', 8) + (prev ? pad('-', 8) : '');
      nsByTarget.push(null);
      continue;
    }
    nsByTarget.push(e.ns_per_sample);
    line += ' | ' + padr(e.ns_per_sample.toFixed(2), 14) + pad(e.realtime_x.toFixed(1), 8);
    if (prev) {
      const p = prev.byTarget.get(r.target)?.get(id);
      if (!p || !p.ns_per_sample) line += pad('-', 8);
      else {
        const d = ((e.ns_per_sample - p.ns_per_sample) / p.ns_per_sample) * 100;
        line += pad((d >= 0 ? '+' : '') + d.toFixed(1), 8);
      }
    }
  }
  if (runs.length === 2 && nsByTarget[0] && nsByTarget[1]) {
    line += ' | ' + pad((nsByTarget[1] / nsByTarget[0]).toFixed(2) + 'x', 12);
  } else if (runs.length === 2) {
    line += ' | ' + pad('-', 12);
  }
  console.log(line);
}

console.log('');
console.log('  ns/smp = nanoseconds per sample (lower is faster).');
console.log('  xRT    = seconds of audio produced per second of CPU (higher is faster).');
if (prev) console.log('  Δ%     = change in ns/sample vs the compared report; POSITIVE means SLOWER.');
console.log('  Nothing here fails a build. See engine_bench.cpp "REPORTING, NOT ASSERTING".');

// A short/unrepeated run is fine as a "does it still work" smoke, and useless
// as a comparison. Say which one you just did rather than letting a ±30% swing
// be read as a regression.
const lowConfidence = runs.filter((r) => (r.repeats ?? 1) < 2 || (r.target_ms ?? 0) < 50);
if (lowConfidence.length) {
  console.log('');
  console.log(`  NOTE: smoke-sized run (${lowConfidence.map((r) => r.target).join(', ')}) — ` +
              'noise floor is tens of percent. Not comparison-grade.');
} else if (prev) {
  console.log('');
  console.log('  Noise floor at these settings is roughly ±3% on an idle machine, ' +
              'occasionally ±8%.');
  console.log('  Treat |Δ%| under ~10% as noise; a real regression of the kind this ' +
              'exists to catch is 2-3x.');
}

// Working-state warnings: a timing number from an idle engine is worthless,
// so say so loudly rather than letting it sit in the table looking fine.
const idle = [];
for (const r of runs) for (const e of r.engines ?? []) {
  const ev = String(e.evidence ?? '');
  const value = Number(ev.split('=')[1]);
  if (e.engine !== 'thru' && Number.isFinite(value) && value === 0) {
    idle.push(`${r.target}/${e.engine} (${ev})`);
  }
}
if (idle.length) {
  console.log('');
  console.log(`  WARNING: engine(s) showed no working state: ${idle.join(', ')}`);
  console.log('  Their timings measure an idle engine and must not be compared.');
}

if (outPath) console.log(`\n  wrote ${outPath}`);
