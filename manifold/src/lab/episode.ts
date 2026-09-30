/**
 * One simulated session: a persona with a hidden goal plays Manifold's REAL
 * engine (EngineApi + FeedbackController, same WASM) under one config, and the
 * lab scores how close the mapping got and how fast.
 *
 * FIDELITY CONTRACT (ml-lab-spec §4.3): every gesture goes through the same
 * controller/engine calls ConsoleApp's handlers make — cited inline — never a
 * lab re-implementation of what a like or a dislike does. Time between
 * gestures runs on a VirtualClock, so the geometric replay timer fires exactly
 * as it would have over that wall-clock gap.
 *
 * No React, no DOM: runs in a Web Worker (the hidden `?lab=1` page) and under
 * bun (scripts/lab/). The caller supplies the Emscripten module loader.
 */
import { createEngine, type EngineApi } from '../engine/engine-api';
import type { NispsModule } from '../engine/types';
import { FeedbackController } from '../feedback/controller';
import { VirtualClock } from './clock';
import { makeGoal, perceived, tasteUtility, type Goal, type GoalKind, type Point } from './goals';
import { persona as personaById, type Persona } from './personas';
import { Rng } from './rng';
import { BOOT_IO, configKey, type LabConfig } from './settings';

export interface EpisodeSpec {
  config: LabConfig;
  seed: number;
  goal: GoalKind;
  persona: string;
}

export interface EpisodeResult {
  configKey: string;
  seed: number;
  goal: GoalKind;
  persona: string;
  /**
   * Provisional composite in [0,1] (to be calibrated, spec Phase 5):
   * 0.5 x final quality + 0.5 x mean quality over the session, so a config
   * that gets there sooner scores higher than one that gets there last.
   */
  score: number;
  /** Goal quality at the end, in [0,1] — place: share of targets hit;
   *  taste: coverage x (0.5 + 0.5 variety). */
  qualityEnd: number;
  success: boolean;
  /** First gesture after which the goal was met on the real net; null = never. */
  gesturesToSuccess: number | null;
  gestures: number;
  /** place: mean target error; taste: 1 - coverage. Lower is better. */
  errStart: number;
  errEnd: number;
  /** taste only: share of the pad the listener likes, and how varied it is. */
  coverage: number;
  variety: number;
  /** Goal quality after each gesture (real net; carried while exploring). */
  curve: number[];
  counts: Record<GestureName, number>;
  field: FieldSummary;
  wallMs: number;
}

export type GestureName =
  | 'like' | 'dislike' | 'nudge' | 'randomise'
  | 'explore' | 'reroll' | 'undo' | 'place' | 'commit' | 'finalise' | 'move';

export interface FieldSummary {
  /** Mean per-output p99-p1 over the pad: how much of each range is reachable. */
  rangeUtil: number;
  /** p95/p50 of local gain: coexisting cliffs and flat spots. */
  cliff: number;
  /** Share of the pad with gain < 10% of the median. */
  deadFrac: number;
}

const GRID = 16; // goal-scoring grid (taste), 256 points
const FIELD_GRID = 24; // field-metric grid, 576 points

function grid(n: number): Point[] {
  const pts: Point[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push([(i + 0.5) / n, (j + 0.5) / n]);
  return pts;
}
const GOAL_GRID = grid(GRID);
const FIELD_PTS = grid(FIELD_GRID);

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = q * (s.length - 1);
  const lo = Math.floor(i);
  const hi = Math.min(s.length - 1, lo + 1);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

class Session {
  readonly eng: EngineApi;
  readonly fc: FeedbackController;
  readonly clock: VirtualClock;
  readonly nOut: number;
  readonly counts = Object.fromEntries(
    (['like', 'dislike', 'nudge', 'randomise', 'explore', 'reroll', 'undo', 'place', 'commit', 'finalise', 'move'] as const)
      .map((g) => [g, 0]),
  ) as Record<GestureName, number>;
  gestures = 0;
  likes = 0;

  constructor(eng: EngineApi, fc: FeedbackController, clock: VirtualClock, private p: Persona) {
    this.eng = eng;
    this.fc = fc;
    this.clock = clock;
    this.nOut = eng.architecture.outputSize;
  }

  get exploring(): boolean {
    return this.fc.getState().exploring;
  }

  get budgetLeft(): number {
    return this.p.budget - this.gestures;
  }

  /** Move to `at` and listen. What the user hears is the ROUTED vector. */
  hear(at: Point): Float32Array {
    this.eng.setInput(at[0], at[1]);
    return new Float32Array(this.eng.routedOutput() ?? this.eng.getOutputs());
  }

  /** One gesture: count it, then let the persona's inter-gesture gap elapse. */
  private tick(g: GestureName): void {
    this.counts[g]++;
    this.gestures++;
    this.clock.advance(this.p.gestureMs);
    this.onGesture?.();
  }
  onGesture?: () => void;

  // ---- push-away mode (ConsoleApp commit / perturb / nudgeNet / reroll) ----
  like(at: Point): void {
    this.hear(at);
    // ConsoleApp commit: c.like(pos, engine.getOutputs()) — the RAW output.
    this.fc.like(at, this.eng.getOutputs());
    this.likes++;
    this.tick('like');
  }
  dislike(at: Point): void {
    this.hear(at);
    // ConsoleApp perturb (pointer-down): c.dislike(engine.routedOutput() ?? …).
    this.fc.dislike(this.eng.routedOutput() ?? new Float32Array(0));
    this.tick('dislike');
  }
  nudgeReal(): void {
    // ConsoleApp nudgeNet outside a scratchpad: literal 0.05, then process.
    this.eng.feedback.nudge(0.05);
    this.eng.process();
    this.tick('nudge');
  }
  randomiseReal(spread: number): void {
    // ConsoleApp reroll outside a scratchpad: engine.randomise(randomisationSpread).
    this.eng.randomise(spread);
    this.tick('randomise');
  }
  move(): void {
    this.tick('move');
  }

  // ---- explore-and-place (ConsoleApp perturb release / pills / banner) ----
  explore(): void {
    this.fc.enterExplore();
    this.tick('explore');
  }
  reroll(): void {
    this.fc.reroll();
    this.tick('reroll');
  }
  nudge(): void {
    this.fc.nudge();
    this.tick('nudge');
  }
  undo(): void {
    this.fc.undo();
    this.tick('undo');
  }
  placeAt(at: Point): void {
    this.fc.place(); // thumbs-up while exploring
    this.tick('place');
    this.fc.placeCommit(at[0], at[1]); // tap the pad (re-enters explore)
    this.tick('commit');
  }
  finalise(): void {
    this.fc.finalise(); // banner "done": exit explore, add anchors, train
    this.tick('finalise');
  }
}

/** Salience-weighted error of the REAL net at each place target. */
function placeErrors(eng: EngineApi, goal: Extract<Goal, { kind: 'place' }>): number[] {
  const out = eng.inferBatch(goal.targets.map((t) => t.at));
  const n = eng.architecture.outputSize;
  return goal.targets.map((t, k) => perceived(out.subarray(k * n, (k + 1) * n), t.sound, goal.salience));
}

function tasteField(eng: EngineApi, goal: Extract<Goal, { kind: 'taste' }>): { coverage: number; variety: number } {
  const out = eng.inferBatch(GOAL_GRID);
  const n = eng.architecture.outputSize;
  const hits = new Array(goal.likes.length).fill(0);
  let covered = 0;
  for (let i = 0; i < GOAL_GRID.length; i++) {
    const y = out.subarray(i * n, (i + 1) * n);
    if (tasteUtility(goal, y) <= 0.5) continue;
    covered++;
    let best = 0;
    let bestD = Infinity;
    goal.likes.forEach((l, j) => {
      const d = perceived(y, l.centre, goal.salience);
      if (d < bestD) { bestD = d; best = j; }
    });
    hits[best]++;
  }
  let h = 0;
  for (const c of hits) if (c > 0) { const p = c / covered; h -= p * Math.log(p); }
  const variety = goal.likes.length > 1 && covered > 0 ? h / Math.log(goal.likes.length) : 0;
  return { coverage: covered / GOAL_GRID.length, variety };
}

function fieldSummary(eng: EngineApi): FieldSummary {
  const out = eng.inferBatch(FIELD_PTS);
  const n = eng.architecture.outputSize;
  const G = FIELD_GRID;
  let util = 0;
  for (let j = 0; j < n; j++) {
    const col: number[] = [];
    for (let i = 0; i < FIELD_PTS.length; i++) col.push(out[i * n + j]!);
    util += quantile(col, 0.99) - quantile(col, 0.01);
  }
  // Local gain by forward differences on the grid (per unit input distance).
  const gains: number[] = [];
  const h = 1 / G;
  for (let y = 0; y < G - 1; y++) {
    for (let x = 0; x < G - 1; x++) {
      const a = (y * G + x) * n;
      const bx = (y * G + x + 1) * n;
      const by = ((y + 1) * G + x) * n;
      let sx = 0;
      let sy = 0;
      for (let j = 0; j < n; j++) {
        sx += (out[bx + j]! - out[a + j]!) ** 2;
        sy += (out[by + j]! - out[a + j]!) ** 2;
      }
      gains.push(Math.sqrt((sx + sy) / n) / h);
    }
  }
  const p50 = quantile(gains, 0.5);
  const p95 = quantile(gains, 0.95);
  const dead = gains.filter((g) => g < 0.1 * p50).length / gains.length;
  return { rangeUtil: util / n, cliff: p50 > 1e-9 ? p95 / p50 : 0, deadFrac: dead };
}

/** Spread-out spots a taste musician fills (deterministic from the seed). */
function tasteSlots(rng: Rng, n = 5): Point[] {
  const slots: Point[] = [];
  let guard = 0;
  while (slots.length < n && guard++ < 1000) {
    const p: Point = [rng.range(0.1, 0.9), rng.range(0.1, 0.9)];
    if (slots.every((s) => Math.hypot(s[0] - p[0], s[1] - p[1]) > 0.25)) slots.push(p);
  }
  return slots;
}

export async function runEpisode(
  spec: EpisodeSpec,
  loadModule: () => Promise<NispsModule>,
): Promise<EpisodeResult> {
  const t0 = performance.now();
  const cfg = spec.config;
  const p = personaById(spec.persona);
  const root = new Rng(spec.seed);
  const goalRng = root.fork(1);
  const earRng = root.fork(2);
  const pathRng = root.fork(3);

  // Boot exactly as the product does: EngineApi with the training dose and
  // spread, then ConsoleApp's boot reshape to the mode's net.
  const eng = await createEngine({
    seed: spec.seed,
    persist: false,
    debugClockDt: 1 / 60,
    loadModule,
    learningRate: cfg.learningRate,
    maxIterations: cfg.maxIterations,
    spread: cfg.spread,
  });
  eng.reshape({ inputSize: BOOT_IO.inputSize, outputSize: BOOT_IO.outputSize, hidden: [cfg.h1, cfg.h2, cfg.h3] }, cfg.spread);

  const clock = new VirtualClock();
  const fc = new FeedbackController(eng, {
    spread: cfg.spread,
    nudgeStddev: cfg.nudgeStddev,
    geometricConfig: {
      learningRate: cfg.geoLearningRate,
      updatesPerSecond: cfg.geoUpdatesPerSecond,
      lifetimeMs: cfg.geoLifetimeMs,
    },
    scheduler: clock,
  });
  fc.setMode(cfg.feedbackMode);

  const s = new Session(eng, fc, clock, p);
  const goal = makeGoal(spec.goal, s.nOut, goalRng);
  const judge = (v: number) => v + p.noise * earRng.normal();

  // Real-net goal error; while a scratchpad is live the real net is set aside,
  // so the last real value is carried.
  const goalError = (): number => {
    if (goal.kind === 'place') {
      const e = placeErrors(eng, goal);
      return e.reduce((a, b) => a + b, 0) / e.length;
    }
    return 1 - tasteField(eng, goal).coverage;
  };
  const quality = (): number => {
    if (goal.kind === 'place') {
      const e = placeErrors(eng, goal);
      return e.filter((x) => x < p.accept).length / e.length;
    }
    const t = tasteField(eng, goal);
    return t.coverage * (0.5 + 0.5 * t.variety);
  };
  const met = (): boolean =>
    goal.kind === 'place' ? quality() >= 1 : tasteField(eng, goal).coverage >= 0.5;

  const errStart = goalError();
  const curve: number[] = [];
  let last = quality();
  let gesturesToSuccess: number | null = null;
  s.onGesture = () => {
    if (!s.exploring) {
      last = quality();
      if (gesturesToSuccess === null && met()) gesturesToSuccess = s.gestures;
    }
    curve.push(last);
  };

  if (goal.kind === 'place' && cfg.feedbackMode === 'geometric-dislike') {
    playPlacePush(s, goal, p, judge, cfg);
  } else if (goal.kind === 'place') {
    playPlaceExplore(s, goal, p, judge);
  } else if (cfg.feedbackMode === 'geometric-dislike') {
    playTastePush(s, goal, p, judge, pathRng, cfg);
  } else {
    playTasteExplore(s, goal, p, judge, pathRng);
  }

  if (s.exploring) s.finalise(); // a session never ends holding a scratchpad
  const errEnd = goalError();
  const taste = goal.kind === 'taste' ? tasteField(eng, goal) : { coverage: 0, variety: 0 };
  const success = met();
  const qualityEnd = quality();
  const mean = curve.length ? curve.reduce((a, b) => a + b, 0) / curve.length : qualityEnd;
  const score = 0.5 * qualityEnd + 0.5 * mean;
  const field = fieldSummary(eng);
  fc.dispose();
  eng.dispose();
  return {
    configKey: configKey(cfg),
    seed: spec.seed,
    goal: spec.goal,
    persona: spec.persona,
    score,
    qualityEnd,
    success,
    gesturesToSuccess,
    gestures: s.gestures,
    errStart,
    errEnd,
    coverage: taste.coverage,
    variety: taste.variety,
    curve,
    counts: s.counts,
    field,
    wallMs: performance.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// Policies. Each is a plausible way a musician uses that mode toward that goal.
// ---------------------------------------------------------------------------

type Judge = (v: number) => number;
type PlaceG = Extract<Goal, { kind: 'place' }>;
type TasteG = Extract<Goal, { kind: 'taste' }>;

/** Push-away mode, place goal: go to a target; like it when right, else dislike. */
function playPlacePush(s: Session, goal: PlaceG, p: Persona, judge: Judge, cfg: LabConfig): void {
  const ok = goal.targets.map(() => false);
  let k = 0;
  let stuck = 0;
  let best = Infinity;
  while (s.budgetLeft > 0) {
    if (ok.every(Boolean)) {
      // Verification pass: revisit every target; later gestures can undo earlier ones.
      goal.targets.forEach((t, i) => { ok[i] = judge(perceived(s.hear(t.at), t.sound, goal.salience)) < p.accept; });
      if (ok.every(Boolean)) return;
      s.move();
      continue;
    }
    while (ok[k]) k = (k + 1) % ok.length;
    const t = goal.targets[k]!;
    const d = judge(perceived(s.hear(t.at), t.sound, goal.salience));
    if (d < p.accept) {
      s.like(t.at);
      ok[k] = true;
      stuck = 0;
      best = Infinity;
    } else if (stuck >= p.stuckAfter) {
      // Frustrated: nothing liked yet → roll a fresh net; else jiggle and move on.
      if (s.likes === 0) s.randomiseReal(cfg.spread);
      else s.nudgeReal();
      stuck = 0;
      best = Infinity;
      k = (k + 1) % ok.length;
    } else {
      s.dislike(t.at);
      if (d < best - 0.005) { best = d; stuck = 0; } else stuck++;
    }
  }
}

/**
 * Explore-and-place, place goal: at each target, audition scratchpads —
 * coarse rerolls while far, fine nudges when close, undo anything worse —
 * then place the best found there. Finalise trains all anchors.
 */
function playPlaceExplore(s: Session, goal: PlaceG, p: Persona, judge: Judge): void {
  const ok = goal.targets.map(() => false);
  while (s.budgetLeft > 0 && !ok.every(Boolean)) {
    const before = s.gestures;
    for (let k = 0; k < goal.targets.length && s.budgetLeft > 2; k++) {
      if (ok[k]) continue;
      const t = goal.targets[k]!;
      if (!s.exploring) s.explore();
      let best = judge(perceived(s.hear(t.at), t.sound, goal.salience));
      for (let tries = 0; tries < p.patience && best >= p.accept && s.budgetLeft > 3; tries++) {
        if (best > 2 * p.accept) s.reroll();
        else s.nudge();
        const d = judge(perceived(s.hear(t.at), t.sound, goal.salience));
        if (d < best) best = d;
        else s.undo();
      }
      s.placeAt(t.at);
    }
    if (s.exploring) s.finalise();
    // Check the trained real net at every target; re-work the ones that missed.
    goal.targets.forEach((t, i) => { ok[i] = judge(perceived(s.hear(t.at), t.sound, goal.salience)) < p.accept; });
    if (s.gestures === before) return; // budget too small for another pass
  }
}

/** Push-away mode, taste goal: wander; like what pleases, dislike what doesn't. */
function playTastePush(s: Session, goal: TasteG, p: Persona, judge: Judge, rng: Rng, cfg: LabConfig): void {
  let at: Point = [rng.next(), rng.next()];
  let stuck = 0;
  while (s.budgetLeft > 0) {
    const u = judge(tasteUtility(goal, s.hear(at)));
    if (u > p.likeAbove) {
      s.like(at);
      stuck = 0;
    } else if (u < p.dislikeBelow) {
      if (stuck >= p.stuckAfter) {
        if (s.likes === 0) s.randomiseReal(cfg.spread);
        else s.nudgeReal();
        stuck = 0;
      } else {
        s.dislike(at);
        stuck++;
      }
    } else {
      s.move();
    }
    // Half local exploration, half a jump elsewhere on the pad.
    at = rng.next() < 0.5
      ? [Math.min(1, Math.max(0, at[0] + 0.12 * rng.normal())), Math.min(1, Math.max(0, at[1] + 0.12 * rng.normal()))]
      : [rng.next(), rng.next()];
  }
}

/** Explore-and-place, taste goal: fill a few spread-out spots with liked sounds. */
function playTasteExplore(s: Session, goal: TasteG, p: Persona, judge: Judge, rng: Rng): void {
  const slots = tasteSlots(rng);
  const ok = slots.map(() => false);
  while (s.budgetLeft > 0 && !ok.every(Boolean)) {
    const before = s.gestures;
    for (let k = 0; k < slots.length && s.budgetLeft > 2; k++) {
      if (ok[k]) continue;
      if (!s.exploring) s.explore();
      let best = judge(tasteUtility(goal, s.hear(slots[k]!)));
      for (let tries = 0; tries < p.patience && best <= p.likeAbove && s.budgetLeft > 3; tries++) {
        if (best < 0.3) s.reroll();
        else s.nudge();
        const u = judge(tasteUtility(goal, s.hear(slots[k]!)));
        if (u > best) best = u;
        else s.undo();
      }
      s.placeAt(slots[k]!);
    }
    if (s.exploring) s.finalise();
    slots.forEach((at, i) => { ok[i] = judge(tasteUtility(goal, s.hear(at))) > p.likeAbove; });
    if (s.gestures === before) return;
  }
}
