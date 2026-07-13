---
kind: plan
status: active
---

# One Core Engine — Firmware + Manifold Reunification Plan

*Dated 2026-07-13. Operator-confirmed scope (see §1). Principle: **one core engine (`nisps/`) for both the
resource-constrained RP2350 hardware and the Manifold browser app.** Everything with behaviour — ML, feedback,
exploration, RNG, DSP, input/output processing, curves — lives once, in C++. TypeScript keeps only UI,
reactivity, and transport. This plan supersedes the browser-side "one engine, two skins" framing of
`../engine-architecture.md` (that seam is built — Manifold is its realisation); the axis of unification now
runs vertically, core↔targets, not horizontally, skin↔skin.*

## 0. Where duplication actually lives today (audited 2026-07-13)

| Component | Canonical | Duplicate / divergence | Disposition |
|---|---|---|---|
| MLP, training, init, RL `move_weights` | `nisps/ml/` | `vcv/src/iml.hpp` full runtime reimpl ("delta #5") | Reunify (P2, P6) |
| Feedback explore-and-place | `nisps/ml/feedback.hpp` | none — firmware + manifold both call it ✓ | Keep |
| Geometric dislike (Mode 1) | *(missing from core)* | `manifold/src/feedback/controller.ts` TS approximation, explicit `C++ GAP` markers (lines ~369, ~436) | Port to core (P3) |
| Jolt weight-morph | `nisps/ml/jolt.hpp` | `playground/src/ml/jolt.ts` TS port; absent in manifold | Expose via WASM (P3) |
| OU exploration noise | `nisps/ml/ou_noise.hpp` | `playground/src/output/ou-explore.ts` TS port; absent in manifold | Expose via WASM (P3) |
| Deterministic RNG | `nisps/core/rng.hpp` | `manifold/src/feedback/rng.ts` (`SeededRng`, self-described stand-in) | Replace with core stream (P3) |
| Input pipeline | *(TS-only concept)* | `playground/src/input/pipeline.ts` ≡ `manifold/src/engine/input-pipeline.ts` | Port to core (P4) |
| Output pipeline + curves | curves mirror `nisps/core/math.hpp` | byte-identical TS pairs in playground + manifold | Port to core (P4) |
| Audio DSP engines (×8) | `nisps/engines/` | none — both targets run the WASM ✓ | Keep |
| TS engine spine (wasm-iml, worker, host, worklet) | — | manifold forked from playground; several files byte-identical | Single home in manifold (P1) |
| Compiled `nisps.wasm` | `scripts/build-wasm.sh` → `playground/public/` | `manifold/public/` byte-identical **manual copy** | Retarget build (P0) |
| Mode param schemas | `schemas/modes/*.json` → codegen | manifold bypasses codegen; hardcodes `MF_MODES` in `console/model.ts` | Codegen for manifold (P5) |
| WASM MLP arity | `bindings.cpp` `MLP<32,10,14,18,126>`; `nisps_ml_create` ignores requested dims | forces clamping, blocks per-mode arch, motivated the VCV reimpl | Runtime-shaped browser MLP (P2) |

## 1. Locked decisions (operator, 2026-07-13)

| Decision | Choice |
|---|---|
| `playground/` | **Retired.** Archived to branch `archive/playground-solidjs`, deleted from main. Manifold is the sole browser app; WASM build, parity-check, codegen all retarget manifold. |
| Depth of "one core" | **All algorithms in C++.** Feedback (incl. geometric dislike), Jolt, OU, RNG, input/output pipelines, curves move into `nisps/`; TS keeps UI/reactivity/transport only. |
| MLP arity | **Template the hardware, dynamic browser.** Firmware keeps compile-time `MLP<...>` (zero-heap contract intact); WASM/VCV targets get a runtime-shaped MLP sharing the same algorithm code. Heap allowed at construction time on non-RP2350 targets only. |
| VCV | **In scope, final phase** (P6); may slip without blocking anything else. |

**Supersedes:** `BUILD-PLAN.md` locked decision "Modular N×M MLP: multiple WASM modules + warm-start; NOT
runtime-shaped" (2026-06-27). The runtime-shaped MLP is now the chosen mechanism; warm-start on reshape is
retained as a feature of it.

## 2. Target architecture

```
                    ┌───────────────────────── nisps/ (ONE CORE) ─────────────────────────┐
                    │ core/   rng, math+curves, buffers, perf attrs                        │
                    │ ml/     algorithms templated on StoragePolicy:                       │
                    │           Fixed<NIn,H1,H2,H3,NOut>  (arrays, zero-heap → RP2350)     │
                    │           Dynamic                    (sized at construction → WASM,VCV)│
                    │         mlp / training / init / rl / jolt / ou_noise / feedback /    │
                    │         geo_push / replay  (geometric dislike lands here)            │
                    │ pipeline/  input chain (deadzone→zoom→curve→smooth→momentum)         │
                    │            output chain (curve→smooth→slew→freeze)      ← NEW        │
                    │ dsp/ engines/ modes/   (unchanged)                                   │
                    └──────────────────────────────────────────────────────────────────────┘
                       ▲ direct #include                ▲ nisps/wasm/bindings.cpp (C ABI)
              ┌────────┴─────────┐            ┌─────────┴──────────┐        ┌───────────────┐
              │ firmware/ glue   │            │ manifold/ (React)  │        │ vcv/ (P6)     │
              │ RP2350, Fixed    │            │ UI + reactive spine│        │ Dynamic       │
              │ storage, no heap │            │ + transports only  │        │ storage       │
              └──────────────────┘            └────────────────────┘        └───────────────┘
```

Litmus test per file: **if it computes behaviour that affects sound, weights, or parameter values, it is C++
in `nisps/`; if it schedules, renders, or transports, it may be TS.** The existing browser litmus (JSX/DOM =
skin) still applies inside manifold; this plan adds the vertical one.

## 3. Phases

Each phase ends green on its test gate and is independently landable. File phases as **ergo** tasks
(one per phase, sub-tasks per bullet); do not start a phase before its predecessor's gate is green.

### P0 — Plumbing hygiene (hours, no behaviour change) — ✅ landed 2026-07-13

- ✅ `scripts/build-wasm.sh` emits to `manifold/public/` (keep `playground/public/` copy only until P1 lands).
- ✅ `scripts/parity-check.sh` (and `tests/cpp/parity_wasm.mjs`) read the manifold artifact.
- ✅ Fix stale doc: the `MLP<2,…>` line was in `docs/AGENT-REFERENCE.md` + `nisps/wasm/README.md` (MAP.md was already correct); both now say `MLP<32u,10u,14u,18u,126u>`.
- ✅ `ml-debug.log`/`graphify-out/` were already absent from the tree; `.claude/worktrees/` gitignored.
- **Gate met:** `run-all-tests.sh` green (Playwright leg via the BUILD-PLAN non-snap-node VPS runner); parity PASS reading `manifold/public/` (max delta 2.4e-7); manifold typecheck+build green against the freshly-built artifact.

### P1 — Retire playground, single TS home (≈1 day) — ✅ landed 2026-07-13

- ✅ Branch `archive/playground-solidjs` + tag `playground-solidjs-final`; `playground/` deleted from main.
  Parity fixtures for P4 captured FIRST: `manifold/tests/fixtures/` (288-event gesture trace, curve
  goldens, input/output pipeline goldens under 14+8 configs) + drift-guard `pipeline-golden.test.ts`.
  Note: input pipeline's momentum path reads `performance.now()` — fixtures pin a clock contract (see
  fixtures README). C15 (stub + c15.wasm) now lives only on the archive branch (ALIGNMENT defect #1).
- ✅ Jolt press + OU explore UI shells in the Learning drawer; interim TS math via get/set_weights in
  `manifold/src/engine/{exploration,jolt,ou-explore}.ts`, marked `P3 SWAP POINT`.
- ✅ Keeper Playwright specs ported: `probe-api.spec.ts` (15 tests), `spine.spec.ts` (4). Playground UI/
  persistence specs dropped with the playground.
- ✅ References retargeted: run-all-tests stage 5 → manifold, ci.yml manifold-tests job, osc-bridge.yml
  (was already broken), codegen TS target removed (returns P5), AGENTS/README/MAP/ALIGNMENT/
  AGENT-REFERENCE/specs-MAIN. The VPS deploy webhook already built only manifold — no change needed.
- **Gate met:** full `run-all-tests.sh` green with playground gone (ctest 4/4, parity PASS, lint clean,
  manifold 9 unit + 20 e2e).

### P2 — Storage-policy split: templated hardware, dynamic browser (the structural centre, ≈1 wk)

- Refactor `nisps/ml/` so algorithms (forward, backprop/SGD, init, `move_weights`, jolt, OU, feedback)
  are written once against a storage concept: `weights()`, `layer_sizes()`, `scratch()`. Two models:
  - `FixedStorage<NIn,H1,H2,H3,NOut>` — `std::array`, `NISPS_AUDIO_MEM`-able, zero heap. Firmware target;
    existing `MLP<...>` becomes an alias. **RP2350 performance contract untouched.**
  - `DynamicStorage` — sizes at construction, single arena allocation, no per-call allocation after
    construction. Compiled only for WASM/native-test/VCV targets (guarded so `lint-cpp.sh` still fails heap
    use in firmware paths).
- `nisps_ml_create(input, output, hidden[])` honours its arguments. Reshape = new instance + warm-start
  copy of overlapping weights (the BUILD-PLAN warm-start idea, now runtime).
- Manifold drops input clamping/phantom-channel handling; XIASRI/sound-analysis multi-input modes become
  browser-viable.
- **Gate:** parity — fixed and dynamic storage produce bit-identical outputs for identical shapes/seeds
  (new ctest); `parity-check.sh` native↔WASM ≤1e-5 unchanged; firmware builds byte-comparable (chokepoint B:
  compile PAFSynth, compare `.text` size ±1%).

### P3 — Exploration + feedback fully in core (≈3–4 days)

- **Geometric dislike:** port firmware k-NN centroid push (upstream `InterfaceRL.cpp:602-738`) into
  `nisps/ml/geo_push.hpp` + `replay.hpp` + `mlp.train_targets`, per `docs/adr/rl-feedback-design.md` §4.
  Expose via `nisps_ml_feedback_dislike_geometric`. Delete the TS approximation + both `C++ GAP` blocks in
  `manifold/src/feedback/controller.ts`.
- **Jolt / OU:** expose `nisps/ml/jolt.hpp` + `ou_noise.hpp` through bindings
  (`nisps_ml_jolt_press/release`, `nisps_ml_explore_intensity`); manifold's P1 UI shells switch to them.
  The playground TS ports die with P1.
- **RNG:** feedback/exploration randomness in the browser comes from the core's seeded `Rng` streams
  (already per-instance, ctor-seeded). Delete `manifold/src/feedback/rng.ts`.
- **Gate:** new cross-platform parity test — scripted feedback session (seeded) produces identical weight
  trajectories native↔WASM; firmware spot-check on hardware (chokepoint A) for geometric dislike feel.

### P4 — Input/output pipelines + curves into core (≈3 days)

- New `nisps/pipeline/`: input chain and output chain as plain structs satisfying the perf contract
  (usable per-sample on firmware if ever wanted; per-pointer-event in browser — JS↔WASM call cost is
  trivial at that rate).
- Curves: single catalog in `nisps/core/math.hpp` (already canonical); bindings expose
  `nisps_curve_apply(id, x)` and batch variant; TS `curves.ts` (both copies) deleted, UI curve *previews*
  render by sampling the WASM.
- Manifold `input-pipeline.ts` / `output-pipeline.ts` become thin calls into the main-thread WASM instance
  (state lives C++-side, per-instance, serialisable for persistence).
- Golden TS-vs-C++ tests retire; replaced by direct use.
- **Gate:** spine e2e unchanged; recorded-gesture regression: same pointer trace → same routed output
  pre/post migration (capture fixture before starting).

### P5 — Schema/codegen serves manifold (≈2 days)

- `codegen/generate.ts` emits `manifold/src/modes/generated/` alongside the C++ headers (playground target
  removed in P1). `MF_MODES` in `console/model.ts` is derived from generated schemas, not hand-written —
  labels/ordering may stay a manifold-side overlay, but params/ranges/ml-config come from schema truth.
- With P2's dynamic MLP, per-mode `ml.input_size/output_size/hidden` in schemas becomes *real* in the
  browser; codegen gains a check that firmware modes still fit the fixed template.
- **Gate:** codegen idempotence golden test extended to manifold output; e2e per-mode param count/range
  assertions driven from schema.

### P6 — VCV reunification (later; may slip)

- `vcv/src/iml.hpp` deleted; module consumes `nisps/ml/` with `DynamicStorage` (its 8→16 runtime shape is
  exactly the P2 case). `DetRng` replaced by `nisps/core/rng.hpp`. Closes vcv-module.md delta #5.
- OSC server stays vcv-local (transport, not behaviour).
- **Gate:** vcv builds; seeded train/infer parity vs native ctest.

## 4. Risks

| Risk | Mitigation |
|---|---|
| P2 template refactor destabilises firmware perf (chokepoint B) | Fixed-storage path stays `std::array` + same attrs; compare `.text`/RAM and audio-callback timing before/after; land behind a ctest parity gate. |
| Dynamic storage leaks heap use into firmware paths | Compile-time guard (`#if NISPS_TARGET_EMBEDDED` excludes `DynamicStorage`); `lint-cpp.sh` already fails heap under `nisps/` — carve an explicit allowlist for the dynamic TU only. |
| Per-event WASM calls for pipelines add latency | Pointer-rate ≈120 Hz, one call each — negligible; batch API as fallback. rAF/canvas never calls WASM. |
| Geometric-dislike port changes feel vs firmware | Port from upstream source verbatim, seeded-trajectory parity test, then hardware A/B (chokepoint A) before deleting the TS fallback. |
| Retiring playground loses a working reference | Archive branch + tag; parity fixtures (recorded gestures, golden outputs) extracted *before* deletion in P1. |
| Manifold worklet + main thread now both depend on retargeted wasm build | P0 gate builds manifold from fresh artifact in CI, killing the manual-copy hazard permanently. |

## 5. Doc-sync obligations

- On each phase landing: update `MAP.md` (it is the shipped-behaviour authority) and burn down this plan's
  phase table; when all phases land, set `status: executed`.
- `MAIN.md` registry: this file added; `engine-architecture.md` remains authoritative for the *browser-side*
  seam only; BUILD-PLAN.md's MLP row annotated as superseded (done 2026-07-13).
- `ALIGNMENT.md` defect #3 (fixed WASM arity) closes at P2; the accepted-divergence log entries for Jolt/OU
  TS ports and vcv delta #5 close at P3/P6.
