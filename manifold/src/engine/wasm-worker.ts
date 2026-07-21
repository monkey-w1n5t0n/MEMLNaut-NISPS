/**
 * Disposable Web Worker that runs SGD off the main thread.
 *
 * Lifted from `playground/src/ml/wasm-worker.ts`. Changes vs the playground:
 *   - imports `./types` (the lifted, feedback-extended ABI types)
 *   - WASM glue + binary are resolved via `import.meta.env.BASE_URL` so the
 *     bundle works under any mount path (`/`, `/next`, …), not a hardcoded
 *     `/nisps.js` / `/nisps.wasm`.
 *
 * The worker holds its own `nisps.wasm` instance; the main thread sends
 * current weights + dataset + hyperparameters and receives updated weights +
 * final loss.
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
  /** Main net's hidden layers, so the worker's mirror net matches after reshape. */
  hidden: readonly [number, number, number];
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
      // Resolve the deploy base on the main thread (the worker has no document).
      const assetBase = new URL(import.meta.env.BASE_URL ?? '/', document.baseURI).href;
      this.worker.postMessage({ kind: 'init', seed, assetBase } satisfies WorkerRequest);
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
        hidden: args.hidden,
      };
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
  }
}

export function createTrainer(): Promise<WasmTrainer> {
  return WasmTrainer.create();
}

// ---------------------------------------------------------------------------
// Worker-thread side
// ---------------------------------------------------------------------------

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

/** Absolute deploy base injected by the main thread on `init` (e.g.
 *  "https://host/next/"). The worker cannot derive it: it has no document, and
 *  its own bundle lives under /assets/, not the public root. */
let workerAssetBase = '/';

/** Base-aware absolute URL for an asset served from `public/`. */
function assetUrl(file: string): string {
  return new URL(file, workerAssetBase).toString();
}

if (isWorker) {
  let mod: NispsModule | null = null;
  let mlHandle = 0;
  let weightCount = 0;

  // Current mirror-net shape. The net is (re)created to match the main thread's
  // dims so flat weight vectors exchange 1:1 across a reshape (P2.3). Seed is
  // irrelevant to results — the net is immediately overwritten via set_weights.
  let netInputSize = 0;
  let netOutputSize = 0;
  let netHidden: readonly number[] = [];
  let workerSeed = 0;

  let weightsPtr = 0;
  let weightsViewLen = 0;
  let featuresPtr = 0;
  let featuresLen = 0;
  let labelsPtr = 0;
  let labelsLen = 0;
  let sampleWeightsPtr = 0;
  let sampleWeightsLen = 0;

  async function loadModule(seed: number): Promise<void> {
    // nisps.js is non-ES-module Emscripten glue; fetch + indirect-eval to
    // install the global factory (a module worker cannot importScripts, and
    // import() yields an empty namespace — see wasm-iml.getFactory).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = self as any;
    if (!g.createNispsModule) {
      const src = await (await fetch(assetUrl('nisps.js'))).text();
      (0, eval)(src);
    }
    const factory: NispsModuleFactory = g.createNispsModule;
    if (!factory) throw new Error('[wasm-worker] nisps.js did not define createNispsModule');
    mod = await factory({
      locateFile: (path: string) => (path.endsWith('.wasm') ? assetUrl('nisps.wasm') : path),
    });
    // Default shape (0,0 → 32→[10,14,18]→126). The worker's net MUST match the
    // main thread's shape — weights are exchanged as flat vectors. Each `train`
    // message carries the current dims (one-core-engine P2.3), so `ensureNet`
    // recreates this net if the main net was reshaped.
    workerSeed = seed >>> 0;
    mlHandle = mod._nisps_ml_create(0, 0, 0, 0, workerSeed);
    weightCount = mod._nisps_ml_weight_count(mlHandle);
    // 7 ints: [in, h1, h2, h3, out, n_layers, max_examples] — the buffer size
    // and view length here MUST track nisps_ml_describe's actual output
    // (nisps/wasm/bindings.cpp) or this overflows the WASM heap by 4 bytes
    // (S35, docs/specs/recon/simplification-audit-2026-07.md). This worker
    // doesn't use max_examples (it never touches the dataset), but describe()
    // always writes all 7 regardless of what the caller reads.
    const dPtr = mod._malloc(7 * 4);
    mod._nisps_ml_describe(mlHandle, dPtr);
    const d = new Int32Array(mod.HEAP32.buffer, dPtr, 7);
    netInputSize = d[0];
    netOutputSize = d[4];
    netHidden = [d[1], d[2], d[3]];
    mod._free(dPtr);
  }

  /** Recreate the mirror net iff the requested shape differs from the current. */
  function ensureNet(inputSize: number, outputSize: number, hidden: readonly [number, number, number]): void {
    if (!mod) throw new Error('worker module not loaded');
    const same =
      netInputSize === inputSize &&
      netOutputSize === outputSize &&
      netHidden.length === hidden.length &&
      netHidden.every((h, i) => h === hidden[i]);
    if (same) return;

    if (mlHandle) mod._nisps_ml_destroy(mlHandle);
    const hPtr = mod._malloc(hidden.length * 4);
    new Int32Array(mod.HEAP32.buffer, hPtr, hidden.length).set(hidden);
    mlHandle = mod._nisps_ml_create(inputSize, outputSize, hPtr, hidden.length, workerSeed);
    mod._free(hPtr);
    weightCount = mod._nisps_ml_weight_count(mlHandle);
    netInputSize = inputSize;
    netOutputSize = outputSize;
    netHidden = [...hidden];
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
      // Match the main net's shape (it may have been reshaped since init).
      ensureNet(req.inputSize, req.outputSize, req.hidden);
      ensureBuffers(req.features, req.labels, req.sampleWeights, req.weights);
      mod._nisps_ml_set_weights(mlHandle, weightsPtr);

      mod._nisps_ml_clear_examples(mlHandle);
      const inSz = req.inputSize;
      const outSz = req.outputSize;
      const n = req.features.length / inSz;
      for (let i = 0; i < n; ++i) {
        const fPtr = featuresPtr + i * inSz * 4;
        const lPtr = labelsPtr + i * outSz * 4;
        mod._nisps_ml_add_example(mlHandle, fPtr, lPtr);
      }

      const swPtr = req.sampleWeights.length > 0 ? sampleWeightsPtr : 0;
      const loss = mod._nisps_ml_train(mlHandle, req.lr, req.maxIter, req.minErr, swPtr);

      mod._nisps_ml_get_weights(mlHandle, weightsPtr);
      const view = new Float32Array(mod.HEAPF32.buffer, weightsPtr, weightCount);
      const outWeights = new Float32Array(view); // copy

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
        workerAssetBase = req.assetBase ?? self.location.origin + '/';
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
      if (res.kind === 'result') {
        self.postMessage(res, [res.weights.buffer, res.lossHistory.buffer]);
      } else {
        self.postMessage(res);
      }
    } else if (req.kind === 'dispose') {
      disposeModule();
    }
  });
}
