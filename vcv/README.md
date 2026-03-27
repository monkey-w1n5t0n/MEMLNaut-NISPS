# MEMLNaut for VCV Rack

MEMLNaut is a CV-to-CV mapper powered by a neural network that you train in real time using reinforcement learning. Patch any CV sources into its 2 inputs, connect its 12 outputs to your synth parameters, and shape the mapping by giving thumbs-up/thumbs-down feedback. The module learns your preferences, producing complex, nonlinear modulation that evolves with your taste. It does not generate sound itself -- it generates control voltages.

## Installation

MEMLNaut is built from source against the VCV Rack 2 SDK.

### Requirements

- VCV Rack 2 (Community Edition or Pro)
- VCV Rack SDK (v2.x)
- C++20 compiler (GCC 10+, Clang 12+, or MSVC 2019+)
- GNU Make

### Build

```bash
git clone --recursive https://github.com/MusicallyEmbodiedML/MEMLNaut-NISPS.git
cd MEMLNaut-NISPS/vcv

# Point to your Rack SDK (or set in environment)
export RACK_DIR=/path/to/Rack-SDK

make
make install   # copies plugin to your VCV Rack plugins directory
```

The default `RACK_DIR` is `~/.local/share/Rack2/Rack-SDK`. If your SDK lives there, you can skip the export.

The `nisps-core` headers (the ML engine) are included in the parent repository and referenced automatically via the Makefile.

## Quick Start

1. Add **MEMLNaut** from the module browser (under Controller / Utility).
2. Patch two LFOs (or any CV source) into the **X** and **Y** inputs.
3. Connect several of the 12 outputs to parameters on your synth voice -- filter cutoff, oscillator pitch, waveshape, VCA level, etc.
4. Press **RAND** to randomize the network. You should hear your synth respond as the LFOs sweep.
5. Flip the **LEARN** switch on.
6. When you hear something you like, press **+** (thumbs up). When you hear something you dislike, press **-** (thumbs down).
7. Keep exploring. The mapping will converge toward sounds you prefer.

## Panel Controls

### Knobs

| Control | Description |
|---------|-------------|
| **SPREAD** | Controls weight initialization scale, RL noise amplitude, and weight decay. Low values produce extreme, polarized mappings. High values produce balanced, subtle mappings. Default: 60%. |
| **RATE** | Inference rate. Full CCW = ~170 Hz (block rate, cheapest). Noon = ~2 kHz (good for CV). Full CW = 44.1 kHz (audio rate, most expensive). |

### Buttons

| Control | Description |
|---------|-------------|
| **+** | Thumbs up. Captures the current input/output pair as a training example and trains the network. Requires LEARN to be enabled. |
| **-** | Thumbs down. Increases exploration noise and perturbs the network weights to try something different. Requires LEARN to be enabled. |
| **LEARN** | Toggle switch. Enables/disables RL feedback. When off, the module still runs inference -- it just ignores +/- presses. |
| **RAND** | Randomize all network weights (using current SPREAD setting). |
| **CLEAR** | Long-press (~1 second) to clear all training examples and reset the network. |

### Inputs

| Port | Description |
|------|-------------|
| **X** | Primary CV input. Default range: 0-10V (unipolar). |
| **Y** | Secondary CV input. Default range: 0-10V (unipolar). |
| **SPREAD CV** | CV modulation of the SPREAD knob (added to knob value, 0-10V). |
| **LEARN** | Gate input. High = enable learning. Works alongside the LEARN toggle (either enables it). |
| **+ TRIG** | Trigger input for thumbs-up. Alternative to pressing the + button. |
| **- TRIG** | Trigger input for thumbs-down. Alternative to pressing the - button. |

### Outputs

| Port | Description |
|------|-------------|
| **OUT 1-12** | Raw MLP outputs, each with its own attenuverter trimpot and LED. Default: 0-10V unipolar. |
| **MEAN** | Mean of the 12 raw outputs (0-10V). |
| **STD** | Standard deviation of the 12 raw outputs (0-10V). |
| **DELTA** | Rate of change across all outputs (L2 norm of frame-to-frame difference). |
| **NOVELTY** | How far the current input is from any training example. 10V when untrained, drops as you add examples near the current position. |
| **CONFIDENCE** | Inverse of novelty. 0V when untrained, rises as examples accumulate near the current input. |

Each of the 12 raw outputs has a **trimpot attenuverter** (-100% to +100%) for scaling and inverting individual outputs without external modules.

### LEDs

| LED | Meaning |
|-----|---------|
| **LEARN** (green) | Lit when learning is enabled. |
| **TRAIN** (yellow) | Flashes during background training. |
| **Output LEDs** (white) | Brightness tracks each output's current level. |

### Display

The built-in bar graph shows all 12 output levels in real time, color-coded by output index. The top-left corner shows the current noise level (N:). "TRAIN" appears in the top-right during active training.

## RL Workflow

The reinforcement learning loop works like this:

1. **Start exploring.** Patch LFOs or sequencers into X and Y. Connect outputs to interesting synth parameters. Press RAND a few times to hear different random mappings.

2. **Enable learning.** Flip the LEARN switch on (or send a gate to the LEARN input).

3. **Thumbs up (+)** when you like what you hear. This:
   - Saves the current input position and output values as a training example
   - Trains the network to reproduce this mapping
   - Slightly reduces exploration noise (the network becomes more "settled")

4. **Thumbs down (-)** when you dislike what you hear. This:
   - Increases exploration noise
   - Perturbs the network weights to try a different mapping
   - Does NOT save any training example

5. **Repeat.** Over time, the network learns to produce outputs you tend to like across the input space. Regions near your thumbs-up examples will be stable; distant regions remain exploratory.

6. **Disable learning** when you are happy with the mapping. The module continues running inference with the trained network. You now have a complex, personalized CV source.

### Tips

- Give thumbs-up at several different input positions to teach the network about different regions of the input space.
- The network holds up to 100 examples. Oldest examples are dropped when full (FIFO).
- Use the SPREAD knob to control how wild the exploration is. Low spread = dramatic changes. High spread = subtle refinements.
- The NOVELTY and CONFIDENCE outputs are useful for self-patching: route NOVELTY to control something that signals "unexplored territory."

## Context Menu

Right-click the module to access these settings:

### Output Ranges

Toggle each output between **unipolar (0-10V)** and **bipolar (+/-5V)**. Default is unipolar. Use bipolar for parameters that expect centered modulation (e.g., FM depth, panning).

### Input Ranges

Toggle each input between **unipolar (0-10V)** and **bipolar (+/-5V)**. Default is unipolar. Set to bipolar if your input source produces +/-5V signals (e.g., standard LFOs).

### Output Slew

Smoothing time applied when network weights change (after training or perturbation). Prevents audible clicks from sudden output jumps. Options: 0, 5, 10, 20, 50, 100 ms. Default: 10 ms.

### Presets (.nisps)

- **Save .nisps preset...** -- Export the full module state (weights, training examples, knob positions, ranges) to a `.nisps` JSON file.
- **Load .nisps preset...** -- Import a `.nisps` file, restoring the network and all settings.

### OSC Bridge

- **Enable OSC server** -- Start a UDP/WebSocket OSC server for live communication with the companion web app.
- **OSC listen port** -- Choose the port (default 9000). Change this if running multiple MEMLNaut instances.

## Presets

MEMLNaut uses `.nisps` files for saving and sharing trained networks.

### What gets saved

- All network weights (the learned mapping)
- All training examples (input/output pairs from thumbs-up)
- Knob positions (SPREAD, RATE, attenuverters)
- Input/output range settings
- Noise level and slew time

### Saving and loading

1. Right-click the module.
2. Under "Presets (.nisps)", choose **Save** or **Load**.
3. Pick a location and filename.

### Sharing between VCV and the web playground

The `.nisps` format is shared with the [NISPS web playground](https://musicallyembodiedml.github.io/memlnaut/). However, the VCV module and web app use different network architectures (VCV: 12 outputs, web: 126 outputs), so weights are not directly transferable between them. Training examples and configuration metadata are preserved for reference. The `mlpConfig.layers` field in the file lets each loader detect architecture mismatches.

### Patch save/load

Full module state is also saved automatically with your VCV Rack patch file. You do not need to manually export `.nisps` files to preserve your work between sessions.

## OSC Integration

MEMLNaut can communicate with the companion web app over OSC for live, bidirectional state sync.

### Setup

1. Right-click the module and enable **OSC server** (default port 9000).
2. In the web playground, open the OSC connection panel and connect to `localhost:9000`.
3. The web app connects via a WebSocket-to-OSC bridge.

### What syncs

| OSC Address | Direction | Content |
|-------------|-----------|---------|
| `/nisps/outputs` | VCV -> Web | Current output values (~10 times/sec) |
| `/nisps/inputs` | VCV -> Web | Current input values (~10 times/sec) |
| `/nisps/weights` | Both | Full weight transfer |
| `/nisps/state` | Both | Complete state sync (weights + examples + config) |

### Multiple instances

Each MEMLNaut instance needs its own OSC port. Use the port selector in the context menu (9000, 9001, 9002, 8000, 7000) to avoid conflicts.

## Technical Details

### Network architecture

The module uses a multi-layer perceptron (MLP) with the following default architecture:

```
Inputs:  2 (+ 1 bias = 3 input nodes)
Hidden:  16 -> 24 -> 16  (3 hidden layers, ReLU activation)
Output:  12 (sigmoid activation, producing values in [0, 1])
```

### Inference

The MLP runs in the VCV `process()` callback. The RATE knob controls how often inference runs, from once per audio block (~170 Hz) to every sample (44.1 kHz). Between inference steps, outputs are linearly interpolated to avoid staircase artifacts.

### Threading

- **Audio thread**: Reads CV inputs, runs MLP inference, writes CV outputs. Never blocks.
- **Background thread**: Handles training (thumbs-up) and weight perturbation (thumbs-down). When complete, signals the audio thread to crossfade to the new outputs.
- Each module instance has its own independent background thread and ML engine.

### Performance

The default network is small (~20 KB of weights). At block-rate inference, CPU usage is negligible. At audio-rate inference with all 12 outputs patched, expect moderate CPU usage comparable to a complex oscillator module. Multiple instances scale linearly.

## Building

### Full build commands

```bash
cd vcv
export RACK_DIR=/path/to/Rack-SDK
make              # build the plugin
make install      # install to VCV plugins directory
make clean        # remove build artifacts
```

### SDK setup

1. Download the VCV Rack SDK from https://vcvrack.com/manual/PluginDevelopmentTutorial
2. Extract it somewhere (e.g., `~/Rack-SDK`)
3. Set `RACK_DIR` to that path, or place it at `~/.local/share/Rack2/Rack-SDK`

### Project structure

```
vcv/
  Makefile          # Build configuration
  plugin.json       # Plugin manifest (name, version, tags)
  src/
    plugin.cpp      # Plugin initialization
    plugin.hpp      # Plugin globals
    MEMLNaut.cpp    # Module logic, UI, serialization
    osc_server.hpp  # OSC bridge server
  res/
    MEMLNaut.svg    # Panel artwork
  dep/              # Build dependencies
```

### Dependencies

- **VCV Rack SDK** (v2.x) -- provides the module framework
- **nisps-core** -- header-only C++20 ML library (included in the parent repo at `../nisps-core/`)

No external package manager dependencies are required. The nisps-core headers are referenced directly from the Makefile.
