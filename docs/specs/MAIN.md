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

Archived documents live in `docs/specs/_archive/` with `deprecated-by`/`superseded-by` front matter.

---

## Source Files (Architectural Roots)

The codebase's most architecturally significant areas referenced by this corpus:

| Layer | Path | Purpose |
|-------|------|---------|
| **Shared C++20** | `nisps/core/`, `nisps/ml/`, `nisps/dsp/`, `nisps/engines/`, `nisps/modes/`, `nisps/pipeline/` | One audio+ML library compiling to both firmware and WASM |
| **Schema/Codegen** | `schemas/`, `codegen/` | Parameter contracts + code generation (C++ headers, TS types) |
| **Firmware** | `firmware/MEMLNaut-NISPS/glue/` | Hardware bindings (audio, peripherals, MIDI, settings) |
| **Browser (Manifold)** | `manifold/src/engine/`, `manifold/src/console/` | Headless TS engine + AudioWorklet + the convertible React Console |

---

## 1. Frame

**What it is.** MEMLNaut-NISPS is a single C++20 codebase that compiles once to two distinct targets:

1. **Firmware** — runs on RP2350 hardware (MEMLNaut instrument). Real-time audio engines + interactive ML (4-layer MLP, SGD + RL feedback) with deterministic RNG + dual-core orchestration (audio on core 1, control on core 0).
2. **Browser (WASM)** — runs in the React Manifold front-end via AudioWorklet. The **same eight `nisps/` engines** as firmware — neither target is a superset. (The browser-only C15 synth lives only on the retired-playground archive branch; browser audio-*input* — mic — is not wired, so the analysis-driven modes are hardware-only today.)

**The unifying constraint**: one source tree, one ML architecture, cross-platform parity (native ↔ WASM within 1e-5 numerical tolerance). Parameter shapes are JSON schemas with codegen producing both C++ headers and TypeScript types.

**Performance contract** (applies to `nisps/`, inert in WASM but kept for consistency):

- No heap in audio/inference paths; use `std::array` (the one deliberate exception: `nisps/ml/dynamic_storage.hpp`, browser/VCV-only, `#error`s on RP2350 builds, sole lint allowlist entry).
- Float literals have the `.f` suffix; non-trivial float constants are `static const`.
- No virtual dispatch in the audio path (C++20 concepts, not interfaces).
- Deterministic per-instance RNG; all random state is local and seeded at construction.
- Hot-path attributes from `nisps/core/perf.hpp`: `NISPS_HOT` / `NISPS_FORCE_INLINE` (the former SRAM-section macro regime was deleted 2026-07 as dead).

---

## 2. Cross-Cutting Contracts

### Parity discipline

**Native ↔ WASM bit-equivalence within 1e-5.** The C++ core and its WASM compilation are asserted to produce identical outputs given the same input + same seed. See `tests/cpp/parity_check.cpp` (native test) + `scripts/parity-check.sh` (verify runner).

### Schema/codegen contract

Each mode has a `schemas/modes/<mode>.json` describing parameters (name, label, range, default, curve, group), ML config (input/output sizes, hidden layers), voice spaces (names; bodies are inline lambdas in the engine), and UI config. The meta-schema at `schemas/schema.json` validates these. Codegen (`bun run codegen/generate.ts`) is idempotent and produces **both language outputs**:

- `nisps/modes/generated/<mode>_schema.hpp` — `constexpr` C++ data under `nisps::modes::generated` (+ `nisps/ml/generated/ml_defaults.hpp` from `schemas/ml_defaults.json`).
- `manifold/src/modes/generated/<mode>_schema.ts` (+ `types.ts`, `index.ts`) — the source of truth for the Manifold `MF_MODES` catalogue.

A second generator, `codegen/generate-midi-devices.ts`, emits `nisps/midi/generated/midi_devices.hpp` + `manifold/src/midi-devices/generated/` from `schemas/midi_devices/`.

Schema changes ship with the regenerated C++ **and** TypeScript in the same commit; CI re-runs both generators and fails on any diff (plus the golden test).

### No-heap + deterministic RNG

These are inert in WASM but kept globally to avoid surprises when porting. Lint catches violations: `bash scripts/lint-cpp.sh` warns on missing `.f` suffix and fails on heap use under `nisps/` (allowlist: `dynamic_storage.hpp`), plus `Arduino.h` use outside firmware glue.

---

## Sub-specs (Behavioural + Binding)

| File | Stability | Layer | Summary |
|------|-----------|-------|---------|
| `backends-spec.md` | evolving | binding | Output backends (synth, particles, MIDI, OSC, CV/gate, VCV) unified behind one `OutputBackend` interface + manager. Largely built (`manifold/src/backends/`); carries a 2026-07 grounding note — the full-state OSC sync legs it designed were deleted. |
| `dock-spec.md` | evolving | behavioural | Console dock drawers + the per-output control row (off/fixed/live tri-state, mute, solo/arm, min/max/curve). Built with operator restructuring (top Mode selector + 5 drawers, 2 depths); grounding note maps spec→shipped. |
| `engine-architecture.md` | stable | cross-cutting | The surviving browser-engine contract: the headless `EngineApi` seam + the reactive-spine invariant, as realised in `manifold/src/engine/`. Trimmed 2026-07; superseded framing documented in its header. |
| `inputs-spec.md` | evolving | binding | Modular input layer (XY pad, MIDI input, gamepad single/double-stick) composing into an N-dim vector. Built as `manifold/src/inputs/` (runtime-reshaped net, exclusive-mode UI; mixing groundwork laid — operator decision §7.7 pending). |
| `slp-workshop-firmware.md` | evolving | binding | SLP-Workshop (Synth Library Portland workshop build). Part I (Jolt + OU explore adaptive-learning gestures) shipped & stable. Part II (output-mode evolution, gate sequences, Manifold config) planned/evolving. |
| `useq-cv-protocol.md` | stable | binding | uSEQ-CV wire protocol v2 (USB Web Serial ↔ uSEQ main module → CV/gate jacks + I2C expander). Single source of truth: `firmware/useq-celium/shared/protocol.h`, mirrored in `manifold/src/backends/useq-protocol.ts`. |
| `vcv-module.md` | evolving | binding | MEMLNaut VCV Rack 2 module: CV-to-CV mapper (8 in × 16 out, LED rings) on the shared `nisps/` core (P6). Also the single `.nisps`/patch format spec (v3 flat weights). Pruned 2026-07-21 to the current contract. |

**Archived** (in `_archive/`): `aimmersive-clone-spec.md` — the SolidJS clone spec for the deployed vanilla a-immersive app; the clone was never built and its target framework was retired. Kept as a behavioural reference for the still-deployed vanilla app.

---

## Plans (Finite, Burn-Down)

| File | Status | Summary |
|------|--------|---------|
| `plans/BUILD-PLAN.md` | executed | Manifold build resume anchor (2026-06-27). The app shipped to `/next/`; survivors (non-snap-node e2e invocation, naming/copy decisions) noted in its header; deploy is now the CI-gated webhook. |
| `plans/feedback-modes-port-spec.md` | executed | The "Down Action" negative-feedback port into `nisps/`. Landed, then evolved past it — `docs/adr/rl-feedback-design.md` + `nisps/ml/feedback.hpp` are the surviving truth (the ADR explicitly supersedes its §2.5/§7 AVOID decision). |
| `plans/manifold-parity-features-spec.md` | active | Five playground features for Manifold. Jolt + OU-explore: executed by other means (one-core P3 core bindings). Session presets, pins, control surface: still the live prescription, feeding the curated/advanced split (simplification-plan §6.5c). |
| `plans/playground-2.0-rewrite-plan.md` | superseded | SolidJS clean-room rewrite plan (2026-06-17). Its target (the playground) was retired; many of its ideas shipped in Manifold instead. Still cited as design source by the parity-features plan. |
| `plans/one-core-engine-refactor.md` | active | Firmware+Manifold core reunification (2026-07-13). **All six phases landed on main by 2026-07-18**; stays `active` only for the two hardware-verification chokepoints (its §6) before flipping to executed. |
| `plans/simplification-plan.md` | active | Phased burn-down of the 2026-07-21 simplification audit. Phases 0 (CI/verification), 2 (behaviour bugs) and 3 (truth consolidation, minus S26) burned down 2026-07-21; Phase 1 deletions largely landed; PlatformIO (§5) in flight; §7 lists remaining operator decisions. |

---

## Findings (Immutable, Dated Research)

Exempt from drift lint.

| File | Date | Summary |
|------|------|---------|
| `recon/findings-design-and-manifold.md` | 2026-06-27 | Build-oriented brief synthesizing five redesign docs + Manifold token export + `ConsoleApp.jsx`. VERIFIED from source. |
| `recon/findings-engine-surface.md` | 2026-06-27 | Engine surface audit (deployed JS, WASM, C++ core). Uncovers fixed-2-input WASM gap, loss-history plumbing gap, C15 placeholder. |
| `recon/findings-feedback-behaviour.md` | 2026-06-27 | Current RL feedback behaviour audit. Deployed JS + C++ core use undirected Gaussian noise (not geometric push-away); firmware InterfaceRL implements the true geometric mode. |
| `recon/midi-gamepad-inputs-worklog.md` | 2026-06-27 | Work log of `feat/midi-inputs` branch. Modular input sources (MIDI, gamepad), 32-input WASM foundation, gamepad→verdict wiring. Exclusive picker (not mixing) shipped; mixing engine groundwork done but UI deferred. |
| `recon/upstream-firmware-survey.md` | 2026-06-27 | Git archaeology of the MusicallyEmbodiedML ecosystem. origin/main (C++20/SolidJS rewrite) and upstream/main (old `.ino` firmware) forked at `6efbe9c` (2026-04-14); 49 commits upstream not in origin are ports, not merges. |
| `recon/playground-2026.md` | 2026-04-12 | Design intent snapshot of an unfinished playground UI redesign. Reference-only for SolidJS rewrite; do NOT merge into vanilla playground (those files moved on independently). |
| `recon/simplification-audit-2026-07.md` | 2026-07-21 | Full-repo smell/bloat/spec audit vs the five-bullet one-core vision (66-agent workflow, adversarially verified). 113 findings: CI red since 2026-07-13, memllib pin unpushed, ungated deploys, mode layer unshared, no curated/advanced split, dead-mass inventory. Mitigations in `plans/simplification-plan.md`. |
| `recon/memllib-usage-inventory.md` | 2026-07-21 | Per-file inventory of the memllib surface the firmware actually compiles — the prerequisite for the §7.5 ownership decision. Result: all of memllib bar `examples/` is load-bearing (~1.8 MB / 84 files); no small subset to vendor. |

---

## ADRs (Decision Rationale)

| File | Decision | Audience |
|------|----------|----------|
| `adr/rl-feedback-design.md` | Rationale for the Explore-and-Place + Geometric-Dislike feedback model choices | Implementation team |

---

## Cross-References

- **`MAP.md`** — the neutral inventory of the codebase as it stands (ground truth for what exists).
- **`CLAUDE.md`** — agent contract (gates, hard constraints); `docs/AGENT-REFERENCE.md` — the long-form reference.
- **`ALIGNMENT.md`** — strategic gaps + open mission questions (dated, opinionated gap diagnosis).
- **`manifold/ONBOARDING.md`** — agent-oriented breakdown of the Manifold React app (run/build/deploy/test, UI/engine-spine/WASM layering, convertible Stages, Dock+drawers, gotchas).
- **`docs/redesign/manifold-export/`** — design-token and UI-kit asset export from Manifold design project (not part of this corpus; static asset reference, not migrated).

---

## Open / Deferred

- **Index generation (`.index.json`)**: intentionally not generated yet. No consumer defined; add when crawler/search infra lands.
- **Per-spec §-numbering normalisation**: deferred to a future maintainer pass. Current state mixes flat (§1.1, §1.2…) and three-level nesting (§6.x.y).
- **ADR corpus**: currently minimal (only RL feedback design). Strategic decisions captured in spec Open/Deferred sections; promotion to dedicated ADRs is a future pass.
- **Spec-touched validator**: git-aware lint rule that flags when a code diff touches spec-cited files without also touching the spec. Useful as a pre-commit hook or PR check; infrastructure TBD.
