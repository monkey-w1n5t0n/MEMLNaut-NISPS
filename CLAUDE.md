# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

MEMLNaut-NISPS (Neural Interactive Shaping of Parameter Spaces) is firmware for the MEMLNaut hardware platform - a custom embedded audio device built on Raspberry Pi Pico (RP2040). It implements interactive machine learning for real-time audio synthesis and processing, enabling users to shape sound parameters through reinforcement learning.

Project documentation: https://musicallyembodiedml.github.io/memlnaut/approaches/nisps

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
