---
kind: finding
date: 2026-06-27
immutable: true
---

# Findings — Engine Surface Audit (Phase-1)

*Read-only audit, 2026-06-27. VERIFIED from source unless `[INFER]`. Engine A = deployed vanilla JS live at
meml.lnfinitemonkeys.org (`/home/w1n5t0n/deployments/meml-aimmersive/js/`, a snapshot — repo source has
diverged). Engine B = parity-tested TS playground in this repo (`playground/src/`).*

## Recommendation: wire the new React app to Engine B (the TS playground stack)
Confirmed by the operator's directive ("training must use the same core the firmware builds from"): Engine B's
`nisps.wasm` is compiled from the `nisps/` C++20 core and **parity-locked to native within 1e-5**
(`scripts/parity-check.sh`, `tests/cpp/parity_*`). Engine A's deployed WASM exports an **older C ABI**
(`nisps_mlp_*`) the repo no longer builds (`nisps_ml_*` + `nisps_engine_*`). Lift Engine B, don't fork.

## Executive summary
1. Engine B is the *current* codebase; Engine A's WASM is a stale ABI snapshot.
2. Engine B parity-tested (native==WASM ≤1e-5); A has no such guarantee.
3. Engine B is fully typed TS as ES modules (`WasmIML`, `EngineHost`); A is clean ESM JS but untyped.
4. **Decisive:** in Engine B, `nisps.wasm` produces the *audio itself* (`_nisps_engine_process_block` in the
   worklet) — true firmware parity. In Engine A, `nisps.wasm` is MLP-only; audio is separate JS/Faust/C15.
5. So "reuse the MLP" via A still leaves audio to reimplement; via B you reuse MLP **and** the 8 audio engines
   from one WASM.
6. Engine B's worklet is clean: no Emscripten glue, raw `WebAssembly.compile`, 128-sample blocks, per-thread
   instance, no SharedArrayBuffer for nisps audio.
7. Engine B exposes the richer ML surface (feedback modes C API, layer stats, RL move/pin, batch infer) and a
   synchronous Playwright probe `window.__nisps`.
8. Caveats (none blocking): fixed MLP arch (2→126), single-element `lossHistory` in sync train, mic input not
   wired, Solid coupling in `WasmIML` must be abstracted for React.

## Engine A — deployed vanilla JS (LIVE)
WASM at `meml-aimmersive/wasm/nisps.{js,wasm}`. `WasmIML` (`js/nisps/nisps-wasm.js`, 612L):
`create(nInputs,nOutputs,hiddenLayers=[10,10,14],…)`, `createWithWarmStart(snapshot,newOutputCount,…)` (transfers
hidden weights across output-count changes, used live), `process()` sync, `inferBatch`, dataset add/clear,
`train(options)` sync **(captures real per-iter loss history)**, `trainAsync(onComplete)` worker, `evalLoss`,
`randomiseWeights(spread)`, `moveWeights(speed,spread,outputPinMask)` (pin mask supported), weights get/set,
`getLayerStats()`→{meanAbs,maxAbs,deadFrac,satFrac}. **No feedback-mode API.** Emscripten MODULARIZE glue +
`cwrap`. Exported ABI: `nisps_mlp_{create,destroy,draw_weights_spread,eval_loss,get_layer_stats,get_weights,
infer_batch,inference,move_weights_ex,move_weights_spread,set_weights,train,train_ex,weight_count}` — **MLP
only, no audio**. Audio is separate `SynthEngine` impls: C15 (`c15-bridge.js`, own `c15_engine.wasm` +
worklet + SAB ring), Faust, JS `modular-engine.js`. Data path: input → `WasmIML.process()` → `outputs[]` →
`param-map.js` (`applyCurve`,`applyGroupOverride`,`SYNTH_PARAM_MAP`) → `engine.setParam` → audio. Live arch
bigger than expected: hidden `[32,48,64]`/`[48,48,64]`, warm-start across output counts. COOP/COEP needed only
by the C15 path; the nisps MLP path needs no SAB.

## Engine B — parity-tested TS playground (in repo)
Files: `ml/wasm-iml.ts` (650), `audio/engine-host.ts` (232), `audio/worklet/nisps-processor.ts` (309),
`input/pipeline.ts` (307), `output/pipeline.ts` (153), `output/curves.ts` (128), `debug/probe.ts`.
`WasmIML`: `create(opts)` — arch **resolved from the WASM build** via `_nisps_ml_describe` (caller sizes
warned+ignored); fixed **2→126**, hidden `[10,14,18]`, 4 layers. `setInput`, `process():Float32Array`
(copies out + pushes to `mlStore`), `inferXY`, `inferBatch` (chunked at 4096), dataset add/clear, `train`
sync, `trainAsync` worker, `evalLoss`, `randomiseWeights`, `moveWeights(speed,spread,pinMask)`, weights
get/set, `getLayerStats()`→{meanAbs,maxAbs,deadFrac,saturatingFrac}, `getLayerStatsFlat`, `dispose`, `reset`,
debounced `saveNow()`, `tryLoadFromStorage_`. **Richer ABI** (`nisps/wasm/bindings.cpp`): all of A's MLP ops
PLUS `nisps_ml_feedback_{up,down,drag,exploring,set_focus,set_mode,get_mode,static_output,learning_paused}`,
`nisps_ml_describe`, AND audio `nisps_engine_{create,destroy,set_params,process_block}`.

**Audio VIA nisps.wasm (key difference):** `EngineHost` lazy-creates `AudioContext`, registers worklet via
Vite `?worker&url`, fetches `nisps.wasm` on main thread, transfers bytes to worklet. `NispsProcessor` holds a
2nd nisps.wasm instance compiled **without Emscripten glue** (raw `WebAssembly.compile` + import-shape
discovery); per 128-sample block calls `_nisps_engine_process_block(handle,inL,inR,outL,outR,128)`. Engine
switch = `port` message → `_nisps_engine_create` with new ASCII id. Data path: input pipeline
(invert→deadzone→circular clamp→zoom→curve→EMA→momentum, pure fn) → `WasmIML.inferXY` → 126-vec → output
pipeline (global curve→EMA→slew→freeze) → `EngineHost.setParams(Float32Array)` → worklet. **Same C++ engines
as firmware.** COOP/COEP set in `vite.config.ts` (`same-origin`/`require-corp`); nisps audio needs no SAB
(separate per-thread instances); SAB only for the browser-only C15 path. Three isolated nisps.wasm instances
(main infer/sync-train, worker async-train, worklet audio). Debug probe `window.__nisps` (`debug/probe.ts`):
synchronous, bypasses Solid via `untrack`/`batch`; never throws.

## Gaps to budget for (none blocking)
- **Fixed MLP arch** (2→126, hidden [10,14,18]) baked into WASM; the modular N×M requirement (workstream F)
  needs either multiple WASM modules or runtime-shaped MLP (deferred behind a passing parity check). Engine A's
  configurable layers + warm-start is the reference for how to add this.
- **`lossHistory` single-element on sync `train()`** (`wasm-iml.ts:419`); `trainAsync` returns a real array;
  C API lacks `nisps_ml_loss_history`. Port A's per-iter capture if loss curves matter.
- **Mic input not wired** through the worklet (XIASRI / SoundAnalysisMIDI) — UI scaffolds only.
- **C15** is browser-only, own WASM + SAB; voice space a placeholder. (UI label: "Powerful Synth Engine".)
- **Solid coupling** in `WasmIML`/probe (`mlStore.__set*`, `coreBus.emit`) must become an injected
  callback/emitter to make it framework-neutral for React.

## Reuse plan for the React app
Import `WasmIML` for the MLP, `EngineHost` + the worklet for audio, lift `input/pipeline.ts`,
`output/pipeline.ts`, `output/curves.ts` as pure functions. Replace the Solid `mlStore`/`coreBus` side-effects
with an injected emitter so the engine is framework-neutral, then mount it under React via context (see
`findings-design-and-manifold.md` §4 reactive spine).
