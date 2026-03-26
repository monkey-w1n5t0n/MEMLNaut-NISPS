// WASM-backed IML — drop-in replacement for the JS IML class.
// Uses nisps-core compiled to WASM for inference, training, and weight ops.
// Training runs in a Web Worker for non-blocking operation.

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
    train: mod.cwrap('nisps_mlp_train', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']),
    drawWeightsSpread: mod.cwrap('nisps_mlp_draw_weights_spread', null, ['number', 'number']),
    moveWeightsSpread: mod.cwrap('nisps_mlp_move_weights_spread', null, ['number', 'number', 'number']),
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

    // Dataset (JS-side for persistence/visualization access)
    this.dataset = { features: [], labels: [], maxExamples: 100 };

    // Persistent WASM buffers for inference (avoid alloc/free per frame)
    const inputDim = nInputs + BIAS;
    this._inputPtr = this._w.alloc(inputDim);
    this._outputPtr = this._w.alloc(nOutputs);
    this._inputDim = inputDim;

    // Worker for async training
    this._worker = null;
    this._training = false;
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

  // ---- Dataset ----
  addExample(inputs, outputs) {
    const inVec = inputs.slice(0, this.nInputs);
    while (inVec.length < this.nInputs) inVec.push(0);
    const outVec = outputs.slice(0, this.nOutputs);
    while (outVec.length < this.nOutputs) outVec.push(0);

    if (this.dataset.features.length >= this.dataset.maxExamples) {
      this.dataset.features.shift();
      this.dataset.labels.shift();
    }
    this.dataset.features.push([...inVec]);
    this.dataset.labels.push([...outVec]);
  }

  clearDataset() {
    this.dataset.features = [];
    this.dataset.labels = [];
    this.log('Dataset cleared.');
  }

  get exampleCount() { return this.dataset.features.length; }

  // ---- Training (WASM, synchronous) ----
  train(options = {}) {
    if (this.weightsRandomised && this.storedWeights) {
      this._setFlatWeights(this.storedWeights);
      this.weightsRandomised = false;
    }

    const features = this.dataset.features;
    const labels = this.dataset.labels;
    if (features.length === 0) {
      this.log('Empty dataset, skipping training.');
      return null;
    }

    this.log('Training...');

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

    const loss = this._w.train(
      this._mlp, featPtr, nSamples, featureDim,
      labPtr, this.nOutputs,
      this.learningRate, this.maxIterations, this.convergenceThreshold
    );

    this._w.free(featPtr);
    this._w.free(labPtr);

    this.lastLoss = loss;
    // We don't have per-iteration history from WASM (single return value),
    // so record just the final loss
    this.lossHistory.push(loss);
    this.totalTrainingIterations += 1;
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
  // Since WASM moveWeights doesn't support pin masks, we save pinned nodes'
  // weights before the call and restore them after.
  moveWeights(speed, spread = 0, outputPinMask = null) {
    let savedSlices = null;

    if (outputPinMask && outputPinMask.some(v => v)) {
      // Compute the flat-array offset of the last layer's nodes.
      // Flat format: for each layer, for each node: [w0..wN, bias]
      const allWeights = this._getFlatWeights();
      const lastLayerInputSize = this.layerSizes[this.layerSizes.length - 2];
      const numOutputNodes = this.layerSizes[this.layerSizes.length - 1];
      const weightsPerOutputNode = lastLayerInputSize + 1; // weights + bias

      // Offset of the last layer in the flat array
      const lastLayerOffset = this._weightCount - (numOutputNodes * weightsPerOutputNode);

      // Save pinned nodes' weight slices
      savedSlices = [];
      for (let i = 0; i < numOutputNodes; i++) {
        if (outputPinMask[i]) {
          const start = lastLayerOffset + i * weightsPerOutputNode;
          const end = start + weightsPerOutputNode;
          savedSlices.push({ start, end, data: allWeights.slice(start, end) });
        }
      }
    }

    this._w.moveWeightsSpread(this._mlp, speed, spread);

    // Restore pinned nodes' weights
    if (savedSlices && savedSlices.length > 0) {
      const allWeights = this._getFlatWeights();
      for (const slice of savedSlices) {
        for (let j = 0; j < slice.data.length; j++) {
          allWeights[slice.start + j] = slice.data[j];
        }
      }
      this._setFlatWeights(allWeights);
    }

    this.inputUpdated = true;
    this.process();
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

    // Lazy-init worker
    if (!this._worker) {
      const workerUrl = new URL('./nisps-wasm-worker.js', import.meta.url);
      this._worker = new Worker(workerUrl, { type: 'module' });
    }

    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.type === 'trained') {
          this._worker.removeEventListener('message', handler);
          this._training = false;

          const { weights, loss } = e.data.payload;

          // Swap in trained weights
          this._setFlatWeights(weights);
          this.lastLoss = loss;
          this.lossHistory.push(loss);
          this.totalTrainingIterations += 1;
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
  destroy() {
    if (this._mlp) {
      this._w.free(this._inputPtr);
      this._w.free(this._outputPtr);
      this._w.destroy(this._mlp);
      this._mlp = null;
    }
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }
}
