# MAP

MEMLNaut-NISPS — Neural Interactive Shaping of Parameter Spaces. One C++20 codebase (`nisps/`) compiles to two targets: (1) Arduino/RP2350 firmware for the MEMLNaut hardware, (2) WASM in the Manifold React browser app that runs the same engines + ML through an AudioWorklet. (The former SolidJS playground was retired 2026-07-13 — branch `archive/playground-solidjs`, tag `playground-solidjs-final`; the browser-only C15 engine lives only there for now.) See `CLAUDE.md` for the long-form architecture narrative and `ALIGNMENT.md` for current strategic gaps.

## Layout

### `nisps/` — platform-agnostic C++20 library (the only ML/DSP/engine code)
- `nisps/core/` — `perf.hpp` (hot-path/inlining attrs), `types.hpp`, `concepts.hpp` (`MLEngine`, `AudioEngine`, `Mode`), `ring_buffer.hpp` (SPSC lock-free cross-core channel, replaces pico/util/queue), `event_queue.hpp` (single-threaded in-engine event FIFO — deliberately NOT RingBuffer, which is an atomics-based cross-thread channel), `rng.hpp` (xoshiro256+ deterministic), `math.hpp` (fast_sigmoid, `Curve` enum + `apply_curve`).
- `nisps/ml/` — the MLP core, written once against a storage policy (`mlp.hpp` `MLPCore<Storage>`): `storage.hpp` (`FixedStorage` — template-sized `std::array`, zero heap; `MLP<NIn,NH1,NH2,NH3,NOut>` alias preserves the classic compile-time surface) and `dynamic_storage.hpp` (`DynamicStorage` — runtime dims, single arena alloc at construction; `#error`s on RP2350 builds, sole lint heap-allowlist entry). Fixed↔dynamic bit-parity enforced by `tests/cpp/test_mlp_storage_parity.cpp`. Files: `mlp.hpp`, `activations.hpp`, `loss.hpp` (MSE, no double-scaling), `training.hpp` (**RMSProp** + grad clipping — `rmsprop_step()` is a line-for-line port of upstream memlp `Layer.h:239 ApplyAccumulatedGradients` @ `ea777502`; the per-weight running squared-gradient average is optimiser state held in the storage policies, NOT part of `weight_count()`/`get_weights()`, and `MLPCore::reset_optimizer_state()` clears it. `draw_weights()` deliberately does not, matching upstream `DrawWeights`), `init.hpp` (spread-aware uniform↔Xavier), `rl.hpp` (`move_weights` with output pin mask + per-layer scaling + weight decay), `jolt.hpp` (`Jolt` — held continuous weight-morph over the flat weight buffer + post-release LR ramp; ported from upstream InterfaceRL), `ou_noise.hpp` (`OUNoise<N>` — Ornstein-Uhlenbeck exploration walk on the output vector; ported from upstream InterfaceRL), `feedback.hpp` (`FeedbackControllerCore<FbStorage>` — the "Down Action" state machine: Avoid (geometric push-away default / Diffuse legacy) / RandomiseOutputs / RandomiseMlp / ExploreAndPlace; storage-policied like the MLP, own deterministic RNG, exposed via `nisps_ml_feedback_*` C API), `replay.hpp` (`ReplayView` — reward-tagged memory: dedup/deepen, k-NN positive centroid with deterministic tie-break, proportional decay+eviction), `geo_push.hpp` (push-away target computation, upstream InterfaceRL @ `e291192` — re-based from `0a541cc` on 2026-07-25: `kGeometricPushScale` 1.0, `kNegLRBase` 1.5, and NO `/(1+len)` taper, so distance from the liked centroid does not shrink a "no". Cold start is the same push in a random direction, not a separate branch), `warm_start.hpp` (overlapping-weights copy for reshape), `stats.hpp`. `generated/ml_defaults.hpp` is codegen output (do not edit): `nisps::ml::generated::kMlTrainDefaults`, the ONE learning-rate / max-iterations / min-error default shared by firmware, WASM and VCV (source `schemas/ml_defaults.json`); `MLPCore::set_train_config()` and `nisps_ml_set_train_config()` override it at runtime. It lives under `ml/` rather than `modes/generated/` because `nisps/ml` sits below `nisps/modes` — mlp.hpp must not include upward. Jolt + OU are inert by default and wired into `ModeBase`, so every mode exposes `jolt_press/jolt_release`, `jolt_lr_scale`, and `set_explore_intensity`.
- `nisps/pipeline/` — the control-rate input/output processing chains (P4): `input_chain.hpp` (`InputChain` — invert→deadzone→circular clamp→momentum-modulated zoom→centred power→EMA→momentum; caller-supplied dt, internal clock, fixed velocity ring, serialisable state) and `output_chain.hpp` (`OutputChain<NMax>` — curve→EMA→slew→freeze(+mask), capacity-templated). Behaviour contract = the retired manifold TS pipelines, pinned by `manifold/tests/fixtures/` and parity stage 7.
- `nisps/dsp/` — `biquad.hpp`, `delay.hpp`, `reverb.hpp`, `filter.hpp`, `env.hpp`, `osc.hpp`, `pitch_shift.hpp`, `dc_blocker.hpp`, plus the sequencer primitives shared by the sequencer engines: `ratio_seq.hpp` and `seq_clock.hpp` (bar phasor + MIDI clock + bpm). Lean primitives extracted from maximilian; daisysp PitchShifter replaced with custom granular impl.
- `nisps/engines/` — eight audio engines, each satisfying `AudioEngine`: `paf_synth.hpp`, `channel_strip.hpp`, `xiasri.hpp`, `verb_fx.hpp`, `memlcelium.hpp`, `breakor.hpp` (sequencer, NoOp audio), `elysiamorf.hpp` (sequencer, NoOp audio), `analysis.hpp` (input-side spectral features). Plus `base.hpp` (`NoOpEngine`, engine_id "thru").
- `nisps/modes/` — platform-agnostic modes binding `{ML config, engine, voice space lambdas, abstract I/O channels}`. Files: `paf_synth.hpp`, `channel_strip.hpp`, `xiasri.hpp`, `verb_fx.hpp`, `memlcelium.hpp`, `slp_workshop.hpp` (`SLPWorkshopMode` — the Synth Library Portland workshop build; reuses the MEMLCelium engine + MLP shape, foregrounds the Jolt + OU explore gestures), `breakor.hpp`, `elysiamorf.hpp`, `sound_analysis_midi.hpp`, `external_synth_midi.hpp` (`ExternalSynthMIDIMode<const MidiDevice&, NOut>` — joystick→MLP→MIDI CC for an external synth; compile-time device from `nisps/midi`; `consteval pick_cc_slots` curates which params fill the NOut slots; NoOpEngine, `kRouteOutputsToEngine=false`). `base.hpp` provides a CRTP scaffold eliminating the duplication that previously plagued firmware modes; it also owns `driver_config()` — the audio-driver setup (mic vs line, gain staging, sample rate) the platform glue reads at mode start. Defaults to `engine().driver_config()`; a mode overrides it with an optional `on_driver_config()` hook only when its engine is not what consumes the audio input (`sound_analysis_midi`, whose analyser rather than its NoOp engine owns the mic). `generated/` contains codegen output (do not edit by hand): per-mode `k<Mode>Schema` ParamSchema instances, the `<Mode>MLP` type aliases built from the schema's own dims, and `schema_types.hpp` which now owns the `ParamSchema` struct itself. Mode headers no longer hand-write either their schema aggregate or their net shape.
- `nisps/wasm/bindings.cpp` — flat C API exported to WASM (Emscripten target only).
- `nisps/midi/generated/midi_devices.hpp` — codegen output: no-heap `constexpr` external-MIDI-synth templates (`nisps::midi::generated`; `MidiParam`/`MidiDevice` + `kMidiDevices` registry). Source = `schemas/midi_devices/`; do not edit by hand.
- `nisps/CMakeLists.txt` + `nisps/build/` — host-target builds + ctest.

### `firmware/` — PlatformIO project + hardware glue
- `firmware/MEMLNaut-NISPS/platformio.ini` — **the variant registry**: one `[env:<alias>]` per firmware variant (16 of them), each passing `-DMEMLNAUT_MODE_TYPE=<alias>`; `selftest` passes `-DNISPS_SELFTEST=1` instead. There is no second list to keep in sync. Shared `[env]` base pins the platform wrapper + arduino-pico framework, sets `-std=gnu++20 -O3` (via `build_unflags`, because the framework appends its own `-std=gnu++17 -Os` AFTER project flags), reaches `nisps/` with `-I${PROJECT_DIR}/../..`, and carries the TFT_eSPI panel config as `-D` flags. Build: `pio run -e <alias>`, or `scripts/build-firmware.sh [--all]`.
- `firmware/MEMLNaut-NISPS/src/main.cpp` — entry point (was `MEMLNaut-NISPS.ino`). Forks on `NISPS_SELFTEST`: normal modes run the engine/ML path; the `SelfTest` variant delegates all four entry points to `glue/selftest.hpp`.
- `firmware/MEMLNaut-NISPS/glue/` — hardware bindings:
  - `audio_driver.hpp` — bridges memllib `AudioDriver` callback → `Mode::process(stereosample_t)`, and brings the codec up on the **active mode's** `driver_config()` (`setup_audio_driver`) plus publishes its preferred sample rate before the system clock is derived from it (`apply_mode_sample_rate`). Mic vs line input is therefore a mode-level declaration, not a firmware constant.
  - `codec_config.hpp` — pure, Arduino-free clamping of a `nisps::DriverConfig` to SGTL5000-representable values + sample-rate resolution (unsupported/"don't care" → 48 kHz, because `AudioDriver::GetSysClockSpeed()` `panic()`s otherwise). Host-tested by `tests/cpp/test_mode_driver_config.cpp`.
  - `peripherals.hpp` — joystick / pots / buttons → `Mode::set_input` and ML primitives. Wires the shared `FeedbackController` ExploreAndPlace lifecycle (MomA1 = enter/exit explore, MomA2 = freeze/place, TogB2 = commit; MomB1/MomB2 = reroll/nudge while exploring **or** grab/drop *reposition* while idle) plus the adaptive-learning gestures: **TogB1** = Jolt (held weight morph), **RVX1** = exploration amount (OU output walk). Reposition relocates an existing positive example's output to a new input position (`feedback.hpp` `begin_reposition`/`commit_reposition`) — no scratchpad, no weight restore.
  - `midi_io.hpp` — MIDI in → mode `note_on`/`update_bpm`/`set_playing`; drains `ControlEvent` ring → MIDI UART.
  - `mode_select.hpp` — type aliases mapping firmware mode identifiers to `nisps::modes::*Mode` C++ types, selected by the `-D` from platformio.ini. Includes the six `MEMLNautModeExtSynth*` external-synth variants (one per device template in `nisps/midi`, e.g. `MEMLNautModeExtSynthSub37`). The `NISPS_ST_*`/`NISPS_ST_CAT` token-paste table and the `SelfTestRig` tag type are GONE — selftest is now just an env with its own `-D`.
  - `selftest.hpp` — standalone guided hardware self-test rig (`SelfTest` variant; no engine/ML). Step-driven state machine on a `SelfTestView`: TFT prompts the operator through every control, auto-advances on detection, encoder-press skips. Ends with optional L/R/BOTH sine-sweep headphone check (core 1 block callback) + MIDI loopback-cable test. Lives firmware-side (touches TFT + raw pins) so it stays out of platform-agnostic `nisps/`.
  - `output_router.hpp` — top-level `drain_outputs()` entry point. (Inputs are wired directly by `peripherals.hpp`'s `bind_peripherals()`.)
  - `settings_view.hpp` — `wire_settings(mode)`: adds on-device settings views to the MEMLNaut display carousel (TFT + rotary encoder). Joystick Dual/Single toggle for the 4-input ("two 2-D joystick") modes — "Single" pins ML input channels 2,3 to neutral via `ModeBase::set_input_pinned` (no net rebuild). Registered in the `.ino` after `addSystemInfoView()`.
- `firmware/MEMLNaut-NISPS/lib/memllib/` — **vendored** memllib (was the `src/memllib` submodule): hardware abstraction (audio driver, TFT display, MIDI, peripherals), ~1.9 MB / 100 files, `examples/` dropped **except** `reference/InterfaceRL.{hpp,cpp,tpp}` + `InterfaceRLFileFormat.hpp` — upstream's reference implementation of the feedback subsystem `nisps/ml/{geo_push,replay,feedback,jolt,ou_noise}.hpp` were ported from, kept verbatim and NEVER compiled (`reference/` sits outside `src/`, which is the only thing PlatformIO builds). It is there so upstream drift is a `diff`; losing it is how the e291192 geometric-dislike redesign went unnoticed for months. `VENDORED.md` records the upstream commit and the re-sync procedure; `LICENSE` is MPL-2.0, copied verbatim. **Sources must sit under `lib/memllib/src/`** — PlatformIO's library builder falls back to a flat root-only scan without it and silently compiles nothing while still linking (see VENDORED.md).
- `firmware/README.md` — structure + build instructions.
- `firmware/useq-celium/` — standalone RP2040 firmware (PlatformIO, Arduino-Pico core) that turns a uSEQ module + CV expander into a USB→CV/gate converter driven by the manifold `cvgate` backend. `shared/protocol.h` is the v2 wire-protocol single source of truth (mirrored by `manifold/src/backends/useq-protocol.ts`); `main/` (USB serial → CV1–3 + GATE1–3, I2C → expander) and `expander/` (I2C slave → CV4–11). Wire spec: `docs/specs/useq-cv-protocol.md`. Restored from the April-2026 "uSEQ-Celium" mode.

### `manifold/` — Vite + React + TS convertible-mode app (the sole browser app)
The Manifold "convertible" Console on the real engine, deployed at `meml.lnfinitemonkeys.org/next` (staging,
alongside the live vanilla a-immersive at `/`). Built 2026-06-27/28; see `docs/specs/plans/BUILD-PLAN.md` (resume
anchor + locked decisions) and the `docs/specs/*-spec.md` set.
- `manifold/src/engine/` — the parity-tested TS engine (same `nisps.wasm`), made
  framework-neutral: `wasm-iml.ts` (rewired off Solid stores onto an injected `EngineSink`), `engine-host.ts` +
  `worklet/nisps-processor.ts` (audio), thin WASM wrappers over the core pipelines + curve catalog (the TS
  `input-pipeline`/`output-pipeline`/`curves` implementations died at P4), `wasm-worker.ts`,
  `spine.ts` (the reactive spine BELOW React — `setInput` derives processed→ml→routed eagerly off-render),
  `engine-api.ts` (`EngineApi` façade incl. live architecture/weight/example metrics and `feedback.*` wrappers over the `nisps_ml_feedback_*` C ABI),
  `EngineProvider.tsx`/`useEngine.ts` (React binding via `useSyncExternalStore` version counter). nisps.js is
  loaded via fetch+indirect-eval (Emscripten MODULARIZE glue has no ES exports), base-aware via `document.baseURI`
  for the `/next` sub-path.
- `manifold/src/primitives/` — the 7 design primitives as typed React (Badge, Button, PillToggle, Slider, Switch, VirtualJoystick, XYPad). Five unused ones were deleted in the 2026-07 sweep (L22).
- `manifold/src/console/` — the convertible Console: `ConsoleApp`, `CompositeStage` (single-divider convertible
  with snap/magnetism/minimap-demotion), `OutputStage`/`SandwichStage`/`ParticleStage`/`Manifold` (canvas,
  rect↔circular + feedback markers; ParticleStage has interactive cursor-labelled heatmap sliders), `Dock` (top Mode selector + 5 vertically-centred drawers), `Drawers`
  (Learning/Inputs/Outputs/Settings/Help; Learning includes the live model-architecture inspector and
  expanded Outputs owns the remaining scroll height), `TrainingHealth` (real per-iteration loss curve from
  `nisps_ml_loss_history` + per-layer weight health from `nisps_ml_get_layer_stats`; rendered only at
  the Learning drawer's `expanded` depth — that IS the advanced-surface flag), `VerdictCluster`
  (mode-aware), `OutputEditor`/`DualRange`/`CurvePad`, `icons.tsx`
  (monochrome currentColor SVG), `model.ts` (`MF_MODES` catalogue — schema-backed modes DERIVED from
  `manifold/src/modes/generated/`; carries per-mode `ml` net shape + `engineId`), `output-mode.ts`.
- `manifold/src/modes/generated/` — codegen output (`*_schema.ts`, do NOT hand-edit): `ModeSchema`
  consts (mode_id, engine_id, ml dims, params, voice_spaces, ui) — the SOURCE OF TRUTH for `MF_MODES`.
  Switching mode reshapes the WASM net to the mode's `ml` dims (ConsoleApp P5.3; boot mode paf_synth →
  4→[10,10,14]→33).
- `manifold/src/dock/` — `OutputControlRow` (add/delete card identity + off/fixed/live + mute + solo/arm + min/max/curve, plus MIDI card fields), `output-state.ts`,
  `OutputsBackendConfig.tsx` (per-backend specialised Outputs panel — the sole per-backend editor; the centered add-card control lives below the rows).
- `manifold/src/backends/` — `OutputBackend` adapter + `BackendManager` (spine consumer); `midi-backend.ts`
  (WebMIDI), `osc-backend.ts`+`osc-client.ts` (OSC-over-WS), `vcv-backend.ts` (VCV-over-WS), `cv-backend.ts`
  (`UseqCvBackend` — uSEQ CV/gate over USB Web Serial, backend id `cvgate`) + `useq-protocol.ts` (v2 wire
  protocol, mirrors `firmware/useq-celium/shared/protocol.h`; `useq-protocol.test.ts` runs via `bun test`),
  `particle-backend.ts`, `passthrough-backend.ts`, `presets.ts` (named presets), `manager.ts`.
- `manifold/src/midi-devices/` — external-synth device templates. `generated/` is codegen output from
  `schemas/midi_devices/` (`MIDI_DEVICES` catalogue + `MIDI_DEVICES_BY_ID`, params by name+CC). The MIDI Outputs
  config (`dock/OutputsBackendConfig.tsx`) reads it for the device picker + param-select that fills the per-card MIDI fields.
- `manifold/src/inputs/` — modular INPUT layer feeding the ML head. The Inputs dock picks ONE exclusive mode
  (`InputMode` = `internal` | `gamepad` | `midi`; Internal/XY-pad is default). `input-layer.ts` owns a single rAF
  loop composing the active source's axes → **one dedicated engine input slot per axis, 1:1, no blending** → one
  `setInputs`, plus an `onReducedInput` callback the manifold tracks. The WASM net is over-provisioned to a
  32-input head (`MAX_AXES`, `nisps/wasm/bindings.cpp`); unused slots are zero-padded and a zero input is inert,
  so idle sources cannot perturb the net. Mean-blending was removed deliberately — it diluted every source and
  biased the net toward idle sources' resting values. Active-axis edits follow the persistent I/O policy:
  keep-capacity permutes stable identities in place until more slots are required; exact-I/O reconstructs
  to the active count. Surviving weights and (under adapt policy) examples are identity-remapped; feedback
  scratch state resets. Sources: `xy-pad-source` (push-driven),
  `gamepad-source` (sticks→axes single/double; buttons emit press+release actions, bound in `ConsoleApp` to
  verdicts — LB/RB=down/up, X/Y/B=randomise/nudge/undo, A-hold=reposition), `midi-input-source` (device picker +
  BATCH "MIDI Learn": every CC swept while armed becomes an axis, shown as read-only meters). `useInputLayer.ts`
  is the React binding; `base-source.ts` shared status/action plumbing; `types.ts` the adapter contract.
  `backends/base-backend.ts` is its output-side counterpart (status + throttle + lastSent) used by the midi/osc/vcv transports.
- `manifold/src/feedback/` — `controller.ts` (Explore-and-place scratchpad + geometric-dislike + solo; a thin
  driver over the shared C++ core).
- `manifold/src/settings/` — `settings-store.ts` (monochrome icons, input-map shape, I/O resize policy, corner radius, and the opt-in legacy Xavier/spread feature flag; Manifold randomisation is full-range uniform by default).
- `manifold/src/serial/` — `memlnaut-serial.ts` Web Serial scaffold + `EditorPanel.tsx` (MEMLNaut Editor mode).
- `manifold/src/engine/exploration.ts` — Jolt press + OU explore gestures (Learning drawer): a thin
  timer-driver over the shared C++ core via the `nisps_ml_jolt_*`/`nisps_ml_ou_*` bindings (the interim
  TS math and `jolt.ts`/`ou-explore.ts` were deleted when P3 landed).
- `manifold/src/engine/io-reshape.ts` — the deep identity-migration module for I/O card edits:
  exact-vs-capacity reconstruction decisions, flat weight remapping, and example vector adaptation.
- `manifold/src/debug/probe.ts` — `window.__nisps` (`?debug=1`). `manifold/tests/e2e/` — `smoke`,
  `probe-api` (engine-contract port), `spine` (spine invariant + probe-survives-mode-switch),
  `geo-dislike`, `reshape`, `schema-modes`, `training-health` (the loss/layer-stats panel + its
  expanded-depth gating). E2E on the VPS runs via non-snap node (see BUILD-PLAN).
  `manifold/tests/fixtures/` — golden parity
  fixtures (gesture trace, curves, input/output pipelines) captured 2026-07-13 pre-P4, guarded by
  `tests/pipeline-golden.test.ts` (in `bun run test`). `tests/loss-history.test.ts` drives the
  `nisps_ml_loss_history` C ABI straight at the committed WASM — the training path parity-check
  never touches. `manifold/osc-bridge/` — Deno WS↔UDP-OSC bridge.

### `vcv/` — VCV Rack 2 plugin (MEMLNaut module, WIP)
Native C++ Rack module: ML CV-mapper with RL feedback + a browser bridge. **8 inputs × 16 outputs + per-output
LED rings**, palette from the frontend tokens, WS↔OSC browser bridge (see `docs/specs/vcv-module.md`).
`src/MEMLNaut.cpp` (module, 8→[16,24,16]→16), `src/iml.hpp` (**thin adapter over `nisps::ml::MLPCore<DynamicStorage>`
+ core `nisps::Rng`** — P6 reunification 2026-07-18, closes vcv-module.md delta #5; behaviour is now core-exact,
pinned by `tests/cpp/test_vcv_iml_parity.cpp`), `src/osc_server.hpp` (bridge, transport-only), `src/plugin.{hpp,cpp}`,
`res/*.svg` (panels), `Makefile` (needs `RACK_DIR`). Builds against the current `../nisps/` core via relative
includes; no `nisps-core`.

### `schemas/` — JSON parameter contracts (firmware/browser source of truth)
- `schemas/schema.json` — Draft 2020-12 meta-schema validating mode files.
- `schemas/modes/<mode>.json` (×9) — each mode's params, ranges, defaults, curves, voice spaces, ML config. (`slp_workshop.json` reuses `engine_id: memlcelium`.) `params[].curve` is the mode-wide DEFAULT response curve; a `voice_spaces` entry may be an object `{name, curve_overrides}` declaring only the slots where THAT voice space deviates (index i == `VoiceSpace` ordinal i). Descriptive throughout: the curve is applied exactly once, inside the engine's voice space.
- `schemas/modes/params_notes.md` — provenance notes and judgement calls per mode, plus the exact `square`/`sqrt`/`linear` predicate the drift check enforces.
- `schemas/midi_device.schema.json` — Draft 2020-12 meta-schema for external-MIDI-synth templates.
- `schemas/midi_devices/<device>.json` (×6) — CC-controllable external synths (Moog Sub 37 / Sub Phatty, Creamware Pro-12 ASB, Elektron Analog Keys, ASM Hydrasynth, Roland JD-800). Each param: `{id, cc, label, min, max, default, group}`. Canonical source for both firmware + browser device pickers. Verified-CC provenance + sources live in `schemas/midi_devices/sources/synth-midi-cc.json` (a `sources/` subdir, because the generator ajv-validates every `*.json` directly under `midi_devices/` as a device template).

### `codegen/` — schema → C++/TS code
- `codegen/generate.ts` — Bun script: validates schemas via ajv (incl. the P5 firmware-fit check: exactly 3 hidden layers, dims ≤4096), emits per-mode C++ `nisps/modes/generated/<mode>_schema.hpp` (`constexpr`, `nisps::modes::generated`) AND TS `manifold/src/modes/generated/<mode>_schema.ts` (+ `types.ts`, `index.ts`). Idempotent; golden-tested in `run-all-tests.sh` stage 5. The TS output is the SOURCE OF TRUTH consumed by `MF_MODES` (`manifold/src/console/model.ts`).
- `codegen/generate-midi-devices.ts` — separate Bun script (isolated from the mode golden test): validates `schemas/midi_devices/` via ajv, emits `nisps/midi/generated/midi_devices.hpp` (no-heap `constexpr`) and `manifold/src/midi-devices/generated/{types,devices,index}.ts`. Idempotent.
- `codegen/curve-audit.ts` — reads `nisps/engines/*.hpp` and derives, per voice space, which response curve the engine applies to each NN-output slot. Handles the four idioms a regex misses (`const float v = p[n]; v*v`, memlcelium's implicit-counter `sq()` lambda, loop-generated indices, `smooth_params_[n]`) and RAISES on anything it cannot reduce rather than defaulting to `linear`.
- `codegen/tests/curve_drift_test.ts` — the gate: schema-declared curves (JSON **and** generated TS) must equal what `curve-audit.ts` extracts, and schema `voice_spaces` order must equal the engine's `kVoiceSpaceNames`. Source-level by necessity — the curve is not recoverable from engine output. Run by `run-all-tests.sh` stage 5, CI, and `bun run test` in `codegen/`.
- `codegen/lib.ts` — helpers shared by both generators. `codegen/tests/golden/` — golden snapshot for paf_synth (C++ + TS).

### `tests/cpp/` — host C++ tests
- Per-component tests: `test_dsp_*.cpp`, `test_engine_*.cpp`, `test_mlp_*.cpp`, `test_mode_*.cpp`, `test_ring_buffer.cpp`, `test_rng.cpp`, `test_math.cpp`. Helpers in `test_helpers.hpp`.
- Verification: `ml_golden_vectors.cpp`, `engine_impulse.cpp` (+ `engine_impulse_baseline.bin`), `parity_check.cpp` + `parity_wasm.mjs` + `parity_diff.mjs` — native-vs-WASM bit-equivalence within 1e-5.
- Behaviour: `test_ml_behaviour.cpp` — 20 INVARIANTS of the interaction model (not tuning). Asserts what must hold however the knobs are set: a like is reachable and a re-like overwrites; dislike never yields non-finite weights/outputs in either `AvoidStyle`, and is safe at cold start; repeat dislikes inside `kReplayDedupRadius` deepen ONE negative while distant ones store separately; explore→reroll→undo→exit restores weights *bit-exactly* and over-undoing is safe; `RandomiseOutputs` leaves weights untouched (the outputs-vs-weights randomisation distinction); same seed + same gesture sequence ⇒ bit-identical weights (what makes any behavioural benchmark comparable); example-ring overflow keeps the newest; contradictory examples stay finite; the ExploreAndPlace accessor contract (`placed_output()` while Placing, `committed_output()` after commit — for both place and reposition); a FULLY-masked focus gate freezes every weight; switching mode mid-exploration never strands the net in a randomised scratchpad; and all of it holds at 1×1, 2×8, 1×33, 8×2 and 32×8 shapes.
- Measurement (asserts nothing): `ml_bench.cpp` — the BEHAVIOURAL benchmark. NISPS is a controller, so this measures the shape of the control→parameter mapping and how interaction journeys deform it, never loss alone. Shape-agnostic (`--shape N_IN,H1,H2,H3,N_OUT`, default `2,16,16,16,8`) via `MLPCore<DynamicStorage>`, so "does a wider/deeper net change the UX?" becomes a number; sample points come from a deterministic Kronecker low-discrepancy sequence rather than a raster, which is what makes it work at any input arity. Field metrics: local gain p50/p95, cliff index, dead fraction, range utilisation, rail occupancy, effective dimensionality (participation ratio — trace²/‖C‖²_F, no eigendecomposition). Displacement metrics: at-point, rings, global, **blast ratio**, and collateral damage at the protected positives. **61 scenarios.** Diagnostic (D1 — the geometric-dislike dose decomposed: intended push vs effective LR vs measured movement at 1/10/100/1000 presses). Atomic probes A1–A14: at/around/far-from an example; one dislike under BOTH candidate designs; twice at one point; adjacent-then-return across the dedup radius; near a protected positive; roll-a-patch-and-place; the full explore→audition→place→commit lifecycle; explore-then-cancel; reposition; like-then-dislike in place; dislike-then-repair; focus/solo mask leakage. Journeys J1–J11: positive-only retention curve, randomise-place-only, mixed, branch (one shared prefix, three divergent gestures, replayed from scratch per branch because that is exact under a deterministic RNG), explore-place-only, 120-gesture long session with drift + weight-norm checkpoints, dislike storm, revisit-after-wandering, two-region interference, sweep-and-teach along a continuous path, undo-heavy. Edge cases E1–E13: cold start, single example, contradictory, collinear, corners, capacity overflow, undo exhaustion, minimal shape, identical targets, rail targets, rapid like/dislike alternation, mode-switch mid-exploration, fully-masked dislike. Upstream comparison U1–U3: the older memllib `interfaceRL` (a DDPG actor-critic, recoverable from this repo's own git history at blob `755ff8b`) differs structurally — the user HEARS `actorTarget`, a soft copy updated `target += alpha*(online-target)` at alpha=0.005, and it trains a batch of 4 from replay only every `optimiseDivisor=40` gestures. The critic half is not reproducible here (MLPCore has `train_targets` but not the per-layer gradient extraction the policy-gradient step needs), but both OUTPUT-PATH ideas are: U1 sweeps the soft-target alpha (alpha=1 IS NISPS today, a free control), U2 sweeps the train-every-Nth divisor, U3 compares actor shapes, U4 sweeps the positive-path training dose. U4's numbers became comparable to upstream's on 2026-07-25, when `nisps/ml/training.hpp` stopped being SGD-only and ported upstream's RMSProp — before that an upstream LR meant something different here than there, which is what made the geometric dislike inert (D1: 5.3e-5 per press before, 1.6e-2 after). Their shared metric is **lurch** — how far the mapping the musician is playing moves per single gesture, averaged over the whole field. Knobs: `--spread` (1 = Xavier, 0 = uniform with NO fan_in coupling — i.e. the post-removal behaviour, measurable before paying for the refactor), `--geo-lr`, `--geo-iters`. Driven by `scripts/bench-ml.sh`. **Two contracts that fail SILENTLY and are pinned by tests:** (1) a thumbs-up must go through BOTH `mlp.add_example` AND `fb.store_positive` — `dislike_geometric` k-NNs the replay buffer, not the MLP dataset, so a harness that only calls `add_example` measures the cold-start branch instead; (2) `placed_output()` is valid ONLY while state is `Placing` — after `commit_place()`/`commit_reposition()` the vector moves to `committed_output()`, and reading the wrong one yields an empty span whose `l2()` is 0, i.e. a broken lifecycle scored as a perfect placement.
- Measurement (asserts nothing): `engine_bench.cpp` + `bench_report.mjs` — per-engine throughput (ns/sample, blocks/s, realtime factor) for the `process()` hot path. ONE source compiled twice (CMake `nisps_engine_bench` natively, emcc for WASM) so the two targets are comparable without adding a single export to `nisps/wasm/bindings.cpp`. Engines are driven into a working state (transport running + event drain for the sequencers, periodic `note_on` for paf_synth, a noise+sine input bed for the fx/analysis engines) and every row prints its own working-state evidence, so a number produced by an idle engine is visible rather than plausible. Driven by `scripts/bench-engines.sh`.

### `scripts/` — build + verify entry points
- `build-firmware.sh`, `flash-firmware.sh`, `build-and-flash-firmware.sh`, `firmware-common.sh` — Arduino-CLI wrapper for RP2350 target with C++20 flag.
- `build-wasm.sh` — Emscripten compile producing `manifold/public/nisps.{wasm,js}`.
- `build-cpp-tests.sh` — CMake configure + build + ctest (Ninja).
- `parity-check.sh` — runs native + WASM and diffs binary outputs. **Gotcha**: it only builds `manifold/public/nisps.{js,wasm}` when they are MISSING, never when they are stale, so after any change under `nisps/` you must run `build-wasm.sh` yourself or you are diffing fresh native against an old WASM — which reports a parity FAILURE that is really a staleness failure (this is how the RMSProp port first "broke" parity).
- `bench-ml.sh` — the ML BEHAVIOUR benchmark on native + WASM from one source (same trick as `bench-engines.sh`). `--shape`, `--scenario`, `--smoke`, `--seed`, `--compare`, and `--sweep-shape` (runs the corpus across a ladder of architectures and arities — the knob-sensitivity instrument). **Reports, never asserts**: a cliff index is a description, not a pass/fail. Invariants live in `tests/cpp/test_ml_behaviour.cpp` instead. Reports land in `nisps/build/bench-ml/`.
- `bench-engines.sh` — engine throughput on native + WASM; `--compare <report.json>` prints per-engine Δ%. **Reports, never asserts** (a wall-clock threshold on shared hardware is meaningless or flaky — same call as the firmware size job). Reports land in `nisps/build/bench/`.
- `lint-cpp.sh` — `.f` literal warn + heap/`Arduino.h` violation fail.
- `run-all-tests.sh` — master verification script.

### `.github/workflows/`
- `ci.yml` — GitHub Actions: cmake build + ctest + WASM build + parity check + lint + Playwright (cpp-tests + manifold-tests jobs). Firmware compile is documented as manual.

### `src/` — submodule + vendored trees
- **There are no submodules.** `src/memllib` was one until the Phase 4 PlatformIO migration; it is now vendored at `firmware/MEMLNaut-NISPS/lib/memllib/`. Fresh clones need no `git submodule` step.

### Top-level docs
- `CLAUDE.md` — long-form architecture narrative.
- `MAP.md` — this file.
- `ALIGNMENT.md` — strategic gaps + open mission questions, dated, opinionated.
- `README.md` — short quickstart.
- `AGENTS.md` — canonical agent contract: architecture, build/test, scope, and Ergo workflow.

## Entry points

- **Firmware**: `scripts/build-firmware.sh [VARIANT]` (interactive prompt if omitted), `scripts/flash-firmware.sh`, `scripts/build-and-flash-firmware.sh`. Target: `rp2040:rp2040:solderparty_rp2350_stamp_xl:opt=Optimize3`, `-std=gnu++20`.
- **Manifold dev**: `cd manifold && bun install && bun run dev` (Vite, COOP/COEP headers).
- **Manifold build**: `cd manifold && bun run build`.
- **WASM rebuild**: `bash scripts/build-wasm.sh` (needs `emcc`).
- **Host C++ tests**: `bash scripts/build-cpp-tests.sh`.
- **Parity check**: `bash scripts/parity-check.sh`.
- **Engine benchmark**: `bash scripts/bench-engines.sh` (add `--compare nisps/build/bench/latest.json` to diff against the previous run).
- **ML behaviour benchmark**: `bash scripts/bench-ml.sh` (`--smoke` for a fast run, `--shape 2,16,16,16,8`, `--sweep-shape` for the architecture/arity sweep, `--compare` to diff).
- **All tests**: `bash scripts/run-all-tests.sh` (stage 6 is a bench smoke report; it does not gate).
- **Playwright**: `cd manifold && node node_modules/.bin/playwright test` (non-snap node runner on the VPS — BUILD-PLAN gotcha; `bunx playwright test` works elsewhere).
- **Codegen**: `cd codegen && bun run generate.ts` (regenerates `nisps/modes/generated/` + `nisps/ml/generated/` C++ and `manifold/src/modes/generated/` TS).

## Conventions

- Firmware mode selection is compile-time only — one `-DMEMLNAUT_MODE_TYPE` per `[env:]` in `platformio.ini`.
- `nisps/` follows Chris's RP2350 perf rules: no heap, `static const float` for non-trivial constants, strict `.f` suffix. `perf.hpp` now carries only `NISPS_HOT`/`NISPS_FORCE_INLINE`; the three dead/misshapen SRAM-section macros were deleted in the 2026-07 sweep (S21/L13).
- C++ identifiers: `PascalCase` types, `snake_case` functions/variables, `kPascalCase` constexpr. JSON keys `snake_case`. TS types `PascalCase`, components `PascalCase.tsx`, modules `kebab-case.ts`.
- `Curve` enum lives in `nisps/core/math.hpp` (lowercase: `linear/exp/log/square/sqrt/sigmoid/cubic`, plus the parameterised `centered_power` free function); generated mode headers re-export via `using Curve = ::nisps::Curve;`. Since P4 there is NO TS mirror — the browser samples the WASM catalog (`nisps_curve_apply(+batch)`).
- Modes are TSX components composed of primitives; mode parameter contracts are JSON schemas with codegen → C++ **and** TS types (`MF_MODES` derives params/ml-config from the generated schemas since P5; labels/ordering stay a manifold overlay). **No declarative JSON UI.**
- WASM and firmware share the same C++; the browser MLP is runtime-shaped (`MLPCore<DynamicStorage>`, since P2): `nisps_ml_create` honours `(input, output, hidden[3])` with non-positive/null args defaulting to `32→[10,14,18]→126`; `nisps_ml_reshape` warm-starts a new shape. Firmware keeps compile-time `MLP<...>` (zero heap). Per-mode dims are schema-real on both targets since P5.3 (the browser reshapes on mode switch).
- Cross-platform parity: `scripts/parity-check.sh` enforces native vs WASM agreement within 1e-5.

## Gotchas

- Firmware needs PlatformIO: `nix-shell -p platformio-core`. Use `platformio-core`, NOT `platformio` — the latter is nixpkgs' bubblewrap-wrapped FHS build and fails without a working user namespace. First build pulls ~1-2 GB into `~/.platformio`.
- `firmware/MEMLNaut-NISPS/glue/mode_select.hpp` `#undef`s Arduino macros (`sq`, `min`, `max`, `abs`, `round`) before pulling nisps headers — engines use those identifiers as method names.
- `nisps_firmware::g_active_mode_bridge` is `extern` in `glue/audio_driver.hpp` and defined in `src/main.cpp`; combining `inline` with `__not_in_flash` produces a comdat conflict at link time.
- `pio run`'s own "Flash: NN%" console line double-counts `.data` on this board (PlatformIO's generic size checker counts every PROGBITS+ALLOC section). Compare `arm-none-eabi-size -A` — flash = `.text+.rodata` — before believing a size regression.
- `nisps_modes_tests` builds against generated schemas under `nisps/modes/generated/`; if you add a new mode, regenerate via `bun run codegen/generate.ts` before building. It also compiles one firmware header (`glue/codec_config.hpp`), so the repo root is on its include path.
- `nisps::DriverConfig`'s member defaults are load-bearing: they reproduce memllib's historical hardcoded codec setup, so a mode that declares nothing gets exactly the pre-wiring behaviour. Changing them changes the codec setup of every mode that expresses no opinion (pinned by `tests/cpp/test_mode_driver_config.cpp`).

## Smells / strategic concerns

See `ALIGNMENT.md`.

## Specs

- **Root**: `docs/specs/`
- **Entry**: `MAIN.md`
- **Layout**: flat (with `plans/`, `recon/`, `_archive/` subdirs)
- **Index**: none (intentionally — generate when a consumer exists)
- **Skill**: invoke `/specs` to review/maintain/add/navigate.
- **Conventions**: Four-genre ontology — `kind: spec` (timeless contract, wins by intent), `kind: plan` (status: active|executed|superseded, never authority for behaviour), `kind: finding` (dated, immutable, exempt from drift lint), ADRs in `docs/adr/`.

The corpus holds platform-level specs (engine architecture, I/O backends, feedback design), implementation specs (port specs, wire protocols), feature specs (e.g. slp-workshop-firmware.md), historical findings (dated research artifacts), and finite build plans. Before changing behaviour a spec covers, find it via `/specs`; the spec wins by intent — if it's wrong, update it in the same commit as the code.
