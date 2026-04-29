/**
 * Exploration store — RL feedback state and auto-explore configuration.
 *
 * Holds:
 *   - `noiseLevel` — current RL exploration noise (mutated by thumbs-up/down).
 *   - `noiseFloor`/`noiseCap` — bounds; cap maps from compound-axis Boldness.
 *   - `noiseGrowth`/`noiseDecay` — multiplicative factors per RL feedback step.
 *   - `spread` — sigmoid-saturation regime [0,1].
 *   - `autoExplore` — interval, intensity, last-tick.
 *   - `pressure` — last touch force/hold sample for feedback scaling.
 *
 * Stream 10 owns this store; the runtime reads from it on every thumbs-down
 * and the auto-explore interval timer. Mutations via store actions; reads via
 * signals.
 */

import { createStore, produce } from 'solid-js/store';
import { schedulePersist, loadPersisted } from './persistence';
import { clamp } from '../output/curves';

const STORAGE_KEY = 'nisps:exploration';

export interface ExplorationState {
  /** Live RL noise level (always in [floor, cap]). */
  noiseLevel: number;
  /** Lower bound. Compound axes can move it. */
  noiseFloor: number;
  /** Upper bound. Mapped from Boldness. */
  noiseCap: number;
  /** Per-thumbs-down growth factor (>1). */
  noiseGrowth: number;
  /** Per-thumbs-up decay factor (<1). */
  noiseDecay: number;
  /** Master sigmoid-saturation regime [0,1]. */
  spread: number;
  /** Learning rate for trainings (compound axes can override). */
  learningRate: number;
  /** Weight decay applied during moveWeights (Boldness/Memory). */
  weightDecay: number;

  /** Auto-explore: enabled flag. */
  autoExploreEnabled: boolean;
  /** Auto-explore tick interval, ms. [500, 10000]. */
  autoExploreIntervalMs: number;
  /** Intensity scaling for auto-explore noise [0.1, 1.0]. */
  autoExploreIntensity: number;

  /** Last touch pressure-sensitive sample (0..1). */
  pressureForce: number;
  /** Hold duration of current touch (ms). 0 if no touch. */
  holdMs: number;
}

interface PersistedExploration {
  noiseFloor: number;
  noiseCap: number;
  noiseGrowth: number;
  noiseDecay: number;
  spread: number;
  learningRate: number;
  weightDecay: number;
  autoExploreEnabled: boolean;
  autoExploreIntervalMs: number;
  autoExploreIntensity: number;
}

function defaults(): ExplorationState {
  return {
    noiseLevel: 0.05,
    noiseFloor: 0.005,
    noiseCap: 0.12,
    noiseGrowth: 1.5,
    noiseDecay: 0.97,
    spread: 0.6,
    learningRate: 1.0,
    weightDecay: 0.06,

    autoExploreEnabled: false,
    autoExploreIntervalMs: 2000,
    autoExploreIntensity: 0.5,

    pressureForce: 0,
    holdMs: 0,
  };
}

function loadInitial(): ExplorationState {
  const base = defaults();
  const persisted = loadPersisted<Partial<PersistedExploration>>(STORAGE_KEY, {});
  return {
    ...base,
    noiseFloor: persisted.noiseFloor ?? base.noiseFloor,
    noiseCap: persisted.noiseCap ?? base.noiseCap,
    noiseGrowth: persisted.noiseGrowth ?? base.noiseGrowth,
    noiseDecay: persisted.noiseDecay ?? base.noiseDecay,
    spread: persisted.spread ?? base.spread,
    learningRate: persisted.learningRate ?? base.learningRate,
    weightDecay: persisted.weightDecay ?? base.weightDecay,
    autoExploreEnabled: persisted.autoExploreEnabled ?? base.autoExploreEnabled,
    autoExploreIntervalMs: persisted.autoExploreIntervalMs ?? base.autoExploreIntervalMs,
    autoExploreIntensity: persisted.autoExploreIntensity ?? base.autoExploreIntensity,
  };
}

const [state, setState] = createStore<ExplorationState>(loadInitial());

function persist(): void {
  schedulePersist(STORAGE_KEY, () => ({
    noiseFloor: state.noiseFloor,
    noiseCap: state.noiseCap,
    noiseGrowth: state.noiseGrowth,
    noiseDecay: state.noiseDecay,
    spread: state.spread,
    learningRate: state.learningRate,
    weightDecay: state.weightDecay,
    autoExploreEnabled: state.autoExploreEnabled,
    autoExploreIntervalMs: state.autoExploreIntervalMs,
    autoExploreIntensity: state.autoExploreIntensity,
  }));
}

export const explorationStore = {
  state,

  /** Bulk update from compound-axis resolution. */
  applyCompoundParams(params: Record<string, unknown>): void {
    setState(produce((s) => {
      const get = (k: string): number | undefined => {
        const v = params[k];
        return typeof v === 'number' ? v : undefined;
      };
      const cap = get('noiseCap');
      if (cap !== undefined) s.noiseCap = clamp(cap, 0.005, 1);
      const growth = get('noiseGrowth');
      if (growth !== undefined) s.noiseGrowth = clamp(growth, 1, 4);
      const decay = get('noiseDecay');
      if (decay !== undefined) s.noiseDecay = clamp(decay, 0, 1);
      const lr = get('learningRate');
      if (lr !== undefined) s.learningRate = clamp(lr, 0.01, 10);
      const wd = get('weightDecay');
      if (wd !== undefined) s.weightDecay = clamp(wd, 0, 0.5);
      // Keep noiseLevel in [floor, cap]
      if (s.noiseLevel > s.noiseCap) s.noiseLevel = s.noiseCap;
      if (s.noiseLevel < s.noiseFloor) s.noiseLevel = s.noiseFloor;
    }));
    persist();
  },

  setNoiseLevel(v: number): void {
    setState(produce((s) => {
      s.noiseLevel = clamp(v, s.noiseFloor, s.noiseCap);
    }));
  },

  setSpread(v: number): void {
    setState(produce((s) => {
      s.spread = clamp(v, 0, 1);
    }));
    persist();
  },

  setNoiseFloor(v: number): void {
    setState(produce((s) => {
      s.noiseFloor = clamp(v, 0, s.noiseCap);
      if (s.noiseLevel < s.noiseFloor) s.noiseLevel = s.noiseFloor;
    }));
    persist();
  },

  setNoiseCap(v: number): void {
    setState(produce((s) => {
      s.noiseCap = clamp(v, s.noiseFloor, 1);
      if (s.noiseLevel > s.noiseCap) s.noiseLevel = s.noiseCap;
    }));
    persist();
  },

  setNoiseGrowth(v: number): void {
    setState(produce((s) => { s.noiseGrowth = clamp(v, 1, 4); }));
    persist();
  },

  setNoiseDecay(v: number): void {
    setState(produce((s) => { s.noiseDecay = clamp(v, 0, 1); }));
    persist();
  },

  setLearningRate(v: number): void {
    setState(produce((s) => { s.learningRate = clamp(v, 0.001, 10); }));
    persist();
  },

  setWeightDecay(v: number): void {
    setState(produce((s) => { s.weightDecay = clamp(v, 0, 0.5); }));
    persist();
  },

  /**
   * Mutate noise after a thumbs-down/up. Pressure ∈ [0,1] modulates the
   * effective growth/decay; >0.5 = harder, <0.5 = softer.
   */
  growNoise(pressure: number = 0.5): number {
    let next = state.noiseLevel;
    setState(produce((s) => {
      const p = clamp(pressure, 0, 1);
      // Pressure 0 = baseline, 1 = stronger. Reduces effect of growth.
      const factor = 1 + (s.noiseGrowth - 1) * (0.5 + p);
      next = clamp(s.noiseLevel * factor, s.noiseFloor, s.noiseCap);
      s.noiseLevel = next;
    }));
    return next;
  },

  decayNoise(pressure: number = 0.5): number {
    let next = state.noiseLevel;
    setState(produce((s) => {
      const p = clamp(pressure, 0, 1);
      // Stronger pressure → faster decay.
      const factor = s.noiseDecay - (1 - s.noiseDecay) * (p - 0.5) * 0.4;
      next = clamp(s.noiseLevel * clamp(factor, 0, 1), s.noiseFloor, s.noiseCap);
      s.noiseLevel = next;
    }));
    return next;
  },

  setAutoExplore(enabled: boolean): void {
    setState(produce((s) => { s.autoExploreEnabled = enabled; }));
    persist();
  },

  setAutoExploreInterval(ms: number): void {
    setState(produce((s) => { s.autoExploreIntervalMs = clamp(ms, 500, 10000); }));
    persist();
  },

  setAutoExploreIntensity(v: number): void {
    setState(produce((s) => { s.autoExploreIntensity = clamp(v, 0.1, 1); }));
    persist();
  },

  setPressure(force: number, holdMs: number): void {
    setState(produce((s) => {
      s.pressureForce = clamp(force, 0, 1);
      s.holdMs = Math.max(0, holdMs);
    }));
  },

  reset(): void {
    setState(defaults());
    persist();
  },
};

export type ExplorationStore = typeof explorationStore;
