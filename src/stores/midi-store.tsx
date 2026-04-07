/**
 * MIDI Store — SolidJS reactive store for MIDI CC mapping configuration.
 *
 * Manages which MIDI CC numbers control which MLP output indices, along with
 * per-param range, curve, and mute settings. Maps are engine-scoped:
 * switching engines saves the current map and loads (or creates) the new one.
 *
 * Architecture:
 *   - State is held in a createStore for fine-grained reactivity
 *   - produce() is used for array mutations (add/remove/update CC params)
 *   - localStorage key is scoped per engine: `nisps-midi-cc-map:${engineId}`
 *   - Context provider (MidiProvider) wires the store into the component tree
 *   - useMidiStore() consumes the context with a helpful error boundary
 */

import { createContext, useContext } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { JSX } from 'solid-js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MidiCCParam {
  /** Human-readable label (auto-derived from CC number if not set) */
  name: string;
  /** MIDI CC number [0, 127] */
  cc: number;
  /** MIDI channel [1, 16] */
  channel: number;
  /** Index into MLP outputs */
  paramIndex: number;
  /** Output range min [0, 1] */
  min: number;
  /** Output range max [0, 1] */
  max: number;
  /** Response curve (0.5 = linear, <0.5 = more time low, >0.5 = bias high) */
  curve: number;
  /** Whether this CC mapping is disabled */
  muted: boolean;
  /** Value sent when muted [0, 1] */
  fixedValue: number;
}

export interface MidiState {
  /** Current ordered list of CC→output mappings */
  ccMap: MidiCCParam[];
  /** WebMIDI input device id, or null if none selected */
  inputDeviceId: string | null;
  /** WebMIDI output device id, or null if none selected */
  outputDeviceId: string | null;
  /** Engine scope used for localStorage key derivation */
  engineId: string;
}

export interface MidiStore {
  // ─── Reactive state ───
  readonly state: MidiState;

  // ─── Actions ───

  /**
   * Switch engine scope. Saves the current CC map to localStorage under the
   * old engineId, then loads (or generates a default) map for the new engineId.
   */
  loadCCMap(engineId: string): void;

  /** Persist the current CC map to localStorage under the current engineId. */
  saveCCMap(): void;

  /**
   * Partially update a single CC param by index.
   * Only the supplied keys are changed; all others remain untouched.
   */
  setCCParam(index: number, partial: Partial<MidiCCParam>): void;

  /** Append a new CC param with sensible defaults. */
  addCCParam(): void;

  /** Remove the CC param at the given index. */
  removeCCParam(index: number): void;

  /** Select the WebMIDI input device. Pass null to deselect. */
  setInputDevice(id: string | null): void;

  /** Select the WebMIDI output device. Pass null to deselect. */
  setOutputDevice(id: string | null): void;

  /**
   * Generate a default CC map with `count` entries.
   * CC numbers run from 1 through count; param indices run from 0 through count-1.
   * Replaces the current ccMap in state (does NOT auto-save).
   */
  createDefaultMap(count: number): void;
}

// ─── Well-known CC names (mirrors midi-cc-map.js) ────────────────────────────

const CC_NAMES: Record<number, string> = {
  1:  'Mod Wheel',
  2:  'Breath',
  5:  'Portamento Time',
  7:  'Volume',
  10: 'Pan',
  11: 'Expression',
  64: 'Sustain',
  65: 'Portamento',
  66: 'Sostenuto',
  67: 'Soft Pedal',
  70: 'Sound Variation',
  71: 'Resonance',
  72: 'Release',
  73: 'Attack',
  74: 'Cutoff',
  75: 'Decay',
  76: 'Vib Rate',
  77: 'Vib Depth',
  78: 'Vib Delay',
  91: 'Reverb',
  92: 'Tremolo',
  93: 'Chorus',
  94: 'Detune',
  95: 'Phaser',
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_ENGINE_ID = 'default';
const DEFAULT_CC_COUNT = 8;
const STORAGE_KEY_PREFIX = 'nisps-midi-cc-map';

/** Derive the localStorage key for a given engine scope. */
function storageKey(engineId: string): string {
  return `${STORAGE_KEY_PREFIX}:${engineId}`;
}

/** Build a single CC param entry with defaults. */
function makeCCParam(cc: number, paramIndex: number, channel = 1): MidiCCParam {
  return {
    name: CC_NAMES[cc] ?? `CC ${cc}`,
    cc,
    channel,
    paramIndex,
    min: 0,
    max: 1,
    curve: 0.5,
    muted: false,
    fixedValue: 0.5,
  };
}

/**
 * Build the default 8-entry map: CC#1–8 → param indices 0–7, full range,
 * linear curve (0.5), MIDI channel 1, unmuted.
 */
function buildDefaultMap(count = DEFAULT_CC_COUNT): MidiCCParam[] {
  return Array.from({ length: count }, (_, i) => makeCCParam(i + 1, i));
}

/** Load a CC map from localStorage for the given engine. Returns null on miss/error. */
function loadFromStorage(engineId: string): MidiCCParam[] | null {
  try {
    const raw = localStorage.getItem(storageKey(engineId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as MidiCCParam[];
  } catch (e) {
    console.warn('[MidiStore] Failed to load CC map from localStorage:', e);
    return null;
  }
}

/** Persist a CC map to localStorage for the given engine. */
function saveToStorage(engineId: string, ccMap: MidiCCParam[]): void {
  try {
    localStorage.setItem(storageKey(engineId), JSON.stringify(ccMap));
  } catch (e) {
    console.warn('[MidiStore] Failed to save CC map to localStorage:', e);
  }
}

const DEFAULT_STATE: MidiState = {
  ccMap: buildDefaultMap(),
  inputDeviceId: null,
  outputDeviceId: null,
  engineId: DEFAULT_ENGINE_ID,
};

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createMidiStore(): MidiStore {
  const [state, setState] = createStore<MidiState>({
    ccMap: buildDefaultMap(),
    inputDeviceId: DEFAULT_STATE.inputDeviceId,
    outputDeviceId: DEFAULT_STATE.outputDeviceId,
    engineId: DEFAULT_STATE.engineId,
  });

  const store: MidiStore = {
    get state() {
      return state;
    },

    loadCCMap: (engineId: string) => {
      // Save the current map under the old engineId before switching
      saveToStorage(state.engineId, state.ccMap as MidiCCParam[]);

      const loaded = loadFromStorage(engineId);
      const nextMap = loaded ?? buildDefaultMap();

      setState(
        produce((s: MidiState) => {
          s.engineId = engineId;
          s.ccMap = nextMap;
        })
      );
    },

    saveCCMap: () => {
      saveToStorage(state.engineId, state.ccMap as MidiCCParam[]);
    },

    setCCParam: (index: number, partial: Partial<MidiCCParam>) => {
      if (index < 0 || index >= state.ccMap.length) return;
      setState(
        produce((s: MidiState) => {
          const param = s.ccMap[index];
          if (partial.name !== undefined)       param.name       = partial.name;
          if (partial.cc !== undefined)         param.cc         = Math.max(0, Math.min(127, partial.cc));
          if (partial.channel !== undefined)    param.channel    = Math.max(1, Math.min(16, partial.channel));
          if (partial.paramIndex !== undefined) param.paramIndex = Math.max(0, partial.paramIndex);
          if (partial.min !== undefined)        param.min        = Math.max(0, Math.min(1, partial.min));
          if (partial.max !== undefined)        param.max        = Math.max(0, Math.min(1, partial.max));
          if (partial.curve !== undefined)      param.curve      = Math.max(0, Math.min(1, partial.curve));
          if (partial.muted !== undefined)      param.muted      = partial.muted;
          if (partial.fixedValue !== undefined) param.fixedValue = Math.max(0, Math.min(1, partial.fixedValue));

          // Keep name in sync with CC number when the user hasn't set a custom name
          if (partial.cc !== undefined && partial.name === undefined) {
            param.name = CC_NAMES[param.cc] ?? `CC ${param.cc}`;
          }
        })
      );
    },

    addCCParam: () => {
      setState(
        produce((s: MidiState) => {
          // Pick the next CC number after the last entry (clamp to 127)
          const lastCC = s.ccMap.length > 0 ? s.ccMap[s.ccMap.length - 1].cc : 0;
          const nextCC = Math.min(127, lastCC + 1);
          const nextParamIndex = s.ccMap.length;
          s.ccMap.push(makeCCParam(nextCC, nextParamIndex));
        })
      );
    },

    removeCCParam: (index: number) => {
      if (index < 0 || index >= state.ccMap.length) return;
      setState(
        produce((s: MidiState) => {
          s.ccMap.splice(index, 1);
        })
      );
    },

    setInputDevice: (id: string | null) => {
      setState('inputDeviceId', id);
    },

    setOutputDevice: (id: string | null) => {
      setState('outputDeviceId', id);
    },

    createDefaultMap: (count: number) => {
      const nextMap = buildDefaultMap(Math.max(1, count));
      setState(
        produce((s: MidiState) => {
          s.ccMap = nextMap;
        })
      );
    },
  };

  return store;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const MidiStoreContext = createContext<MidiStore | undefined>(undefined);

export interface MidiProviderProps {
  store: MidiStore;
  children: JSX.Element;
}

/**
 * MidiProvider — wrap your component tree with this to make the MIDI store
 * available to all descendants via useMidiStore().
 *
 * @example
 * const midiStore = createMidiStore();
 * <MidiProvider store={midiStore}>
 *   <App />
 * </MidiProvider>
 */
export function MidiProvider(props: MidiProviderProps): JSX.Element {
  return (
    <MidiStoreContext.Provider value={props.store}>
      {props.children}
    </MidiStoreContext.Provider>
  );
}

/**
 * useMidiStore — consume the MIDI store inside any component under MidiProvider.
 * Throws a descriptive error if called outside the provider tree.
 *
 * @example
 * const midi = useMidiStore();
 * const ccMap = () => midi.state.ccMap;  // reactive
 */
export function useMidiStore(): MidiStore {
  const store = useContext(MidiStoreContext);
  if (!store) {
    throw new Error(
      'useMidiStore() called outside of <MidiProvider>. ' +
      'Wrap a parent component with <MidiProvider store={createMidiStore()}> first.'
    );
  }
  return store;
}
