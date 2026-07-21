---
kind: plan
status: active
---

# Simplification Plan 2026-07 — burning down the audit

*Dated 2026-07-21. Derived from `../recon/simplification-audit-2026-07.md` (finding IDs `A*`/`S*`/`L*`/`ST*` refer to its inventory; every mitigation here was adversarially verified against the code). Companion: `ALIGNMENT.md` carries the strategic tier. Proposal only — no phase is adopted until the operator says so; §7 lists the decisions that gate specific items.*

## §0 Principles and ordering rationale

- **Deletion over refactor, refactor over addition.** Nothing gets a compat shim without a named consumer.
- **Hard constraints hold throughout**: `nisps/` platform-neutral + allocation-free hot paths; native↔WASM parity ≤1e-5; schema changes ship with both codegen outputs; RT-safe worklet/dual-core comms. Every phase ends with `run-all-tests.sh` green.
- **Docs move in the same commits as code** (MAP/ALIGNMENT/spec-corpus sync is part of "done").
- Order: *restore verification first* — until CI runs, nothing else can be trusted to have landed; *then delete dead mass* — it shrinks every later diff; *then bugs, then truth-consolidation, then the vision builds*.
- On adoption of a phase, decompose it into ergo tasks (one per bullet-group below); this doc is the map, not the tracker.

## §1 Phase 0 — Restore verification (URGENT, ~half day) — S7, S24, S31, S32; critic gaps 1–3

**BURNED DOWN 2026-07-21.** All five items landed: memllib `feat/nisps-core-swap` pushed to
`monkey-w1n5t0n/memllib` and `.gitmodules` repointed (pin `b37fc53` now reachable — data-loss risk
closed); the compensating error paragraph in `build-firmware-arch.sh` deleted; codegen dirty-diff +
golden test added to the `manifold-tests` CI job; a WASM freshness gate (parity harness vs the
*committed* artifact) added to `cpp-tests` before the rebuild; and the VPS webhook
(`~/.config/webhooks/meml-deploy.sh`, not in this repo) now blocks the deploy unless the `CI`
workflow concluded `success` on that exact SHA — fail-closed, `MEML_SKIP_CI_GATE=1` to override.

CI has been 100% red on main since 2026-07-13; the cause and the data-loss risk are the same object.

1. **Push `feat/nisps-core-swap` to the `monkey-w1n5t0n/memllib` fork** (3 commits incl. pin `b37fc53` currently existing only on this disk); repoint `.gitmodules` to the fork URL; verify a fresh clone + `submodules: recursive` checkout succeeds; delete the compensating error-message paragraph in `scripts/build-firmware-arch.sh` (S7).
2. Confirm CI goes green end-to-end; only then trust any subsequent gate claims.
3. **Codegen enforcement in CI** (S24, S31): in the manifold-tests job (bun already present) run both generators + the golden test and fail on dirty diff — makes the "regenerated outputs in the same change" rule real.
4. **WASM freshness gate** (S32): before CI's own WASM build overwrites it, run the existing parity harness against the *committed* `manifold/public/nisps.{js,wasm}` so a stale committed artifact fails loudly. (The same artifact is what the VPS webhook ships to production.)
5. **Deploy gating** (critic gap 3, operator decision §7.4): today push-to-main deploys to `meml.lnfinitemonkeys.org/next/` with no gate at all. Cheapest real fix is VPS-side (webhook checks the commit's CI status before building); repo-side minimum is documenting the risk in `manifold/ONBOARDING.md`.

## §2 Phase 1 — Dead-mass deletion sweep (~2–3 days, one commit per group)

All verifier-checked deletions; protected exceptions noted. Rough net effect: thousands of lines removed with zero live-behaviour change.

- **Repo root / hygiene**: retired-playground dist + root Playwright rig + root `package.json`/lockfile/`node_modules` (S23, S29, L55); `NISPS_CORE_EXTRACTION_PLAN.md` + `NISPS_CORE_TASKS.md` (L48/L36); `data/` (L36); committed `.claude/worktrees/` fragment (L32); prune stale `worktree-*` branches.
- **nisps core/ml**: `fixed_buffer.hpp` + its test (L27); `dislike_multiplier_` (L26); `copy_weights_to(span)` to drop `flat_` from FixedStorage and the per-gesture double copy (L28); perf-macro regime — delete the 3/5 dead SRAM macros, fix the one misshapen `NISPS_AUDIO_FUNC` use in `midi_io.hpp` (S21, L13, closes old ALIGNMENT #4). The 16 KB loss-history buffer (L25) waits on the telemetry decision (§7.3).
- **engines/modes**: `voice_space.hpp` (L3); no-op VoiceSpace boilerplate on the five engines without real voice spaces (L9); `SawOsc`/`SquareOsc` — **keep `SineOsc`**, the selftest uses it (L4); `input_dirty_` (L5); VerbFX dead fields/setters (L6); MEMLCelium inert feedback path after checking the upstream app for a missing write (L7). `DriverConfig` (S4) waits on §7.2.
- **wasm bridge**: dead C-API entries through the full 5-layer chain — **keep** `EXPORTED_RUNTIME` `cwrap`/heaps (parity + wasm-load tests build their API via `Module.cwrap`) (S33); `publishWeights_` 200 Hz weight-copy channel (S34); worklet loader dead scaffolding + throwing import stubs (L54).
- **manifold UI**: dead focus/altitude system — SplitStage, ReadoutStrip, InputMini, AltitudeNav, CompactAxis, keep MiniMeters and **don't touch `engine.feedback.setFocus`** (S15); decorative controls — A/B, fake seed/gradient, snapshots, master volume, bpm, training-param sliders per verifier notes (S16, absorbs L1's delete-half); `BackendAdvanced.tsx` duplicate editor table (S18); ConsoleCtx prune to consumed fields (S19); 5 dead primitives (L22); dual backend catalogues (L23); inert soloMode selector + FeedbackController vestiges (L20, L21).
- **backends**: dead protocol legs — sendState/sendWeights, legacy array format, unreceivable `/nisps/state`, unused module-output listeners (L16); delete `bridge.mjs`, keep `bridge.ts` + compiled binaries as distribution (S11).
- **vcv**: `vcv/test/` + `Makefile.dist` + tracked ELF (L33).
- **firmware**: daisysp — 41 dead .cpp per build, delete vendored tree + symlink, fix docs that call it a submodule (S8); `input_router.hpp` zero-logic layer (ST2); peripherals dead declarations + extracted `commit_and_train` helper (L14).

## §3 Phase 2 — Behaviour bugs (~2 days)

**BURNED DOWN 2026-07-21.** All nine landed with regression tests where testable. Two deviations
from the text below, both deliberate: **L35** was resolved by DELETING the OSC full-state bridge
rather than moving its JSON to the worker — reading the current transport showed both directions
have zero consumers (manifold's osc-client.ts never sends `/nisps/state`|`/nisps/weights` and
bridge.ts drops them), so relocating heap-heavy work to serve nobody was the wrong shape;
`dataToJson`/`dataFromJson` are untouched and still serve Rack patch save/load off the audio
thread. **S35** required extending `nisps_ml_describe` from a 6-int to a 7-int wire format, which
forced matching buffer-size fixes in two call sites outside the finding's scope
(`wasm-worker.ts`, `parity_wasm.mjs`) that would otherwise have overflowed the WASM heap by 4
bytes on every call. Also fixed en route: `manifold/package.json`'s test script listed test files
explicitly, so new unit tests were silently not run — now a glob.


- **S35** Dual example store: name `kDefaultMaxExamples = 128` once in nisps, expose via `nisps_ml_describe`, align the TS mirror (currently 100) — fixes `train()`/`trainAsync()` diverging past 100 examples and the latent OOB sample-weight read.
- **S10** VCV bridged mode truncates inputs to 2-D: `EngineApi.inputVector()` returns the spine's full N-dim raw vector; VcvBackend tracks/dead-zones the full length.
- **L34/L35** VCV plugin RT-safety: worker deep-copies example vectors into staging before flagging; move full-state JSON off Rack's audio thread onto the existing worker (reuse the staged-weights pattern).
- **L18** MIDI input flooding React per CC message → notify only on binding-list changes; **L19** BackendManager dropping a switch requested mid-switch; **L24** ConsoleApp global-listener effects re-subscribing every render.
- **S30** lint-cpp: cover `nisps/pipeline/` + `core/`, strip comments before matching, extend the heap pattern set — the no-heap gate currently has proven false-negative modes; **L52** parity-check.sh unreachable FAIL branch under `set -e`.
- **L51** parity runner header/stage-list drift (4-stage/v1 documented vs 7-stage/v5 real).

## §4 Phase 3 — Single-source-of-truth consolidation (~2–3 days)

**BURNED DOWN 2026-07-21**, except **S26**, which is now an operator decision backed by a
per-field inventory (see below). Every generated numeric value is byte-identical to what was
committed — the diff on the generated dirs is purely additive, which is what a relocation of truth
should look like. Three audit claims were wrong and are corrected in the commits: L8's "breakor and
elysiamorf duplicate ratio_seq" (elysiamorf has no ratio_seq at all; the real duplicate pair is
breakor + memlcelium), ST13's proposed destination would have broken codegen (the generator
ajv-validates every `*.json` directly under `schemas/midi_devices/`, so the provenance file went to
a `sources/` subdir), and ST4's remaining-copy count.

**S26 — decision now cheap.** `ml.default_spread` is already wired on both targets (the audit's
"zero consumers" claim was a quarter wrong). `ml.default_learning_rate` and
`ml.default_max_iterations` are unread on both targets, but every schema carries exactly 1.0/1000,
which are precisely the values hardcoded in `mlp.hpp` and `wasm-iml.ts` — so **wiring them is
numerically a no-op today** and simply makes the schema the source of truth it claims to be.
`ml.input_channels` is read by nobody at runtime but is validated at codegen time and carries real
information for `sound_analysis_midi`. Per-param `curve` is a **trap**: `params_notes.md` says it is
DESCRIPTIVE — it documents that engine voice spaces already square the value internally — so
"wiring" it would double-apply squaring on 35 params.


- **S1** Mode identity: codegen emits an `ALL_MODE_SCHEMAS` registry; `SCHEMA_MODES` becomes a mode_id→display-overlay map (labels/glyphs stay legitimately hand-curated); **L37** delete the hand-`switch`ed `modeEngineId` (route on schema `engine_id`, single named exception for sound_analysis_midi).
- **S5** codegen emits per-mode `kXSchema` ParamSchema constants (deletes 9 hand-written 12-field blocks); **S6/S25** MLP template args come from generated constexpr dims (or `static_assert` parity), killing the hand-typed-dims dual truth; **L11** ext-synth ML config folds into the same pipeline.
- **S26** Schema surface honesty: per-field wire-or-delete pass (default_learning_rate/max_iterations both-platforms-or-neither; input_channels; per-param curves) per the verifier's corrected list.
- **L38** one TS `applyCurve` (mapping.ts's spec-anchored formula survives); **ST4** one GROUP_COLOR source; **L8** extract shared `ratio_seq`/SeqClock/EventQueue for the sequencer engines; **L17** BaseBackend mirroring BaseSource for status/throttle plumbing; **ST12** shared codegen `lib.ts`; **L39** delete the clobbering seed script (git keeps it); **ST13** move `synth-midi-cc.json` under `schemas/midi_devices/`.

## §5 Phase 4 — PlatformIO migration (vision 4) (~2–3 days) — A6, S2, L12, S9

One cut, no dual path. `firmware/useq-celium/` already proves the PIO + arduino-pico pattern in-repo.

- `platformio.ini` with one `[env]` per firmware variant passing `-DMEMLNAUT_MODE_TYPE=<alias>`; selftest becomes a plain `-DNISPS_SELFTEST=1` env. Deletes: the sed/python machinery in `firmware-common.sh` that **mutates the committed .ino**, the `.ino` comment-registry, the entire `NISPS_ST_*` token-paste table (already silently missing the currently-active SLPWorkshop variant — L12), the sketch-tree symlink forest, and the global TFT_eSPI library mutation (handled via PIO lib config/build flags instead).
- **memllib consumption decision** (§7.5): **SETTLED — the submodule bump landed; the vendoring copy
  is what remains.** See `../recon/memllib-usage-inventory.md`. Result: all 24 compiled TUs link, so
  the vendoring surface is ~1.8 MB / 84 files — all of memllib bar `examples/`; there is no small
  subset to lift. The operator chose "rebase then vendor", but on inspection **there was no rebase to
  do**: all three fork commits touch only `examples/`, which is not in the sketch symlink forest and
  is never compiled, and whose content is already ported into `nisps/ml/`. So the fork is dissolved
  and the submodule is repointed at upstream, pinned to current `main` — verified by building all
  three variants (+316 bytes flash, one `constexpr`→`const` fix in the `.ino` because upstream made
  `kSampleRate` runtime-settable). That bump brings the `l r input swap` hardware fix and the
  `NavigateToView` the SelfTest variant had already been written against. **Vendor from this
  snapshot**, recording the upstream commit so a re-sync stays a documented diff.
- Then **S9**: a CI job compiling 2–3 representative envs with cached toolchain — firmware enters an automated gate for the first time.

## §6 Phase 5 — Vision-facing architecture (each item spec-first, own session)

- **5a Mode-layer reunification (A1, A5).** The verified shape: do *not* bind monolithic mode objects into WASM and do not delete the per-primitive C API (contradicts the locked P2/P3 architecture and the two-instance RT split). Instead storage-policy the ModeBase orchestration the way P2 did MLPCore, so control-tick behaviour (jolt stepping, OU, routing, event pump) exists once in C++ and the browser stops hand-mirroring it. Needs its own spec before code.
- **5b Browser mode coverage honesty (A2).** Add an audio-topology notion (generator / audio-in-fx / event-only / analysis) so Manifold stops cataloguing 4 modes that structurally cannot run; wire mic input for the audio-in class (absorbs old ALIGNMENT #1); event-only modes need transport/MIDI-out UI, or explicit "hardware-only" labelling.
- **5c Curated/advanced split (A3, A7).** Product model first (§7.6): what is a "curated preset" — schema + backend preset + input map + trained net? Then: instrument picker rendered from the already-plumbed `ctx.modes`/`setModeId` (engine reshape-on-switch already works); per-drawer depth levels as the disclosure mechanism rather than one global boolean; `backends/presets.ts` + schemas seed the data model (add the missing `cv` backend to presets — small bug from A3's verification).
- **5d Hardware editor (A4, S14).** The repo already contains the right discipline: `useq-celium`'s C-header wire-protocol truth + TS mirror + parity test. Apply it to a MEMLNaut USB-serial protocol; give firmware an actual command surface + on-device persistence; settings/training payloads derive from schema codegen, not hand-defined tables. `InputChain`/`OutputChain` firmware wiring (L29) lands here or gets its comment softened now.
- **5e Training-health telemetry (critic gap 5; §7.3) — DECIDED, unblocked.** It *is* a feature, but browser-only and behind a feature flag. L1's fabricated gradient UI was deleted in Phase 1. **L25 resolved: keep the firmware loss-history buffer** (operator) — it is the on-device record 5d's hardware editor will read, and the RAM is demonstrably there. Remaining: add a `loss_history` C-API entry across the 5-layer registration chain, replace `wasm-worker.ts:310`'s 1-element fake with it, and surface it plus the already-plumbed `get_layer_stats` behind the advanced-mode flag. No judgement calls left in this item.
- **5f Performance measurement (critic gap 4).** A host-side blocks-per-second benchmark for `engine_process_block` (native + WASM), and `build-firmware.sh` emitting a per-variant flash/RAM size report — makes the headline constraint enforceable instead of vibes.

## §7 Operator decisions needed

1. **S20 legacy feedback modes** (RandomiseOutputs/RandomiseMlp/Diffuse/on_drag): deletion reverses the explicit "keep for A/B comparison" in `docs/adr/rl-feedback-design.md` — delete (and amend the ADR) or keep?
2. **S4 DriverConfig**: wire the firmware audio driver to read it at mode start (makes mic/line settings real) or delete the contract from the concept + all 8 engines. No dead middle.
3. **Telemetry** (§6.5e): feature or delete.
4. **Deploy gating** (§1.5): gate the webhook on CI, or accept ungated deploys knowingly.
5. **memllib ownership** (§5): fork-pin vs vendored subset vs upstreaming to MusicallyEmbodiedML.
6. **Curated-preset product model** (§6.5c): what a preset bundles; where curation lives.
7. **S12 inputs composition**: mix-and-match multi-source remains an unreversed 2026-06-28 decision with groundwork deliberately laid — schedule the UI, or keep dormant (spec relabelled either way).

## §8 Docs/specs disposition (executes alongside phases; ~1 day)

| Doc | Disposition |
|---|---|
| `aimmersive-clone-spec.md` | Archive (`_archive/`, deprecated-by note) — specs a retired product; strip chat residue (L42) |
| `feedback-modes-port-spec.md` | Reclassify `kind: plan, status: executed`; ADR + `feedback.hpp` are the truth (L43) |
| `plans/BUILD-PLAN.md` | `status: executed`; two-line survivors note (L44) |
| `plans/playground-2.0-rewrite-plan.md` | `status: superseded` (retired target) (S3) |
| `engine-architecture.md` | Excise dead playground2 sections; keep EngineApi-seam + spine contract with supersession header (S3, L45) |
| `MAIN.md` | Fix the ≥6 contradicted claims; update registry rows (S27) |
| `manifold-parity-features-spec.md` | Reclassify plan; mark Jolt/OU executed-by-other-means; presets/pins sections stay live feeding 5c (S28) |
| `vcv-module.md` + `vcv/README.md` + `NISPS-FORMAT.md` | Prune to the current 8→16 contract; one format spec, not two (S22, L46) |
| `inputs/backends/dock` spec trio | Mark grounding sections historical; fix dead cites; drop aimmersive counterpart links (L50) |
| `MAP.md` | Flatly-false lines fixed with this commit (phantom `MEMLCelium-upstream`, exploration.ts, daisysp "submodule", pre-P5 sentence, perf-attr "globally" claim); the rest moves with the phases that change the code (L2, L15/L31/L41, L49, ST7, ST15) |
| `AGENT-REFERENCE.md` | Pre-P5 sentences updated (L49) |
| `codegen/README.md` | Rewrite or shrink to a MAP pointer; drop `port-solidjs` CI trigger (ST10) |
| Root `NISPS_CORE_*` relics | Deleted in Phase 1 (L48) |
| `ALIGNMENT.md` | Rewritten with this commit (L30, L47, ST6 fold into their code phases) |

## §9 Effort summary

| Phase | Cost | Depends on |
|---|---|---|
| 0 Restore verification | ~half day | — (do first, includes the only data-loss risk) |
| 1 Dead-mass deletion | 2–3 days | 0 (green gates to delete against) |
| 2 Behaviour bugs | ~2 days | 0; independent of 1 |
| 3 Truth consolidation | 2–3 days | 1 (less mass to consolidate) |
| 4 PlatformIO | 2–3 days | 0.1 (memllib remote); §7.5 |
| 5 Vision builds | spec-first, weeks, incremental | 1–4 recommended; §7 decisions |
| Docs disposition | ~1 day | interleaved |

Phases 1–3 are safe, mostly-mechanical, and could be largely agent-driven with the existing gates. Phase 4 is bounded and proven in-repo. Phase 5 is where the product decisions live — each item deserves its own spec + session, in the order 5c → 5a → 5d (curation is the user-visible payoff; reunification derisks everything mode-shaped; the editor closes the hardware loop).
