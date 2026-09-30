/**
 * Scale-degree random walk. Each step moves up or down the note pool; the MLP
 * outputs set the odds directly (no trained chain).
 */
import { Rng, clamp01 } from './rng';
import { PoolCache, nearestRootIndex } from './scales';
import type { Generator, GeneratorState, SequencerSettings, StepEvent } from './types';

const MAX_LEAP = 4;
const MAX_CONSECUTIVE_RESTS = 2;

class WalkerState implements GeneratorState {
  private readonly rng = new Rng(1);
  private readonly pool = new PoolCache();
  private pos = -1;
  private rests = 0;
  private readonly ev: StepEvent = { note: null, velocity: 0.7, gate: 0.6 };

  constructor(seed: number) {
    this.reset(seed);
  }

  reset(seed: number): void {
    this.rng.reseed(seed);
    this.pos = -1;
    this.rests = 0;
  }

  step(index: number, p: Float32Array, s: SequencerSettings): StepEvent {
    const steps = Math.max(2, s.steps);
    const pool = this.pool.get(s);
    const last = pool.length - 1;
    const rng = this.rng;
    const ev = this.ev;
    if (this.pos < 0 || this.pos > last) this.pos = Math.min(last, Math.floor(last / 2));

    ev.gate = Math.min(1, Math.max(0.05, s.gate * (0.4 + 1.2 * clamp01(p[5]))));
    ev.velocity = index % 4 === 0 ? 0.9 : 0.7;

    // Draw in a fixed order so a given seed always consumes the same numbers.
    const rRest = rng.next();
    const rRepeat = rng.next();
    const rLeap = rng.next();
    const rDir = rng.next();
    const rSize = rng.next();

    if (index % steps === steps - 1) {
      this.pos = nearestRootIndex(pool, s.root, pool[this.pos]);
      this.rests = 0;
      ev.note = pool[this.pos];
      return ev;
    }

    if (rRest < clamp01(p[3]) * 0.4 && this.rests < MAX_CONSECUTIVE_RESTS) {
      this.rests++;
      ev.note = null;
      return ev;
    }
    this.rests = 0;

    if (rRepeat >= clamp01(p[2]) * 0.5) {
      const leap = rLeap < clamp01(p[0]) * 0.6;
      const size = leap ? 2 + Math.floor(rSize * (MAX_LEAP - 1)) : 1;
      // Direction: the bias slot, pulled towards the register centre.
      const centre = clamp01(p[4]) * last;
      const dist = last > 0 ? (centre - this.pos) / last : 0;
      const pull = Math.min(0.8, Math.abs(dist) * 1.5);
      const up = (1 - pull) * clamp01(p[1]) + pull * (dist > 0 ? 1 : 0);
      let next = this.pos + (rDir < up ? size : -size);
      if (next < 0) next = Math.min(last, -next);
      if (next > last) next = Math.max(0, 2 * last - next);
      this.pos = next;
    }

    ev.note = pool[this.pos];
    return ev;
  }
}

export const walkerGenerator: Generator = {
  id: 'walker',
  label: 'Walker',
  blurb: 'A melody that wanders up and down the scale one step at a time.',
  slots: [
    { id: 'step-size', label: 'Step size', hint: 'How often the walk leaps instead of stepping.' },
    { id: 'direction', label: 'Direction', hint: 'Low = drifts down, high = drifts up.' },
    { id: 'repeat', label: 'Repeat', hint: 'How often a note is played again.' },
    { id: 'rest', label: 'Rests', hint: 'How often the walk goes quiet.' },
    { id: 'register', label: 'Register', hint: 'The pitch area the walk keeps returning to.' },
    { id: 'gate', label: 'Gate length', hint: 'Short and staccato, or long and smooth.' },
  ],
  create: (seed) => new WalkerState(seed),
};
