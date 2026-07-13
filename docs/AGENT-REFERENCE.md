# Detailed Agent Reference — MEMLNaut-NISPS

Supplement to [`../AGENTS.md`](../AGENTS.md); deep target, schema, build, and verification
detail lives here.

This file provides guidance to coding agents working with this repository.

## Overview

MEMLNaut-NISPS — Neural Interactive Shaping of Parameter Spaces. A research platform for interactive ML control of audio. **One C++20 codebase** (`nisps/`) compiles to two targets:

1. **RP2350 firmware** for the MEMLNaut hardware platform (`firmware/`).
2. **WASM** in a SolidJS browser playground (`playground/`) — same engines + ML, run through an AudioWorklet.

Browser audio engines are a superset of firmware engines (C15 is browser-only). Parameter contracts are JSON schemas (`schemas/`) with codegen producing both C++ headers and TypeScript types.

Project documentation: https://musicallyembodiedml.github.io/memlnaut/approaches/nisps

For the codebase index, see `MAP.md`. For strategic gaps and open mission questions, see `ALIGNMENT.md`.

**For anything UI-related in the Manifold front-end (`manifold/`), read `manifold/ONBOARDING.md` first** — it's a single-file agent orientation (run/build/deploy/test, the UI/engine-spine/WASM layering, the convertible Stages, the Dock + drawers, and the non-obvious gotchas).

## The `nisps/` core

```
nisps/
├── core/      types, perf attrs, concepts (AudioEngine, MLEngine, Mode), fixed/ring buffers, deterministic RNG, math
├── ml/        MLP class template (4-layer, 3 hidden); SGD, gradient clipping, spread-aware Xavier init,
│              RL move_weights with output pin mask + per-layer scaling + weight decay
├── dsp/       biquad, delay, reverb, filter, env, osc, pitch_shift, dc_blocker
├── engines/   8 audio engines (paf_synth, channel_strip, xiasri, verb_fx, memlcelium, breakor,
│              elysiamorf, analysis) + NoOpEngine. Each satisfies the AudioEngine concept.
├── modes/     8 platform-agnostic modes binding {ML, engine, voice space, abstract I/O channels}.
│              CRTP base eliminates the duplication that plagued firmware modes.
└── wasm/      Emscripten C API bindings (compiled only for WASM target)
```

Build: `cmake -S nisps -B nisps/build -G Ninja && cmake --build nisps/build && ctest --test-dir nisps/build`.

Tests: 4 executables (`nisps_core_tests`, `nisps_dsp_engine_tests`, `nisps_modes_tests`, `nisps_golden_tests`). Run all: `bash scripts/build-cpp-tests.sh`. Parity vs WASM: `bash scripts/parity-check.sh` (asserts native and WASM produce identical outputs within 1e-5).

### Performance contract (RP2350)

These rules apply to **all** code under `nisps/`. They are inert in WASM but kept globally for consistency.

- **No heap.** No `new`, `malloc`, `std::vector` in hot paths. Use `nisps::FixedBuffer<T, N>` or `std::array<T, N>`.
- **Constants discipline.** Float literals >255 used in hot paths must be `static const float val = X.f;` not inline.
- **`.f` suffix on all float literals.** No double promotion in audio/inference paths.
- **Memory section attributes.** Apply `NISPS_AUDIO_MEM` / `NISPS_AUDIO_FUNC` / `NISPS_APP_SRAM` / `NISPS_HOT` / `NISPS_FORCE_INLINE` (from `nisps/core/perf.hpp`).
- **No virtual dispatch in audio path.** `AudioEngine` and `Mode` are C++20 concepts, not interfaces.
- **Deterministic RNG.** All RNG state is per-instance; constructors take a seed; cross-platform parity tests rely on this.

Lint: `bash scripts/lint-cpp.sh` warns on missing `.f` and fails on heap/`Arduino.h` use under `nisps/`.

## The `firmware/` target

```
firmware/MEMLNaut-NISPS/
├── MEMLNaut-NISPS.ino     # Entry point; mode selected via #define MEMLNAUT_MODE_TYPE
├── glue/
│   ├── audio_driver.hpp   # memllib AudioDriver block callback → Mode::process per-sample
│   ├── peripherals.hpp    # joystick / pots / buttons → Mode::set_input + ML primitives
│   ├── midi_io.hpp        # MIDI in → mode handlers; drain ControlEvent ring → MIDI UART
│   ├── mode_select.hpp    # type aliases firmware mode name → nisps::modes::*Mode
│   ├── input_router.hpp   # wire_inputs() entry point
│   ├── output_router.hpp  # drain_outputs() entry point
│   └── settings_view.hpp  # wire_settings(): TFT/rotary menu (Joystick Dual/Single for 4-in modes)
└── src/{memllib,daisysp,nisps}    # symlinks (Arduino-CLI sketch tree convention)
```

Build: `scripts/build-firmware.sh [VARIANT]`. Verified compiling for PAFSynth, ChannelStrip, BreakOr on `rp2040:rp2040:solderparty_rp2350_stamp_xl:opt=Optimize3` with `-std=gnu++20`. Flash: `scripts/flash-firmware.sh`. One-shot: `scripts/build-and-flash-firmware.sh`.

### Dual-core orchestration (firmware)

- **Core 0**: UI loop, ML inference (`Mode::tick_control`), peripheral polling (5ms period).
- **Core 1**: Real-time audio processing (`Mode::process`), MIDI polling.
- **Sync**: `nisps::core::ring_buffer` (templated SPSC lock-free, replaces pico/util/queue) + memory barriers (`nisps::core::memory_barrier`, `write_volatile`/`read_volatile`).

## The `playground/` target

```
playground/                  # Vite + SolidJS + TypeScript
├── src/
│   ├── primitives/          # 16 UI building blocks (Slider, JoyMap, Heatmap, …) + .demo.tsx for /dev/primitives
│   ├── modes/               # one TSX per firmware mode + C15Mode (browser-only); ModeShell + ModeSwitcher + mode-runtime
│   ├── stores/              # Solid stores (ml, input, output, mode, control, session, exploration, bus + persistence)
│   ├── audio/               # engine-host + AudioWorklet processor (loads nisps.wasm separately on each thread)
│   ├── ml/                  # WasmIML class + disposable async-training Worker + dataset
│   ├── input/, output/      # pure-fn pipelines (deadzone→zoom→curve→smoothing→momentum, then global curve→smoothing→slew→freeze)
│   ├── features/            # heatmap, snapshots, A/B compare, region/param pin, trail, weight health, gradient flow
│   └── debug/probe.ts       # synchronous window.__nisps for Playwright
├── public/                  # nisps.{wasm,js}, c15.{wasm,glue}
└── tests/e2e/               # Playwright specs + helpers
```

Dev: `cd playground && bun install && bun run dev`. Build: `bun run build`. Typecheck: `bun run typecheck`. E2E: `bunx playwright test`.

### Stores + reactivity

All stores use SolidJS `createStore` for objects, `createSignal` for primitives. ML outputs are stored in a separate Float32Array signal (per the migration plan's perf guidance). Persistence (debounced 200ms localStorage round-trip) wired in `playground/src/stores/persistence.ts`. The signal bus (`bus.ts`) handles cross-store events (`ml.*`, `mode.*`, `pin.*`, `ui.*`).

### Control surface

Three compound axes (Boldness / Memory / Precision) interpolate per-axis tables to drive ~6 underlying parameters each, with offset overrides ("trim-pot" model). State is in `control-store`. Six built-in control presets (Default, First Touch, Jazz Hands, Sculptor, Improviser, Microscope) available via the ModeShell control bar.

### Debug probe (Playwright)

`window.__nisps` is exposed synchronously and bypasses Solid reactivity (uses `untrack`/`batch`). API matches the `.local/recon/04-playground.md` spec — `setInputs`, `getOutputs`, `getLoss`, `train`, `thumbsUp`/`thumbsDown`, `randomise`, `clearExamples`, `inferBatch`, `getLayerStats`, `saveState`, etc.

## The `schemas/` + `codegen/` contract

Each mode has a `schemas/modes/<mode>.json` describing its parameters (name, label, range, default, curve, group), ML config (input/output sizes, hidden layers), voice spaces (names — bodies are inline lambdas in the C++ engine), and UI config. The meta-schema at `schemas/schema.json` validates these.

Codegen (`bun run codegen/generate.ts`) emits:
- `nisps/modes/generated/<mode>_schema.hpp` — `constexpr` C++ data, namespace `nisps::modes::generated`, re-exports `nisps::Curve` from `nisps/core/math.hpp`.
- `playground/src/modes/generated/<mode>_schema.ts` — typed const objects + per-mode params interface.

Codegen is idempotent. Golden test ensures regenerating produces byte-identical output.

## WASM bridge

Two WASM instances at runtime:

1. **Main thread** (`playground/src/ml/wasm-iml.ts`): ML inference + sync training + RL primitives. Update store after each call. Async training via disposable Web Worker (`wasm-worker.ts`).
2. **AudioWorklet** (`playground/src/audio/worklet/nisps-processor.ts`): runs engine `process_block` per audio block. Loads `nisps.wasm` directly via `WebAssembly.compile` (no Emscripten glue in worklet). Bytes posted from main thread.

C API is in `nisps/wasm/bindings.cpp`. Build: `bash scripts/build-wasm.sh` (~94KB output to `manifold/public/`, transitional copy to `playground/public/` until P1).

The WASM target is fixed at `MLP<32u, 10u, 14u, 18u, 126u>` (`nisps_ml_create` ignores requested dims — see `docs/specs/plans/one-core-engine-refactor.md` P2). Modes with smaller `input_size`/`output_size` use a slice.

### Known limitations

- Loss history not yet plumbed through C API; `lossHistory` in the store is a single-element array per training run.
- Engine MLP architecture is fixed at compile time — supporting per-mode hidden-layer shapes would need either multiple WASM modules or runtime variation.
- Mic input through the worklet for XIASRI / SoundAnalysisMIDI is not wired; UI scaffolds render but feature is TODO.
- C15 voice space integration in C15Mode is a placeholder.
- The browser Jolt/OU controls (`playground/src/ml/jolt.ts`, `playground/src/output/ou-explore.ts`) reimplement the gesture math in TS rather than calling the C++ `ml::Jolt`/`ml::OUNoise` through WASM. They drive weights via the existing `nisps_ml_get/set_weights` bindings and use `Math.random()` (not the deterministic `Rng`) — fine for stochastic exploration aids, but firmware↔browser bit-parity of the noise itself is intentionally not guaranteed.

## URL parameters (playground)

| Param | Range | Default | Effect |
|-------|-------|---------|--------|
| `tame` | 0–1 | 1 | Constrains synth output ranges toward safe limits. |
| `spread` | 0–1 | 0.6 | Master noise regime (init scale, RL noise cap, per-layer Xavier scaling, weight decay). |
| `preset` | preset id | _(none)_ | Auto-loads a synth preset on first visit. |
| `debug` | 1 | _(off)_ | Exposes `window.__nisps` debug probe. |

### `spread` — sigmoid saturation control

The MLP uses ReLU hidden layers with a sigmoid output. With uniform [-1,1] weights, the sum of many weighted inputs at each layer drives sigmoid pre-activations far from zero (std dev ≈ √fan_in), causing outputs to saturate. The `spread` parameter addresses this:

- `spread=0` (polarised): uniform [-1,1] weights, RL noise cap 0.3, no decay. Outputs cluster at extremes — good for radical exploration.
- `spread=1` (centered): Xavier-scaled weights, RL noise cap 0.05, 10% weight decay per move. Outputs spread across [0,1] — better for fine-grained shaping.
- Intermediate values interpolate.

## Verification chokepoints (user-confirmed)

- **A. Hardware**: each firmware mode flashes and produces correct audio on RP2350.
- **B. RP2350 perf**: no regression vs current main.
- **C. Browser parity**: each firmware mode runs in browser via WASM, sounds equivalent.
- **D. a-immersive feature parity**: control surface, snapshots, A/B compare, region/param pins, heatmap, weight health, gradient flow, output pipeline, session presets.
- **E. CI green**: `bash scripts/run-all-tests.sh` (cmake build + ctest + WASM build + parity + lint + Playwright).

## Build system summary

```bash
# Initialize submodules (required for memllib + daisysp)
git submodule update --init --recursive

# Codegen (run after editing any schemas/modes/*.json)
cd codegen && bun install && bun run generate.ts

# C++ host tests
bash scripts/build-cpp-tests.sh

# WASM
bash scripts/build-wasm.sh

# Cross-platform parity
bash scripts/parity-check.sh

# Lint
bash scripts/lint-cpp.sh

# Firmware
scripts/build-firmware.sh PAFSynth        # or any other variant
scripts/flash-firmware.sh
scripts/build-and-flash-firmware.sh

# Playground
cd playground && bun install
bun run dev          # Vite dev (COOP/COEP enabled)
bun run typecheck
bun run build
bunx playwright test

# All tests
bash scripts/run-all-tests.sh
```

## Issue tracking

Use `ergo` exclusively for coding-work tasks over the Holon core; see the `ergo` skill.
Do not use TodoWrite or markdown task lists. Legacy tracker stores are retired/frozen
and reference-only.
