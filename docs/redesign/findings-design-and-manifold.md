# Findings — Design + Manifold Console: build-oriented brief (Phase-1)

*Read-only synthesis, 2026-06-27, of the five redesign docs + the on-disk Manifold token export + the
`ConsoleApp.jsx` read directly from the design project. VERIFIED = read from a file. INFER = deduced.*

> **Note on the mirror:** as of this audit `docs/redesign/manifold-export/` contains ONLY the six token CSS
> files + `styles.css` manifest. The component/console JSX (ConsoleApp, CompositeStage, Dock, …) is in the
> claude.ai design project and must be pulled via DesignSync before Phase-3 build. `ConsoleApp.jsx` was read
> directly and is summarised in §2.

## Source map (`docs/redesign/`)
- `playground-2.0-rewrite-plan.md` (399ln) — authoritative SolidJS UX+architecture plan: Console IA, drawers,
  reactive spine, feature table, roadmap, open questions.
- `engine-architecture.md` (440ln) — one-engine-two-skins: `EngineApi` headless boundary, reuse table, COOP/COEP,
  build sequence S0–S7.
- `aimmersive-clone-spec.md` (351ln) — faithful clone spec of deployed `a-immersive.html`: feature inventory,
  exact tactile constants, state→store map, engine call points.
- `feedback-modes-port-spec.md` (548ln) — 3-mode "Down Action" ported to `nisps/` as `FeedbackController<MLP_T>`.
- `playground-2026.md` (341ln) — older design-intent doc (dock+drawer, interactive heatmap); reference-only.

> **Framework mismatch:** every planning doc targets **SolidJS**; the mission is a **React** port. The §4 spine
> translation is the largest design decision and biggest risk (§7).

## 1. Manifold design language (VERIFIED — token files)
Pure CSS-custom-property layer; React port imports `styles.css` and references vars directly.
- **Colors:** `--bg #0d0d0d` / `--bg-1..3`. `--fg #e8e8e8` / `--fg-mute` / `--fg-dim`. `--line`/`--line-strong`.
  Accents `--accent #ff6a00` (warm primary), `--accent-2 #00ccff` (cool data/plots), `--accent-3 #ffa860`
  (hover). Semantic `--good #6bc26b`/`--warn #f5c45e`/`--bad #ef5b5b`/`--info #5b9eef`. Console 2.0:
  `--danger #ff4466`, `--glass rgba(13,13,13,0.65)`, `--glass-line rgba(255,255,255,0.07)`. Region pins
  `--pin-1..5`. Glow alphas `--glow-accent/-2/-focus`. **VCV LED-ring palette derives from these** (workstream E).
- **Spacing:** 4px scale `--sp-0..8`=2/4/8/12/16/24/32/48/64. Radius `--r-1 4`/`--r-2 8`/`--r-3 14`/`--r-pill`.
  Z `--z-bg/content/overlay/drawer/modal`. `--control-h 48px`, `--hit-min 44px`.
- **Typography:** mono hero `--font-mono: 'JetBrains Mono',…`; sizes `--fs-xs 11`…`--fs-3xl 48` (body 15);
  letter-spacing `--ls-label 0.08em`/`--ls-wide 0.12em`; `--label-transform uppercase`.
- **Effects:** *"glow halos, not drop shadows, on live elements"* (signature). Easings `--ease`,`--ease-out`,
  `--ease-console`; durations 120/220/360ms; `--glow-sm/md/lg`, `--focus-ring`.
- **Takeaway:** dark, dense, mono-everywhere, orange-primary/cyan-data, glow-halos, uppercase letter-spaced
  labels, glass chrome over a full-bleed canvas. A lint allowlist of these vars is mandated to prevent drift.

## 2. Console shape (ConsoleApp.jsx VERIFIED; rest INFER)
One fullscreen instrument. `focus = in|out|composite|split` drives the convertible stage:
- `focus='in'` → **Manifold** full-bleed stage (input-first), optional top **ReadoutStrip**.
- `focus='out'` → **OutputStage** + **InputMini** corner PiP (output-first).
- `focus='composite'` → **CompositeStage** with a draggable split persisted to `localStorage['mf-composite-split']`;
  `[`/`]` nudge split ±0.04, `=`/`0` reset to 0.5.
- `focus='split'` → **SplitStage**.
- Keyboard: `1-5`→drawers (shape/feel/route/health/help), `\` toggles drawer depth peek↔full, space/↑=commit,
  ↓=perturb, z=undo.
- **Dock** (right 48px rail) with peek/full drawers. **VerdictCluster** (perturb/undo/commit/reroll + A/B
  hold-preview). **AltitudeNav** console|perform|zen. Health glow at screen edge from a `health` signal.
- **Reactive spine (pseudo today):** `infer(pos, seed, params, axes)` = `MF_infer` placeholder in `model.jsx`;
  `values` memo every consumer reads. **Replace `MF_infer` with WasmIML** — that is the core wiring task.

> The updated mission's CONVERTIBLE spec (§1): one continuous view, a single draggable divider where each panel
> demotes its representation by measured width (full manifold → pad → minimap) and a fully-shut side pops out as
> a draggable corner minimap. This refines `CompositeStage`/`OutputStage`/`InputMini` — build to the mission
> spec, using the JSX as the structural starting point.

## 3. Component inventory (port to React)
**Primitives** (12 in the design system, VERIFIED present in the cloud project): Button, Slider, PillToggle,
Panel, Badge, Switch, StatusLine, XYPad, VirtualJoystick, ControlAxis, CurvePlot, Sparkline. Plus a-immersive
craft pieces to add: Heatmap/HeatmapCell (3px drag threshold, pointer-capture, 300ms popup grace — non-negotiable),
NoiseRing, LossPlot (real history → needs new `nisps_ml_loss_history` C API), GradientFlow, WeightHealth,
LayerStats, CurvePad, DualRangeSlider.
**Console shell:** ConsoleApp, Manifold, CompositeStage, SplitStage, OutputStage, InputMini, ReadoutStrip,
VerdictCluster, Dock, Drawers, OutputEditor, AltitudeNav, PerformApp, ZenApp, model.jsx, shared-ui.jsx.
**Schema-driven:** one `GenericMode` reading `ui.primary_input`, `params[].{group,curve,tier}`,
`capability_class`, `output_kind` — replaces the 8-9 cloned mode files.

## 4. Reactive spine → React (load-bearing translation)
SolidJS spine: `inputRaw (signal {equals:false}) → createMemo(processed: deadzone→zoom→curve→smoothing→momentum)
→ createMemo(ml: WasmIML.infer into reused buffer) → createMemo(routed: voice-space + global
curve→smoothing→slew→freeze) → ONE createEffect(backend.send)`. Every consumer reads `ml`/`routed`.

**React translation (recommended):** do NOT use `useMemo`/`useEffect` for the spine — they recompute on render
and per-frame audio inference must not couple to React's scheduler.
1. **Spine lives below React** in a tiny external store (Zustand / `useSyncExternalStore` / hand-rolled
   observable) holding `inputRaw`; derive `processed→ml→routed` **eagerly+synchronously inside the `setInput`
   action**; fire the single `backend.send` at the action tail (off-render).
2. **Expose `EngineApi` via React Context** (`EngineProvider`/`useEngine`); components call `engine.setInput`/
   `engine.feedback.thumbsUp()` and **subscribe** via `useSyncExternalStore(subscribe, () => versionCounter)`
   (version counter, not the array); read the live `Float32Array` imperatively.
3. **Canvas consumers (Manifold/ReadoutStrip/particle-visualiser) bypass React** — read `engine.routedOutput()`
   in one `requestAnimationFrame` loop; rAF touches drawing only, never inference.
4. **Pointer-rate coalescing** stays in the engine (batch to display cadence via microtask).
**E2E invariant (port verbatim):** `__nisps.setInputs([x,y]); expect(getOutputs()).toChange() &&
expect(getEngineParams()).toChange()` in one tick, per mode in CI; + a no-per-frame-alloc heap fuzz.

## 5. a-immersive feature-parity checklist
3 compound axes Boldness/Memory/Precision (per-axis table → ~6 params), trim-pot offsets + re-link, 6 control
presets (Default/First Touch/Jazz Hands/Sculptor/Improviser/Microscope), snapshots→snapshot-DAG (unifies
undo/A-B/trail), A/B compare + Freeze Output, region pins (long-press joymap, `--pin-1..5`), param pins (pin
mask ≠ mute), interactive heatmap, weight health (edge glow), gradient flow, output pipeline (reuse buffer, no
per-frame alloc), session presets, input pipeline (deadzone→zoom→curve→smoothing→momentum), zoom (log/anchor),
joy-map+adaptive grid, vanishing trail+tap-to-return, noise rings, layer-stats, **real** loss plot,
auto-explore+follow, spread/tame Health lab, WebMIDI+OSC-bridge backends, **3-mode→2-mode Down Action** via
`FeedbackController`. **Research-validity fixes:** train on raw model-space outputs not post-pipeline; real
loss history; no phantom input channels; heap-safe WASM.

## 6. COOP/COEP + Vite + React + TS scaffolding
COOP `same-origin` + COEP `require-corp` (dev `server.headers`, `preview.headers`, prod server-scoped on the
nginx vhost). `@vitejs/plugin-react`; `base:'./'` + **base-aware WASM URLs** (`import.meta.env.BASE_URL`, not
hardcoded `/nisps.wasm`); `build.target es2022`, sourcemap. Worklet via **`?worker&url`** (verified fix, commit
`f256217`); two-WASM architecture kept. Strict TS, `tsc --noEmit && vite build`, `@playwright/test`. Assets
`public/nisps.{wasm,js}` from `scripts/build-wasm.sh`. Serve new app at `/next/` sub-path, legacy a-immersive
stays at `/` until sign-off; SPA fallback `try_files`.

## 7. Open risks
1. **Framework mismatch (biggest)** — keep the spine off React's render cycle or live-feedback rot returns.
   Lint-enforce "skins may not import engine internals; engine may not import React".
2. **Console JSX must be pulled** before committing component contracts; `focus`/`zen` vs the plan's
   depth/auto-dissolve vocabulary must be reconciled.
3. **Fixed-2-input contraction** vs the modular N×M mission requirement (F): hardcoded `MLP<2,10,14,18,126>`;
   runtime-shaped MLP deferred behind a passing parity check — confirm scope with Dimi.
4. **Tactile-constant fidelity** (3px threshold, 300ms grace, pointer-capture, double-tap 350ms) — port exactly,
   e2e-test.
5. **Parity drift on core touches** — new FeedbackController C API + real loss-history C API + heap-safe vec all
   touch the parity-tested core; gate every core-touching step on `parity-check.sh` green.
6. **Two preset systems** (visual/RL examples vs synth override tiers) — keep distinct.
7. **Particle visualiser** must be a faithful port of `js/ui/visualizer.js` (workstream E) — exact look+behaviour.
