// WASM-backed IML — drop-in replacement for the JS IML class.
// Uses nisps-core compiled to WASM for inference, training, and weight ops.
// Training runs in a Web Worker for non-blocking operation.

import { Dataset } from './dataset.js';

// Activation function IDs matching C++ nisps::ACTIVATION_FUNCTIONS enum
const ACTIVATION = { SIGMOID: 0, TANH: 1, LINEAR: 2, RELU: 3 };

/**
 * Load the Emscripten module. Returns the initialized module.
 */
async function loadNispsModule() {
  const { default: NispsModule } = await import('../../wasm/nisps.js');
  const mod = await NispsModule();
  return mod;
}

/**
 * Wrap raw Emscripten module with typed JS helpers.
 */
function wrapModule(mod) {
  return {
    mod,
    create: mod.cwrap('nisps_mlp_create', 'number', ['number', 'number', 'number', 'number']),
    destroy: mod.cwrap('nisps_mlp_destroy', null, ['number']),
    weightCount: mod.cwrap('nisps_mlp_weight_count', 'number', ['number']),
    getWeights: mod.cwrap('nisps_mlp_get_weights', null, ['number', 'number']),
    setWeights: mod.cwrap('nisps_mlp_set_weights', null, ['number', 'number']),
    inference: mod.cwrap('nisps_mlp_inference', null, ['number', 'number', 'number', 'number', 'number']),
    train: mod.cwrap('nisps_mlp_train', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']),
    drawWeightsSpread: mod.cwrap('nisps_mlp_draw_weights_spread', null, ['number', 'number']),
    moveWeightsSpread: mod.cwrap('nisps_mlp_move_weights_spread', null, ['number', 'number', 'number']),
    inferBatch: mod.cwrap('nisps_mlp_infer_batch', null, ['number', 'number', 'number', 'number', 'number', 'number']),
    trainEx: mod.cwrap('nisps_mlp_train_ex', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']),
    moveWeightsEx: mod.cwrap('nisps_mlp_move_weights_ex', null, ['number', 'number', 'number', 'number', 'number']),
    evalLoss: mod.cwrap('nisps_mlp_eval_loss', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
    getLayerStats: mod.cwrap('nisps_mlp_get_layer_stats', null, ['number', 'number', 'number']),
    alloc: mod.cwrap('nisps_alloc', 'number', ['number']),
    free: mod.cwrap('nisps_free', null, ['number']),
    allocInt: mod.cwrap('nisps_alloc_int', 'number', ['number']),
    freeInt: mod.cwrap('nisps_free_int', null, ['number']),
  };
}

/**
 * Write a JS array into WASM heap, returning the pointer.
 * Caller must free with w.free(ptr).
 */
function toHeapF32(w, arr) {
  const ptr = w.alloc(arr.length);
  w.mod.HEAPF32.set(arr, ptr >> 2);
  return ptr;
}

function toHeapI32(w, arr) {
  const ptr = w.allocInt(arr.length);
  w.mod.HEAP32.set(arr, ptr >> 2);
  return ptr;
}

function fromHeapF32(w, ptr, length) {
  const offset = ptr >> 2;
  return Array.from(w.mod.HEAPF32.subarray(offset, offset + length));
}

/**
 * WASM-backed IML class — API-compatible with the JS IML.
 *
 * Construction is async: use `await WasmIML.create(...)` instead of `new IML(...)`.
 */
export class WasmIML {
  /**
   * Async factory — loads WASM and constructs the IML.
   */
  static async create(
    nInputs,
    nOutputs,
    hiddenLayers = [10, 10, 14],
    maxIterations = 1000,
    learningRate = 1.0,
    convergenceThreshold = 0.00001
  ) {
    const mod = await loadNispsModule();
    const iml = new WasmIML(mod, nInputs, nOutputs, hiddenLayers,
                            maxIterations, learningRate, convergenceThreshold);
    return iml;
  }

  constructor(mod, nInputs, nOutputs, hiddenLayers, maxIterations, learningRate, convergenceThreshold) {
    this.nInputs = nInputs;
    this.nOutputs = nOutputs;
    this.maxIterations = maxIterations;
    this.learningRate = learningRate;
    this.convergenceThreshold = convergenceThreshold;
    this.recencyBias = 0.6;       // 0 = uniform, 1 = strong recency
    this.weightingMode = 'global'; // 'global' | 'local' | 'combined'
    this.localRadius = 0.15;      // input-space radius for local weighting

    // Layer sizes: input+bias, hidden..., output
    const BIAS = 1;
    this.layerSizes = [nInputs + BIAS, ...hiddenLayers, nOutputs];
    // Activations: RELU for hidden, SIGMOID for output
    this.activationIds = [
      ...hiddenLayers.map(() => ACTIVATION.RELU),
      ACTIVATION.SIGMOID,
    ];

    // WASM module + helpers
    this._w = wrapModule(mod);
    this._createMLP();

    // State (JS-side, same as original IML)
    this.inputState = new Array(nInputs).fill(0.5);
    this.outputState = new Array(nOutputs).fill(0);
    this.performInference = true;
    this.inputUpdated = true;
    this.storedWeights = null;
    this.weightsRandomised = false;
    this.lastLoss = null;
    this.bestLoss = null;
    this.lossHistory = [];
    this.totalTrainingIterations = 0;
    this.logFn = null;

    // Dataset (JS-side for persistence/visualization access and sample weighting)
    this.dataset = new Dataset(100);

    // Persistent WASM buffers for inference (avoid alloc/free per frame)
    const inputDim = nInputs + BIAS;
    this._inputPtr = this._w.alloc(inputDim);
    this._outputPtr = this._w.alloc(nOutputs);
    this._inputDim = inputDim;

    // Worker for async training
    this._worker = null;
    this._training = false;
    this._pendingTrainResolve = null;
  }

  _createMLP() {
    const w = this._w;
    const layerPtr = toHeapI32(w, new Int32Array(this.layerSizes));
    const actPtr = toHeapI32(w, new Int32Array(this.activationIds));
    this._mlp = w.create(layerPtr, this.layerSizes.length, actPtr, this.activationIds.length);
    w.freeInt(layerPtr);
    w.freeInt(actPtr);
    this._weightCount = w.weightCount(this._mlp);
  }

  // ---- Logging ----
  setLogger(fn) { this.logFn = fn; }
  log(msg) { if (this.logFn) this.logFn(msg); }

  // ---- Input / Output ----
  setInput(index, value) {
    if (index >= this.nInputs) return;
    this.inputState[index] = Math.max(0, Math.min(1, value));
    this.inputUpdated = true;
  }

  setInputs(values) {
    for (let i = 0; i < values.length && i < this.nInputs; i++) {
      this.inputState[i] = Math.max(0, Math.min(1, values[i]));
    }
    this.inputUpdated = true;
  }

  getOutputs() { return this.outputState; }

  setOutput(index, value) {
    if (index >= this.nOutputs) return;
    this.outputState[index] = Math.max(0, Math.min(1, value));
  }

  setOutputs(values) {
    for (let i = 0; i < values.length && i < this.nOutputs; i++) {
      this.outputState[i] = Math.max(0, Math.min(1, values[i]));
    }
  }

  // ---- Inference (WASM, synchronous — fast) ----
  process() {
    if (!this.performInference || !this.inputUpdated) return;
    if (!this._mlp) return; // instance torn down / rebuilding

    // Write input + bias into persistent WASM buffer
    const heap = this._w.mod.HEAPF32;
    const inOff = this._inputPtr >> 2;
    for (let i = 0; i < this.nInputs; i++) {
      heap[inOff + i] = this.inputState[i];
    }
    heap[inOff + this.nInputs] = 1.0; // bias

    this._w.inference(this._mlp, this._inputPtr, this._inputDim, this._outputPtr, this.nOutputs);

    // Read output
    const outOff = this._outputPtr >> 2;
    for (let i = 0; i < this.nOutputs; i++) {
      this.outputState[i] = heap[outOff + i];
    }

    this.inputUpdated = false;
  }

  // ---- Batch inference (WASM) ----
  inferBatch(inputPoints) {
    if (!this._mlp) return inputPoints.map(() => new Array(this.nOutputs).fill(0));
    // inputPoints: array of [x,y,...] arrays (each length nInputs)
    // Returns: array of output arrays (each length nOutputs)
    const nPoints = inputPoints.length;
    const inputDim = this.nInputs + 1; // +bias
    const inFlat = new Float32Array(nPoints * inputDim);
    for (let i = 0; i < nPoints; i++) {
      for (let j = 0; j < this.nInputs; j++) {
        inFlat[i * inputDim + j] = inputPoints[i][j];
      }
      inFlat[i * inputDim + this.nInputs] = 1.0; // bias
    }
    const inPtr = toHeapF32(this._w, inFlat);
    const outPtr = this._w.alloc(nPoints * this.nOutputs);
    this._w.inferBatch(this._mlp, inPtr, nPoints, inputDim, outPtr, this.nOutputs);
    // Read outputs
    const results = [];
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
  addExample(inputs, outputs) {
    const inVec = inputs.slice(0, this.nInputs);
    while (inVec.length < this.nInputs) inVec.push(0);
    const outVec = outputs.slice(0, this.nOutputs);
    while (outVec.length < this.nOutputs) outVec.push(0);
    this.dataset.add(inVec, outVec);
  }

  clearDataset() {
    this.dataset.clear();
    this.log('Dataset cleared.');
  }

  get exampleCount() { return this.dataset.features.length; }

  // ---- Training (WASM, synchronous) ----
  train(options = {}) {
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

    // Compute per-sample weights
    const sampleWeights = this.dataset.computeWeights(this.weightingMode, {
      recencyBias: this.recencyBias,
      queryInput: this.inputState,
      radius: this.localRadius,
    });

    // Build flat arrays with bias appended to features
    const featureDim = this.nInputs + 1; // +bias
    const nSamples = features.length;
    const featFlat = new Float32Array(nSamples * featureDim);
    const labFlat = new Float32Array(nSamples * this.nOutputs);

    for (let i = 0; i < nSamples; i++) {
      for (let j = 0; j < this.nInputs; j++) {
        featFlat[i * featureDim + j] = features[i][j];
      }
      featFlat[i * featureDim + this.nInputs] = 1.0; // bias
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

    // Read per-iteration loss history
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

    // Run inference after training
    this.inputUpdated = true;
    this.process();

    this.log(`Training complete. Loss: ${loss.toFixed(6)}`);
    return loss;
  }

  // ---- Loss evaluation (WASM, no weight update) ----
  evalLoss() {
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
      labPtr, this.nOutputs,
      weightPtr
    );

    this._w.free(featPtr);
    this._w.free(labPtr);
    this._w.free(weightPtr);

    return loss;
  }

  // ---- Weight manipulation ----
  randomiseWeights(spread = 0) {
    this.storedWeights = this._getFlatWeights();
    this._w.drawWeightsSpread(this._mlp, spread);
    this.weightsRandomised = true;

    this.inputUpdated = true;
    this.process();
    this.log('Weights randomised.');
  }

  // outputPinMask: optional Uint8Array[nOutputs], 1 = skip that output node.
  moveWeights(speed, spread = 0, outputPinMask = null) {
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

  // ---- Public weight snapshot for warm-start transfer ----
  /**
   * Returns a plain object describing the full network weights for later
   * reinjection via WasmIML.createWithWarmStart().
   */
  extractWeights() {
    return {
      layerSizes: [...this.layerSizes],  // e.g. [3, 32, 48, 64, 126]
      weights: this._getFlatWeights(),   // plain Array from fromHeapF32
    };
  }

  /**
   * Async static factory: create a new WasmIML with newOutputCount outputs,
   * transferring as much of snapshot.weights as possible.
   * Hidden-layer weights are copied unchanged; output nodes beyond the old
   * count retain their random-initialised values.
   */
  static async createWithWarmStart(snapshot, newOutputCount, maxIter, learningRate, convergenceThreshold) {
    const oldLayerSizes = snapshot.layerSizes;
    const nInputs = oldLayerSizes[0] - 1;          // stored with bias (+1), strip it
    const hiddenLayers = oldLayerSizes.slice(1, -1); // e.g. [32, 48, 64]
    const oldOutputCount = oldLayerSizes[oldLayerSizes.length - 1];

    // Create fresh instance with new output count
    const newIml = await WasmIML.create(nInputs, newOutputCount, hiddenLayers, maxIter, learningRate, convergenceThreshold);

    // Calculate prefix weight count (all layers except the final output layer).
    // Each layer l: n_nodes[l] * (n_nodes[l-1] + 1) weights (inputs + bias).
    // fullOldSizes: [nInputs+1, ...hiddenLayers, oldOutputCount]
    let prefixCount = 0;
    for (let l = 1; l < oldLayerSizes.length - 1; l++) {
      prefixCount += oldLayerSizes[l] * (oldLayerSizes[l - 1] + 1);
    }

    const lastHidden = hiddenLayers[hiddenLayers.length - 1]; // e.g. 64
    const weightsPerOutputNode = lastHidden + 1; // inputs from last hidden + bias

    // Build new weight array, starting from random init
    const newWeights = newIml._getFlatWeights();
    const oldWeights = snapshot.weights;

    // Copy hidden layer weights unchanged
    for (let i = 0; i < prefixCount; i++) {
      newWeights[i] = oldWeights[i];
    }

    // Copy output layer weights for nodes that existed in the old network
    const sharedOutputNodes = Math.min(oldOutputCount, newOutputCount);
    for (let n = 0; n < sharedOutputNodes; n++) {
      const oldOff = prefixCount + n * weightsPerOutputNode;
      const newOff = prefixCount + n * weightsPerOutputNode;
      for (let w = 0; w < weightsPerOutputNode; w++) {
        newWeights[newOff + w] = oldWeights[oldOff + w];
      }
    }
    // Nodes beyond old count retain their random init — good for exploration

    newIml._setFlatWeights(newWeights);
    return newIml;
  }

  // ---- Flat weight get/set (for storedWeights save/restore) ----
  _getFlatWeights() {
    const ptr = this._w.alloc(this._weightCount);
    this._w.getWeights(this._mlp, ptr);
    const weights = fromHeapF32(this._w, ptr, this._weightCount);
    this._w.free(ptr);
    return weights;
  }

  _setFlatWeights(flatWeights) {
    const ptr = toHeapF32(this._w, new Float32Array(flatWeights));
    this._w.setWeights(this._mlp, ptr);
    this._w.free(ptr);
  }

  // ---- Per-layer weight statistics (WASM) ----
  getLayerStats() {
    const nLayers = this.layerSizes.length - 1;
    const statsPtr = this._w.alloc(nLayers * 4);
    this._w.getLayerStats(this._mlp, statsPtr, nLayers);
    const stats = [];
    const heap = this._w.mod.HEAPF32;
    const off = statsPtr >> 2;
    for (let l = 0; l < nLayers; l++) {
      stats.push({
        meanAbs:  heap[off + l * 4 + 0],
        maxAbs:   heap[off + l * 4 + 1],
        deadFrac: heap[off + l * 4 + 2],
        satFrac:  heap[off + l * 4 + 3],
      });
    }
    this._w.free(statsPtr);
    return stats;
  }

  // ---- Async training via Web Worker ----
  get isTraining() { return this._training; }

  trainAsync(onComplete) {
    if (this._training) {
      this.log('Training already in progress, skipping.');
      return Promise.resolve(null);
    }

    // Restore weights if randomised
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

    // Snapshot current weights + dataset for the worker
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
      const workerUrl = new URL('./nisps-wasm-worker.js', import.meta.url);
      this._worker = new Worker(workerUrl, { type: 'module' });
    }

    return new Promise((resolve) => {
      this._pendingTrainResolve = resolve;
      const handler = (e) => {
        if (e.data.type === 'trained') {
          if (this._worker) this._worker.removeEventListener('message', handler);
          this._training = false;
          this._pendingTrainResolve = null;

          const { weights, loss, lossHistory } = e.data.payload;

          // Swap in trained weights
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

          // Run inference with new weights
          this.inputUpdated = true;
          this.process();

          this.log(`Training complete. Loss: ${loss.toFixed(6)}`);
          if (onComplete) onComplete({ loss, outputs: [...this.outputState] });
          resolve(loss);
        }
      };

      this._worker.addEventListener('message', handler);
      this._worker.postMessage({
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

  // ---- Rebuild with a new architecture ----
  /**
   * Destroy and recreate the underlying WASM MLP with a new layer topology.
   *
   * MLP architecture is intentionally flexible and experimental:
   *   - Output layer size = count of non-bypassed params (preset-driven).
   *   - Internal hidden layers are independent knobs — tune freely.
   *
   * Weights are NOT preserved. Use extractWeights() / createWithWarmStart()
   * for warm-started transfers. Dataset is preserved, but examples whose
   * vector dimensions no longer match (wrong nInputs/nOutputs) are dropped.
   *
   * @param {number[]} newLayers — full layer spec: [nInputs+bias, ...hidden, nOutputs]
   *   (i.e. the same shape as this.layerSizes). Pass raw inputs excluding bias
   *   via `newHiddenAndOutput` overload is NOT supported — callers must include
   *   the bias slot in the input size.
   */
  rebuild(newLayers) {
    if (!Array.isArray(newLayers) || newLayers.length < 2) {
      throw new Error('rebuild: newLayers must be [inputs+bias, ...hidden, outputs]');
    }
    const newInputs = newLayers[0] - 1; // strip bias
    const newOutputs = newLayers[newLayers.length - 1];
    if (newInputs < 1 || newOutputs < 1) {
      throw new Error('rebuild: invalid layer sizes');
    }

    // Tear down old WASM instance + persistent buffers
    const w = this._w;
    if (this._mlp) {
      w.free(this._inputPtr);
      w.free(this._outputPtr);
      w.destroy(this._mlp);
      this._mlp = null;
    }

    // Update shape
    this.nInputs = newInputs;
    this.nOutputs = newOutputs;
    const hiddenLayers = newLayers.slice(1, -1);
    this.layerSizes = [...newLayers];
    this.activationIds = [
      ...hiddenLayers.map(() => ACTIVATION.RELU),
      ACTIVATION.SIGMOID,
    ];

    // Recreate WASM instance
    this._createMLP();

    // Reallocate persistent inference buffers
    this._inputDim = newInputs + 1;
    this._inputPtr = w.alloc(this._inputDim);
    this._outputPtr = w.alloc(newOutputs);

    // Reset JS-side state that depends on shape
    this.inputState = new Array(newInputs).fill(0.5);
    this.outputState = new Array(newOutputs).fill(0);
    this.performInference = true;
    this.inputUpdated = true;
    this.storedWeights = null;
    this.weightsRandomised = false;

    // Drop any examples whose dimensions no longer match
    if (this.dataset && this.dataset.features) {
      const keptF = [];
      const keptL = [];
      for (let i = 0; i < this.dataset.features.length; i++) {
        if (this.dataset.features[i].length === newInputs &&
            this.dataset.labels[i].length === newOutputs) {
          keptF.push(this.dataset.features[i]);
          keptL.push(this.dataset.labels[i]);
        }
      }
      this.dataset.features = keptF;
      this.dataset.labels = keptL;
    }

    // Terminate worker — it holds a stale WASM instance of the old shape.
    // Resolve any pending trainAsync promise so callers don't hang forever.
    if (this._worker) {
      if (this._pendingTrainResolve) {
        try { this._pendingTrainResolve({ cancelled: true, finalLoss: null, lossCurve: [] }); }
        catch (_) { /* ignore */ }
        this._pendingTrainResolve = null;
      }
      this._worker.terminate();
      this._worker = null;
    }
    this._training = false;

    this.log(`MLP rebuilt with layers=[${this.layerSizes.join(', ')}]`);
  }

  // ---- Cleanup ----
  destroy() {
    if (this._mlp) {
      this._w.free(this._inputPtr);
      this._w.free(this._outputPtr);
      this._w.destroy(this._mlp);
      this._mlp = null;
    }
    if (this._worker) {
      if (this._pendingTrainResolve) {
        try { this._pendingTrainResolve({ cancelled: true, finalLoss: null, lossCurve: [] }); }
        catch (_) { /* ignore */ }
        this._pendingTrainResolve = null;
      }
      this._worker.terminate();
      this._worker = null;
    }
    this._training = false;
  }
}
