/**
 * Session store — snapshot stack, A/B compare, region pins, named session presets.
 *
 * Stream 10 wires real ML weights into the snapshot stack and A/B state.
 * Snapshots store a Float32Array copy of the weights at the moment they
 * were pushed; restoring pops + writes back via mlStore.setWeights.
 *
 * Snapshot stack capacity is bounded (MAX_SNAPSHOTS); the oldest is dropped
 * when full. The stack is in-memory only — losing it across reloads is
 * acceptable (matches the legacy playground).
 *
 * Region pins, param pins, and named session presets ARE persisted because
 * they're explicit user intent.
 */

import { createStore, produce } from 'solid-js/store';
import { coreBus } from './bus';
import { schedulePersist, loadPersisted } from './persistence';

const STORAGE_KEY = 'nisps:session';
const MAX_SNAPSHOTS = 20;

/** A single weights snapshot. */
export interface Snapshot {
  id: string;
  tag: string;
  timestamp: number;
  noiseLevel: number;
  zoomLevel: number | null;
  /** Float32Array weight copy. Null if not captured (e.g. before WASM ready). */
  weights: Float32Array | null;
}

export interface RegionPin {
  id: string;
  /** Region in input space [0,1]^2 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Color slot 0..4 to map onto --pin-N tokens. */
  colorSlot: number;
  createdAt: number;
}

export interface ParamPin {
  /** Mode-id-prefixed key, e.g. "paf_synth:osc1_freq". */
  key: string;
  /** Index within active mode's output vector. */
  outputIndex: number;
}

export interface ABState {
  /** Stored "A" snapshot (state captured by user). */
  a: Snapshot | null;
  /** Live "B" — derived from current ML state when toggle pressed. */
  b: Snapshot | null;
  /** Which side is currently live: A or B. */
  live: 'A' | 'B';
}

export interface SessionPreset {
  id: string;
  name: string;
  createdAt: number;
  /** Opaque blob — stream 10 defines the schema. */
  payload: unknown;
}

export interface SessionState {
  snapshots: Snapshot[];
  ab: ABState;
  regionPins: RegionPin[];
  paramPins: ParamPin[];
  presets: SessionPreset[];
}

interface PersistedSession {
  regionPins: RegionPin[];
  paramPins: ParamPin[];
  presets: SessionPreset[];
}

function loadInitial(): SessionState {
  const persisted = loadPersisted<Partial<PersistedSession>>(STORAGE_KEY, {});
  return {
    snapshots: [], // not persisted (in-memory only for this stream)
    ab: { a: null, b: null, live: 'B' },
    regionPins: persisted.regionPins ?? [],
    paramPins: persisted.paramPins ?? [],
    presets: persisted.presets ?? [],
  };
}

const [state, setState] = createStore<SessionState>(loadInitial());

function persist(): void {
  schedulePersist(STORAGE_KEY, () => ({
    regionPins: state.regionPins,
    paramPins: state.paramPins,
    presets: state.presets,
  }));
}

let snapshotCounter = 0;
function nextSnapshotId(): string {
  snapshotCounter += 1;
  return `snap-${Date.now().toString(36)}-${snapshotCounter}`;
}

export const sessionStore = {
  state,

  // ----- Snapshots -----

  pushSnapshot(
    tag: string,
    opts: { noiseLevel?: number; zoomLevel?: number | null; weights?: Float32Array | null } = {},
  ): Snapshot {
    const snap: Snapshot = {
      id: nextSnapshotId(),
      tag,
      timestamp: Date.now(),
      noiseLevel: opts.noiseLevel ?? 0,
      zoomLevel: opts.zoomLevel ?? null,
      weights: opts.weights ? new Float32Array(opts.weights) : null,
    };
    setState(produce((s) => {
      s.snapshots.push(snap);
      if (s.snapshots.length > MAX_SNAPSHOTS) {
        s.snapshots.shift();
      }
    }));
    coreBus.emit('snap.push', { tag });
    return snap;
  },

  /** Convenience peek at the most recent snapshot. */
  peekSnapshot(): Snapshot | null {
    return state.snapshots.length > 0
      ? state.snapshots[state.snapshots.length - 1]!
      : null;
  },

  /** Get a copy of all snapshots (for UI rendering). */
  listSnapshots(): ReadonlyArray<Snapshot> {
    return state.snapshots;
  },

  popSnapshot(): Snapshot | null {
    let popped: Snapshot | null = null;
    setState(produce((s) => {
      const last = s.snapshots.pop();
      popped = last ?? null;
    }));
    const tag = (popped as Snapshot | null)?.tag ?? null;
    coreBus.emit('snap.pop', { tag });
    return popped;
  },

  jumpToSnapshot(id: string): Snapshot | null {
    const snap = state.snapshots.find((s) => s.id === id) ?? null;
    if (!snap) return null;
    setState(produce((s) => {
      const idx = s.snapshots.findIndex((q) => q.id === id);
      if (idx >= 0) {
        s.snapshots = s.snapshots.slice(0, idx + 1);
      }
    }));
    coreBus.emit('snap.pop', { tag: snap.tag });
    return snap;
  },

  clearSnapshots(): void {
    setState(produce((s) => {
      s.snapshots = [];
    }));
    coreBus.emit('snap.cleared', undefined);
  },

  // ----- A/B compare -----

  captureA(snap: Snapshot): void {
    setState(produce((s) => {
      s.ab.a = snap;
      s.ab.live = 'B'; // user immediately keeps exploring as B
    }));
  },

  captureB(snap: Snapshot): void {
    setState(produce((s) => {
      s.ab.b = snap;
    }));
  },

  toggleAB(): 'A' | 'B' {
    let next: 'A' | 'B' = 'B';
    setState(produce((s) => {
      next = s.ab.live === 'A' ? 'B' : 'A';
      s.ab.live = next;
    }));
    return next;
  },

  acceptB(): void {
    setState(produce((s) => {
      s.ab.a = null;
      s.ab.live = 'B';
    }));
  },

  revertToA(): void {
    setState(produce((s) => {
      // A becomes live; B is discarded
      s.ab.b = null;
      s.ab.live = 'A';
    }));
  },

  resetAB(): void {
    setState(produce((s) => {
      s.ab = { a: null, b: null, live: 'B' };
    }));
  },

  // ----- Region pins -----

  addRegionPin(pin: Omit<RegionPin, 'id' | 'createdAt' | 'colorSlot'> & { colorSlot?: number }): RegionPin {
    const id = `pin-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
    const colorSlot = pin.colorSlot ?? state.regionPins.length % 5;
    const created: RegionPin = { ...pin, colorSlot, id, createdAt: Date.now() };
    setState(produce((s) => {
      // Cap at 5 pins
      if (s.regionPins.length >= 5) {
        s.regionPins.shift();
      }
      s.regionPins.push(created);
    }));
    persist();
    coreBus.emit('pin.create', { kind: 'region', id });
    return created;
  },

  removeRegionPin(id: string): void {
    setState(produce((s) => {
      const idx = s.regionPins.findIndex((p) => p.id === id);
      if (idx >= 0) s.regionPins.splice(idx, 1);
    }));
    persist();
    coreBus.emit('pin.remove', { kind: 'region', id });
  },

  clearRegionPins(): void {
    setState(produce((s) => {
      s.regionPins = [];
    }));
    persist();
  },

  // ----- Param pins -----

  toggleParamPin(key: string, outputIndex: number): boolean {
    let pinned = false;
    setState(produce((s) => {
      const idx = s.paramPins.findIndex((p) => p.key === key);
      if (idx >= 0) {
        s.paramPins.splice(idx, 1);
        pinned = false;
      } else {
        s.paramPins.push({ key, outputIndex });
        pinned = true;
      }
    }));
    persist();
    if (pinned) coreBus.emit('pin.create', { kind: 'param', id: key });
    else coreBus.emit('pin.remove', { kind: 'param', id: key });
    return pinned;
  },

  isParamPinned(key: string): boolean {
    return state.paramPins.some((p) => p.key === key);
  },

  clearParamPins(): void {
    setState(produce((s) => {
      s.paramPins = [];
    }));
    persist();
  },

  /** Build a Uint8Array pin mask for a given output size. */
  paramPinMask(outputSize: number, modeId: string | null): Uint8Array {
    const mask = new Uint8Array(outputSize);
    for (const pin of state.paramPins) {
      if (modeId && !pin.key.startsWith(modeId + ':')) continue;
      if (pin.outputIndex >= 0 && pin.outputIndex < outputSize) {
        mask[pin.outputIndex] = 1;
      }
    }
    return mask;
  },

  // ----- Session presets -----

  savePreset(name: string, payload: unknown): SessionPreset {
    const preset: SessionPreset = {
      id: `preset-${Date.now().toString(36)}`,
      name,
      createdAt: Date.now(),
      payload,
    };
    setState(produce((s) => {
      s.presets.push(preset);
    }));
    persist();
    return preset;
  },

  removePreset(id: string): void {
    setState(produce((s) => {
      const idx = s.presets.findIndex((p) => p.id === id);
      if (idx >= 0) s.presets.splice(idx, 1);
    }));
    persist();
  },

  reset(): void {
    setState(loadInitial());
    snapshotCounter = 0;
  },
};

export type SessionStore = typeof sessionStore;
