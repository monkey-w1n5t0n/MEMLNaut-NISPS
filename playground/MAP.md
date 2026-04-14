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
| `session-memory.js` | Per-preset session memory (`meml-4uye`): save/load weights+dataset+overrides keyed by `{engine, presetId}` in `nisps.session.*` localStorage entries, quota-aware (4 MB budget, prunes oldest), includes the restore modal. |
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
| `patch-bay-modal.js` | Full-viewport 48×10 Patch Bay matrix editor (`meml-usd6`): mute+depth per cell, sub-engine-aware destination labels, live MLP feedback, horizontally scrollable on mobile. Replaces modular-ui's cramped grid (old grid still present, cleanup in `meml-ptgi`). |
| `patch-editor-modal.js` | Full-viewport card-per-group Patch Editor (`meml-n3uh`): three columns (Sound/Modulation/Routing) derived via `group-columns.js:getColumn()`; each group card shows exposed-count, group mute-all, group curve (binds to `preset.groupCurves`), and expands to per-param rows (bypass / mute / min / max / curve / fixed). On the modular engine, the `Matrix` group collapses to a single "Open Patch Bay" card in Routing. Mobile <480px: columns collapse to a single vertical stack. Singleton API: `createPatchEditor({engine, preset, sectionView, sectionCount, onChange})`, `openPatchEditor()`, `closePatchEditor()`. Row renderer is inline (TODO: extract shared `param-row.js` once group-drawer + modular-ui + this modal stabilise). meml-coh8 will replace the temporary launcher button with a proper gear-icon / keyboard entry point. |
| `engine-switcher.js` | Switch between C15 / modular / additive / fm engines. |
| `eoc-joystick.js`, `eoc-chain-ui.js` | End-of-cycle event chain UI. |
| `hand-tracker.js`, `gamepad.js` | Alternate input devices. |

## `js/synth/` — Synth engines & presets

| File | Role |
|------|------|
| `engine-interface.js` | Common interface all engines implement (`setParam`, `getState`, `paramMeta`, …). |
| `c15-bridge.js`, `c15-adapter.js` | C15 WASM synth integration. |
| `param-map.js` | Curated 126-param catalogue for C15 (see CLAUDE.md). |
| `presets.js` | C15 synth presets, unified schema (`meml-pu12`): `engine:'c15'`, `complexity:1..4`, `params:{ [label]: { bypassed, muted, fixedValue?, min, max, curve } }`, `groupCurves`. Legacy `tier`/`active`/`overrides`/`mutedOverrides` still emitted as a shim until `meml-17mp` migrates the loader. |
| `faust-engine-base.js`, `faust-param-meta.js` | Base class + metadata helpers for Faust-based engines. |
| `modular-engine.js` | Modular synth engine (ADSR/LFO/matrix + sub-engine). |
| `modular-presets.js` | Modular presets, unified schema (`meml-2l83`): `engine:'modular'`, `complexity:1..5`, `meta:{subEngine,adsrCount,lfoCount}`, normalised `params` + `matrix` (cellKey `sNN_dNN`), `groupCurves`. Legacy `state` field still emitted as a shim (consumed by current `applyPreset` / `modular-ui.js`) until `meml-17mp` migrates the loader. 13 presets total (6 legacy ported + 7 new curated: Wide Timbre, Blank Slate, Filter Study, Rhythmic Motion, Envelope Sculptor, Routing Sketch, Full Modular). |
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

Landed contract extensions:
- `meml-7qnz` — bypass-vs-mute split: `PresetParamEntry` now carries both `bypassed` (structural, affects paramMeta/MLP shape) and `muted` (runtime, pins to `fixedValue`). See `docs/unified-preset-schema.md` § "Bypass vs. mute semantics".
- `meml-gqiv` — matrix muted cells ⟹ raw 0 and not in paramMeta (not "frozen last value"); canonical curve formula anchored to `param-map.js` `applyCurve()` (`exp = 2^(4*(curve-0.5))`); sub-engine-aware destination labels (only `d00`/`d08`/`d09` stable); mobile <480px collapses columns; presets scope to synth mode only; localStorage version mismatch → modal confirm (never auto-wipe).

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

## Group columns for Patch Editor modal (`meml-1gx8`)

`js/synth/group-columns.js` — `getColumn(engine, groupName)` → `'Sound' | 'Modulation' | 'Routing'` plus `MODULAR_GROUP_COLUMNS` / `C15_GROUP_COLUMNS` tables. Consumed by the Patch Editor modal (`meml-n3uh`); modular `Matrix` group is tagged `Routing` and surfaces as the "Open Patch Bay" card.

## Modular param metadata (`meml-kw1f`)

`js/synth/modular-param-meta.js` — hand-curated metadata for the Modular engine (subtractive): `{ unit, rawMin, rawMax, safeMin, safeMax, defaultCurve, humanName, group }` for 679 labels (23 sound params + 16×5 ADSR + 32×3 LFO + 48×10 Matrix). Exports `MODULAR_PARAM_META`, `getMeta`, `normToRaw`, `rawToNorm`, `parseMatrixLabel`. Lets presets use [0,1] normalised bounds against the modular engine. Matrix destination names are subtractive-engine-specific (see `meml-gqiv`).

`meml-4bin` landed: `ModularEngine.setParam(label|index, norm01)` is now normalised [0,1] via F2 helpers (`normToRaw`/`rawToNorm`); sibling `setMatrixCell(s, d, norm01)` and `getParam(label)` round-trip through the same metadata. `_setRawByLabel` remains the internal escape hatch for Patch Bay / default-patch writes.

## Unified `getSectionView` (`meml-17mp`)

`a-app.js:getSectionView(sectionIndex)` is a single codepath for both C15 and Faust engines. Sections are derived from `activeEngine.paramMeta` by bucketing contiguous same-`group` params (`rebuildNonC15Sections`, now also run for C15). The view exposes `{ name, color, count, startIndex, column, getCurve, setCurve, getParamName, getParamOverride }`; `column` comes from `group-columns.js:getColumn()` so the Patch Editor modal (`meml-n3uh`) consumes it directly. Storage dispatch is internal: C15 overrides still live in `groupOverrides[si].params[li]` (tame-envelope seeded); Faust overrides live in the flat `engineParamOverrides`. The C15 adapter's `_inferGroup` now emits `'State Variable Filter'` (was `'SVF'`) to match `C15_GROUP_COLUMNS`.

The preset-apply path in `applyPreset()` reads unified `preset.params` via a `resolveEntry()` helper (falls back to the legacy `active`/`overrides`/`mutedOverrides` shim so older session blobs keep working). `preset.complexity` is preferred over the legacy `preset.tier` in the preset selector. Legacy shim fields on `presets.js`/`modular-presets.js` are preserved pending a follow-up cleanup issue — `modular-ui.js` still reads `preset.state.{subEngine,adsrCount,lfoCount}`, and `modular-presets.js:applyPreset` itself still consumes the `state` blob.
