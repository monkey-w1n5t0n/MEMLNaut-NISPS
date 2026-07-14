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
  // Since one-core-engine P2 the dims are HONOURED (runtime-shaped MLP);
  // non-positive/null args fall back to the compiled defaults (32→[10,14,18]→126).
  _nisps_ml_create(input_size: number, output_size: number, hidden_ptr: number, n_hidden: number, seed: number): number;
  _nisps_ml_destroy(ml: number): void;
  _nisps_ml_reset(ml: number): void;
  // Reshape = new net at the new dims, warm-started with the overlapping
  // weights; feedback state resets. Returns 1 on success (0 = no change).
  _nisps_ml_reshape(ml: number, input_size: number, output_size: number, hidden_ptr: number, n_hidden: number, spread: number): number;

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
  // Null ml reports the DEFAULT shape; a handle reports its runtime shape.
  _nisps_ml_describe(ml: number, out_ptr: number): void;

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

  // ExploreAndPlace lifecycle (mode 3). Idle → Exploring → Placing → Idle.
  // The shared C++ core owns the weight snapshot/scratchpad/undo; the CALLER
  // owns example-storage + training (read placed_output post-commit, addExample
  // at the chosen input, then train). See nisps/ml/feedback.hpp.
  _nisps_ml_feedback_enter_explore(ml: number, spread: number): void;
  _nisps_ml_feedback_exit_explore(ml: number): void;
  _nisps_ml_feedback_reroll(ml: number, spread: number): void;
  _nisps_ml_feedback_nudge(ml: number, amount: number): void;
  _nisps_ml_feedback_undo(ml: number): void;
  _nisps_ml_feedback_like(ml: number): void; // Exploring→Placing (freeze output)
  _nisps_ml_feedback_commit_place(ml: number): void; // Placing→Idle (restore real net)
  _nisps_ml_feedback_cancel_place(ml: number): void; // Placing→Exploring
  _nisps_ml_feedback_placing(ml: number): number; // 1 = Placing
  _nisps_ml_feedback_state(ml: number): number; // 0=Idle 1=Exploring 2=Placing
  _nisps_ml_feedback_undo_depth(ml: number): number;
  // Writes placed/committed output (outputSize floats) into out; returns 1 if written.
  _nisps_ml_feedback_placed_output(ml: number, out_ptr: number): number;

  // Geometric dislike (one-core-engine P3; rl-feedback-design §2.1). The Avoid
  // mode's default realisation, ported from firmware InterfaceRL. current_out
  // may be null (0) → the MLP's live output is used (zero-derivative caveat:
  // pass the HEARD post-pipeline vector for an audible push). lr <= 0 → the
  // controller default (1e-3). Returns the FeedbackAction int (14=GeometricPush,
  // 15=GeometricColdStart when no positives exist yet).
  _nisps_ml_feedback_dislike_geometric(ml: number, current_out_ptr: number, lr: number): number;
  // Store a positive (like) into the replay memory so the k-NN centroid sees it.
  // current_out may be null (live output used). Caller still runs addExample+train.
  _nisps_ml_feedback_store_positive(ml: number, current_out_ptr: number): void;
  _nisps_ml_feedback_positive_count(ml: number): number;
  _nisps_ml_feedback_negative_count(ml: number): number;
  // Avoid sub-mode: 0 = Geometric (default), 1 = Diffuse (legacy move_weights, A/B).
  _nisps_ml_feedback_set_avoid_style(ml: number, style: number): void;

  // Jolt (held weight morph) + OU exploration noise (one-core-engine P3.2) — the
  // SAME nisps/ml/{jolt,ou_noise}.hpp the firmware ModeBase runs. jolt_step does
  // the get→glide→set of weights C-side; explore_apply advances the OU walk and
  // adds it (clamped [0,1]) to the first min(n, n_out) floats in place.
  _nisps_ml_jolt_press(ml: number): void;
  _nisps_ml_jolt_step(ml: number): void;
  _nisps_ml_jolt_release(ml: number): void;
  _nisps_ml_jolt_active(ml: number): number; // 1 = held/active
  _nisps_ml_jolt_lr_scale(ml: number): number; // post-release LR ramp multiplier
  _nisps_ml_jolt_tick_lr_ramp(ml: number): void;
  _nisps_ml_explore_intensity(ml: number, level: number): void;
  _nisps_ml_explore_get_intensity(ml: number): number;
  _nisps_ml_explore_apply(ml: number, inout_ptr: number, n: number): void;

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
export type FeedbackMode = 'avoid' | 'randomise_outputs' | 'randomise_mlp' | 'explore_and_place';

export const FEEDBACK_MODE_TO_INT: Record<FeedbackMode, number> = {
  avoid: 0,
  randomise_outputs: 1,
  randomise_mlp: 2,
  explore_and_place: 3,
};

export const FEEDBACK_MODE_FROM_INT: ReadonlyArray<FeedbackMode> = [
  'avoid',
  'randomise_outputs',
  'randomise_mlp',
  'explore_and_place',
];

/** ExploreAndPlace lifecycle state. Mirrors `nisps::ml::ExploreState`. */
export type ExploreState = 'idle' | 'exploring' | 'placing';

export const EXPLORE_STATE_FROM_INT: ReadonlyArray<ExploreState> = [
  'idle',
  'exploring',
  'placing',
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
      // The main net's hidden layers. The worker (re)creates its mirror net to
      // this shape so weight vectors exchange 1:1 after a reshape (P2.3).
      hidden: readonly [number, number, number];
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
