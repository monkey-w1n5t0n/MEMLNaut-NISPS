# ALIGNMENT

> Opinionated diagnosis of how well the codebase serves its mission, ranked by impact. Dated entries; remove when resolved rather than checking off. **Pruned every few weeks** — a stale diagnosis is worse than none.

## Mission

A research platform for interactive ML control of audio. We're building it to figure out what works and what doesn't — different ergonomics and ergodynamics of parameter sets, modes, ML architectures, audio engines, UI, and UX. Therefore: keep most/all parameters tweakable, ML/engine/UI/UX should each be configurable on their own axis, and the codebase has to enable/assist agentic AI coding patterns (confident changes, verifiable without hardware).

The clean-slate rewrite (2026-04-29) consolidates everything into one C++20 codebase compiling to firmware AND WASM, with SolidJS playground primitives composed into TSX mode components, and JSON schemas as the firmware↔browser parameter contract.

## Top defects (ranked by mission impact)

### 1. Browser-only audio engines incomplete (2026-04-29)

**What.** Stream 9 stubbed `C15Mode` as a placeholder ("C15 mode TODO"). The C15 worklet/bridge from the legacy playground is in `.local/playground-archive/js/synth/` but not wired in. Mic input for XIASRI / SoundAnalysisMIDI is also TODO — the UI renders but doesn't capture audio.

**Why it blocks the mission.** "Browser engines ⊇ firmware engines" was a non-negotiable. Without C15 + mic input, the playground can't fully demonstrate the modes; users can't audition XIASRI or SoundAnalysisMIDI in the browser.

**Rough cost.** ~1–2 days. C15 wiring is mostly straightforward porting from the archived bridge. Mic input requires the engine-host to expose an input stream to the worklet (small worklet refactor).

### 2. Per-iteration loss curve not plumbed through WASM (2026-04-29)

**What.** Stream 7's WASM C API exposes `_nisps_ml_train` but only returns the final loss; `MLP::loss_history()` exists in C++ but isn't reached. `lossHistory` in `mlStore` is a single-element array per training run.

**Why it blocks the mission.** Gradient flow / loss visualization is a core UX affordance for "is the network learning?" — a research-mode debugging tool that's been implemented end-to-end in C++ but stops at the WASM boundary.

**Rough cost.** Half a day. Add `nisps_ml_train_with_history` (or extend the existing call) returning a pointer to the loss array; copy on the JS side.

### 3. WASM MLP architecture is fixed (2026-04-29)

**What.** WASM compiles `MLP<2, 10, 14, 18, 126>` only. Modes with smaller `output_size` use a slice; modes that want different hidden layer shapes (e.g. `[10, 10, 14]` for smaller modes) can't get them in the browser.

**Why it blocks the mission.** Per-mode ML architecture variation is one of our four "research dimensions". The fix isn't urgent for the current mode set (all schemas are within the universal arch's capacity), but the moment we want to experiment with bigger networks or different shapes, this hits.

**Rough cost.** Medium. Either compile multiple WASM modules (one per arch shape; load on demand) or move to a runtime-shaped MLP (loses some compile-time perf). Templates-vs-runtime is a research-vs-firmware-perf tradeoff worth a separate decision doc.

### 4. `NISPS_AUDIO_FUNC` host fallback is misshapen (2026-04-29)

**What.** `nisps/core/perf.hpp` defines `NISPS_AUDIO_FUNC(decl) decl` for the host but the firmware path `__not_in_flash_func(name)` takes only a function name (it stringifies into a section attribute). The two forms don't match. Stream 6 (firmware glue) avoided the macro to dodge the inconsistency, but it's still a footgun.

**Why it blocks the mission.** Future agents touching `nisps/` will hit this. Either decoration form in the codebase is fine; what's wrong is that the same call site shape doesn't work both places.

**Rough cost.** Tiny. Pick one form and apply consistently:
- Option A: `NISPS_AUDIO_FUNC` decorates a function name (e.g. `void NISPS_AUDIO_FUNC(my_callback)(...) { ... }`). Host stub: `#define NISPS_AUDIO_FUNC(name) name`.
- Option B: separate `NISPS_AUDIO_FUNC_BEGIN` / `_END` markers around the function, or a different macro.
Pick A. Update perf.hpp + every `nisps/` use site.

### 5. RMSProp deferred from `nisps/ml/` (2026-04-29)

**What.** The legacy MLP supported both SGD and RMSProp paths. Stream 2 shipped only SGD as MVP. The architecture spec called for both. Documented as "follow-up bd issue when needed".

**Why it blocks the mission.** Optimizer choice is one of the things research wants to vary. Not blocking for the current XOR-style fits, but as soon as we tune for harder loss landscapes, RMSProp will matter.

**Rough cost.** A day. Port the firmware's RMSProp from `src/memlp/MLP.cpp:415-543` (decay 0.9, epsilon 1e-6, gradient accumulation, batch size). Add tests for batch training convergence.

### 6. bd Dolt remote sync flaky (2026-04-29)

**What.** During the rewrite, `bd close` repeatedly failed with "database `beads_meml` not found on Dolt server" or similar lock conflicts. Several agent-side bd closures could not be performed and have orchestrator-side closure notes instead. May leave stream issues in inconsistent states.

**Why it blocks the mission.** Beads is the canonical task tracker; if it can't reliably sync, future agents lose visibility into what's done vs in-progress.

**Rough cost.** Investigate Dolt server config + lock semantics. Out of scope for the rewrite itself.

## Open mission questions

### Q1: Per-mode MLP architectures or one shared shape? (2026-04-29)

Schemas currently declare per-mode `hidden_layers` (some `[10, 10, 14]`, some `[10, 14, 18]`). Browser is fixed at one shape; firmware compiles per-mode. This works for now. Is the mission served by maintaining per-mode shapes (research diversity) or by collapsing to one (simpler ops)?

### Q2: How to express "advanced" features (gradient flow, weight health) without cluttering modes? (2026-04-29)

Current playground reproduces the a-immersive "Advanced" toggle. Power features hide behind it. Is this the right model, or should the mode UI itself decide what's exposed (some modes are "expert-only", some are simpler)?

### Q3: Engine event taxonomy (2026-04-29)

`nisps/modes/base.hpp` exposes a `ControlEvent` ring buffer pop_events interface for sequencer modes (BreakOr, Elysiamorf). Currently events are a flat enum. As we add more event-emitting modes (custom MIDI mappings, lighting, networked control), how should the event vocabulary grow? Open question; revisit when we add the third event-emitting mode.

### Q4: Should the playground stay desktop-first? (2026-04-29)

The original a-immersive was mobile-first ("designed for touch / foldable phone use"). The SolidJS rewrite is desktop-first by default. If the research story is "the user holds a phone and pinches to zoom while a synth runs in their pocket", we'll need a responsive pass. Defer until we have user data.

## Deferred / accepted debt

- **EOC effects chain integration** — out of v1 rewrite (recon flagged as legacy complexity).
- **ShapeSeq sequencer** — gated behind `?shapeseq=1` in legacy; out of v1.
- **Modular engine (Phase E)** — newer JS-side feature in legacy; out of v1.
- **Engine configuration panel** (SPEC-controls Part 8) — backlog. Would let users tune network architecture, loss, optimizer at runtime. Currently compile-time only.
- **VCV Rack module** — used to consume `nisps-core/`. Now gone. If revived, it'd consume `nisps/` directly via CMake; not currently maintained.
- **Negative-feedback "Avoid" uses `move_weights`, not the firmware's k-NN geometric centroid push** (2026-06-18) — porting the 3-mode "Down Action" feature (`nisps/ml/feedback.hpp`, from upstream `InterfaceRL` branch `feat/feedback-explore-modes`) deliberately mapped `Avoid` to the existing `MLP::move_weights` Gaussian perturbation rather than re-porting the old geometric-centroid-toward-liked-prototype push (which depended on a firmware-only `ReplayMemory` with reward accumulation/decay). `RandomiseMlp` likewise uses `draw_weights(spread)` rather than the old asymmetric `RandomiseWeightsAndBiasesLin(-0.9,1.1,-0.9,0.3)`. Accepted divergence — **not a bug**. If richer geometric/contrastive avoidance is wanted later, it belongs in a separate replay-memory component, not `FeedbackController`.

- **Manifold dock splits `state`/`muted`/`armed` into three fields, diverging from the deployed conflated `frozen`↔`muted`** (2026-06-28) — the deployed a-immersive override system maps the heatmap-popup `frozen` and the group-drawer `muted` onto ONE underlying field. The Manifold per-output model (`manifold/src/dock/output-state.ts`, folded onto `MFParam`) deliberately separates them: `status` carries the off/fixed/live tri-state, `muted` is downstream-silence (still computed + visible), `armed` is solo/focus-training. Cleaner semantics; intentional divergence (dock-spec §3.3, open choice 3). Note `muted`-downstream and the `soloMode` gradient-mask variants (mask-gradients / zero-loss / dont-care) are UI+state only so far — the engine C API exposes `set_focus` but not per-mode gradient masking nor a downstream mute gate yet (TODOs in `ConsoleApp.tsx` / `Drawers.tsx` reference rl-feedback-design §3 and dock-spec §3.3).

## Recently resolved (delete after a few weeks)

- 2026-04-29: Three-implementation ML duplication (firmware `memlp`, `nisps-core`, JS engine) collapsed to single `nisps/` C++ codebase.
- 2026-04-29: Firmware mode forks (~280–400 lines duplicated across 8 modes) collapsed via `nisps/modes/base.hpp` CRTP scaffold; concrete modes are now ~50–130 lines.
- 2026-04-29: meml-ues double-scaling MSE bug fixed in `nisps/ml/loss.hpp` + `mlp.hpp`.
- 2026-04-29: `nisps-core/` retired; firmware is the canonical source of truth for ML.
- 2026-04-29: `src/memlp/` submodule deleted.
- 2026-04-29: Legacy playground variants (a-immersive.html, b-workbench, c-journey, designs.html, all `js/`) deleted in favor of SolidJS scaffold.
- 2026-04-29: Native↔WASM parity verified within 1e-5 (max delta 2.4e-7) for representative ML + engine outputs.
