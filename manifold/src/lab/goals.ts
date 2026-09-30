/**
 * Hidden goals for simulated musicians (ml-lab-spec Phase 3, §4.3.1).
 *
 * A goal is what the musician wants but never tells the engine. The engine
 * only ever sees gestures; the lab alone can score how close the mapping got.
 *
 *   place — K target sounds at K target locations. The classic interactive-ML
 *           task: "this sound HERE". Scored by error at the targets.
 *   taste — a hidden preference over sound space: a few liked regions. The
 *           musician wants the playable surface full of sounds they like, and
 *           not all the same one. This is what "explore, keep what you like"
 *           is for.
 *
 * SALIENCE. A listener does not hear 126 parameters independently; they attend
 * to a few. Every goal carries a salience vector (1 = attended, a small floor
 * otherwise) and all distances are salience-weighted. Without it a random
 * 126-D target is unreachable by any gesture sequence and every config scores
 * zero — a benchmark of nothing.
 *
 * All vectors are in the engine's normalised [0,1] output domain.
 */
import { Rng } from './rng';

export type Point = readonly [number, number];

export interface PlaceGoal {
  kind: 'place';
  salience: Float32Array;
  targets: { at: Point; sound: Float32Array }[];
}

export interface TasteGoal {
  kind: 'taste';
  salience: Float32Array;
  /** Liked regions in output space and how wide each is (perceived-distance units). */
  likes: { centre: Float32Array; width: number }[];
}

export type Goal = PlaceGoal | TasteGoal;
export type GoalKind = Goal['kind'];

export interface GoalOptions {
  /** Number of place targets (place). */
  targets?: number;
  /** Number of liked regions (taste). */
  likes?: number;
  /** How many outputs the listener attends to (the rest weigh `floor`). */
  salient?: number;
  floor?: number;
}

/** Salience-weighted RMS distance: "how different it sounds to this listener". */
export function perceived(a: ArrayLike<number>, b: ArrayLike<number>, salience: ArrayLike<number>): number {
  let acc = 0;
  let wsum = 0;
  for (let i = 0; i < salience.length; i++) {
    const w = salience[i]!;
    const d = (a[i]! - b[i]!) * w;
    acc += d * d;
    wsum += w * w;
  }
  return Math.sqrt(acc / Math.max(1e-12, wsum));
}

/** Utility of one sound under a taste goal, in [0,1] (1 = dead-centre of a like). */
export function tasteUtility(goal: TasteGoal, y: ArrayLike<number>): number {
  let best = 0;
  for (const l of goal.likes) {
    const d = perceived(y, l.centre, goal.salience);
    best = Math.max(best, Math.exp(-(d * d) / (2 * l.width * l.width)));
  }
  return best;
}

export function makeGoal(kind: GoalKind, nOut: number, rng: Rng, opts: GoalOptions = {}): Goal {
  const salient = Math.min(nOut, opts.salient ?? 6);
  const floor = opts.floor ?? 0.05;
  const salience = new Float32Array(nOut).fill(floor);
  const idx = Array.from({ length: nOut }, (_, i) => i);
  for (let i = nOut - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  for (let k = 0; k < salient; k++) salience[idx[k]!] = 1;

  if (kind === 'place') {
    const k = opts.targets ?? 3;
    const targets: PlaceGoal['targets'] = [];
    // Targets keep a margin from the pad rim and a minimum spacing, so K
    // targets are K genuinely different spots.
    let guard = 0;
    while (targets.length < k && guard++ < 1000) {
      const at: Point = [rng.range(0.12, 0.88), rng.range(0.12, 0.88)];
      if (targets.some((t) => Math.hypot(t.at[0] - at[0], t.at[1] - at[1]) < 0.3)) continue;
      const sound = new Float32Array(nOut);
      for (let i = 0; i < nOut; i++) sound[i] = rng.range(0.05, 0.95);
      targets.push({ at, sound });
    }
    return { kind, salience, targets };
  }
  const likes: TasteGoal['likes'] = [];
  for (let j = 0; j < (opts.likes ?? 2); j++) {
    const centre = new Float32Array(nOut);
    for (let i = 0; i < nOut; i++) centre[i] = rng.range(0.1, 0.9);
    likes.push({ centre, width: 0.15 });
  }
  return { kind, salience, likes };
}
