#!/usr/bin/env node
/**
 * lab/ml/sweep.mjs — the ML lab's sweep driver (docs/specs/plans/ml-lab-spec.md
 * Phase 2). Expands a sweep definition into configs x seeds, runs one
 * `nisps_ml_bench` process per run in parallel, resumes, and aggregates the
 * reports into long-format tables.
 *
 *   node lab/ml/sweep.mjs run <sweep.json> [--out DIR] [--jobs N] [--bin PATH]
 *                                          [--dry-run] [--limit N] [--fresh]
 *
 * Re-running a sweep resumes it: runs whose report exists are skipped. If the
 * engine binary changed since those reports were written, the run refuses to
 * mix old and new results; pass --fresh to discard the old runs.
 *   node lab/ml/sweep.mjs aggregate <DIR>
 *
 * Normally invoked through scripts/ml-sweep.sh, which builds the engine first.
 *
 * Output (DIR defaults to nisps/build/ml-lab/<name>/, git-ignored):
 *   runs/<config_id>-s<seed>.json   raw engine report, one per run
 *   configs.jsonl                   {config_id, overrides, params} per config
 *   rows.csv                        config_id,seed,scenario,metric,value
 *   summary.csv                     config_id,scenario,metric,n,mean,sd,min,max
 *   noise.csv                       scenario,metric,configs,median_cv,max_cv
 *   manifest.json                   sweep, git commit/dirty, binary hash, failures
 *
 * The engine owns the parameter registry; this driver reads it with
 * `--list-params` and validates every key and value before the first run, so
 * a typo cannot silently measure the default. No dependencies beyond node.
 */

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, unlinkSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_BIN = join(ROOT, 'nisps/build/nisps_ml_bench');
// Measured at a6b8f87 on the VPS, default shape, one process (spec §5.1).
// Only used for --dry-run's rough estimate; bigger nets cost more.
const FULL_RUN_S = 65;
const SMOKE_RUN_S = 5;

const SWEEP_KEYS = new Set(['name', 'description', 'base', 'grid', 'sample', 'seeds', 'scenarios', 'smoke']);

function die(msg) {
  console.error(`[ml-sweep] ${msg}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const cmd = argv.shift();
const opts = { out: null, jobs: Math.max(1, Math.floor(availableParallelism() / 2)), bin: DEFAULT_BIN, dryRun: false, limit: Infinity, fresh: false };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') opts.out = argv[++i];
  else if (a === '--jobs') opts.jobs = Number(argv[++i]);
  else if (a === '--bin') opts.bin = argv[++i];
  else if (a === '--dry-run') opts.dryRun = true;
  else if (a === '--limit') opts.limit = Number(argv[++i]);
  else if (a === '--fresh') opts.fresh = true;
  else if (a.startsWith('--')) die(`unknown flag ${a}`);
  else pos.push(a);
}
if (!Number.isInteger(opts.jobs) || opts.jobs < 1) die('--jobs needs a positive integer');

// ---------------------------------------------------------------------------
// engine introspection
// ---------------------------------------------------------------------------
function engineJson(bin, args) {
  if (!existsSync(bin)) die(`engine not found at ${bin} (build it: scripts/ml-sweep.sh builds first)`);
  return JSON.parse(execFileSync(bin, args, { encoding: 'utf8' }));
}

// ---------------------------------------------------------------------------
// deterministic PRNG for sampling (mulberry32 seeded from the sweep name)
// ---------------------------------------------------------------------------
function prng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Map u in [0,1) through one sample spec.
function fromUnit(spec, u, name) {
  if (spec.choice) return spec.choice[Math.min(spec.choice.length - 1, Math.floor(u * spec.choice.length))];
  if (spec.range) return spec.range[0] + u * (spec.range[1] - spec.range[0]);
  if (spec.log) {
    const [lo, hi] = spec.log;
    if (!(lo > 0 && hi > 0)) die(`sample.${name}: log range needs positive bounds`);
    return Math.exp(Math.log(lo) + u * (Math.log(hi) - Math.log(lo)));
  }
  if (spec.int) {
    const [lo, hi] = spec.int;
    return Math.min(hi, lo + Math.floor(u * (hi - lo + 1)));
  }
  die(`sample.${name}: needs one of range / log / int / choice`);
}

function samplePoints(sample, name) {
  if (!sample) return [{}];
  const n = sample.n;
  if (!Number.isInteger(n) || n < 1) die('sample.n must be a positive integer');
  const method = sample.method ?? 'lhs';
  const rand = prng(`${name}:${sample.seed ?? 1}`);
  const names = Object.keys(sample.params ?? {});
  if (names.length === 0) die('sample.params is empty');
  const pts = Array.from({ length: n }, () => ({}));
  for (const p of names) {
    let us;
    if (method === 'lhs') {
      // One point per stratum, strata shuffled per parameter (Fisher–Yates).
      const perm = [...Array(n).keys()];
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      us = perm.map((k) => (k + rand()) / n);
    } else if (method === 'random') {
      us = Array.from({ length: n }, () => rand());
    } else die(`sample.method '${method}' is not lhs or random`);
    us.forEach((u, i) => { pts[i][p] = fromUnit(sample.params[p], u, p); });
  }
  return pts;
}

function gridPoints(grid) {
  let pts = [{}];
  for (const [k, vs] of Object.entries(grid ?? {})) {
    if (!Array.isArray(vs) || vs.length === 0) die(`grid.${k} must be a non-empty array`);
    pts = pts.flatMap((p) => vs.map((v) => ({ ...p, [k]: v })));
  }
  return pts;
}

// ---------------------------------------------------------------------------
// validation against the engine's registry
// ---------------------------------------------------------------------------
function coerce(reg, name, v) {
  const p = reg.get(name);
  if (!p) die(`unknown parameter '${name}' (see nisps_ml_bench --list-params)`);
  if (name === 'bench.seed') die("'bench.seed' is set by 'seeds', not by the config");
  if (p.type === 'enum') {
    if (!p.choices.includes(v)) die(`${name}=${v}: not one of ${p.choices.join(', ')}`);
    return v;
  }
  let x = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(x)) die(`${name}=${v}: not a number`);
  if (p.type === 'int') x = Math.round(x);
  if (x < p.min || x > p.max) die(`${name}=${x}: out of range [${p.min}, ${p.max}]`);
  return x;
}

const canonical = (obj) => JSON.stringify(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1))));
// Identity is what the engine will see: floats hashed at float32, so 0.1 and
// 0.1000000001 are one config, as they are one config in the engine.
const configId = (params, reg) => createHash('sha256').update(canonical(Object.fromEntries(
  Object.entries(params).map(([k, v]) => [k, reg.get(k)?.type === 'float' ? Math.fround(v) : v]),
))).digest('hex').slice(0, 12);

function plan(sweep, bin) {
  for (const k of Object.keys(sweep)) if (!SWEEP_KEYS.has(k)) die(`unknown sweep key '${k}'`);
  if (typeof sweep.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(sweep.name)) die('sweep.name must be a simple identifier');

  const registry = engineJson(bin, ['--list-params']);
  const reg = new Map(registry.map((p) => [p.name, p]));
  const defaults = Object.fromEntries(registry.filter((p) => p.name !== 'bench.seed').map((p) => [p.name, p.default]));

  const scenarioKeys = engineJson(bin, ['--list-scenarios']);
  const scenarios = sweep.scenarios ?? [];
  for (const tok of scenarios) {
    const hit = tok.endsWith('*') ? scenarioKeys.some((k) => k.startsWith(tok.slice(0, -1))) : scenarioKeys.includes(tok);
    if (!hit) die(`scenario '${tok}' matches nothing (keys: ${scenarioKeys.join(', ')})`);
  }

  const seeds = Array.isArray(sweep.seeds) ? sweep.seeds : Array.from({ length: sweep.seeds ?? 1 }, (_, i) => i + 1);
  if (seeds.length === 0 || seeds.some((s) => !Number.isInteger(s) || s < 0)) die('seeds must be a count or a list of non-negative integers');

  const configs = new Map();
  for (const g of gridPoints(sweep.grid)) {
    for (const s of samplePoints(sweep.sample, sweep.name)) {
      const overrides = {};
      for (const [k, v] of Object.entries({ ...(sweep.base ?? {}), ...g, ...s })) overrides[k] = coerce(reg, k, v);
      const params = { ...defaults, ...overrides };
      const id = configId(params, reg);
      if (!configs.has(id)) configs.set(id, { config_id: id, overrides, params });
    }
  }
  const varied = [...new Set([...configs.values()].flatMap((c) => Object.keys(c.overrides)))]
    .filter((k) => new Set([...configs.values()].map((c) => JSON.stringify(c.params[k]))).size > 1);

  const runs = [];
  for (const c of configs.values()) for (const seed of seeds) runs.push({ config: c, seed, file: `${c.config_id}-s${seed}.json` });
  return { registry, configs: [...configs.values()], seeds, scenarios, varied, runs };
}

// ---------------------------------------------------------------------------
// running
// ---------------------------------------------------------------------------
function validReport(path) {
  try {
    const d = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(d.scenarios) && d.scenarios.length > 0;
  } catch {
    return false;
  }
}

function argsFor(run, sweep) {
  const a = ['--set', `bench.seed=${run.seed}`];
  for (const [k, v] of Object.entries(run.config.params)) a.push('--set', `${k}=${v}`);
  if (sweep.scenarios?.length) a.push('--scenario', sweep.scenarios.join(','));
  if (sweep.smoke) a.push('--smoke');
  return a;
}

function runOne(bin, run, sweep, runsDir) {
  return new Promise((done) => {
    const t0 = Date.now();
    const out = join(runsDir, run.file);
    const tmp = `${out}.tmp`;
    const child = spawn(bin, argsFor(run, sweep), { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => { err += c; });
    child.on('close', (code) => {
      const secs = (Date.now() - t0) / 1000;
      if (code === 0) {
        writeFileSync(tmp, Buffer.concat(chunks));
        if (validReport(tmp)) {
          renameSync(tmp, out); // atomic: a report file either exists whole or not at all
          return done({ ok: true, secs });
        }
        unlinkSync(tmp);
        return done({ ok: false, secs, error: 'engine exited 0 but the report did not parse' });
      }
      done({ ok: false, secs, error: `exit ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}` });
    });
  });
}

function git(args) {
  try {
    return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function cmdRun() {
  const sweepPath = pos[0];
  if (!sweepPath) die('usage: sweep.mjs run <sweep.json> [--out DIR] [--jobs N] [--bin PATH] [--dry-run] [--limit N]');
  const sweep = JSON.parse(readFileSync(sweepPath, 'utf8'));
  const bin = resolve(opts.bin);
  const p = plan(sweep, bin);
  const dir = resolve(opts.out ?? join(ROOT, 'nisps/build/ml-lab', sweep.name));
  const runsDir = join(dir, 'runs');

  const binSha = createHash('sha256').update(readFileSync(bin)).digest('hex');
  const manifestPath = join(dir, 'manifest.json');
  if (!opts.dryRun && existsSync(runsDir)) {
    const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
    const hasRuns = readdirSync(runsDir).some((f) => f.endsWith('.json'));
    if (opts.fresh) rmSync(runsDir, { recursive: true, force: true });
    else if (hasRuns && old?.bin_sha256 !== binSha) {
      die(`${runsDir} holds runs from a different engine binary (${old?.git_commit ?? 'unknown commit'}); ` +
          'mixing them would compare two different programs. Re-run with --fresh, or use --out.');
    }
  }

  const todo = p.runs.filter((r) => !validReport(join(runsDir, r.file))).slice(0, opts.limit);
  const perRun = sweep.smoke ? SMOKE_RUN_S : FULL_RUN_S;
  const cpuS = todo.length * perRun;
  console.error(`[ml-sweep] ${sweep.name}: ${p.configs.length} configs x ${p.seeds.length} seeds = ${p.runs.length} runs; ${p.runs.length - todo.length} already done; ${todo.length} to run`);
  console.error(`[ml-sweep] varied: ${p.varied.join(', ') || '(none)'}; scenarios: ${p.scenarios.join(',') || 'all'}${sweep.smoke ? ' (smoke)' : ''}`);
  console.error(`[ml-sweep] rough cost (upper bound: all scenarios, default shape): ${(cpuS / 3600).toFixed(2)} CPU-h, ~${(cpuS / opts.jobs / 60).toFixed(1)} min at --jobs ${opts.jobs}`);
  if (opts.dryRun) {
    for (const c of p.configs) console.log(`${c.config_id}  ${canonical(c.overrides)}`);
    return;
  }

  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(dir, 'configs.jsonl'), p.configs.map((c) => JSON.stringify(c)).join('\n') + '\n');
  const manifest = {
    sweep,
    sweep_path: resolve(sweepPath),
    started: new Date().toISOString(),
    git_commit: git(['rev-parse', 'HEAD']),
    git_dirty: (git(['status', '--porcelain']) ?? '') !== '',
    bin,
    bin_sha256: binSha,
    jobs: opts.jobs,
    configs: p.configs.length,
    seeds: p.seeds,
    runs: p.runs.length,
    varied: p.varied,
    registry: p.registry,
    failures: [],
  };
  const writeManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeManifest();

  let next = 0;
  let finished = 0;
  let spent = 0;
  const t0 = Date.now();
  async function worker() {
    while (next < todo.length) {
      const r = todo[next++];
      const res = await runOne(bin, r, sweep, runsDir);
      finished++;
      spent += res.secs;
      if (!res.ok) {
        manifest.failures.push({ run: r.file, overrides: r.config.overrides, seed: r.seed, error: res.error });
        writeManifest();
      }
      const eta = ((spent / finished) * (todo.length - finished)) / opts.jobs;
      console.error(`[ml-sweep] ${finished}/${todo.length} ${res.ok ? 'ok  ' : 'FAIL'} ${r.file} ${res.secs.toFixed(1)}s  eta ${(eta / 60).toFixed(1)} min`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.jobs, todo.length) }, worker));
  manifest.finished = new Date().toISOString();
  manifest.wall_s = (Date.now() - t0) / 1000;
  writeManifest();
  aggregate(dir);
  if (manifest.failures.length) console.error(`[ml-sweep] ${manifest.failures.length} run(s) failed — see manifest.json`);
}

// ---------------------------------------------------------------------------
// aggregation
// ---------------------------------------------------------------------------
function aggregate(dir) {
  const runsDir = join(dir, 'runs');
  if (!existsSync(runsDir)) die(`${runsDir} does not exist`);
  const files = readdirSync(runsDir).filter((f) => /^[0-9a-f]{12}-s\d+\.json$/.test(f));
  const rows = ['config_id,seed,scenario,metric,value'];
  const cells = new Map(); // config|scenario|metric -> values[]
  for (const f of files.sort()) {
    const [, cid, seed] = f.match(/^([0-9a-f]{12})-s(\d+)\.json$/);
    let doc;
    try {
      doc = JSON.parse(readFileSync(join(runsDir, f), 'utf8'));
    } catch {
      console.error(`[ml-sweep] skipping unreadable ${f}`);
      continue;
    }
    for (const s of doc.scenarios) {
      for (const [m, v] of Object.entries(s.metrics)) {
        if (typeof v !== 'number') continue;
        rows.push(`${cid},${seed},${s.id},${m},${v}`);
        const key = `${cid}|${s.id}|${m}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(v);
      }
    }
  }
  writeFileSync(join(dir, 'rows.csv'), rows.join('\n') + '\n');

  const summary = ['config_id,scenario,metric,n,mean,sd,min,max'];
  const cvs = new Map(); // scenario|metric -> cv per config
  for (const [key, vs] of cells) {
    const n = vs.length;
    const mean = vs.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
    const [cid, sc, m] = key.split('|');
    summary.push(`${cid},${sc},${m},${n},${mean},${sd},${Math.min(...vs)},${Math.max(...vs)}`);
    if (n > 1 && Math.abs(mean) > 1e-12) {
      const k = `${sc}|${m}`;
      if (!cvs.has(k)) cvs.set(k, []);
      cvs.get(k).push(sd / Math.abs(mean));
    }
  }
  writeFileSync(join(dir, 'summary.csv'), summary.join('\n') + '\n');

  // Seed noise (spec §4.2.4): how much a metric moves on the seed alone. A
  // parameter effect smaller than this is not an effect.
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
  const noise = [...cvs].map(([k, xs]) => ({ k, n: xs.length, med: median(xs), max: Math.max(...xs) }))
    .sort((a, b) => b.med - a.med);
  writeFileSync(join(dir, 'noise.csv'), ['scenario,metric,configs,median_cv,max_cv',
    ...noise.map((r) => `${r.k.replace('|', ',')},${r.n},${r.med},${r.max}`)].join('\n') + '\n');

  console.error(`[ml-sweep] aggregated ${files.length} run(s), ${rows.length - 1} rows -> ${dir}`);
  if (noise.length) {
    const all = median(noise.map((r) => r.med));
    console.error(`[ml-sweep] seed noise: median CV across all metrics ${(all * 100).toFixed(1)}%; noisiest:`);
    for (const r of noise.slice(0, 5)) console.error(`             ${r.k.replace('|', ' / ')}  median CV ${(r.med * 100).toFixed(0)}%`);
  }
}

if (cmd === 'run') await cmdRun();
else if (cmd === 'aggregate') {
  if (!pos[0]) die('usage: sweep.mjs aggregate <DIR>');
  aggregate(resolve(pos[0]));
} else die('usage: sweep.mjs run <sweep.json> [...] | sweep.mjs aggregate <DIR>');
