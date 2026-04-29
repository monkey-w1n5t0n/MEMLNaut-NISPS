# MAP

MEMLNaut-NISPS — Neural Interactive Shaping of Parameter Spaces. One C++20 codebase (`nisps/`) compiles to two targets: (1) Arduino/RP2350 firmware for the MEMLNaut hardware, (2) WASM in a SolidJS browser playground that runs the same engines + ML through an AudioWorklet. Browser audio engines are a superset of firmware engines (C15 is browser-only). See `CLAUDE.md` for the long-form architecture narrative and `ALIGNMENT.md` for current strategic gaps.

## Layout

### `nisps/` — platform-agnostic C++20 library (the only ML/DSP/engine code)
- `nisps/core/` — `perf.hpp` (memory section attrs), `types.hpp`, `concepts.hpp` (`MLEngine`, `AudioEngine`, `Mode`), `fixed_buffer.hpp`, `ring_buffer.hpp` (SPSC lock-free, replaces pico/util/queue), `rng.hpp` (xoshiro256+ deterministic), `math.hpp` (fast_sigmoid, `Curve` enum + `apply_curve`).
- `nisps/ml/` — MLP class template `MLP<NIn, NH1, NH2, NH3, NOut>`. Files: `mlp.hpp`, `activations.hpp`, `loss.hpp` (MSE, no double-scaling), `training.hpp` (SGD + grad clipping), `init.hpp` (spread-aware uniform↔Xavier), `rl.hpp` (`move_weights` with output pin mask + per-layer scaling + weight decay), `stats.hpp`.
- `nisps/dsp/` — `biquad.hpp`, `delay.hpp`, `reverb.hpp`, `filter.hpp`, `env.hpp`, `osc.hpp`, `pitch_shift.hpp`, `dc_blocker.hpp`. Lean primitives extracted from maximilian; daisysp PitchShifter replaced with custom granular impl.
- `nisps/engines/` — eight audio engines, each satisfying `AudioEngine`: `paf_synth.hpp`, `channel_strip.hpp`, `xiasri.hpp`, `verb_fx.hpp`, `memlcelium.hpp`, `breakor.hpp` (sequencer, NoOp audio), `elysiamorf.hpp` (sequencer, NoOp audio), `analysis.hpp` (input-side spectral features). Plus `base.hpp` (`NoOpEngine`, engine_id "thru").
- `nisps/modes/` — eight platform-agnostic modes binding `{ML config, engine, voice space lambdas, abstract I/O channels}`. Files: `paf_synth.hpp`, `channel_strip.hpp`, `xiasri.hpp`, `verb_fx.hpp`, `memlcelium.hpp`, `breakor.hpp`, `elysiamorf.hpp`, `sound_analysis_midi.hpp`. `base.hpp` provides a CRTP scaffold eliminating the duplication that previously plagued firmware modes. `voice_space.hpp` holds engine-side voice space dispatch helpers. `generated/` contains codegen output (do not edit by hand).
- `nisps/wasm/bindings.cpp` — flat C API exported to WASM (Emscripten target only).
- `nisps/CMakeLists.txt` + `nisps/build/` — host-target builds + ctest.

### `firmware/` — Arduino sketch + hardware glue
- `firmware/MEMLNaut-NISPS/MEMLNaut-NISPS.ino` — entry point. Selects active mode at compile time via `#define MEMLNAUT_MODE_TYPE`.
- `firmware/MEMLNaut-NISPS/glue/` — hardware bindings:
  - `audio_driver.hpp` — bridges memllib `AudioDriver` callback → `Mode::process(stereosample_t)`.
  - `peripherals.hpp` — joystick / pots / buttons → `Mode::set_input` and ML primitives.
  - `midi_io.hpp` — MIDI in → mode `note_on`/`update_bpm`/`set_playing`; drains `ControlEvent` ring → MIDI UART.
  - `mode_select.hpp` — type aliases mapping firmware mode identifiers to `nisps::modes::*Mode` C++ types. Build script rewrites the active line.
  - `input_router.hpp`, `output_router.hpp` — top-level `wire_inputs()` / `drain_outputs()` entry points.
- `firmware/MEMLNaut-NISPS/src/{memllib,daisysp,nisps}` — symlinks (Arduino-CLI requires sketch-tree includes; preprocessor refuses `..` in headers).
- `firmware/README.md` — structure + build instructions.

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

### `schemas/` — JSON parameter contracts (firmware/browser source of truth)
- `schemas/schema.json` — Draft 2020-12 meta-schema validating mode files.
- `schemas/modes/<mode>.json` (×8) — each mode's params, ranges, defaults, curves, voice spaces, ML config.
- `schemas/modes/params_notes.md` — provenance notes and judgement calls per mode.

### `codegen/` — schema → C++/TS code
- `codegen/generate.ts` — Bun script: validates schemas via ajv, emits per-mode `nisps/modes/generated/<mode>_schema.hpp` (`constexpr`, `nisps::modes::generated`) and `playground/src/modes/generated/<mode>_schema.ts`. Idempotent.
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
- WASM and firmware share the same C++; WASM is fixed at `MLP<2, 10, 14, 18, 126>` and modes use a slice of outputs based on schema's `output_size`.
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
