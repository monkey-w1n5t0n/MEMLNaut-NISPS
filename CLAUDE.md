# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

MEMLNaut-NISPS (Neural Interactive Shaping of Parameter Spaces) is firmware for the MEMLNaut hardware platform - a custom embedded audio device built on Raspberry Pi Pico (RP2040). It implements interactive machine learning for real-time audio synthesis and processing, enabling users to shape sound parameters through reinforcement learning.

Project documentation: https://musicallyembodiedml.github.io/memlnaut/approaches/nisps

## NISPS Core Library

The `nisps-core/` directory contains a platform-agnostic C++20 extraction of the interactive ML engine. This header-only library can be used in any C++ project for neural network-based parameter mapping.

**Key differences from firmware**:
- ✅ Platform-agnostic (no Arduino/RP2040 dependencies)
- ✅ Header-only (just include and use)
- ✅ C++20 (uses std::span)
- ✅ Namespaced (`nisps::`)
- ❌ No audio synthesis (use it to *control* your synth)
- ❌ No hardware drivers

**Use case**: Control synthesizers, effects, lights, game parameters, or any system that responds to continuous parameters.

See `nisps-core/README.md` for complete documentation and examples.

## Web Playground

The `playground/` directory contains a browser-based interactive demo of the NISPS ML engine. No build step or dependencies — serve statically.

- **2 inputs** (virtual joystick X/Y) mapped through a `[3, 32, 48, 64, 126]` MLP to **126 outputs**
- **Four output modes**:
  - **Visual**: first 20 outputs control a Canvas2D flow-field particle system
  - **Synth (C15)**: all 126 outputs control the C15 WASM synthesizer
  - **MIDI CC**: outputs mapped to configurable MIDI CC messages via WebMIDI
  - **Audio Canvas**: 36 outputs drive a generative audio sampler
- **Two learning modes**: Examples (set slider targets, add examples, train) and RL Feedback (thumbs up/down with exploration noise)
- **Serve statically**: `cd playground && python3 -m http.server`
- **Mobile-first**: designed for touch/foldable phone use

Key files: `js/nisps/` (WASM engine + dataset), `js/ui/` (visualizer, joystick, controls, input pipeline, control surface), `js/synth/` (C15 bridge, param map, arpeggiator), `js/a-app.js` (immersive app wiring).

### WASM ML Engine

The immersive app (`a-immersive.html` / `a-app.js`) uses a WASM-compiled MLP for all inference and training. The legacy JS engine (`iml.js`, `mlp.js`, `layer.js`, `node.js`) is still used by the three older playground variants (`app.js`, `b-app.js`, `c-app.js`) but is slated for migration to WASM (see meml-dj9).

**Architecture:**

```
Main thread                              Worker thread
  WasmIML (nisps-wasm.js)                  nisps-wasm-worker.js
  ├─ WASM instance A (persistent)          └─ WASM instance B (lazy)
  │   inference() — every rAF tick              trainEx() — off-thread
  │   inferBatch() — heatmap sampling           returns: weights + loss curve
  │   moveWeightsEx() — RL exploration
  │   evalLoss() — non-destructive query
  │   getLayerStats() — per-layer health
  │   getWeights/setWeights — sync w/ worker
  │
  └─ Dataset (JS-side, dataset.js)
      ├─ FIFO ring buffer (max 100 examples)
      └─ computeWeights() — recency/spatial/combined sample weighting
```

**WASM bindings** (`playground/wasm/nisps_bindings.cpp`) expose a flat C API compiled via Emscripten:

| Function | Purpose |
|----------|---------|
| `nisps_mlp_create/destroy` | Lifecycle |
| `nisps_mlp_inference` | Single forward pass |
| `nisps_mlp_infer_batch` | N forward passes in one call (heatmap) |
| `nisps_mlp_train` | SGD training, returns final loss only |
| `nisps_mlp_train_ex` | SGD training with full per-iteration loss curve |
| `nisps_mlp_draw_weights_spread` | Xavier-aware weight randomization |
| `nisps_mlp_move_weights_spread` | RL noise with weight decay |
| `nisps_mlp_move_weights_ex` | Same + native output pin mask |
| `nisps_mlp_eval_loss` | Forward pass + MSE, no weight update |
| `nisps_mlp_get_layer_stats` | Per-layer: mean|w|, max|w|, dead%, saturating% |
| `nisps_mlp_get/set_weights` | Flat weight serialization |
| `nisps_mlp_weight_count` | Total weight count |

**Building the WASM:**
```bash
cd playground/wasm && ./build.sh   # requires emcc (Emscripten)
```

**Key difference from JS engine:** WASM uses float32 (not float64). The `spread`-aware `drawWeights`/`moveWeights` functions are implemented in the bindings file, not in nisps-core proper — they're playground-specific.

**Known issue:** Both the C++ `Train()` and WASM `train_ex` double-scale the loss when no sample weights are provided (each sample loss is weighted by 1/n, then the sum is multiplied by 1/n again). This is a backward-compat pattern from the C++ core (meml-ues).

### Debug Probe

The immersive app exposes `window.__nisps` when loaded with `?debug=1`. Used by Playwright e2e tests. Zero footprint in production.

| Method | Returns |
|--------|---------|
| `getOutputs()` | Current 126-element output vector |
| `getLoss()` | Last training loss (or null) |
| `getWeights()` | Flat weight array (~13K floats) |
| `getExampleCount()` | Number of training examples |
| `setInputs(x, y)` | Set joystick position + run inference |
| `thumbsUp()` / `thumbsDown()` | Trigger RL feedback |
| `train()` | Sync training with full UI update |
| `trainAsync()` | Async training (returns Promise) |
| `randomise()` | Randomize weights |
| `clearExamples()` | Clear dataset |
| `saveState()` | Force localStorage save |
| `evalLoss()` | Non-destructive loss query |
| `inferBatch(points)` | Batch inference |
| `getLayerStats()` | Per-layer weight health |

### URL Parameters

| Param | Range | Default | Effect |
|-------|-------|---------|--------|
| `tame` | 0–1 | 1 | Constrains synth output ranges toward safe limits |
| `spread` | 0–1 | 0.6 | Controls weight initialization, RL noise scaling, and weight decay (see below) |
| `preset` | preset id | _(none)_ | Auto-loads a synth parameter preset on first visit (e.g. `?preset=beginner-1`) |

#### `spread` — sigmoid saturation control

The MLP uses ReLU hidden layers with a sigmoid output layer. With uniform [-1,1] weights, the sum of many weighted inputs at each layer drives sigmoid pre-activations far from zero (std dev ≈ √fan_in), causing outputs to saturate near 0 or 1. The `spread` parameter addresses this:

- **`spread=0`** (polarised): Weights drawn from uniform [-1,1]. RL noise cap = 0.3. Noise applied uniformly across layers. Outputs cluster at extremes — good for exploration of radical mappings.
- **`spread=1`** (centered): Weights scaled by 1/√fan_in per layer (Xavier initialization). RL noise cap = 0.05. Noise also scaled per-layer. Weight decay prevents magnitude drift. Outputs spread across the full [0,1] range — better for fine-grained RL shaping.
- **Intermediate values** interpolate linearly between these two regimes.

Affects four code paths:
1. **`drawWeights(spread)`** — initial randomisation weight scale
2. **`moveWeights(speed, spread)`** — RL exploration noise scale per layer
3. **Weight decay in `moveWeights`** — each call decays weights by `10% * spread` before adding noise, preventing unbounded magnitude drift from repeated thumbs-down. At spread=0 there is no decay (original behavior). At spread=1, weights decay ~10% per call, creating a natural equilibrium where exploration noise and decay balance out rather than weights growing until sigmoid permanently saturates.
4. **Noise cap** in thumbs-down handler — `0.3*(1-spread) + 0.05*spread`

### C15 Parameter Map

The 126 synth parameters in `js/synth/param-map.js` were curated from the C15's 287 total parameters. Excluded categories:

| Excluded | Count | Reason |
|----------|-------|--------|
| Hardware Amount/Source | 56 | No physical MIDI hardware in browser |
| Macro Controls/Times | 12 | Meta-routing layer conflicts with direct ML control |
| Scale offsets | 13 | Microtuning would break pitch unpredictably |
| Key tracking (`*_KT`) | 11 | Pitch-dependent scaling needs calibrated defaults |
| Velocity (`*_Vel`) | 11 | Velocity-dependent, ML can't observe key velocity |
| Envelope mod depths (`*_Env_A/B/C`) | 19 | Multiplicative interaction with envelope shapes makes space too hard to learn |
| Discrete/structural | 15 | Osc Pitch (full sweep), Master Vol/Tune, Voice Mute/Fade, Unison Voices, Mono modes, Split, Osc Reset |
| Secondary config | 7 | Att Curve, Elevate, Chirp, Decay Gate, Retrigger |
| PM shaper blend | 4 | Secondary routing params |
| FB Mix source selects | 4 | Discrete A/B selectors |

### Synth Presets

Presets (`js/synth/presets.js`) control which parameters the ML engine can modify, with unselected params muted at safe defaults. Each preset defines per-param `{ muted, fixedValue, min, max, curve }` — no training examples or model weights.

4 tiers of progressive complexity:

| Tier | Presets | Active params | What's exposed |
|------|---------|---------------|----------------|
| 1 (Beginner) | 1.1–1.4 | 15 | Basic ADSR, SVF cutoff/res, Shaper A drive/fold, output levels, reverb mix |
| 2 (Intermediate) | 2.1–2.4 | 40 | + Env B/C, filter FM, effects (reverb/echo/flanger), cabinet, stereo panning |
| 3 (Advanced) | 3.1–3.3 | ~95 | + Cross-oscillator PM, feedback mixer, dual shapers, comb/gap filters, ring mod |
| 4 (Expert) | 4.1–4.2 | 126 | Full engine |

Presets use `curve` values to bias parameter distributions (< 0.5 = spend more time low, > 0.5 = bias high) without clamping extremes. Users can tweak any preset via the group drawer after loading.

### Control Surface (Phase 1)

The immersive app (`a-immersive.html`) has a control surface system for tuning how exploration and learning feel. Full spec: `playground/SPEC-controls.md`.

**Architecture** — modular ES modules organized by phase, wired into `a-app.js`:

| Module | Phase | Purpose |
|--------|-------|---------|
| `js/ui/input-pipeline.js` | 1 | Processes raw joystick input through deadzone → zoom → curve → smoothing → momentum-as-zoom. Pure math, no DOM. |
| `js/ui/control-surface.js` | 1 | Compound axes (Boldness, Memory, Precision) that map single sliders to multiple underlying params. Offset-based override resolution (trim-pot model). 6 built-in control presets. |
| `js/ui/control-surface-ui.js` | 1 | DOM layer: 3 axis sliders on floating bar, gear icon settings drawer with per-param overrides. Injects its own CSS. |
| `js/ui/joy-map-enhanced.js` | 1 | Enhanced joy-map canvas: zoom minimap with adaptive grid, vanishing trail with Catmull-Rom spline and tap-to-return, dual concentric noise rings, frozen state overlay. |
| `js/ui/snapshot-stack.js` | 2 | Ring buffer (20 max) of weight snapshots. Auto-snapshot on train/randomize/thumbs-down. Multi-level undo. |
| `js/ui/ab-compare.js` | 2 | Rapid A/B weight state comparison. Capture, toggle, accept or revert. |
| `js/ui/region-pin.js` | 2 | Pins rectangular input-space regions (Approach A: example pinning). Pinned examples always included in training. |
| `js/ui/param-pin.js` | 2 | Per-output pin flags. Pin mask passed to `moveWeights()` to skip pinned output nodes. |
| `js/ui/phase2-ui.js` | 2 | DOM: undo button with history popup, A/B toggle, region pin via long-press, param pin via double-tap. |
| `js/ui/pressure-feedback.js` | 3 | Touch force + hold duration → intensity multiplier for noise growth/decay. |
| `js/ui/auto-explore.js` | 3 | Automated thumbs-down at configurable interval. Zoom-scaled intensity. |
| `js/ui/input-heatmap.js` | 3 | 2D color field sampling MLP across input space. 3 color modes, zoom-aware resampling. Supports `inferBatchFn` for single-call WASM batch inference. |
| `js/ui/phase3-ui.js` | 3 | DOM: auto-explore toggle with progress ring, heatmap eye icon, pressure indicators. |
| `js/ui/output-pipeline.js` | 4 | Global curve → smoothing → slew rate → freeze gate on MLP outputs before synth/visual routing. |
| `js/ui/weight-health.js` | 4 | Weight magnitude histogram, dead/saturating/healthy status detection, ambient visualization. |
| `js/ui/gradient-flow.js` | 4 | Per-layer weight-delta analysis after training. Vanishing/exploding/converged detection. |
| `js/ui/session-presets.js` | 4 | Save/load full session state. URL sharing via compact params. |
| `js/ui/phase4-ui.js` | 4 | DOM: freeze button, network health panel, session preset UI, output pipeline slider wiring. |

**Compound Axes** — each controls 4-6 underlying parameters via interpolation tables:

- **Boldness** (Caution ↔ Bold): input zoom, noise cap, noise growth, learning rate, weight decay, noise distribution
- **Memory** (Amnesia ↔ Elephant): max examples, example decay, weight decay, noise decay, convergence threshold
- **Precision** (Raw ↔ Precise): input curve, deadzone, smoothing, slew rate, momentum-zoom mode

When a user manually overrides an individual param, the offset from the axis-derived value persists as the axis moves (like a trim pot on a mixing desk). Double-tap an axis to re-link all params.

**Input Pipeline** — sits between physical joystick and MLP. Key feature: **zoom** narrows the effective input window around an anchor point (`effective = anchor + (raw - 0.5) * zoom_level`). Zoom-at-zero freezes input. Three anchor modes: auto (anchor follows current position when zoom changes), sticky (explicit anchor), center (always 0.5).

**Control Presets**: Default, First Touch, Jazz Hands, Sculptor, Improviser, Microscope. These set compound axis positions — they don't include network weights or synth preset selection.

**Integration** — the control surface dispatches `controlsurface:change` CustomEvents. `a-app.js` listens and updates the input pipeline config, spread level, and RL parameters (noise cap, growth, decay, floor, zoom-aware feedback scaling). Pipeline-processed coordinates are cached (`_lastPipeX/Y`) so `getCurrentInputs()` and `setCurrentInputs()` use the same values the MLP sees. State is persisted to localStorage alongside existing app state.

**Remaining**: Engine configuration panel (Part 8 of spec) — network architecture, loss function, optimizer selection.

## Testing

Playwright e2e tests cover the immersive app's ML engine, UI state machines, input pipeline, and persistence. Tests run headless Chromium against a Python HTTP server.

```bash
# Run all tests (starts server automatically on port 7331)
npx playwright test

# Run with browser visible
npx playwright test --headed

# Run a specific test file
npx playwright test tests/e2e/ml-engine.spec.js
```

**Test files** (`tests/e2e/`):

| File | Coverage |
|------|----------|
| `ml-engine.spec.js` | WASM inference bounds, training loss, thumbs up/down, async training, example capture |
| `ui-interactions.spec.js` | Drawer open/close, mode switching, heatmap bars, presets, keyboard shortcuts (1/2/Z) |
| `input-pipeline.spec.js` | Input→output variation, clamping, joystick drag, post-training bounds |
| `persistence.spec.js` | URL params (?preset, ?spread), localStorage round-trip |
| `wasm-api.spec.js` | Batch inference, evalLoss, getLayerStats, loss history curve, pin mask |

Tests use the `?debug=1` probe (`window.__nisps`) for programmatic access to the ML engine. The `helpers.js` module provides `loadApp(page)` which clears localStorage, sets `nisps-help-seen`, and waits for WASM initialization.

## Build System

This is an Arduino project targeting Raspberry Pi Pico. Build and upload using Arduino IDE or arduino-cli with the earlephilhower/pico board package.

```bash
# Initialize submodules (required for memllib and memlp)
git submodule update --init --recursive

# Build (adjust port as needed)
arduino-cli compile --fqbn rp2040:rp2040:rpipico -b 115200 MEMLNaut-NISPS.ino
arduino-cli upload --fqbn rp2040:rp2040:rpipico -p /dev/ttyACM0 MEMLNaut-NISPS.ino
```

## Architecture

### Dual-Core Design

The RP2040's dual cores are used for separation of concerns:
- **Core 0**: UI loop, ML inference, hardware interface polling (5ms period)
- **Core 1**: Real-time audio processing, parameter updates, MIDI polling

Inter-core synchronization uses memory barriers (`MEMORY_BARRIER()`, `WRITE_VOLATILE()`, `READ_VOLATILE()`) and RP2040 queues (`queue_t`).

### Mode System

The active mode is selected at compile-time via `#define MEMLNAUT_MODE_TYPE` in `MEMLNaut-NISPS.ino`. Modes implement the `MEMLNautMode` concept (see `modes/MEMLNautMode.hpp`):

| Mode | Purpose |
|------|---------|
| `MEMLNautModeChannelStrip` | Audio channel strip (EQ, compression, gain staging) |
| `MEMLNautModePAFSynth` | PAF (Phase Aligned Formant) synthesis with MIDI |
| `MEMLNautModeXIASRI` | Audio-reactive mode using machine listening analysis |
| `MEMLNautModeSoundAnalysisMIDI` | Sound analysis with MIDI output |

### Voice Spaces

Voice spaces map ML output parameters to audio engine parameters. They are defined as lambda functions that translate a normalized parameter array into synthesizer/processor settings. See `voicespaces/` for examples:
- PAF synth presets: `VoiceSpace1.hpp`, `VoiceSpaceQuadDetune.hpp`, etc.
- Channel strip presets: `voicespaces/ChannelStrip/basic.hpp` (Neve, SSL emulations)

### Key Components

- **IMLInterface** (`IMLInterface.hpp`): Interactive ML interface using an MLP for inference/training
- **InterfaceRL**: Reinforcement learning interface from memllib that handles joystick input and learning
- **AudioAppBase**: Template base class for audio applications
- **XiasriAnalysis**: Real-time audio feature extraction (pitch, aperiodicity, energy, brightness)

### Submodules (in `src/`)

- **memllib**: Hardware abstraction, audio drivers, synth components, RL interfaces
- **memlp**: MLP (Multi-Layer Perceptron) implementation for embedded ML
- **daisysp**: DSP library (filters, drums, effects, synthesis)

## Memory Sections

The codebase uses RP2040-specific memory placement:
- `AUDIO_MEM` / `AUDIO_FUNC`: Place audio-critical code/data in SRAM
- `APP_SRAM` / `__not_in_flash("app")`: Keep frequently-accessed data out of flash

## Audio Parameters

Sample rate is defined in `AudioDriver::GetSampleRate()`. The audio callback `audio_block_callback` runs on Core 1 and processes stereo audio (`stereosample_t`).
