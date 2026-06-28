/**
 * TypeScript types matching the C API surface in `nisps/wasm/bindings.cpp`.
 *
 * Lifted from `playground/src/ml/types.ts` and EXTENDED with the
 * `nisps_ml_feedback_*` exports (already present in the WASM build per
 * `scripts/build-wasm.sh` EXPORTED_FUNCTIONS, but not previously bound in the
 * playground's `NispsModule` interface). These power the `feedback.*` surface
 * of `EngineApi`.
 */

/**
 * Shape of the loaded WASM module — the subset we use. Emscripten generates
 * more; we type only what we need. `_*` methods are the raw exported C
 * functions (numbers in, numbers out — pointers + primitives).
 */
export interface NispsModule {
  // Memory views (re-bound after grow).
  HEAP8: Int8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;

  _malloc(bytes: number): number;
  _free(ptr: number): void;

  // ML lifecycle. Seed is uint32_t (not 64-bit) — see bindings.cpp file comment.
  _nisps_ml_create(input_size: number, output_size: number, hidden_ptr: number, n_hidden: number, seed: number): number;
  _nisps_ml_destroy(ml: number): void;
  _nisps_ml_reset(ml: number): void;

  // ML inference.
  _nisps_ml_set_input(ml: number, idx: number, v: number): void;
  _nisps_ml_process(ml: number): void;
  _nisps_ml_outputs(ml: number): number; // returns float* into HEAPF32
  _nisps_ml_infer_batch(ml: number, points_ptr: number, n_points: number, out_ptr: number): void;

  // ML training.
  _nisps_ml_add_example(ml: number, features_ptr: number, labels_ptr: number): void;
  _nisps_ml_train(ml: number, lr: number, max_iter: number, min_err: number, sample_weights_ptr: number): number;
  _nisps_ml_eval_loss(ml: number): number;

  // ML examples.
  _nisps_ml_clear_examples(ml: number): void;
  _nisps_ml_example_count(ml: number): number;

  // ML weights.
  _nisps_ml_weight_count(ml: number): number;
  _nisps_ml_get_weights(ml: number, out_ptr: number): void;
  _nisps_ml_set_weights(ml: number, in_ptr: number): void;
  _nisps_ml_draw_weights(ml: number, spread: number): void;
  _nisps_ml_move_weights(ml: number, speed: number, spread: number, mask_ptr: number): void;
  _nisps_ml_get_layer_stats(ml: number, out_ptr: number): void;
  _nisps_ml_describe(out_ptr: number): void;

  // ML feedback — the "Down Action" state machine (Avoid / RandomiseOutputs /
  // RandomiseMlp). Mode ints: 0=Avoid 1=RandomiseOutputs 2=RandomiseMlp.
  // Action return ints come from FeedbackController::on_*; see feedback.hpp.
  _nisps_ml_feedback_set_mode(ml: number, mode: number): void;
  _nisps_ml_feedback_get_mode(ml: number): number;
  _nisps_ml_feedback_exploring(ml: number): number; // 1 = exploring
  _nisps_ml_feedback_learning_paused(ml: number): number; // 1 = paused
  _nisps_ml_feedback_set_focus(ml: number, mask_ptr: number, n: number): void;
  _nisps_ml_feedback_down(
    ml: number,
    current_out_ptr: number,
    speed: number,
    spread: number,
    pin_mask_ptr: number,
  ): number;
  _nisps_ml_feedback_up(ml: number): number;
  _nisps_ml_feedback_drag(ml: number): number;
  // Returns 1 if `out` holds a static-bypass vector (skip process()); else 0.
  _nisps_ml_feedback_static_output(ml: number, out_ptr: number): number;

  // Engines.
  _nisps_engine_create(id_ptr: number, sample_rate: number): number;
  _nisps_engine_destroy(engine: number): void;
  _nisps_engine_set_params(engine: number, params_ptr: number, n_params: number): void;
  _nisps_engine_process_block(
    engine: number,
    in_l_ptr: number, in_r_ptr: number,
    out_l_ptr: number, out_r_ptr: number,
    n_samples: number,
  ): void;
}

/** Factory function exposed by the Emscripten glue. */
export type NispsModuleFactory = (opts?: {
  locateFile?: (path: string, prefix: string) => string;
  wasmBinary?: ArrayBuffer | Uint8Array;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
}) => Promise<NispsModule>;

/** Architecture descriptor returned from `nisps_ml_describe`. */
export interface MLArchitecture {
  inputSize: number;
  hidden: [number, number, number];
  outputSize: number;
  numLayers: number;
}

/** Per-layer weight health record (one per layer). */
export interface LayerStats {
  meanAbs: number;
  maxAbs: number;
  deadFrac: number;
  saturatingFrac: number;
}

/** The `engine_id` strings the C++ side recognises. Anything else → "thru". */
export type EngineId =
  | 'thru'
  | 'paf_synth'
  | 'channel_strip'
  | 'xiasri'
  | 'verb_fx'
  | 'memlcelium'
  | 'breakor'
  | 'elysiamorf'
  | 'analysis';

/** Feedback "Down Action" mode. Mirrors `nisps::ml::FeedbackMode`. */
export type FeedbackMode = 'avoid' | 'randomise_outputs' | 'randomise_mlp';

export const FEEDBACK_MODE_TO_INT: Record<FeedbackMode, number> = {
  avoid: 0,
  randomise_outputs: 1,
  randomise_mlp: 2,
};

export const FEEDBACK_MODE_FROM_INT: ReadonlyArray<FeedbackMode> = [
  'avoid',
  'randomise_outputs',
  'randomise_mlp',
];

/** Message protocol between main thread and `wasm-worker.ts`. */
export type WorkerRequest =
  | {
      kind: 'init';
      seed: number;
      // Absolute deploy base (e.g. "https://host/next/") computed on the main
      // thread from document.baseURI — the worker has no document to resolve
      // `./nisps.js` against, and resolving against its own bundle URL points at
      // /assets/, not the public root.
      assetBase: string;
    }
  | {
      kind: 'train';
      requestId: number;
      // Flat features: nExamples * inputSize floats.
      features: Float32Array;
      // Flat labels: nExamples * outputSize floats.
      labels: Float32Array;
      // Optional per-example weights, sums to 1. Empty = uniform.
      sampleWeights: Float32Array;
      // Current weights to seed worker MLP.
      weights: Float32Array;
      lr: number;
      maxIter: number;
      minErr: number;
      inputSize: number;
      outputSize: number;
    }
  | {
      kind: 'dispose';
    };

export type WorkerResponse =
  | {
      kind: 'ready';
    }
  | {
      kind: 'result';
      requestId: number;
      loss: number;
      weights: Float32Array;
      // Loss curve (per-iteration). Currently always single-element — the C++
      // MLP exposes loss_history but the WASM bridge does not yet plumb it.
      lossHistory: Float32Array;
    }
  | {
      kind: 'error';
      requestId: number;
      message: string;
    };
