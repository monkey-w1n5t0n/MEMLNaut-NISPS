# MAP

MEMLNaut-NISPS — Neural Interactive Shaping of Parameter Spaces. One C++20 codebase (`nisps/`) compiles to two targets: (1) Arduino/RP2350 firmware for the MEMLNaut hardware, (2) WASM in a SolidJS browser playground that runs the same engines + ML through an AudioWorklet. Browser audio engines are a superset of firmware engines (C15 is browser-only). See `CLAUDE.md` for the long-form architecture narrative and `ALIGNMENT.md` for current strategic gaps.

## Layout

### `nisps/` — platform-agnostic C++20 library (the only ML/DSP/engine code)
- `nisps/core/` — `perf.hpp` (memory section attrs), `types.hpp`, `concepts.hpp` (`MLEngine`, `AudioEngine`, `Mode`), `fixed_buffer.hpp`, `ring_buffer.hpp` (SPSC lock-free, replaces pico/util/queue), `rng.hpp` (xoshiro256+ deterministic), `math.hpp` (fast_sigmoid, `Curve` enum + `apply_curve`).
- `nisps/ml/` — MLP class template `MLP<NIn, NH1, NH2, NH3, NOut>`. Files: `mlp.hpp`, `activations.hpp`, `loss.hpp` (MSE, no double-scaling), `training.hpp` (SGD + grad clipping), `init.hpp` (spread-aware uniform↔Xavier), `rl.hpp` (`move_weights` with output pin mask + per-layer scaling + weight decay), `jolt.hpp` (`Jolt` — held continuous weight-morph over the flat weight buffer + post-release LR ramp; ported from upstream InterfaceRL), `ou_noise.hpp` (`OUNoise<N>` — Ornstein-Uhlenbeck exploration walk on the output vector; ported from upstream InterfaceRL), `feedback.hpp` (`FeedbackController<MLP_T>` — the 3-mode "Down Action" negative-feedback state machine: Avoid / RandomiseOutputs / RandomiseMlp; header-only, zero-heap, own deterministic RNG, exposed via `nisps_ml_feedback_*` C API), `stats.hpp`. Jolt + OU are inert by default and wired into `ModeBase`, so every mode exposes `jolt_press/jolt_release`, `jolt_lr_scale`, and `set_explore_intensity`.
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
- `firmware/MEMLCelium-upstream/` — **vendored** verbatim snapshot of the upstream `MusicallyEmbodiedML/MEMLNaut-NISPS` @ `main` Arduino sketch (pre-refactor monorepo, does NOT use `nisps/`), preset to `MODE_MEMLCELIUM`. Self-contained: upstream `memllib`@`e291192d` + `memlp`@`ea777502` vendored as plain files; `src/daisysp` in-tree. Built directly with `arduino-cli` (not the repo build scripts) — see its `README.md` for provenance + the compile command.
- `firmware/useq-celium/` — standalone RP2040 firmware (PlatformIO, Arduino-Pico core) that turns a uSEQ module + CV expander into a USB→CV/gate converter driven by the manifold `cvgate` backend. `shared/protocol.h` is the v2 wire-protocol single source of truth (mirrored by `manifold/src/backends/useq-protocol.ts`); `main/` (USB serial → CV1–3 + GATE1–3, I2C → expander) and `expander/` (I2C slave → CV4–11). Wire spec: `docs/specs/useq-cv-protocol.md`. Restored from the April-2026 "uSEQ-Celium" mode.

### `playground/` — SolidJS + Vite + TypeScript app
- `playground/index.html`, `vite.config.ts`, `tsconfig.json`, `package.json` — scaffold. COOP/COEP headers configured.
- `playground/src/main.tsx`, `App.tsx` — entry + router (`/`, `/dev/primitives`, `/modes`).
- `playground/src/primitives/` — 16 UI building blocks: `Slider`, `SliderBank`, `VirtualJoystick`, `XYPad`, `Heatmap`, `OutputDisplay`, `TrainingControls`, `Drawer`, `ControlAxis`, `ProgressRing`, `PillToggle`, `ParamEditor`, `JoyMap`, `WeightHealth`, `GradientFlow`, `LossPlot`. Each has a `.demo.tsx` showcased on `/dev/primitives`.
- `playground/src/modes/` — one TSX per firmware mode (+ `C15Mode` browser-only). `ModeShell.tsx` is the shared scaffold; `ModeSwitcher.tsx` picks the active mode; `mode-runtime.ts` is the schema → ML → audio wiring hook; `mode-helpers.ts` for SliderBank configs. `generated/` holds codegen-produced TS schemas (do not edit).
- `playground/src/stores/` — Solid stores: `ml-store`, `input-store`, `output-store`, `mode-store`, `control-store` (compound axes Boldness/Memory/Precision), `session-store` (snapshots, A/B, presets), `exploration-store`, `bus` (typed signal bus). `persistence.ts` debounces localStorage writes.
- `playground/src/audio/engine-host.ts`, `worklet/nisps-processor.ts` — main-thread engine host + AudioWorklet processor. WASM loaded twice (main thread for ML, worklet for engines).
- `playground/src/ml/wasm-iml.ts`, `wasm-worker.ts`, `dataset.ts`, `types.ts` — main-thread WasmIML class + disposable async-training worker + FIFO dataset.
- `playground/src/input/pipeline.ts`, `playground/src/output/pipeline.ts`, `playground/src/output/curves.ts` — pure-fn pipelines (deadzone→zoom→curve→smoothing→momentum, then global curve→smoothing→slew→freeze).
- `playground/src/features/` — additional feature modules (heatmap sampling, snapshot stack, A/B compare, region pin, param pin, trail, weight health, etc.).
- `playground/src/debug/probe.ts` — synchronous `window.__nisps` debug probe for Playwright.
- `playground/public/nisps.{wasm,js}`, `c15.wasm`, `c15-glue.js` — compiled WASM artifacts (built by `scripts/build-wasm.sh`).
- `playground/tests/e2e/` — Playwright specs (`ml-engine`, `modes`, `persistence`, `ui-interactions`) + `helpers.ts`.
- `playground/playwright.config.ts` — Vite preview server setup.

### `manifold/` — Vite + React + TS convertible-mode app (the NEW front-end, WIP)
The Manifold "convertible" Console on the real engine, deployed at `meml.lnfinitemonkeys.org/next` (staging,
alongside the live vanilla a-immersive at `/`). Built 2026-06-27/28; see `docs/specs/plans/BUILD-PLAN.md` (resume
anchor + locked decisions) and the `docs/specs/*-spec.md` set.
- `manifold/src/engine/` — the parity-tested TS engine LIFTED from `playground/src` (same `nisps.wasm`), made
  framework-neutral: `wasm-iml.ts` (rewired off Solid stores onto an injected `EngineSink`), `engine-host.ts` +
  `worklet/nisps-processor.ts` (audio), `input-pipeline.ts`/`output-pipeline.ts`/`curves.ts`, `wasm-worker.ts`,
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
  (monochrome currentColor SVG), `model.ts`, `output-mode.ts`.
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
- `manifold/src/debug/probe.ts` — `window.__nisps` (`?debug=1`). `manifold/tests/e2e/smoke.spec.ts`. E2E on the
  VPS runs via non-snap node (see BUILD-PLAN). `manifold/osc-bridge/` — Deno WS↔UDP-OSC bridge.

### `vcv/` — VCV Rack 2 plugin (MEMLNaut module, WIP)
Native C++ Rack module: ML CV-mapper with RL feedback + a browser bridge. Currently 2→12 (being evolved to
**8 inputs × 16 outputs + per-output LED rings**, palette from the frontend tokens, WS↔OSC browser bridge — see
the "BUILD DELTAS" block at the top of `docs/specs/vcv-module.md`). `src/MEMLNaut.cpp` (module), `src/osc_server.hpp` (bridge),
`src/plugin.{hpp,cpp}`, `res/*.svg` (panels), `Makefile` (needs `RACK_DIR`). Was built against the retired
`nisps-core`; the core include path is being repointed.

### `schemas/` — JSON parameter contracts (firmware/browser source of truth)
- `schemas/schema.json` — Draft 2020-12 meta-schema validating mode files.
- `schemas/modes/<mode>.json` (×9) — each mode's params, ranges, defaults, curves, voice spaces, ML config. (`slp_workshop.json` reuses `engine_id: memlcelium`.)
- `schemas/modes/params_notes.md` — provenance notes and judgement calls per mode.
- `schemas/midi_device.schema.json` — Draft 2020-12 meta-schema for external-MIDI-synth templates.
- `schemas/midi_devices/<device>.json` (×6) — CC-controllable external synths (Moog Sub 37 / Sub Phatty, Creamware Pro-12 ASB, Elektron Analog Keys, ASM Hydrasynth, Roland JD-800). Each param: `{id, cc, label, min, max, default, group}`. Canonical source for both firmware + browser device pickers. Verified-CC provenance + sources live in `synth-midi-cc.json` (repo root).

### `codegen/` — schema → C++/TS code
- `codegen/generate.ts` — Bun script: validates schemas via ajv, emits per-mode `nisps/modes/generated/<mode>_schema.hpp` (`constexpr`, `nisps::modes::generated`) and `playground/src/modes/generated/<mode>_schema.ts`. Idempotent.
- `codegen/generate-midi-devices.ts` — separate Bun script (isolated from the mode golden test): validates `schemas/midi_devices/` via ajv, emits `nisps/midi/generated/midi_devices.hpp` (no-heap `constexpr`) and `manifold/src/midi-devices/generated/{types,devices,index}.ts`. Idempotent.
- `codegen/seed-midi-devices.ts` — one-time/idempotent seed deriving `schemas/midi_devices/*.json` from the `synth-midi-cc.json` research artifact (slugifies labels → ids, heuristic groups).
- `codegen/templates/`, `codegen/tests/golden/` — reference templates + golden snapshot for paf_synth.

### `tests/cpp/` — host C++ tests
- Per-component tests: `test_dsp_*.cpp`, `test_engine_*.cpp`, `test_mlp_*.cpp`, `test_mode_*.cpp`, `test_fixed_buffer.cpp`, `test_ring_buffer.cpp`, `test_rng.cpp`, `test_math.cpp`. Helpers in `test_helpers.hpp`.
- Verification: `ml_golden_vectors.cpp`, `engine_impulse.cpp` (+ `engine_impulse_baseline.bin`), `parity_check.cpp` + `parity_wasm.mjs` + `parity_diff.mjs` — native-vs-WASM bit-equivalence within 1e-5.

### `scripts/` — build + verify entry points
- `build-firmware.sh`, `flash-firmware.sh`, `build-and-flash-firmware.sh`, `firmware-common.sh` — Arduino-CLI wrapper for RP2350 target with C++20 flag.
- `build-wasm.sh` — Emscripten compile producing `playground/public/nisps.{wasm,js}`.
- `build-cpp-tests.sh` — CMake configure + build + ctest (Ninja).
- `parity-check.sh` — runs native + WASM and diffs binary outputs.
- `lint-cpp.sh` — `.f` literal warn + heap/`Arduino.h` violation fail.
- `run-all-tests.sh` — master verification script.

### `.github/workflows/`
- `ci.yml` — GitHub Actions: cmake build + ctest + WASM build + parity check + lint + Playwright (cpp-tests + playground-tests jobs). Firmware compile is documented as manual.

### Submodules (in `src/`)
- `src/memllib/` — hardware abstraction (audio driver, peripherals, MIDI). **Not auto-initialized** — fresh clones need `git submodule update --init --recursive`.
- `src/daisysp/` — vendored DSP library. Used by some firmware glue; nisps replaced its PitchShifter with a custom granular impl.

### Top-level docs
- `CLAUDE.md` — long-form architecture narrative.
- `MAP.md` — this file.
- `ALIGNMENT.md` — strategic gaps + open mission questions, dated, opinionated.
- `README.md` — short quickstart.
- `AGENTS.md` — beads/bd conventions.

## Entry points

- **Firmware**: `scripts/build-firmware.sh [VARIANT]` (interactive prompt if omitted), `scripts/flash-firmware.sh`, `scripts/build-and-flash-firmware.sh`. Target: `rp2040:rp2040:solderparty_rp2350_stamp_xl:opt=Optimize3`, `-std=gnu++20`.
- **Playground dev**: `cd playground && bun install && bun run dev` (Vite, port 5173, COOP/COEP headers).
- **Playground build**: `cd playground && bun run build`.
- **WASM rebuild**: `bash scripts/build-wasm.sh` (needs `emcc`).
- **Host C++ tests**: `bash scripts/build-cpp-tests.sh`.
- **Parity check**: `bash scripts/parity-check.sh`.
- **All tests**: `bash scripts/run-all-tests.sh`.
- **Playwright**: `cd playground && bunx playwright test`.
- **Codegen**: `cd codegen && bun run generate.ts` (regenerates `nisps/modes/generated/` and `playground/src/modes/generated/`).

## Conventions

- Firmware mode selection is compile-time only — `#define MEMLNAUT_MODE_TYPE` in the `.ino`.
- `nisps/` follows Chris's RP2350 perf rules globally: no heap, `static const float` for non-trivial constants, strict `.f` suffix, memory section attrs (`NISPS_AUDIO_MEM`, `NISPS_AUDIO_FUNC`, `NISPS_APP_SRAM`, `NISPS_HOT`, `NISPS_FORCE_INLINE`).
- C++ identifiers: `PascalCase` types, `snake_case` functions/variables, `kPascalCase` constexpr. JSON keys `snake_case`. TS types `PascalCase`, components `PascalCase.tsx`, modules `kebab-case.ts`.
- `Curve` enum lives in `nisps/core/math.hpp` (lowercase: `linear/exp/log/square/sqrt/sigmoid/cubic`); generated mode headers re-export via `using Curve = ::nisps::Curve;`. TS mirror at `playground/src/output/curves.ts` with same names.
- Modes are TSX components composed of primitives; mode parameter contracts are JSON schemas with codegen → C++/TS types. **No declarative JSON UI.**
- WASM and firmware share the same C++; WASM is fixed at `MLP<32, 10, 14, 18, 126>` (`nisps_ml_create` ignores requested dims — see `plans/one-core-engine-refactor.md` P2) and modes use a slice of outputs based on schema's `output_size`.
- Cross-platform parity: `scripts/parity-check.sh` enforces native vs WASM agreement within 1e-5.

## Gotchas

- `src/memllib` submodule is not auto-checked-out.
- Firmware sketch path is `firmware/MEMLNaut-NISPS/MEMLNaut-NISPS.ino` (Arduino-CLI requires sketch dir name == sketch file name); `firmware/MEMLNaut-NISPS/src/{memllib,daisysp,nisps}` are symlinks because Arduino's preprocessor refuses `..` in includes from sketch headers.
- `firmware/MEMLNaut-NISPS/glue/mode_select.hpp` `#undef`s Arduino macros (`sq`, `min`, `max`, `abs`, `round`) before pulling nisps headers — engines use those identifiers as method names.
- `nisps_firmware::g_active_mode_bridge` is `extern` in `glue/audio_driver.hpp` and defined in the `.ino`; combining `inline` with `__not_in_flash` produces a comdat conflict at link time.
- The host fallback of `NISPS_AUDIO_FUNC` in `nisps/core/perf.hpp` is misshapen for use as a function-name decorator (firmware path expands to `__not_in_flash_func` which takes only a name); firmware glue avoids the macro to dodge the inconsistency. See `ALIGNMENT.md`.
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
