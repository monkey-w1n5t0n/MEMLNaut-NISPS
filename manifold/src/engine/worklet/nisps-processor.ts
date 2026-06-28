/**
 * AudioWorkletProcessor that runs `nisps.wasm` engines.
 *
 * Why a separate WASM instance from the main thread? AudioWorklet runs in
 * its own thread + global scope; reusing a single instance would require
 * SharedArrayBuffer + locking on the heap. Architecture.md §6.4 specifies
 * separate instances connected by `port` messages instead.
 *
 * Wasm load path: AudioWorklet has NO `fetch` and NO ESM `import`. The
 * main thread fetches `nisps.wasm` once and posts the bytes here as an
 * ArrayBuffer; we then `WebAssembly.compile` and `instantiate` directly,
 * skipping the Emscripten glue entirely. This is fine because the
 * exported functions don't need any of the JS-side runtime.
 *
 * Block size: AudioWorklet ALWAYS calls process() with 128-sample blocks.
 * We allocate 128-sample input and output buffers in the WASM linear
 * memory and shuttle samples in/out per call.
 */

/// <reference path="./audioworklet-globals.d.ts" />

import type { EngineId } from '../types';
import type { HostToWorkletMessage, WorkletToHostMessage } from '../engine-host';

const PROC_BLOCK = 128;
const MAX_PARAMS = 256; // upper bound across all engines

interface WasmInstance {
  exports: {
    memory: WebAssembly.Memory;
    malloc: (n: number) => number;
    free: (p: number) => void;
    _nisps_engine_create: (id_ptr: number, sample_rate: number) => number;
    _nisps_engine_destroy: (engine: number) => void;
    _nisps_engine_set_params: (engine: number, params_ptr: number, n: number) => void;
    _nisps_engine_process_block: (
      engine: number,
      in_l: number, in_r: number,
      out_l: number, out_r: number,
      n_samples: number,
    ) => void;
  };
}

class NispsProcessor extends AudioWorkletProcessor {
  private instance: WasmInstance | null = null;
  private engineHandle = 0;
  private engineId: EngineId = 'thru';
  private muted = true;

  // Pointers + buffer views (allocated once instance is up).
  private inLPtr = 0;
  private inRPtr = 0;
  private outLPtr = 0;
  private outRPtr = 0;
  private idPtr = 0;
  private paramsPtr = 0;
  private inLView: Float32Array | null = null;
  private inRView: Float32Array | null = null;
  private outLView: Float32Array | null = null;
  private outRView: Float32Array | null = null;
  private paramsView: Float32Array | null = null;
  private idView: Uint8Array | null = null;
  private mem: WebAssembly.Memory | null = null;

  // Pending params posted before the engine was ready.
  private pendingParams: Float32Array | null = null;

  constructor() {
    super();
    this.port.onmessage = (ev) => this.onMessage_(ev.data as HostToWorkletMessage);
  }

  private async onMessage_(msg: HostToWorkletMessage): Promise<void> {
    if (msg.kind === 'init') {
      try {
        await this.init_(msg.wasmBinary, msg.sampleRate);
        this.post_({ kind: 'ready' });
      } catch (err) {
        this.post_({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (msg.kind === 'engine') {
      this.switchEngine_(msg.engineId);
    } else if (msg.kind === 'params') {
      this.applyParams_(msg.params);
    } else if (msg.kind === 'mute') {
      this.muted = msg.muted;
    }
  }

  private post_(msg: WorkletToHostMessage): void {
    this.port.postMessage(msg);
  }

  /**
   * Compile + instantiate the wasm module. We provide minimal imports —
   * the Emscripten module needs `__abort_js` and `_emscripten_resize_heap`
   * (we keep memory non-resizing so the latter is a stub).
   */
  private async init_(bytes: ArrayBuffer, sampleRate: number): Promise<void> {
    const memory = new WebAssembly.Memory({ initial: 128, maximum: 4096, shared: false });
    const imports: WebAssembly.Imports = {
      // Emscripten import "a" group; field names match the generated JS.
      a: {
        a: () => { throw new Error('wasm aborted'); },
        b: () => false, // _emscripten_resize_heap returning 0 disables growth
      },
    };

    const compiled = await WebAssembly.compile(bytes);
    // Discover the actual import shape from the module — names like "a",
    // "b" depend on emcc's mangling; we accept whatever it produces.
    const importDesc = WebAssembly.Module.imports(compiled);
    const reshaped: WebAssembly.Imports = {};
    for (const desc of importDesc) {
      if (!reshaped[desc.module]) reshaped[desc.module] = {} as WebAssembly.ModuleImports;
      const mod = reshaped[desc.module] as WebAssembly.ModuleImports;
      if (desc.kind === 'function') {
        if (desc.name === 'c') {
          // unused
        }
        mod[desc.name] = (() => {
          // Generic stub: log + return 0.
          return (..._args: unknown[]) => 0;
        })();
      } else if (desc.kind === 'memory') {
        mod[desc.name] = memory;
      } else if (desc.kind === 'table') {
        mod[desc.name] = new WebAssembly.Table({ element: 'anyfunc', initial: 0 });
      } else if (desc.kind === 'global') {
        mod[desc.name] = new WebAssembly.Global({ value: 'i32', mutable: true }, 0);
      }
    }
    // For known-needed Emscripten imports, supply real implementations.
    for (const desc of importDesc) {
      const mod = reshaped[desc.module] as WebAssembly.ModuleImports;
      // __abort_js
      if (desc.name === 'a' && desc.kind === 'function') {
        mod[desc.name] = () => { throw new Error('wasm aborted'); };
      }
      // _emscripten_resize_heap
      if (desc.name === 'b' && desc.kind === 'function') {
        mod[desc.name] = (_size: number) => 0; // refuse growth in worklet
      }
    }

    void imports; // silence unused
    const wasmInst = await WebAssembly.instantiate(compiled, reshaped);

    // Many Emscripten exports use single-letter mangled names. Discover
    // by reading the export descriptors.
    const exDesc = WebAssembly.Module.exports(compiled);
    const exMap = new Map<string, string>(); // logical name → mangled
    for (const e of exDesc) {
      // The exports list includes both the original (with leading
      // underscore for C funcs) and the mangled single-letter alias used
      // in the import section. We only see the export side here, but
      // Emscripten in modern versions also re-exports the C names with
      // their leading-underscore form. Walk both.
      exMap.set(e.name, e.name);
    }
    const exports = wasmInst.exports as Record<string, WebAssembly.ExportValue>;

    function pickFn(...names: string[]): (...args: number[]) => number {
      for (const n of names) {
        const v = exports[n];
        if (typeof v === 'function') return v as unknown as (...a: number[]) => number;
      }
      throw new Error(`worklet: missing wasm export, tried: ${names.join(', ')}`);
    }
    function pickFnVoid(...names: string[]): (...args: number[]) => void {
      return pickFn(...names) as unknown as (...args: number[]) => void;
    }

    // The exports we need.
    const malloc = pickFn('_malloc', 'malloc');
    const free = pickFnVoid('_free', 'free');
    const ec = pickFn('_nisps_engine_create');
    const ed = pickFnVoid('_nisps_engine_destroy');
    const esp = pickFnVoid('_nisps_engine_set_params');
    const epb = pickFnVoid('_nisps_engine_process_block');

    // The wasm-exported memory might be named `memory` or another mangled
    // alias. Find it.
    let wasmMemory: WebAssembly.Memory | null = null;
    for (const e of exDesc) {
      if (e.kind === 'memory') {
        const v = exports[e.name];
        if (v instanceof WebAssembly.Memory) { wasmMemory = v; break; }
      }
    }
    // If the module imports memory (which our build does — we passed it),
    // there will be no exported memory; use the imported one.
    this.mem = wasmMemory ?? memory;

    this.instance = {
      exports: {
        memory: this.mem,
        malloc,
        free,
        _nisps_engine_create: (id, sr) => ec(id, sr),
        _nisps_engine_destroy: (h) => ed(h),
        _nisps_engine_set_params: (h, p, n) => esp(h, p, n),
        _nisps_engine_process_block: (h, il, ir, ol, or_, n) => epb(h, il, ir, ol, or_, n),
      },
    };

    // Allocate buffers.
    this.inLPtr = malloc(PROC_BLOCK * 4);
    this.inRPtr = malloc(PROC_BLOCK * 4);
    this.outLPtr = malloc(PROC_BLOCK * 4);
    this.outRPtr = malloc(PROC_BLOCK * 4);
    this.paramsPtr = malloc(MAX_PARAMS * 4);
    // Engine ids are short ASCII; 32 bytes covers everything we have.
    this.idPtr = malloc(32);

    const buf = this.mem.buffer;
    this.inLView = new Float32Array(buf, this.inLPtr, PROC_BLOCK);
    this.inRView = new Float32Array(buf, this.inRPtr, PROC_BLOCK);
    this.outLView = new Float32Array(buf, this.outLPtr, PROC_BLOCK);
    this.outRView = new Float32Array(buf, this.outRPtr, PROC_BLOCK);
    this.paramsView = new Float32Array(buf, this.paramsPtr, MAX_PARAMS);
    this.idView = new Uint8Array(buf, this.idPtr, 32);

    // Default engine: thru.
    this.spawnEngine_('thru', sampleRate);

    // Apply pending params if any arrived before init completed.
    if (this.pendingParams) {
      this.applyParams_(this.pendingParams);
      this.pendingParams = null;
    }

    this.muted = false;
  }

  private spawnEngine_(id: EngineId, sampleRate: number): void {
    if (!this.instance || !this.idView) return;
    if (this.engineHandle) {
      this.instance.exports._nisps_engine_destroy(this.engineHandle);
      this.engineHandle = 0;
    }
    // Write engine_id as ASCII into idView, NUL-terminated.
    const enc = new TextEncoder();
    const bytes = enc.encode(id);
    this.idView.fill(0);
    this.idView.set(bytes.subarray(0, Math.min(bytes.length, 31)));
    this.engineHandle = this.instance.exports._nisps_engine_create(this.idPtr, sampleRate);
    this.engineId = id;
  }

  private switchEngine_(id: EngineId): void {
    // sampleRate global from AudioWorkletGlobalScope.
    this.spawnEngine_(id, sampleRate);
  }

  private applyParams_(params: Float32Array): void {
    if (!this.instance || !this.paramsView) {
      this.pendingParams = params;
      return;
    }
    const n = Math.min(params.length, MAX_PARAMS);
    for (let i = 0; i < n; ++i) this.paramsView[i] = params[i];
    if (this.engineHandle) {
      this.instance.exports._nisps_engine_set_params(this.engineHandle, this.paramsPtr, n);
    }
  }

  override process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;

    const outL = out[0];
    const outR = out.length > 1 ? out[1] : out[0];

    if (this.muted || !this.instance || !this.engineHandle ||
        !this.inLView || !this.outLView || !this.outRView || !this.inRView) {
      // Silence.
      outL.fill(0);
      if (out.length > 1) outR.fill(0);
      return true;
    }

    // Copy inputs into wasm buffers (zero-fill if missing).
    const inp = inputs[0];
    if (inp && inp[0]) this.inLView.set(inp[0].subarray(0, PROC_BLOCK));
    else this.inLView.fill(0);
    if (inp && inp[1]) this.inRView.set(inp[1].subarray(0, PROC_BLOCK));
    else if (inp && inp[0]) this.inRView.set(inp[0].subarray(0, PROC_BLOCK));
    else this.inRView.fill(0);

    this.instance.exports._nisps_engine_process_block(
      this.engineHandle,
      this.inLPtr, this.inRPtr,
      this.outLPtr, this.outRPtr,
      PROC_BLOCK,
    );

    outL.set(this.outLView.subarray(0, outL.length));
    if (out.length > 1) outR.set(this.outRView.subarray(0, outR.length));

    return true;
  }
}

registerProcessor('nisps-processor', NispsProcessor);
