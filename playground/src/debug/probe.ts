/**
 * Debug probe: window.__nisps
 *
 * Stream 7 wires this to the real WasmIML via mlStore. Methods are
 * synchronous (or return immediately-resolved promises). The probe
 * deliberately bypasses Solid reactivity so tests get deterministic,
 * imperative semantics.
 *
 * The probe self-initialises the ML engine on first use that needs it
 * — Playwright tests can `await window.__nisps.__init()` before driving
 * inference, or just call methods and tolerate a few no-ops while the
 * lazy init resolves. While the init is in flight, `__ready` is false;
 * synchronous methods that need ML are best-effort no-ops.
 */

import { mlStore } from '../stores/ml-store';

export interface DebugProbe {
  /** Current 126-element output vector (Float32Array). */
  getOutputs(): Float32Array;
  /** Last training loss, or null if no training has occurred. */
  getLoss(): number | null;
  /** Flat weight array. */
  getWeights(): Float32Array;
  /** Number of training examples currently in the dataset. */
  getExampleCount(): number;
  /** Set joystick X/Y in [0,1] and run inference. */
  setInputs(x: number, y: number): void;
  /** Trigger thumbs-up RL feedback. */
  thumbsUp(): void;
  /** Trigger thumbs-down RL feedback. */
  thumbsDown(): void;
  /** Synchronous training; returns final loss. */
  train(): number;
  /** Async training; returns Promise<loss>. */
  trainAsync(): Promise<number>;
  /** Randomize weights with default spread. */
  randomise(): void;
  /** Clear all training examples. */
  clearExamples(): void;
  /** Force a save to localStorage now (no debounce). */
  saveState(): void;
  /** Non-destructive loss query against current dataset. */
  evalLoss(): number | null;
  /** Batch inference: input is Nx2 array of [x,y] pairs. */
  inferBatch(points: ReadonlyArray<readonly [number, number]>): Float32Array;
  /** Per-layer weight statistics: layerCount * 4 floats (mean|w|, max|w|, dead%, sat%). */
  getLayerStats(): Float32Array;
  /** True once the WASM is fully initialised. */
  readonly __ready: boolean;
  /** Force initialisation. Returns a promise that resolves when the WASM is ready. */
  __init(): Promise<void>;
}

declare global {
  interface Window {
    __nisps?: DebugProbe;
  }
}

const EMPTY_F32 = new Float32Array(0);

// We auto-initialise lazily so a test that immediately calls `.train()`
// after page load doesn't silently no-op. The promise is shared across
// calls so we don't kick off two simultaneous loads.
let lazyInitPromise: Promise<void> | null = null;
function lazyInit(): Promise<void> {
  if (mlStore.iml) return Promise.resolve();
  if (!lazyInitPromise) {
    lazyInitPromise = mlStore.initialize().then(() => undefined);
  }
  return lazyInitPromise;
}

const probe: DebugProbe = {
  get __ready(): boolean {
    return !!mlStore.iml && mlStore.state.ready;
  },

  __init(): Promise<void> {
    return lazyInit();
  },

  getOutputs(): Float32Array {
    return mlStore.outputs();
  },

  getLoss(): number | null {
    return mlStore.state.lastLoss;
  },

  getWeights(): Float32Array {
    return mlStore.getWeights();
  },

  getExampleCount(): number {
    return mlStore.state.exampleCount;
  },

  setInputs(x: number, y: number): void {
    if (!mlStore.iml) {
      void lazyInit();
      return;
    }
    mlStore.iml.inferXY(x, y);
  },

  thumbsUp(): void {
    if (!mlStore.iml) return;
    // Stream 10 will replace this with the full RL controller; the
    // legacy probe behaviour is "train, then settle". For now we run
    // a sync training step.
    mlStore.iml.train();
  },

  thumbsDown(): void {
    if (!mlStore.iml) return;
    // Default RL noise burst at the playground's typical spread. Stream
    // 10 will hook the noise cap from the control surface state.
    mlStore.iml.moveWeights(0.1, 0.6);
  },

  train(): number {
    if (!mlStore.iml) {
      void lazyInit();
      return 0;
    }
    return mlStore.iml.train();
  },

  async trainAsync(): Promise<number> {
    await lazyInit();
    if (!mlStore.iml) return 0;
    return mlStore.iml.trainAsync();
  },

  randomise(): void {
    if (!mlStore.iml) return;
    mlStore.iml.randomiseWeights(0.6);
  },

  clearExamples(): void {
    mlStore.clearExamples();
  },

  saveState(): void {
    mlStore.saveNow();
  },

  evalLoss(): number | null {
    if (!mlStore.iml) return null;
    return mlStore.iml.evalLoss();
  },

  inferBatch(points: ReadonlyArray<readonly [number, number]>): Float32Array {
    if (!mlStore.iml) return new Float32Array(points.length * mlStore.state.outputSize);
    return mlStore.iml.inferBatch(points);
  },

  getLayerStats(): Float32Array {
    if (!mlStore.iml) return EMPTY_F32;
    return mlStore.iml.getLayerStatsFlat();
  },
};

/**
 * Install the probe on window. Idempotent — the probe object is a
 * singleton, so capturing `window.__nisps` once is safe across hot
 * reloads and re-installs.
 */
export function installDebugProbe(): void {
  if (typeof window === 'undefined') return;
  window.__nisps = probe;
}
