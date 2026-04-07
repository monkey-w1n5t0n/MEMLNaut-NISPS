/**
 * WasmIML — TypeScript port of playground/js/nisps/nisps-wasm.js
 * WASM-backed IML using nisps-core compiled to WASM.
 * Construction is async: use `await WasmIML.create(...)`.
 */

import NispsModuleFactory from './wasm/nisps.js';

import { Dataset } from './dataset';
import type { WrappedModule, LayerStats, WeightSnapshot } from './wasm-types';

/** Activation function IDs matching C++ nisps::ACTIVATION_FUNCTIONS enum */
const ACTIVATION = { SIGMOID: 0, TANH: 1, LINEAR: 2, RELU: 3 } as const;

/**
 * Load the Emscripten module. Returns the initialized module.
 */
async function loadNispsModule(): Promise<any> {
  const mod = await NispsModuleFactory({
    locateFile: (path: string) => {
      // WASM binary is in public/ (served at root), glue code is in src/
      if (path.endsWith('.wasm')) return `/${path}`;
      return path;
    },
  });
  return mod;
}

/**
 * Wrap raw Emscripten module with typed JS helpers.
 */
function wrapModule(mod: any): WrappedModule {
  const cwrap = mod.cwrap.bind(mod);
  return {
    mod,
    create: cwrap('nisps_mlp_create', 'number', ['number', 'number', 'number', 'number']),
    destroy: cwrap('nisps_mlp_destroy', null, ['number']),
    weightCount: cwrap('nisps_mlp_weight_count', 'number', ['number']),
    getWeights: cwrap('nisps_mlp_get_weights', null, ['number', 'number']),
    setWeights: cwrap('nisps_mlp_set_weights', null, ['number', 'number']),
    inference: cwrap('nisps_mlp_inference', null, ['number', 'number', 'number', 'number', 'number']),
    train: cwrap('nisps_mlp_train', 'number', [
      'number', 'number', 'number', 'number',
      'number', 'number', 'number',
      'number', 'number', 'number',
    ]),
    trainEx: cwrap('nisps_mlp_train_ex', 'number', [
      'number', 'number', 'number', 'number',
      'number', 'number', 'number',
      'number', 'number', 'number', 'number',
    ]),
    drawWeightsSpread: cwrap('nisps_mlp_draw_weights_spread', null, ['number', 'number']),
    moveWeightsSpread: cwrap('nisps_mlp_move_weights_spread', null, ['number', 'number', 'number']),
    moveWeightsEx: cwrap('nisps_mlp_move_weights_ex', null, ['number', 'number', 'number', 'number', 'number']),
    inferBatch: cwrap('nisps_mlp_infer_batch', null, ['number', 'number', 'number', 'number', 'number', 'number']),
    evalLoss: cwrap('nisps_mlp_eval_loss', 'number', [
      'number', 'number', 'number', 'number',
      'number', 'number', 'number',
    ]),
    getLayerStats: cwrap('nisps_mlp_get_layer_stats', null, ['number', 'number', 'number']),
    alloc: cwrap('nisps_alloc', 'number', ['number']),
    free: cwrap('nisps_free', null, ['number']),
    allocInt: cwrap('nisps_alloc_int', 'number', ['number']),
    freeInt: cwrap('nisps_free_int', null, ['number']),
  };
}

/** Write a Float32Array into WASM heap, returning the pointer */
function toHeapF32(w: WrappedModule, arr: Float32Array | number[]): number {
  const typed = arr instanceof Float32Array ? arr : new Float32Array(arr);
  const ptr = w.alloc(typed.length);
  w.mod.HEAPF32.set(typed, ptr >> 2);
  return ptr;
}

/** Write an Int32Array into WASM heap, returning the pointer */
function toHeapI32(w: WrappedModule, arr: Int32Array): number {
  const ptr = w.allocInt(arr.length);
  w.mod.HEAP32.set(arr, ptr >> 2);
  return ptr;
}

/** Read a Float32Array from WASM heap */
function fromHeapF32(w: WrappedModule, ptr: number, length: number): number[] {
  const offset = ptr >> 2;
  return Array.from(w.mod.HEAPF32.subarray(offset, offset + length));
}

export class WasmIML {
  // Architecture
  nInputs: number;
  nOutputs: number;
  maxIterations: number;
  learningRate: number;
  convergenceThreshold: number;
  recencyBias = 0.6;
  weightingMode: 'global' | 'local' | 'combined' = 'global';
  localRadius = 0.15;
  layerSizes: number[];
  activationIds: number[];

  // WASM internals
  private _w: WrappedModule;
  private _mlp: number = 0;
  private _weightCount: number = 0;
  private _inputPtr: number;
  private _outputPtr: number;
  private _inputDim: number;

  // State
  inputState: number[];
  outputState: number[];
  performInference = true;
  inputUpdated = true;
  storedWeights: number[] | null = null;
  weightsRandomised = false;
  lastLoss: number | null = null;
  bestLoss: number | null = null;
  lossHistory: number[] = [];
  totalTrainingIterations = 0;
  logFn: ((msg: string) => void) | null = null;

  // Dataset (JS-side for persistence/visualization and sample weighting)
  dataset: Dataset;

  // Worker for async training
  private _worker: Worker | null = null;
  private _training = false;

  /**
   * Async factory — loads WASM and constructs the IML.
   */
  static async create(
    nInputs: number,
    nOutputs: number,
    hiddenLayers: number[] = [32, 48, 64],
    maxIterations = 1000,
    learningRate = 1.0,
    convergenceThreshold = 0.00001
  ): Promise<WasmIML> {
    const mod = await loadNispsModule();
    const iml = new WasmIML(
      mod, nInputs, nOutputs, hiddenLayers,
      maxIterations, learningRate, convergenceThreshold
    );
    return iml;
  }

  constructor(
    mod: any,
    nInputs: number,
    nOutputs: number,
    hiddenLayers: number[],
    maxIterations: number,
    learningRate: number,
    convergenceThreshold: number
  ) {
    this.nInputs = nInputs;
    this.nOutputs = nOutputs;
    this.maxIterations = maxIterations;
    this.learningRate = learningRate;
    this.convergenceThreshold = convergenceThreshold;

    const BIAS = 1;
    this.layerSizes = [nInputs + BIAS, ...hiddenLayers, nOutputs];
    this.activationIds = [
      ...hiddenLayers.map(() => ACTIVATION.RELU),
      ACTIVATION.SIGMOID,
    ];

    this._w = wrapModule(mod);
    this._createMLP();

    this.inputState = new Array(nInputs).fill(0.5);
    this.outputState = new Array(nOutputs).fill(0);
    this.dataset = new Dataset(100);

    // Persistent WASM buffers for inference
    const inputDim = nInputs + BIAS;
    this._inputPtr = this._w.alloc(inputDim);
    this._outputPtr = this._w.alloc(nOutputs);
    this._inputDim = inputDim;
  }

  private _createMLP(): void {
    const w = this._w;
    const layerPtr = toHeapI32(w, new Int32Array(this.layerSizes));
    const actPtr = toHeapI32(w, new Int32Array(this.activationIds));
    this._mlp = w.create(layerPtr, this.layerSizes.length, actPtr, this.activationIds.length);
    w.freeInt(layerPtr);
    w.freeInt(actPtr);
    this._weightCount = w.weightCount(this._mlp);
  }

  // ---- Logging ----
  setLogger(fn: (msg: string) => void): void { this.logFn = fn; }
  log(msg: string): void { if (this.logFn) this.logFn(msg); }

  // ---- Input / Output ----
  setInput(index: number, value: number): void {
    if (index >= this.nInputs) return;
    this.inputState[index] = Math.max(0, Math.min(1, value));
    this.inputUpdated = true;
  }

  setInputs(values: number[]): void {
    for (let i = 0; i < values.length && i < this.nInputs; i++) {
      this.inputState[i] = Math.max(0, Math.min(1, values[i]));
    }
    this.inputUpdated = true;
  }

  getOutputs(): number[] { return this.outputState; }

  setOutput(index: number, value: number): void {
    if (index >= this.nOutputs) return;
    this.outputState[index] = Math.max(0, Math.min(1, value));
  }

  setOutputs(values: number[]): void {
    for (let i = 0; i < values.length && i < this.nOutputs; i++) {
      this.outputState[i] = Math.max(0, Math.min(1, values[i]));
    }
  }

  // ---- Inference (WASM, synchronous) ----
  process(): void {
    if (!this.performInference || !this.inputUpdated) return;

    const heap = this._w.mod.HEAPF32;
    const inOff = this._inputPtr >> 2;
    for (let i = 0; i < this.nInputs; i++) {
      heap[inOff + i] = this.inputState[i];
    }
    heap[inOff + this.nInputs] = 1.0; // bias

    this._w.inference(
      this._mlp, this._inputPtr, this._inputDim, this._outputPtr, this.nOutputs
    );

    const outOff = this._outputPtr >> 2;
    for (let i = 0; i < this.nOutputs; i++) {
      this.outputState[i] = heap[outOff + i];
    }

    this.inputUpdated = false;
  }

  // ---- Batch inference (WASM) ----
  inferBatch(inputPoints: number[][]): number[][] {
    const nPoints = inputPoints.length;
    const inputDim = this.nInputs + 1; // +bias
    const inFlat = new Float32Array(nPoints * inputDim);
    for (let i = 0; i < nPoints; i++) {
      for (let j = 0; j < this.nInputs; j++) {
        inFlat[i * inputDim + j] = inputPoints[i][j];
      }
      inFlat[i * inputDim + this.nInputs] = 1.0;
    }
    const inPtr = toHeapF32(this._w, inFlat);
    const outPtr = this._w.alloc(nPoints * this.nOutputs);
    this._w.inferBatch(this._mlp, inPtr, nPoints, inputDim, outPtr, this.nOutputs);
    const results: number[][] = [];
    const heap = this._w.mod.HEAPF32;
    const outOff = outPtr >> 2;
    for (let i = 0; i < nPoints; i++) {
      const row = new Array(this.nOutputs);
      for (let j = 0; j < this.nOutputs; j++) {
        row[j] = heap[outOff + i * this.nOutputs + j];
      }
      results.push(row);
    }
    this._w.free(inPtr);
    this._w.free(outPtr);
    return results;
  }

  // ---- Dataset ----
  addExample(inputs: number[], outputs: number[]): void {
    const inVec = inputs.slice(0, this.nInputs);
    while (inVec.length < this.nInputs) inVec.push(0);
    const outVec = outputs.slice(0, this.nOutputs);
    while (outVec.length < this.nOutputs) outVec.push(0);
    this.dataset.add(inVec, outVec);
  }

  clearDataset(): void {
    this.dataset.clear();
    this.log('Dataset cleared.');
  }

  get exampleCount(): number { return this.dataset.features.length; }

  // ---- Training (WASM, synchronous) ----
  train(_options: Record<string, unknown> = {}): number | null {
    if (this.weightsRandomised && this.storedWeights) {
      this._setFlatWeights(this.storedWeights);
      this.weightsRandomised = false;
    }

    if (this.dataset.features.length === 0) {
      this.log('Empty dataset, skipping training.');
      return null;
    }

    this.log('Training...');

    const features = this.dataset.features;
    const labels = this.dataset.labels;

    const sampleWeights = this.dataset.computeWeights(this.weightingMode, {
      recencyBias: this.recencyBias,
      queryInput: this.inputState,
      radius: this.localRadius,
    });

    const featureDim = this.nInputs + 1;
    const nSamples = features.length;
    const featFlat = new Float32Array(nSamples * featureDim);
    const labFlat = new Float32Array(nSamples * this.nOutputs);

    for (let i = 0; i < nSamples; i++) {
      for (let j = 0; j < this.nInputs; j++) {
        featFlat[i * featureDim + j] = features[i][j];
      }
      featFlat[i * featureDim + this.nInputs] = 1.0;
      for (let j = 0; j < this.nOutputs; j++) {
        labFlat[i * this.nOutputs + j] = labels[i][j] || 0;
      }
    }

    const featPtr = toHeapF32(this._w, featFlat);
    const labPtr = toHeapF32(this._w, labFlat);
    const weightPtr = toHeapF32(this._w, sampleWeights);
    const lossHistPtr = this._w.alloc(this.maxIterations);

    const itersRun = this._w.trainEx(
      this._mlp, featPtr, nSamples, featureDim,
      labPtr, this.nOutputs,
      weightPtr,
      this.learningRate, this.maxIterations, this.convergenceThreshold,
      lossHistPtr
    );

    const lossHist = fromHeapF32(this._w, lossHistPtr, itersRun);

    this._w.free(featPtr);
    this._w.free(labPtr);
    this._w.free(weightPtr);
    this._w.free(lossHistPtr);

    const loss = itersRun > 0 ? lossHist[itersRun - 1] : 0;
    this.lastLoss = loss;
    for (let i = 0; i < lossHist.length; i++) {
      this.lossHistory.push(lossHist[i]);
    }
    this.totalTrainingIterations += itersRun;
    if (this.lossHistory.length > 1200) {
      this.lossHistory = this.lossHistory.slice(this.lossHistory.length - 1200);
    }
    this.bestLoss = this.bestLoss === null ? loss : Math.min(this.bestLoss, loss);

    this.inputUpdated = true;
    this.process();

    this.log(`Training complete. Loss: ${loss.toFixed(6)}`);
    return loss;
  }

  // ---- Loss evaluation (WASM, no weight update) ----
  evalLoss(): number | null {
    if (this.dataset.features.length === 0) return null;

    const features = this.dataset.features;
    const labels = this.dataset.labels;

    const sampleWeights = this.dataset.computeWeights(this.weightingMode, {
      recencyBias: this.recencyBias,
      queryInput: this.inputState,
      radius: this.localRadius,
    });

    const featureDim = this.nInputs + 1;
    const nSamples = features.length;
    const featFlat = new Float32Array(nSamples * featureDim);
    const labFlat = new Float32Array(nSamples * this.nOutputs);

    for (let i = 0; i < nSamples; i++) {
      for (let j = 0; j < this.nInputs; j++) {
        featFlat[i * featureDim + j] = features[i][j];
      }
      featFlat[i * featureDim + this.nInputs] = 1.0;
      for (let j = 0; j < this.nOutputs; j++) {
        labFlat[i * this.nOutputs + j] = labels[i][j] || 0;
      }
    }

    const featPtr = toHeapF32(this._w, featFlat);
    const labPtr = toHeapF32(this._w, labFlat);
    const weightPtr = toHeapF32(this._w, sampleWeights);

    const loss = this._w.evalLoss(
      this._mlp, featPtr, nSamples, featureDim,
      labPtr, this.nOutputs, weightPtr
    );

    this._w.free(featPtr);
    this._w.free(labPtr);
    this._w.free(weightPtr);

    return loss;
  }

  // ---- Weight manipulation ----
  randomiseWeights(spread = 0): void {
    this.storedWeights = this._getFlatWeights();
    this._w.drawWeightsSpread(this._mlp, spread);
    this.weightsRandomised = true;
    this.inputUpdated = true;
    this.process();
    this.log('Weights randomised.');
  }

  moveWeights(speed: number, spread = 0, outputPinMask: number[] | null = null): void {
    let pinMaskPtr = 0;

    if (outputPinMask && outputPinMask.some(v => v)) {
      const pinI32 = new Int32Array(this.nOutputs);
      for (let i = 0; i < this.nOutputs; i++) {
        pinI32[i] = outputPinMask[i] ? 1 : 0;
      }
      pinMaskPtr = toHeapI32(this._w, pinI32);
    }

    this._w.moveWeightsEx(this._mlp, speed, spread, pinMaskPtr, this.nOutputs);

    if (pinMaskPtr) this._w.freeInt(pinMaskPtr);

    this.inputUpdated = true;
    this.process();
  }

  // ---- Weight snapshot for warm-start transfer ----
  extractWeights(): WeightSnapshot {
    return {
      layerSizes: [...this.layerSizes],
      weights: this._getFlatWeights(),
    };
  }

  static async createWithWarmStart(
    snapshot: WeightSnapshot,
    newOutputCount: number,
    maxIter: number,
    learningRate: number,
    convergenceThreshold: number
  ): Promise<WasmIML> {
    const oldLayerSizes = snapshot.layerSizes;
    const nInputs = oldLayerSizes[0] - 1;
    const hiddenLayers = oldLayerSizes.slice(1, -1);
    const oldOutputCount = oldLayerSizes[oldLayerSizes.length - 1];

    const newIml = await WasmIML.create(
      nInputs, newOutputCount, hiddenLayers, maxIter, learningRate, convergenceThreshold
    );

    let prefixCount = 0;
    for (let l = 1; l < oldLayerSizes.length - 1; l++) {
      prefixCount += oldLayerSizes[l] * (oldLayerSizes[l - 1] + 1);
    }

    const lastHidden = hiddenLayers[hiddenLayers.length - 1];
    const weightsPerOutputNode = lastHidden + 1;

    const newWeights = newIml._getFlatWeights();
    const oldWeights = snapshot.weights;

    for (let i = 0; i < prefixCount; i++) {
      newWeights[i] = oldWeights[i];
    }

    const sharedOutputNodes = Math.min(oldOutputCount, newOutputCount);
    for (let n = 0; n < sharedOutputNodes; n++) {
      const oldOff = prefixCount + n * weightsPerOutputNode;
      const newOff = prefixCount + n * weightsPerOutputNode;
      for (let w = 0; w < weightsPerOutputNode; w++) {
        newWeights[newOff + w] = oldWeights[oldOff + w];
      }
    }

    newIml._setFlatWeights(newWeights);
    return newIml;
  }

  // ---- Flat weight get/set ----
  _getFlatWeights(): number[] {
    const ptr = this._w.alloc(this._weightCount);
    this._w.getWeights(this._mlp, ptr);
    const weights = fromHeapF32(this._w, ptr, this._weightCount);
    this._w.free(ptr);
    return weights;
  }

  _setFlatWeights(flatWeights: number[]): void {
    const ptr = toHeapF32(this._w, new Float32Array(flatWeights));
    this._w.setWeights(this._mlp, ptr);
    this._w.free(ptr);
  }

  // ---- Per-layer weight statistics ----
  getLayerStats(): LayerStats[] {
    const nLayers = this.layerSizes.length - 1;
    const statsPtr = this._w.alloc(nLayers * 4);
    this._w.getLayerStats(this._mlp, statsPtr, nLayers);
    const stats: LayerStats[] = [];
    const heap = this._w.mod.HEAPF32;
    const off = statsPtr >> 2;
    for (let l = 0; l < nLayers; l++) {
      stats.push({
        meanAbs: heap[off + l * 4 + 0],
        maxAbs: heap[off + l * 4 + 1],
        deadFrac: heap[off + l * 4 + 2],
        satFrac: heap[off + l * 4 + 3],
      });
    }
    this._w.free(statsPtr);
    return stats;
  }

  // ---- Async training via Web Worker ----
  get isTraining(): boolean { return this._training; }

  trainAsync(onComplete?: (result: { loss: number; outputs: number[] }) => void): Promise<number | null> {
    if (this._training) {
      this.log('Training already in progress, skipping.');
      return Promise.resolve(null);
    }

    if (this.weightsRandomised && this.storedWeights) {
      this._setFlatWeights(this.storedWeights);
      this.weightsRandomised = false;
    }

    if (this.dataset.features.length === 0) {
      this.log('Empty dataset, skipping training.');
      return Promise.resolve(null);
    }

    this._training = true;
    this.log('Training (async)...');

    const flatWeights = this._getFlatWeights();
    const features = this.dataset.features;
    const labels = this.dataset.labels;
    const sampleWeights = Array.from(this.dataset.computeWeights(this.weightingMode, {
      recencyBias: this.recencyBias,
      queryInput: this.inputState,
      radius: this.localRadius,
    }));

    // Lazy-init worker
    if (!this._worker) {
      const workerUrl = new URL('./wasm/nisps-wasm-worker.js', import.meta.url);
      this._worker = new Worker(workerUrl, { type: 'module' });
    }

    return new Promise((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'trained') {
          this._worker!.removeEventListener('message', handler);
          this._training = false;

          const { weights, loss, lossHistory } = e.data.payload;

          this._setFlatWeights(weights);
          this.lastLoss = loss;
          if (lossHistory && lossHistory.length > 0) {
            for (let i = 0; i < lossHistory.length; i++) {
              this.lossHistory.push(lossHistory[i]);
            }
            this.totalTrainingIterations += lossHistory.length;
          } else {
            this.lossHistory.push(loss);
            this.totalTrainingIterations += 1;
          }
          if (this.lossHistory.length > 1200) {
            this.lossHistory = this.lossHistory.slice(this.lossHistory.length - 1200);
          }
          this.bestLoss = this.bestLoss === null ? loss : Math.min(this.bestLoss, loss);

          this.inputUpdated = true;
          this.process();

          this.log(`Training complete. Loss: ${loss.toFixed(6)}`);
          if (onComplete) onComplete({ loss, outputs: [...this.outputState] });
          resolve(loss);
        }
      };

      this._worker!.addEventListener('message', handler);
      this._worker!.postMessage({
        type: 'train',
        payload: {
          layerSizes: this.layerSizes,
          activationIds: this.activationIds,
          weights: flatWeights,
          features,
          labels,
          sampleWeights,
          nInputs: this.nInputs,
          nOutputs: this.nOutputs,
          learningRate: this.learningRate,
          maxIterations: this.maxIterations,
          convergenceThreshold: this.convergenceThreshold,
        },
      });
    });
  }

  // ---- Cleanup ----
  destroy(): void {
    if (this._mlp) {
      this._w.free(this._inputPtr);
      this._w.free(this._outputPtr);
      this._w.destroy(this._mlp);
      (this as any)._mlp = null;
    }
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }
}
