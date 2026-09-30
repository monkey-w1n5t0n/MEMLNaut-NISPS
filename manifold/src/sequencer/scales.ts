/**
 * Scales and the note pool. The pool is the sorted list of MIDI notes every
 * generator is allowed to play, built from the fixed dock settings.
 */
import type { SequencerSettings } from './types';

export const SCALES: Record<string, { label: string; intervals: number[] }> = {
  major: { label: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'Natural minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  'major-pentatonic': { label: 'Major pentatonic', intervals: [0, 2, 4, 7, 9] },
  'minor-pentatonic': { label: 'Minor pentatonic', intervals: [0, 3, 5, 7, 10] },
  dorian: { label: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian: { label: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  blues: { label: 'Blues', intervals: [0, 3, 5, 6, 7, 10] },
  chromatic: { label: 'Chromatic', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  'whole-tone': { label: 'Whole tone', intervals: [0, 2, 4, 6, 8, 10] },
  'harmonic-minor': { label: 'Harmonic minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
};

const BASE_NOTE = 48;

/** Sorted MIDI notes across `octaveRange` octaves from the root (the top root is not included). */
export function buildNotePool(s: SequencerSettings): number[] {
  const intervals = (SCALES[s.scale] ?? SCALES['minor-pentatonic']).intervals;
  const base = BASE_NOTE + s.root + 12 * s.octaveOffset;
  const octaves = Math.max(1, Math.round(s.octaveRange));
  const pool: number[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const iv of intervals) {
      const n = base + 12 * o + iv;
      if (n >= 0 && n <= 127) pool.push(n);
    }
  }
  pool.sort((a, b) => a - b);
  if (pool.length === 0) pool.push(Math.min(127, Math.max(0, base)));
  return pool;
}

/** Map a 0..1 value onto the nearest pool entry (evenly spread over the pool). */
export function quantiseToPool(v01: number, pool: readonly number[]): number {
  const v = v01 < 0 ? 0 : v01 > 1 ? 1 : v01;
  return pool[Math.round(v * (pool.length - 1))];
}

/** Rebuilds the pool only when a pool-defining setting changes (keeps step() allocation-free). */
export class PoolCache {
  private pool: number[] = [];
  private scale = '';
  private root = -1;
  private range = -1;
  private offset = NaN;

  get(s: SequencerSettings): number[] {
    if (
      s.scale !== this.scale ||
      s.root !== this.root ||
      s.octaveRange !== this.range ||
      s.octaveOffset !== this.offset
    ) {
      this.scale = s.scale;
      this.root = s.root;
      this.range = s.octaveRange;
      this.offset = s.octaveOffset;
      this.pool = buildNotePool(s);
    }
    return this.pool;
  }
}

/** Index of the pool note that is a root (pitch class `root`) nearest to `note`. */
export function nearestRootIndex(pool: readonly number[], root: number, note: number): number {
  let best = 0;
  let bestDist = Infinity;
  const pc = ((root % 12) + 12) % 12;
  for (let i = 0; i < pool.length; i++) {
    if (pool[i] % 12 !== pc) continue;
    const d = Math.abs(pool[i] - note);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}
