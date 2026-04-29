/**
 * WasmIML — main-thread ML interface backed by `nisps.wasm`.
 *
 * Owns:
 *   - One `nisps.wasm` instance.
 *   - One MLP handle.
 *   - A JS-side `Dataset` (mirrors the C++ ring buffer; see dataset.ts).
 *   - Pre-allocated heap buffers for inputs/outputs/weights/etc.
 *   - A lazy `WasmTrainer` worker for off-thread async training.
 *
 * Threading model (architecture.md §6.4):
 *   - Inference + sync training run on this main-thread instance.
 *   - `trainAsync()` spawns/uses a worker which holds a SECOND wasm
 *     instance; weights round-trip through `getWeights()`/`setWeights()`.
 *
 * Side effects: every mutation that should be visible to the UI calls into
 * `mlStore`. The store is the single source of truth for Solid components.
 *
 * Concept compatibility: this class re-implements the legacy WasmIML
 * surface area documented in `recon/04-playground.md §6` so the existing
 * Playwright debug-probe tests can keep passing once the new probe is
 * wired up.
 */

import { produce } from 'solid-js/store';

import { mlStore } from '../stores/ml-store';
import { coreBus } from '../stores/bus';
import { Dataset } from './dataset';
import type {
  LayerStats,
  MLArchitecture,
  NispsModule,
  NispsModuleFactory,
} from './types';
import { createTrainer, type WasmTrainer } from './wasm-worker';

const NISPS_JS_URL = '/nisps.js';
const NISPS_WASM_URL = '/nisps.wasm';

/** Default architecture matches `nisps/wasm/bindings.cpp` instantiation. */
const DEFAULT_INPUT_SIZE = 2;
const DEFAULT_OUTPUT_SIZE = 126;

let cachedFactory: NispsModuleFactory | null = null;

/**
 * Load the Emscripten glue once, cache the factory.
 *
 * The glue is served from `playground/public/nisps.js` (committed). We
 * dynamically import it so the WASM only loads when the ML system is first
 * used — `/dev/primitives` doesn't pay for it.
 */
async function getFactory(): Promise<NispsModuleFactory> {
  if (cachedFactory) return cachedFactory;
  // Vite serves `/nisps.js` as a normal asset; we use a dynamic-eval import
  // to avoid Vite trying to resolve it at build time.
  const url = new URL(NISPS_JS_URL, window.location.origin).toString();
  const mod = await import(/* @vite-ignore */ url);
  // Emscripten MODULARIZE=1 default export key is `default`.
  // tslint:disable-next-line:no-any
  const factory = (mod as { default?: NispsModuleFactory; createNispsModule?: NispsModuleFactory })
    .default ?? (mod as { createNispsModule?: NispsModuleFactory }).createNispsModule;
  if (!factory) throw new Error('[wasm-iml] nisps.js does not export a module factory');
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
  /** After memory growth, refresh the view onto the new ArrayBuffer. */
  rebind(): void {
    // Re-create the view with the (possibly new) underlying buffer.
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
}

export class WasmIML {
  // WASM binding state.
  private module!: NispsModule;
  private mlHandle = 0;
  private weightCount_ = 0;

  // Architecture descriptor (resolved post-init from the WASM build).
  private arch_: MLArchitecture = {
    inputSize: DEFAULT_INPUT_SIZE,
    hidden: [10, 14, 18],
    outputSize: DEFAULT_OUTPUT_SIZE,
    numLayers: 4,
  };

  // Pre-allocated heap buffers.
  private featuresBuf!: HeapBuffer;
  private labelsBuf!: HeapBuffer;
  private weightsBuf!: HeapBuffer;
  private statsBuf!: HeapBuffer;
  private batchInBuf!: HeapBuffer;
  private batchOutBuf!: HeapBuffer;
  private pinMaskBuf!: HeapU8;
  private describeBuf!: HeapBuffer; // 6 ints, reused as 6 floats on the heap is wrong;
  // We use HEAP32 directly via a tiny scratch malloc:
  private describePtr = 0;

  // JS-side state.
  readonly dataset: Dataset;
  private lastLoss_: number | null = null;
  private trainer: WasmTrainer | null = null;
  private storageKey: string;
  private saveTimer: number | null = null;
  private destroyed = false;

  static MAX_BATCH = 4096;

  private constructor(opts: WasmIMLOptions) {
    this.dataset = new Dataset(opts.maxExamples ?? 100);
    this.storageKey = opts.storageKey ?? 'nisps:wasm-iml';
  }

  /**
   * Async factory. Loads the wasm, creates the MLP handle, allocates heap
   * buffers, and rehydrates persisted state.
   */
  static async create(opts: WasmIMLOptions = {}): Promise<WasmIML> {
    const inst = new WasmIML(opts);
    await inst.init_(opts);
    return inst;
  }

  private async init_(opts: WasmIMLOptions): Promise<void> {
    const factory = await getFactory();
    this.module = await factory({
      // Vite serves /nisps.wasm at the root; the default locateFile would
      // resolve relative to nisps.js (also at root) so this is the same
      // result, but explicit is better.
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) return new URL(NISPS_WASM_URL, window.location.origin).toString();
        return path;
      },
    });

    // Resolve architecture via the WASM module (compile-time fixed; we
    // stash the values for callers that need them).
    this.describePtr = this.module._malloc(6 * 4);
    this.module._nisps_ml_describe(this.describePtr);
    const dims = new Int32Array(this.module.HEAP32.buffer, this.describePtr, 6);
    this.arch_ = {
      inputSize: dims[0],
      hidden: [dims[1], dims[2], dims[3]],
      outputSize: dims[4],
      numLayers: dims[5],
    };

    // Caller-supplied dimensions are accepted but ignored; warn if mismatch.
    const wantedIn = opts.inputSize ?? this.arch_.inputSize;
    const wantedOut = opts.outputSize ?? this.arch_.outputSize;
    if (wantedIn !== this.arch_.inputSize || wantedOut !== this.arch_.outputSize) {
      console.warn(
        `[wasm-iml] requested ${wantedIn}->${wantedOut} but WASM build is fixed at ` +
        `${this.arch_.inputSize}->${this.arch_.outputSize}; extras are ignored.`,
      );
    }

    // Create the MLP. We pass dummy hidden ptr/count — the binding ignores them.
    const seed = (opts.seed ?? (Date.now() >>> 0)) >>> 0;
    this.mlHandle = this.module._nisps_ml_create(
      this.arch_.inputSize,
      this.arch_.outputSize,
      0, // hidden ptr (unused)
      0, // n_hidden (unused)
      seed,
    );
    if (!this.mlHandle) throw new Error('[wasm-iml] nisps_ml_create returned null');

    this.weightCount_ = this.module._nisps_ml_weight_count(this.mlHandle);

    // Heap buffers (created after we know the architecture).
    this.featuresBuf = new HeapBuffer(this.module, this.arch_.inputSize);
    this.labelsBuf = new HeapBuffer(this.module, this.arch_.outputSize);
    this.weightsBuf = new HeapBuffer(this.module, this.weightCount_);
    this.statsBuf = new HeapBuffer(this.module, this.arch_.numLayers * 4);
    this.batchInBuf = new HeapBuffer(this.module, WasmIML.MAX_BATCH * this.arch_.inputSize);
    this.batchOutBuf = new HeapBuffer(this.module, WasmIML.MAX_BATCH * this.arch_.outputSize);
    this.pinMaskBuf = new HeapU8(this.module, this.arch_.outputSize);

    // Push initial state to the store.
    mlStore.__setState(produce((s) => {
      s.inputSize = this.arch_.inputSize;
      s.outputSize = this.arch_.outputSize;
      s.exampleCount = 0;
      s.lastLoss = null;
      s.lossHistory = [];
      s.training = false;
      s.ready = true;
    }));
    mlStore.__setOutputs(new Float32Array(this.arch_.outputSize));
    this.publishWeights_();

    // Load persisted state if present (best-effort).
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
    if (this.describePtr) this.module._free(this.describePtr);
    mlStore.__setState(produce((s) => {
      s.ready = false;
    }));
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
    // Copy out so the caller can hold onto it across memory growth.
    const view = new Float32Array(this.module.HEAPF32.buffer, ptr, this.arch_.outputSize);
    const out = new Float32Array(view); // copy
    mlStore.__setOutputs(out);
    return out;
  }

  /** Convenience: setInput(0,x); setInput(1,y); process(). */
  inferXY(x: number, y: number): Float32Array {
    this.setInput(0, x);
    this.setInput(1, y);
    return this.process();
  }

  /**
   * Batch inference. `points` is an array of [x,y] tuples (or any vector
   * length <= inputSize; trailing entries zero-padded). Returns a flat
   * Float32Array of length n * outputSize.
   *
   * Larger requests than `MAX_BATCH` are chunked transparently.
   */
  inferBatch(points: ReadonlyArray<ReadonlyArray<number>>): Float32Array {
    const n = points.length;
    const inSz = this.arch_.inputSize;
    const outSz = this.arch_.outputSize;
    const result = new Float32Array(n * outSz);

    let written = 0;
    for (let offset = 0; offset < n; offset += WasmIML.MAX_BATCH) {
      const chunk = Math.min(WasmIML.MAX_BATCH, n - offset);
      // Pack into batchInBuf.
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
      // Copy out into result.
      const slice = this.batchOutBuf.view.subarray(0, chunk * outSz);
      result.set(slice, written);
      written += chunk * outSz;
    }
    return result;
  }

  // -------------------------------------------------------------------
  // Training
  // -------------------------------------------------------------------

  /**
   * Add a feature/label pair to BOTH the JS dataset and the WASM ring
   * buffer. The two stay in sync because every train() call pushes the
   * full JS dataset back into WASM (in case of weight recompute, undo
   * restore, etc.). For the sake of correctness, we re-sync on each add
   * too — cheap relative to training.
   */
  addExample(features: ReadonlyArray<number>, labels: ReadonlyArray<number>): boolean {
    const ok = this.dataset.add(features, labels);
    if (!ok) return false;
    this.copyExampleToWasm_(features, labels);
    mlStore.__setState(produce((s) => {
      s.exampleCount = this.dataset.size;
    }));
    coreBus.emit('ml.example_added', { count: this.dataset.size });
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

  /**
   * Synchronous training. Returns the final loss (also stored in
   * `lastLoss`). Updates `mlStore.lastLoss` and emits `ml.trained`.
   *
   * Caller can pass per-sample weights; if omitted the WASM side uses
   * uniform 1/n weighting.
   */
  train(lr = 1.0, maxIter = 1000, minErr = 0.001, sampleWeights?: Float32Array): number {
    if (this.dataset.isEmpty()) {
      this.lastLoss_ = 0;
      mlStore.__setState(produce((s) => { s.lastLoss = 0; }));
      return 0;
    }

    let weightsPtr = 0;
    let weightsHandle: HeapBuffer | null = null;
    if (sampleWeights && sampleWeights.length === this.dataset.size) {
      weightsHandle = new HeapBuffer(this.module, sampleWeights.length);
      weightsHandle.view.set(sampleWeights);
      weightsPtr = weightsHandle.ptr;
    }

    mlStore.__setState(produce((s) => { s.training = true; }));
    let loss = 0;
    try {
      loss = this.module._nisps_ml_train(this.mlHandle, lr, maxIter, minErr, weightsPtr);
    } finally {
      if (weightsHandle) weightsHandle.free();
      mlStore.__setState(produce((s) => { s.training = false; }));
    }

    this.lastLoss_ = loss;
    mlStore.__setState(produce((s) => {
      s.lastLoss = loss;
      // The C++ MLP stores per-iter history but we don't currently expose
      // it via the WASM bindings. Stream 9 may add nisps_ml_loss_history.
      s.lossHistory = [loss];
    }));
    this.publishWeights_();
    coreBus.emit('ml.trained', { loss });
    this.scheduleSave_();
    return loss;
  }

  /**
   * Async training via worker. The worker holds a SECOND wasm instance,
   * receives current weights + dataset, runs SGD, and returns updated
   * weights. Main-thread weights are then `setWeights()`-restored.
   */
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

    mlStore.__setState(produce((s) => { s.training = true; }));
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
      mlStore.__setState(produce((s) => {
        s.lastLoss = result.loss;
        s.lossHistory = Array.from(result.lossHistory);
      }));
      coreBus.emit('ml.trained', { loss: result.loss });
      this.scheduleSave_();
      return result.loss;
    } finally {
      mlStore.__setState(produce((s) => { s.training = false; }));
    }
  }

  /** Non-destructive loss query. */
  evalLoss(): number {
    return this.module._nisps_ml_eval_loss(this.mlHandle);
  }

  clearExamples(): void {
    this.dataset.clear();
    this.module._nisps_ml_clear_examples(this.mlHandle);
    mlStore.__setState(produce((s) => { s.exampleCount = 0; }));
    coreBus.emit('ml.examples_cleared', undefined);
    this.scheduleSave_();
  }

  // -------------------------------------------------------------------
  // RL ops
  // -------------------------------------------------------------------

  randomiseWeights(spread = 0.6): void {
    this.module._nisps_ml_draw_weights(this.mlHandle, spread);
    this.publishWeights_();
    coreBus.emit('ml.delta_update', { reason: 'randomize' });
    this.scheduleSave_();
  }

  moveWeights(speed: number, spread: number, pinMask?: Uint8Array): void {
    let maskPtr = 0;
    if (pinMask) {
      const sz = Math.min(pinMask.length, this.arch_.outputSize);
      for (let i = 0; i < sz; ++i) this.pinMaskBuf.view[i] = pinMask[i];
      for (let i = sz; i < this.arch_.outputSize; ++i) this.pinMaskBuf.view[i] = 0;
      maskPtr = this.pinMaskBuf.ptr;
    }
    this.module._nisps_ml_move_weights(this.mlHandle, speed, spread, maskPtr);
    this.publishWeights_();
    // The caller (RL handler) decides whether this is a thumbs-up/down;
    // we emit a generic delta_update.
    coreBus.emit('ml.delta_update', { reason: 'thumbs_down' });
  }

  // -------------------------------------------------------------------
  // Weights I/O
  // -------------------------------------------------------------------

  getWeights(): Float32Array {
    this.module._nisps_ml_get_weights(this.mlHandle, this.weightsBuf.ptr);
    // Copy out so caller can mutate freely.
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

  /** Per-layer weight stats. Returns one record per layer. */
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

  /** Flat layer-stats Float32Array (numLayers * 4). For probe API. */
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
    mlStore.__setState(produce((s) => {
      s.exampleCount = 0;
      s.lastLoss = null;
      s.lossHistory = [];
    }));
    this.publishWeights_();
    coreBus.emit('ml.examples_cleared', undefined);
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
      // localStorage might be full or unavailable; not fatal.
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
      // Restore dataset (rebuild via add()).
      const inSz = this.arch_.inputSize;
      const outSz = this.arch_.outputSize;
      if (payload.size > 0 && payload.features.length === payload.size * inSz &&
          payload.labels.length === payload.size * outSz) {
        for (let i = 0; i < payload.size; ++i) {
          const f = payload.features.slice(i * inSz, (i + 1) * inSz);
          const l = payload.labels.slice(i * outSz, (i + 1) * outSz);
          this.dataset.add(f, l);
          // Also push to the WASM ring buffer.
          this.copyExampleToWasm_(f, l);
        }
      }
      // Restore weights.
      if (payload.weights.length === this.weightCount_) {
        this.setWeights(new Float32Array(payload.weights));
      }
      this.lastLoss_ = payload.lastLoss;
      mlStore.__setState(produce((s) => {
        s.exampleCount = this.dataset.size;
        s.lastLoss = this.lastLoss_;
      }));
    } catch (err) {
      console.warn('[wasm-iml] tryLoadFromStorage failed:', err);
    }
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private publishWeights_(): void {
    const w = this.getWeights();
    mlStore.__setWeights(w);
  }
}
