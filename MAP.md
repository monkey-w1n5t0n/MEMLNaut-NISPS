# MAP

MEMLNaut-NISPS — Neural Interactive Shaping of Parameter Spaces. One C++20 codebase (`nisps/`) compiles to two targets: (1) Arduino/RP2350 firmware for the MEMLNaut hardware, (2) WASM in the Manifold React browser app that runs the same engines + ML through an AudioWorklet. (The former SolidJS playground was retired 2026-07-13 — branch `archive/playground-solidjs`, tag `playground-solidjs-final`; the browser-only C15 engine lives only there for now.) See `CLAUDE.md` for the long-form architecture narrative and `ALIGNMENT.md` for current strategic gaps.

## Layout

### `nisps/` — platform-agnostic C++20 library (the only ML/DSP/engine code)
- `nisps/core/` — `perf.hpp` (memory section attrs), `types.hpp`, `concepts.hpp` (`MLEngine`, `AudioEngine`, `Mode`), `fixed_buffer.hpp`, `ring_buffer.hpp` (SPSC lock-free, replaces pico/util/queue), `rng.hpp` (xoshiro256+ deterministic), `math.hpp` (fast_sigmoid, `Curve` enum + `apply_curve`).
- `nisps/ml/` — the MLP core, written once against a storage policy (`mlp.hpp` `MLPCore<Storage>`): `storage.hpp` (`FixedStorage` — template-sized `std::array`, zero heap; `MLP<NIn,NH1,NH2,NH3,NOut>` alias preserves the classic compile-time surface) and `dynamic_storage.hpp` (`DynamicStorage` — runtime dims, single arena alloc at construction; `#error`s on RP2350 builds, sole lint heap-allowlist entry). Fixed↔dynamic bit-parity enforced by `tests/cpp/test_mlp_storage_parity.cpp`. Files: `mlp.hpp`, `activations.hpp`, `loss.hpp` (MSE, no double-scaling), `training.hpp` (SGD + grad clipping), `init.hpp` (spread-aware uniform↔Xavier), `rl.hpp` (`move_weights` with output pin mask + per-layer scaling + weight decay), `jolt.hpp` (`Jolt` — held continuous weight-morph over the flat weight buffer + post-release LR ramp; ported from upstream InterfaceRL), `ou_noise.hpp` (`OUNoise<N>` — Ornstein-Uhlenbeck exploration walk on the output vector; ported from upstream InterfaceRL), `feedback.hpp` (`FeedbackControllerCore<FbStorage>` — the "Down Action" state machine: Avoid (geometric push-away default / Diffuse legacy) / RandomiseOutputs / RandomiseMlp / ExploreAndPlace; storage-policied like the MLP, own deterministic RNG, exposed via `nisps_ml_feedback_*` C API), `replay.hpp` (`ReplayView` — reward-tagged memory: dedup/deepen, k-NN positive centroid with deterministic tie-break, proportional decay+eviction), `geo_push.hpp` (push-away target computation, upstream InterfaceRL @ 0a541cc), `warm_start.hpp` (overlapping-weights copy for reshape), `stats.hpp`. Jolt + OU are inert by default and wired into `ModeBase`, so every mode exposes `jolt_press/jolt_release`, `jolt_lr_scale`, and `set_explore_intensity`.
- `nisps/pipeline/` — the control-rate input/output processing chains (P4): `input_chain.hpp` (`InputChain` — invert→deadzone→circular clamp→momentum-modulated zoom→centred power→EMA→momentum; caller-supplied dt, internal clock, fixed velocity ring, serialisable state) and `output_chain.hpp` (`OutputChain<NMax>` — curve→EMA→slew→freeze(+mask), capacity-templated). Behaviour contract = the retired manifold TS pipelines, pinned by `manifold/tests/fixtures/` and parity stage 7.
- `nisps/dsp/` — `biquad.hpp`, `delay.hpp`, `reverb.hpp`, `filter.hpp`, `env.hpp`, `osc.hpp`, `pitch_shift.hpp`, `dc_blocker.hpp`. Lean primitives extracted from maximilian; daisysp PitchShifter replaced with custom granular impl.
- `nisps/engines/` — eight audio engines, each satisfying `AudioEngine`: `paf_synth.hpp`, `channel_strip.hpp`, `xiasri.hpp`, `verb_fx.hpp`, `memlcelium.hpp`, `breakor.hpp` (sequencer, NoOp audio), `elysiamorf.hpp` (sequencer, NoOp audio), `analysis.hpp` (input-side spectral features). Plus `base.hpp` (`NoOpEngine`, engine_id "thru").
- `nisps/modes/` — platform-agnostic modes binding `{ML config, engine, voice space lambdas, abstract I/O channels}`. Files: `paf_synth.hpp`, `channel_strip.hpp`, `xiasri.hpp`, `verb_fx.hpp`, `memlcelium.hpp`, `slp_workshop.hpp` (`SLPWorkshopMode` — the Synth Library Portland workshop build; reuses the MEMLCelium engine + MLP shape, foregrounds the Jolt + OU explore gestures), `breakor.hpp`, `elysiamorf.hpp`, `sound_analysis_midi.hpp`, `external_synth_midi.hpp` (`ExternalSynthMIDIMode<const MidiDevice&, NOut>` — joystick→MLP→MIDI CC for an external synth; compile-time device from `nisps/midi`; `consteval pick_cc_slots` curates which params fill the NOut slots; NoOpEngine, `kRouteOutputsToEngine=false`). `base.hpp` provides a CRTP scaffold eliminating the duplication that previously plagued firmware modes. `voice_space.hpp` holds engine-side voice space dispatch helpers. `generated/` contains codegen output (do not edit by hand).
- `nisps/wasm/bindings.cpp` — flat C API exported to WASM (Emscripten target only).
- `nisps/midi/generated/midi_devices.hpp` — codegen output: no-heap `constexpr` external-MIDI-synth templates (`nisps::midi::generated`; `MidiParam`/`MidiDevice` + `kMidiDevices` registry). Source = `schemas/midi_devices/`; do not edit by hand.
- `nisps/CMakeLists.txt` + `nisps/build/` — host-target builds + ctest.

### `firmware/` — Arduino sketch + hardware glue
- `firmware/MEMLNaut-NISPS/MEMLNaut-NISPS.ino` — entry point. Selects active mode at compile time via `#define MEMLNAUT_MODE_TYPE`. Forks on `NISPS_SELFTEST`: normal modes run the engine/ML path; the `SelfTest` variant delegates all four entry points to `glue/selftest.hpp`.
- `firmware/MEMLNaut-NISPS/glue/` — hardware bindings:
  - `audio_driver.hpp` — bridges memllib `AudioDriver` callback → `Mode::process(stereosample_t)`.
  - `peripherals.hpp` — joystick / pots / buttons → `Mode::set_input` and ML primitives. Wires the shared `FeedbackController` ExploreAndPlace lifecycle (MomA1 = enter/exit explore, MomA2 = freeze/place, TogB2 = commit; MomB1/MomB2 = reroll/nudge while exploring **or** grab/drop *reposition* while idle) plus the adaptive-learning gestures: **TogB1** = Jolt (held weight morph), **RVX1** = exploration amount (OU output walk). Reposition relocates an existing positive example's output to a new input position (`feedback.hpp` `begin_reposition`/`commit_reposition`) — no scratchpad, no weight restore.
  - `midi_io.hpp` — MIDI in → mode `note_on`/`update_bpm`/`set_playing`; drains `ControlEvent` ring → MIDI UART.
  - `mode_select.hpp` — type aliases mapping firmware mode identifiers to `nisps::modes::*Mode` C++ types. Build script rewrites the active line. Includes the six `MEMLNautModeExtSynth*` external-synth variants (one per device template in `nisps/midi`, e.g. `MEMLNautModeExtSynthSub37`). Also defines the `MEMLNautModeSelfTest` pseudo-variant (tag type) + the `NISPS_ST_*`/`NISPS_ST_CAT` token-paste macros the `.ino` uses to compute `NISPS_SELFTEST`. Note: `src/nisps/` exposes each referenced top-level nisps subdir as a symlink — `midi` was added alongside `core/dsp/engines/ml/modes`.
  - `selftest.hpp` — standalone guided hardware self-test rig (`SelfTest` variant; no engine/ML). Step-driven state machine on a `SelfTestView`: TFT prompts the operator through every control, auto-advances on detection, encoder-press skips. Ends with optional L/R/BOTH sine-sweep headphone check (core 1 block callback) + MIDI loopback-cable test. Lives firmware-side (touches TFT + raw pins) so it stays out of platform-agnostic `nisps/`.
  - `input_router.hpp`, `output_router.hpp` — top-level `wire_inputs()` / `drain_outputs()` entry points.
  - `settings_view.hpp` — `wire_settings(mode)`: adds on-device settings views to the MEMLNaut display carousel (TFT + rotary encoder). Joystick Dual/Single toggle for the 4-input ("two 2-D joystick") modes — "Single" pins ML input channels 2,3 to neutral via `ModeBase::set_input_pinned` (no net rebuild). Registered in the `.ino` after `addSystemInfoView()`.
- `firmware/MEMLNaut-NISPS/src/{memllib,daisysp,nisps}` — symlinks (Arduino-CLI requires sketch-tree includes; preprocessor refuses `..` in headers).
- `firmware/README.md` — structure + build instructions.
- `firmware/useq-celium/` — standalone RP2040 firmware (PlatformIO, Arduino-Pico core) that turns a uSEQ module + CV expander into a USB→CV/gate converter driven by the manifold `cvgate` backend. `shared/protocol.h` is the v2 wire-protocol single source of truth (mirrored by `manifold/src/backends/useq-protocol.ts`); `main/` (USB serial → CV1–3 + GATE1–3, I2C → expander) and `expander/` (I2C slave → CV4–11). Wire spec: `docs/specs/useq-cv-protocol.md`. Restored from the April-2026 "uSEQ-Celium" mode.

### `manifold/` — Vite + React + TS convertible-mode app (the sole browser app)
The Manifold "convertible" Console on the real engine, deployed at `meml.lnfinitemonkeys.org/next` (staging,
alongside the live vanilla a-immersive at `/`). Built 2026-06-27/28; see `docs/specs/plans/BUILD-PLAN.md` (resume
anchor + locked decisions) and the `docs/specs/*-spec.md` set.
- `manifold/src/engine/` — the parity-tested TS engine LIFTED from `playground/src` (same `nisps.wasm`), made
  framework-neutral: `wasm-iml.ts` (rewired off Solid stores onto an injected `EngineSink`), `engine-host.ts` +
  `worklet/nisps-processor.ts` (audio), thin WASM wrappers over the core pipelines + curve catalog (the TS
  `input-pipeline`/`output-pipeline`/`curves` implementations died at P4), `wasm-worker.ts`,
  `spine.ts` (the reactive spine BELOW React — `setInput` derives processed→ml→routed eagerly off-render),
  `engine-api.ts` (`EngineApi` façade incl. `feedback.*` wrappers over the `nisps_ml_feedback_*` C ABI),
  `EngineProvider.tsx`/`useEngine.ts` (React binding via `useSyncExternalStore` version counter). nisps.js is
  loaded via fetch+indirect-eval (Emscripten MODULARIZE glue has no ES exports), base-aware via `document.baseURI`
  for the `/next` sub-path.
- `manifold/src/primitives/` — the 12 design primitives as typed React.
- `manifold/src/console/` — the convertible Console: `ConsoleApp`, `CompositeStage` (single-divider convertible
  with snap/magnetism/minimap-demotion), `SplitStage`/`OutputStage`/`InputMini`/`Manifold` (canvas, rect↔circular
  + feedback markers), `Dock` (top Mode selector + 5 vertically-centred drawers), `Drawers` (Learning/Inputs/
  Outputs/Settings/Help), `VerdictCluster` (mode-aware), `ReadoutStrip`, `OutputEditor`/`CurvePad`, `icons.tsx`
  (monochrome currentColor SVG), `model.ts` (`MF_MODES` catalogue — schema-backed modes DERIVED from
  `manifold/src/modes/generated/`; carries per-mode `ml` net shape + `engineId`), `output-mode.ts`.
- `manifold/src/modes/generated/` — codegen output (`*_schema.ts`, do NOT hand-edit): `ModeSchema`
  consts (mode_id, engine_id, ml dims, params, voice_spaces, ui) — the SOURCE OF TRUTH for `MF_MODES`.
  Switching mode reshapes the WASM net to the mode's `ml` dims (ConsoleApp P5.3; boot mode paf_synth →
  4→[10,10,14]→33).
- `manifold/src/dock/` — `OutputControlRow` (off/fixed/live + mute + solo/arm + min/max/curve), `output-state.ts`,
  `OutputsBackendConfig.tsx` (per-backend specialised Outputs panel), `BackendAdvanced.tsx`.
- `manifold/src/backends/` — `OutputBackend` adapter + `BackendManager` (spine consumer); `midi-backend.ts`
  (WebMIDI), `osc-backend.ts`+`osc-client.ts` (OSC-over-WS), `vcv-backend.ts` (VCV-over-WS), `cv-backend.ts`
  (`UseqCvBackend` — uSEQ CV/gate over USB Web Serial, backend id `cvgate`) + `useq-protocol.ts` (v2 wire
  protocol, mirrors `firmware/useq-celium/shared/protocol.h`; `useq-protocol.test.ts` runs via `bun test`),
  `particle-backend.ts`, `passthrough-backend.ts`, `presets.ts` (named presets), `manager.ts`.
- `manifold/src/midi-devices/` — external-synth device templates. `generated/` is codegen output from
  `schemas/midi_devices/` (`MIDI_DEVICES` catalogue + `MIDI_DEVICES_BY_ID`, params by name+CC). The MIDI Outputs
  config (`dock/OutputsBackendConfig.tsx`) reads it for the device picker + param-select that fills the CC table.
- `manifold/src/inputs/` — modular INPUT layer feeding the ML head. The Inputs dock picks ONE exclusive mode
  (`InputMode` = `internal` | `gamepad` | `midi`; Internal/XY-pad is default). `input-layer.ts` owns a single rAF
  loop composing the active source's axes → reduced to the engine arity (fixed 2-in WASM → even/odd blend) → one
  `setInputs`, plus an `onReducedInput` callback the manifold tracks. Sources: `xy-pad-source` (push-driven),
  `gamepad-source` (sticks→axes single/double; buttons emit press+release actions, bound in `ConsoleApp` to
  verdicts — LB/RB=down/up, X/Y/B=randomise/nudge/undo, A-hold=reposition), `midi-input-source` (device picker +
  BATCH "MIDI Learn": every CC swept while armed becomes an axis, shown as read-only meters). `useInputLayer.ts`
  is the React binding; `base-source.ts` shared status/action plumbing; `types.ts` the adapter contract.
- `manifold/src/feedback/` — `controller.ts` (Explore-and-place scratchpad + geometric-dislike + solo, TS
  prototype), `rng.ts` (seeded).
- `manifold/src/settings/` — `settings-store.ts` (monochrome icons, input-map shape, corner radius).
- `manifold/src/serial/` — `memlnaut-serial.ts` Web Serial scaffold + `EditorPanel.tsx` (MEMLNaut Editor mode).
- `manifold/src/engine/exploration.ts` — Jolt press + OU explore gestures (Learning drawer): a thin
  timer-driver over the shared C++ core via the `nisps_ml_jolt_*`/`nisps_ml_ou_*` bindings (the interim
  TS math and `jolt.ts`/`ou-explore.ts` were deleted when P3 landed).
- `manifold/src/debug/probe.ts` — `window.__nisps` (`?debug=1`). `manifold/tests/e2e/` — `smoke`,
  `probe-api` (15-test engine-contract port), `spine` (spine invariant + probe-survives-mode-switch).
  E2E on the VPS runs via non-snap node (see BUILD-PLAN). `manifold/tests/fixtures/` — golden parity
  fixtures (gesture trace, curves, input/output pipelines) captured 2026-07-13 pre-P4, guarded by
  `tests/pipeline-golden.test.ts` (in `bun run test`). `manifold/osc-bridge/` — Deno WS↔UDP-OSC bridge.

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
- `schemas/modes/<mode>.json` (×9) — each mode's params, ranges, defaults, curves, voice spaces, ML config. (`slp_workshop.json` reuses `engine_id: memlcelium`.)
- `schemas/modes/params_notes.md` — provenance notes and judgement calls per mode.
- `schemas/midi_device.schema.json` — Draft 2020-12 meta-schema for external-MIDI-synth templates.
- `schemas/midi_devices/<device>.json` (×6) — CC-controllable external synths (Moog Sub 37 / Sub Phatty, Creamware Pro-12 ASB, Elektron Analog Keys, ASM Hydrasynth, Roland JD-800). Each param: `{id, cc, label, min, max, default, group}`. Canonical source for both firmware + browser device pickers. Verified-CC provenance + sources live in `synth-midi-cc.json` (repo root).

### `codegen/` — schema → C++/TS code
- `codegen/generate.ts` — Bun script: validates schemas via ajv (incl. the P5 firmware-fit check: exactly 3 hidden layers, dims ≤4096), emits per-mode C++ `nisps/modes/generated/<mode>_schema.hpp` (`constexpr`, `nisps::modes::generated`) AND TS `manifold/src/modes/generated/<mode>_schema.ts` (+ `types.ts`, `index.ts`). Idempotent; golden-tested in `run-all-tests.sh` stage 5. The TS output is the SOURCE OF TRUTH consumed by `MF_MODES` (`manifold/src/console/model.ts`).
- `codegen/generate-midi-devices.ts` — separate Bun script (isolated from the mode golden test): validates `schemas/midi_devices/` via ajv, emits `nisps/midi/generated/midi_devices.hpp` (no-heap `constexpr`) and `manifold/src/midi-devices/generated/{types,devices,index}.ts`. Idempotent.
- `codegen/seed-midi-devices.ts` — one-time/idempotent seed deriving `schemas/midi_devices/*.json` from the `synth-midi-cc.json` research artifact (slugifies labels → ids, heuristic groups).
- `codegen/templates/`, `codegen/tests/golden/` — reference templates + golden snapshot for paf_synth.

### `tests/cpp/` — host C++ tests
- Per-component tests: `test_dsp_*.cpp`, `test_engine_*.cpp`, `test_mlp_*.cpp`, `test_mode_*.cpp`, `test_fixed_buffer.cpp`, `test_ring_buffer.cpp`, `test_rng.cpp`, `test_math.cpp`. Helpers in `test_helpers.hpp`.
- Verification: `ml_golden_vectors.cpp`, `engine_impulse.cpp` (+ `engine_impulse_baseline.bin`), `parity_check.cpp` + `parity_wasm.mjs` + `parity_diff.mjs` — native-vs-WASM bit-equivalence within 1e-5.

### `scripts/` — build + verify entry points
- `build-firmware.sh`, `flash-firmware.sh`, `build-and-flash-firmware.sh`, `firmware-common.sh` — Arduino-CLI wrapper for RP2350 target with C++20 flag.
- `build-wasm.sh` — Emscripten compile producing `manifold/public/nisps.{wasm,js}`.
- `build-cpp-tests.sh` — CMake configure + build + ctest (Ninja).
- `parity-check.sh` — runs native + WASM and diffs binary outputs.
- `lint-cpp.sh` — `.f` literal warn + heap/`Arduino.h` violation fail.
- `run-all-tests.sh` — master verification script.

### `.github/workflows/`
- `ci.yml` — GitHub Actions: cmake build + ctest + WASM build + parity check + lint + Playwright (cpp-tests + manifold-tests jobs). Firmware compile is documented as manual.

### `src/` — submodule + vendored trees
- `src/memllib/` — hardware abstraction (audio driver, peripherals, MIDI), the only true submodule. **Not auto-initialized** — fresh clones need `git submodule update --init --recursive`. Pinned to `monkey-w1n5t0n/memllib` branch `feat/nisps-core-swap` (the operator's fork; upstream is `MusicallyEmbodiedML/memllib`). Ownership decision — vendor the load-bearing subset into this repo — lands with the PlatformIO migration (plan §5, §7.5).
- `src/daisysp/` — vendored plain files (NOT a submodule). Zero remaining consumers — nisps replaced its PitchShifter with a custom granular impl; deletion planned (plan S8).

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
- **All tests**: `bash scripts/run-all-tests.sh`.
- **Playwright**: `cd manifold && node node_modules/.bin/playwright test` (non-snap node runner on the VPS — BUILD-PLAN gotcha; `bunx playwright test` works elsewhere).
- **Codegen**: `cd codegen && bun run generate.ts` (regenerates both `nisps/modes/generated/` C++ and `manifold/src/modes/generated/` TS).

## Conventions

- Firmware mode selection is compile-time only — `#define MEMLNAUT_MODE_TYPE` in the `.ino`.
- `nisps/` follows Chris's RP2350 perf rules globally: no heap, `static const float` for non-trivial constants, strict `.f` suffix. Of the `perf.hpp` section attrs only `NISPS_HOT`/`NISPS_FORCE_INLINE` are actually in use — `NISPS_AUDIO_MEM`/`NISPS_APP_SRAM`/`NISPS_AUDIO_FUNC` are dead or misshapen and slated for deletion (plan S21).
- C++ identifiers: `PascalCase` types, `snake_case` functions/variables, `kPascalCase` constexpr. JSON keys `snake_case`. TS types `PascalCase`, components `PascalCase.tsx`, modules `kebab-case.ts`.
- `Curve` enum lives in `nisps/core/math.hpp` (lowercase: `linear/exp/log/square/sqrt/sigmoid/cubic`, plus the parameterised `centered_power` free function); generated mode headers re-export via `using Curve = ::nisps::Curve;`. Since P4 there is NO TS mirror — the browser samples the WASM catalog (`nisps_curve_apply(+batch)`).
- Modes are TSX components composed of primitives; mode parameter contracts are JSON schemas with codegen → C++ **and** TS types (`MF_MODES` derives params/ml-config from the generated schemas since P5; labels/ordering stay a manifold overlay). **No declarative JSON UI.**
- WASM and firmware share the same C++; the browser MLP is runtime-shaped (`MLPCore<DynamicStorage>`, since P2): `nisps_ml_create` honours `(input, output, hidden[3])` with non-positive/null args defaulting to `32→[10,14,18]→126`; `nisps_ml_reshape` warm-starts a new shape. Firmware keeps compile-time `MLP<...>` (zero heap). Per-mode dims are schema-real on both targets since P5.3 (the browser reshapes on mode switch).
- Cross-platform parity: `scripts/parity-check.sh` enforces native vs WASM agreement within 1e-5.

## Gotchas

- `src/memllib` submodule is not auto-checked-out.
- Firmware sketch path is `firmware/MEMLNaut-NISPS/MEMLNaut-NISPS.ino` (Arduino-CLI requires sketch dir name == sketch file name); `firmware/MEMLNaut-NISPS/src/{memllib,daisysp,nisps}` are symlinks because Arduino's preprocessor refuses `..` in includes from sketch headers.
- `firmware/MEMLNaut-NISPS/glue/mode_select.hpp` `#undef`s Arduino macros (`sq`, `min`, `max`, `abs`, `round`) before pulling nisps headers — engines use those identifiers as method names.
- `nisps_firmware::g_active_mode_bridge` is `extern` in `glue/audio_driver.hpp` and defined in the `.ino`; combining `inline` with `__not_in_flash` produces a comdat conflict at link time.
- The host fallback of `NISPS_AUDIO_FUNC` in `nisps/core/perf.hpp` is misshapen for use as a function-name decorator (firmware path expands to `__not_in_flash_func` which takes only a name); `glue/midi_io.hpp:72` still uses it despite this. Deletion planned (plan S21/L13).
- `nisps_modes_tests` builds against generated schemas under `nisps/modes/generated/`; if you add a new mode, regenerate via `bun run codegen/generate.ts` before building.

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
