/**
 * Synth Store — SolidJS reactive store for synth engine state.
 *
 * Tracks the active synth engine, running state, volume, arpeggiator config,
 * and active preset. SynthEngine instances are opaque handles kept outside
 * the SolidJS store to avoid proxy overhead on complex objects.
 *
 * Architecture:
 *   - State is held in a createStore for fine-grained reactivity
 *   - engine handle is stored in a plain variable (NOT in store — no proxy)
 *   - Context provider (SynthProvider) wires the store into the component tree
 *   - useSynthStore() consumes the context with a helpful error boundary
 */

import {
  createContext,
  useContext,
  type ParentComponent,
} from 'solid-js';
import { createStore } from 'solid-js/store';

// ─── SynthEngine placeholder type ────────────────────────────────────
//
// Replace this with the real interface once the synth engine module exists.
// Kept minimal and forward-compatible — only the fields the store touches.

export interface SynthEngine {
  /** Stable engine identifier (e.g. 'shaper-feedback', 'additive', 'fm') */
  id: string;
  /** Human-readable name shown in the UI */
  displayName: string;
  /** Stop the engine and release audio resources (called before swap) */
  stop?(): void;
  /** Apply a named synth preset by id */
  applyPreset?(presetId: string): void;
}

// ─── Arp config ──────────────────────────────────────────────────────

export interface ArpConfig {
  enabled: boolean;
  /** Beats per minute [40, 240] */
  tempo: number;
  /** Named chord/progression string, e.g. 'major', 'Cmin7-rand' */
  progression: string;
  /** Number of octaves [1, 5] */
  octaves: number;
  /** Transposition offset [-2, 3] semitones */
  offset: number;
}

// ─── Store state ─────────────────────────────────────────────────────

export interface SynthState {
  /** Stable engine identifier matching SynthEngine.id */
  engineId: string;
  /** Whether the audio engine is currently running */
  isRunning: boolean;
  /** Master volume [0, 1] */
  volume: number;
  /** Arpeggiator configuration */
  arp: ArpConfig;
  /** Currently loaded synth preset id, or null if none */
  presetId: string | null;
}

// ─── Store interface ─────────────────────────────────────────────────

export interface SynthStore {
  // ── Reactive state ──

  /** Full reactive state object (fine-grained via createStore) */
  readonly state: SynthState;

  // ── Opaque engine access (NOT reactive) ──

  /** Return the current engine handle. Not a signal — do not track. */
  getEngine(): SynthEngine | null;

  // ── Actions ──

  /**
   * Swap the active engine. Stops the old engine (if running), stores the
   * new handle, and updates engineId reactively.
   */
  setEngine(engine: SynthEngine | null): void;

  /** Start audio output. Sets isRunning = true. */
  start(): void;

  /** Stop audio output. Sets isRunning = false. */
  stop(): void;

  /** Set master volume. Clamped to [0, 1]. */
  setVolume(v: number): void;

  /**
   * Apply a named synth preset. Updates presetId reactively and delegates
   * to engine.applyPreset() when the engine implements it.
   */
  applyPreset(presetId: string): void;

  /**
   * Merge partial arp settings into the current arp config.
   * Only the provided keys are updated; the rest remain unchanged.
   */
  setArpConfig(partial: Partial<ArpConfig>): void;
}

// ─── Defaults ────────────────────────────────────────────────────────

const DEFAULT_ARP: ArpConfig = {
  enabled: false,
  tempo: 120,
  progression: 'major',
  octaves: 1,
  offset: 0,
};

const DEFAULT_STATE: SynthState = {
  engineId: '',
  isRunning: false,
  volume: 0.7,
  arp: { ...DEFAULT_ARP },
  presetId: null,
};

// ─── Factory ─────────────────────────────────────────────────────────

export function createSynthStore(): SynthStore {
  const [state, setState] = createStore<SynthState>({ ...DEFAULT_STATE });

  // Engine handle lives outside the store — SolidJS proxies break opaque
  // objects with internal state (Web Audio nodes, WASM pointers, etc.).
  let engine: SynthEngine | null = null;

  const store: SynthStore = {
    get state() {
      return state;
    },

    getEngine: () => engine,

    setEngine: (newEngine: SynthEngine | null) => {
      // Stop and release old engine before swapping
      if (engine?.stop) {
        engine.stop();
      }
      engine = newEngine;
      setState('engineId', newEngine?.id ?? '');
      setState('isRunning', false);
    },

    start: () => {
      setState('isRunning', true);
    },

    stop: () => {
      if (engine?.stop) {
        engine.stop();
      }
      setState('isRunning', false);
    },

    setVolume: (v: number) => {
      setState('volume', Math.max(0, Math.min(1, v)));
    },

    applyPreset: (presetId: string) => {
      setState('presetId', presetId);
      if (engine?.applyPreset) {
        engine.applyPreset(presetId);
      }
    },

    setArpConfig: (partial: Partial<ArpConfig>) => {
      // Merge each provided key individually so SolidJS tracks at field level
      if (partial.enabled !== undefined) setState('arp', 'enabled', partial.enabled);
      if (partial.tempo !== undefined) setState('arp', 'tempo', Math.max(40, Math.min(240, partial.tempo)));
      if (partial.progression !== undefined) setState('arp', 'progression', partial.progression);
      if (partial.octaves !== undefined) setState('arp', 'octaves', Math.max(1, Math.min(5, partial.octaves)));
      if (partial.offset !== undefined) setState('arp', 'offset', Math.max(-2, Math.min(3, partial.offset)));
    },
  };

  return store;
}

// ─── Context ─────────────────────────────────────────────────────────

const SynthContext = createContext<SynthStore>();

/**
 * SynthProvider — wrap your component tree with this to make the synth store
 * available via useSynthStore(). Accepts an already-created store instance.
 *
 * @example
 * const synthStore = createSynthStore();
 * <SynthProvider store={synthStore}>
 *   <App />
 * </SynthProvider>
 */
export const SynthProvider: ParentComponent<{ store: SynthStore }> = (props) => {
  return (
    <SynthContext.Provider value={props.store}>
      {props.children}
    </SynthContext.Provider>
  );
};

/**
 * useSynthStore — consume the synth store inside any component under SynthProvider.
 * Throws a descriptive error if called outside the provider tree.
 */
export function useSynthStore(): SynthStore {
  const store = useContext(SynthContext);
  if (!store) {
    throw new Error(
      'useSynthStore() called outside <SynthProvider>. ' +
      'Wrap your component tree with <SynthProvider store={createSynthStore()}> first.'
    );
  }
  return store;
}
