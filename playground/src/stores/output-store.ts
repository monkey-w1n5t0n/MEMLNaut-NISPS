/**
 * Output store — output pipeline configuration.
 *
 * State held: globalCurve, smoothing, slewRate, freezeOutput, freezeMask.
 */

import { createStore, produce } from 'solid-js/store';
import {
  defaultOutputConfig,
  GLOBAL_CURVE_MIN,
  GLOBAL_CURVE_MAX,
  SMOOTHING_MAX,
  SLEW_RATE_MIN,
  type OutputConfig,
} from '../output/pipeline';
import { schedulePersist, loadPersisted } from './persistence';
import { clamp } from '../output/curves';

const STORAGE_KEY = 'nisps:output';

interface PersistedOutput {
  globalCurve: number;
  smoothing: number;
  slewRate: number; // Infinity persists as null
  freezeOutput: boolean;
  reuseBuffer: boolean;
}

function loadOutputConfig(): OutputConfig {
  const base = defaultOutputConfig();
  const persisted = loadPersisted<Partial<PersistedOutput>>(STORAGE_KEY, {});
  const slew = persisted.slewRate;
  return {
    ...base,
    globalCurve: persisted.globalCurve ?? base.globalCurve,
    smoothing: persisted.smoothing ?? base.smoothing,
    slewRate: slew === null || slew === undefined ? base.slewRate : slew,
    freezeOutput: persisted.freezeOutput ?? base.freezeOutput,
    reuseBuffer: persisted.reuseBuffer ?? base.reuseBuffer,
  };
}

const [config, setConfig] = createStore<OutputConfig>(loadOutputConfig());

function persist(): void {
  schedulePersist(STORAGE_KEY, () => ({
    globalCurve: config.globalCurve,
    smoothing: config.smoothing,
    slewRate: isFinite(config.slewRate) ? config.slewRate : null,
    freezeOutput: config.freezeOutput,
    reuseBuffer: config.reuseBuffer,
  }));
}

export const outputStore = {
  config,

  setGlobalCurve(exp: number): void {
    setConfig(produce((c) => {
      c.globalCurve = clamp(exp, GLOBAL_CURVE_MIN, GLOBAL_CURVE_MAX);
    }));
    persist();
  },

  setSmoothing(s: number): void {
    setConfig(produce((c) => {
      c.smoothing = clamp(s, 0, SMOOTHING_MAX);
    }));
    persist();
  },

  setSlewRate(maxChangePerSec: number): void {
    setConfig(produce((c) => {
      if (!isFinite(maxChangePerSec) || maxChangePerSec >= 1.0) {
        c.slewRate = Infinity;
      } else {
        c.slewRate = Math.max(SLEW_RATE_MIN, maxChangePerSec);
      }
    }));
    persist();
  },

  setFreezeOutput(frozen: boolean): void {
    setConfig(produce((c) => {
      c.freezeOutput = frozen;
    }));
    persist();
  },

  setFreezeMask(mask: Uint8Array | null): void {
    setConfig(produce((c) => {
      c.freezeMask = mask;
    }));
    // Mask is not persisted (engine-specific)
  },

  reset(): void {
    setConfig(defaultOutputConfig());
    persist();
  },
};

export type OutputStore = typeof outputStore;
