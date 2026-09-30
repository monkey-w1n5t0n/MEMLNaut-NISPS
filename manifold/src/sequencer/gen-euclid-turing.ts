/**
 * Euclidean rhythm + Turing-machine melody. The Euclidean pattern decides WHEN
 * a note plays; a looping shift register of random pitches decides WHICH note.
 * A high "lock" repeats the loop, a low one lets it mutate.
 */
import { Rng, clamp01 } from './rng';
import { PoolCache, nearestRootIndex } from './scales';
import type { Generator, GeneratorState, SequencerSettings, StepEvent } from './types';

const REGISTER_LEN = 16;
const MAX_STEPS = 16;
const MIN_PULSES = 2;
const MIN_LOCK = 0.3;

/** True when pattern position `pos` is a pulse of the Euclidean rhythm E(pulses, steps), rotated. */
export function euclidHit(pos: number, pulses: number, steps: number, rotation: number): boolean {
  const p = (((pos + rotation) % steps) + steps) % steps;
  return (p * pulses) % steps < pulses;
}

/** Pulse count from the 0..1 slot: at least MIN_PULSES, at most every step. */
export function pulsesFor(v: number, steps: number): number {
  const min = Math.min(MIN_PULSES, steps);
  return Math.min(steps, min + Math.round(clamp01(v) * (steps - min)));
}

class EuclidTuringState implements GeneratorState {
  private readonly rng = new Rng(1);
  private readonly pool = new PoolCache();
  private readonly reg = new Float32Array(REGISTER_LEN);
  private prev = -1;
  private readonly ev: StepEvent = { note: null, velocity: 0.7, gate: 0.6 };

  constructor(seed: number) {
    this.reset(seed);
  }

  reset(seed: number): void {
    this.rng.reseed(seed);
    for (let i = 0; i < REGISTER_LEN; i++) this.reg[i] = this.rng.next();
    this.prev = -1;
  }

  step(index: number, p: Float32Array, s: SequencerSettings): StepEvent {
    const steps = Math.max(2, Math.min(MAX_STEPS, s.steps));
    const pos = index % steps;
    const ev = this.ev;
    const pulses = pulsesFor(p[0], steps);
    const rotation = Math.round(clamp01(p[1]) * (steps - 1));

    ev.gate = Math.min(1, Math.max(0.05, s.gate * (0.4 + 1.2 * clamp01(p[5]))));
    ev.velocity = pos % 4 === 0 ? 0.9 : 0.7;

    const hit = euclidHit(pos, pulses, steps, rotation);
    if (!hit) {
      ev.note = null;
      return ev;
    }

    const pool = this.pool.get(s);
    // Turing step: the register slot either stays (locked) or is rewritten.
    const lock = MIN_LOCK + (1 - MIN_LOCK) * clamp01(p[2]);
    const slot = pos % REGISTER_LEN;
    if (this.rng.next() > lock) this.reg[slot] = this.rng.next();
    const v = this.reg[slot];

    // Octave spread: fraction of the pool the melody may roam in, centred.
    const spread = 0.25 + 0.75 * clamp01(p[4]);
    const window = Math.max(1, Math.round(spread * pool.length));
    const lo = Math.floor((pool.length - window) / 2);
    let idx = lo + Math.min(window - 1, Math.floor(v * window));

    // Last hit of the loop resolves to the root.
    let lastHit = pos;
    for (let q = pos + 1; q < steps; q++) if (euclidHit(q, pulses, steps, rotation)) lastHit = q;
    if (lastHit === pos) {
      idx = nearestRootIndex(pool, s.root, this.prev < 0 ? pool[0] : this.prev);
    } else if (this.prev >= 0) {
      // Leap cap: from a small step up to a fifth (7 semitones).
      const maxLeap = 2 + Math.round(clamp01(p[3]) * 5);
      while (idx > 0 && pool[idx] - this.prev > maxLeap) idx--;
      while (idx < pool.length - 1 && this.prev - pool[idx] > maxLeap) idx++;
    }

    this.prev = pool[idx];
    ev.note = pool[idx];
    return ev;
  }
}

export const euclidTuringGenerator: Generator = {
  id: 'euclid-turing',
  label: 'Euclid + Turing',
  blurb: 'A Euclidean rhythm decides when to play; a looping shift register decides which notes.',
  slots: [
    { id: 'pulses', label: 'Pulses', hint: 'How many notes are spread across the pattern.' },
    { id: 'rotation', label: 'Rotation', hint: 'Slides the rhythm along the pattern.' },
    { id: 'lock', label: 'Lock', hint: 'Low = the melody keeps changing, high = it repeats.' },
    { id: 'step-size', label: 'Step size', hint: 'How far the melody may jump between notes.' },
    { id: 'octave-spread', label: 'Octave spread', hint: 'How much of the note range is used.' },
    { id: 'gate', label: 'Gate length', hint: 'Short and staccato, or long and smooth.' },
  ],
  create: (seed) => new EuclidTuringState(seed),
};
