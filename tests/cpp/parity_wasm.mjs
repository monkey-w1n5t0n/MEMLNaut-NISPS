#!/usr/bin/env node
/**
 * tests/cpp/parity_wasm.mjs — runs the same fixed-seed sequence as
 * parity_check.cpp against the WASM build of nisps and writes a binary blob
 * with identical layout. The shell wrapper compares the two blobs.
 *
 * The WASM module is loaded from manifold/public/nisps.{js,wasm} —
 * scripts/build-wasm.sh must have run first.
 *
 * Output blob format matches parity_check.cpp:
 *   uint32 magic = 'NPRT'
 *   uint32 version = 1
 *   uint32 n_floats
 *   float32[n_floats] payload
 *
 * Payload order:
 *   126 outputs (stage 1: post-process at (0.25, 0.75))
 *    12 weights (probed at fixed indices)
 *   126 outputs (stage 2: post-train, re-process)
 *     1 final training loss
 *     2 PAFSynth L+R means (silence input, 128 samples)
 *     2 ChannelStrip L+R means (0.25 input, 128 samples)
 *
 * Exit codes:
 *   0 success
 *   2 wasm load failure
 *   3 file write failure
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const repoRoot   = resolve(__dirname, '..', '..');

const MAGIC   = 0x5450524e; // 'NPRT'
const VERSION = 3; // v3 adds stage 5d (ExploreAndPlace lifecycle)

const SEED         = 42 >>> 0;
const INPUT_X      = 0.25;
const INPUT_Y      = 0.75;
const SAMPLE_RATE  = 48000;
const SYNTH_FRAMES = 128;
const PROBE_IDX    = [0, 5, 19, 31, 73, 137, 251, 491, 999, 1583, 2401, 3289];

async function loadWasm() {
  const wasmGluePath = resolve(repoRoot, 'manifold', 'public', 'nisps.js');
  try {
    await access(wasmGluePath, fsConstants.R_OK);
  } catch {
    console.error(`[parity_wasm] missing ${wasmGluePath}`);
    console.error(`[parity_wasm] run scripts/build-wasm.sh first`);
    process.exit(2);
  }
  // The Emscripten glue is generated with MODULARIZE=1, which writes
  //   var createNispsModule = (() => ...)();
  //   if (typeof exports==='object' && typeof module==='object') module.exports = ...;
  // It lives in manifold/public/, which is a sub-package with
  // "type":"module" in its parent package.json — so neither `require()` nor
  // `import()` can extract the factory cleanly. We work around this by
  // reading the file as text and evaluating it inside a thin shim that
  // returns `createNispsModule`.
  const source = await readFile(wasmGluePath, 'utf8');
  // The shim wraps the glue in a function and exposes the symbol it sets.
  // Indirect-eval keeps things at module scope so `var` declarations don't
  // pollute the host process.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'module', 'exports',
    `${source}\n;return typeof createNispsModule === 'function' ? createNispsModule : null;`
  )({ exports: {} }, {});
  if (typeof factory !== 'function') {
    console.error('[parity_wasm] could not locate createNispsModule in glue');
    process.exit(2);
  }
  const wasmBinaryPath = resolve(repoRoot, 'manifold', 'public', 'nisps.wasm');
  const wasmBinary = await readFile(wasmBinaryPath);
  const Module = await factory({ wasmBinary });
  return Module;
}

/**
 * Wrap the C ABI as friendly JS calls.
 */
function bind(Module) {
  const cwrap = Module.cwrap;
  return {
    create:   cwrap('nisps_ml_create',   'number', ['number','number','number','number','number']),
    destroy:  cwrap('nisps_ml_destroy',  null,     ['number']),
    setInput: cwrap('nisps_ml_set_input', null,    ['number','number','number']),
    process:  cwrap('nisps_ml_process',  null,     ['number']),
    outputsPtr: cwrap('nisps_ml_outputs','number', ['number']),
    inferBatch: cwrap('nisps_ml_infer_batch', null, ['number','number','number','number']),
    addExample: cwrap('nisps_ml_add_example', null, ['number','number','number']),
    train: cwrap('nisps_ml_train', 'number', ['number','number','number','number','number']),
    weightCount: cwrap('nisps_ml_weight_count', 'number', ['number']),
    getWeights:  cwrap('nisps_ml_get_weights',  null,     ['number','number']),
    drawWeights: cwrap('nisps_ml_draw_weights', null,     ['number','number']),
    moveWeights: cwrap('nisps_ml_move_weights', null,     ['number','number','number','number']),
    feedbackSetMode:      cwrap('nisps_ml_feedback_set_mode',      null,     ['number','number']),
    feedbackDown:         cwrap('nisps_ml_feedback_down',          'number', ['number','number','number','number','number']),
    feedbackUp:           cwrap('nisps_ml_feedback_up',            'number', ['number']),
    feedbackStaticOutput: cwrap('nisps_ml_feedback_static_output', 'number', ['number','number']),
    feedbackEnterExplore: cwrap('nisps_ml_feedback_enter_explore', null,     ['number','number']),
    feedbackReroll:       cwrap('nisps_ml_feedback_reroll',        null,     ['number','number']),
    feedbackNudge:        cwrap('nisps_ml_feedback_nudge',         null,     ['number','number']),
    feedbackUndo:         cwrap('nisps_ml_feedback_undo',          null,     ['number']),
    feedbackLike:         cwrap('nisps_ml_feedback_like',          null,     ['number']),
    feedbackCommitPlace:  cwrap('nisps_ml_feedback_commit_place',  null,     ['number']),
    feedbackPlacedOutput: cwrap('nisps_ml_feedback_placed_output', 'number', ['number','number']),
    describe:    cwrap('nisps_ml_describe',     null,     ['number']),

    engineCreate:    cwrap('nisps_engine_create', 'number', ['string','number']),
    engineDestroy:   cwrap('nisps_engine_destroy', null, ['number']),
    engineSetParams: cwrap('nisps_engine_set_params', null, ['number','number','number']),
    engineProcessBlock: cwrap('nisps_engine_process_block', null,
                              ['number','number','number','number','number','number']),
    malloc: Module._malloc,
    free:   Module._free,
    HEAPF32: Module.HEAPF32,
  };
}

function getOutputsCopy(api, mlPtr, nOut) {
  const ptr = api.outputsPtr(mlPtr);
  // outputs are float32 starting at ptr, length nOut.
  const start = ptr / 4;
  return new Float32Array(api.HEAPF32.buffer, ptr, nOut).slice();
}

function getWeightsCopy(api, mlPtr) {
  const n = api.weightCount(mlPtr);
  const buf = api.malloc(n * 4);
  api.getWeights(mlPtr, buf);
  const out = new Float32Array(api.HEAPF32.buffer, buf, n).slice();
  api.free(buf);
  return out;
}

function runEngine(api, engineId, paramCount, inputAmp, frames) {
  const e = api.engineCreate(engineId, SAMPLE_RATE);
  if (!e) throw new Error(`engineCreate(${engineId}) returned 0`);

  const paramsBuf = api.malloc(paramCount * 4);
  const params = new Float32Array(api.HEAPF32.buffer, paramsBuf, paramCount);
  params.fill(0.5);
  api.engineSetParams(e, paramsBuf, paramCount);

  // Allocate input/output buffers. We process one sample at a time to mirror
  // the native test exactly (which calls process(s) per sample).
  const inLBuf = api.malloc(4);
  const inRBuf = api.malloc(4);
  const outLBuf = api.malloc(4);
  const outRBuf = api.malloc(4);
  const inL = new Float32Array(api.HEAPF32.buffer, inLBuf, 1);
  const inR = new Float32Array(api.HEAPF32.buffer, inRBuf, 1);
  const outL = new Float32Array(api.HEAPF32.buffer, outLBuf, 1);
  const outR = new Float32Array(api.HEAPF32.buffer, outRBuf, 1);

  let lAcc = 0;
  let rAcc = 0;
  for (let i = 0; i < frames; ++i) {
    inL[0] = inputAmp;
    inR[0] = inputAmp;
    api.engineProcessBlock(e, inLBuf, inRBuf, outLBuf, outRBuf, 1);
    lAcc += outL[0];
    rAcc += outR[0];
  }

  api.free(paramsBuf);
  api.free(inLBuf);
  api.free(inRBuf);
  api.free(outLBuf);
  api.free(outRBuf);
  api.engineDestroy(e);

  return [lAcc / frames, rAcc / frames];
}

async function main() {
  const outPath = process.argv[2] ?? 'parity_wasm.bin';
  const Module = await loadWasm();
  const api = bind(Module);

  // Verify dimensions match the native side.
  const dimsBuf = api.malloc(6 * 4);
  api.describe(dimsBuf);
  const dims = new Int32Array(Module.HEAP32.buffer, dimsBuf, 6).slice();
  api.free(dimsBuf);
  // Expect: [32, 10, 14, 18, 126, 4]  (32-input max for mix-and-match)
  const expectedDims = [32, 10, 14, 18, 126, 4];
  for (let i = 0; i < expectedDims.length; ++i) {
    if (dims[i] !== expectedDims[i]) {
      console.error(`[parity_wasm] WASM build has dim[${i}]=${dims[i]}, native expected ${expectedDims[i]}`);
      console.error(`[parity_wasm] WASM dims:`, Array.from(dims));
      process.exit(2);
    }
  }
  const N_IN = dims[0];
  const N_OUT = dims[4];

  // --- Stage 1: ML inference ---
  const ml = api.create(N_IN, N_OUT, 0, 0, SEED);
  api.drawWeights(ml, 0.5);
  api.setInput(ml, 0, INPUT_X);
  api.setInput(ml, 1, INPUT_Y);
  api.process(ml);
  const outsStage1 = getOutputsCopy(api, ml, N_OUT);

  // Weight probe.
  const weights = getWeightsCopy(api, ml);
  const probeValues = PROBE_IDX.map((idx) => idx < weights.length ? weights[idx] : 0);

  // --- Stage 2: training ---
  const features = [
    [0.1, 0.9],
    [0.5, 0.5],
    [0.9, 0.1],
  ];
  const labelFor = (i) => {
    const out = new Float32Array(N_OUT);
    const a = i * 0.3 + 0.05;
    for (let j = 0; j < N_OUT; ++j) out[j] = a + 0.005 * j;
    return out;
  };
  // Feature buffer is NIn-wide (zero-padded): two real axes + unused slots at 0,
  // matching the native side and the front-end's mix-and-match input shape.
  const featBuf = api.malloc(N_IN * 4);
  const featF32 = new Float32Array(api.HEAPF32.buffer, featBuf, N_IN);
  const labelBuf = api.malloc(N_OUT * 4);
  for (let i = 0; i < features.length; ++i) {
    featF32.fill(0);
    featF32[0] = features[i][0];
    featF32[1] = features[i][1];
    const label = labelFor(i);
    new Float32Array(api.HEAPF32.buffer, labelBuf, N_OUT).set(label);
    api.addExample(ml, featBuf, labelBuf);
  }
  api.free(featBuf);
  api.free(labelBuf);

  const finalLoss = api.train(ml, 0.3, 50, 0.0, 0 /* null sample_weights */);

  api.setInput(ml, 0, INPUT_X);
  api.setInput(ml, 1, INPUT_Y);
  api.process(ml);
  const outsStage2 = getOutputsCopy(api, ml, N_OUT);

  // (ml stays alive through stage 5 below; destroyed after the feedback stage.)

  // --- Stage 3: PAFSynth ---
  // PAFSynth has 33 params per param_count() in nisps/engines/paf_synth.hpp.
  const [pafL, pafR] = runEngine(api, 'paf_synth', 33, 0.0, SYNTH_FRAMES);

  // --- Stage 4: ChannelStrip (24 params) ---
  const [csL, csR] = runEngine(api, 'channel_strip', 24, 0.25, SYNTH_FRAMES);

  // --- Stage 5: feedback ("Down Action": RandomiseOutputs + RandomiseMlp) ---
  // Mirrors parity_check.cpp stage 5. The controller is seeded inside the WASM
  // MLHandle as (seed XOR salt), matching the native side. ml is untouched by
  // stages 3-4, so its RNG state here equals post-stage-2.
  const FB_RANDOUT = 1;
  const FB_RANDMLP = 2;
  const feedbackFloats = [];
  const fbBuf = api.malloc(N_OUT * 4);
  api.feedbackSetMode(ml, FB_RANDOUT);
  api.feedbackDown(ml, 0, 0.1, 0.5, 0);  // enter
  api.feedbackStaticOutput(ml, fbBuf);
  for (const v of new Float32Array(api.HEAPF32.buffer, fbBuf, N_OUT)) feedbackFloats.push(v);
  api.feedbackDown(ml, 0, 0.1, 0.5, 0);  // re-roll
  api.feedbackStaticOutput(ml, fbBuf);
  for (const v of new Float32Array(api.HEAPF32.buffer, fbBuf, N_OUT)) feedbackFloats.push(v);
  api.free(fbBuf);
  api.feedbackUp(ml);                    // commit (no weight change)

  api.feedbackSetMode(ml, FB_RANDMLP);
  api.feedbackDown(ml, 0, 0.1, 0.5, 0);  // enter → randomise temp net
  {
    const tempW = getWeightsCopy(api, ml);
    for (const idx of PROBE_IDX) feedbackFloats.push(idx < tempW.length ? tempW[idx] : 0);
  }
  api.feedbackUp(ml);                    // commit → restore original net
  {
    const restoredW = getWeightsCopy(api, ml);
    for (const idx of PROBE_IDX) feedbackFloats.push(idx < restoredW.length ? restoredW[idx] : 0);
  }

  // --- Stage 5d: ExploreAndPlace lifecycle ---
  // Reuses the single MLHandle.feedback controller (mode → ExploreAndPlace) so
  // its RNG state matches native `fb` (both drained identical RandomiseOutputs
  // draws). enter → reroll → nudge → undo → place → commit.
  const FB_EXPLORE_PLACE = 3;
  api.feedbackSetMode(ml, FB_EXPLORE_PLACE);
  api.feedbackEnterExplore(ml, 0.5);     // snapshot + randomise scratchpad
  api.feedbackReroll(ml, 0.5);           // scratchpad op
  api.feedbackNudge(ml, 0.05);           // controller-Rng perturb
  {
    const scratchW = getWeightsCopy(api, ml);
    for (const idx of PROBE_IDX) feedbackFloats.push(idx < scratchW.length ? scratchW[idx] : 0);
  }
  api.feedbackUndo(ml);                  // pop nudge
  api.setInput(ml, 0, INPUT_X);
  api.setInput(ml, 1, INPUT_Y);
  api.process(ml);
  api.feedbackLike(ml);                  // begin place: freeze scratchpad output
  {
    const placedBuf = api.malloc(N_OUT * 4);
    api.feedbackPlacedOutput(ml, placedBuf);
    for (const v of new Float32Array(api.HEAPF32.buffer, placedBuf, N_OUT)) feedbackFloats.push(v);
    api.free(placedBuf);
  }
  api.feedbackCommitPlace(ml);           // restore real net
  {
    const restoredW = getWeightsCopy(api, ml);
    for (const idx of PROBE_IDX) feedbackFloats.push(idx < restoredW.length ? restoredW[idx] : 0);
    const committedBuf = api.malloc(N_OUT * 4);
    api.feedbackPlacedOutput(ml, committedBuf);
    for (const v of new Float32Array(api.HEAPF32.buffer, committedBuf, N_OUT)) feedbackFloats.push(v);
    api.free(committedBuf);
  }

  api.destroy(ml);

  // --- Build payload, write blob ---
  const payload = [];
  for (const v of outsStage1)  payload.push(v);
  for (const v of probeValues) payload.push(v);
  for (const v of outsStage2)  payload.push(v);
  payload.push(finalLoss);
  payload.push(pafL, pafR);
  payload.push(csL,  csR);
  for (const v of feedbackFloats) payload.push(v);

  // Sanity: all finite.
  for (let i = 0; i < payload.length; ++i) {
    if (!Number.isFinite(payload[i])) {
      console.error(`[parity_wasm] non-finite value at offset ${i}: ${payload[i]}`);
      process.exit(2);
    }
  }

  const buf = Buffer.alloc(12 + payload.length * 4);
  buf.writeUInt32LE(MAGIC,   0);
  buf.writeUInt32LE(VERSION, 4);
  buf.writeUInt32LE(payload.length, 8);
  for (let i = 0; i < payload.length; ++i) {
    buf.writeFloatLE(payload[i], 12 + i * 4);
  }

  await writeFile(outPath, buf);
  console.log(`[parity_wasm] wrote ${payload.length} floats to ${outPath}`);
}

main().catch((err) => {
  console.error('[parity_wasm] error:', err);
  process.exit(3);
});
