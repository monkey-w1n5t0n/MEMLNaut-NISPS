/**
 * Disposable Web Worker that runs SGD off the main thread.
 *
 * The worker holds its own `nisps.wasm` instance (architecture.md §6.4).
 * The main thread sends:
 *   - current weights (so the worker is in the same state as the UI),
 *   - dataset (features + labels),
 *   - SGD hyperparameters,
 * and receives updated weights + final loss.
 *
 * This module exposes:
 *   - `createTrainer()`   - factory that spawns the worker, loads its WASM,
 *                           and returns a `WasmTrainer` handle.
 *   - The worker entry-point itself (when this file runs in a Worker).
 *
 * The worker is implemented inline so a single TS file becomes both the
 * main-thread API and the worker bundle. Vite's `new Worker(new URL(...,
 * import.meta.url))` pattern packs it correctly.
 *
 * Lifecycle: each `WasmTrainer` is disposable via `.dispose()` which
 * terminates the worker. Tests should always dispose to avoid leaks.
 */

import type { NispsModule, NispsModuleFactory, WorkerRequest, WorkerResponse } from './types';

// ---------------------------------------------------------------------------
// Main-thread side
// ---------------------------------------------------------------------------

export interface TrainArgs {
  weights: Float32Array;
  features: Float32Array;
  labels: Float32Array;
  /** Optional; pass empty for uniform weighting. */
  sampleWeights: Float32Array;
  lr: number;
  maxIter: number;
  minErr: number;
  inputSize: number;
  outputSize: number;
}

export interface TrainResult {
  loss: number;
  weights: Float32Array;
  lossHistory: Float32Array;
}

export class WasmTrainer {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: TrainResult) => void; reject: (e: unknown) => void }>();
  private disposed = false;

  static async create(): Promise<WasmTrainer> {
    const trainer = new WasmTrainer();
    await trainer.init_();
    return trainer;
  }

  private constructor() {
    this.worker = new Worker(new URL('./wasm-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev) => this.onMessage_(ev.data as WorkerResponse);
    this.worker.onerror = (ev) => {
      // Fail any pending requests.
      for (const { reject } of this.pending.values()) reject(ev.message ?? 'worker error');
      this.pending.clear();
    };
  }

  private init_(): Promise<void> {
    return new Promise((resolve, reject) => {
      const handler = (ev: MessageEvent) => {
        const msg = ev.data as WorkerResponse;
        if (msg.kind === 'ready') {
          this.worker.removeEventListener('message', handler);
          resolve();
        } else if (msg.kind === 'error') {
          this.worker.removeEventListener('message', handler);
          reject(new Error(msg.message));
        }
      };
      this.worker.addEventListener('message', handler);
      const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      this.worker.postMessage({ kind: 'init', seed } satisfies WorkerRequest);
    });
  }

  train(args: TrainArgs): Promise<TrainResult> {
    if (this.disposed) return Promise.reject(new Error('WasmTrainer disposed'));
    const requestId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const msg: WorkerRequest = {
        kind: 'train',
        requestId,
        weights: args.weights,
        features: args.features,
        labels: args.labels,
        sampleWeights: args.sampleWeights,
        lr: args.lr,
        maxIter: args.maxIter,
        minErr: args.minErr,
        inputSize: args.inputSize,
        outputSize: args.outputSize,
      };
      // Transfer all the typed-array buffers we no longer need on the
      // main thread; faster than copying. Caller has already cloned.
      this.worker.postMessage(msg, [
        args.weights.buffer,
        args.features.buffer,
        args.labels.buffer,
        args.sampleWeights.buffer,
      ]);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.worker.postMessage({ kind: 'dispose' } satisfies WorkerRequest);
    } catch {
      /* ignore */
    }
    this.worker.terminate();
    for (const { reject } of this.pending.values()) reject(new Error('disposed'));
    this.pending.clear();
  }

  private onMessage_(msg: WorkerResponse): void {
    if (msg.kind === 'result') {
      const p = this.pending.get(msg.requestId);
      if (p) {
        this.pending.delete(msg.requestId);
        p.resolve({ loss: msg.loss, weights: msg.weights, lossHistory: msg.lossHistory });
      }
    } else if (msg.kind === 'error') {
      const p = this.pending.get(msg.requestId);
      if (p) {
        this.pending.delete(msg.requestId);
        p.reject(new Error(msg.message));
      }
    }
    // 'ready' handled in init_().
  }
}

export function createTrainer(): Promise<WasmTrainer> {
  return WasmTrainer.create();
}

// ---------------------------------------------------------------------------
// Worker-thread side
// ---------------------------------------------------------------------------
//
// When this module is loaded in a Worker, `self` is `WorkerGlobalScope` and
// `window` is undefined. We use that as the dispatch.
//
// We import the wasm via a same-origin fetch (no DOM available so we can't
// use a regular import URL — but Vite's bundler treats `new Worker(...)`
// specially and `?url` imports work for assets).

// Inside a Worker, `self` is a `DedicatedWorkerGlobalScope`. To keep TS
// happy in both build contexts we use a structural cast.
declare const self: {
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
  addEventListener: (event: string, handler: (ev: MessageEvent) => void) => void;
  location: { origin: string };
  importScripts?: unknown;
};

const isWorker =
  typeof window === 'undefined' &&
  typeof self !== 'undefined' &&
  typeof (self as { importScripts?: unknown }).importScripts !== 'undefined';

if (isWorker) {
  // Module-level state in worker scope.
  let mod: NispsModule | null = null;
  let mlHandle = 0;
  let weightCount = 0;

  // Heap buffers (allocated on first train).
  let weightsPtr = 0;
  let weightsViewLen = 0;
  let featuresPtr = 0;
  let featuresLen = 0;
  let labelsPtr = 0;
  let labelsLen = 0;
  let sampleWeightsPtr = 0;
  let sampleWeightsLen = 0;

  async function loadModule(seed: number): Promise<void> {
    // Same-origin fetch to /nisps.js. The worker is served by the dev
    // server with COOP/COEP set, so this works.
    const factoryMod = await import(/* @vite-ignore */ new URL('/nisps.js', self.location.origin).toString());
    const factory: NispsModuleFactory =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (factoryMod as any).default ?? (factoryMod as any).createNispsModule;
    mod = await factory({
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) return new URL('/nisps.wasm', self.location.origin).toString();
        return path;
      },
    });
    mlHandle = mod._nisps_ml_create(0, 0, 0, 0, seed >>> 0);
    weightCount = mod._nisps_ml_weight_count(mlHandle);
  }

  function ensureBuffers(features: Float32Array, labels: Float32Array, sampleWeights: Float32Array, weights: Float32Array): void {
    if (!mod) throw new Error('worker module not loaded');

    if (weightsViewLen !== weightCount) {
      if (weightsPtr) mod._free(weightsPtr);
      weightsPtr = mod._malloc(weightCount * 4);
      weightsViewLen = weightCount;
    }
    if (features.length !== featuresLen) {
      if (featuresPtr) mod._free(featuresPtr);
      featuresPtr = mod._malloc(features.length * 4);
      featuresLen = features.length;
    }
    if (labels.length !== labelsLen) {
      if (labelsPtr) mod._free(labelsPtr);
      labelsPtr = mod._malloc(labels.length * 4);
      labelsLen = labels.length;
    }
    if (sampleWeights.length !== sampleWeightsLen) {
      if (sampleWeightsPtr) mod._free(sampleWeightsPtr);
      sampleWeightsPtr = sampleWeights.length > 0 ? mod._malloc(sampleWeights.length * 4) : 0;
      sampleWeightsLen = sampleWeights.length;
    }

    new Float32Array(mod.HEAPF32.buffer, weightsPtr, weightCount).set(weights);
    new Float32Array(mod.HEAPF32.buffer, featuresPtr, features.length).set(features);
    new Float32Array(mod.HEAPF32.buffer, labelsPtr, labels.length).set(labels);
    if (sampleWeightsPtr) {
      new Float32Array(mod.HEAPF32.buffer, sampleWeightsPtr, sampleWeights.length).set(sampleWeights);
    }
  }

  function trainOnce(req: Extract<WorkerRequest, { kind: 'train' }>): WorkerResponse {
    if (!mod) {
      return { kind: 'error', requestId: req.requestId, message: 'worker not initialised' };
    }
    try {
      ensureBuffers(req.features, req.labels, req.sampleWeights, req.weights);
      // Push current weights into our MLP.
      mod._nisps_ml_set_weights(mlHandle, weightsPtr);

      // Seed the example ring buffer. We must clear first because past
      // train calls may have left examples there.
      mod._nisps_ml_clear_examples(mlHandle);
      const inSz = req.inputSize;
      const outSz = req.outputSize;
      const n = req.features.length / inSz;
      // Allocate small per-example scratch (re-used across iterations of
      // this loop).
      // We use stack-equivalents by allocating once, then shifting pointers.
      for (let i = 0; i < n; ++i) {
        const fPtr = featuresPtr + i * inSz * 4;
        const lPtr = labelsPtr + i * outSz * 4;
        mod._nisps_ml_add_example(mlHandle, fPtr, lPtr);
      }

      // Run training.
      const swPtr = req.sampleWeights.length > 0 ? sampleWeightsPtr : 0;
      const loss = mod._nisps_ml_train(mlHandle, req.lr, req.maxIter, req.minErr, swPtr);

      // Read out final weights.
      mod._nisps_ml_get_weights(mlHandle, weightsPtr);
      const view = new Float32Array(mod.HEAPF32.buffer, weightsPtr, weightCount);
      const outWeights = new Float32Array(view); // copy

      // Loss history not yet plumbed via WASM; emit just final loss.
      const lossHistory = new Float32Array([loss]);

      return {
        kind: 'result',
        requestId: req.requestId,
        loss,
        weights: outWeights,
        lossHistory,
      };
    } catch (err) {
      return {
        kind: 'error',
        requestId: req.requestId,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  function disposeModule(): void {
    if (!mod) return;
    if (mlHandle) {
      mod._nisps_ml_destroy(mlHandle);
      mlHandle = 0;
    }
    if (weightsPtr) { mod._free(weightsPtr); weightsPtr = 0; }
    if (featuresPtr) { mod._free(featuresPtr); featuresPtr = 0; }
    if (labelsPtr) { mod._free(labelsPtr); labelsPtr = 0; }
    if (sampleWeightsPtr) { mod._free(sampleWeightsPtr); sampleWeightsPtr = 0; }
    mod = null;
  }

  self.addEventListener('message', async (ev: MessageEvent<WorkerRequest>) => {
    const req = ev.data;
    if (req.kind === 'init') {
      try {
        await loadModule(req.seed);
        self.postMessage({ kind: 'ready' } satisfies WorkerResponse);
      } catch (err) {
        self.postMessage({
          kind: 'error',
          requestId: 0,
          message: err instanceof Error ? err.message : String(err),
        } satisfies WorkerResponse);
      }
    } else if (req.kind === 'train') {
      const res = trainOnce(req);
      // Transfer weights back to main thread to avoid copy.
      if (res.kind === 'result') {
        self.postMessage(res, [res.weights.buffer, res.lossHistory.buffer]);
      } else {
        self.postMessage(res);
      }
    } else if (req.kind === 'dispose') {
      disposeModule();
      // Worker terminates from main thread side via .terminate().
    }
  });
}
