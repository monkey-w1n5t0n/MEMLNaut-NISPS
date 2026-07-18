# ALIGNMENT

> Opinionated diagnosis of how well the codebase serves its mission, ranked by impact. Dated entries; remove when resolved rather than checking off. **Pruned every few weeks** — a stale diagnosis is worse than none.

## Mission

A research platform for interactive ML control of audio. We're building it to figure out what works and what doesn't — different ergonomics and ergodynamics of parameter sets, modes, ML architectures, audio engines, UI, and UX. Therefore: keep most/all parameters tweakable, ML/engine/UI/UX should each be configurable on their own axis, and the codebase has to enable/assist agentic AI coding patterns (confident changes, verifiable without hardware).

The clean-slate rewrite (2026-04-29) consolidated everything into one C++20 codebase compiling to firmware AND WASM. Since 2026-07-13 (P1 of `docs/specs/plans/one-core-engine-refactor.md`) the sole browser app is the React Manifold; the SolidJS playground is archived (`archive/playground-solidjs`). JSON schemas remain the firmware↔browser parameter contract.

## Top defects (ranked by mission impact)

### 1. Browser-only audio engines incomplete (2026-04-29; updated 2026-07-13)

**What.** C15 never got past a stubbed placeholder mode, and with the playground retired at P1 (2026-07-13) it has NO home on main — the stub UI, `c15.wasm`, and `c15-glue.js` live only on branch `archive/playground-solidjs`. Mic input for XIASRI / SoundAnalysisMIDI is likewise not wired in manifold.

**Why it blocks the mission.** "Browser engines ⊇ firmware engines" was a non-negotiable. Without C15 + mic input, manifold can't fully demonstrate the modes; users can't audition XIASRI or SoundAnalysisMIDI in the browser.

**Rough cost.** ~2 days. Reviving C15 now means porting the archived bridge into manifold's engine host. Mic input requires the engine-host to expose an input stream to the worklet (small worklet refactor).

### 2. Per-iteration loss curve not plumbed through WASM (2026-04-29)

**What.** Stream 7's WASM C API exposes `_nisps_ml_train` but only returns the final loss; `MLP::loss_history()` exists in C++ but isn't reached. `lossHistory` in `mlStore` is a single-element array per training run.

**Why it blocks the mission.** Gradient flow / loss visualization is a core UX affordance for "is the network learning?" — a research-mode debugging tool that's been implemented end-to-end in C++ but stops at the WASM boundary.

**Rough cost.** Half a day. Add `nisps_ml_train_with_history` (or extend the existing call) returning a pointer to the loss array; copy on the JS side.

### 4. `NISPS_AUDIO_FUNC` host fallback is misshapen (2026-04-29)

**What.** `nisps/core/perf.hpp` defines `NISPS_AUDIO_FUNC(decl) decl` for the host but the firmware path `__not_in_flash_func(name)` takes only a function name (it stringifies into a section attribute). The two forms don't match. Stream 6 (firmware glue) avoided the macro to dodge the inconsistency, but it's still a footgun.

**Why it blocks the mission.** Future agents touching `nisps/` will hit this. Either decoration form in the codebase is fine; what's wrong is that the same call site shape doesn't work both places.

**Rough cost.** Tiny. Pick one form and apply consistently:
- Option A: `NISPS_AUDIO_FUNC` decorates a function name (e.g. `void NISPS_AUDIO_FUNC(my_callback)(...) { ... }`). Host stub: `#define NISPS_AUDIO_FUNC(name) name`.
- Option B: separate `NISPS_AUDIO_FUNC_BEGIN` / `_END` markers around the function, or a different macro.
Pick A. Update perf.hpp + every `nisps/` use site.

### 5. RMSProp deferred from `nisps/ml/` (2026-04-29)

**What.** The legacy MLP supported both SGD and RMSProp paths. Stream 2 shipped only SGD as MVP. The architecture spec called for both. Documented as a follow-up Ergo task when needed.

**Why it blocks the mission.** Optimizer choice is one of the things research wants to vary. Not blocking for the current XOR-style fits, but as soon as we tune for harder loss landscapes, RMSProp will matter.

**Rough cost.** A day. Port the firmware's RMSProp from `src/memlp/MLP.cpp:415-543` (decay 0.9, epsilon 1e-6, gradient accumulation, batch size). Add tests for batch training convergence.

## Open mission questions

### Q1: Per-mode MLP architectures or one shared shape? (2026-04-29)

Schemas declare per-mode `input_size`/`hidden_layers`/`output_size` (some hidden `[10, 10, 14]`, some `[10, 14, 18]`; inputs 4 or 10; outputs 24–56). As of P5.3 BOTH targets honour them: firmware compiles per-mode, and the browser now reshapes the runtime-shaped WASM net to the active mode's `ml` config on mode switch (was fixed at one 32→126 shape). This works for now. Is the mission served by maintaining per-mode shapes (research diversity) or by collapsing to one (simpler ops)?

### Q2: How to express "advanced" features (gradient flow, weight health) without cluttering modes? (2026-04-29)

The retired playground reproduced the a-immersive "Advanced" toggle; manifold hides power features in drawers instead. Is this the right model, or should the mode UI itself decide what's exposed (some modes are "expert-only", some are simpler)?

### Q3: Engine event taxonomy (2026-04-29)

`nisps/modes/base.hpp` exposes a `ControlEvent` ring buffer pop_events interface for sequencer modes (BreakOr, Elysiamorf). Currently events are a flat enum. As we add more event-emitting modes (custom MIDI mappings, lighting, networked control), how should the event vocabulary grow? Open question; revisit when we add the third event-emitting mode.

### Q4: Should the browser app (manifold) stay desktop-first? (2026-04-29)

The original a-immersive was mobile-first ("designed for touch / foldable phone use"). The SolidJS rewrite is desktop-first by default. If the research story is "the user holds a phone and pinches to zoom while a synth runs in their pocket", we'll need a responsive pass. Defer until we have user data.

## Deferred / accepted debt

- **EOC effects chain integration** — out of v1 rewrite (recon flagged as legacy complexity).
- **ShapeSeq sequencer** — gated behind `?shapeseq=1` in legacy; out of v1.
- **Modular engine (Phase E)** — newer JS-side feature in legacy; out of v1.
- **Engine configuration panel** (SPEC-controls Part 8) — backlog. Would let users tune network architecture, loss, optimizer at runtime. Currently compile-time only.
- **VCV Rack module** — used to consume `nisps-core/`. Now gone. If revived, it'd consume `nisps/` directly via CMake; not currently maintained.
- **Geometric-dislike deliberate divergences** (2026-07-14, one-core-engine P3; supersedes and RETRACTS the 2026-06-18 "Avoid = move_weights, geometric push not ported" note — the k-NN centroid push IS now ported, upstream `InterfaceRL` @ `0a541cc`, into `nisps/ml/{replay,geo_push}.hpp` + `feedback.hpp` `AvoidStyle::Geometric` default). Two divergences are by design:
  1. The upstream `useRandom` degenerate branch (disliked action exactly on the centroid) draws from the controller's deterministic `nisps::Rng`, not libc `rand()` — native==WASM parity holds (parity Stage 6); the value is generated, never compared against upstream.
  2. Upstream trains via async `optimise()` with shuffled `TrainBatch` over positive+geometric batches at two LRs; nisps collapses press+optimise into ONE synchronous `dislike_geometric()` that trains only the pressed negative's target (per-sample SGD, no shuffle). Behavioural — not bitwise — parity with firmware upstream, by design; `native == WASM` is pinned at 1e-5 instead.
  Also: `RandomiseMlp` still uses `draw_weights(spread)` rather than the old asymmetric `RandomiseWeightsAndBiasesLin(-0.9,1.1,-0.9,0.3)` (unchanged accepted divergence).

- **Manifold dock splits `state`/`muted`/`armed` into three fields, diverging from the deployed conflated `frozen`↔`muted`** (2026-06-28) — the deployed a-immersive override system maps the heatmap-popup `frozen` and the group-drawer `muted` onto ONE underlying field. The Manifold per-output model (`manifold/src/dock/output-state.ts`, folded onto `MFParam`) deliberately separates them: `status` carries the off/fixed/live tri-state, `muted` is downstream-silence (still computed + visible), `armed` is solo/focus-training. Cleaner semantics; intentional divergence (dock-spec §3.3, open choice 3). Note `muted`-downstream and the `soloMode` gradient-mask variants (mask-gradients / zero-loss / dont-care) are UI+state only so far — the engine C API exposes `set_focus` but not per-mode gradient masking nor a downstream mute gate yet (TODOs in `ConsoleApp.tsx` / `Drawers.tsx` reference rl-feedback-design §3 and dock-spec §3.3).

## Recently resolved (delete after a few weeks)

- 2026-07-18: Browser curve maths unified onto the canonical `nisps/core/math.hpp` catalog at P4. The retired TS mirror had silently divergent maths for `exp`/`log` (k=4 vs the C++ k=1-normalised pair), `sigmoid` (slope 8 vs 6) and `cubic` (smoothstep vs x³) — browser-shaped params now behave firmware-exact. `linear/square/sqrt/centred-power` were already identical; the four changed curves were re-baselined in `manifold/tests/fixtures/curves-golden.json`.

- 2026-07-14: Defect "WASM MLP architecture is fixed" resolved by one-core-engine P2: `nisps/ml/` is storage-policied (`MLPCore<Storage>`); the browser MLP is runtime-shaped (`DynamicStorage`), `nisps_ml_create` honours dims, `nisps_ml_reshape` warm-starts. Firmware keeps the zero-heap fixed template (`.text` +0.30%, within contract).

- 2026-04-29: Three-implementation ML duplication (firmware `memlp`, `nisps-core`, JS engine) collapsed to single `nisps/` C++ codebase.
- 2026-04-29: Firmware mode forks (~280–400 lines duplicated across 8 modes) collapsed via `nisps/modes/base.hpp` CRTP scaffold; concrete modes are now ~50–130 lines.
- 2026-04-29: meml-ues double-scaling MSE bug fixed in `nisps/ml/loss.hpp` + `mlp.hpp`.
- 2026-04-29: `nisps-core/` retired; firmware is the canonical source of truth for ML.
- 2026-04-29: `src/memlp/` submodule deleted.
- 2026-04-29: Legacy playground variants (a-immersive.html, b-workbench, c-journey, designs.html, all `js/`) deleted in favor of SolidJS scaffold.
- 2026-04-29: Native↔WASM parity verified within 1e-5 (max delta 2.4e-7) for representative ML + engine outputs.
