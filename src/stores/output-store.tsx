/**
 * Output Store — SolidJS reactive store for output mode and pipeline config.
 *
 * Canonical location for:
 *   - Active output mode ('visual' | 'synth' | 'midi-cc' | 'audio-canvas')
 *   - Output pipeline configuration (globalCurve, smoothing, slewRate, freezeGate)
 *
 * Note: ml-store still holds outputMode and paramOverrides for backward compat.
 * This store is the canonical location going forward — do not modify ml-store.
 *
 * Context provider pattern: wrap component tree with <OutputProvider> and
 * call useOutputStore() in any descendant.
 */

import { createContext, useContext } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { JSX } from 'solid-js';

// ─── Types ────────────────────────────────────────────────────────────

export type OutputMode = 'visual' | 'synth' | 'midi-cc' | 'audio-canvas';

export interface OutputPipelineConfig {
  /** Response curve applied to all outputs before routing. [0.2, 5.0], default 1.0 */
  globalCurve: number;
  /** Exponential smoothing factor applied per-frame. [0, 0.95], default 0.0 */
  smoothing: number;
  /** Maximum per-frame delta (slew rate limiter). [0.005, ∞), default 1.0 */
  slewRate: number;
  /** Global freeze gate — when true, all outputs are held at last value. */
  freezeGate: boolean;
}

export interface OutputState {
  /** Currently active output mode */
  mode: OutputMode;
  /** Output pipeline configuration */
  pipeline: OutputPipelineConfig;
}

export interface OutputStore {
  // ─── Reactive state ───
  readonly state: OutputState;

  /** Active output mode */
  readonly mode: () => OutputMode;
  /** Full pipeline config object */
  readonly pipeline: () => OutputPipelineConfig;
  /** Global curve value [0.2, 5.0] */
  readonly globalCurve: () => number;
  /** Smoothing factor [0, 0.95] */
  readonly smoothing: () => number;
  /** Slew rate [0.005, ∞) */
  readonly slewRate: () => number;
  /** Whether the global freeze gate is active */
  readonly freezeGate: () => boolean;

  // ─── Actions ───
  /**
   * Set the active output mode.
   * Does NOT trigger MLP resize — that is ml-store's responsibility.
   */
  setMode(mode: OutputMode): void;
  /**
   * Partially update pipeline configuration.
   * Only the supplied keys are changed; others are left untouched.
   */
  setPipelineConfig(partial: Partial<OutputPipelineConfig>): void;
  /** Toggle or explicitly set the global freeze gate. */
  setFreezeGate(frozen: boolean): void;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_PIPELINE: OutputPipelineConfig = {
  globalCurve: 1.0,
  smoothing: 0.0,
  slewRate: 1.0,
  freezeGate: false,
};

const DEFAULT_STATE: OutputState = {
  mode: 'visual',
  pipeline: { ...DEFAULT_PIPELINE },
};

// ─── Factory ─────────────────────────────────────────────────────────

export function createOutputStore(): OutputStore {
  const [state, setState] = createStore<OutputState>({
    mode: DEFAULT_STATE.mode,
    pipeline: { ...DEFAULT_STATE.pipeline },
  });

  const store: OutputStore = {
    get state() { return state; },

    mode: () => state.mode,
    pipeline: () => state.pipeline,
    globalCurve: () => state.pipeline.globalCurve,
    smoothing: () => state.pipeline.smoothing,
    slewRate: () => state.pipeline.slewRate,
    freezeGate: () => state.pipeline.freezeGate,

    setMode: (mode: OutputMode) => {
      setState('mode', mode);
    },

    setPipelineConfig: (partial: Partial<OutputPipelineConfig>) => {
      setState(
        produce((s: OutputState) => {
          if (partial.globalCurve !== undefined) {
            s.pipeline.globalCurve = Math.max(0.2, partial.globalCurve);
          }
          if (partial.smoothing !== undefined) {
            s.pipeline.smoothing = Math.max(0, Math.min(0.95, partial.smoothing));
          }
          if (partial.slewRate !== undefined) {
            s.pipeline.slewRate = Math.max(0.005, partial.slewRate);
          }
          if (partial.freezeGate !== undefined) {
            s.pipeline.freezeGate = partial.freezeGate;
          }
        })
      );
    },

    setFreezeGate: (frozen: boolean) => {
      setState('pipeline', 'freezeGate', frozen);
    },
  };

  return store;
}

// ─── Context ─────────────────────────────────────────────────────────

const OutputStoreContext = createContext<OutputStore | undefined>(undefined);

export interface OutputProviderProps {
  store: OutputStore;
  children: JSX.Element;
}

/**
 * Provider component — wrap your component tree to make the output store
 * available to all descendants via useOutputStore().
 *
 * @example
 * const outputStore = createOutputStore();
 * <OutputProvider store={outputStore}>
 *   <App />
 * </OutputProvider>
 */
export function OutputProvider(props: OutputProviderProps): JSX.Element {
  return (
    <OutputStoreContext.Provider value={props.store}>
      {props.children}
    </OutputStoreContext.Provider>
  );
}

/**
 * Hook — call inside any component that is a descendant of OutputProvider.
 * Throws if called outside a provider.
 *
 * @example
 * const output = useOutputStore();
 * const mode = output.mode(); // reactive
 */
export function useOutputStore(): OutputStore {
  const store = useContext(OutputStoreContext);
  if (!store) {
    throw new Error(
      'useOutputStore() called outside of <OutputProvider>. ' +
      'Wrap a parent component with <OutputProvider store={createOutputStore()}> first.'
    );
  }
  return store;
}
