/**
 * Sweep planning, paired statistics and recommendations for the lab. Pure —
 * shared by the hidden page (LabApp) and the CLI (scripts/lab/run.ts).
 *
 * PAIRING. Every config plays the SAME episodes: identical (seed, goal,
 * persona) triples, so the same hidden goal, the same ears and the same wander
 * path. A config's effect is then the mean of per-episode differences against
 * a baseline, which cancels the (large) between-goal variance a plain
 * comparison of means would leave in.
 *
 * CANONICAL CONFIGS. A knob that does nothing in a config (a dislike rate in
 * explore-and-place, a background rate in burst learning) is pinned to its
 * shipped value (settings.canon), so configs that behave identically are one
 * config and never get played, paired or "recommended" twice.
 */
import type { EpisodeResult, EpisodeSpec } from './episode';
import type { GoalKind } from './goals';
import {
  applies,
  canon,
  configKey,
  describeDiff,
  KNOBS,
  SHIPPED,
  type FeedbackModeId,
  type KnobKey,
  type LabConfig,
  type LikeModeId,
  type Preset,
} from './settings';

export interface SweepOptions {
  seeds: number;
  /** First seed (default 1). Confirm runs use HELD-OUT seeds (CONFIRM_SEED_BASE)
   *  so the configs chosen on seeds 1..n are not re-scored on the episodes that
   *  chose them — that would overstate every winner. */
  seedBase?: number;
  goals: GoalKind[];
  personas: string[];
}

export type PlanKind = 'oat' | 'grid' | 'compare' | 'confirm';

export interface Plan {
  kind: PlanKind;
  configs: LabConfig[];
  specs: EpisodeSpec[];
  /** The config the recommendation and deltas are measured against. */
  origin: LabConfig;
}

const MODES: readonly FeedbackModeId[] = ['geometric-dislike', 'explore-and-place'];
const LIKE_MODES: readonly LikeModeId[] = ['burst', 'background'];

function uniq(cs: LabConfig[]): LabConfig[] {
  const seen = new Set<string>();
  const out: LabConfig[] = [];
  for (const c of cs) {
    const k = configKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(canon(c));
  }
  return out;
}

function specsFor(configs: LabConfig[], o: SweepOptions): EpisodeSpec[] {
  const specs: EpisodeSpec[] = [];
  for (const config of configs)
    for (const goal of o.goals)
      for (const persona of o.personas)
        for (let i = 0; i < o.seeds; i++) specs.push({ config, seed: (o.seedBase ?? 1) + i, goal, persona });
  return specs;
}

/** SHIPPED with some knobs overridden — the "where do we start from" config. */
export function originFrom(overrides: Partial<LabConfig> = {}): LabConfig {
  return { ...(SHIPPED as LabConfig), ...overrides };
}

/**
 * One-at-a-time around `origin`, once per (feedback mode x like mode) base:
 * the origin itself, the other bases, and each applicable knob's candidates
 * alone on each base. Knobs that do nothing on a base are skipped.
 */
export function planOat(
  o: SweepOptions,
  knobs: readonly KnobKey[] = KNOBS.map((k) => k.key),
  origin: LabConfig = originFrom(),
): Plan {
  const bases: LabConfig[] = [];
  for (const m of MODES) for (const l of LIKE_MODES) bases.push({ ...origin, feedbackMode: m, likeMode: l });
  const configs: LabConfig[] = [origin, ...bases];
  for (const base of bases) {
    for (const k of KNOBS) {
      if (k.key === 'feedbackMode' || k.key === 'likeMode' || !knobs.includes(k.key) || !applies(k, base)) continue;
      for (const v of k.candidates) configs.push({ ...base, [k.key]: v } as LabConfig);
    }
  }
  const unique = uniq(configs);
  return { kind: 'oat', configs: unique, specs: specsFor(unique, o), origin: canon(origin) };
}

/** Every combination of two knobs' candidate values on one base. */
export function planGrid(o: SweepOptions, a: KnobKey, b: KnobKey, base: LabConfig = originFrom()): Plan {
  const ka = KNOBS.find((k) => k.key === a);
  const kb = KNOBS.find((k) => k.key === b);
  if (!ka || !kb) throw new Error(`unknown knob ${!ka ? a : b}`);
  const configs: LabConfig[] = [base];
  for (const va of ka.candidates) for (const vb of kb.candidates) configs.push({ ...base, [a]: va, [b]: vb } as LabConfig);
  const unique = uniq(configs);
  return { kind: 'grid', configs: unique, specs: specsFor(unique, o), origin: canon(base) };
}

/** Named whole configs head to head, on held-out seeds by default. */
export function planPresets(presets: readonly Preset[], o: SweepOptions): Plan {
  const unique = uniq([originFrom(), ...presets.map((p) => p.config)]);
  return { kind: 'compare', configs: unique, specs: specsFor(unique, { ...o, seedBase: o.seedBase ?? CONFIRM_SEED_BASE }), origin: canon(originFrom()) };
}

export const CONFIRM_SEED_BASE = 1001;

/** Origin vs explicit candidates (e.g. the combined recommendation), on
 *  held-out seeds unless the caller says otherwise. */
export function planConfirm(candidates: LabConfig[], o: SweepOptions, origin: LabConfig = originFrom()): Plan {
  const unique = uniq([origin, ...candidates]);
  return { kind: 'confirm', configs: unique, specs: specsFor(unique, { ...o, seedBase: o.seedBase ?? CONFIRM_SEED_BASE }), origin: canon(origin) };
}

// ---------------------------------------------------------------------------
// statistics
// ---------------------------------------------------------------------------

export interface Stat {
  n: number;
  mean: number;
  /** Half-width of a normal-approximation 95% interval. */
  ci: number;
}

export function stat(xs: number[]): Stat {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, ci: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, ci: n > 1 ? (1.96 * sd) / Math.sqrt(n) : 0 };
}

export interface ConfigSummary {
  key: string;
  config: LabConfig;
  diff: string;
  score: Stat;
  /** Paired per-episode score difference vs the plan's origin. */
  delta: Stat;
  /** Share of paired episodes where this config beat the origin (ties = half). */
  winRate: number;
  byGoal: Partial<Record<GoalKind, Stat>>;
  deltaByGoal: Partial<Record<GoalKind, Stat>>;
  qualityEnd: Stat;
  /** Mapping movement per gesture (see EpisodeResult.lurch). */
  lurch: Stat;
  /** Retention error at liked places (episodes with no likes are left out). */
  likeErr: Stat;
  wallMs: number;
}

const episodeKey = (r: EpisodeResult) => `${r.goal}|${r.persona}|${r.seed}`;

export function summarise(configs: LabConfig[], results: EpisodeResult[], origin: LabConfig = originFrom()): ConfigSummary[] {
  const byConfig = new Map<string, EpisodeResult[]>();
  for (const r of results) {
    if (!byConfig.has(r.configKey)) byConfig.set(r.configKey, []);
    byConfig.get(r.configKey)!.push(r);
  }
  const originKey = configKey(origin);
  const base = new Map((byConfig.get(originKey) ?? []).map((r) => [episodeKey(r), r]));

  const out: ConfigSummary[] = [];
  for (const config of configs) {
    const key = configKey(config);
    const rs = byConfig.get(key) ?? [];
    if (rs.length === 0) continue;
    const deltas: number[] = [];
    const dGoal = new Map<GoalKind, number[]>();
    const sGoal = new Map<GoalKind, number[]>();
    let wins = 0;
    for (const r of rs) {
      if (!sGoal.has(r.goal)) sGoal.set(r.goal, []);
      sGoal.get(r.goal)!.push(r.score);
      const b = base.get(episodeKey(r));
      if (!b) continue;
      const d = r.score - b.score;
      deltas.push(d);
      if (!dGoal.has(r.goal)) dGoal.set(r.goal, []);
      dGoal.get(r.goal)!.push(d);
      wins += d > 1e-9 ? 1 : Math.abs(d) <= 1e-9 ? 0.5 : 0;
    }
    out.push({
      key,
      config,
      diff: describeDiff(config),
      score: stat(rs.map((r) => r.score)),
      delta: stat(deltas),
      winRate: deltas.length ? wins / deltas.length : 0,
      byGoal: Object.fromEntries([...sGoal].map(([g, xs]) => [g, stat(xs)])),
      deltaByGoal: Object.fromEntries([...dGoal].map(([g, xs]) => [g, stat(xs)])),
      qualityEnd: stat(rs.map((r) => r.qualityEnd)),
      lurch: stat(rs.map((r) => r.lurch ?? 0)),
      likeErr: stat(rs.filter((r) => r.likeErr !== null && r.likeErr !== undefined).map((r) => r.likeErr as number)),
      wallMs: rs.reduce((a, r) => a + r.wallMs, 0) / rs.length,
    });
  }
  return out.sort((a, b) => b.delta.mean - a.delta.mean);
}

/** A change is credible when its whole 95% interval clears zero. */
export const credible = (s: Stat) => s.n > 1 && s.mean - s.ci > 0;

export interface Recommendation {
  key: KnobKey;
  from: number | string;
  to: number | string;
  delta: Stat;
}

/** Paired per-episode score difference a − b over the episodes both played. */
export function pairedDelta(results: EpisodeResult[], a: string, b: string): Stat {
  const bs = new Map(results.filter((r) => r.configKey === b).map((r) => [episodeKey(r), r.score]));
  const ds: number[] = [];
  for (const r of results) {
    if (r.configKey !== a) continue;
    const v = bs.get(episodeKey(r));
    if (v !== undefined) ds.push(r.score - v);
  }
  return stat(ds);
}

/**
 * From a one-at-a-time sweep: the best (feedback mode x like mode) base if it
 * credibly beats the origin, then — within that base — each applicable knob's
 * best candidate whose paired improvement over the base is credible. Knobs
 * were varied alone, so the combination is a HYPOTHESIS: `proposed` must be
 * checked with planConfirm before it ships.
 */
export function recommend(
  results: EpisodeResult[],
  origin: LabConfig = originFrom(),
): { recs: Recommendation[]; proposed: LabConfig } {
  const keys = new Set(results.map((r) => r.configKey));
  const originKey = configKey(origin);
  const recs: Recommendation[] = [];

  // 1. The better base, if credibly better than the origin.
  let best: { cfg: LabConfig; d: Stat; changed: KnobKey[] } | null = null;
  for (const m of MODES) {
    for (const l of LIKE_MODES) {
      const cfg = { ...origin, feedbackMode: m, likeMode: l } as LabConfig;
      const key = configKey(cfg);
      if (key === originKey || !keys.has(key)) continue;
      const d = pairedDelta(results, key, originKey);
      if (credible(d) && (!best || d.mean > best.d.mean)) {
        best = { cfg, d, changed: [...(m !== origin.feedbackMode ? (['feedbackMode'] as KnobKey[]) : []), ...(l !== origin.likeMode ? (['likeMode'] as KnobKey[]) : [])] };
      }
    }
  }
  let base: LabConfig = { ...origin };
  if (best) {
    for (const k of best.changed) recs.push({ key: k, from: origin[k], to: best.cfg[k], delta: best.d });
    base = best.cfg;
  }
  const baseKey = configKey(base);
  const proposed: LabConfig = { ...base };
  if (!keys.has(baseKey)) return { recs, proposed };

  // 2. Each applicable knob's best credible candidate on that base.
  for (const k of KNOBS) {
    if (k.key === 'feedbackMode' || k.key === 'likeMode' || !applies(k, base)) continue;
    let win: { v: number | string; d: Stat } | null = null;
    for (const v of k.candidates) {
      if (v === base[k.key]) continue;
      const key = configKey({ ...base, [k.key]: v } as LabConfig);
      if (!keys.has(key) || key === baseKey) continue;
      const d = pairedDelta(results, key, baseKey);
      if (credible(d) && (!win || d.mean > win.d.mean)) win = { v, d };
    }
    if (win) {
      recs.push({ key: k.key, from: base[k.key], to: win.v, delta: win.d });
      (proposed as unknown as Record<string, unknown>)[k.key] = win.v;
    }
  }
  return { recs, proposed: canon(proposed) };
}
