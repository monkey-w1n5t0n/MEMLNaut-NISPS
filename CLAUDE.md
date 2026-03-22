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

The `playground/` directory contains a browser-based interactive demo of the NISPS ML engine. It's a faithful JavaScript port of nisps-core's MLP + IML, with no build step or dependencies.

- **2 inputs** (virtual joystick X/Y) mapped through a `[3, 32, 48, 64, 126]` MLP to **126 outputs**
- **Two output modes**:
  - **Visual**: first 20 outputs control a Canvas2D flow-field particle system
  - **Synth (C15)**: all 126 outputs control the C15 WASM synthesizer — every sonically meaningful continuous parameter across envelopes, oscillators, shapers, filters, feedback/output mixers, cabinet, and effects
- **Two learning modes**: Examples (set slider targets, add examples, train) and RL Feedback (thumbs up/down with exploration noise)
- **Serve statically**: `cd playground && python3 -m http.server`
- **Mobile-first**: designed for touch/foldable phone use

Key files: `js/nisps/` (ML core port), `js/ui/` (visualizer, joystick, controls), `js/synth/` (C15 bridge, param map, arpeggiator), `js/app.js` (wiring).

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
