/**
 * EngineHost — main-thread side of the WASM AudioWorklet pipeline.
 *
 * Responsibilities:
 *   - Lazy-create AudioContext (browsers gate this on user gesture).
 *   - Register the AudioWorklet processor module.
 *   - Hand the worklet a copy of `nisps.wasm` bytes (we fetch on the main
 *     thread because AudioWorklet has no `fetch`/`importScripts`).
 *   - Send engine selection + parameter updates over the worklet `port`.
 *   - Tear everything down on `dispose()`.
 *
 * The actual DSP runs in `playground/src/audio/worklet/nisps-processor.ts`,
 * which calls into a SECOND WASM instance owned by the worklet thread.
 *
 * IMPORTANT: this class never auto-starts audio. The caller must drive
 * `start()` from a user gesture (button click, etc.) so browsers don't
 * block AudioContext creation.
 */

import type { EngineId } from '../ml/types';

const NISPS_WASM_URL = '/nisps.wasm';
const PROCESSOR_NAME = 'nisps-processor';

/** Message protocol: main → worklet. */
export type HostToWorkletMessage =
  | {
      kind: 'init';
      // ArrayBuffer transferred so the worklet can `WebAssembly.compile` it.
      wasmBinary: ArrayBuffer;
      sampleRate: number;
    }
  | {
      kind: 'engine';
      engineId: EngineId;
    }
  | {
      kind: 'params';
      // Float32Array transferred to avoid per-tick copy.
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

  // Cached bytes of nisps.wasm (we fetch once per host instance).
  private wasmBytes: ArrayBuffer | null = null;

  constructor(options: EngineHostOptions = {}) {
    this.options = options;
  }

  get isStarted(): boolean {
    return !!this.ctx && this.workletReady;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? this.options.sampleRate ?? 48000;
  }

  /**
   * Start audio. Must be called from a user gesture for AudioContext to
   * resume. After this resolves, `setEngine()` and `setParams()` can be
   * called.
   */
  async start(engineId: EngineId = 'thru'): Promise<void> {
    if (this.ctx) {
      // Already started; just switch engine.
      this.setEngine(engineId);
      await this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext({
      sampleRate: this.options.sampleRate,
      latencyHint: 'interactive',
    });

    // Fetch the WASM bytes on the main thread (the worklet doesn't have
    // fetch). We pass the buffer to the worklet as a transferable.
    if (!this.wasmBytes) {
      this.wasmBytes = await this.fetchWasm_();
    }

    // Register the processor module. Vite's `new URL(..., import.meta.url)`
    // pattern bundles the worklet file correctly.
    const procUrl = this.options.processorUrl ??
      new URL('./worklet/nisps-processor.ts', import.meta.url).toString();
    await this.ctx.audioWorklet.addModule(procUrl);

    this.node = new AudioWorkletNode(this.ctx, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.connect(this.ctx.destination);

    // Wire up message handler before sending init.
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

    // Send the WASM binary + sample rate. ArrayBuffer is transferable —
    // we keep a copy on the main thread for re-init.
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

  /**
   * Switch which engine the worklet is processing. Cheap — just a message.
   * The worklet handles engine destruction/creation internally.
   */
  setEngine(engineId: EngineId): void {
    if (!this.node || !this.workletReady) return;
    this.currentEngine = engineId;
    this.node.port.postMessage({ kind: 'engine', engineId } satisfies HostToWorkletMessage);
  }

  /**
   * Push a fresh parameter vector. Caller should NOT reuse the buffer
   * after this call — we transfer it. If you need to keep yours, pass a
   * copy: `host.setParams(new Float32Array(myBuf))`.
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
    const url = new URL(NISPS_WASM_URL, window.location.origin).toString();
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch nisps.wasm: ${resp.status} ${resp.statusText}`);
    return await resp.arrayBuffer();
  }
}

/**
 * Smoke-test helper: returns true iff the WASM module exposes the C
 * functions we need. Useful as a build-time check inside `engine-host.ts`
 * tests; not used in production.
 */
export async function smokeCheckWasm(): Promise<boolean> {
  const url = new URL('/nisps.js', window.location.origin).toString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(/* @vite-ignore */ url);
  const factory = mod.default ?? mod.createNispsModule;
  if (!factory) return false;
  const m = await factory({
    locateFile: (p: string) => p.endsWith('.wasm')
      ? new URL(NISPS_WASM_URL, window.location.origin).toString()
      : p,
  });
  return typeof m._nisps_ml_create === 'function'
      && typeof m._nisps_engine_create === 'function'
      && typeof m._nisps_engine_process_block === 'function';
}
