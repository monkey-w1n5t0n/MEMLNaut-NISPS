/**
 * Type definitions for the Emscripten-generated nisps WASM module.
 */

export interface NispsModule {
  cwrap(
    ident: string,
    returnType: string | null,
    argTypes: string[],
    opts?: unknown
  ): (...args: unknown[]) => unknown;
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  _nisps_mlp_create: (layerPtr: number, nLayers: number, actPtr: number, nActs: number) => number;
  _nisps_mlp_destroy: (ptr: number) => void;
  _nisps_mlp_weight_count: (ptr: number) => number;
  _nisps_mlp_get_weights: (mlp: number, ptr: number) => void;
  _nisps_mlp_set_weights: (mlp: number, ptr: number) => void;
  _nisps_mlp_inference: (mlp: number, inPtr: number, inDim: number, outPtr: number, outDim: number) => void;
  _nisps_mlp_train: (
    mlp: number, featPtr: number, nSamples: number, featDim: number,
    labPtr: number, outDim: number, weightPtr: number,
    lr: number, maxIter: number, convThresh: number
  ) => number;
  _nisps_mlp_train_ex: (
    mlp: number, featPtr: number, nSamples: number, featDim: number,
    labPtr: number, outDim: number, weightPtr: number,
    lr: number, maxIter: number, convThresh: number, lossHistPtr: number
  ) => number;
  _nisps_mlp_draw_weights_spread: (mlp: number, spread: number) => void;
  _nisps_mlp_move_weights_spread: (mlp: number, speed: number, spread: number) => void;
  _nisps_mlp_move_weights_ex: (mlp: number, speed: number, spread: number, pinMaskPtr: number, nOut: number) => void;
  _nisps_mlp_infer_batch: (mlp: number, inPtr: number, nPoints: number, inDim: number, outPtr: number, outDim: number) => void;
  _nisps_mlp_eval_loss: (
    mlp: number, featPtr: number, nSamples: number, featDim: number,
    labPtr: number, outDim: number, weightPtr: number
  ) => number;
  _nisps_mlp_get_layer_stats: (mlp: number, statsPtr: number, nLayers: number) => void;
  _nisps_alloc: (size: number) => number;
  _nisps_free: (ptr: number) => void;
  _nisps_alloc_int: (size: number) => number;
  _nisps_free_int: (ptr: number) => void;
}

export interface WrappedModule {
  mod: NispsModule;
  create: (layerPtr: number, nLayers: number, actPtr: number, nActs: number) => number;
  destroy: (ptr: number) => void;
  weightCount: (ptr: number) => number;
  getWeights: (mlp: number, ptr: number) => void;
  setWeights: (mlp: number, ptr: number) => void;
  inference: (mlp: number, inPtr: number, inDim: number, outPtr: number, outDim: number) => void;
  train: (
    mlp: number, featPtr: number, nSamples: number, featDim: number,
    labPtr: number, outDim: number, weightPtr: number,
    lr: number, maxIter: number, convThresh: number
  ) => number;
  trainEx: (
    mlp: number, featPtr: number, nSamples: number, featDim: number,
    labPtr: number, outDim: number, weightPtr: number,
    lr: number, maxIter: number, convThresh: number, lossHistPtr: number
  ) => number;
  drawWeightsSpread: (mlp: number, spread: number) => void;
  moveWeightsSpread: (mlp: number, speed: number, spread: number) => void;
  moveWeightsEx: (mlp: number, speed: number, spread: number, pinMaskPtr: number, nOut: number) => void;
  inferBatch: (mlp: number, inPtr: number, nPoints: number, inDim: number, outPtr: number, outDim: number) => void;
  evalLoss: (
    mlp: number, featPtr: number, nSamples: number, featDim: number,
    labPtr: number, outDim: number, weightPtr: number
  ) => number;
  getLayerStats: (mlp: number, statsPtr: number, nLayers: number) => void;
  alloc: (size: number) => number;
  free: (ptr: number) => void;
  allocInt: (size: number) => number;
  freeInt: (ptr: number) => void;
}

export interface LayerStats {
  meanAbs: number;
  maxAbs: number;
  deadFrac: number;
  satFrac: number;
}

export interface WeightSnapshot {
  layerSizes: number[];
  weights: number[];
}
