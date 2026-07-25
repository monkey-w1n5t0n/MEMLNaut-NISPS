# ALIGNMENT

> Opinionated diagnosis of how well the codebase serves its mission, ranked by impact. Dated entries; remove when resolved rather than checking off. **Pruned every few weeks** — a stale diagnosis is worse than none.

## Mission

A research platform for interactive ML control of audio. We're building it to figure out what works and what doesn't — different ergonomics and ergodynamics of parameter sets, modes, ML architectures, audio engines, UI, and UX. Therefore: keep most/all parameters tweakable, ML/engine/UI/UX should each be configurable on their own axis, and the codebase has to enable/assist agentic AI coding patterns (confident changes, verifiable without hardware).

**Target vision (operator, 2026-07-20):** (1) one C++20 NISPS core serving RP2350 firmware and the browser, performance-sensitive on the MCU; (2) firmware modes runnable as modes in Manifold; (3) Manifold defaults to curated presets/modes, with the maximalist surface behind an "advanced" dev mode used to author them; (4) PlatformIO for hardware, no more .ino; (5) Manifold doubles as interface/editor for the hardware MEMLNaut (settings, presets, training, examples, visualisation).

The clean-slate rewrite (2026-04-29) consolidated everything into one C++20 codebase compiling to firmware AND WASM. Since 2026-07-13 (P1) the sole browser app is the React Manifold. JSON schemas remain the firmware↔browser parameter contract. A full-repo audit (2026-07-21, `docs/specs/recon/simplification-audit-2026-07.md`) grounds the entries below; mitigations are phased in `docs/specs/plans/simplification-plan.md`.

## Top defects (ranked by mission impact)

### 1. The mode layer is not shared: WASM re-orchestrates modes by hand (2026-07-21)

**What.** `nisps/modes/` — the CRTP layer binding ML config, engine, voice-space and I/O — compiles only into firmware. `nisps/wasm/bindings.cpp` includes engines and ML primitives but zero mode headers, and Manifold re-assembles mode behaviour (jolt stepping, OU, routing) in TS. "Firmware and WASM share the same modes" is true only at the engine level; every ModeBase behaviour must be mirrored browser-side by hand.

**Why it blocks the mission.** Vision bullet 2 is precisely this. Until the control-tick orchestration exists once in C++, every new mode behaviour is a dual implementation with drift risk.

**Rough cost.** Spec first, then ~a week: storage-policy the ModeBase orchestration the way P2 did MLPCore (verified shape in plan §6.5a — *not* binding monolithic mode objects, which would contradict the locked two-instance RT architecture). Related honesty gap: Manifold currently catalogues 4 modes that structurally cannot run in the browser (no mic input, event-only engines) — plan §6.5b (absorbs the old C15/mic-input defect; C15 itself lives on `archive/playground-solidjs`).

### 2. No curated/advanced split and no in-UI mode picker — the UI fights vision 3 (2026-07-21)

**What.** Manifold is 100% dev-maximalist: five drawers of everything, no preset data model to author against, and mode switching exists only via the debug hook — there is no instrument picker in the UI at all (the plumbing, `ctx.modes`/`setModeId`, already exists unused). A stratum of decorative controls (training-param sliders, master volume, bpm, A/B, snapshots, fabricated gradient health) renders real-looking UI that drives nothing.

**Why it blocks the mission.** The default experience is supposed to be curated presets; the advanced surface is the authoring tool. Neither exists, and the decorative stratum actively misleads research use.

**Rough cost.** Product-model decision first (plan §7.6), then incremental: picker is days; the curated-preset model seeds from `backends/presets.ts` + schemas; disclosure via per-drawer depth levels — which as of §6.5e (2026-07-21) has its first genuinely advanced-only consumer, the training-health panel, so the mechanism is proven rather than theoretical. The decorative stratum itself went in the Phase-1 sweep.

### 3. Manifold-as-hardware-editor is a facade (2026-07-21)

**What.** Vision bullet 5 exists as a 237-line Web Serial shell: sound connect lifecycle, zero protocol (`saveModel`/`restoreModel`/`getSettings` are literal stubs), and firmware has no serial command surface or on-device persistence to talk to.

**Why it blocks the mission.** The hardware research loop (train on device, inspect/curate in browser) is closed only by this bridge.

**Rough cost.** Week+, spec-first (plan §6.5d). The right discipline already exists in-repo: useq-celium's C-header wire truth + TS mirror + parity test; settings payloads should derive from schema codegen.

### 4. Dead mass and registry sprawl across every layer (2026-07-21)

**What.** *Phase 1 landed 2026-07-21 and removed the bulk of this:* the dead focus/altitude UI system, the decorative control stratum, 12 dead WASM API entries across the 5-file registration chain, the vendored daisysp tree, retired-playground artifacts and root planning relics, 5 unused primitives, the duplicate backend editor and catalogue, `voice_space.hpp`, `fixed_buffer.hpp`, the dead perf-macro regime, and the OSC bridge twin. What remains is the *registry* half: mode identity spread across ~6 hand-maintained registries with demonstrated drift, MLP dims typed twice, per-mode schema blocks hand-written in C++, and assorted stale specs presenting a deleted world as present tense.

**Why it blocks the mission.** The registries are dual-truth bugs waiting to fire (one already did: the selftest table). Stale specs are agent-confusing surface area.

**Rough cost.** Plan phase 3 (~2–3 days, codegen takes ownership) plus the docs disposition pass (§8). The behaviour bugs found en route (dataset-cap divergence, VCV 2-D input truncation, VCV audio-thread race and JSON) were fixed in phase 2 on 2026-07-21.

### 5. Performance is measured on the host but not on the target that constrains it (2026-07-21)

**What.** *Mostly closed 2026-07-21.* Size: the Phase 4 firmware CI job reports per-variant
flash/RAM on every push. Time: `scripts/bench-engines.sh` now reports per-engine ns/sample,
blocks/s and realtime factor on native AND WASM from one source
(`tests/cpp/engine_bench.cpp`), engines driven into a working state, with `--compare` for
per-engine deltas and a report step in CI. An engine getting 3x slower is now visible.

**What is left.** The numbers are HOST numbers. The mission's performance constraint is the
**RP2350 at 150 MHz**, and nothing measures there — a host realtime factor of 100x says
nothing about whether an engine fits in the MCU's per-block budget, and the two targets have
different FPU, cache and memory behaviour. The honest next step is an on-device timing report
(cycle counter around the audio callback, published over the existing display/serial surface),
which lands naturally with the hardware editor (defect 3) since that is what gives firmware a
command surface to report through.

**Rough cost.** Host half is done. On-device: ~a day, and it wants defect 3's serial protocol
to have somewhere to send the number.

### 6b. The geometric dislike was ported from a superseded upstream design (2026-07-25)

**What.** `geo_push.hpp`/`replay.hpp` cite `memllib @ 0a541cc`. `upstream/main` now pins
`e291192`, where the same code has been deliberately redesigned. Upstream:
`kGeometricPushScale` 1.0 (ours 0.5); neg-LR base 1.5 (ours 0.5, `geo_push.hpp:92`);
the `/(1+len)` taper **deleted**, with the comment "a 'no' should clearly move the
mapping away even from a sound already far from the liked region (the taper used to
kill exactly that case)" — ours still applies it at `geo_push.hpp:66`; negatives trained
as a **batch over ALL of them every tick** rather than one item one step; and a fixed
`kDislikeLifetimeMs = 2500` full-strength lifetime replacing the proportional decay we
ported. On the shared constants (dedup radius 0.05, `kCentroidK` 4) we match.

**Why it blocks the mission.** We are carrying a design upstream diagnosed and fixed,
and the fix is documented in their source comments. On the constants alone the ported
dislike is ~9.4x weaker than upstream's. (The optimiser half of this — an RMSProp LR
pasted into an SGD step — is fixed as of 2026-07-25; see "Recently resolved". A single
dislike now moves the mapping 1.6e-2 instead of 5.3e-5, but that is still ~14x weaker
than the legacy Diffuse design measures in one press, `ml_bench` A4.)

**Rough cost.** Small — mostly deleting the taper and re-basing three constants, then
re-running `scripts/bench-ml.sh` D1/A4/A7 to confirm.

### 6d. One like still heaves the whole mapping (2026-07-25)

**What.** A thumbs-up trains at `lr 1.0 x 1000 iterations` on every gesture. `ml_bench`
U1/U4 measure **lurch** — how far the mapping the musician is playing moves per single
gesture, averaged over the field: `lurch_max` 1.08 against a [0,1] output range, i.e.
one thumbs-up can move the mapping somewhere in the space by more than the entire output
range. Retention (how much of the previous teaching survives) is 0.38; at `iters=1` it
is 0.80.

**Why it blocks the mission.** This is the other half of the feedback asymmetry, and
RMSProp did NOT fix it — normalising the step size does not change the dose. Upstream
keeps both directions on small repeated steps; we take one enormous positive step and
one small negative one, so teaching feels like a lurch and correcting feels like
nothing. The two numbers now differ by ~70x rather than ~2e6x, which is progress and
still not a design.

**Rough cost.** Cheap to change, expensive to choose: the tuning space is now measurable
(`ml_bench` U4 sweeps dose; U1 sweeps upstream's soft-target alpha, where alpha=1 is
NISPS today). It wants a matched-N head-to-head, not a guess.

### 6c. `InterfaceRL` — the reference implementation — is not in the tree (2026-07-25)

**What.** It lives in `memllib/examples/`, and the vendoring dropped `examples/`
(`VENDORED.md`). So the source of truth for our most contested subsystem is absent, and
the divergences in 6b went unnoticed for months. Either vendor
`examples/InterfaceRL.{hpp,cpp,tpp}` read-only alongside the rest, or record its pinned
commit and a fetch recipe in `VENDORED.md`.

## Open mission questions

### Q1: Per-mode MLP architectures or one shared shape? (2026-04-29)

Schemas declare per-mode dims and since P5.3 both targets honour them. Is the mission served by maintaining per-mode shapes (research diversity) or collapsing to one (simpler ops)? Note the audit found all 9 mode schemas share copy-pasted ML defaults and 20 params are anonymous placeholders — the per-mode diversity is currently nominal (plan L40).

### Q2: Engine event taxonomy (2026-04-29)

`ControlEvent` is a flat enum consumed by the two sequencer modes. Revisit when a third event-emitting mode lands.

### Q3: Should Manifold stay desktop-first? (2026-04-29)

Legacy a-immersive was mobile-first; Manifold is desktop-first. Defer until user data exists.

## Deferred / accepted debt

- **EOC effects chain, ShapeSeq sequencer, modular engine (Phase E)** — legacy features consciously out of the v1 rewrite; revisit only if a mode wants them.
- **Inputs multi-source composition** (2026-06-28, reaffirmed 2026-07-21) — mix-and-match pad+gamepad+MIDI is a recorded, unreversed decision; the UI currently enforces exclusive single-source and the composition machinery sits dormant *by design*. Schedule or keep dormant — but the inputs-spec must stop presenting composition as current behaviour (plan §8).
- **Schema content is partially placeholder** (2026-07-21) — 20 anonymous "Param NN" slots across paf_synth/channel_strip/xiasri and copy-pasted ML defaults across all 9 modes. Name them during the first curated-preset pass per mode (plan §6.5c), or shrink `output_size` where the engine allows.
- **Geometric-dislike deliberate divergences** (2026-07-14, one-core P3): (1) the degenerate-branch RNG draws from the controller's deterministic `nisps::Rng`, not libc `rand()` — native==WASM parity holds; (2) upstream's async shuffled two-LR `optimise()` is collapsed into one synchronous `dislike_geometric()` training only the pressed negative's target — behavioural, not bitwise, parity with firmware upstream, by design; (3) `RandomiseMlp` uses `draw_weights(spread)` rather than the old asymmetric ranges. All intentional.
- **Manifold dock splits `state`/`muted`/`armed`** (2026-06-28) — deliberate divergence from the deployed conflated `frozen`↔`muted` model (dock-spec §3.3). `muted`-downstream and the `soloMode` gradient-mask variants remain UI-only; the C API exposes `set_focus` but no per-mode gradient masking yet. (The audit found `soloMode` behaviourally inert in the controller — plan L20 trims it until `train_masked` exists.)

## Recently resolved (delete after a few weeks)

- 2026-07-25: **The optimiser mismatch (defect 6) is fixed.** `nisps/ml/training.hpp` was
  SGD-only while upstream `memlp` (`ea777502`) applies **RMSProp everywhere**, so every
  learning rate we ported landed in an optimiser that reads it differently — an RMSProp
  `lr` is a normalised step, an SGD `lr` multiplies the raw gradient. `rmsprop_step()`
  now ports `Layer.h:239 ApplyAccumulatedGradients` exactly (decay 0.9, eps 1e-6,
  sq-avg clamp 1e6, one-sided adjusted-LR clamp 1.0), with the per-weight running
  squared-gradient average living in the storage policies so the zero-heap contract
  holds. Measured on `ml_bench` D1: one geometric dislike moves the mapping **1.6e-2,
  up from 5.3e-5**, and repeated presses now converge on the intended 0.5 push (0.12 at
  10 presses, 0.56 at 100) instead of creeping linearly. Golden vector stages 2 and 3
  were re-captured; stages 0 and 1 are pre-training and did not move. What this does NOT
  fix: the dose asymmetry, now tracked as defect 6d.

- 2026-07-21: **Q4 (who owns memllib) closed.** Vendored at `firmware/MEMLNaut-NISPS/lib/memllib/`
  from upstream `e291192`; the submodule and the fork are both gone. **Q5 (legacy feedback modes)
  closed** — operator kept all four (`RandomiseOutputs`/`RandomiseMlp`/`Diffuse`/`on_drag`) as
  building blocks for comparing how instruments feel under different behaviours, which upholds
  rather than reverses `docs/adr/rl-feedback-design.md`.
- 2026-07-21: **Training-health telemetry (old defect 6) is gone** — the browser reads the real
  per-iteration loss the core records, both fabrication sites are deleted (`wasm-worker.ts`'s
  1-element array AND `wasm-iml.ts`'s sync-train twin, which the audit missed), and the display
  sits behind the existing `expanded` drawer depth. The firmware buffer stays, per the L25 call.

- 2026-07-21: **Training-health telemetry (old defect 6) is real.** `nisps_ml_loss_history` now
  crosses all five WASM registration layers, so the browser reads the SAME per-iteration curve the
  firmware MLP records; `wasm-worker.ts`'s 1-element `new Float32Array([loss])` fake is gone from
  both the sync and the async train paths; and the curve + the already-plumbed `get_layer_stats`
  render in `manifold/src/console/TrainingHealth.tsx` at the Learning drawer's `expanded` depth.
  The firmware buffer stays, per the operator call — it is the record the hardware editor
  (defect 3) will read. One more fabrication went with it: `ConsoleCtx.loss`, a synthetic
  `prev * 0.82` series no drawer read. With no history the panel says "no training run yet"
  rather than drawing a plausible curve.

- 2026-07-21: **Arduino-CLI build machinery (old defect 3) is gone.** Phase 4 replaced it with a
  PlatformIO project: one `[env:]` per variant is now the only variant registry, the `.ino`-mutating
  Python/sed machinery and the `NISPS_ST_*` token-paste table and the sketch symlink forest and the
  global TFT_eSPI mutation are all deleted, memllib is vendored (no submodule), and firmware finally
  entered CI — three representative envs per run, which is what would have caught the SelfTest
  variant sitting broken. All 16 envs build; sizes match arduino-cli within ~520 bytes.

- 2026-07-21: Full-repo simplification audit landed (recon + plan + this rewrite). Superseded entries removed: "browser-only engines incomplete" (→ defect 2/plan 5b), "loss curve not plumbed" (→ defect 7), "NISPS_AUDIO_FUNC misshapen" (→ plan Phase 1, S21/L13), stale "VCV not currently maintained" note (vcv/ is active and consumes `nisps/` directly post-P6).
- 2026-07-18: Browser curve maths unified onto the canonical `nisps/core/math.hpp` catalog at P4; four silently-divergent TS curves re-baselined.
- 2026-07-14: WASM MLP fixed-architecture defect resolved by P2 (`MLPCore<Storage>`; browser runtime-shaped, firmware zero-heap fixed).
