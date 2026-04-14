# Playground Architecture Map

Living architecture map for the `playground/` web app. **Updated by every commit** in the unified-preset epic (`meml-iid8`) and beyond. Keep entries concise — one line per module where possible.

## Top-Level

| Path | Role |
|------|------|
| `a-immersive.html` | Immersive app entry point (production UI). Loads `js/a-app.js`. |
| `a-app.js` | Immersive app wiring: WASM engine, joystick, control surface, synth routing, persistence. |
| `index.html`, `b-workbench.html`, `c-journey.html`, `designs.html` | Legacy variants (use JS engine, slated for WASM migration — see `meml-dj9`). |
| `SPEC-controls.md` | Control-surface spec (Phases 1–4). |
| `SPEC-shapeseq.md` | Shape sequencer spec. |
| `ARCHITECTURE.md` | High-level architecture notes. |
| `TODOS.md` | Running todo list. |
| `docs/` | Design docs and contracts (schemas, specs). |
| `wasm/` | Emscripten bindings (`nisps_bindings.cpp`) + `build.sh`. |
| `faust/` | Faust source for modular sub-engines. |
| `c15/` | C15 WASM synth assets. |
| `osc-bridge/` | Optional OSC bridge utility. |
| `serve.sh`, `serve-coop.py` | Static servers. |

## `js/nisps/` — ML engine

| File | Role |
|------|------|
| `nisps-wasm.js` | Main-thread `WasmIML` wrapper around the WASM MLP. |
| `nisps-wasm-worker.js` | Worker-side WASM instance for off-thread training. |
| `dataset.js` | FIFO ring-buffer training set + recency/spatial weighting. |
| `iml.js`, `mlp.js`, `layer.js`, `node.js` | Legacy JS MLP engine (used by old variants only). |
| `osc-client.js` | OSC over WebSocket client. |

## `js/ui/` — UI modules

| File | Role |
|------|------|
| `joystick.js`, `joy-map-enhanced.js` | Virtual joystick + zoom minimap. |
| `input-pipeline.js` | Deadzone → zoom → curve → smoothing → momentum. |
| `output-pipeline.js` | Global curve → smoothing → slew → freeze gate on MLP outputs. |
| `control-surface.js`, `control-surface-ui.js` | Compound axes (Boldness/Memory/Precision). |
| `visualizer.js` | Flow-field particle visualizer. |
| `controls.js`, `dev-panel.js`, `param-display.js` | Misc UI widgets. |
| `snapshot-stack.js`, `ab-compare.js` | Weight-state history + A/B compare. |
| `region-pin.js`, `param-pin.js` | Input-region and per-output pinning. |
| `phase2-ui.js`, `phase3-ui.js`, `phase4-ui.js` | Per-phase DOM wiring. |
| `pressure-feedback.js`, `auto-explore.js` | Touch-pressure + automated thumbs-down. |
| `input-heatmap.js` | 2D color field sampling the MLP. |
| `weight-health.js`, `gradient-flow.js` | Network health / gradient diagnostics. |
| `session-presets.js` | Save/load full session state + URL sharing. |
| `modular-ui.js` | Modular-engine drawer UI (ADSR/LFO/matrix editors). |
| `engine-switcher.js` | Switch between C15 / modular / additive / fm engines. |
| `eoc-joystick.js`, `eoc-chain-ui.js` | End-of-cycle event chain UI. |
| `hand-tracker.js`, `gamepad.js` | Alternate input devices. |

## `js/synth/` — Synth engines & presets

| File | Role |
|------|------|
| `engine-interface.js` | Common interface all engines implement (`setParam`, `getState`, `paramMeta`, …). |
| `c15-bridge.js`, `c15-adapter.js` | C15 WASM synth integration. |
| `param-map.js` | Curated 126-param catalogue for C15 (see CLAUDE.md). |
| `presets.js` | Current C15 synth presets (4 tiers, flat param names). |
| `faust-engine-base.js`, `faust-param-meta.js` | Base class + metadata helpers for Faust-based engines. |
| `modular-engine.js` | Modular synth engine (ADSR/LFO/matrix + sub-engine). |
| `modular-presets.js` | Current modular presets (snapshot of `getState()` diffs, Faust paths). |
| `additive-engine.js`, `additive-presets.js` | Additive engine + presets. |
| `fm-engine.js`, `fm-presets.js` | FM engine + presets. |
| `arpeggiator.js`, `arpeggiator-worker.js` | Arp clock / note generation. |
| `midi-input.js`, `osc-output.js` | MIDI-in / OSC-out routing. |

## `docs/` — Design contracts

| File | Role |
|------|------|
| `unified-preset-schema.md` | Canonical preset schema for both C15 and modular engines (`meml-piri`). |
| `spike-matrix-muted.md` | SPIKE finding: modular-subtractive is audible with all matrix cells at raw=0 (`meml-ik2l`). |

## Related types

| File | Role |
|------|------|
| `js/synth/preset-types.js` | JSDoc typedefs for the unified preset schema (no runtime code). |

---

## Epic: Unified Preset System (`meml-iid8`)

Ongoing work to unify C15 and modular presets behind a single schema/loader. Downstream issues will touch:
- `js/synth/presets.js` (migrate C15 presets to new schema)
- `js/synth/modular-presets.js` (migrate modular presets + matrix cells)
- New preset loader that dispatches on `engine` field
- Group-drawer UI that reads the unified schema
- Normalised `setParam` on modular engine (see `meml-4bin`)
- Matrix muted-cell semantics (`meml-gqiv`) and bypass-vs-mute (`meml-7qnz`)

This map will be updated as each issue lands.

## MLP architecture is experimental (`meml-gmus`)

The MLP is intentionally flexible — resize freely:

- **Output layer size** = count of non-bypassed params from the active preset. Ranges from 4 (Blank Slate) to 512+ (Full Modular). Preset apply rebuilds the MLP when the output count or param label order changes. Weights are not preserved across general rebuild (warm-start transfer for joystick IML is handled separately via `WasmIML.createWithWarmStart()`).
- **Internal hidden layers** are independent tunable knobs. Current defaults `[32, 48, 64]` (joystick) / `[48, 48, 64]` (hands) are NOT sacred.
- **Runtime mute** on individual outputs does NOT change MLP shape; muted outputs are computed but held at `fixedValue` downstream.

Overrides:

| Route | How |
|-------|-----|
| URL | `?arch=3,32,48,64,N` (inputs+bias, hidden..., outputs) |
| Debug probe | `window.__nisps.rebuildArch([3, 64, 64, 126])` (requires `?debug=1`) |
| Programmatic | `iml.rebuild([...layerSizes])` on any `WasmIML` |
| Construction | `WasmIML.create(nInputs, nOutputs, hiddenLayers, ...)` |
