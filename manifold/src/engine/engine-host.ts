/**
 * EngineHost — main-thread side of the WASM AudioWorklet pipeline.
 *
 * Lifted from `playground/src/audio/engine-host.ts`. Changes vs the playground:
 *   - imports `./types` (the lifted ABI types)
 *   - the worklet entry is `./worklet/nisps-processor.ts?worker&url`
 *   - `nisps.wasm` is fetched via `import.meta.env.BASE_URL`, not a hardcoded
 *     `/nisps.wasm`, so the bundle works under any mount path (`/`, `/next`, …).
 *
 * Responsibilities: lazy-create AudioContext (user-gesture gated), register the
 * worklet, hand it the `nisps.wasm` bytes (the worklet has no fetch), send
 * engine selection + parameter updates over `port`, and tear down on dispose().
 *
 * The DSP runs in `./worklet/nisps-processor.ts`, which holds a SECOND WASM
 * instance owned by the worklet thread.
 */

import type { EngineId } from './types';

// `?worker&url` makes Vite COMPILE the worklet TS→JS, bundle its imports, and
// hand back a hashed .js URL. Plain `new URL('./x.ts', import.meta.url)` does
// NOT work for audioWorklet.addModule (Vite only treats that as a worker entry
// for `new Worker(...)`) — it copies raw .ts, which the browser rejects.
import workletUrl from './worklet/nisps-processor.ts?worker&url';

const PROCESSOR_NAME = 'nisps-processor';

/** Base-aware absolute URL for an asset served from `public/`. Resolves against
 *  `document.baseURI` so a `base: './'` build works under any mount path
 *  (`/`, `/next/`, …); `location.origin` would drop the sub-path. */
function assetUrl(file: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return new URL(base + file, document.baseURI).toString();
}

/** Message protocol: main → worklet. */
export type HostToWorkletMessage =
  | {
      kind: 'init';
      wasmBinary: ArrayBuffer;
      sampleRate: number;
    }
  | {
      kind: 'engine';
      engineId: EngineId;
    }
  | {
      kind: 'params';
      params: Float32Array;
    }
  | {
      kind: 'mute';
      muted: boolean;
    };

/** Message protocol: worklet → main. */
export type WorkletToHostMessage =
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export interface EngineHostOptions {
  /** Override sample rate (default: AudioContext.sampleRate). */
  sampleRate?: number;
  /** Override worklet processor URL (testing). */
  processorUrl?: string;
}

export class EngineHost {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private workletReady = false;
  private currentEngine: EngineId = 'thru';
  private disposed = false;
  private options: EngineHostOptions;

  private wasmBytes: ArrayBuffer | null = null;

  constructor(options: EngineHostOptions = {}) {
    this.options = options;
  }

  get isStarted(): boolean {
    return !!this.ctx && this.workletReady;
  }

  get engine(): EngineId {
    return this.currentEngine;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? this.options.sampleRate ?? 48000;
  }

  /**
   * Start audio. Must be called from a user gesture for AudioContext to
   * resume. After this resolves, `setEngine()` and `setParams()` can be called.
   */
  async start(engineId: EngineId = 'thru'): Promise<void> {
    if (this.ctx) {
      this.setEngine(engineId);
      await this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext({
      sampleRate: this.options.sampleRate,
      latencyHint: 'interactive',
    });

    if (!this.wasmBytes) {
      this.wasmBytes = await this.fetchWasm_();
    }

    const procUrl = this.options.processorUrl ?? workletUrl;
    await this.ctx.audioWorklet.addModule(procUrl);

    this.node = new AudioWorkletNode(this.ctx, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.connect(this.ctx.destination);

    this.workletReady = false;
    const ready = new Promise<void>((resolve, reject) => {
      const onMsg = (ev: MessageEvent<WorkletToHostMessage>) => {
        if (ev.data.kind === 'ready') {
          this.workletReady = true;
          this.node?.port.removeEventListener('message', onMsg);
          resolve();
        } else if (ev.data.kind === 'error') {
          this.node?.port.removeEventListener('message', onMsg);
          reject(new Error(ev.data.message));
        }
      };
      this.node!.port.addEventListener('message', onMsg);
      this.node!.port.start();
    });

    const copy = this.wasmBytes.slice(0);
    this.node.port.postMessage(
      { kind: 'init', wasmBinary: copy, sampleRate: this.ctx.sampleRate } satisfies HostToWorkletMessage,
      [copy],
    );

    await ready;
    this.currentEngine = engineId;
    if (engineId !== 'thru') {
      this.setEngine(engineId);
    }
  }

  setEngine(engineId: EngineId): void {
    if (!this.node || !this.workletReady) return;
    this.currentEngine = engineId;
    this.node.port.postMessage({ kind: 'engine', engineId } satisfies HostToWorkletMessage);
  }

  /**
   * Push a fresh parameter vector. Caller should NOT reuse the buffer after
   * this call — we transfer it. To keep yours, pass a copy.
   */
  setParams(params: Float32Array): void {
    if (!this.node || !this.workletReady) return;
    this.node.port.postMessage(
      { kind: 'params', params } satisfies HostToWorkletMessage,
      [params.buffer],
    );
  }

  setMuted(muted: boolean): void {
    if (!this.node || !this.workletReady) return;
    this.node.port.postMessage({ kind: 'mute', muted } satisfies HostToWorkletMessage);
  }

  async stop(): Promise<void> {
    if (!this.ctx) return;
    if (this.node) {
      try {
        this.node.disconnect();
      } catch { /* ignore */ }
      this.node = null;
    }
    try {
      await this.ctx.close();
    } catch { /* ignore */ }
    this.ctx = null;
    this.workletReady = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.stop();
    this.wasmBytes = null;
  }

  private async fetchWasm_(): Promise<ArrayBuffer> {
    const url = assetUrl('nisps.wasm');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch nisps.wasm: ${resp.status} ${resp.statusText}`);
    return await resp.arrayBuffer();
  }
}
