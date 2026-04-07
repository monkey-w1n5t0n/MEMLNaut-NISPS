# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external dependencies, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## External Dependencies

- **Node.js**: v25.4.0
- **npm**: v11.7.0
- **Playwright**: v1.59.1 (chromium headless shell v1217 installed)
- **Emscripten**: NOT required — existing WASM binaries are transplanted as-is

## WASM Binaries (transplanted from playground/)

- `public/nisps.wasm` (36KB) — ML engine
- `public/nisps.js` (14KB) — Emscripten glue
- `public/nisps-wasm-worker.js` — Training worker (from playground/js/nisps/)
- `public/c15/c15_engine.wasm` (270KB) — C15 synthesizer
- `public/c15/parameters.json` (163KB) — C15 parameter definitions
- `public/c15/worklet-processor.js` — C15 AudioWorklet
- `public/faust/` — Faust DSP files (fetched at runtime)

## CDN Dependencies

- **MediaPipe** (cdn.jsdelivr.net): Hand tracking only, lazy-loaded on mode switch to Hands
- **Google Fonts**: JetBrains Mono (loaded in index.html)

## Browser Requirements

- SharedArrayBuffer support (requires COOP/COEP headers)
- WebMIDI support (MIDI CC mode)
- AudioWorklet support (C15 synth)
- getUserMedia (hand tracking camera)
- Gamepad API (gamepad input)

## Platform Notes

- Linux x86_64 (kernel 6.14.0)
- No Docker
- 62GB RAM, 12 CPU cores
- ffmpeg 7.1.1 available (not used by SolidJS app)

## Vite / Build Tooling

- **COOP/COEP**: Set via `vite-plugin-cross-origin-isolation` plugin + explicit headers in server/preview config blocks (redundant but harmless)
- **File watching**: `usePolling: true` (1s interval) in vite.config.ts as workaround for EMFILE errors from too many file descriptors. Adds ~1s HMR latency
- **OXC parser limitation**: Vite's OXC parser does not support callable objects in object literals (function-call shorthand). Workaround: use factory function + Object.assign pattern (see `src/bus/signal-bus.ts` makeTopic())

## WASM Integration Details

- **WASM binary placement**: WASM files go in `public/` to avoid Vite asset hashing. Emscripten glue code goes in `src/core/wasm/` with a `locateFile` override that routes `.wasm` requests to `/` (the public root)
- **MLP architecture**: Uses `[nInputs+1, ...hiddenLayers, nOutputs]` where the +1 is a bias node prepended to the input layer
- **Activation enum**: SIGMOID=0, TANH=1, LINEAR=2, RELU=3. Hidden layers use RELU, output layer uses SIGMOID. Must match C++ `nisps::ACTIVATION_FUNCTIONS` enum

## Debug Probe

- **Method count**: 15 methods (not 16 as some descriptions say). VAL-PROJ-005 lists exactly 15: getOutputs, getLoss, getWeights, getExampleCount, setInputs, thumbsUp, thumbsDown, train, trainAsync, randomise, clearExamples, saveState, evalLoss, inferBatch, getLayerStats
- **Conditional activation**: `exposeDebugProbe()` checks `?debug=1` internally; callers don't need to guard
- **Known limitation**: `thumbsDown()` hardcodes spread=0.6; should be wired to ML store's spreadLevel when control surface is implemented

## agent-browser Notes

- **Chromium version mismatch**: agent-browser expects `chromium_headless_shell-1208` but Playwright v1.59.1 installs `chromium-1217`. Workaround: create symlink `chromium_headless_shell-1208 → chromium_headless_shell-1217` in `~/.cache/ms-playwright/`
