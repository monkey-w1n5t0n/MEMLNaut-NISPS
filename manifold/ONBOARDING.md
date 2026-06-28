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
  renders, **no "C15" in the bundle**, no console errors. `shot.spec.ts` takes screenshots.
- **Deploy is automatic on push to GitHub `main`** → webhook → builds `manifold/` → rsyncs to the
  live `/next/` subdir. See the `manifold-deploy-pipeline` memory for the full chain and gotchas
  (the `cp index.html a-immersive.html` 403 workaround; git-ignored `bun.lock`).
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

### The "convertible" Stages (one renders at a time, chosen by `focus` + `outputMode`)
| Stage | File | Renders when | What it is |
|---|---|---|---|
| Manifold | `Manifold.tsx` | `focus==='in'` (default input view) | Full-bleed 2D input surface; canvas trail + pins + feedback markers; pointer → `onMove`. |
| OutputStage | `OutputStage.tsx` | `focus==='out'` | Full-bleed output columns; drag bars set value; `InputMini` docked in a corner. |
| SplitStage | `SplitStage.tsx` | `focus==='split'` | Manifold left, OutputStage right, equal width. |
| CompositeStage | `CompositeStage.tsx` | `focus==='composite'` (**app default / hero**) | Draggable split-ratio; magnet-snaps to 0.14/0.33/0.5/0.66/0.86; collapses a side to a corner minimap at extremes. |
| SandwichStage | `SandwichStage.tsx` | `sandwich===true` (overrides) | 3D parameter-landscape view (input → MLP heatmap grid → outputs); drag to orbit. |
| ParticleStage | `ParticleStage.tsx` | `outputMode==='particles'` | Flow-field visualiser (`flow-field.ts`, 400-particle Canvas2D port) + macro-axis bar + corner joystick. |

- **Output modes** (the TOP dock selector, NOT the same axis as `focus`): `src/console/output-mode.ts`
  defines `OUTPUT_MODES` = **particles** (default) / midi / osc / synth / editor, each mapping to a
  `BackendId`. `DEFAULT_OUTPUT_MODE='particles'`.
- `src/console/output-mode.ts`, `types.ts`, `model.ts` are the shared vocabulary — read these first
  when touching anything cross-cutting:
  - `types.ts`: `Focus`, `OutputMode`, `DrawerKey`, `DrawerDepth`, `FeedbackModeUI`, `SoloMode`,
    `Pin`, `FeedbackMarker`, `Snapshot`, and **`ConsoleCtx`** (the flat context handed to the dock).
  - `model.ts`: the static instrument catalogue `MF_MODES`, `MFParam`, `ParamStatus`
    (`off|fixed|live`), `ParamGroup`, plus `shapeValues()` (applies min/max/curve to raw engine
    outputs) and `seededGradient()`.

### The Dock (right-edge rail) — `src/console/Dock.tsx` + `Drawers.tsx`
- 48px right rail: **TOP** = mode selector (the 5 output modes, popover); **MIDDLE** = 5 drawer
  icons, vertically centred macOS-dock style; **BOTTOM** = sandwich toggle.
- Five drawers (`DRAWERS` in `Drawers.tsx`, each has `.render(ctx, depth)` — condensed 360px panel
  vs expanded 80vw×80vh modal):
  - **learn** — feedback mode (explore-and-place / geometric-dislike) + solo mode + per-output arm.
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
  - `BackendAdvanced.tsx` — full-depth modal version of the same editors.

### Primitives — `src/primitives/` (barrel: `index.ts`)
`Button`, `Slider`, `PillToggle`, `Panel`, `Badge`, `Switch`, `StatusLine`, `XYPad`,
`VirtualJoystick`, `ControlAxis`, `CurvePlot`, `Sparkline`. Dumb, reusable, no engine knowledge.
Side-effect import of `styles/primitives.css` styles the range inputs.

### Other shared UI files
- `shared-ui.tsx` — `AltitudeNav` (focus IN/DUAL/OUT/FLEX switcher) + `MiniMeters` (read-only output bars).
- `icons.tsx` — monochrome inline-SVG icons (mode icons + drawer icons + `GLYPH_FALLBACK` for when monochrome is off).
- `ReadoutStrip.tsx` — thin horizontal heatmap strip (pinned, `focus==='in'`); same per-output control as OutputStage.
- `VerdictCluster.tsx` — floating bottom-centre feedback UI (perturb ▽ / undo ↺ / commit △ + A/B); labels adapt to feedback mode.
- `CurvePad.tsx` — square canvas curve editor (vertical drag reshapes [0,1]; ~0.43 ≈ linear). Used in OutputEditor + OutputControlRow.
- `InputMini.tsx` — compact XYPad/joystick docked in a corner when input is demoted.
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
  through input-pipeline → `WasmIML.processInto()` → output-pipeline → backend, all off the render
  cycle, reusing buffers. Bumps a monotonic `version`. `reprocess()` re-ticks the last input after a
  weight change (stores the full N-D vector so extra axes survive).
- `engine-api.ts` — **`EngineApi`, the framework-neutral facade** everything in the UI talks to:
  `setInput/setInputs`, `getOutputs/routedOutput`, training (`addExample/train/trainAsync/evalLoss`),
  weights (`getWeights/setWeights/process/randomise`), `subscribe/version/on`, plus nested
  `.feedback` and `.audio` facades.
- `EngineProvider.tsx` / `useEngine.ts` — the **only** React coupling. `useEngine()` returns the API
  (null until WASM ready); `useEngineVersion()` = `useSyncExternalStore(subscribe, version)`.
- `engine-host.ts` — main-thread audio wiring: AudioContext (user-gesture gated), fetch `nisps.wasm`,
  register + feed the worklet.
- `wasm-iml.ts` (**~750 lines**) — the ML interface to `nisps.wasm`: one MLP handle, dataset, heap
  buffers, feedback C-ABI bindings (`nisps_ml_feedback_*`), lazy training worker.
- `wasm-worker.ts` — off-thread training worker. `worklet/nisps-processor.ts` — the AudioWorklet's
  separate WASM instance (raw `WebAssembly.instantiate`, no Emscripten glue; 128-sample blocks).
- `input-pipeline.ts` — per-axis: invert → deadzone → circular clamp → zoom → centred power curve →
  EMA smoothing → momentum. **First 2 axes get the full pad pipeline; axes 2+ feed raw to the spine.**
- `output-pipeline.ts` — global power curve → per-output EMA smoothing → slew limit → freeze gate.
- `dataset.ts` — JS-side example store + sample-weight modes (uniform/recency/spatial/combined).
- `curves.ts` — math primitives. **Must stay lockstep with C++ `nisps/core/math.hpp`** (golden tests
  compare WASM vs TS). `sink.ts` — `EngineSink` framework boundary. `types.ts` — C-ABI surface types.

### Inputs — `src/inputs/`
- `input-layer.ts` — composition hub. One rAF loop polls sources, pulls all axes into a vector,
  forwards N→engine. **`MAX_AXES = 32`** (WASM net over-provisioned to 32 inputs). **Dedicated
  dimensions, NO mean-blending** — each active axis drives its own engine slot 1:1; unused slots
  zero-padded (inert). Changing axis count requires a **net reset** (UI confirm modal).
- `base-source.ts` + sources: `xy-pad-source.ts` (push, 2 axes), `gamepad-source.ts` (single=2 /
  double=4 axes, deadzone 0.08), `midi-input-source.ts` (Web MIDI, batch CC-learn, multi-port).
- `useInputLayer.ts` — React binding; manages exclusive input mode + gamepad stick mode + MIDI
  device/learn map; exposes `pushPad`, `sources`, `channelLayout`, etc.
- **Reshape status:** the WASM head is over-provisioned to 32 but the spine's `setInputs` historically
  treated the head as effectively 2-D — confirm current behaviour in `spine.ts`/`input-layer.ts`
  before relying on >2 active dims. See the `manifold-mixed-inputs` memory for the locked design
  (reshapeable net, reset-on-reshape modal, adaptive slider viz when >2 dims).

### Feedback — `src/feedback/`
- `controller.ts` (**~490 lines**) — `FeedbackController`, framework-neutral, owned by ConsoleApp.
  Two modes: **explore-and-place** (default, Mode 2, positive-only — drives the C++ core's
  snapshot/scratchpad/undo lifecycle; caller accumulates anchors and trains on finalise with
  warm-start) and **geometric-dislike** (Mode 1, selectable). Solo/arm via per-output mask.
- `rng.ts` — `SeededRng` (deterministic xorshift32 + gaussian). **Stand-in** until the C++ nudge owns
  the stream — not bit-identical to `nisps::Rng`.
- **`--- C++ GAP ---` markers** flag behaviour approximated in TS pending C++ port: true geometric
  push (firmware k-NN), feedback nudge → `nisps_ml_feedback_nudge`, loss-history plumbing. Grep for
  `C++ GAP` before changing feedback maths.

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
4. **WASM architecture is hardwired at build time** (`nisps/wasm/bindings.cpp`): 2→126 outputs,
   fixed hidden layers, 32 input slots. Requesting other sizes in options is a logged warning, not
   dynamic. Changing it means rebuilding WASM (`bash scripts/build-wasm.sh`) and updating the parity
   test (`tests/cpp/parity_check.cpp`) or parity CI goes red.
5. **`curves.ts` ↔ `nisps/core/math.hpp` must stay lockstep** (golden-vector parity tests).
6. **COOP/COEP headers are mandatory** for the WASM/worklet path — set in `vite.config.ts` for
   dev+preview, and at nginx server scope in prod (inherited by `/next/`).
7. **Never emit "C15"** in code or bundle — the smoke test fails on it. Synth is "Powerful Synth
   Engine"/"Built-in Synth".
8. **Two `MFParam` writers** (stage controls AND dock rows) share one store — edits in either re-render both.

---

## 7. Deeper references (only when this doc isn't enough)

All in `docs/redesign/` (at the repo root, not under `manifold/`):
- `BUILD-PLAN.md` — locked decisions + the 12-step build sequence + spec pointers (the resume anchor).
- `engine-architecture.md` — full engine/spine/WASM design.
- `dock-spec.md` — dock + drawers spec. `inputs-spec.md` — mixed-input design. `backends-spec.md` — backends.
- `rl-feedback-design.md` + `feedback-modes-port-spec.md` + `findings-feedback-behaviour.md` — feedback modes (Mode 1/Mode 2).
- `aimmersive-clone-spec.md` / `playground-2026.md` — the a-immersive feature parity target.
- `src/backends/README.md` — backend wiring notes.

**Memories** (auto-loaded): `manifold-build` (status + locked decisions), `manifold-mixed-inputs`
(N-D input design), `manifold-deploy-pipeline` (the auto-deploy chain), `single-double-joystick-toggle`.

---

*Keep this in sync with the code — update it in the same commit as any change to UI structure, the
engine spine, the dock/drawers, or the build/deploy commands.*
