/**
 * Classic step sequencer: each output slot is the pitch of one pattern
 * position. Low values are rests.
 */
import { clamp01 } from './rng';
import { PoolCache, quantiseToPool } from './scales';
import type { Generator, GeneratorState, SequencerSettings, StepEvent } from './types';

export const REST_THRESHOLD = 0.12;
const POSITIONS = 8;

class StepsState implements GeneratorState {
  private readonly pool = new PoolCache();
  private readonly ev: StepEvent = { note: null, velocity: 0.7, gate: 0.6 };

  reset(_seed: number): void {}

  step(index: number, p: Float32Array, s: SequencerSettings): StepEvent {
    const steps = Math.max(2, s.steps);
    const pos = index % steps;
    const v = clamp01(p[Math.floor((pos * POSITIONS) / steps)]);
    const ev = this.ev;
    ev.gate = s.gate;
    ev.velocity = pos % 4 === 0 ? 0.9 : 0.7;
    ev.note =
      v < REST_THRESHOLD
        ? null
        : quantiseToPool((v - REST_THRESHOLD) / (1 - REST_THRESHOLD), this.pool.get(s));
    return ev;
  }
}

export const stepsGenerator: Generator = {
  id: 'steps',
  label: 'Step sequencer',
  blurb: 'Each output is the pitch of one step. Low outputs are rests.',
  slots: Array.from({ length: POSITIONS }, (_, i) => ({
    id: `step-${i + 1}`,
    label: `Step ${i + 1}`,
    hint: 'Pitch of this step; near zero is a rest.',
  })),
  create: () => new StepsState(),
};
