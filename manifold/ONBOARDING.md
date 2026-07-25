# Manifold UI — Agent Onboarding

> **Purpose of this doc:** everything an agent needs to make a tweak or fix to the Manifold
> front-end without re-grepping the tree. Read this + the relevant section's source files; you
> should not need to read the 40KB design specs for routine work (they're pointers at the end).
>
> **Voice:** ground-truth map. If something here contradicts the code, the code wins — fix this doc
> in the same commit.

---

## 1. What Manifold is

A **convertible-mode React front-end** on the real, parity-tested NISPS ML+audio engine (same
`nisps/` C++ core that the firmware and the `playground/` use, compiled to WASM). It lets you drive
a neural net's mapping from a small input space (XY pad / gamepad / MIDI) to many outputs, shape
that mapping with interactive ML feedback ("explore & place" / dislike), and route the outputs to
several backends (built-in synth, MIDI, OSC, particles, VCV, MEMLNaut hardware).

- **Stack:** Vite + React 18 + TypeScript (strict). No CSS-in-JS — design-token CSS variables.
- **Lives at:** `manifold/` (beside `playground/`). Deploys to **https://meml.lnfinitemonkeys.org/next/**.
- **Synth is labelled "Powerful Synth Engine" / "Built-in Synth" — NEVER "C15".** British spelling.

---

## 2. Run / build / deploy / test

```bash
cd manifold
bun install
bun run dev          # Vite dev server, port 5273 (COOP/COEP headers set)
bun run typecheck    # tsc --noEmit  ← run before every commit
bun run build        # tsc --noEmit && vite build → dist/
bun run preview      # serve dist/ on :4273 (honours COOP/COEP — needed by WASM/worklet)
bun run test:e2e     # Playwright smoke (needs `bun run build` first; runs against preview)
```

- **Typecheck is the cheap gate.** It catches most regressions; run it after any edit.
- **E2E on the VPS** needs a non-snap node runner (bun is snap-confined and hides libs from
  Chromium): `PLAYWRIGHT_BROWSERS_PATH=/home/w1n5t0n/snap/bun-js/87/.cache/ms-playwright node node_modules/.bin/playwright test`. Preview via bun is fine. The smoke spec (`tests/e2e/smoke.spec.ts`)
  asserts: engine WASM loads, spine invariant (setInputs → outputs change), feedback runs, console
  renders, **no "C15" in the bundle**, no console errors.
- **Deploy is automatic on push to GitHub `main`, but gated on CI** → webhook → waits for the
  `CI` workflow to conclude `success` on that exact SHA → builds `manifold/` → rsyncs to the live
  `/next/` subdir. A red or missing CI run aborts the deploy (fail-closed, 20 min timeout);
  `MEML_SKIP_CI_GATE=1` bypasses it for an emergency hand-deploy. The gate lives VPS-side in
  `~/.config/webhooks/meml-deploy.sh` (not in this repo) — added 2026-07-21 per the simplification
  audit. See the `manifold-deploy-pipeline` memory for the full chain and gotchas (the
  `cp index.html a-immersive.html` 403 workaround; git-ignored `bun.lock`).
- **`manifold/public/nisps.{js,wasm}` are tracked artifacts that ship to production** — the webhook
  builds only `manifold/`, so vite copies whatever is committed. CI's *WASM freshness gate* runs
  the parity harness against the committed artifact before rebuilding it, so a stale commit fails
  loudly. Rebuild with `scripts/build-wasm.sh` and commit it whenever `nisps/` changes.
- **`?debug=1`** installs `window.__nisps` (synchronous probe for Playwright/console — see
  `src/debug/probe.ts`). **`base: './'`** in `vite.config.ts` keeps asset URLs relative so one
  `dist/` mounts at both `/` and `/next/`. **WASM URLs must resolve via `document.baseURI`**, never
  hardcoded (see the assetUrl gotcha in §6).

---

## 3. The big picture — three layers

```
  ┌─────────────────────────────────────────────────────────────────┐
  │  UI layer (React)            src/console/  src/dock/  src/primitives/
  │    ConsoleApp = spine of the UI: holds state, picks a Stage,      │
  │    renders the Dock. "Convertible" = swappable Stages.            │
  └───────────────┬─────────────────────────────────────────────────-┘
                  │ reads engine.version (useSyncExternalStore), reads buffers imperatively
                  │ writes via engine.setInput / setParam / feedback.*
  ┌───────────────▼─────────────────────────────────────────────────┐
  │  Engine layer (NO React)     src/engine/  src/inputs/  src/feedback/  src/backends/
  │    Spine = reactive store below React. Per-frame ML inference is  │
  │    eager + synchronous, OFF the render cycle. React only watches  │
  │    a monotonic version counter.                                   │
  └───────────────┬─────────────────────────────────────────────────┘
                  │ C ABI
  ┌───────────────▼─────────────────────────────────────────────────┐
  │  WASM (nisps.wasm)  — built from the C++ nisps/ core             │
  │    Loaded TWICE: main thread (ML inference + training + feedback) │
  │    and AudioWorklet (audio DSP, separate instance).              │
  └──────────────────────────────────────────────────────────────────┘
```

**Golden rule of the reactivity model:** components subscribe to `engine.version()` via
`useEngineVersion()` and then read live `Float32Array`s **imperatively** (`engine.getOutputs()`,
`engine.routedOutput()`). They do **not** get outputs as React state — that was a deliberate perf
decision. Buffers are reused frame-to-frame; never assume a fresh array.

---

## 4. UI layer (where most tweaks happen)

### Entry & composition
- `src/App.tsx` → mounts `<EngineProvider>` (async WASM load, shows `Loading`) → `<ConsoleApp focus="composite" />`. Installs the `?debug=1` probe once the engine is live.
- `src/console/ConsoleApp.tsx` (**~1040 lines — the UI spine**). Holds nearly all UI state:
  `focus`, `modeId`, `params` (`MFParam[]`), `pos` (2D input), feedback state
  (`feedbackMode`/`soloMode`/`exploring`/`picking`/`anchorCount`), output config
  (`outputMode`/`midiOutputId`/`oscUrl`/`vcvUrl`), and UI flags (`sandwich`, `split`, `stripPinned`,
  `snapshots`, `markers`, `health`, `rev`). Builds the flat `ConsoleCtx` passed to the Dock + drawers.

### The Stages (one renders at a time)
**There is no `focus` axis any more.** The focus/altitude system (`AltitudeNav`, `SplitStage`,
`ReadoutStrip`, `InputMini`, `CompactAxis`) was deleted in the 2026-07 simplification audit —
Manifold ships a single "composite" altitude. Selection is now a plain three-way in `ConsoleApp`:
`sandwich` wins, else `outputMode==='particles'`, else CompositeStage.

| Stage | File | Renders when | What it is |
|---|---|---|---|
| CompositeStage | `CompositeStage.tsx` | **default / hero** | Draggable split-ratio; magnet-snaps to 0.14/0.33/0.5/0.66/0.86; collapses a side to a corner minimap at extremes. |
| SandwichStage | `SandwichStage.tsx` | `sandwich===true` (wins over the others) | Three-pane layout: `Manifold` input surface left, 3D parameter-landscape centre (input → MLP heatmap grid → outputs, drag to orbit), compact `OutputStage` right. |
| ParticleStage | `ParticleStage.tsx` | `outputMode==='particles'` | Flow-field visualiser (`flow-field.ts`, 400-particle Canvas2D port) + macro-axis bar + corner joystick. |

`Manifold.tsx` and `OutputStage.tsx` are no longer top-level stages — they are panes composed by
CompositeStage/SandwichStage. `Manifold.tsx` is the full-bleed 2D input surface (canvas trail + pins
+ feedback markers; pointer → `onMove`; **double-click the input mark → follow-mouse mode**, a window
`pointermove` listener mapping the whole viewport onto this surface's space, Esc or a second
double-click exits). `OutputStage.tsx` is the output columns; drag a bar to set value, and it takes a
`compact` prop for the narrow pane.

- **Output modes** (the TOP dock selector, NOT the same axis as `focus`): `src/console/output-mode.ts`
  defines `OUTPUT_MODES` = **particles** (default) / midi / osc / cv / synth / editor, each mapping to a
  `BackendId`. `DEFAULT_OUTPUT_MODE='particles'`. `outputDisplayCount()` is the shared presentation
  boundary for the stage and routing rows: MIDI uses its configured CC count, while backends without
  a separate count present the full mode parameter set. This does not reshape the MLP or clear examples.
- `src/console/output-mode.ts`, `types.ts`, `model.ts` are the shared vocabulary — read these first
  when touching anything cross-cutting:
  - `types.ts`: `Focus`, `OutputMode`, `DrawerKey`, `DrawerDepth`, `FeedbackModeUI`, `SoloMode`,
    `Pin`, `FeedbackMarker`, `Snapshot`, and **`ConsoleCtx`** (the flat context handed to the dock).
  - `model.ts`: the instrument catalogue `MF_MODES`, `MFParam`, `ParamStatus`
    (`off|fixed|live`), `ParamGroup`, plus `shapeValues()` (applies min/max/curve to raw engine
    outputs) and `modeEngineId()`. (`seededGradient()` is GONE — it was the fabricated
    gradient-health source, deleted in the 2026-07 sweep, S16.) **Schema-backed modes are DERIVED from the codegen
    schemas in `src/modes/generated/`** (one-core-engine P5.2) — real param names/groups/count,
    plus each mode's `ml` net shape (`MFMode.ml`) and schema `engine_id` (`MFMode.engineId`)
    come from schema truth. A thin manifold OVERLAY (`SCHEMA_MODES` in model.ts) supplies only
    label/glyph/ModeClass/input/ordering. Two schema-less manifold-only modes (`visualizer`,
    `c15` placeholder) stay hand-written on `DEFAULT_MODE_ML`. Do NOT hand-edit
    `src/modes/generated/` — it is codegen output (`bun run codegen/generate.ts`).

### The Dock (right-edge rail) — `src/console/Dock.tsx` + `Drawers.tsx`
- 48px right rail: **TOP** = mode selector (the 5 output modes, popover); **MIDDLE** = 5 drawer
  icons, vertically centred macOS-dock style; **BOTTOM** = sandwich toggle.
- Five drawers (`DRAWERS` in `Drawers.tsx`, each has `.render(ctx, depth)` — condensed 360px panel
  vs expanded 80vw×80vh modal):
  - **learn** — feedback mode (explore-and-place / geometric-dislike) + solo mode + per-output arm.
    At `expanded` depth ONLY it also renders `TrainingHealth.tsx`: the real per-iteration loss
    curve (`EngineApi.lossHistory()` ← `nisps_ml_loss_history` ← `MLPCore::loss_history`) plus
    the per-layer weight-health table (`getLayerStats`). **`depth === 'expanded'` is Manifold's
    advanced-surface flag** — there is no separate feature-flag mechanism, so put advanced
    surface there rather than inventing one. The panel renders "no training run yet" when the
    core has no history; it never synthesises a curve.
  - **inputs** — enable/configure input sources (XY pad / MIDI / gamepad).
  - **route** (label "Outputs") — per-output control matrix + per-backend config.
  - **settings** — icon style (monochrome/colour), input-map shape (xy/joystick/rect/circular), corner radius.
  - **help** — keymap pills + loop explanation.
- `src/dock/` holds the output-routing internals used by the `route` drawer:
  - `output-state.ts` — the per-output control model: `OutputControl` (state/muted/armed/min/max/
    curve/fixedValue + backend specs `MidiCcSpec`/`OscSpec`/`VcvSpec`), `toOutputControl()`,
    `buildArmMask()` (solo focus).
  - `OutputControlRow.tsx` — one output row: name · M(mute) · S(solo/arm) · off|fixed|live · dual-range
    · curve pad · live value. **Writes eagerly to the shared `MFParam` store via `onChange`.**
  - `OutputsBackendConfig.tsx` — preset bar (save/restore/rename/delete) + per-backend config (MIDI
    CC#/channel, OSC path/range, VCV polarity).

### Primitives — `src/primitives/` (barrel: `index.ts`)
Seven: `Button`, `Slider`, `PillToggle`, `Badge`, `Switch`, `XYPad`, `VirtualJoystick`. Dumb,
reusable, no engine knowledge. Side-effect import of `styles/primitives.css` styles the range
inputs. `Panel`/`StatusLine`/`ControlAxis`/`CurvePlot`/`Sparkline` were **deleted** in the 2026-07
sweep (L22, zero consumers) — don't cite them.

### Other shared UI files
- `shared-ui.tsx` — `MiniMeters` (read-only output bars). `AltitudeNav`/`CompactAxis` were deleted with the focus system.
- `icons.tsx` — monochrome inline-SVG icons (mode icons + drawer icons + `GLYPH_FALLBACK` for when monochrome is off).
- `VerdictCluster.tsx` — floating bottom-centre feedback UI (perturb ▽ / undo ↺ / commit △ + A/B); labels adapt to feedback mode.
- `CurvePad.tsx` — square canvas curve editor (vertical drag reshapes [0,1]; ~0.43 ≈ linear). Used in OutputEditor + OutputControlRow.
- `OutputEditor.tsx` — inline min/max/curve popup for a single output (hover/click on a bar).

### Styling — `src/styles/`
CSS-variable design tokens, no CSS-in-JS. `tokens.css` `@import`s `tokens/{base,colors,fonts,
typography,spacing,effects}.css`. All vars on `:root`, consumed via `var(--name)`. Dark theme: deep
black bg, warm-orange `--accent` (#ff6a00), cyan `--accent-2` (#00ccff). Corner radius is driven by
a setting → `--r-*` tokens.

---

## 5. Engine / inputs / feedback / backends (touch when behaviour, not chrome, changes)

### Engine — `src/engine/` (no React except the two binding files)
- `spine.ts` — **the reactive store.** `setInput(x,y)`/`setInputs(arr)` drive raw input synchronously
  through `WasmIML.processInput` (WASM input chain) → `processInto()` → `WasmIML.processOutput` (WASM
  output chain) → backend, all off the render cycle, reusing buffers. Bumps a monotonic `version`.
  `reprocess()` re-ticks the last input after a weight change (stores the full N-D vector so extra axes
  survive). Pipeline config lives in `inputConfig_`/`outputConfig_` and is pushed C-side via
  `setInputConfig`/`setOutputConfig` (state itself lives in the WASM pipeline handle since P4).
- `engine-api.ts` — **`EngineApi`, the framework-neutral facade** everything in the UI talks to:
  `setInput/setInputs`, `getOutputs/routedOutput`, training (`addExample/train/trainAsync/evalLoss`),
  weights (`getWeights/setWeights/process/randomise`), telemetry
  (`lossHistory/getLayerStats`), `subscribe/version/on`, plus nested `.feedback` and `.audio`
  facades. **`lossHistory()` reads SPINE STATE, not the MLP handle** — an async train runs on the
  worker's mirror net, so the main handle's own history is empty for those runs; both paths
  publish to the spine.
- `EngineProvider.tsx` / `useEngine.ts` — the **only** React coupling. `useEngine()` returns the API
  (null until WASM ready); `useEngineVersion()` = `useSyncExternalStore(subscribe, version)`.
- `engine-host.ts` — main-thread audio wiring: AudioContext (user-gesture gated), fetch `nisps.wasm`,
  register + feed the worklet.
- `wasm-iml.ts` (**~750 lines**) — the ML interface to `nisps.wasm`: one MLP handle, dataset, heap
  buffers, feedback C-ABI bindings (`nisps_ml_feedback_*`), lazy training worker.
- `wasm-worker.ts` — off-thread training worker; returns weights, final loss, and the real
  per-iteration loss curve read off its own mirror handle. `worklet/nisps-processor.ts` — the AudioWorklet's
  separate WASM instance (raw `WebAssembly.instantiate`, no Emscripten glue; 128-sample blocks).
- **Input/output pipelines + curves live in the C++/WASM core (one-core-engine P4).** The input chain
  (invert → deadzone → circular clamp → momentum-modulated zoom → centred power → EMA → momentum) and
  output chain (global curve → per-output EMA → slew → freeze/mask) are `nisps/pipeline/*`, exposed via
  `nisps_input_*` / `nisps_output_*` and driven by thin `WasmIML` wrappers (`processInput`,
  `processOutput`, `setInputConfig`, `setOutputConfig`, `setOutputFreezeMask`, `reset*`). State lives
  C++-side per pipeline handle. First 2 axes get the full pad pipeline; axes 2+ feed raw to the spine.
  The old TS `input-pipeline.ts` / `output-pipeline.ts` / `curves.ts` are **deleted**; config TYPES are
  `pipeline-types.ts`, the curve NAME↔id contract is `curve-catalog.ts`, and the curve MATHS is sampled
  from the core via `EngineApi.curveApply` / `curveApplyBatch`.
- `dataset.ts` — JS-side example store + sample-weight modes (uniform/recency/spatial/combined).
  `sink.ts` — `EngineSink` framework boundary. `types.ts` — C-ABI surface types.
- `exploration.ts` — `ExplorationController` adapter for the Jolt press + OU explore gestures
  (Learning drawer). **As of one-core-engine P3 the maths lives in the shared C++/WASM core** — this
  class is a thin driver that owns only the control-rate timers and calls `engine.explore.*`
  (`joltPress`/`joltStep`/`joltRelease`/`joltActive` → `nisps_ml_jolt_*`; `setExploreIntensity`/
  `exploreApply` → `nisps_ml_explore_*`). The held ~200 Hz driver calls `joltStep()` + `process()`;
  the OU walk is the spine's inert-by-default `setOutputMorph` hook, now `exploreApply(routed)` (copy
  into the WASM heap → advance+add in the core → copy back). The interim `jolt.ts` / `ou-explore.ts`
  TS ports were deleted with the swap.

### Inputs — `src/inputs/`
- `input-layer.ts` — composition hub. One rAF loop polls sources, pulls all axes into a vector,
  forwards N→engine. **`MAX_AXES = 32`** (WASM net over-provisioned to 32 inputs). **Dedicated
  dimensions, NO mean-blending** — each active axis drives its own engine slot 1:1; unused slots
  zero-padded (inert). Changing axis count requires a **net reset** (UI confirm modal).
- `base-source.ts` + sources: `xy-pad-source.ts` (push, 2 axes), `gamepad-source.ts` (single=2 /
  double=4 axes, deadzone 0.08), `midi-input-source.ts` (Web MIDI, batch CC-learn, multi-port).
- `useInputLayer.ts` — React binding; manages exclusive input mode + gamepad stick mode + MIDI
  device/learn map; exposes `pushPad`, `sources`, `channelLayout`, etc.
- **Reshape (P2.3, live):** the net is now **runtime-shaped**. It boots at the default
  over-provisioned 32-input head (zero-padding preserved), and `EngineApi.reshape({ inputSize, … })`
  → `WasmIML.reshape` swaps in a new net at the requested arity, **warm-started** from the overlapping
  weights (`nisps_ml_reshape`; C-side dataset + feedback state RESET). When the active axis layout
  CHANGES to a count ≠ the net's arity, `ConsoleApp` offers the swap behind `ReshapeModal.tsx`
  (reset-on-reshape confirm; declining keeps the zero-padded head). Never offered on load. The
  spine tolerates the arity change (buffers resize, version bumps); the training worker
  (`wasm-worker.ts`) carries the current dims in its train message and re-creates its mirror net to
  match. Debug: `window.__nisps.reshape(nIn)` / `.describe()`. See the `manifold-mixed-inputs` memory
  for the locked design (adaptive slider viz when >2 dims is still pending).
- **Per-mode net dims (P5.3):** switching INSTRUMENT mode reshapes the net to that mode's schema
  `ml` config (`MFMode.ml` — input/hidden/output + spread) via a `ConsoleApp` effect keyed on
  `[engine, modeId]`. No confirm modal (switching instrument is deliberate); the axis-count
  `ReshapeModal` above is for input-LAYOUT changes only. The effect depends on `engine`, so on boot
  it fires once WASM is ready and lands the boot mode's dims (**paf_synth → 4→[10,10,14]→33**, weights
  809 — NOT the 32→126 default). The reshape-offer effect reads the engine's CURRENT `inputSize`
  live, so a mode switch that changes arity doesn't spuriously prompt (its baseline tracks axis
  COUNT, unchanged by a pure dim change). Non-schema modes restore `DEFAULT_MODE_ML` (32→126).
  Debug seam for tests: under `?debug=1` ConsoleApp installs `window.__mf`
  (`setMode`/`getModeId`/`paramCount`/`modeIds`) — the UI-level analogue of `__nisps`, since no
  in-UI instrument picker exists yet (`ctx.modes`/`setModeId` are plumbed but unrendered).

### Feedback — `src/feedback/`
- `controller.ts` — `FeedbackController`, framework-neutral, owned by ConsoleApp. **As of one-core-
  engine P3 it holds NO algorithm approximation** — a thin driver over the shared C++ core. Two modes:
  **geometric-dislike** (default, Mode 1, "Push away") — `dislike()` calls `engine.feedback.
  dislikeGeometric(heardVec)` (the k-NN centroid push-away in `nisps/ml/geo_push.hpp`; returns
  FeedbackAction 14=push / 15=cold-start) then `process()`; `like()` runs the core's `thumbsUp`
  (auto-stores the positive centroid in Avoid+Geometric) + `addExample` + `train`. **explore-and-
  place** (Mode 2, positive-only) drives the core's snapshot/scratchpad/undo lifecycle; caller
  accumulates anchors and trains on finalise with warm-start. Solo/arm via per-output mask.
- **The heard-vector rule:** the geometric dislike trains AWAY from the HEARD (post-pipeline, routed)
  output — pass `engine.routedOutput()`, never the raw MLP output, or the cold-start MSE derivative is
  zero (inert). The `EngineApi.feedback.thumbsDown` facade + the Mode-1 `dislike()` call site honour this.
- **Cold-start prompt:** a dislike with zero positives returns action 15 → ConsoleApp shows a one-time
  "Like a few sounds first…" banner (dismissed on the next like or the dismiss button; rl-feedback §7).
- The interim `rng.ts` (`SeededRng`) and the `C++ GAP` approximation markers are **gone** — the seeded
  RNG, geometric push, jolt, and OU all run in the core now.

### Backends — `src/backends/`
- `manager.ts` — `BackendManager`, the **single consumer of the engine spine** for output: subscribes,
  reads `routedOutput()` each version bump, calls `active.send(routed)`. Gates audio (mutes synth when
  a non-synth backend is active).
- Registered: `midi` (`midi-backend.ts`, CC out, ~20Hz throttle), `osc` (`osc-client.ts` → WebSocket
  to the Deno bridge in `osc-bridge/bridge.ts`), `synth`/`cvgate` (`passthrough-backend.ts`),
  `particles` (`particle-backend.ts`, no-op — the visualiser is a separate `flow-field.ts` consumer),
  `vcv` (`vcv-backend.ts`, bidirectional). `mapping.ts`, `presets.ts`, `useBackendManager.ts` support
  config. `backend.ts` defines the `OutputBackend` interface + `OutputMapping`.

### Misc
- `src/serial/memlnaut-serial.ts` — **STUB** Web Serial scaffold for the MEMLNaut Editor mode (protocol TODO). `EditorPanel.tsx` is its UI.
- `src/settings/settings-store.ts` — localStorage settings (`mf-settings`): icon style, input-map shape, corner radius.
- `src/midi-devices/` — codegen'd external-synth device templates.
- `src/debug/probe.ts` — `window.__nisps` synchronous probe (engine/audio/bus). Some playground
  feature-store methods are present-but-inert (not ported yet) to keep the surface stable.

---

## 6. Gotchas & non-obvious rules

1. **Outputs are read imperatively, not via React state.** Subscribe to `version`, then call
   `getOutputs()`/`routedOutput()`. Buffers are reused — copy if you need to retain.
2. **Asset URLs must resolve against `document.baseURI`, not `location.origin`.** `base: './'` +
   the `/next/` subpath mean a hardcoded `/nisps.wasm` 404s. The `assetUrl()` helper (in
   `engine-host.ts`, `wasm-iml.ts`, `wasm-worker.ts`) handles this — use it.
3. **`nisps.js` is non-module Emscripten glue (no ES exports).** Workers/worklet fetch + indirect-eval
   to install the global `createNispsModule`; the worklet uses raw `WebAssembly.instantiate`.
4. **WASM MLP is runtime-shaped (since one-core-engine P2).** `nisps_ml_create(in, out, hidden[])`
   honours its dims (non-positive/null → the default `32→[10,14,18]→126` head, so pre-P2 callers are
   bit-identical), and `nisps_ml_reshape` swaps in a warm-started net at new dims. Weights = 3148 at
   the default shape; reshaping only the input arity shifts the first layer (e.g. →4 inputs = 2868).
   The firmware MLP stays compile-time templated — only the WASM/browser build is dynamic.
5. **Curves + input/output pipelines are C++/WASM only (one-core-engine P4).** No TS curve/pipeline
   maths remains; the browser samples `nisps/core/math.hpp` + `nisps/pipeline/*` via the WASM. The
   golden test (`tests/pipeline-golden.test.ts`) drives the WASM chains against the frozen fixtures.
   NOTE: `exp/log/sigmoid/cubic` deliberately changed to the firmware-exact maths at P4 (see
   `tests/fixtures/README.md`); `linear/square/sqrt/centered_power` are unchanged. The 3 momentum input
   configs carry a wide (`1e-2`) tolerance — proven-inherent f32 drift, documented in the test header.
6. **COOP/COEP headers are mandatory** for the WASM/worklet path — set in `vite.config.ts` for
   dev+preview, and at nginx server scope in prod (inherited by `/next/`).
7. **Never emit "C15"** in code or bundle — the smoke test fails on it. Synth is "Powerful Synth
   Engine"/"Built-in Synth".
8. **Two `MFParam` writers** (stage controls AND dock rows) share one store — edits in either re-render both.

---

## 7. Deeper references (only when this doc isn't enough)

All in `docs/specs/` (at the repo root, not under `manifold/`), with subdirectories:
- `plans/BUILD-PLAN.md` — locked decisions + the 12-step build sequence + spec pointers (the resume anchor).
- `engine-architecture.md` — full engine/spine/WASM design.
- `dock-spec.md` — dock + drawers spec. `inputs-spec.md` — mixed-input design. `backends-spec.md` — backends.
- `docs/adr/rl-feedback-design.md` + `plans/feedback-modes-port-spec.md` (executed) + `recon/findings-feedback-behaviour.md` — feedback modes (Mode 1/Mode 2).
- `_archive/aimmersive-clone-spec.md` / `recon/playground-2026.md` — the a-immersive feature parity target (archived reference).
- `src/backends/README.md` — backend wiring notes.

**Memories** (auto-loaded): `manifold-build` (status + locked decisions), `manifold-mixed-inputs`
(N-D input design), `manifold-deploy-pipeline` (the auto-deploy chain), `single-double-joystick-toggle`.

---

*Keep this in sync with the code — update it in the same commit as any change to UI structure, the
engine spine, the dock/drawers, or the build/deploy commands.*
