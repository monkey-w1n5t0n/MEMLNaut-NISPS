/**
 * A small pool of lab workers. `run` feeds episode specs to idle workers and
 * reports each result as it lands; `stop` terminates everything (a sweep can
 * be abandoned mid-way and its partial results still summarised).
 */
import type { EpisodeResult, EpisodeSpec } from './episode';
import type { LabWorkerRequest, LabWorkerResponse } from './lab.worker';

export interface PoolProgress {
  done: number;
  failed: number;
  total: number;
}

export class LabPool {
  private workers: Worker[] = [];
  private stopped = false;
  private finish: (() => void) | null = null;

  constructor(private size: number) {}

  async run(
    specs: EpisodeSpec[],
    onResult: (r: EpisodeResult, p: PoolProgress) => void,
  ): Promise<PoolProgress> {
    const assetBase = new URL(import.meta.env.BASE_URL ?? '/', document.baseURI).href;
    const progress: PoolProgress = { done: 0, failed: 0, total: specs.length };
    let next = 0;
    await new Promise<void>((resolve) => {
      this.finish = resolve;
      let live = 0;
      const n = Math.max(1, Math.min(this.size, specs.length));
      for (let w = 0; w < n; w++) {
        const worker = new Worker(new URL('./lab.worker.ts', import.meta.url), { type: 'module' });
        this.workers.push(worker);
        live++;
        const feed = () => {
          if (this.stopped || next >= specs.length) {
            worker.terminate();
            if (--live === 0) resolve();
            return;
          }
          const id = next++;
          worker.postMessage({ kind: 'lab:run', id, spec: specs[id]! } satisfies LabWorkerRequest);
        };
        worker.onmessage = (ev: MessageEvent<LabWorkerResponse>) => {
          const m = ev.data;
          if (m.kind === 'lab:ready') return feed();
          if (m.kind !== 'lab:result' && m.kind !== 'lab:error') return; // not ours
          progress.done++;
          if (m.kind === 'lab:result') onResult(m.result, progress);
          else { progress.failed++; console.warn('[lab] episode failed:', m.message); }
          feed();
        };
        worker.onerror = (e) => {
          console.warn('[lab] worker error:', e.message);
          worker.terminate();
          if (--live === 0) resolve();
        };
        worker.postMessage({ kind: 'lab:init', assetBase } satisfies LabWorkerRequest);
      }
      if (n === 0) resolve();
    });
    this.workers = [];
    return progress;
  }

  stop(): void {
    this.stopped = true;
    for (const w of this.workers) w.terminate();
    this.finish?.(); // terminated workers never answer; release run()
  }
}
