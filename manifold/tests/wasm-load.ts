/**
 * Load the built nisps WASM module under `bun test` / a Bun script, without a
 * DOM. The Emscripten glue (`manifold/public/nisps.js`) is MODULARIZE output
 * WITHOUT ES exports — it assigns a global `createNispsModule` with only
 * CommonJS/AMD fallbacks. Neither `require()` nor `import()` extracts the
 * factory cleanly (the public/ dir is a `type:module` sub-package), so we read
 * the glue as text and indirect-eval it inside a thin shim that returns the
 * factory — the same technique as tests/cpp/parity_wasm.mjs.
 *
 * Returns a friendly wrapper around the pipeline + curve C ABI used by the
 * golden tests (the ML surface is exercised elsewhere).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface EmModule {
  HEAPF32: Float32Array;
  HEAPU8: Uint8Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  cwrap(name: string, ret: string | null, args: string[]): (...a: number[]) => number;
}
type Factory = (opts: { wasmBinary: Uint8Array }) => Promise<EmModule>;

export interface PipelineWasm {
  module: EmModule;
  pipelineCreate(): number;
  pipelineDestroy(p: number): void;
  inputSetConfig(p: number, cfg: ArrayLike<number>): void;
  /** Returns { x, y, frozen }. */
  inputProcess(p: number, x: number, y: number, dtSeconds: number): { x: number; y: number; frozen: boolean };
  inputReset(p: number): void;
  outputSetConfig(p: number, globalCurve: number, smoothing: number, slewRate: number, freeze: boolean): void;
  outputSetFreezeMask(p: number, mask: Uint8Array | null): void;
  /** Process `vec` in place (first vec.length floats). */
  outputProcess(p: number, vec: Float32Array, dtSeconds: number): void;
  outputReset(p: number): void;
  curveApply(id: number, x: number, param?: number): number;
}

let cached: PipelineWasm | null = null;

export async function loadPipelineWasm(): Promise<PipelineWasm> {
  if (cached) return cached;
  const dir = dirname(fileURLToPath(import.meta.url));
  const gluePath = join(dir, '..', 'public', 'nisps.js');
  const wasmPath = join(dir, '..', 'public', 'nisps.wasm');
  const source = readFileSync(gluePath, 'utf8');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'module', 'exports',
    `${source}\n;return typeof createNispsModule === 'function' ? createNispsModule : null;`,
  )({ exports: {} }, {}) as Factory | null;
  if (typeof factory !== 'function') throw new Error('[wasm-load] createNispsModule not found in glue');
  const wasmBinary = readFileSync(wasmPath);
  const M = await factory({ wasmBinary });

  const cPipelineCreate = M.cwrap('nisps_pipeline_create', 'number', []);
  const cPipelineDestroy = M.cwrap('nisps_pipeline_destroy', null, ['number']);
  const cInputSetConfig = M.cwrap('nisps_input_set_config', null, ['number', 'number', 'number']);
  const cInputProcess = M.cwrap('nisps_input_process', 'number', ['number', 'number', 'number', 'number', 'number']);
  const cInputReset = M.cwrap('nisps_input_reset', null, ['number']);
  const cOutputSetConfig = M.cwrap('nisps_output_set_config', null, ['number', 'number', 'number', 'number', 'number']);
  const cOutputSetFreezeMask = M.cwrap('nisps_output_set_freeze_mask', null, ['number', 'number', 'number']);
  const cOutputProcess = M.cwrap('nisps_output_process', null, ['number', 'number', 'number', 'number']);
  const cOutputReset = M.cwrap('nisps_output_reset', null, ['number']);
  const cCurveApply = M.cwrap('nisps_curve_apply', 'number', ['number', 'number', 'number']);

  // Reusable scratch buffers (sized to the fixtures' needs).
  const cfgPtr = M._malloc(15 * 4);
  const xyPtr = M._malloc(2 * 4);
  const OUT_CAP = 64;
  const outPtr = M._malloc(OUT_CAP * 4);
  const maskPtr = M._malloc(OUT_CAP);

  cached = {
    module: M,
    pipelineCreate: () => cPipelineCreate(),
    pipelineDestroy: (p) => cPipelineDestroy(p),
    inputSetConfig(p, cfg) {
      const v = new Float32Array(M.HEAPF32.buffer, cfgPtr, 15);
      for (let i = 0; i < 15; i++) v[i] = cfg[i] ?? 0;
      cInputSetConfig(p, cfgPtr, 15);
    },
    inputProcess(p, x, y, dtSeconds) {
      const frozen = cInputProcess(p, x, y, dtSeconds, xyPtr);
      const v = new Float32Array(M.HEAPF32.buffer, xyPtr, 2);
      return { x: v[0]!, y: v[1]!, frozen: frozen === 1 };
    },
    inputReset: (p) => cInputReset(p),
    outputSetConfig(p, globalCurve, smoothing, slewRate, freeze) {
      const slew = Number.isFinite(slewRate) ? slewRate : 0;
      cOutputSetConfig(p, globalCurve, smoothing, slew, freeze ? 1 : 0);
    },
    outputSetFreezeMask(p, mask) {
      if (!mask || mask.length === 0) { cOutputSetFreezeMask(p, 0, 0); return; }
      const n = Math.min(mask.length, OUT_CAP);
      new Uint8Array(M.HEAPU8.buffer, maskPtr, n).set(mask.subarray(0, n));
      cOutputSetFreezeMask(p, maskPtr, n);
    },
    outputProcess(p, vec, dtSeconds) {
      const n = Math.min(vec.length, OUT_CAP);
      new Float32Array(M.HEAPF32.buffer, outPtr, n).set(vec.subarray(0, n));
      cOutputProcess(p, outPtr, n, dtSeconds);
      vec.set(new Float32Array(M.HEAPF32.buffer, outPtr, n).subarray(0, n));
    },
    outputReset: (p) => cOutputReset(p),
    curveApply: (id, x, param = 0) => cCurveApply(id, x, param),
  };
  return cached;
}
