---
kind: spec
stability: stable
layer: cross-cutting
---

# MEMLNaut-NISPS Spec Corpus

**Neural Interactive Shaping of Parameter Spaces** — a research platform for interactive ML control of audio. One C++20 codebase compiles to two targets: RP2350 firmware for the MEMLNaut hardware, and WASM in the Manifold React browser app running the same engines + ML through an AudioWorklet. (The SolidJS playground was retired 2026-07-13, P1 of plans/one-core-engine-refactor.md; archived on `archive/playground-solidjs`.)

---

## 0. Spec Corpus Ontology

This corpus distinguishes four document kinds by temporal stance and mutability:

- **`kind: spec`** (flat in `docs/specs/`) — timeless present-tense contracts. **Wins over code by intent.** Drift-lintable; updated when the spec itself changes or code breaks it.
- **`kind: plan`** (in `docs/specs/plans/`) — future-tense, finite prescriptions carrying `status: active | executed | superseded`. Burn down as work lands; NEVER citable as authority for shipped behaviour (executed items migrate to `MAP.md` per the repo's doc-sync rule).
- **`kind: finding`** (in `docs/specs/recon/`) — past-tense, dated, **IMMUTABLE**. Never edited, only superseded; exempt from drift lint. Research artifacts capturing ground truth at a specific moment.
- **ADRs** (in `docs/adr/`) — decision rationale ("why we chose X"). Outside the spec root; used as backlinks from specs that encode those decisions.

---

## Source Files (Architectural Roots)

The codebase's most architecturally significant areas referenced by this corpus:

| Layer | Path | Purpose |
|-------|------|---------|
| **Shared C++20** | `nisps/core/`, `nisps/ml/`, `nisps/dsp/`, `nisps/engines/`, `nisps/modes/` | One audio+ML library compiling to both firmware and WASM |
| **Schema/Codegen** | `schemas/`, `codegen/` | Parameter contracts + code generation (C++ headers, TS types) |
| **Firmware** | `firmware/MEMLNaut-NISPS/glue/` | Hardware bindings (audio, peripherals, MIDI, settings) |
| **Browser (Manifold)** | `manifold/src/engine/`, `manifold/src/console/` | Headless TS engine + AudioWorklet + the convertible React Console |

---

## 1. Frame

**What it is.** MEMLNaut-NISPS is a single C++20 codebase that compiles once to two distinct targets:

1. **Firmware** — runs on RP2350 hardware (MEMLNaut instrument). Real-time audio engines (8 variants) + interactive ML (4-layer MLP, SGD + RL feedback) with deterministic RNG + dual-core orchestration (audio on core 1, control on core 0).
2. **Browser (WASM)** — runs in the React Manifold front-end via AudioWorklet. Same C++20 engines + ML, compiled to WASM; audio engines are a superset of firmware (C15 synth browser-only).

**The unifying constraint**: one source tree, one ML architecture, cross-platform parity (native ↔ WASM within 1e-5 numerical tolerance). Parameter shapes are JSON schemas with codegen producing both C++ headers and TypeScript types.

**Performance contract** (applies globally to `nisps/`, inert in WASM but kept for consistency):

- No heap in audio/inference paths; use `FixedBuffer` or `std::array`.
- Float literals >255 in hot paths must be `static const`; all floats have `.f` suffix.
- No virtual dispatch in audio path (C++20 concepts, not interfaces).
- Deterministic per-instance RNG; all random state is local and seeded at construction.
- Memory section attributes per hardware (AUDIO_MEM, AUDIO_FUNC, HOT, FORCE_INLINE).

---

## 2. Cross-Cutting Contracts

### Parity discipline

**Native ↔ WASM bit-equivalence within 1e-5.** The C++ core and its WASM compilation are asserted to produce identical outputs given the same input + same seed. See `tests/cpp/parity_check.cpp` (native test) + `scripts/parity-check.sh` (verify runner).

### Schema/codegen contract

Each firmware mode has a `schemas/modes/<mode>.json` describing parameters (name, label, range, default, curve, group), ML config (input/output sizes, hidden layers), voice spaces (names; bodies are inline lambdas in the engine), and UI config. The meta-schema at `schemas/schema.json` validates these. Codegen (`bun run codegen/generate.ts`) is idempotent and produces:

- `nisps/modes/generated/<mode>_schema.hpp` — `constexpr` C++ data under `nisps::modes::generated`.
- TS schema emission is dormant since P1; it returns at P5 targeting `manifold/src/modes/generated/`.

Regenerate after editing any `schemas/modes/*.json`. Golden test ensures output is byte-identical.

### No-heap + deterministic RNG

These are inert in WASM but kept globally to avoid surprises when porting. Lint catches violations: `bash scripts/lint-cpp.sh` warns on missing `.f` suffix and fails on `new`/`malloc`/`std::vector` under `nisps/`, plus `Arduino.h` use outside firmware glue.

---

## Sub-specs (Behavioural + Binding)

All specs below are stable or evolving (no aspirational ones in shipped features); aspirational specs describe target contracts not yet fully implemented.

| File | Stability | Layer | Summary |
|------|-----------|-------|---------|
| `aimmersive-clone-spec.md` | evolving | behavioural | Faithful SolidJS rebuild of the deployed vanilla a-immersive app (446-line DOM, 2538-line CSS, 4521-line JS). Component-by-component spec for replicating look/behaviour. |
| `backends-spec.md` | evolving | binding | Output backends (synth, MIDI, OSC, VCV) unified behind one `OutputBackend` interface + registry. One active backend per session; input/ML/output pipelines backend-agnostic. |
| `dock-spec.md` | evolving | behavioural | Console right-dock drawers (Shape/Feel/Route/Health/Help) + per-output controls (off/fixed/live tri-state, mute, solo, curve). Three-depth dock model. |
| `engine-architecture.md` | evolving | cross-cutting | Foundation: headless `EngineApi` boundary separating the pure engine (input→ML→output reactive spine) from presentation skins (a-immersive, Console). No JSX/DOM in engine; skins are pure consumers of `EngineApi` accessors. |
| `feedback-modes-port-spec.md` | evolving | cross-cutting | Implementation spec: "Down Action" negative-feedback feature ported from firmware `InterfaceRL` into `nisps/` core. Three modes (Avoid / RandomiseOutputs / RandomiseMlp), deterministic RNG, per-instance state. |
| `inputs-spec.md` | evolving | binding | Modular input layer (sources: XY pad, MIDI input, gamepad single/double-stick) composing into N-dimensional vector. MLP rebuild on input-set change. Scope: `manifold/` React app. |
| `manifold-parity-features-spec.md` | aspirational | behavioural | Prescriptive spec for porting five playground features into Manifold: session presets, pins, Jolt, OU-Explore, control surface. Awaiting review; no implementation authorised. |
| `slp-workshop-firmware.md` | evolving | binding | SLP-Workshop (Synth Library Portland workshop build). Part I (Jolt + OU explore adaptive-learning gestures) shipped & stable. Part II (output-mode evolution, gate sequences, Manifold config) planned/evolving. |
| `useq-cv-protocol.md` | stable | binding | uSEQ-CV wire protocol v2 (USB Web Serial ↔ uSEQ main module → CV/gate jacks + I2C expander). Single source of truth: `firmware/useq-celium/shared/protocol.h`, mirrored in `manifold/src/backends/useq-protocol.ts`. |
| `vcv-module.md` | evolving | binding | MEMLNaut VCV Rack 2 module: CV-to-CV mapper (8 inputs × 16 outputs) with RL feedback. Embeds the WASM engine; WS↔OSC browser bridge. 2026-06-28 BUILD DELTAS folded in; prior design sections retained for reference. |

---

## Plans (Finite, Burn-Down)

| File | Status | Summary |
|------|--------|---------|
| `plans/BUILD-PLAN.md` | active | Manifold build resume anchor (dated 2026-06-27). Locked decisions: React app in `manifold/`, parity-tested TS engine from `playground/src`, staging deploy at `meml.lnfinitemonkeys.org/next`, default feedback mode = Explore-and-Place. |
| `plans/playground-2.0-rewrite-plan.md` | executed | SolidJS clean-room rewrite plan (June 2026). Largely implemented in Manifold + playground foundation: one fullscreen instrument, Console interaction model, right-edge dock with three depths, snapshot DAG, control-point tri-state. |
| `plans/one-core-engine-refactor.md` | active | Firmware+Manifold core reunification (dated 2026-07-13). Locked: retire `playground/`, all algorithms into `nisps/` C++ (geometric dislike, Jolt, OU, RNG, pipelines, curves), storage-policy MLP (fixed template on RP2350, runtime-shaped in WASM/VCV), codegen serves manifold, VCV last. Supersedes BUILD-PLAN's "multiple WASM modules" MLP decision. |

---

## Findings (Immutable, Dated Research)

All findings are dated 2026-06-27 unless otherwise noted; exempt from drift lint.

| File | Date | Summary |
|------|------|---------|
| `recon/findings-design-and-manifold.md` | 2026-06-27 | Build-oriented brief synthesizing five redesign docs + Manifold token export + `ConsoleApp.jsx`. VERIFIED from source. |
| `recon/findings-engine-surface.md` | 2026-06-27 | Engine surface audit (deployed JS, WASM, C++ core). Uncovers fixed-2-input WASM gap, loss-history plumbing gap, C15 placeholder. |
| `recon/findings-feedback-behaviour.md` | 2026-06-27 | Current RL feedback behaviour audit. Deployed JS + C++ core use undirected Gaussian noise (not geometric push-away); firmware InterfaceRL implements the true geometric mode. |
| `recon/midi-gamepad-inputs-worklog.md` | 2026-06-27 | Work log of `feat/midi-inputs` branch. Modular input sources (MIDI, gamepad), 32-input WASM foundation, gamepad→verdict wiring. Exclusive picker (not mixing) shipped; mixing engine groundwork done but UI deferred. |
| `recon/upstream-firmware-survey.md` | 2026-06-27 | Git archaeology of the MusicallyEmbodiedML ecosystem. origin/main (C++20/SolidJS rewrite) and upstream/main (old `.ino` firmware) forked at `6efbe9c` (2026-04-14); 49 commits upstream not in origin are ports, not merges. |
| `recon/playground-2026.md` | 2026-04-12 | Design intent snapshot of an unfinished playground UI redesign. Reference-only for SolidJS rewrite; do NOT merge into vanilla playground (those files moved on independently). |

---

## ADRs (Decision Rationale)

| File | Decision | Audience |
|------|----------|----------|
| `adr/rl-feedback-design.md` | Rationale for the Explore-and-Place + Geometric-Dislike feedback model choices | Implementation team |

---

## Cross-References

- **`MAP.md`** — the neutral inventory of the codebase as it stands (ground truth for what exists).
- **`CLAUDE.md`** — long-form architecture narrative (entry point for agent onboarding).
- **`ALIGNMENT.md`** — strategic gaps + open mission questions (dated, opinionated gap diagnosis).
- **`manifold/ONBOARDING.md`** — agent-oriented breakdown of the Manifold React app (run/build/deploy/test, UI/engine-spine/WASM layering, convertible Stages, Dock+drawers, gotchas).
- **`docs/redesign/manifold-export/`** — design-token and UI-kit asset export from Manifold design project (not part of this corpus; static asset reference, not migrated).
- **`anima/`** — separate project (excluded from this corpus).

---

## Open / Deferred

- **Index generation (`.index.json`)**: intentionally not generated yet. No consumer defined; add when crawler/search infra lands.
- **Per-spec §-numbering normalisation**: deferred to a future maintainer pass. Current state mixes flat (§1.1, §1.2…) and three-level nesting (§6.x.y).
- **ADR corpus**: currently minimal (only RL feedback design). Strategic decisions captured in spec Open/Deferred sections; promotion to dedicated ADRs is a future pass.
- **Spec-touched validator**: git-aware lint rule that flags when a code diff touches spec-cited files without also touching the spec. Useful as a pre-commit hook or PR check; infrastructure TBD.
