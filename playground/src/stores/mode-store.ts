/**
 * Mode store — active mode + per-mode parameter overrides.
 *
 * Stream 9 implements the actual modes; this store only holds the *id* and
 * a per-mode dictionary of `ParamOverride` objects keyed by parameter name.
 *
 * Mode selection emits `ui.mode_switch` so audio/ML can react.
 */

import { createStore, produce } from 'solid-js/store';
import { coreBus } from './bus';
import { schedulePersist, loadPersisted } from './persistence';
import type { CurveName } from '../output/curves';

const STORAGE_KEY = 'nisps:mode';

/**
 * Per-output override applied between MLP and engine.
 *
 * - `min`/`max`: range mapping (normalised input [0,1] → [min,max])
 * - `curve`: pre-mapping curve
 * - `muted`: ignore network output, use `fixedValue`
 * - `pinned`: skip during weight perturbation
 * - `frozen`: hold last value (for output freeze mask)
 */
export interface ParamOverride {
  min: number;
  max: number;
  curve: CurveName;
  curveParam?: number;
  muted: boolean;
  pinned: boolean;
  frozen: boolean;
  fixedValue: number;
}

export function defaultParamOverride(): ParamOverride {
  return {
    min: 0,
    max: 1,
    curve: 'linear',
    muted: false,
    pinned: false,
    frozen: false,
    fixedValue: 0.5,
  };
}

export interface ModeStoreState {
  /** Active mode id (e.g. "paf_synth"). null = none selected yet. */
  activeModeId: string | null;
  /** Map of modeId → { paramName → ParamOverride }. */
  overrides: Record<string, Record<string, ParamOverride>>;
}

interface PersistedMode {
  activeModeId: string | null;
  overrides: Record<string, Record<string, ParamOverride>>;
}

function loadInitial(): ModeStoreState {
  const persisted = loadPersisted<Partial<PersistedMode>>(STORAGE_KEY, {});
  return {
    activeModeId: persisted.activeModeId ?? null,
    overrides: persisted.overrides ?? {},
  };
}

const [state, setState] = createStore<ModeStoreState>(loadInitial());

function persist(): void {
  schedulePersist(STORAGE_KEY, () => ({
    activeModeId: state.activeModeId,
    overrides: state.overrides,
  }));
}

export const modeStore = {
  state,

  switchMode(modeId: string): void {
    const from = state.activeModeId;
    if (from === modeId) return;
    setState(produce((s) => {
      s.activeModeId = modeId;
      if (!s.overrides[modeId]) {
        s.overrides[modeId] = {};
      }
    }));
    persist();
    coreBus.emit('ui.mode_switch', { from, to: modeId });
  },

  setOverride(modeId: string, paramName: string, override: ParamOverride): void {
    setState(produce((s) => {
      if (!s.overrides[modeId]) s.overrides[modeId] = {};
      s.overrides[modeId]![paramName] = override;
    }));
    persist();
    coreBus.emit('mode.params_changed', { modeId });
  },

  clearOverride(modeId: string, paramName: string): void {
    setState(produce((s) => {
      const map = s.overrides[modeId];
      if (map) delete map[paramName];
    }));
    persist();
    coreBus.emit('mode.params_changed', { modeId });
  },

  clearAllOverrides(modeId: string): void {
    setState(produce((s) => {
      s.overrides[modeId] = {};
    }));
    persist();
    coreBus.emit('mode.params_changed', { modeId });
  },

  getOverride(modeId: string, paramName: string): ParamOverride | undefined {
    return state.overrides[modeId]?.[paramName];
  },

  reset(): void {
    setState({ activeModeId: null, overrides: {} });
    persist();
  },
};

export type ModeStore = typeof modeStore;
