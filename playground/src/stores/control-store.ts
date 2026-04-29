/**
 * Control store — compound axes (Boldness, Memory, Precision) + offset overrides.
 *
 * Reference: `.local/playground-archive/SPEC-controls.md` and
 * `.local/playground-archive/playground/js/ui/control-surface.js` (legacy
 * implementation). The contract is:
 *
 *  - Each axis has a [0,1] value.
 *  - Each axis derives a set of underlying parameters via interpolation
 *    tables. Adjacent rows are linearly interpolated; discrete params snap
 *    at 0.75 toward the higher row.
 *  - Per-parameter overrides are *offsets* added to the axis-derived value
 *    (trim-pot model). Double-tap an axis clears its offsets.
 *  - 6 built-in presets set axis triplets without touching offsets.
 *
 * Stream 10 wires the resolved params back into input/output/RL stores.
 * For now this store exposes `resolveParams()` so primitives can render
 * meaningful values and tests can verify interpolation.
 */

import { createStore, produce } from 'solid-js/store';
import { schedulePersist, loadPersisted } from './persistence';
import { clamp } from '../output/curves';

const STORAGE_KEY = 'nisps:control';

// ---------------------------------------------------------------------------
// Tables (mirrored from legacy control-surface.js — keep in lockstep)
// ---------------------------------------------------------------------------

type ParamValue = number | string | boolean;

interface TableRow {
  axis: number;
  values: Record<string, ParamValue>;
}

const BOLDNESS_TABLE: TableRow[] = [
  { axis: 0.0, values: { zoom: 0.1, noiseCap: 0.02, noiseGrowth: 1.1, learningRate: 0.1, weightDecay: 0.15, noiseDistribution: 'gaussian' } },
  { axis: 0.5, values: { zoom: 0.5, noiseCap: 0.12, noiseGrowth: 1.5, learningRate: 1.0, weightDecay: 0.06, noiseDistribution: 'gaussian' } },
  { axis: 1.0, values: { zoom: 1.0, noiseCap: 0.30, noiseGrowth: 2.5, learningRate: 3.0, weightDecay: 0.00, noiseDistribution: 'cauchy' } },
];

const MEMORY_TABLE: TableRow[] = [
  { axis: 0.0, values: { maxExamples: 5,   exampleDecay: 0.3, memoryWeightDecay: 0.20, noiseDecay: 0.85,  convergenceThreshold: 1e-3 } },
  { axis: 0.5, values: { maxExamples: 50,  exampleDecay: 0.7, memoryWeightDecay: 0.06, noiseDecay: 0.97,  convergenceThreshold: 1e-5 } },
  { axis: 1.0, values: { maxExamples: 500, exampleDecay: 1.0, memoryWeightDecay: 0.00, noiseDecay: 0.995, convergenceThreshold: 1e-8 } },
];

const PRECISION_TABLE: TableRow[] = [
  { axis: 0.0, values: { inputCurve: 1.0, deadzone: 0.0,  smoothing: 0.0,  slewRate: 1.0, momentumZoom: 'off' } },
  { axis: 0.5, values: { inputCurve: 1.5, deadzone: 0.05, smoothing: 0.15, slewRate: 0.3, momentumZoom: 'off' } },
  { axis: 1.0, values: { inputCurve: 3.0, deadzone: 0.15, smoothing: 0.40, slewRate: 0.1, momentumZoom: 'off' } },
];

const TABLES = {
  boldness: BOLDNESS_TABLE,
  memory: MEMORY_TABLE,
  precision: PRECISION_TABLE,
} as const;

export type AxisName = keyof typeof TABLES;

export interface ControlPreset {
  id: string;
  label: string;
  boldness: number;
  memory: number;
  precision: number;
}

export const CONTROL_PRESETS: ReadonlyArray<ControlPreset> = [
  { id: 'default',     label: 'Default',     boldness: 0.5, memory: 0.5, precision: 0.3 },
  { id: 'first-touch', label: 'First Touch', boldness: 0.2, memory: 0.7, precision: 0.6 },
  { id: 'jazz-hands',  label: 'Jazz Hands',  boldness: 0.8, memory: 0.2, precision: 0.0 },
  { id: 'sculptor',    label: 'Sculptor',    boldness: 0.3, memory: 0.9, precision: 0.8 },
  { id: 'improviser',  label: 'Improviser',  boldness: 0.6, memory: 0.3, precision: 0.2 },
  { id: 'microscope',  label: 'Microscope',  boldness: 0.1, memory: 1.0, precision: 1.0 },
];

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

function interpolate(table: TableRow[], axisValue: number): Record<string, ParamValue> {
  const v = clamp(axisValue, 0, 1);
  // Find bracketing rows
  let lo = table[0]!;
  let hi = table[table.length - 1]!;
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i]!;
    const b = table[i + 1]!;
    if (v >= a.axis && v <= b.axis) {
      lo = a;
      hi = b;
      break;
    }
  }
  if (lo === hi) return { ...lo.values };
  const t = (v - lo.axis) / (hi.axis - lo.axis);
  const out: Record<string, ParamValue> = {};
  for (const key of Object.keys(lo.values)) {
    const a = lo.values[key]!;
    const b = hi.values[key];
    if (typeof a === 'number' && typeof b === 'number') {
      out[key] = a + (b - a) * t;
    } else {
      // discrete: snap at 0.75
      out[key] = t >= 0.75 ? (b ?? a) : a;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export interface ControlState {
  boldness: number;
  memory: number;
  precision: number;
  /** Per-axis offset map: { axisName: { paramName: offset } }. */
  offsets: { boldness: Record<string, number>; memory: Record<string, number>; precision: Record<string, number> };
  /** Last-loaded preset id, if any. */
  presetId: string | null;
}

interface PersistedControl {
  boldness: number;
  memory: number;
  precision: number;
  offsets: ControlState['offsets'];
  presetId: string | null;
}

function loadInitial(): ControlState {
  const fallback: ControlState = {
    boldness: 0.5,
    memory: 0.5,
    precision: 0.3,
    offsets: { boldness: {}, memory: {}, precision: {} },
    presetId: 'default',
  };
  const persisted = loadPersisted<Partial<PersistedControl>>(STORAGE_KEY, {});
  return {
    boldness: persisted.boldness ?? fallback.boldness,
    memory: persisted.memory ?? fallback.memory,
    precision: persisted.precision ?? fallback.precision,
    offsets: persisted.offsets ?? fallback.offsets,
    presetId: persisted.presetId ?? fallback.presetId,
  };
}

const [state, setState] = createStore<ControlState>(loadInitial());

function persist(): void {
  schedulePersist(STORAGE_KEY, () => ({
    boldness: state.boldness,
    memory: state.memory,
    precision: state.precision,
    offsets: state.offsets,
    presetId: state.presetId,
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const controlStore = {
  state,

  setAxis(axis: AxisName, value: number): void {
    const v = clamp(value, 0, 1);
    setState(produce((s) => {
      s[axis] = v;
      // Manual axis movement clears the active preset id (can't be canonical anymore)
      if (s.presetId !== null) s.presetId = null;
    }));
    persist();
  },

  /** Set a per-axis offset for a single parameter. Trim-pot model. */
  setOffset(axis: AxisName, paramName: string, offset: number): void {
    setState(produce((s) => {
      s.offsets[axis][paramName] = offset;
    }));
    persist();
  },

  /** Clear all offsets on an axis (re-link). Equivalent to double-tap. */
  clearOffsets(axis: AxisName): void {
    setState(produce((s) => {
      s.offsets[axis] = {};
    }));
    persist();
  },

  /** Apply a built-in preset (axis triplet only — preserves offsets). */
  applyPreset(id: string): boolean {
    const p = CONTROL_PRESETS.find((q) => q.id === id);
    if (!p) return false;
    setState(produce((s) => {
      s.boldness = p.boldness;
      s.memory = p.memory;
      s.precision = p.precision;
      s.presetId = p.id;
    }));
    persist();
    return true;
  },

  /**
   * Resolve every underlying parameter value, applying axis interpolation
   * and per-axis offsets. Stream 10 fills in the routing into other stores;
   * for now this is the contract.
   */
  resolveParams(): Record<string, ParamValue> {
    const b = interpolate(BOLDNESS_TABLE, state.boldness);
    const m = interpolate(MEMORY_TABLE, state.memory);
    const p = interpolate(PRECISION_TABLE, state.precision);
    const all: Record<string, ParamValue> = { ...b, ...m, ...p };
    // Apply offsets — only sensible for numeric params.
    const applyOffsets = (axis: AxisName) => {
      const offsets = state.offsets[axis];
      for (const [k, off] of Object.entries(offsets)) {
        const v = all[k];
        if (typeof v === 'number') {
          all[k] = v + off;
        }
      }
    };
    applyOffsets('boldness');
    applyOffsets('memory');
    applyOffsets('precision');
    return all;
  },

  reset(): void {
    setState({
      boldness: 0.5,
      memory: 0.5,
      precision: 0.3,
      offsets: { boldness: {}, memory: {}, precision: {} },
      presetId: 'default',
    });
    persist();
  },
};

export type ControlStore = typeof controlStore;

// Public helpers for tests / showcase
export function interpolateAxis(axis: AxisName, value: number): Record<string, ParamValue> {
  return interpolate(TABLES[axis], value);
}
