/**
 * Simulated musicians (ml-lab-spec §4.3.2). A persona is HOW someone plays:
 * how fast they gesture, how well they hear, how picky they are, and how long
 * they persist before trying something else. The hidden goal (goals.ts) is
 * WHAT they want. Same persona + goal + seed ⇒ the same session, gesture for
 * gesture, whatever config it runs against — that pairing is what lets the
 * lab attribute a difference to the config.
 *
 * Thresholds are in perceived-distance units (goals.ts `perceived`, a
 * salience-weighted RMS in [0,1]); utilities are tasteUtility in [0,1].
 */
export interface Persona {
  id: string;
  label: string;
  /** Time between gestures; the geometric replay runs in this gap. */
  gestureMs: number;
  /** Std-dev of additive noise on every judgement (0 = perfect ears). */
  noise: number;
  /** place: accept a sound closer than this. */
  accept: number;
  /** taste: like above this utility, dislike below `dislikeBelow`. */
  likeAbove: number;
  dislikeBelow: number;
  /** Scratchpad ops tried on one target before placing the best found. */
  patience: number;
  /** Consecutive non-improving dislikes before a nudge / randomise. */
  stuckAfter: number;
  /** Total gestures before the session ends. */
  budget: number;
}

export const PERSONAS: readonly Persona[] = [
  { id: 'patient', label: 'Patient, good ears', gestureMs: 2500, noise: 0.01, accept: 0.18,
    likeAbove: 0.6, dislikeBelow: 0.25, patience: 14, stuckAfter: 6, budget: 80 },
  { id: 'casual', label: 'Casual, quick', gestureMs: 900, noise: 0.03, accept: 0.24,
    likeAbove: 0.5, dislikeBelow: 0.3, patience: 6, stuckAfter: 3, budget: 50 },
  { id: 'noisy', label: 'Unsure ears', gestureMs: 1500, noise: 0.07, accept: 0.21,
    likeAbove: 0.55, dislikeBelow: 0.25, patience: 10, stuckAfter: 4, budget: 60 },
];

export function persona(id: string): Persona {
  const p = PERSONAS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown persona ${id}`);
  return p;
}
