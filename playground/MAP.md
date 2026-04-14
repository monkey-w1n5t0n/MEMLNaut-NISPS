# Playground Architecture Map

Living architecture map for the `playground/` web app. One line per module where possible. Issue IDs in parens are pointers to history (beads), not implementation status — everything listed here is shipped.

## Top-Level

| Path | Role |
|------|------|
| `a-immersive.html` | Immersive app entry (production UI). Loads `js/a-app.js`. |
| `a-app.js` | Immersive app wiring: WASM engine, joystick, control surface, synth routing, persistence, modal entry points. |
| `index.html`, `b-workbench.html`, `c-journey.html`, `designs.html` | Legacy variants (use JS engine, slated for WASM migration — `meml-dj9`). |
| `SPEC-controls.md` | Control-surface spec (Phases 1–4). |
| `SPEC-shapeseq.md` | Shape sequencer spec. |
| `ARCHITECTURE.md` | High-level architecture notes. |
| `TODOS.md` | Running todo list. |
| `docs/` | Design contracts (schemas, specs, spike findings). |
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
| `session-memory.js` | Per-preset session memory: save/load weights+dataset+overrides keyed by `{engine, presetId}` in `nisps.session.*` localStorage entries; quota-aware (4 MB budget, prunes oldest); ships the restore modal. Cross-engine switch reuses payload + modal under `{engine, '__no_preset__'}` pseudo-key when no preset is active. |
| `iml.js`, `mlp.js`, `layer.js`, `node.js` | Legacy JS MLP engine (used by old variants only). |
| `osc-client.js` | OSC over WebSocket client. |

## `js/synth/` — Engines, presets, schema

| File | Role |
|------|------|
| `engine-interface.js` | Common interface all engines implement (`setParam`, `getState`, `paramMeta`, …). |
| `preset-types.js` | JSDoc typedefs for the unified preset schema + `__presetSchemaVersion`. No runtime code. |
| `group-columns.js` | `getColumn(engine, groupName)` → `'Sound' \| 'Modulation' \| 'Routing'` plus `MODULAR_GROUP_COLUMNS` / `C15_GROUP_COLUMNS`. Drives the Patch Editor three-column layout. |
| `param-map.js` | Curated 126-param catalogue for C15 (see root `CLAUDE.md`). |
| `presets.js` | C15 presets, unified schema (`engine:'c15'`, `complexity:1..4`, `params:{}`, `groupCurves`). Legacy `tier`/`active`/`overrides`/`mutedOverrides` shim still emitted for back-compat. |
| `c15-bridge.js`, `c15-adapter.js` | C15 WASM synth integration. |
| `modular-engine.js` | Modular synth engine (ADSR/LFO/matrix + sub-engine). `setParam(label\|index, norm01)` is normalised [0,1] via F2 helpers; `setMatrixCell(s, d, norm01)` and `getParam(label)` round-trip through `MODULAR_PARAM_META`. `_setRawByLabel` is the internal escape hatch for Patch Bay / default-patch writes. |
| `modular-presets.js` | Modular presets, unified schema (`engine:'modular'`, `complexity:1..5`, `meta:{subEngine,adsrCount,lfoCount}`, normalised `params` + `matrix` cellKey `sNN_dNN`, `groupCurves`). 13 presets total (6 legacy ported + 7 new curated). Legacy `state` shim retained. |
| `modular-param-meta.js` | Hand-curated metadata for the modular subtractive sub-engine (`{unit, rawMin, rawMax, safeMin, safeMax, defaultCurve, humanName, group}`) for 679 labels (23 sound + 16×5 ADSR + 32×3 LFO + 48×10 Matrix). Exports `MODULAR_PARAM_META`, `getMeta`, `normToRaw`, `rawToNorm`, `parseMatrixLabel`. |
| `faust-engine-base.js`, `faust-param-meta.js` | Base class + metadata helpers for Faust-based engines. |
| `additive-engine.js`, `additive-presets.js` | Additive engine + presets. |
| `fm-engine.js`, `fm-presets.js` | FM engine + presets. |
| `arpeggiator.js`, `arpeggiator-worker.js` | Arp clock / note generation. |
| `midi-input.js`, `osc-output.js` | MIDI-in / OSC-out routing. |

## `js/ui/` — UI modules

### Preset / patch editing (unified preset epic)

| File | Role |
|------|------|
| `patch-editor-modal.js` | Full-viewport card-per-group Patch Editor: three columns (Sound/Modulation/Routing) via `getColumn()`. Each card shows exposed-count, group mute-all, group curve (binds to `preset.groupCurves`), and expands to per-param rows (bypass / mute / min / max / curve / fixed). On modular, the `Matrix` group collapses to a single "Open Patch Bay" card in Routing. Mobile <480px collapses to one stack. Singleton API: `createPatchEditor(...)`, `openPatchEditor`, `closePatchEditor`, `api.setPresets()`. Includes left-slide preset picker with complexity-filter chips. |
| `patch-bay-modal.js` | Full-viewport 48×10 Patch Bay matrix editor: mute+depth per cell, sub-engine-aware destination labels, live MLP feedback, horizontally scrollable on mobile. Sole matrix editor since `meml-ptgi`. |
| `modular-ui.js` | Modular-engine "quick peek" drawer: sub-engine toggle, ADSR/LFO counts + slot enables, engine sound-param exposure, preset overlay. Matrix editing lives in Patch Bay. |
| `engine-switcher.js` | Switch between C15 / modular / additive / fm engines. |

### Joystick & input

| File | Role |
|------|------|
| `joystick.js`, `joy-map-enhanced.js` | Virtual joystick + zoom minimap. |
| `input-pipeline.js` | Deadzone → zoom → curve → smoothing → momentum. |
| `output-pipeline.js` | Global curve → smoothing → slew → freeze gate on MLP outputs. |
| `eoc-joystick.js`, `eoc-chain-ui.js` | End-of-cycle event chain UI. |
| `hand-tracker.js`, `gamepad.js` | Alternate input devices. |

### Control surface (Phases 1–4 — see `SPEC-controls.md`)

| File | Role |
|------|------|
| `control-surface.js`, `control-surface-ui.js` | Compound axes (Boldness/Memory/Precision). |
| `snapshot-stack.js`, `ab-compare.js` | Weight-state history + A/B compare. |
| `region-pin.js`, `param-pin.js` | Input-region and per-output pinning. |
| `pressure-feedback.js`, `auto-explore.js` | Touch-pressure + automated thumbs-down. |
| `input-heatmap.js` | 2D color field sampling the MLP. |
| `weight-health.js`, `gradient-flow.js` | Network health / gradient diagnostics. |
| `session-presets.js` | Save/load full session state + URL sharing. |
| `phase2-ui.js`, `phase3-ui.js`, `phase4-ui.js` | Per-phase DOM wiring. |

### Misc UI

| File | Role |
|------|------|
| `visualizer.js` | Flow-field particle visualizer. |
| `controls.js`, `dev-panel.js`, `param-display.js` | Misc UI widgets. |

## `docs/` — Design contracts

| File | Role |
|------|------|
| `unified-preset-schema.md` | **Canonical** preset schema for both C15 and modular engines. Bypass-vs-mute, matrix cell semantics, curve formula, complexity, mode scoping, mobile, localStorage-migration. |
| `spike-matrix-muted.md` | SPIKE finding: modular-subtractive is audible with all matrix cells at raw=0. |

---

## Cross-cutting notes

### Modal entry points

- **Patch Editor** — `#patch-editor-gear` icon inside `#synth-quick-controls` (auto-hides outside synth output mode); keyboard `E` toggles open/close (gated on synth mode + `INPUT/SELECT/TEXTAREA` focus guard).
- **Patch Bay** — `#patch-bay-gear` sibling icon, modular engine only; keyboard `M` toggles.
- `a-app.js:applyPreset()` and the engine-swap site call `patchEditor.setContext({engine, preset})` so open modals refresh. Picker repopulates via `syncPatchEditorPresets()` on editor mount, engine swap, and after preset apply.

### Unified `getSectionView`

`a-app.js:getSectionView(sectionIndex)` is a single codepath for both C15 and Faust engines. Sections derived from `activeEngine.paramMeta` by bucketing contiguous same-`group` params (`rebuildNonC15Sections`, also run for C15). The view exposes `{ name, color, count, startIndex, column, getCurve, setCurve, getParamName, getParamOverride }`; `column` comes from `group-columns.js:getColumn()` so the Patch Editor consumes it directly. Storage dispatch is internal — C15 overrides in `groupOverrides[si].params[li]`, Faust overrides in flat `engineParamOverrides`. The C15 adapter's `_inferGroup` emits `'State Variable Filter'` (was `'SVF'`) to match `C15_GROUP_COLUMNS`. The preset-apply path reads unified `preset.params` via `resolveEntry()` with a legacy-shim fallback so older session blobs keep working.

### MLP architecture is experimental

The MLP is intentionally flexible — resize freely. **Output layer size** = count of non-bypassed params from the active preset (4 for Blank Slate, up to 512+ for Full Modular). Preset apply rebuilds the MLP when output count or label order changes (warm-start transfer for joystick IML via `WasmIML.createWithWarmStart()`). **Internal hidden layers** are independent tunable knobs — current defaults `[32, 48, 64]` (joystick) / `[48, 48, 64]` (hands) are NOT sacred. Runtime mute on outputs does NOT change MLP shape.

| Override route | How |
|----------------|-----|
| URL | `?arch=3,32,48,64,N` (inputs+bias, hidden..., outputs) |
| Debug probe | `window.__nisps.rebuildArch([3, 64, 64, 126])` (requires `?debug=1`) |
| Programmatic | `iml.rebuild([...layerSizes])` on any `WasmIML` |
| Construction | `WasmIML.create(nInputs, nOutputs, hiddenLayers, ...)` |

---

## Epic history (`meml-iid8` — Unified Preset System)

Pointers, not status. All landed.

- E2E coverage for the unified preset surface lives in `tests/e2e/unified-presets.spec.js` (meml-k00k): schema shape, bypass-vs-mute, Patch Editor (E key + columns + preset picker chips), Patch Bay (M key + 48×10 grid), per-preset session restore, cross-engine `__no_preset__` save. See root `CLAUDE.md` "Testing" for run instructions.
- `meml-wu03` bootstrap MAP.md · `meml-piri` schema doc + JSDoc types · `meml-7qnz` bypass-vs-mute split · `meml-gqiv` matrix muted-cell semantics + curve formula + mobile + localStorage modal · `meml-ik2l` matrix-muted audibility spike · `meml-gmus` flexible MLP architecture · `meml-kw1f` modular param metadata table · `meml-1gx8` group-column classification · `meml-pu12` migrate C15 presets to unified schema · `meml-2l83` rewrite modular presets to unified schema · `meml-4bin` normalised `setParam` for modular engine · `meml-usd6` Patch Bay modal · `meml-17mp` unified `getSectionView` · `meml-n3uh` Patch Editor modal · `meml-4uye` per-preset session memory · `meml-u78y` cross-engine session save/restore · `meml-iww9` preset picker with complexity filter · `meml-coh8` gear icons + keyboard entry points · `meml-ptgi` remove old modular-ui matrix grid · `meml-0j1j` final docs pass.
