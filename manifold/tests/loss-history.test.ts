/**
 * Loss-history C-ABI contract (`bun test`).
 *
 * `nisps_ml_loss_history` is the browser's only honest answer to "is the
 * network learning?" — it hands back the per-iteration curve the C++ core
 * already records (`nisps::ml::MLPCore::loss_history`). Before §6.5e the
 * worker fabricated a ONE-element "history" from the final loss, so the first
 * assertion here is deliberately that the curve is longer than one entry.
 *
 * This test drives the committed `manifold/public/nisps.{js,wasm}` directly,
 * which matters: `scripts/parity-check.sh` only exercises PAFSynth and
 * ChannelStrip from an all-params-0.5 baseline and never touches the training
 * path, so a parity PASS is no evidence for anything asserted below.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, expect, test } from 'bun:test';

interface EmModule {
  HEAPF32: Float32Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  cwrap(name: string, ret: string | null, args: string[]): (...a: number[]) => number;
}
type Factory = (opts: { wasmBinary: Uint8Array }) => Promise<EmModule>;

let M: EmModule;
let mlCreate: (i: number, o: number, h: number, nh: number, seed: number) => number;
let mlDestroy: (ml: number) => number;
let mlAddExample: (ml: number, f: number, l: number) => number;
let mlTrain: (ml: number, lr: number, maxIter: number, minErr: number, sw: number) => number;
let mlLossHistory: (ml: number, out: number, max: number) => number;

beforeAll(async () => {
  // Same glue-loading dance as tests/wasm-load.ts: MODULARIZE output with no ES
  // exports, in a `type:module` sub-package.
  const dir = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(dir, '..', 'public', 'nisps.js'), 'utf8');
  const factory = new Function(
    'module', 'exports',
    `${source}\n;return typeof createNispsModule === 'function' ? createNispsModule : null;`,
  )({ exports: {} }, {}) as Factory | null;
  if (typeof factory !== 'function') throw new Error('createNispsModule not found in glue');
  M = await factory({ wasmBinary: readFileSync(join(dir, '..', 'public', 'nisps.wasm')) });

  mlCreate = M.cwrap('nisps_ml_create', 'number', ['number', 'number', 'number', 'number', 'number']) as typeof mlCreate;
  mlDestroy = M.cwrap('nisps_ml_destroy', null, ['number']) as typeof mlDestroy;
  mlAddExample = M.cwrap('nisps_ml_add_example', null, ['number', 'number', 'number']) as typeof mlAddExample;
  mlTrain = M.cwrap('nisps_ml_train', 'number', ['number', 'number', 'number', 'number', 'number']) as typeof mlTrain;
  mlLossHistory = M.cwrap('nisps_ml_loss_history', 'number', ['number', 'number', 'number']) as typeof mlLossHistory;
});

/** A 2→1 net fed the XOR table; returns the handle (caller destroys). */
function trainedNet(maxIter: number, minErr = 0): { ml: number; loss: number } {
  const ml = mlCreate(2, 1, 0, 0, 7);
  const f = M._malloc(2 * 4);
  const l = M._malloc(1 * 4);
  for (const [x, y, t] of [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]]) {
    new Float32Array(M.HEAPF32.buffer, f, 2).set([x, y]);
    new Float32Array(M.HEAPF32.buffer, l, 1).set([t]);
    mlAddExample(ml, f, l);
  }
  M._free(f);
  M._free(l);
  return { ml, loss: mlTrain(ml, 0.5, maxIter, minErr, 0) };
}

function readHistory(ml: number, cap?: number): number[] {
  const total = mlLossHistory(ml, 0, 0);
  const n = cap ?? total;
  if (n <= 0) return [];
  const ptr = M._malloc(n * 4);
  mlLossHistory(ml, ptr, n);
  const out = Array.from(new Float32Array(M.HEAPF32.buffer, ptr, n));
  M._free(ptr);
  return out;
}

test('an untrained handle reports an empty history', () => {
  const ml = mlCreate(2, 1, 0, 0, 7);
  expect(mlLossHistory(ml, 0, 0)).toBe(0);
  mlDestroy(ml);
});

test('a training run records ONE entry per iteration, not a 1-element fake', () => {
  const { ml, loss } = trainedNet(40);
  const count = mlLossHistory(ml, 0, 0);
  expect(count).toBe(40);
  // The pre-§6.5e worker synthesised `new Float32Array([loss])`.
  expect(count).toBeGreaterThan(1);

  const hist = readHistory(ml);
  expect(hist).toHaveLength(40);
  for (const v of hist) expect(Number.isFinite(v)).toBe(true);
  // The last recorded epoch loss IS what train() returned.
  expect(Math.abs(hist[39]! - loss)).toBeLessThan(1e-6);
  // A real fit descends.
  expect(hist[39]!).toBeLessThan(hist[0]!);
  mlDestroy(ml);
});

test('a truncated read returns the TOTAL count and fills the prefix', () => {
  const { ml } = trainedNet(40);
  const full = readHistory(ml);
  const ptr = M._malloc(5 * 4);
  new Float32Array(M.HEAPF32.buffer, ptr, 5).fill(-1);
  const total = mlLossHistory(ml, ptr, 5);
  const partial = Array.from(new Float32Array(M.HEAPF32.buffer, ptr, 5));
  M._free(ptr);

  expect(total).toBe(40); // total available, not the number written
  expect(partial).toEqual(full.slice(0, 5));
  mlDestroy(ml);
});

test('early convergence truncates the curve to the iterations actually run', () => {
  // An absurd min_err makes train() break after the first iteration.
  const { ml } = trainedNet(50, 1e9);
  expect(mlLossHistory(ml, 0, 0)).toBe(1);
  mlDestroy(ml);
});

test('a fresh run REPLACES the curve rather than appending to it', () => {
  const { ml } = trainedNet(40);
  expect(mlLossHistory(ml, 0, 0)).toBe(40);
  mlTrain(ml, 0.5, 3, 0, 0);
  expect(mlLossHistory(ml, 0, 0)).toBe(3);
  mlDestroy(ml);
});

test('a null handle is safe and reports nothing', () => {
  expect(mlLossHistory(0, 0, 0)).toBe(0);
});
