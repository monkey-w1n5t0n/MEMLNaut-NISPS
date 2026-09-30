/**
 * Manifold ML lab — command-line runner (ml-lab-spec Phase 3). Same episodes,
 * statistics and recommendations as the hidden `?lab=1` page, for sweeps too
 * big to babysit in a tab.
 *
 *   bun run lab                                   # one-at-a-time sweep, 8 seeds
 *   bun run lab -- --seeds 16 --jobs 6 --out lab.json
 *   bun run lab -- --confirm learningRate=0.01,nudgeStddev=0.1     # ';' separates several candidates
 *   bun run lab -- --knobs learningRate,maxIterations --goals place
 *   bun run lab -- --grid learningRate,optimMaxAdjLr        # every pair of values
 *   bun run lab -- --presets all                            # named configs head to head
 *   bun run lab -- --base optimMaxAdjLr=1000000,learningRate=0.003   # OAT around a new origin
 *
 * Parallelism is one child bun process per job (each loads its own WASM), fed
 * episode specs over stdin and answering results over stdout, one JSON per
 * line. Do not run big sweeps on the production VPS (spec §5.3).
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEpisode, type EpisodeResult, type EpisodeSpec } from '../../src/lab/episode';
import type { GoalKind } from '../../src/lab/goals';
import { PERSONAS } from '../../src/lab/personas';
import { describeDiff, KNOBS, PRESETS, SHIPPED, type KnobKey, type LabConfig } from '../../src/lab/settings';
import { originFrom, planConfirm, planGrid, planOat, planPresets, recommend, summarise, type Plan } from '../../src/lab/sweep';
import { loadModule } from './load-module';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

// ---------------------------------------------------------------------------
// child: run specs from stdin until it closes
// ---------------------------------------------------------------------------
if (argv[0] === '--child') {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const { i, spec } = JSON.parse(line) as { i: number; spec: EpisodeSpec };
    try {
      const r = await runEpisode(spec, loadModule);
      process.stdout.write(JSON.stringify({ i, r }) + '\n');
    } catch (e) {
      process.stdout.write(JSON.stringify({ i, error: String((e as Error)?.stack ?? e) }) + '\n');
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// parent
// ---------------------------------------------------------------------------
function die(msg: string): never {
  console.error(`[lab] ${msg}`);
  process.exit(2);
}

const opt = {
  seeds: 8,
  jobs: Math.max(1, Math.floor(availableParallelism() / 2)),
  goals: ['place', 'taste'] as GoalKind[],
  personas: PERSONAS.map((p) => p.id),
  knobs: KNOBS.map((k) => k.key) as KnobKey[],
  confirm: null as string | null,
  base: null as string | null,
  grid: null as string | null,
  presets: null as string | null,
  out: null as string | null,
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  const v = () => argv[++i] ?? die(`${a} needs a value`);
  if (a === '--seeds') opt.seeds = Number(v());
  else if (a === '--jobs') opt.jobs = Number(v());
  else if (a === '--goals') opt.goals = v().split(',') as GoalKind[];
  else if (a === '--personas') opt.personas = v().split(',');
  else if (a === '--knobs') opt.knobs = v().split(',') as KnobKey[];
  else if (a === '--confirm') opt.confirm = v();
  else if (a === '--base') opt.base = v();
  else if (a === '--grid') opt.grid = v();
  else if (a === '--presets') opt.presets = v();
  else if (a === '--out') opt.out = v();
  else die(`unknown flag ${a}`);
}
for (const k of opt.knobs) if (!KNOBS.some((x) => x.key === k)) die(`unknown knob ${k}`);
for (const p of opt.personas) if (!PERSONAS.some((x) => x.id === p)) die(`unknown persona ${p}`);
for (const g of opt.goals) if (g !== 'place' && g !== 'taste') die(`unknown goal ${g}`);

function parseConfig(s: string, from: LabConfig = originFrom()): LabConfig {
  const c: Record<string, unknown> = { ...from };
  for (const kv of s.split(',')) {
    const [k, raw] = kv.split('=');
    const knob = KNOBS.find((x) => x.key === k);
    if (!knob || raw === undefined) die(`bad config entry '${kv}' (want knob=value)`);
    if (knob.kind === 'enum' && !knob.choices!.includes(raw)) die(`${k}: '${raw}' is not one of ${knob.choices!.join(', ')}`);
    const n = Number(raw);
    if (knob.kind !== 'enum' && !Number.isFinite(n)) die(`${k}: '${raw}' is not a number`);
    c[k!] = knob.kind === 'enum' ? raw : n;
  }
  return c as unknown as LabConfig;
}

const so = { seeds: opt.seeds, goals: opt.goals, personas: opt.personas };
const origin = opt.base ? parseConfig(opt.base) : originFrom();
let plan: Plan;
if (opt.confirm) plan = planConfirm(opt.confirm.split(';').map((c) => parseConfig(c, origin)), so, origin);
else if (opt.grid) {
  const [a, b] = opt.grid.split(',') as KnobKey[];
  if (!a || !b) die('--grid needs two knobs: --grid learningRate,optimMaxAdjLr');
  plan = planGrid(so, a, b, origin);
} else if (opt.presets) {
  const ids = opt.presets === 'all' ? PRESETS.map((p) => p.id) : opt.presets.split(',');
  for (const i of ids) if (!PRESETS.some((p) => p.id === i)) die(`unknown preset ${i} (have: ${PRESETS.map((p) => p.id).join(', ')})`);
  plan = planPresets(PRESETS.filter((p) => ids.includes(p.id)), so);
} else plan = planOat(so, opt.knobs, origin);
console.error(`[lab] ${plan.kind}: ${plan.configs.length} configs x ${opt.goals.length} goals x ${opt.personas.length} personas x ${opt.seeds} seeds = ${plan.specs.length} episodes on ${opt.jobs} jobs`);

const results: EpisodeResult[] = new Array(plan.specs.length);
let done = 0;
let failed = 0;
const t0 = performance.now();

await new Promise<void>((resolve) => {
  let next = 0;
  let live = 0;
  const feed = (child: ReturnType<typeof spawn>) => {
    if (next < plan.specs.length) {
      const i = next++;
      child.stdin!.write(JSON.stringify({ i, spec: plan.specs[i] }) + '\n');
    } else child.stdin!.end();
  };
  for (let j = 0; j < Math.min(opt.jobs, plan.specs.length); j++) {
    const child = spawn(process.execPath, ['--preload', join(here, 'bun-shim.ts'), join(here, 'run.ts'), '--child'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    live++;
    createInterface({ input: child.stdout! }).on('line', (line) => {
      const msg = JSON.parse(line) as { i: number; r?: EpisodeResult; error?: string };
      if (msg.r) results[msg.i] = msg.r;
      else { failed++; console.error(`[lab] episode ${msg.i} failed: ${msg.error}`); }
      done++;
      if (done % 50 === 0 || done === plan.specs.length) {
        const el = (performance.now() - t0) / 1000;
        console.error(`[lab] ${done}/${plan.specs.length}  ${el.toFixed(0)}s  eta ${((el / done) * (plan.specs.length - done)).toFixed(0)}s`);
      }
      feed(child);
    });
    child.on('close', () => { if (--live === 0) resolve(); });
    feed(child);
    feed(child); // keep one queued so the child never idles on IPC
  }
});

const ok = results.filter(Boolean);
const summaries = summarise(plan.configs, ok, plan.origin);
const { recs, proposed } = plan.kind === 'oat' ? recommend(ok, plan.origin) : { recs: [], proposed: plan.origin };

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;
const originIsShipped = describeDiff(plan.origin) === 'shipped';
console.log(`\n${(originIsShipped ? 'config (vs shipped)' : 'config (vs origin)').padEnd(58)} score   Δ (95% CI)          win   place Δ   taste Δ   lurch  likeErr`);
for (const s of summaries) {
  const sig = s.delta.n > 1 && (s.delta.mean - s.delta.ci > 0 ? ' ▲' : s.delta.mean + s.delta.ci < 0 ? ' ▼' : '  ');
  const g = (k: GoalKind) => (s.deltaByGoal[k] ? pct(s.deltaByGoal[k]!.mean).padStart(7) : '      -');
  console.log(`${s.diff.replace('feedbackMode=explore-and-place', 'explore&place').replace('feedbackMode=geometric-dislike', 'push-away').padEnd(58)} ${s.score.mean.toFixed(3)}   ${pct(s.delta.mean).padStart(6)} ± ${(s.delta.ci * 100).toFixed(1).padStart(4)}${sig}      ${(s.winRate * 100).toFixed(0).padStart(3)}%  ${g('place')}  ${g('taste')}  ${s.lurch.mean.toFixed(3).padStart(6)}  ${(s.likeErr.n ? s.likeErr.mean.toFixed(3) : '-').padStart(6)}`);
}
if (plan.kind === 'confirm') {
  console.log(`\nconfirm run on held-out seeds ${plan.specs[0]?.seed}..${plan.specs[0]!.seed + opt.seeds - 1}: a credible Δ above (▲) means the combination holds up.`);
} else {
  console.log('\nrecommended changes (each credible alone; combination unconfirmed):');
  if (!recs.length) console.log('  none — nothing credibly beats shipped at this sample size');
  for (const r of recs) console.log(`  ${r.key}: ${r.from} → ${r.to}   Δ ${pct(r.delta.mean)} ± ${(r.delta.ci * 100).toFixed(1)} pts`);
}
if (plan.kind === 'oat' && recs.length) {
  const flag = KNOBS.filter((k) => proposed[k.key] !== SHIPPED[k.key]).map((k) => `${k.key}=${proposed[k.key]}`).join(',');
  console.log(`\nconfirm with:  bun run lab -- --confirm ${flag}`);
}
if (plan.kind === 'compare') console.log('\npresets: ' + PRESETS.map((p) => p.id).join(', '));
console.error(`[lab] ${ok.length} ok, ${failed} failed, ${((performance.now() - t0) / 1000).toFixed(0)}s`);

if (opt.out) {
  let commit: string | null = null;
  let dirty = false;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
  } catch { /* not a checkout */ }
  writeFileSync(opt.out, JSON.stringify({
    schema: 'manifold-lab/1', created: new Date().toISOString(), commit, dirty,
    options: opt, shipped: SHIPPED, plan: { kind: plan.kind, configs: plan.configs.map((c) => ({ config: c, diff: describeDiff(c) })) },
    summaries, recommendations: recs, proposed, results: ok,
  }, null, 1));
  console.error(`[lab] wrote ${opt.out}`);
}
