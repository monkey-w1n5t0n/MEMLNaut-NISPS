/**
 * ML store — Solid-side state for the WASM-backed ML engine.
 *
 * Stream 7 wires this to a `WasmIML` instance. The store still owns the
 * Solid-reactive state (sizes, loss, training flag, ready flag) and a
 * Float32Array signal for outputs. The WasmIML class drives the values
 * via `__set*` setters — kept exported so the WasmIML implementation can
 * write through without going through reactive accessors.
 *
 * Why two layers (store + class)?
 *   - The class encapsulates the WASM heap, buffers, and worker.
 *   - The store is the consumer-facing surface for Solid components and
 *     the debug probe. Components shouldn't reach into the WASM directly.
 *
 * Singleton model: there is exactly one `WasmIML` per browser tab, owned
 * by the store. `initialize()` creates it; subsequent calls return the
 * existing one. This matches the legacy playground.
 */

import { createSignal, type Accessor } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { coreBus } from './bus';
import type { WasmIML } from '../ml/wasm-iml';
import type { LayerStats } from '../ml/types';

export interface MLStoreState {
  exampleCount: number;
  /** Last training loss (final loss of last train() call). null = none yet. */
  lastLoss: number | null;
  /** Last training run loss curve (per iteration). */
  lossHistory: number[];
  /** Current input vector size (matches active mode). */
  inputSize: number;
  /** Current output vector size (matches active mode). */
  outputSize: number;
  /** True while a synchronous or async training call is running. */
  training: boolean;
  /** True when WASM is fully initialised. */
  ready: boolean;
}

const EMPTY_OUTPUTS = new Float32Array(0);

const [state, setState] = createStore<MLStoreState>({
  exampleCount: 0,
  lastLoss: null,
  lossHistory: [],
  inputSize: 2,
  outputSize: 126,
  training: false,
  ready: false,
});

const [outputs, setOutputs] = createSignal<Float32Array>(EMPTY_OUTPUTS, {
  equals: false, // always notify even if reference reused
});

const [weights, setWeights] = createSignal<Float32Array>(EMPTY_OUTPUTS, {
  equals: false,
});

// Singleton WasmIML, lazily created by initialize().
let imlInstance: WasmIML | null = null;
let initPromise: Promise<WasmIML> | null = null;

function requireIML(op: string): WasmIML {
  if (!imlInstance) {
    throw new Error(
      `[ml-store] ${op} called before initialize() — call mlStore.initialize() first`,
    );
  }
  return imlInstance;
}

export const mlStore = {
  // ---- read ----
  state,
  outputs: outputs as Accessor<Float32Array>,
  weights: weights as Accessor<Float32Array>,

  /** Direct access to the WasmIML instance (null until initialize() resolves). */
  get iml(): WasmIML | null {
    return imlInstance;
  },

  // ---- internal setters (used by WasmIML to push state into the store) ----
  __setOutputs: setOutputs,
  __setState: setState,
  __setWeights: setWeights,

  // ---- ML lifecycle ----

  /**
   * Load the WASM and create the singleton WasmIML. Idempotent: returns
   * the cached instance on subsequent calls.
   *
   * `inputSize` / `outputSize` are accepted for forward compatibility but
   * ignored if they don't match the WASM build's compile-time architecture.
   */
  async initialize(inputSize?: number, outputSize?: number): Promise<WasmIML> {
    if (imlInstance) return imlInstance;
    if (initPromise) return initPromise;
    // Lazy-import to keep the WASM glue out of the bundle until needed.
    initPromise = (async () => {
      const { WasmIML: WasmIMLCtor } = await import('../ml/wasm-iml');
      const inst = await WasmIMLCtor.create({
        inputSize,
        outputSize,
      });
      imlInstance = inst;
      return inst;
    })();
    return initPromise;
  },

  setInput(idx: number, value: number): void {
    requireIML('setInput').setInput(idx, value);
  },

  process(): void {
    requireIML('process').process();
  },

  inferXY(x: number, y: number): Float32Array {
    return requireIML('inferXY').inferXY(x, y);
  },

  addExample(features: ReadonlyArray<number>, labels: ReadonlyArray<number>): boolean {
    return requireIML('addExample').addExample(features, labels);
  },

  train(lr?: number, maxIter?: number, minErr?: number, sampleWeights?: Float32Array): number {
    return requireIML('train').train(lr, maxIter, minErr, sampleWeights);
  },

  trainAsync(lr?: number, maxIter?: number, minErr?: number, sampleWeights?: Float32Array): Promise<number> {
    return requireIML('trainAsync').trainAsync(lr, maxIter, minErr, sampleWeights);
  },

  drawWeights(spread: number): void {
    requireIML('drawWeights').randomiseWeights(spread);
  },

  moveWeights(speed: number, spread: number, pinMask?: Uint8Array): void {
    requireIML('moveWeights').moveWeights(speed, spread, pinMask);
  },

  evalLoss(): number | null {
    if (!imlInstance) return null;
    return imlInstance.evalLoss();
  },

  inferBatch(points: ReadonlyArray<readonly [number, number]>): Float32Array {
    if (!imlInstance) {
      // Until the WASM is up the probe gets a zero array of the expected
      // total size. Matches the stub behaviour expected by tests.
      return new Float32Array(points.length * state.outputSize);
    }
    return imlInstance.inferBatch(points);
  },

  getLayerStats(): Float32Array {
    if (!imlInstance) return EMPTY_OUTPUTS;
    return imlInstance.getLayerStatsFlat();
  },

  getLayerStatsRecords(): LayerStats[] {
    if (!imlInstance) return [];
    return imlInstance.getLayerStats();
  },

  getWeights(): Float32Array {
    if (!imlInstance) return EMPTY_OUTPUTS;
    return imlInstance.getWeights();
  },

  setWeights(w: Float32Array): void {
    requireIML('setWeights').setWeights(w);
  },

  reset(): void {
    requireIML('reset').reset();
  },

  clearExamples(): void {
    if (imlInstance) {
      imlInstance.clearExamples();
      return;
    }
    setState(produce((s) => {
      s.exampleCount = 0;
    }));
    coreBus.emit('ml.examples_cleared', undefined);
  },

  saveNow(): void {
    imlInstance?.saveNow();
  },

  /** Disposes the singleton. Used by tests and on hot-reload. */
  __dispose(): void {
    if (imlInstance) {
      imlInstance.dispose();
      imlInstance = null;
    }
    initPromise = null;
    setState({
      exampleCount: 0,
      lastLoss: null,
      lossHistory: [],
      inputSize: 2,
      outputSize: 126,
      training: false,
      ready: false,
    });
    setOutputs(EMPTY_OUTPUTS);
    setWeights(EMPTY_OUTPUTS);
  },
};

export type MLStore = typeof mlStore;
