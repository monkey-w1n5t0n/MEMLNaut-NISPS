# MAP

MEMLNaut-NISPS: Neural Interactive Shaping of Parameter Spaces. Two living artefacts share one ML core: (1) Arduino/RP2040 firmware for the MEMLNaut hardware, and (2) a browser playground that uses a WASM build of the same MLP to drive a C15 synth + other outputs. A header-only `nisps-core/` extraction is reused by the playground (via WASM bindings) and a VCV Rack module. See `CLAUDE.md` for the long-form architecture narrative.

## Layout

### Firmware (Arduino, RP2350)
- `firmware/MEMLNaut-NISPS/MEMLNaut-NISPS.ino` — sketch entry point; dual-core orchestration, mode selected at compile-time via `#define MEMLNAUT_MODE_TYPE`.
- `firmware/MEMLNaut-NISPS/glue/` — hardware bindings:
  - `audio_driver.hpp` — bridges memllib `AudioDriver` block callback → `Mode::process(stereosample_t)` per-sample loop.
  - `peripherals.hpp` — wires joystick / pots / buttons → `Mode::set_input` and ML primitives (`draw_weights`, `move_weights`, `train`, `reset`).
  - `midi_io.hpp` — incoming MIDI → mode `note_on/update_bpm/set_playing`; drains mode `ControlEvent` ring → MIDI UART.
  - `mode_select.hpp` — type aliases mapping `MEMLNautMode<Name>` identifiers to `nisps::modes::*Mode` C++ types. Build script rewrites the active line.
  - `input_router.hpp`, `output_router.hpp` — top-level `wire_inputs()` / `drain_outputs()` entry points.
- `firmware/MEMLNaut-NISPS/src/{memllib,daisysp,nisps}` — symlinks into the repo's submodules and `nisps/` library. Required by Arduino-CLI's sketch tree convention.
- `firmware/README.md` — structure, build, and verification notes.
- `nisps/` — platform-agnostic C++20 ML / DSP / engines / modes (see "nisps library" below). The firmware glue layer composes these.
- `src/memllib/` — git submodule (hardware abstraction). **Not auto-initialized** — build breaks without `git submodule update --init --recursive`.
- `src/daisysp/` — vendored DSP library (filters, drums, effects).
- `data/` — preset/asset CSVs.

### nisps library (platform-agnostic C++20)
- `nisps/core/` — foundational types, perf attrs, concepts (`AudioEngine`, `Mode`, `MLEngine`), fixed buffers, RNG, math.
- `nisps/ml/mlp.hpp` + `activations.hpp`, `loss.hpp`, `training.hpp`, `init.hpp`, `rl.hpp`, `stats.hpp` — MLP class template with SGD, RMSProp, RL primitives.
- `nisps/dsp/` — biquad, delay, reverb, filter, env, osc, pitch_shift, dc_blocker — extracted DSP primitives.
- `nisps/engines/` — `paf_synth.hpp`, `channel_strip.hpp`, `xiasri.hpp`, `verb_fx.hpp`, `memlcelium.hpp`, `breakor.hpp`, `elysiamorf.hpp`, `analysis.hpp`, plus `base.hpp` with `NoOpEngine`. Each satisfies `AudioEngine`.
- `nisps/modes/` — one mode per engine, all derive from `ModeBase` CRTP scaffold. Schemas in `nisps/modes/generated/` (codegen output).
- `nisps/wasm/` — Emscripten bindings (used by the playground build, not the firmware).
- `nisps/CMakeLists.txt` + `nisps/build/` — host-target tests.

### nisps-core (legacy; superseded by `nisps/`)
- `nisps-core/` — earlier header-only extraction. Kept until cleanup stream.

### Playground (browser ML demo)
- `playground/index.html` — hub linking to the three variants.
- `playground/a-immersive.html` + `js/a-app.js` — **primary** app. WASM engine, full control surface, modular/engine-switcher, C15 + MIDI + audio-canvas outputs.
- `playground/b-workbench.html` + `js/b-app.js`, `c-journey.html` + `js/c-app.js` — older variants on the legacy JS engine. Feature-frozen; drift vs. a-app is intentional (see `CLAUDE.md` memory on `playground/RECONCILIATION.md` — note: file does **not** currently exist).
- `playground/designs.html`, `js/app.js` — oldest experimental app. Kept for reference.
- `playground/wasm/` — Emscripten build: `nisps_bindings.cpp` (C API, float32), `build.sh`, compiled `nisps.wasm`/`nisps.js`.
- `playground/js/nisps/` — `nisps-wasm.js` (WasmIML wrapper), `nisps-wasm-worker.js` (off-thread train), `dataset.js` (FIFO ring buffer, max 100), legacy pure-JS engine (`iml.js`, `mlp.js`, `layer.js`, `node.js`) used by b/c apps.
- `playground/js/synth/` — `c15-bridge.js`, `param-map.js` (126 curated C15 params), `presets.js` (4 tiers), `arpeggiator.js`.
- `playground/js/ui/` — UI modules. Categories:
  - Input: `input-pipeline.js`, `joystick.js`, `joy-map-enhanced.js`, `gamepad.js`, `hand-tracker.js`, `eoc-*.js`.
  - Control surface: `control-surface.js`, `control-surface-ui.js` (3 compound axes: Boldness / Memory / Precision).
  - Training/exploration: `snapshot-stack.js`, `ab-compare.js`, `region-pin.js`, `param-pin.js`, `auto-explore.js`, `pressure-feedback.js`, `input-heatmap.js`.
  - Output/debug: `output-pipeline.js`, `weight-health.js`, `gradient-flow.js`, `session-presets.js`, `visualizer.js`, `param-display.js`, `dev-panel.js`.
  - Phase wiring: `phase2-ui.js`, `phase3-ui.js`, `phase4-ui.js`.
  - Modular mode: `modular-ui.js` (~52k, large), `engine-switcher.js` — newer; not yet documented in `CLAUDE.md`.
- `playground/c15/`, `playground/faust/`, `playground/osc-bridge/` — external synth/bridge assets.
- `playground/SPEC-controls.md`, `SPEC-shapeseq.md`, `ARCHITECTURE.md`, `PLAN-solidjs-migration.md`, `TODOS.md`, `README.md`, `devlog/` — docs.

### Other consumers
- `vcv/` — VCV Rack plugin using `nisps-core` (`src/MEMLNaut.cpp`, `SPEC.md`, `NISPS-FORMAT.md`).

### Tests
- `tests/e2e/*.spec.js` — Playwright e2e against the immersive app via the `?debug=1` probe (`window.__nisps`). Covers ml-engine, wasm-api, ui-interactions, input-pipeline, persistence, engine-switching, modular-mode. Shared helpers in `tests/e2e/helpers.js`.
- `playwright.config.js`, `package.json` — auto-starts a static server on port 7331.

### Top-level docs / planning
- `CLAUDE.md` — architecture narrative for both firmware and playground.
- `AGENTS.md` — beads/bd conventions.
- `NISPS_CORE_EXTRACTION_PLAN.md`, `NISPS_CORE_TASKS.md` — extraction task list; status unclear, likely stale now that `nisps-core/` exists.
- `README.md` — short quickstart.

## Entry points
- **Firmware**: `scripts/build-firmware.sh`, `scripts/flash-firmware.sh`, or `scripts/build-and-flash-firmware.sh` (requires submodules initialised). `build-firmware.sh` can take an explicit variant name like `MEMLCelium` or prompt interactively from the parsed `MEMLNautMode*` list and rewrite the active mode in `MEMLNaut-NISPS.ino`. Matching is case-insensitive, but user-facing prompts preserve the canonical mode capitalization. The scripts target `rp2040:rp2040:solderparty_rp2350_stamp_xl:opt=Optimize3` and force C++20. Execution = `setup()`/`loop()` on Core 0, `setup1()`/`loop1()` on Core 1, audio ISR on Core 1.
- **Playground**: `cd playground && python3 -m http.server` (or `serve.sh` / `serve-coop.py`), open `a-immersive.html`. Append `?debug=1` to expose `window.__nisps`.
- **WASM rebuild**: `cd playground/wasm && ./build.sh` (needs `emcc`).
- **Tests**: `npx playwright test` (auto-spawns server on 7331).
- **VCV module**: built inside `vcv/` with the VCV Rack SDK.

## Conventions
- Firmware mode selection is compile-time only; only one `MEMLNAUT_MODE_TYPE` uncommented at a time in `MEMLNaut-NISPS.ino`.
- RP2040 memory placement via `APP_SRAM`, `AUDIO_MEM`, `AUDIO_FUNC`, `__not_in_flash("app")`. Audio hot paths use `__force_inline` / `__hot` / `__flatten`.
- Cross-core sync: `MEMORY_BARRIER()`, `WRITE_VOLATILE`/`READ_VOLATILE`, RP2040 `queue_t`.
- Voice spaces are header-only structs whose mappings are lambdas capturing synth state — **implicit coupling** to synth members.
- Playground ML engines (`IML`, `WasmIML`) share a duck-typed interface (`inference`, `train`, `getWeights`/`setWeights`, …); WASM uses **float32**, JS engine uses float64.
- `Dataset` is a **FIFO ring buffer**, default max 100 examples; recency/spatial sample weighting is computed JS-side.
- Spread-aware weight init / RL noise (`drawWeightsSpread`, `moveWeightsEx`) live in `playground/wasm/nisps_bindings.cpp`, **not** in `nisps-core` proper — they are playground-specific.
- Playground UI modules dispatch `controlsurface:change` CustomEvents; `a-app.js` listens and reconfigures the input pipeline, spread, and RL params.
- URL params: `?tame`, `?spread`, `?preset`, `?debug=1`, `?shapeseq=1`.
- Persistent memory (`bd remember`) notes:
  - ShapeSeq is gated behind `?shapeseq=1` until solid — arp remains default.
  - ShapeSeq MLP plan is **switchable mode** (unified single-MLP first, then dual-MLP option).
  - `playground/RECONCILIATION.md` is supposed to track features landed in a-app but not yet in b/c. File does not currently exist — if you add a-only features, either create it or explicitly accept the drift.

## Gotchas
- `memllib` submodule is **not auto-checked-out** — a fresh clone will fail to compile the firmware silently. (`src/memlp` was deleted; `nisps/ml/mlp.hpp` replaces it.)
- The Arduino sketch lives at `firmware/MEMLNaut-NISPS/MEMLNaut-NISPS.ino` (Arduino-CLI requires sketch dir name == sketch file name). It reaches `nisps/`, `src/memllib/`, `src/daisysp/` via symlinks under `firmware/MEMLNaut-NISPS/src/` because Arduino's preprocessor refuses `..` in includes from sketch headers.
- `firmware/MEMLNaut-NISPS/glue/mode_select.hpp` `#undef`s Arduino's `sq`/`min`/`max`/`abs`/`round` macros before pulling nisps headers — the nisps engines use those identifiers as method names.
- The audio bridge struct `nisps_firmware::g_active_mode_bridge` is `extern` in `glue/audio_driver.hpp` and defined in the .ino; combining `inline` with the `__not_in_flash` section attribute creates a comdat / section conflict at link time.
- Double-scaled loss: C++ `Train()` and WASM `train_ex` both divide by `n` when no sample weights are supplied (known, backward-compat, tracked as `meml-ues`).
- Recent fixes cluster around the modular voice: matrix rebuild, `mod_amp` positive-only floor, MLP bypass when untrained, worklet blob-url registration — modular mode is under active churn, so expect rough edges.
- `a-app.js` is the single source of truth. **Do not** reflexively mirror changes to `b-app.js` / `c-app.js` — they are frozen legacy variants.
- `window.__nisps` only exists with `?debug=1`; Playwright helpers expect this.

## Open questions / smells
- `modular-ui.js` is ~52k and undocumented in `CLAUDE.md`; needs a `docs/modular.md` stub, especially given recent bug cluster.
- `engine-switcher.js` + `engine-switching.spec.js` + `modular-mode.spec.js` — newer engine-selection mechanism not described in `CLAUDE.md`. Verify whether there is now a supported alternative engine besides WASM-MLP.
- `playground/RECONCILIATION.md` is referenced by persistent memory but missing on disk. Either the memory is stale or the file needs creating.
- `NISPS_CORE_TASKS.md` / `NISPS_CORE_EXTRACTION_PLAN.md` at the repo root likely describe completed work — candidates for deletion or archiving under `docs/history/`.
- `PLAN-solidjs-migration.md` (34k) describes an unstarted rewrite. Either flag it "aspirational / not started" at the top or move to `docs/`.
- No `README.md` for `playground/wasm/` — a 10-line binding table (C API ↔ JS wrapper ↔ nisps-core call) would save future agents a trip through `nisps_bindings.cpp`.
- Firmware `IMLInterface`'s STORE_VALUE vs STORE_POSITION modes have no docs — decide which modes use which and document.
- Global `std::shared_ptr<MIDIInOut>` in the sketch introduces refcount traffic on the 1 ms MIDI poll — likely benign, worth confirming.
- Two duplicated CLAUDE.md copies at `~/.claude/CLAUDE.md` and `~/.claude-gp/CLAUDE.md` (symlinked), and a per-repo one — not a repo smell, just noted so future agents don't try to "reconcile".
