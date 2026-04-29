# Why two WASM instances?

The playground loads `nisps.wasm` twice:

1. **Main thread**, via `playground/src/ml/wasm-iml.ts`. Used for ML
   inference + sync training + RL operations + UI feedback.
2. **AudioWorklet thread**, via `nisps-processor.ts`. Used for engine
   processing (per-128-sample-block).

Why not share?

- AudioWorklet runs on its own thread. Sharing memory across threads
  requires SharedArrayBuffer + locking on every heap access; far more
  expensive than two heaps.
- AudioWorklet has neither `fetch` nor ESM `import`, so it can't load
  the Emscripten glue (`nisps.js`). The main thread fetches the WASM
  bytes once and posts them here as a transferable `ArrayBuffer`; the
  worklet then `WebAssembly.instantiate`s directly.
- Engines and ML never interact in the audio path. The main thread
  computes the parameter vector each frame and pushes it into the
  worklet via `port.postMessage`. The worklet pushes nothing back per
  block (analysis features, if needed, are batched and sent at low
  rate).

Per-frame data flow:

```
Joystick → input pipeline → mlStore.outputs (Float32Array, length=126)
                                           ↓ EngineHost.setParams()
                                           ↓ port.postMessage (transferable)
       AudioWorklet ← WASM engine.process_block ← WASM engine.set_params
```

## Custom WASM loader

We do **not** use the Emscripten JS glue inside the worklet — the glue
contains `URL`, `Worker`, and `fetch` references that don't exist in
AudioWorkletGlobalScope. Instead `nisps-processor.ts` calls
`WebAssembly.instantiate` directly with hand-rolled imports and
discovers exports by walking the export descriptors. This makes the
worklet bundle small (just the processor TS) and avoids touching the
Emscripten init path.

The trade-off: only the engine API is callable here, not the ML API.
If you ever need ML inference inside the worklet (we don't), use the
main thread copy and post params over.

## Block size

AudioWorklet always calls `process()` with 128-sample blocks. Our
heap buffers in `nisps-processor.ts` are sized to match. Don't change
the block size without changing the buffer allocations.
