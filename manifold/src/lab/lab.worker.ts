/**
 * Lab Web Worker: runs episodes off the main thread, one WASM instance per
 * episode. The main thread resolves the deploy base (the worker has no
 * document — same arrangement as engine/wasm-worker.ts) and sends it in
 * `init`; the worker fetches the glue + binary once and instantiates a fresh
 * module per episode so no state leaks between sessions.
 */
import type { NispsModule, NispsModuleFactory } from '../engine/types';
import { runEpisode, type EpisodeResult, type EpisodeSpec } from './episode';

// Message kinds are namespaced: this worker's module graph includes
// engine/wasm-worker.ts, whose worker-side code installs its own `message`
// listener in ANY worker that imports it and answers a bare {kind:'init'}
// with {kind:'ready'} — which once double-fed this pool.
export type LabWorkerRequest =
  | { kind: 'lab:init'; assetBase: string }
  | { kind: 'lab:run'; id: number; spec: EpisodeSpec };

export type LabWorkerResponse =
  | { kind: 'lab:ready' }
  | { kind: 'lab:result'; id: number; result: EpisodeResult }
  | { kind: 'lab:error'; id: number; message: string };

let loader: (() => Promise<NispsModule>) | null = null;
let ready: Promise<void> | null = null;

async function init(assetBase: string): Promise<void> {
  const [src, bin] = await Promise.all([
    fetch(new URL('nisps.js', assetBase)).then((r) => r.text()),
    fetch(new URL('nisps.wasm', assetBase)).then((r) => r.arrayBuffer()),
  ]);
  // MODULARIZE glue without ES exports (see wasm-iml.ts getFactory).
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function('module', 'exports',
    `${src}\n;return typeof createNispsModule === 'function' ? createNispsModule : null;`,
  )({ exports: {} }, {}) as NispsModuleFactory | null;
  if (typeof factory !== 'function') throw new Error('[lab.worker] createNispsModule not found');
  loader = () => factory({ wasmBinary: bin });
}

const post = (m: LabWorkerResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (ev: MessageEvent<LabWorkerRequest>) => {
  const m = ev.data;
  if (m.kind === 'lab:init') {
    ready = init(m.assetBase);
    await ready;
    post({ kind: 'lab:ready' });
    return;
  }
  if (m.kind !== 'lab:run') return; // not ours (see the note on message kinds)
  try {
    await ready;
    const result = await runEpisode(m.spec, loader!);
    post({ kind: 'lab:result', id: m.id, result });
  } catch (e) {
    post({ kind: 'lab:error', id: m.id, message: String((e as Error)?.message ?? e) });
  }
};
