/**
 * ML store — placeholder shape for the ML engine state.
 *
 * Stream 7 wires WASM under this. For now the methods that mutate the engine
 * throw `not implemented`. The shape of the store and the signal types are
 * final — modes and primitives can read them.
 *
 * Why a Solid store + a separate Float32Array signal:
 *   - `createStore` is great for object-like state with fine reactivity.
 *   - Float32Array outputs are large and frequently updated; `createSignal`
 *     with explicit reference replacement is cheaper.
 */

import { createSignal, type Accessor } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { coreBus } from './bus';

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
const NOT_IMPLEMENTED = (op: string): never => {
  throw new Error(
    `[ml-store] ${op} not implemented in stream-8 scaffold; awaits stream 7 (WASM bindings)`
  );
};

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

export const mlStore = {
  // ---- read ----
  state,
  outputs: outputs as Accessor<Float32Array>,
  weights: weights as Accessor<Float32Array>,

  // ---- internal setters (used by future WASM wiring; exposed for stub
  // wiring during this stream so primitive demos can drive values) ----
  __setOutputs: setOutputs,
  __setState: setState,
  __setWeights: setWeights,

  // ---- ML lifecycle (stubbed) ----
  initialize(_inputSize: number, _outputSize: number): Promise<void> {
    return NOT_IMPLEMENTED('initialize');
  },
  setInput(_idx: number, _value: number): void {
    NOT_IMPLEMENTED('setInput');
  },
  process(): void {
    NOT_IMPLEMENTED('process');
  },
  addExample(_features: ReadonlyArray<number>, _labels: ReadonlyArray<number>): void {
    NOT_IMPLEMENTED('addExample');
  },
  train(_lr?: number, _maxIter?: number): number {
    return NOT_IMPLEMENTED('train');
  },
  trainAsync(_lr?: number, _maxIter?: number): Promise<number> {
    return NOT_IMPLEMENTED('trainAsync');
  },
  drawWeights(_spread: number): void {
    NOT_IMPLEMENTED('drawWeights');
  },
  moveWeights(_speed: number, _spread: number, _pinMask?: Uint8Array): void {
    NOT_IMPLEMENTED('moveWeights');
  },
  evalLoss(): number | null {
    return null;
  },
  inferBatch(_points: ReadonlyArray<readonly [number, number]>): Float32Array {
    return NOT_IMPLEMENTED('inferBatch');
  },
  getLayerStats(): Float32Array {
    return EMPTY_OUTPUTS;
  },
  reset(): void {
    NOT_IMPLEMENTED('reset');
  },
  clearExamples(): void {
    setState(produce((s) => {
      s.exampleCount = 0;
    }));
    coreBus.emit('ml.examples_cleared', undefined);
  },
};

export type MLStore = typeof mlStore;
