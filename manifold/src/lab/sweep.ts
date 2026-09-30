/**
 * Sweep planning, paired statistics and recommendations for the lab. Pure —
 * shared by the hidden page (LabApp) and the CLI (scripts/lab/run.ts).
 *
 * PAIRING. Every config plays the SAME episodes: identical (seed, goal,
 * persona) triples, so the same hidden goal, the same ears and the same wander
 * path. A config's effect is then the mean of per-episode differences against
 * shipped, which cancels the (large) between-goal variance a plain comparison
 * of means would leave in.
 */
import type { EpisodeResult, EpisodeSpec } from './episode';
import type { GoalKind } from './goals';
import { configKey, describeDiff, KNOBS, SHIPPED, type KnobKey, type LabConfig } from './settings';

export interface SweepOptions {
  seeds: number;
  /** First seed (default 1). Confirm runs use HELD-OUT seeds (CONFIRM_SEED_BASE)
   *  so the configs chosen on seeds 1..n are not re-scored on the episodes that
   *  chose them — that would overstate every winner. */
  seedBase?: number;
  goals: GoalKind[];
  personas: string[];
}

export interface Plan {
  kind: 'oat' | 'confirm';
  configs: LabConfig[];
  specs: EpisodeSpec[];
}

function uniq(cs: LabConfig[]): LabConfig[] {
  const seen = new Set<string>();
  return cs.filter((c) => {
    const k = configKey(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function specsFor(configs: LabConfig[], o: SweepOptions): EpisodeSpec[] {
  const specs: EpisodeSpec[] = [];
  for (const config of configs)
    for (const goal of o.goals)
      for (const persona of o.personas)
        for (let i = 0; i < o.seeds; i++) specs.push({ config, seed: (o.seedBase ?? 1) + i, goal, persona });
  return specs;
}

/**
 * One-at-a-time around shipped, once per feedback mode: shipped, the shipped
 * config in the other mode, and each knob's candidates varied alone from each
 * mode's base. Mode-specific knobs are only varied in their own mode.
 */
export function planOat(o: SweepOptions, knobs: readonly KnobKey[] = KNOBS.map((k) => k.key)): Plan {
  const bases: LabConfig[] = (['geometric-dislike', 'explore-and-place'] as const).map((m) => ({ ...SHIPPED, feedbackMode: m }));
  const configs: LabConfig[] = [{ ...SHIPPED }, ...bases];
  for (const base of bases) {
    for (const k of KNOBS) {
      if (k.key === 'feedbackMode' || !knobs.includes(k.key)) continue;
      if (k.onlyIn && k.onlyIn !== base.feedbackMode) continue;
      for (const v of k.candidates) configs.push({ ...base, [k.key]: v } as LabConfig);
    }
  }
  const unique = uniq(configs);
  return { kind: 'oat', configs: unique, specs: specsFor(unique, o) };
}

export const CONFIRM_SEED_BASE = 1001;

/** Shipped vs explicit candidates (e.g. the combined recommendation), on
 *  held-out seeds unless the caller says otherwise. */
export function planConfirm(candidates: LabConfig[], o: SweepOptions): Plan {
  const unique = uniq([{ ...SHIPPED }, ...candidates]);
  return { kind: 'confirm', configs: unique, specs: specsFor(unique, { ...o, seedBase: o.seedBase ?? CONFIRM_SEED_BASE }) };
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
  /** Paired per-episode score difference vs SHIPPED. */
  delta: Stat;
  /** Share of paired episodes where this config beat shipped (ties = half). */
  winRate: number;
  byGoal: Partial<Record<GoalKind, Stat>>;
  deltaByGoal: Partial<Record<GoalKind, Stat>>;
  qualityEnd: Stat;
  wallMs: number;
}

const episodeKey = (r: EpisodeResult) => `${r.goal}|${r.persona}|${r.seed}`;

export function summarise(configs: LabConfig[], results: EpisodeResult[]): ConfigSummary[] {
  const byConfig = new Map<string, EpisodeResult[]>();
  for (const r of results) {
    if (!byConfig.has(r.configKey)) byConfig.set(r.configKey, []);
    byConfig.get(r.configKey)!.push(r);
  }
  const shippedKey = configKey(SHIPPED as LabConfig);
  const shipped = new Map((byConfig.get(shippedKey) ?? []).map((r) => [episodeKey(r), r]));

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
      const b = shipped.get(episodeKey(r));
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
 * From a one-at-a-time sweep: the better feedback mode (if it credibly beats
 * shipped), then — within that mode — each knob's best candidate whose paired
 * improvement over that mode's base is credible. Knobs were varied alone, so
 * the combination is a HYPOTHESIS: `proposed` must be checked with
 * planConfirm before it ships.
 */
export function recommend(results: EpisodeResult[]): { recs: Recommendation[]; proposed: LabConfig } {
  const keys = new Set(results.map((r) => r.configKey));
  const shippedKey = configKey(SHIPPED as LabConfig);
  const recs: Recommendation[] = [];

  let mode = SHIPPED.feedbackMode;
  const other = mode === 'geometric-dislike' ? 'explore-and-place' : 'geometric-dislike';
  const otherKey = configKey({ ...SHIPPED, feedbackMode: other } as LabConfig);
  if (keys.has(otherKey)) {
    const d = pairedDelta(results, otherKey, shippedKey);
    if (credible(d)) {
      recs.push({ key: 'feedbackMode', from: mode, to: other, delta: d });
      mode = other;
    }
  }
  const base: LabConfig = { ...SHIPPED, feedbackMode: mode };
  const baseKey = configKey(base);
  const proposed: LabConfig = { ...base };
  if (!keys.has(baseKey)) return { recs, proposed };

  for (const k of KNOBS) {
    if (k.key === 'feedbackMode' || (k.onlyIn && k.onlyIn !== mode)) continue;
    let best: { v: number | string; d: Stat } | null = null;
    for (const v of k.candidates) {
      if (v === base[k.key]) continue;
      const key = configKey({ ...base, [k.key]: v } as LabConfig);
      if (!keys.has(key)) continue;
      const d = pairedDelta(results, key, baseKey);
      if (credible(d) && (!best || d.mean > best.d.mean)) best = { v, d };
    }
    if (best) {
      recs.push({ key: k.key, from: base[k.key], to: best.v, delta: best.d });
      (proposed as unknown as Record<string, unknown>)[k.key] = best.v;
    }
  }
  return { recs, proposed };
}
