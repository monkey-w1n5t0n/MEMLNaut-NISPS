# Playground — Code Map

High-level pointers for navigation. Full details: `ARCHITECTURE.md`, `SPEC-controls.md`, root `CLAUDE.md`.

## ML Engine

- `js/nisps/nisps-wasm.js` — `WasmIML` class (main-thread inference + sync train)
- `js/nisps/nisps-wasm-worker.js` — off-thread training worker
- `js/nisps/dataset.js` — FIFO example buffer + sample-weight computation
- `wasm/nisps.js` / `wasm/nisps.wasm` — compiled nisps-core bindings (see `wasm/nisps_bindings.cpp`)

### MLP architecture is experimental

The MLP is intentionally flexible — **resize freely**:

- **Output layer size** = count of non-bypassed params from the active preset.
  Ranges from 4 (Blank Slate) to 512+ (Full Modular). Preset apply rebuilds
  the MLP when the output count or param label order changes. Weights are
  not preserved across rebuild in the general case (warm-start transfer
  for the joystick IML is handled separately via
  `WasmIML.createWithWarmStart()`).
- **Internal hidden layers** are independent tunable knobs. The current
  default `[32, 48, 64]` (joystick) and `[48, 48, 64]` (hands) are NOT sacred.
- **Runtime mute** on individual outputs does NOT change MLP shape; muted
  outputs are computed but held at `fixedValue` downstream.

Ways to override:

| Route | How |
|-------|-----|
| URL | `?arch=3,32,48,64,N` — `inputs+bias, hidden..., outputs` |
| Debug probe | `window.__nisps.rebuildArch([3, 64, 64, 126])` (requires `?debug=1`) |
| Programmatic | `iml.rebuild([...layerSizes])` on any `WasmIML` instance |
| Construction | `new WasmIML.create(nInputs, nOutputs, hiddenLayers, ...)` |

## App Wiring

- `a-immersive.html` + `js/a-app.js` — immersive app (default)
- `index.html` + `js/app.js` — legacy playground
- `b-workbench.html` + `js/b-app.js` — workbench variant
- `c-journey.html` + `js/c-app.js` — journey variant

## UI Modules

See root `CLAUDE.md` for the full control-surface table.

## Synth

- `js/synth/param-map.js` — 126 C15 param definitions (default output set)
- `js/synth/presets.js` — preset definitions: per-param mute, range, curve
- `js/synth/c15-adapter.js` — bridges `SynthEngine` interface to the C15 WASM
- `js/synth/modular-engine.js` + `js/synth/modular-presets.js` — modular DSP graph engine
