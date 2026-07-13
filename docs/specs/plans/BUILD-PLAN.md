---
kind: plan
status: active
---

# Manifold — Build Plan & Locked Decisions (resume anchor)

*Dated 2026-06-27. This is the single resume anchor for the Manifold convertible-app build. Read this + the
specs it points to before continuing. Mission: one working browser instrument putting the NEW Manifold
"convertible" front-end on top of the REAL parity-tested ML+audio engine.*

## Locked decisions (operator-confirmed 2026-06-27)
| Decision | Choice |
|---|---|
| App directory | `manifold/` (Vite + React + TS), beside `playground/` until parity + sign-off |
| Engine to wire | The parity-tested **TS engine** (`playground/src/ml/wasm-iml.ts` + `audio/engine-host.ts` + worklet), same `nisps/` core the firmware builds from |
| Staging deploy | `meml.lnfinitemonkeys.org/next` (server-scope COOP/COEP already set); live a-immersive stays at `/` |
| Default FEEDBACK_MODE | **Explore & place** (Mode 2, positive-only); Geometric-dislike selectable |
| Default SOLO/arm | **Mask-gradients / column-freeze** (variant a); ZeroLoss + DontCareExample selectable |
| Modular N×M MLP | ~~**Multiple WASM modules + warm-start** ({2,4} then {2,4,8}); NOT runtime-shaped, NOT padded~~ **SUPERSEDED 2026-07-13** by `one-core-engine-refactor.md` §1: runtime-shaped MLP in browser (warm-start retained), fixed template on hardware |
| VCV bridge transport | **WS↔OSC bridge server** (reuse existing Deno bridge; bidirectional training) |
| Synth UI label | **"Powerful Synth Engine"** — the string "C15" must NEVER appear in the UI |
| Product copy | British spelling (randomise, visualise, colour) |

## Spec docs (now in docs/specs/ and subdirs)
- `docs/adr/rl-feedback-design.md` — the learning engine (both modes + solo); **§1 = verified ground truth: the feedback
  C API, `MLHandle.feedback`, `0xFEEDBACC0DE` salt, parity Stage 5, and `CMakeLists.txt:59` registration ALL
  ALREADY EXIST** — edit/extend, don't re-scaffold. Mode 1 ports to upstream **`0a541cc`** InterfaceRL.
- `dock-spec.md` — six drawers + per-output control row + tri-state semantics + advanced modals.
- `backends-spec.md` — `OutputBackend` adapter interface; **VCV module already at `vcv/` (2-in/12-out)** →
  evolve to 8→16 + LED rings; faithful `visualizer.js` particle port (algorithm documented).
- `inputs-spec.md` — modular XY/WebMIDI/gamepad; multiple-WASM-module reshape with warm-start.
- `recon/findings-{feedback-behaviour,engine-surface,design-and-manifold}.md` — Phase-1 audits.
- `recon/upstream-firmware-survey.md` — git topology; latest InterfaceRL = `0a541cc`.
- `plans/playground-2.0-rewrite-plan.md`, `engine-architecture.md`, `aimmersive-clone-spec.md`,
  `feedback-modes-port-spec.md` — the prior planning corpus.

## Reactive spine → React (load-bearing, from findings-design-and-manifold.md §4)
Spine lives BELOW React in an external store: `setInput` action derives processed→ml→routed eagerly+synchronously
and fires the single `backend.send` at its tail (off-render). React subscribes via `useSyncExternalStore`
(version counter, not the array); canvases (Manifold/particles) read in one rAF loop. `EngineApi` exposed via
React Context. Lint rule: skins may not import engine internals; engine may not import React.

## Phase-3 build sequence (each step keeps live a-immersive up; gate core touches on parity-check.sh @1e-5)
1. **Pull Manifold JSX mirror** — DesignSync (session-bound) → `docs/redesign/manifold-export/` (only tokens on
   disk now; pull `components/**`, `ui_kits/memlnaut/**` incl. `console/**`).
2. **Scaffold** `manifold/` — Vite + `@vitejs/plugin-react` + strict TS, COOP/COEP dev+preview headers,
   `base:'./'` + base-aware WASM URLs, worklet via `?worker&url`, copy `public/nisps.{wasm,js}`.
3. **Engine adapter** — lift `WasmIML` + `EngineHost` + worklet + input/output pipelines from `playground/src`;
   replace Solid `mlStore`/`coreBus` side-effects with an injected emitter; build the framework-neutral
   `EngineApi` + the external-store reactive spine + React `EngineProvider`/`useEngine`.
4. **Primitives** — port the 12 design primitives (Button/Slider/PillToggle/Panel/Badge/Switch/StatusLine/
   XYPad/VirtualJoystick/ControlAxis/CurvePlot/Sparkline) from window-global JSX to ES-module React/TS + tokens.
5. **Console convertible shell** — ConsoleApp/CompositeStage/SplitStage/OutputStage/InputMini/Manifold/Dock/
   Drawers/VerdictCluster/ReadoutStrip/AltitudeNav (+Perform/Zen). Replace `MF_infer` with real engine. The
   single draggable divider with width-based representation demotion (full manifold → pad → minimap) is the centre.
6. **Dock real contents** (dock-spec) — six drawers, per-output control rows, tri-state, advanced modals.
7. **Modular inputs** (inputs-spec) — InputSource adapters (XY/WebMIDI/gamepad), N-channel pipeline, multi-module
   warm-start rebuild.
8. **Backends** (backends-spec) — OutputBackend adapters: Powerful Synth Engine, particle visualiser (faithful
   port), WebMIDI, OSC (reuse Deno bridge), CV/gate.
9. **Feedback engine** (rl-feedback-design) — TS-prototype-first (audible directional-away + interpolate-between-
   corners are pass/fail oracles via existing WasmIML primitives) → C++ core (ReplayStore + train-toward-targets
   + solo column mask) → C API → TS FFI → dock selector. Every core step gated on parity.
10. **VCV module** — evolve `vcv/` to 8→16 + LED-ring widget (palette from tokens) + WS↔OSC bridge +
    bidirectional training.
11. **e2e** — `window.__nisps` synchronous probe + Playwright (spine invariant: setInputs → outputs+params
    change in one tick; no-per-frame-alloc fuzz).
12. **Deploy** `/next`, MAP.md + ALIGNMENT.md + CLAUDE.md sync, hand operator URL. Archive playground only after
    parity + sign-off.

## Animations (workstream G, parallel to build) — Manim skill at ~/src/hermes-agent/skills/creative/manim-video
Knob 1:1 · XY→2 numbers · dimensionality fan-out (knob/fader/touchpad/2D/3D joystick) · feedback contrast
(geometric push-away vs explore-and-place). Plus interactive in-app onboarding demos. Feedback piece reflects
the locked default (Explore & place).

## Manifold mirror status (docs/redesign/manifold-export/) — updated 2026-06-27
PRESENT on disk: all 6 token CSS + styles.css; 12 primitives (components/{core,control,data}/*.jsx);
console kit — ConsoleApp, CompositeStage, SplitStage, OutputStage, InputMini, Manifold, model, shared-ui,
Dock, Drawers, OutputEditor, VerdictCluster, ReadoutStrip, CurvePad.
STILL TO PULL via DesignSync (non-core; project id 49091559-c3ce-47cb-a14f-08d62c26fe09): console PerformApp.jsx,
ZenApp.jsx; ui_kits/memlnaut top-level (App, ModeView, OutputBars, TopBar, TrainingPanel); output-routing/
(Editor, model, parts, variants); support.js; the specimen *.html. These are altitude/alt-routing variants and
specimens — not needed for the core convertible Console build (steps 2-9). Pull when building Perform/Zen
altitudes or the routing-matrix Full modal.

Key port notes from the mirrored JSX:
- CompositeStage IS the convertible: single `split` ratio ∈[0,1], SNAPS [0.14,0.33,0.5,0.66,0.86] w/ magnetism,
  SHUT=0.1 collapses a side to a draggable corner minimap; tier demotion by measured width (full→pad / field→list).
- model.jsx `MF_infer` is the sin/cos placeholder to REPLACE with WasmIML; it still lists a `c15` mode labelled
  "C15" → relabel to "Powerful Synth Engine" (and the synth backend everywhere).
- Drawers.jsx = the PLACEHOLDER drawers (Shape/Feel/Route/Health/Help) → replace with dock-spec's six real drawers.
- OutputEditor/OutputStage/ReadoutStrip already implement the off/fixed/live tri-state + per-output min/max/curve
  + alt-click cycle — the baseline the dock-spec per-output control row formalises (add mute + solo/arm).
- Components use `window.*` globals + `window.ManifoldDesignSystem_490915` — convert to ES-module imports.

## Build status — 2026-06-27 (Phase-3 in progress)
DONE + verified (typecheck+build green): scaffold `manifold/`; engine layer (framework-neutral EngineApi +
reactive spine + EngineProvider/useEngine + window.__nisps probe; added the missing nisps_ml_feedback_* TS
bindings — no C change); 12 primitives; convertible Console shell (ConsoleApp/CompositeStage/etc) wired to the
real engine (MF_infer replaced; default mode = Explore-and-place; synth = "Powerful Synth Engine", 0 "C15" in
bundle). **DEPLOYED to https://meml.lnfinitemonkeys.org/next/** (docroot subdir of meml-aimmersive, no nginx
change; COOP/COEP inherited; live a-immersive untouched at /). To redeploy: `cd manifold && bun run build` then
`rm -rf /home/w1n5t0n/deployments/meml-aimmersive/next && cp -r manifold/dist /home/w1n5t0n/deployments/meml-aimmersive/next && cp .../next/index.html .../next/a-immersive.html` (the a-immersive.html copy satisfies nginx `index a-immersive.html` so /next/ resolves).

CAVEAT — e2e not yet run on the VPS: headless Chromium needs `libnspr4`/`libnss3` which aren't installed and
need operator sudo (`sudo bunx playwright install-deps chromium`, or run e2e on the laptop/CI). The smoke spec is
written at `manifold/tests/e2e/smoke.spec.ts` (asserts: engine WASM loads, spine invariant setInputs→outputs
change, feedback runs, console renders, no "C15"). Serving smoke (HTML+COOP/COEP+wasm) passed via curl. Operator
should verify the live runtime in a real browser at /next/.

REMAINING Phase-3+: real dock contents (dock-spec) · modular inputs (inputs-spec) · output backends + particle
port (backends-spec) · feedback C++ engine (rl-feedback-design, TS-prototype-first) · VCV module · full e2e ·
animations (G). Then MAP.md/ALIGNMENT.md sync + commit + operator sign-off → archive playground.

## Build status update — 2026-06-28
ADDED + verified (typecheck+build green, redeployed to /next): real dock contents (six drawers + OutputControlRow
with off/fixed/live + mute + solo/arm + dual-range + curve, unified output-state store, per-backend advanced
modals, feedback-mode + solo + audio wired) AND the feedback-engine TS prototype (manifold/src/feedback/:
FeedbackController — Explore-and-place scratchpad loop snapshot→randomise/nudge→place-at-chosen-location→
warm-start anchor interpolation, undo ring, geometric-dislike mode, example-level solo respect; SeededRng;
mode-aware VerdictCluster + Manifold pick-location state). C++ crystallisation gaps tagged inline `--- C++ GAP ---`
→ rl-feedback-design §4 (replay store, k-NN geo-push, train_masked column-freeze). ALIGNMENT.md got the
output-state divergence note from the dock agent.
STILL REMAINING: backends + particle visualiser port (E), modular MIDI/gamepad inputs (F), VCV module (E),
C++ feedback crystallisation (B phase 2, gated on parity), full browser e2e (needs libnspr4 via operator sudo),
Manim animations (G), MAP.md sync + commit + sign-off → archive playground.

## RUNTIME VERIFIED — 2026-06-28 ✅
The /next deploy is browser-verified: the e2e smoke (manifold/tests/e2e/smoke.spec.ts) PASSES — engine WASM
loads, spine invariant holds (setInputs→outputs change), feedback runs, console renders, no "C15", no errors.
Two runtime bugs found+fixed in the lifted engine:
1. assetUrl resolved against location.origin → dropped the /next sub-path. FIXED: resolve against document.baseURI
   (main thread) + pass the deploy base to the async-train worker via its init message.
2. nisps.js is Emscripten MODULARIZE glue with NO ES6 exports — import() yields an empty namespace. FIXED:
   fetch + indirect-eval the glue to install global createNispsModule (works on main thread AND module worker).
   (The playground's identical import()-based loader has the same latent flaw — worth fixing there too.)
E2E INVOCATION on this VPS (bun runs under snap confinement that hides system libs from its Chromium subprocess;
run the test RUNNER via non-snap node, browsers under the bun cache path):
  cd manifold && (bun run preview &)
  PLAYWRIGHT_BROWSERS_PATH=/home/w1n5t0n/snap/bun-js/87/.cache/ms-playwright node node_modules/.bin/playwright test

## Build status update — 2026-06-28 (later)
DEPLOYED + e2e-verified to /next, all green:
- Dock RESTRUCTURED (operator): top Mode selector (Particle System[default]/MIDI/OSC/Built-in Synth/MEMLNaut
  Editor) + 5 vertically-centred drawers (Learning/Inputs/Outputs/Settings/Help). Old Synth/Visual drawers folded
  into per-Mode config in Outputs.
- Settings drawer: monochrome icons (focused orange / unfocused off-white|white|orange), input-map rect↔circular
  toggle, corner-radius slider (default 2px, overrides --r-1/--r-2 on :root). Store: manifold/src/settings/.
- Feedback markers on the 2D map: positive (filled dot) + negative (open red ring) at their input location.
- Monochrome SVG icon set (manifold/src/console/icons.tsx, currentColor).
- MEMLNaut Editor mode: Web Serial USB scaffold (manifold/src/serial/, stub).
- MIDI + OSC backends REAL: manifold/src/backends/ (OutputBackend + BackendManager consuming the spine; WebMIDI
  out w/ per-output CC#/ch/name/range; OSC-over-WS to the Deno bridge in manifold/osc-bridge/). Outputs panel
  SPECIALISES per backend (dock/OutputsBackendConfig.tsx) + named presets (backends/presets.ts, per-backend
  localStorage). Audio gated via engine.audio.setMuted on non-synth modes.
Naming: synth shows as "Built-in Synth" (operator's latest wording; still never "C15").
REMAINING: faithful particle-system port (Particle System is default Mode — currently passthrough/no flow field
yet), modular MIDI/gamepad INPUTS (F), VCV module (E), C++ feedback crystallisation (B ph2, parity-gated), Manim
animations (G), MAP/ALIGNMENT sync + commit + sign-off → archive playground. Nothing committed yet.

## VCV module — BUILT 2026-06-28 ✅
vcv/ evolved 2→12 → **8 inputs × 16 outputs**, **compiles + links** against Rack SDK 2.6.4
(installed at ~/.local/share/Rack2/Rack-SDK; `cd vcv && RACK_DIR=$HOME/.local/share/Rack2/Rack-SDK make` →
plugin.so 2.4MB). Per-output **LED rings** (src/LedRing.hpp, drawLayer+nvgArc, proportional fill + glow),
**palette.hpp** from frontend tokens (16-step orange→cyan ramp). **WS↔OSC bridge** (src/osc_server.hpp) verbs
/nisps/{input,output,feedback,weights,examples,state}, default UDP 7001+id%64, routed through the SAME
doThumbsUp/Down/enqueueJob paths as the panel — trainable from BOTH VCV and the browser. Retired nisps-core
resolved by **vendoring src/iml.hpp** (self-contained runtime IML, firmware-aligned semantics but not bit-identical
— follow-up). Derived outputs moved behind a context-menu toggle. TODOs: browser-side /nisps/feedback emission;
redraw panel SVG art for 8/16 (coords relaid in code); align vendored IML optimiser to nisps/ml bit-exactly.
REMAINING overall: faithful particle-system port, modular MIDI/gamepad inputs (F), C++ feedback crystallisation
(B ph2), Manim animations (G), MAP/ALIGNMENT sync (done this round) + commit + sign-off.

## Explore-and-place CRYSTALLISED to shared C++ core — 2026-06-28 ✅ (parity-verified independently)
nisps/ml/feedback.hpp gained FeedbackMode::ExploreAndPlace + Idle/Exploring/Placing state machine (no-heap,
nisps::Rng, .f). Granular methods (enter_explore/exit_explore/reroll/nudge/undo/begin_place/commit_place/
cancel_place) for firmware button-mapping + on_down/on_up browser default policy. Controller owns weights+
scratchpad+undo-ring+frozen placed_out_; caller owns add_example+train. C API + EXPORTED_FUNCTIONS added.
VERIFIED (orchestrator re-ran, not agent's word): native ctest 4/4; fresh build-wasm + parity-check.sh = PASS
821 floats within 1e-5 (max 2.4e-7), parity Stage 5d exercises enter→reroll→nudge→undo→place→commit. Fixed bug:
set_mode(3) fell back to Avoid. nisps.wasm synced to playground/public + manifold/public (md5-identical).
manifold/src/feedback/controller.ts REWIRED to call the shared core (TS scratchpad deleted) — app explore-and-place
is now firmware-identical; e2e green; redeployed /next. Firmware glue (peripherals.hpp) wired to the hardware flow
(down=enter/exit explore, reroll+nudge buttons, like=begin place, up=commit) — NOT compiled (no arduino-cli);
Placing-audition static_output() hook is a flagged follow-up. Mode 1 (geometric dislike) untouched.
REMAINING: faithful particle-system port, modular MIDI/gamepad inputs (F), Manim animations (G), firmware build
+ flash verification, browser-side /nisps/feedback VCV bridge emission, commit + sign-off.
