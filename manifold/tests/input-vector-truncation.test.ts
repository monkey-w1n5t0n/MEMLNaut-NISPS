/**
 * S10 regression (simplification audit): VCV bridged mode must drive the
 * module with the FULL raw input vector, not just the first two axes.
 *
 * Two independent halves of the bug, tested separately:
 *  (a) `Spine.lastRawInputs` — the buffer `EngineApi.inputVector()` now
 *      delegates to directly — must hold every active axis, not just X/Y.
 *      Before the fix this field was PRIVATE (`private lastRawInputs`) and
 *      `EngineApi.inputVector()` returned a fresh `[lastRawX, lastRawY]`
 *      2-element array, so this test would not even have compiled — a
 *      stronger signal than a runtime failure. (`EngineApi` itself needs a
 *      real loaded WASM module to construct, which this suite avoids per the
 *      existing convention in tests/pipeline-golden.test.ts / wasm-load.ts —
 *      "the ML surface is exercised elsewhere" — so this drives Spine
 *      directly with a minimal fake `WasmIML`, which is exactly the surface
 *      `EngineApi.inputVector()` now just forwards.)
 *  (b) `VcvBackend.send()` must dead-zone over the FULL vector, not just
 *      indices 0/1 — otherwise a change on axis 2+ (a gamepad stick or a
 *      learned MIDI CC beyond the XY pair) is silently swallowed even once
 *      `setInputVector` receives it.
 *
 * Run with `bun test tests/input-vector-truncation.test.ts` (see the NOTE at
 * the bottom of tests/backend-manager-switch.test.ts re: `bun run test`
 * wiring — the same applies here).
 */
import { expect, test } from 'bun:test';
import { Spine } from '../src/engine/spine';
import type { WasmIML } from '../src/engine/wasm-iml';
import { VcvBackend } from '../src/backends/vcv-backend';
import type { BackendContext, OutputMapping } from '../src/backends/backend';

// ---- (a) Spine.lastRawInputs -------------------------------------------

/** Minimal fake satisfying exactly the WasmIML surface `Spine` calls (see
 *  spine.ts: attach/setInputs/reprocess). No real inference — just plumbing,
 *  so this stays independent of the actual WASM build. */
function makeFakeIml(outputSize = 8): WasmIML {
  return {
    architecture: { inputSize: 2, hidden: [0, 0, 0] as [number, number, number], outputSize, numLayers: 3 },
    setInputConfig: () => {},
    setOutputConfig: () => {},
    setOutputFreezeMask: () => {},
    resetInput: () => {},
    resetOutput: () => {},
    processInput: (x: number, y: number) => ({ x, y, frozen: false }),
    setInput: () => {},
    processInto: (buf: Float32Array) => buf.fill(0),
    processOutput: () => {},
  } as unknown as WasmIML;
}

test('Spine.lastRawInputs retains the FULL N-D raw input vector, not just X/Y', () => {
  const spine = new Spine();
  spine.attach(makeFakeIml(), null);
  spine.setState({ inputSize: 5 });
  spine.setInputs([0.1, 0.2, 0.3, 0.4, 0.5]);

  // Compare through Float32Array on both sides — `lastRawInputs` is f32, so a
  // plain f64 literal array would spuriously mismatch on rounding (e.g. 0.1 →
  // 0.10000000149011612), not on the axis-count truncation this test targets.
  expect(Array.from(spine.lastRawInputs)).toEqual(
    Array.from(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5])),
  );
  // The old 2-D extraction (`[lastRawX, lastRawY]`) is still available for
  // the 2-D pad path, but must not be what a 5-D-aware consumer reads.
  expect(spine.lastRawInputs.length).toBeGreaterThan(2);
});

// ---- (b) VcvBackend full-length dead-zone -------------------------------

function liveMapping(): OutputMapping {
  return { state: 'live', muted: false, min: 0, max: 1, curve: 0.5, fixedValue: 0 };
}

function makeCtx(outputCount: number): BackendContext {
  return {
    modeId: 'test',
    outputCount,
    mappings: Array.from({ length: outputCount }, liveMapping),
    names: Array.from({ length: outputCount }, (_, i) => `out${i}`),
  };
}

/** Swap in a fake transport so `send()` runs without a real WebSocket. */
function fakeClient() {
  const sentInputs: number[][] = [];
  return { connected: true, sendInput: (v: ReadonlyArray<number>) => sentInputs.push(Array.from(v)), sendParams: () => {}, sentInputs };
}

/** Push `send()`'s internal 50ms send-interval timer far into the past so the
 *  throttle never blocks a test call regardless of how early in the process
 *  lifetime `performance.now()` currently reads. */
function unthrottle(vcv: VcvBackend): void {
  (vcv as unknown as { lastSendMs: number }).lastSendMs = -1e9;
}

test('VcvBackend.send streams a 5-D input vector in full (not truncated to 2)', () => {
  const vcv = new VcvBackend();
  (vcv as unknown as { ctx: BackendContext }).ctx = makeCtx(4);
  const client = fakeClient();
  (vcv as unknown as { client: unknown }).client = client;
  unthrottle(vcv);

  vcv.setInputVector([0.1, 0.2, 0.9, 0.4, 0.55]);
  vcv.send(new Float32Array(4));

  expect(client.sentInputs).toEqual([[0.1, 0.2, 0.9, 0.4, 0.55]]);
});

test('VcvBackend.send dead-zones over the FULL vector — a change on axis 3 alone still resends', () => {
  const vcv = new VcvBackend();
  (vcv as unknown as { ctx: BackendContext }).ctx = makeCtx(4);
  const client = fakeClient();
  (vcv as unknown as { client: unknown }).client = client;
  unthrottle(vcv);

  vcv.setInputVector([0.5, 0.5, 0.5, 0.5]);
  vcv.send(new Float32Array(4)); // first send always fires (sentinel init)
  expect(client.sentInputs.length).toBe(1);

  // Bypass the internal 50ms send-interval throttle for the second call.
  unthrottle(vcv);

  // Only axis index 3 moves; X/Y (indices 0/1) are unchanged. Before the S10
  // fix, VcvBackend's dead-zone check only ever looked at indices 0/1, so
  // this change would have been silently dropped — no resend.
  vcv.setInputVector([0.5, 0.5, 0.5, 0.9]);
  vcv.send(new Float32Array(4));

  expect(client.sentInputs.length).toBe(2);
  expect(client.sentInputs[1]).toEqual([0.5, 0.5, 0.5, 0.9]);
});
