# ALIGNMENT

> Opinionated diagnosis of how well the codebase serves its mission, ranked by impact. Dated entries; remove when resolved rather than checking off. **Pruned every few weeks** — a stale diagnosis is worse than none.

## Mission

A research platform for interactive ML control of audio. We're building it to figure out what works and what doesn't — different ergonomics and ergodynamics of parameter sets, modes, ML architectures, audio engines, UI, and UX. Therefore: keep most/all parameters tweakable, ML/engine/UI/UX should each be configurable on their own axis, and the codebase has to enable/assist agentic AI coding patterns (confident changes, verifiable without hardware).

**Target vision (operator, 2026-07-20):** (1) one C++20 NISPS core serving RP2350 firmware and the browser, performance-sensitive on the MCU; (2) firmware modes runnable as modes in Manifold; (3) Manifold defaults to curated presets/modes, with the maximalist surface behind an "advanced" dev mode used to author them; (4) PlatformIO for hardware, no more .ino; (5) Manifold doubles as interface/editor for the hardware MEMLNaut (settings, presets, training, examples, visualisation).

The clean-slate rewrite (2026-04-29) consolidated everything into one C++20 codebase compiling to firmware AND WASM. Since 2026-07-13 (P1) the sole browser app is the React Manifold. JSON schemas remain the firmware↔browser parameter contract. A full-repo audit (2026-07-21, `docs/specs/recon/simplification-audit-2026-07.md`) grounds the entries below; mitigations are phased in `docs/specs/plans/simplification-plan.md`.

## Top defects (ranked by mission impact)

### 1. The verification story is void: CI red for a month, unpushed load-bearing commits, ungated deploys (2026-07-21)

**What.** CI has been 100% failing on main since 2026-07-13: the memllib submodule pin (`b37fc53`, local branch `feat/nisps-core-swap`) is reachable from no remote, so GitHub checkout dies before any gate runs — and those three firmware-critical commits exist only on this one disk. Meanwhile push-to-main deploys straight to `meml.lnfinitemonkeys.org/next/` via webhook with no gate, shipping the *committed* `manifold/public/nisps.wasm`, which has no freshness check. All P4–P6 "gates green" claims rest on local runs.

**Why it blocks the mission.** "Verifiable without hardware" and "confident agentic changes" are the mission's operating premises; both are currently fiction at the remote/deploy boundary. One disk failure loses firmware-critical code.

**Rough cost.** Half a day (plan §1): push the branch to the `monkey-w1n5t0n/memllib` fork, repoint `.gitmodules`, confirm green, add codegen + WASM-freshness steps; deploy gating is an operator decision (plan §7.4).

### 2. The mode layer is not shared: WASM re-orchestrates modes by hand (2026-07-21)

**What.** `nisps/modes/` — the CRTP layer binding ML config, engine, voice-space and I/O — compiles only into firmware. `nisps/wasm/bindings.cpp` includes engines and ML primitives but zero mode headers, and Manifold re-assembles mode behaviour (jolt stepping, OU, routing) in TS. "Firmware and WASM share the same modes" is true only at the engine level; every ModeBase behaviour must be mirrored browser-side by hand.

**Why it blocks the mission.** Vision bullet 2 is precisely this. Until the control-tick orchestration exists once in C++, every new mode behaviour is a dual implementation with drift risk.

**Rough cost.** Spec first, then ~a week: storage-policy the ModeBase orchestration the way P2 did MLPCore (verified shape in plan §6.5a — *not* binding monolithic mode objects, which would contradict the locked two-instance RT architecture). Related honesty gap: Manifold currently catalogues 4 modes that structurally cannot run in the browser (no mic input, event-only engines) — plan §6.5b (absorbs the old C15/mic-input defect; C15 itself lives on `archive/playground-solidjs`).

### 3. No curated/advanced split and no in-UI mode picker — the UI fights vision 3 (2026-07-21)

**What.** Manifold is 100% dev-maximalist: five drawers of everything, no preset data model to author against, and mode switching exists only via the debug hook — there is no instrument picker in the UI at all (the plumbing, `ctx.modes`/`setModeId`, already exists unused). A stratum of decorative controls (training-param sliders, master volume, bpm, A/B, snapshots, fabricated gradient health) renders real-looking UI that drives nothing.

**Why it blocks the mission.** The default experience is supposed to be curated presets; the advanced surface is the authoring tool. Neither exists, and the decorative stratum actively misleads research use.

**Rough cost.** Product-model decision first (plan §7.6), then incremental: picker is days; the curated-preset model seeds from `backends/presets.ts` + schemas; disclosure via per-drawer depth levels. Deleting the decorative stratum is part of the Phase-1 sweep.

### 4. Arduino-CLI build machinery is actively hostile — vision 4 unstarted (2026-07-21)

**What.** The build script sed-mutates the committed `.ino` to select variants (polluting history), the mode list is triple-bookkept (a `NISPS_ST_*` token-paste table is already silently missing the currently-active SLPWorkshop variant), a symlink forest works around Arduino's include rules, and the toolchain globally mutates the installed TFT_eSPI library. Firmware compilation is in no automated gate anywhere.

**Why it blocks the mission.** Fragile-by-design builds are the opposite of "confident agentic changes"; the vision names PlatformIO explicitly. `firmware/useq-celium/` already proves the PIO pattern in-repo.

**Rough cost.** 2–3 days, one cut (plan §5): env-per-variant `platformio.ini`, delete ~400 lines of hackery, then a firmware CI job. Gated on the memllib ownership decision (plan §7.5).

### 5. Manifold-as-hardware-editor is a facade (2026-07-21)

**What.** Vision bullet 5 exists as a 237-line Web Serial shell: sound connect lifecycle, zero protocol (`saveModel`/`restoreModel`/`getSettings` are literal stubs), and firmware has no serial command surface or on-device persistence to talk to.

**Why it blocks the mission.** The hardware research loop (train on device, inspect/curate in browser) is closed only by this bridge.

**Rough cost.** Week+, spec-first (plan §6.5d). The right discipline already exists in-repo: useq-celium's C-header wire truth + TS mirror + parity test; settings payloads should derive from schema codegen.

### 6. Dead mass and registry sprawl across every layer (2026-07-21)

**What.** The audit's aggregate: ~40% of `feedback.hpp` is legacy modes nothing reaches; a dead four-way focus/altitude UI system; ~25 unconsumed ConsoleCtx fields; a dozen dead WASM API entries threaded through a 5-file registration chain; daisysp compiled into every firmware build with zero consumers; retired-playground artifacts and dead planning relics tracked at root; mode identity spread across ~6 hand-maintained registries with demonstrated drift; assorted stale specs presenting a deleted world as present tense.

**Why it blocks the mission.** Every dead path is agent-confusing surface area and drift risk; the registries are dual-truth bugs waiting to fire (one already did: the selftest table).

**Rough cost.** Plan phases 1–3 (~a week total, mostly mechanical deletions with green gates). Behaviour bugs found en route (dataset-cap divergence 100 vs 128 + OOB read, VCV 2-D input truncation, VCV audio-thread race + JSON) are plan §3.

### 7. No performance measurement despite a performance-defined mission (2026-07-21)

**What.** The "super performance-sensitive" constraint is enforced only by static discipline (no-heap lint — itself with proven false negatives — and section attrs, 3/5 of which are dead macros). No benchmark, no CPU-load assertion, no flash/RAM size report on either target; the 16 KB dead buffer was found by reading, not by any gate.

**Rough cost.** ~A day for a host-side blocks-per-second benchmark + a per-variant size report in `build-firmware.sh` (plan §6.5f).

### 8. Training-health telemetry: one product decision fragmented into four half-features (2026-07-21)

**What.** A 16 KB loss-history buffer in every firmware MLP that nothing reads; a WASM worker faking a 1-element loss history; decorative gradient-health UI; and a real `get_layer_stats` API plumbed end-to-end and consumed by nobody.

**Why it blocks the mission.** "Is the network learning?" is a core research affordance — currently it *looks* answered while being fake. Decide feature-or-delete once (plan §7.3) and collapse all four limbs accordingly.

### 9. RMSProp still deferred from `nisps/ml/` (2026-04-29; reaffirmed 2026-07-21)

**What.** `training.hpp` ships SGD only; the legacy firmware used RMSProp for `TrainBatch`. Optimizer choice is a research axis. Not blocking current fits; will matter for harder loss landscapes. Port target: upstream MusicallyEmbodiedML `memlp` (the in-repo `src/memlp` copy is deleted; use the GitHub remote or archive branch).

**Rough cost.** A day, plus batch-convergence tests.

## Open mission questions

### Q1: Per-mode MLP architectures or one shared shape? (2026-04-29)

Schemas declare per-mode dims and since P5.3 both targets honour them. Is the mission served by maintaining per-mode shapes (research diversity) or collapsing to one (simpler ops)? Note the audit found all 9 mode schemas share copy-pasted ML defaults and 20 params are anonymous placeholders — the per-mode diversity is currently nominal (plan L40).

### Q2: Engine event taxonomy (2026-04-29)

`ControlEvent` is a flat enum consumed by the two sequencer modes. Revisit when a third event-emitting mode lands.

### Q3: Should Manifold stay desktop-first? (2026-04-29)

Legacy a-immersive was mobile-first; Manifold is desktop-first. Defer until user data exists.

### Q4: Who owns memllib? (2026-07-21)

Fork-pin (PIO `lib_deps` on `monkey-w1n5t0n/memllib`), vendor the actually-used subset, or upstream the nisps-swap to MusicallyEmbodiedML? Requires the load-bearing-surface inventory (plan §5). Phase 0 pushes the branch either way.

### Q5: Legacy feedback modes — delete or keep for A/B? (2026-07-21)

`RandomiseOutputs`/`RandomiseMlp`/`Diffuse`/`on_drag` have no product consumer, but `docs/adr/rl-feedback-design.md` explicitly kept Diffuse for A/B comparison. Deleting reverses a recorded decision — operator call (plan §7.1).

## Deferred / accepted debt

- **EOC effects chain, ShapeSeq sequencer, modular engine (Phase E)** — legacy features consciously out of the v1 rewrite; revisit only if a mode wants them.
- **Inputs multi-source composition** (2026-06-28, reaffirmed 2026-07-21) — mix-and-match pad+gamepad+MIDI is a recorded, unreversed decision; the UI currently enforces exclusive single-source and the composition machinery sits dormant *by design*. Schedule or keep dormant — but the inputs-spec must stop presenting composition as current behaviour (plan §8).
- **Schema content is partially placeholder** (2026-07-21) — 20 anonymous "Param NN" slots across paf_synth/channel_strip/xiasri and copy-pasted ML defaults across all 9 modes. Name them during the first curated-preset pass per mode (plan §6.5c), or shrink `output_size` where the engine allows.
- **Geometric-dislike deliberate divergences** (2026-07-14, one-core P3): (1) the degenerate-branch RNG draws from the controller's deterministic `nisps::Rng`, not libc `rand()` — native==WASM parity holds; (2) upstream's async shuffled two-LR `optimise()` is collapsed into one synchronous `dislike_geometric()` training only the pressed negative's target — behavioural, not bitwise, parity with firmware upstream, by design; (3) `RandomiseMlp` uses `draw_weights(spread)` rather than the old asymmetric ranges. All intentional.
- **Manifold dock splits `state`/`muted`/`armed`** (2026-06-28) — deliberate divergence from the deployed conflated `frozen`↔`muted` model (dock-spec §3.3). `muted`-downstream and the `soloMode` gradient-mask variants remain UI-only; the C API exposes `set_focus` but no per-mode gradient masking yet. (The audit found `soloMode` behaviourally inert in the controller — plan L20 trims it until `train_masked` exists.)

## Recently resolved (delete after a few weeks)

- 2026-07-21: Full-repo simplification audit landed (recon + plan + this rewrite). Superseded entries removed: "browser-only engines incomplete" (→ defect 2/plan 5b), "loss curve not plumbed" (→ defect 8), "NISPS_AUDIO_FUNC misshapen" (→ plan Phase 1, S21/L13), stale "VCV not currently maintained" note (vcv/ is active and consumes `nisps/` directly post-P6).
- 2026-07-18: Browser curve maths unified onto the canonical `nisps/core/math.hpp` catalog at P4; four silently-divergent TS curves re-baselined.
- 2026-07-14: WASM MLP fixed-architecture defect resolved by P2 (`MLPCore<Storage>`; browser runtime-shaped, firmware zero-heap fixed).
