# MEMLNaut for VCV Rack

MEMLNaut is a CV-to-CV mapper powered by a neural network that you train in real time using
reinforcement learning. Patch any CV sources into its 8 inputs, connect its 16 outputs to your
synth parameters, and shape the mapping by giving thumbs-up/thumbs-down feedback. The module
learns your preferences, producing complex, nonlinear modulation that evolves with your taste.
It does not generate sound itself -- it generates control voltages.

## Installation

MEMLNaut is built from source against the VCV Rack 2 SDK. Pre-built `.vcvplugin` bundles are
published at https://meml.lnfinitemonkeys.org/next/vcv/ (locally-built bundles land in the
git-ignored `dist/`; see `DISTRIBUTION.md`).

### Requirements

- VCV Rack 2 (Community Edition or Pro)
- VCV Rack SDK (v2.x)
- C++20 compiler (GCC 10+, Clang 12+, or MSVC 2019+)
- GNU Make

### Build

```bash
git clone --recursive https://github.com/monkey-w1n5t0n/MEMLNaut-NISPS.git
cd MEMLNaut-NISPS/vcv

# Point to your Rack SDK (or set in environment)
export RACK_DIR=/path/to/Rack-SDK

make
make install   # copies plugin to your VCV Rack plugins directory
```

The default `RACK_DIR` is `~/.local/share/Rack2/Rack-SDK`. If your SDK lives there, you can skip
the export.

The ML engine is the repository's shared `nisps/` C++20 core, reached via relative includes from
`src/iml.hpp` -- the plugin must be built from a full repo checkout. See `BUILDING.md`.

## Quick Start

1. Add **MEMLNaut** from the module browser.
2. Patch LFOs (or any CV source) into one or more of the 8 **IN** jacks.
3. Connect several of the 16 outputs to parameters on your synth voice -- filter cutoff,
   oscillator pitch, waveshape, VCA level, etc.
4. Press **RAND** to randomize the network. You should hear your synth respond as the LFOs sweep.
5. Flip the **LEARN** switch on.
6. When you hear something you like, press **+** (thumbs up). When you hear something you
   dislike, press **-** (thumbs down).
7. Keep exploring. The mapping will converge toward sounds you prefer.

## Panel Controls

### Knobs

| Control | Description |
|---------|-------------|
| **SPREAD** | Controls weight initialization scale, RL noise amplitude, and weight decay. Low values produce extreme, polarized mappings. High values produce balanced, subtle mappings. Default: 60%. |
| **RATE** | Inference rate. Full CCW = ~170 Hz (block rate, cheapest). Noon = ~2.8 kHz (good for CV). Full CW = 44.1 kHz (audio rate, most expensive). |

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
| **IN 1-8** | CV inputs feeding the 8-input network. Default range: 0-10V (unipolar); per-input bipolar toggle in the context menu. |
| **SPREAD CV** | CV modulation of the SPREAD knob (added to knob value, 0-10V). |
| **LEARN** | Gate input. High = enable learning. Works alongside the LEARN toggle (either enables it). |
| **+ TRIG** | Trigger input for thumbs-up. Alternative to pressing the + button. |
| **- TRIG** | Trigger input for thumbs-down. Alternative to pressing the - button. |

### Outputs

| Port | Description |
|------|-------------|
| **OUT 1-16** | Raw MLP outputs. Default: 0-10V unipolar (per-output bipolar toggle in the context menu). |

Each output has a **trimpot attenuverter** (-100% to +100%) for scaling and inverting individual
outputs without external modules, and is surrounded by an **LED ring** whose arc fill tracks the
output's current level (color-coded per output, orange-to-cyan ramp).

### LEDs & Display

| Indicator | Meaning |
|-----------|---------|
| **LEARN** (green) | Lit when learning is enabled. |
| **TRAIN** (yellow) | Flashes during background training. |
| **Output LED rings** | Arc fill tracks each output's current level. |

The built-in display shows all 16 output levels as color-coded bars, the current noise level
(N:), the example count (e.g. `42/100`), and "TRAIN" during active training.

## RL Workflow

The reinforcement learning loop works like this:

1. **Start exploring.** Patch LFOs or sequencers into the IN jacks. Connect outputs to
   interesting synth parameters. Press RAND a few times to hear different random mappings.

2. **Enable learning.** Flip the LEARN switch on (or send a gate to the LEARN input).

3. **Thumbs up (+)** when you like what you hear. This:
   - Saves the current input position and output values as a training example
   - Trains the network to reproduce this mapping
   - Slightly reduces exploration noise (the network becomes more "settled")

4. **Thumbs down (-)** when you dislike what you hear. This:
   - Increases exploration noise
   - Perturbs the network weights to try a different mapping
   - Does NOT save any training example

5. **Repeat.** Over time, the network learns to produce outputs you tend to like across the
   input space. Regions near your thumbs-up examples will be stable; distant regions remain
   exploratory.

6. **Disable learning** when you are happy with the mapping. The module continues running
   inference with the trained network. You now have a complex, personalized CV source.

### Tips

- Give thumbs-up at several different input positions to teach the network about different
  regions of the input space.
- The network holds up to 100 examples. Oldest examples are dropped when full (FIFO).
- Use the SPREAD knob to control how wild the exploration is. Low spread = dramatic changes.
  High spread = subtle refinements.

## Context Menu

Right-click the module to access these settings:

- **Output ranges** -- toggle each of the 16 outputs between unipolar (0-10V, default) and
  bipolar (+/-5V).
- **Input ranges** -- toggle each of the 8 inputs between unipolar (0-10V, default) and bipolar
  (+/-5V). Set to bipolar if your source produces +/-5V signals (e.g., standard LFOs).
- **Compute derived stats (Mean/Std/Delta)** -- internal statistics toggle (no dedicated output
  jacks in the current module).
- **Output slew** -- smoothing time applied when network weights change (after training or
  perturbation). Prevents clicks from sudden output jumps. Options: 0, 5, 10, 20, 50, 100 ms.
  Default: 10 ms.
- **Presets (.nisps)** -- save/load the full module state (weights, training examples, knob
  positions, ranges) to/from a `.nisps` JSON file.
- **Browser bridge (WS<->OSC)** -- enable the OSC server for the companion browser app; choose
  the listen port (7001, 7002, 7003, 9000, 9001).

## Presets (.nisps)

MEMLNaut uses `.nisps` files for saving and sharing trained networks. The format (version 3,
flat core-exact weight vector) is specified in `docs/specs/vcv-module.md` -- the single source of
truth. Files saved by pre-2026-07 builds (version 1, nested weight arrays) no longer load.

Full module state is also saved automatically with your VCV Rack patch file; you do not need
`.nisps` exports to preserve work between sessions.

## Browser Integration (Manifold)

MEMLNaut can be driven live from the Manifold browser app (`manifold/`, VCV backend) over a
WebSocket-to-OSC bridge (`manifold/osc-bridge/bridge.ts`, Deno).

1. Right-click the module and enable **OSC server** (default port 7001; each module instance
   offsets its default port automatically).
2. Run the bridge with `--osc-port` matching the module's port.
3. In Manifold, select the VCV backend.

What flows over the wire (the complete protocol -- see `docs/specs/vcv-module.md`):

| OSC Address | Direction | Content |
|-------------|-----------|---------|
| `/nisps/input` | Web -> VCV | Input vector (browser drives the model: "bridged mode") |
| `/nisps/output` | VCV -> Web | Current output values (~10 times/sec) |
| `/nisps/input` | VCV -> Web | Current input values (~10 times/sec) |
| `/nisps/feedback` | Web -> VCV | Verdict ops (up / down / rand / clear) |

Training is bidirectional: both the browser verdict loop and the module's panel buttons drive
the same network. There is no weight/state sync channel -- persistence belongs to the Rack patch.

## Technical Details

### Network architecture

```
Inputs:  8
Hidden:  16 -> 24 -> 16  (3 hidden layers, ReLU activation)
Output:  16 (sigmoid activation, producing values in [0, 1])
```

The ML engine is the repository's shared `nisps/` core
(`nisps::ml::MLPCore<DynamicStorage>` behind the thin adapter `src/iml.hpp`) -- bit-identical
training/inference semantics to the MEMLNaut firmware and the browser WASM engine.

### Inference

The MLP runs in the VCV `process()` callback. The RATE knob controls how often inference runs,
from once per 256 samples (~170 Hz) to every sample (44.1 kHz). Between inference steps, outputs
are linearly interpolated to avoid staircase artifacts.

### Threading

- **Audio thread**: Reads CV inputs, runs MLP inference, writes CV outputs. Never blocks.
- **Worker thread**: Handles training (thumbs-up) and weight perturbation (thumbs-down). When
  complete, signals the audio thread to crossfade to the new outputs.
- Each module instance has its own independent worker thread and ML engine.

## Building

See `BUILDING.md` (build steps, troubleshooting) and `DISTRIBUTION.md` (packaging `.vcvplugin`
bundles, cross-platform builds).

### Project structure

```
vcv/
  Makefile          # Build configuration (C++20; core via relative includes)
  plugin.json       # Plugin manifest (name, version, tags)
  src/
    plugin.cpp      # Plugin initialization
    plugin.hpp      # Plugin globals
    MEMLNaut.cpp    # Module logic, widget/UI, serialization, OSC wiring
    iml.hpp         # Thin adapter over the shared nisps/ ML core
    osc_server.hpp  # OSC bridge server (transport only)
    LedRing.hpp     # Per-output LED ring widget
    palette.hpp     # Color palette from the frontend design tokens
  res/
    MEMLNaut-wide.svg      # 44HP panel (the one the module loads)
    MEMLNaut.svg           # Unused 30HP variant
    MEMLNaut-expander.svg  # Unused 8HP expander panel
  dist/             # Built .vcvplugin bundles
  dep/              # Build dependencies
```
