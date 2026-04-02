// Web Worker for async WASM training (module worker)
// Loads its own nisps WASM instance for off-thread training

import NispsModule from '../../wasm/nisps.js';

let mod = null;
let w = null;
let mlp = null;
let currentLayerSizes = null;

async function ensureModule() {
  if (mod) return;
  mod = await NispsModule();
  w = {
    mod,
    create: mod.cwrap('nisps_mlp_create', 'number', ['number', 'number', 'number', 'number']),
    destroy: mod.cwrap('nisps_mlp_destroy', null, ['number']),
    weightCount: mod.cwrap('nisps_mlp_weight_count', 'number', ['number']),
    getWeights: mod.cwrap('nisps_mlp_get_weights', null, ['number', 'number']),
    setWeights: mod.cwrap('nisps_mlp_set_weights', null, ['number', 'number']),
    train: mod.cwrap('nisps_mlp_train', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']),
    alloc: mod.cwrap('nisps_alloc', 'number', ['number']),
    free: mod.cwrap('nisps_free', null, ['number']),
    allocInt: mod.cwrap('nisps_alloc_int', 'number', ['number']),
    freeInt: mod.cwrap('nisps_free_int', null, ['number']),
  };
}

function toHeapF32(arr) {
  const ptr = w.alloc(arr.length);
  w.mod.HEAPF32.set(arr, ptr >> 2);
  return ptr;
}

function toHeapI32(arr) {
  const ptr = w.allocInt(arr.length);
  w.mod.HEAP32.set(arr, ptr >> 2);
  return ptr;
}

function fromHeapF32(ptr, length) {
  const offset = ptr >> 2;
  return Array.from(w.mod.HEAPF32.subarray(offset, offset + length));
}

function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

self.onmessage = async function(e) {
  const { type, payload } = e.data;

  if (type === 'train') {
    await ensureModule();

    const {
      layerSizes, activationIds, weights,
      features, labels, sampleWeights,
      nInputs, nOutputs,
      learningRate, maxIterations, convergenceThreshold,
    } = payload;

    // Recreate MLP if architecture changed
    if (!mlp || !arraysEqual(currentLayerSizes, layerSizes)) {
      if (mlp) w.destroy(mlp);
      const layerPtr = toHeapI32(new Int32Array(layerSizes));
      const actPtr = toHeapI32(new Int32Array(activationIds));
      mlp = w.create(layerPtr, layerSizes.length, actPtr, activationIds.length);
      w.freeInt(layerPtr);
      w.freeInt(actPtr);
      currentLayerSizes = [...layerSizes];
    }

    // Load weights from main thread
    const weightCount = w.weightCount(mlp);
    const wPtr = toHeapF32(new Float32Array(weights));
    w.setWeights(mlp, wPtr);
    w.free(wPtr);

    // Build flat training arrays with bias
    const featureDim = nInputs + 1;
    const nSamples = features.length;
    const featFlat = new Float32Array(nSamples * featureDim);
    const labFlat = new Float32Array(nSamples * nOutputs);

    for (let i = 0; i < nSamples; i++) {
      for (let j = 0; j < nInputs; j++) {
        featFlat[i * featureDim + j] = features[i][j];
      }
      featFlat[i * featureDim + nInputs] = 1.0;
      for (let j = 0; j < nOutputs; j++) {
        labFlat[i * nOutputs + j] = labels[i][j] || 0;
      }
    }

    const featPtr = toHeapF32(featFlat);
    const labPtr = toHeapF32(labFlat);
    const weightPtr = sampleWeights ? toHeapF32(new Float32Array(sampleWeights)) : 0;

    // Train
    const loss = w.train(
      mlp, featPtr, nSamples, featureDim,
      labPtr, nOutputs,
      weightPtr,
      learningRate, maxIterations, convergenceThreshold
    );

    w.free(featPtr);
    w.free(labPtr);
    if (weightPtr) w.free(weightPtr);

    // Extract trained weights
    const outPtr = w.alloc(weightCount);
    w.getWeights(mlp, outPtr);
    const trainedWeights = fromHeapF32(outPtr, weightCount);
    w.free(outPtr);

    self.postMessage({
      type: 'trained',
      payload: { weights: trainedWeights, loss },
    });
  }
};
