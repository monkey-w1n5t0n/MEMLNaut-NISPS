/**
 * WasmIML — main-thread ML interface backed by `nisps.wasm`.
 *
 * Lifted from `playground/src/ml/wasm-iml.ts`. The ONLY changes from the
 * parity-tested original are framework-decoupling and base-awareness:
 *
 *   - The Solid coupling is gone. Where the playground called
 *     `mlStore.__setState(produce(...))` / `mlStore.__setOutputs(...)` /
 *     `mlStore.__setWeights(...)` / `coreBus.emit(...)`, this class calls the
 *     injected {@link EngineSink} (`sink.setState({...})` with a PLAIN patch
 *     object — no `produce` mutator, `sink.setOutputs/setWeights/emit`).
 *   - Glue + WASM URLs resolve via `import.meta.env.BASE_URL` (not `/nisps.*`).
 *   - The `nisps_ml_feedback_*` C ABI (already exported by the WASM build) is
 *     now bound and surfaced via the `feedback*` methods. The playground never
 *     wired these.
 *
 * Owns one `nisps.wasm` instance, one MLP handle, a JS-side `Dataset`,
 * pre-allocated heap buffers, and a lazy `WasmTrainer` worker.
 */

import { Dataset } from './dataset';
import { noopSink, type EngineSink } from './sink';
import {
  FEEDBACK_MODE_FROM_INT,
  FEEDBACK_MODE_TO_INT,
  type FeedbackMode,
  type LayerStats,
  type MLArchitecture,
  type NispsModule,
  type NispsModuleFactory,
} from './types';
import { createTrainer, type WasmTrainer } from './wasm-worker';

/** Default architecture matches `nisps/wasm/bindings.cpp` instantiation. */
const DEFAULT_INPUT_SIZE = 2;
const DEFAULT_OUTPUT_SIZE = 126;

/** Base-aware absolute URL for an asset served from `public/`. Resolves against
 *  `document.baseURI` (the page URL) so a `base: './'` build works under any
 *  mount path — `/`, `/next/`, etc. Resolving against `location.origin` would
 *  drop the sub-path and fetch from the site root (404 → text/html). */
function assetUrl(file: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return new URL(base + file, document.baseURI).toString();
}

let cachedFactory: NispsModuleFactory | null = null;

async function getFactory(): Promise<NispsModuleFactory> {
  if (cachedFactory) return cachedFactory;
  // `nisps.js` is Emscripten MODULARIZE glue WITHOUT ES6 exports — it assigns a
  // global `createNispsModule` (CommonJS/AMD fallbacks only). `import()` of it
  // yields an empty module namespace, so fetch the source and indirect-eval it
  // in global scope, which installs `globalThis.createNispsModule`.
  const g = globalThis as unknown as { createNispsModule?: NispsModuleFactory };
  if (!g.createNispsModule) {
    const src = await (await fetch(assetUrl('nisps.js'))).text();
    (0, eval)(src);
  }
  const factory = g.createNispsModule;
  if (!factory) throw new Error('[wasm-iml] nisps.js did not define createNispsModule');
  cachedFactory = factory;
  return factory;
}

/** Aligned float-array allocation helper. Returns ptr + a view. */
class HeapBuffer {
  readonly ptr: number;
  readonly view: Float32Array;
  constructor(private mod: NispsModule, public readonly count: number) {
    this.ptr = mod._malloc(count * 4);
    if (!this.ptr) throw new Error(`malloc(${count * 4}) failed`);
    this.view = new Float32Array(mod.HEAPF32.buffer, this.ptr, count);
  }
  rebind(): void {
    Object.defineProperty(this, 'view', {
      value: new Float32Array(this.mod.HEAPF32.buffer, this.ptr, this.count),
      writable: false,
    });
  }
  free(): void {
    this.mod._free(this.ptr);
  }
}

class HeapU8 {
  readonly ptr: number;
  readonly view: Uint8Array;
  constructor(private mod: NispsModule, public readonly count: number) {
    this.ptr = mod._malloc(count);
    if (!this.ptr) throw new Error(`malloc(${count}) failed`);
    this.view = new Uint8Array(mod.HEAPU8.buffer, this.ptr, count);
  }
  rebind(): void {
    Object.defineProperty(this, 'view', {
      value: new Uint8Array(this.mod.HEAPU8.buffer, this.ptr, this.count),
      writable: false,
    });
  }
  free(): void {
    this.mod._free(this.ptr);
  }
}

export interface WasmIMLOptions {
  inputSize?: number;
  outputSize?: number;
  hiddenLayers?: ReadonlyArray<number>;
  seed?: number;
  /** localStorage key the loaded weights/dataset will be persisted under. */
  storageKey?: string;
  maxExamples?: number;
  /** Injected side-effect boundary. Defaults to a no-op sink (headless use). */
  sink?: EngineSink;
}

export class WasmIML {
  private module!: NispsModule;
  private mlHandle = 0;
  private weightCount_ = 0;

  private arch_: MLArchitecture = {
    inputSize: DEFAULT_INPUT_SIZE,
    hidden: [10, 14, 18],
    outputSize: DEFAULT_OUTPUT_SIZE,
    numLayers: 4,
  };

  private featuresBuf!: HeapBuffer;
  private labelsBuf!: HeapBuffer;
  private weightsBuf!: HeapBuffer;
  private statsBuf!: HeapBuffer;
  private batchInBuf!: HeapBuffer;
  private batchOutBuf!: HeapBuffer;
  private pinMaskBuf!: HeapU8;
  private feedbackBuf!: HeapBuffer; // kDefaultOutputs scratch for feedback static/down
  private describePtr = 0;

  readonly dataset: Dataset;
  private readonly sink: EngineSink;
  private lastLoss_: number | null = null;
  private trainer: WasmTrainer | null = null;
  private storageKey: string;
  private saveTimer: number | null = null;
  private destroyed = false;

  static MAX_BATCH = 4096;

  private constructor(opts: WasmIMLOptions) {
    this.dataset = new Dataset(opts.maxExamples ?? 100);
    this.storageKey = opts.storageKey ?? 'nisps:wasm-iml';
    this.sink = opts.sink ?? noopSink;
  }

  static async create(opts: WasmIMLOptions = {}): Promise<WasmIML> {
    const inst = new WasmIML(opts);
    await inst.init_(opts);
    return inst;
  }

  private async init_(opts: WasmIMLOptions): Promise<void> {
    const factory = await getFactory();
    this.module = await factory({
      locateFile: (path: string) => (path.endsWith('.wasm') ? assetUrl('nisps.wasm') : path),
    });

    // Default shape (null handle). Since one-core-engine P2 the MLP is
    // runtime-shaped: create() honours requested dims; we pass the caller's
    // sizes (falling back to the defaults) and re-describe the instance.
    this.describePtr = this.module._malloc(6 * 4);
    this.module._nisps_ml_describe(0, this.describePtr);
    const defaults = new Int32Array(this.module.HEAP32.buffer, this.describePtr, 6);
    const wantedIn = opts.inputSize ?? defaults[0];
    const wantedOut = opts.outputSize ?? defaults[4];

    const seed = (opts.seed ?? (Date.now() >>> 0)) >>> 0;
    this.mlHandle = this.module._nisps_ml_create(wantedIn, wantedOut, 0, 0, seed);
    if (!this.mlHandle) throw new Error('[wasm-iml] nisps_ml_create returned null');

    this.module._nisps_ml_describe(this.mlHandle, this.describePtr);
    const dims = new Int32Array(this.module.HEAP32.buffer, this.describePtr, 6);
    this.arch_ = {
      inputSize: dims[0],
      hidden: [dims[1], dims[2], dims[3]],
      outputSize: dims[4],
      numLayers: dims[5],
    };

    this.weightCount_ = this.module._nisps_ml_weight_count(this.mlHandle);

    this.featuresBuf = new HeapBuffer(this.module, this.arch_.inputSize);
    this.labelsBuf = new HeapBuffer(this.module, this.arch_.outputSize);
    this.weightsBuf = new HeapBuffer(this.module, this.weightCount_);
    this.statsBuf = new HeapBuffer(this.module, this.arch_.numLayers * 4);
    this.batchInBuf = new HeapBuffer(this.module, WasmIML.MAX_BATCH * this.arch_.inputSize);
    this.batchOutBuf = new HeapBuffer(this.module, WasmIML.MAX_BATCH * this.arch_.outputSize);
    this.pinMaskBuf = new HeapU8(this.module, this.arch_.outputSize);
    this.feedbackBuf = new HeapBuffer(this.module, this.arch_.outputSize);

    this.sink.setState({
      inputSize: this.arch_.inputSize,
      outputSize: this.arch_.outputSize,
      exampleCount: 0,
      lastLoss: null,
      lossHistory: [],
      training: false,
      ready: true,
    });
    this.sink.setOutputs(new Float32Array(this.arch_.outputSize));
    this.publishWeights_();

    this.tryLoadFromStorage_();
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.trainer) {
      this.trainer.dispose();
      this.trainer = null;
    }
    if (this.module && this.mlHandle) {
      this.module._nisps_ml_destroy(this.mlHandle);
      this.mlHandle = 0;
    }
    if (this.featuresBuf) this.featuresBuf.free();
    if (this.labelsBuf) this.labelsBuf.free();
    if (this.weightsBuf) this.weightsBuf.free();
    if (this.statsBuf) this.statsBuf.free();
    if (this.batchInBuf) this.batchInBuf.free();
    if (this.batchOutBuf) this.batchOutBuf.free();
    if (this.pinMaskBuf) this.pinMaskBuf.free();
    if (this.feedbackBuf) this.feedbackBuf.free();
    if (this.describePtr) this.module._free(this.describePtr);
    this.sink.setState({ ready: false });
  }

  get architecture(): MLArchitecture {
    return this.arch_;
  }
  get weightCount(): number {
    return this.weightCount_;
  }
  get exampleCount(): number {
    return this.dataset.size;
  }
  get lastLoss(): number | null {
    return this.lastLoss_;
  }

  // -------------------------------------------------------------------
  // Inference
  // -------------------------------------------------------------------

  setInput(idx: number, value: number): void {
    this.module._nisps_ml_set_input(this.mlHandle, idx, value);
  }

  process(): Float32Array {
    this.module._nisps_ml_process(this.mlHandle);
    const ptr = this.module._nisps_ml_outputs(this.mlHandle);
    const view = new Float32Array(this.module.HEAPF32.buffer, ptr, this.arch_.outputSize);
    const out = new Float32Array(view); // copy
    this.sink.setOutputs(out);
    return out;
  }

  /**
   * Like {@link process} but writes into a caller-provided buffer instead of
   * allocating. Used by the reactive spine to avoid per-frame allocation.
   * Returns the number of values written. Does NOT call `sink.setOutputs`.
   */
  processInto(dst: Float32Array): number {
    this.module._nisps_ml_process(this.mlHandle);
    const ptr = this.module._nisps_ml_outputs(this.mlHandle);
    const n = Math.min(dst.length, this.arch_.outputSize);
    const view = new Float32Array(this.module.HEAPF32.buffer, ptr, this.arch_.outputSize);
    dst.set(view.subarray(0, n));
    return n;
  }

  /** Convenience: setInput(0,x); setInput(1,y); process(). */
  inferXY(x: number, y: number): Float32Array {
    this.setInput(0, x);
    this.setInput(1, y);
    return this.process();
  }

  inferBatch(points: ReadonlyArray<ReadonlyArray<number>>): Float32Array {
    const n = points.length;
    const inSz = this.arch_.inputSize;
    const outSz = this.arch_.outputSize;
    const result = new Float32Array(n * outSz);

    let written = 0;
    for (let offset = 0; offset < n; offset += WasmIML.MAX_BATCH) {
      const chunk = Math.min(WasmIML.MAX_BATCH, n - offset);
      for (let i = 0; i < chunk; ++i) {
        const src = points[offset + i];
        const base = i * inSz;
        for (let j = 0; j < inSz; ++j) this.batchInBuf.view[base + j] = src[j] ?? 0;
      }
      this.module._nisps_ml_infer_batch(
        this.mlHandle,
        this.batchInBuf.ptr,
        chunk,
        this.batchOutBuf.ptr,
      );
      const slice = this.batchOutBuf.view.subarray(0, chunk * outSz);
      result.set(slice, written);
      written += chunk * outSz;
    }
    return result;
  }

  // -------------------------------------------------------------------
  // Training
  // -------------------------------------------------------------------

  addExample(features: ReadonlyArray<number>, labels: ReadonlyArray<number>): boolean {
    const ok = this.dataset.add(features, labels);
    if (!ok) return false;
    this.copyExampleToWasm_(features, labels);
    this.sink.setState({ exampleCount: this.dataset.size });
    this.sink.emit('ml.example_added', { count: this.dataset.size });
    this.scheduleSave_();
    return true;
  }

  private copyExampleToWasm_(features: ReadonlyArray<number>, labels: ReadonlyArray<number>): void {
    const fv = this.featuresBuf.view;
    const lv = this.labelsBuf.view;
    const inSz = this.arch_.inputSize;
    const outSz = this.arch_.outputSize;
    for (let i = 0; i < inSz; ++i) fv[i] = features[i] ?? 0;
    for (let i = 0; i < outSz; ++i) lv[i] = labels[i] ?? 0;
    this.module._nisps_ml_add_example(this.mlHandle, this.featuresBuf.ptr, this.labelsBuf.ptr);
  }

  train(lr = 1.0, maxIter = 1000, minErr = 0.001, sampleWeights?: Float32Array): number {
    if (this.dataset.isEmpty()) {
      this.lastLoss_ = 0;
      this.sink.setState({ lastLoss: 0 });
      return 0;
    }

    let weightsPtr = 0;
    let weightsHandle: HeapBuffer | null = null;
    if (sampleWeights && sampleWeights.length === this.dataset.size) {
      weightsHandle = new HeapBuffer(this.module, sampleWeights.length);
      weightsHandle.view.set(sampleWeights);
      weightsPtr = weightsHandle.ptr;
    }

    this.sink.setState({ training: true });
    let loss = 0;
    try {
      loss = this.module._nisps_ml_train(this.mlHandle, lr, maxIter, minErr, weightsPtr);
    } finally {
      if (weightsHandle) weightsHandle.free();
      this.sink.setState({ training: false });
    }

    this.lastLoss_ = loss;
    // The C++ MLP stores per-iter history but it isn't exposed via the WASM
    // bindings yet, so this is a single-element array.
    this.sink.setState({ lastLoss: loss, lossHistory: [loss] });
    this.publishWeights_();
    this.sink.emit('ml.trained', { loss });
    this.scheduleSave_();
    return loss;
  }

  async trainAsync(lr = 1.0, maxIter = 1000, minErr = 0.001, sampleWeights?: Float32Array): Promise<number> {
    if (this.dataset.isEmpty()) {
      this.lastLoss_ = 0;
      return 0;
    }
    if (!this.trainer) this.trainer = await createTrainer();

    const weights = this.getWeights();
    const features = new Float32Array(this.dataset.featuresFlat());
    const labels = new Float32Array(this.dataset.labelsFlat());
    const sw = sampleWeights ? new Float32Array(sampleWeights) : new Float32Array(0);

    this.sink.setState({ training: true });
    try {
      const result = await this.trainer.train({
        weights,
        features,
        labels,
        sampleWeights: sw,
        lr,
        maxIter,
        minErr,
        inputSize: this.arch_.inputSize,
        outputSize: this.arch_.outputSize,
      });
      this.setWeights(result.weights);
      this.lastLoss_ = result.loss;
      this.sink.setState({ lastLoss: result.loss, lossHistory: Array.from(result.lossHistory) });
      this.sink.emit('ml.trained', { loss: result.loss });
      this.scheduleSave_();
      return result.loss;
    } finally {
      this.sink.setState({ training: false });
    }
  }

  evalLoss(): number {
    return this.module._nisps_ml_eval_loss(this.mlHandle);
  }

  clearExamples(): void {
    this.dataset.clear();
    this.module._nisps_ml_clear_examples(this.mlHandle);
    this.sink.setState({ exampleCount: 0 });
    this.sink.emit('ml.examples_cleared', undefined);
    this.scheduleSave_();
  }

  // -------------------------------------------------------------------
  // RL ops
  // -------------------------------------------------------------------

  randomiseWeights(spread = 0.6): void {
    this.module._nisps_ml_draw_weights(this.mlHandle, spread);
    this.publishWeights_();
    this.sink.emit('ml.delta_update', { reason: 'randomise' });
    this.scheduleSave_();
  }

  moveWeights(speed: number, spread: number, pinMask?: Uint8Array): void {
    const maskPtr = this.writePinMask_(pinMask);
    this.module._nisps_ml_move_weights(this.mlHandle, speed, spread, maskPtr);
    this.publishWeights_();
    this.sink.emit('ml.delta_update', { reason: 'thumbs_down' });
  }

  private writePinMask_(pinMask?: Uint8Array): number {
    if (!pinMask) return 0;
    const sz = Math.min(pinMask.length, this.arch_.outputSize);
    for (let i = 0; i < sz; ++i) this.pinMaskBuf.view[i] = pinMask[i];
    for (let i = sz; i < this.arch_.outputSize; ++i) this.pinMaskBuf.view[i] = 0;
    return this.pinMaskBuf.ptr;
  }

  // -------------------------------------------------------------------
  // Feedback "Down Action" state machine (nisps_ml_feedback_* C ABI)
  // -------------------------------------------------------------------

  /** Set the feedback dislike mode (Avoid / RandomiseOutputs / RandomiseMlp). */
  feedbackSetMode(mode: FeedbackMode): void {
    this.module._nisps_ml_feedback_set_mode(this.mlHandle, FEEDBACK_MODE_TO_INT[mode]);
    this.sink.emit('feedback.mode', { mode });
  }

  feedbackGetMode(): FeedbackMode {
    const i = this.module._nisps_ml_feedback_get_mode(this.mlHandle);
    return FEEDBACK_MODE_FROM_INT[i] ?? 'avoid';
  }

  /** True while the controller is in an exploratory (perturbed) state. */
  feedbackExploring(): boolean {
    return this.module._nisps_ml_feedback_exploring(this.mlHandle) === 1;
  }

  feedbackLearningPaused(): boolean {
    return this.module._nisps_ml_feedback_learning_paused(this.mlHandle) === 1;
  }

  /** Restrict feedback to a subset of outputs (solo / focus). null clears it. */
  feedbackSetFocus(mask: Uint8Array | null): void {
    if (!mask || mask.length === 0) {
      this.module._nisps_ml_feedback_set_focus(this.mlHandle, 0, 0);
      return;
    }
    const n = Math.min(mask.length, this.arch_.outputSize);
    for (let i = 0; i < n; ++i) this.pinMaskBuf.view[i] = mask[i];
    this.module._nisps_ml_feedback_set_focus(this.mlHandle, this.pinMaskBuf.ptr, n);
  }

  /** Positive feedback (thumbs-up). Returns the FeedbackAction int. */
  feedbackUp(): number {
    const action = this.module._nisps_ml_feedback_up(this.mlHandle);
    this.publishWeights_();
    this.sink.emit('feedback.up', { action });
    this.scheduleSave_();
    return action;
  }

  /**
   * Negative feedback (thumbs-down). `currentOut` is the kDefaultOutputs vector
   * the user is hearing (optional). Returns the FeedbackAction int.
   */
  feedbackDown(speed: number, spread: number, currentOut?: Float32Array, pinMask?: Uint8Array): number {
    let outPtr = 0;
    if (currentOut) {
      const n = Math.min(currentOut.length, this.arch_.outputSize);
      this.feedbackBuf.view.fill(0);
      this.feedbackBuf.view.set(currentOut.subarray(0, n));
      outPtr = this.feedbackBuf.ptr;
    }
    const maskPtr = this.writePinMask_(pinMask);
    const action = this.module._nisps_ml_feedback_down(this.mlHandle, outPtr, speed, spread, maskPtr);
    this.publishWeights_();
    this.sink.emit('feedback.down', { action });
    this.scheduleSave_();
    return action;
  }

  /** Drag (continuous perturbation) tick. Returns the FeedbackAction int. */
  feedbackDrag(): number {
    const action = this.module._nisps_ml_feedback_drag(this.mlHandle);
    this.publishWeights_();
    return action;
  }

  /**
   * If a static bypass vector is active, copies it into `out` and returns true
   * (the caller should NOT call process()); otherwise returns false.
   */
  feedbackStaticOutput(out: Float32Array): boolean {
    const bypass = this.module._nisps_ml_feedback_static_output(this.mlHandle, this.feedbackBuf.ptr);
    if (bypass === 1) {
      const n = Math.min(out.length, this.arch_.outputSize);
      out.set(this.feedbackBuf.view.subarray(0, n));
      return true;
    }
    return false;
  }

  // ---- ExploreAndPlace lifecycle (shared C++ core; mode 'explore_and_place') --
  // The C++ core owns the weight snapshot / scratchpad / undo ring; THIS class
  // only forwards calls + republishes weights. Example-storage + training stay
  // with the caller (FeedbackController.ts), preserving the "caller owns
  // training" contract.

  /** Idle→Exploring: snapshot the real net, randomise a scratchpad. */
  feedbackEnterExplore(spread: number): void {
    this.module._nisps_ml_feedback_enter_explore(this.mlHandle, spread);
    this.publishWeights_();
  }

  /** Exploring→Idle: restore the real net, discard the scratchpad. */
  feedbackExitExplore(): void {
    this.module._nisps_ml_feedback_exit_explore(this.mlHandle);
    this.publishWeights_();
  }

  /** Exploring scratchpad op: re-randomise (undoable). */
  feedbackReroll(spread: number): void {
    this.module._nisps_ml_feedback_reroll(this.mlHandle, spread);
    this.publishWeights_();
  }

  /** Exploring scratchpad op: small bounded perturbation (undoable). */
  feedbackNudge(amount: number): void {
    this.module._nisps_ml_feedback_nudge(this.mlHandle, amount);
    this.publishWeights_();
  }

  /** Exploring scratchpad op: undo the last reroll/nudge. */
  feedbackUndo(): void {
    this.module._nisps_ml_feedback_undo(this.mlHandle);
    this.publishWeights_();
  }

  /** Exploring→Placing: freeze the scratchpad output at its current input. */
  feedbackLike(): void {
    this.module._nisps_ml_feedback_like(this.mlHandle);
  }

  /** Placing→Idle: restore the real net. Caller then stores +1 + trains. */
  feedbackCommitPlace(): void {
    this.module._nisps_ml_feedback_commit_place(this.mlHandle);
    this.publishWeights_();
  }

  /** Placing→Exploring: back out without storing. */
  feedbackCancelPlace(): void {
    this.module._nisps_ml_feedback_cancel_place(this.mlHandle);
  }

  feedbackPlacing(): boolean {
    return this.module._nisps_ml_feedback_placing(this.mlHandle) === 1;
  }

  /** ExploreState: 0=Idle 1=Exploring 2=Placing. */
  feedbackState(): number {
    return this.module._nisps_ml_feedback_state(this.mlHandle);
  }

  feedbackUndoDepth(): number {
    return this.module._nisps_ml_feedback_undo_depth(this.mlHandle);
  }

  /**
   * The frozen placed output (while Placing) or the just-committed output
   * (after commit_place, until the next explore). Returns null if neither is
   * available. The caller adds this as the +1 example label at the chosen
   * input after commit.
   */
  feedbackPlacedOutput(): Float32Array | null {
    const ok = this.module._nisps_ml_feedback_placed_output(this.mlHandle, this.feedbackBuf.ptr);
    if (ok !== 1) return null;
    return new Float32Array(this.feedbackBuf.view.subarray(0, this.arch_.outputSize));
  }

  // -------------------------------------------------------------------
  // Weights I/O
  // -------------------------------------------------------------------

  getWeights(): Float32Array {
    this.module._nisps_ml_get_weights(this.mlHandle, this.weightsBuf.ptr);
    return new Float32Array(this.weightsBuf.view);
  }

  setWeights(w: Float32Array | Uint8Array): void {
    if (w.length < this.weightCount_) {
      throw new Error(`setWeights: expected ${this.weightCount_} floats, got ${w.length}`);
    }
    this.weightsBuf.view.set(w as Float32Array, 0);
    this.module._nisps_ml_set_weights(this.mlHandle, this.weightsBuf.ptr);
    this.publishWeights_();
  }

  getLayerStats(): LayerStats[] {
    this.module._nisps_ml_get_layer_stats(this.mlHandle, this.statsBuf.ptr);
    const out: LayerStats[] = [];
    for (let i = 0; i < this.arch_.numLayers; ++i) {
      const base = i * 4;
      out.push({
        meanAbs: this.statsBuf.view[base],
        maxAbs: this.statsBuf.view[base + 1],
        deadFrac: this.statsBuf.view[base + 2],
        saturatingFrac: this.statsBuf.view[base + 3],
      });
    }
    return out;
  }

  getLayerStatsFlat(): Float32Array {
    this.module._nisps_ml_get_layer_stats(this.mlHandle, this.statsBuf.ptr);
    return new Float32Array(this.statsBuf.view);
  }

  // -------------------------------------------------------------------
  // Misc
  // -------------------------------------------------------------------

  reset(): void {
    this.module._nisps_ml_reset(this.mlHandle);
    this.dataset.clear();
    this.lastLoss_ = null;
    this.sink.setState({ exampleCount: 0, lastLoss: null, lossHistory: [] });
    this.publishWeights_();
    this.sink.emit('ml.examples_cleared', undefined);
    this.scheduleSave_();
  }

  // -------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------

  private scheduleSave_(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 500);
  }

  saveNow(): void {
    if (this.destroyed) return;
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      const weights = this.getWeights();
      const payload = {
        v: 1,
        arch: this.arch_,
        weights: Array.from(weights),
        features: Array.from(this.dataset.featuresFlat()),
        labels: Array.from(this.dataset.labelsFlat()),
        size: this.dataset.size,
        lastLoss: this.lastLoss_,
      };
      localStorage.setItem(this.storageKey, JSON.stringify(payload));
    } catch (err) {
      console.warn('[wasm-iml] saveNow failed:', err);
    }
  }

  private tryLoadFromStorage_(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const payload = JSON.parse(raw) as {
        v: number;
        weights: number[];
        features: number[];
        labels: number[];
        size: number;
        lastLoss: number | null;
      };
      if (payload.v !== 1) return;
      const inSz = this.arch_.inputSize;
      const outSz = this.arch_.outputSize;
      if (payload.size > 0 && payload.features.length === payload.size * inSz &&
          payload.labels.length === payload.size * outSz) {
        for (let i = 0; i < payload.size; ++i) {
          const f = payload.features.slice(i * inSz, (i + 1) * inSz);
          const l = payload.labels.slice(i * outSz, (i + 1) * outSz);
          this.dataset.add(f, l);
          this.copyExampleToWasm_(f, l);
        }
      }
      if (payload.weights.length === this.weightCount_) {
        this.setWeights(new Float32Array(payload.weights));
      }
      this.lastLoss_ = payload.lastLoss;
      this.sink.setState({ exampleCount: this.dataset.size, lastLoss: this.lastLoss_ });
    } catch (err) {
      console.warn('[wasm-iml] tryLoadFromStorage failed:', err);
    }
  }

  private publishWeights_(): void {
    const w = this.getWeights();
    this.sink.setWeights(w);
  }
}
