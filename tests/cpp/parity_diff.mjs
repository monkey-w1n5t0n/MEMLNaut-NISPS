#!/usr/bin/env node
/**
 * tests/cpp/parity_diff.mjs — float-tolerant blob comparison.
 *
 * Reads two binary blobs in the format produced by parity_check.cpp and
 * parity_wasm.mjs, and reports any pair of floats that differs by more than
 * the allowed tolerance.
 *
 * Usage:
 *   node parity_diff.mjs <native.bin> <wasm.bin> [tolerance]
 *
 * Default tolerance is 1e-5. Returns exit code 0 on match, 1 on mismatch,
 * 2 on file/format error.
 */

import { readFile } from 'node:fs/promises';

const MAGIC   = 0x5450524e;
const VERSION = 5; // v5 adds stage 7 (pipelines + curves)
const DEFAULT_TOL = 1e-5;

// Layout for context in error messages — must match parity_check.cpp / parity_wasm.mjs.
const SECTIONS = [
  { name: 'stage1_outputs',  count: 126 },
  { name: 'weight_probe',    count: 12 },
  { name: 'stage2_outputs',  count: 126 },
  { name: 'final_loss',      count: 1 },
  { name: 'paf_synth_means', count: 2 },
  { name: 'channel_strip_means', count: 2 },
  // Stage 5 (feedback): 126 enter-static + 126 reroll-static + 12 temp-net
  // weight probes + 12 restored-net weight probes.
  { name: 'feedback_randout_enter',  count: 126 },
  { name: 'feedback_randout_reroll', count: 126 },
  { name: 'feedback_randmlp_temp',   count: 12 },
  { name: 'feedback_randmlp_restored', count: 12 },
  // Stage 5d (ExploreAndPlace): 12 scratchpad-net probes (post enter/reroll/
  // nudge) + 126 frozen placed output + 12 restored-net probes + 126 committed
  // output.
  { name: 'feedback_ep_scratch',    count: 12 },
  { name: 'feedback_ep_placed',     count: 126 },
  { name: 'feedback_ep_restored',   count: 12 },
  { name: 'feedback_ep_committed',  count: 126 },
];

async function readBlob(path) {
  const buf = await readFile(path);
  if (buf.length < 12) throw new Error(`${path}: file too short`);
  const magic = buf.readUInt32LE(0);
  if (magic !== MAGIC) {
    throw new Error(`${path}: bad magic 0x${magic.toString(16)}, want 0x${MAGIC.toString(16)}`);
  }
  const version = buf.readUInt32LE(4);
  if (version !== VERSION) {
    throw new Error(`${path}: unsupported version ${version}`);
  }
  const n = buf.readUInt32LE(8);
  const expected = 12 + n * 4;
  if (buf.length < expected) {
    throw new Error(`${path}: truncated, header says ${n} floats but file has ${(buf.length - 12) / 4}`);
  }
  const arr = new Float32Array(n);
  for (let i = 0; i < n; ++i) arr[i] = buf.readFloatLE(12 + i * 4);
  return arr;
}

function locate(idx) {
  let off = 0;
  for (const s of SECTIONS) {
    if (idx < off + s.count) {
      return `${s.name}[${idx - off}]`;
    }
    off += s.count;
  }
  return `payload[${idx}]`;
}

async function main() {
  const [, , nativePath, wasmPath, tolArg] = process.argv;
  if (!nativePath || !wasmPath) {
    console.error('usage: parity_diff.mjs <native.bin> <wasm.bin> [tolerance]');
    process.exit(2);
  }
  const tol = tolArg ? Number(tolArg) : DEFAULT_TOL;
  if (!(tol > 0)) {
    console.error(`bad tolerance: ${tolArg}`);
    process.exit(2);
  }

  let native, wasm;
  try {
    [native, wasm] = await Promise.all([readBlob(nativePath), readBlob(wasmPath)]);
  } catch (err) {
    console.error('[parity_diff]', err.message);
    process.exit(2);
  }

  if (native.length !== wasm.length) {
    console.error(`[parity_diff] length mismatch: native=${native.length}, wasm=${wasm.length}`);
    process.exit(1);
  }

  const mismatches = [];
  let maxDelta = 0;
  let maxDeltaIdx = -1;
  for (let i = 0; i < native.length; ++i) {
    const d = Math.abs(native[i] - wasm[i]);
    if (d > maxDelta) { maxDelta = d; maxDeltaIdx = i; }
    if (d > tol) {
      mismatches.push({ idx: i, native: native[i], wasm: wasm[i], delta: d });
    }
  }

  if (mismatches.length === 0) {
    console.log(`[parity_diff] OK: ${native.length} floats match within ${tol.toExponential()} (max delta ${maxDelta.toExponential()} at ${locate(maxDeltaIdx)})`);
    process.exit(0);
  }

  console.error(`[parity_diff] FAIL: ${mismatches.length}/${native.length} floats differ by more than ${tol.toExponential()}`);
  console.error(`  max delta: ${maxDelta.toExponential()} at ${locate(maxDeltaIdx)}`);
  const head = mismatches.slice(0, 8);
  for (const m of head) {
    console.error(`  ${locate(m.idx).padEnd(28)} native=${m.native.toFixed(8)}  wasm=${m.wasm.toFixed(8)}  delta=${m.delta.toExponential(3)}`);
  }
  if (mismatches.length > head.length) {
    console.error(`  ... and ${mismatches.length - head.length} more`);
  }
  process.exit(1);
}

main();
