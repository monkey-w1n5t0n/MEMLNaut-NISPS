# MEMLNaut VCV Rack Module — Specification

## Overview

A VCV Rack module that embeds the NISPS interactive ML engine (nisps-core C++ library) as a CV-to-CV mapper. Users explore high-dimensional parameter spaces via reinforcement learning feedback, producing 12 raw CV outputs and 5 derived meta-signals from configurable CV inputs.

The module does **not** produce sound. It maps input CVs through a trained neural network to output CVs, which the user patches into other modules (VCOs, VCFs, VCAs, etc.). The result: a learned, nonlinear, high-dimensional modulation source shaped by the user's aesthetic preferences.

**Plugin name:** MEMLNaut
**Module name:** MEMLNaut (initially single module, future modules possible)
**License:** Proprietary / undecided (will not be submitted to VCV Library initially)
**Target:** VCV Rack 2 (primary), VCV Rack Free v1 (compatibility where feasible)

---

## Architecture

### Core Stack

```
┌─────────────────────────────────────┐
│          VCV Module (UI + I/O)      │
│  Panel, knobs, ports, display       │
├─────────────────────────────────────┤
│        VCV process() callback       │
│  Reads CV inputs, writes CV outputs │
│  Decimated inference trigger        │
├─────────────────────────────────────┤
│         nisps-core (C++20)          │
│  IML → MLP → forward inference     │
│  Background thread: training        │
├─────────────────────────────────────┤
│          State Manager              │
│  Serialize/deserialize weights,     │
│  examples, config to JSON           │
└─────────────────────────────────────┘
```

### Threading Model

- **Audio thread** (`process()`): Reads input CVs, runs MLP inference (decimated), writes output CVs. Never blocks.
- **Background thread**: Handles training (SGD/RMSProp). On completion, atomically swaps weight buffer into the inference path.
- **Widget thread**: Draws UI, handles user interaction (buttons, knobs). Reads output values for display.

Weight double-buffering: inference reads from buffer A while training writes to buffer B. Atomic pointer swap on training completion.

---

## I/O Specification

### Inputs (Configurable: 2–8, default 2)

| Port | Default Label | Notes |
|------|---------------|-------|
| IN 1 | X | Primary input CV |
| IN 2 | Y | Primary input CV |
| IN 3–8 | IN 3–8 | Hidden by default, shown when enabled |
| LEARN | Learn | Gate input: when high, RL feedback is accepted |
| + TRIG | Positive | Trigger input: register thumbs-up |
| − TRIG | Negative | Trigger input: register thumbs-down |

- All CV inputs normalized to [0, 1] internally (0–10V → [0,1] or ±5V → [0,1] depending on input mode)
- LEARN gate has a corresponding panel toggle button (either/or — gate OR button enables learning)
- +/− triggers work only when LEARN is enabled (gate high OR toggle on)

### Outputs (17 total: 12 raw + 5 derived)

| Port | Type | Description |
|------|------|-------------|
| OUT 1–12 | Raw MLP | Direct MLP output activations, scaled to configured CV range |
| MEAN | Derived | Mean of the 12 raw outputs |
| SPREAD | Derived | Standard deviation of the 12 raw outputs |
| DELTA | Derived | Rate of change (L2 norm of output difference from previous inference) |
| NOVELTY | Derived | Gate: fires when current input is far from all training examples |
| CONFIDENCE | Derived | Inverse of loss on nearest training example (high = near trained region) |

Each output has:
- Per-output range configuration (0–10V unipolar or ±5V bipolar) via context menu
- Small attenuverter knob for fine-tuning range/polarity

### Panel Controls

| Control | Type | Description |
|---------|------|-------------|
| SPREAD | Knob | Controls weight init scale, RL noise scaling, weight decay (see webapp spec) |
| RATE | Knob | Inference rate: from block-rate (~170Hz) to audio-rate (44.1kHz) |
| + | Momentary button | Thumbs up (register positive RL feedback) |
| − | Momentary button | Thumbs down (register negative RL feedback) |
| LEARN | Toggle button + LED | Enable/disable learning (mirrors LEARN gate input) |
| RAND | Momentary button | Randomize network weights |
| CLEAR | Momentary button (long-press) | Clear all examples and reset network |

### Advanced Controls (Right-Click Context Menu)

| Setting | Description |
|---------|-------------|
| Input count | Number of CV inputs (2–8). **Warning: changing rebuilds MLP and clears all state.** |
| Noise level | Manual override for RL exploration noise (default: auto from spread) |
| Decay rate | Weight decay per RL step (default: auto from spread) |
| Learning rate | MLP training learning rate |
| Max iterations | Training iteration cap |
| Per-output range | Unipolar (0–10V) or Bipolar (±5V) for each output |

---

## Visual Feedback

### Primary Display (Custom OpenGL Widget)

The module includes a real-time rendered display area showing:

**Option A — Full Custom Display:**
- 12 vertical bars showing raw output levels (color-coded)
- Neuron activation heatmap (simplified MLP visualization)
- Training state indicator (idle / training / converged)
- Example count
- Current noise level

**Option B — Bars + Input Position:**
- 12 vertical bars showing raw output levels
- Small 2D dot plot showing current input position (XY scope style)
- Training state, example count, noise level as text overlays

Both options to be prototyped; converge based on usability and CPU cost.

### LED Indicators

- Per-output LEDs showing signal level (brightness = voltage)
- LEARN LED (green when active)
- Training activity LED (flashes during training)

---

## MLP Configuration

### Default Network

```
Inputs:  2 (+ bias = 3 input nodes)
Hidden:  [16, 24, 16]  (3 hidden layers, ReLU activation)
Output:  12 (sigmoid activation, maps to [0, 1])
```

Significantly smaller than the webapp's [3, 32, 48, 64, 126] — appropriate for 12 outputs and real-time inference constraints.

### When Input Count Changes

- User selects new input count from context menu
- Confirmation dialog: "This will reset the network and clear all training data. Continue?"
- On confirm: rebuild MLP with new input layer size, clear dataset, randomize weights

### Spread Parameter

Identical behavior to webapp (see CLAUDE.md for full spec):

1. **Weight initialization**: `drawWeights(spread)` — scales from uniform [-1,1] (spread=0) to Xavier 1/√fan_in (spread=1)
2. **RL noise**: `moveWeights(speed, spread)` — noise cap from 0.3 (spread=0) to 0.05 (spread=1), per-layer scaling
3. **Weight decay**: 0% (spread=0) to 10% per step (spread=1)
4. **Noise cap**: `0.3*(1-spread) + 0.05*spread`

---

## Inference Rate

User-configurable via RATE knob:

| Position | Rate | Behavior |
|----------|------|----------|
| Full CCW | ~170 Hz | Once per VCV process block (256 samples). Cheapest. |
| 12 o'clock | ~2 kHz | Every ~22 samples. Good for CV-rate modulation. |
| Full CW | 44.1 kHz | Every sample. Audio-rate CV. Most expensive. |

Between inference steps, output values are linearly interpolated (slew) to avoid staircase artifacts.

---

## RL Feedback Workflow

### Thumbs Up (+)

1. Capture current input vector and output vector
2. Add as training example to dataset
3. Enqueue training on background thread
4. Decay noise: `noiseLevel *= 0.97`

### Thumbs Down (−)

1. Increase noise: `noiseLevel = min(noiseLevel * 1.5, noiseCap)`
2. Perturb weights: `mlp.moveWeights(noiseLevel, spread)`
3. Re-run inference to produce new exploration output

### Learn Enable Gate

- When LEARN is disabled (gate low AND toggle off): +/− buttons and triggers are ignored. Inference still runs normally.
- When LEARN is enabled: +/− feedback is accepted.
- "Learn off = play mode" — the module always runs inference. Learning only controls whether feedback is registered.

---

## State Persistence

### Patch Save/Load

Full state serialized into VCV patch JSON:

```json
{
  "inputCount": 2,
  "spread": 0.6,
  "inferenceRate": 0.5,
  "noiseLevel": 0.1,
  "outputRanges": [{"unipolar": true, "attenuation": 1.0}, ...],
  "weights": [[...], ...],
  "examples": {"features": [[...]], "labels": [[...]]},
  "mlpConfig": {"layers": [3, 16, 24, 16, 12], "activations": ["relu", "relu", "relu", "sigmoid"]}
}
```

### Preset Files (.nisps)

- **Save**: Export current state to a `.nisps` JSON file (same format as patch state)
- **Load**: Import from `.nisps` file via right-click menu → "Load preset..."
- **Location**: User-chosen, no enforced directory
- Enables sharing trained networks between patches and with the companion webapp

---

## Companion Webapp Integration

### Bidirectional State Transfer

**File-based (offline):**
- Webapp: "Export .nisps" button → downloads JSON file
- VCV: Right-click → "Load .nisps preset" → imports weights + examples + config
- VCV: Right-click → "Save .nisps preset" → exports for webapp import
- Webapp: "Import .nisps" → loads and continues training

**OSC-based (live):**
- VCV module runs an OSC server (configurable port, default 9000)
- Webapp connects via WebSocket → OSC bridge
- Messages:
  - `/nisps/weights` — full weight transfer (either direction)
  - `/nisps/examples` — example set transfer
  - `/nisps/state` — full state sync
  - `/nisps/input` — current input values (for webapp visualization)
  - `/nisps/output` — current output values (for webapp visualization)

### Webapp Modifications Required

- Add .nisps file import/export buttons
- Add OSC client mode (connect to VCV module)
- Network size configuration to match VCV (12 outputs vs 126)
- Shared .nisps file format specification

---

## Panel Layout (Prototyping Phase)

Three panel width variants to prototype:

### Compact (20HP)
```
┌──────────────────────┐
│     MEMLNaut         │
│  ┌────────────────┐  │
│  │   DISPLAY      │  │
│  │  (bars + dot)  │  │
│  └────────────────┘  │
│                      │
│  SPREAD    RATE      │
│  [knob]    [knob]    │
│                      │
│  [+] [−] [LEARN]    │
│  [RAND]  [CLEAR]    │
│                      │
│  IN1  IN2  LEARN TRG│
│  (o)  (o)  (o)      │
│  +TRG  −TRG         │
│  (o)   (o)           │
│                      │
│  1  2  3  4  5  6   │
│  (o)(o)(o)(o)(o)(o)  │
│  7  8  9 10 11 12   │
│  (o)(o)(o)(o)(o)(o)  │
│  MN SP DL NV CF     │
│  (o)(o)(o)(o)(o)     │
└──────────────────────┘
```
No individual attenuverters. Outputs tightly packed.

### Standard (30HP)
```
┌──────────────────────────────────┐
│          MEMLNaut                │
│  ┌──────────────────────────┐   │
│  │       DISPLAY             │   │
│  │  (bars + XY + metrics)    │   │
│  └──────────────────────────┘   │
│                                  │
│  SPREAD     RATE                 │
│  [knob]     [knob]               │
│                                  │
│  [+]  [−]  [LEARN]  [RAND]     │
│                                  │
│  IN:  (1) (2)    LEARN (+) (−) │
│                                  │
│  OUT:                            │
│  1[a](o) 2[a](o) 3[a](o) 4[a](o)│
│  5[a](o) 6[a](o) 7[a](o) 8[a](o)│
│  9[a](o) 10[a](o) 11[a](o) 12[a]│
│  MN(o) SP(o) DL(o) NV(o) CF(o) │
└──────────────────────────────────┘
```
[a] = small attenuverter knob per output.

### Wide (44HP)
Full display, all attenuverters, room for 8 input jacks, OpenGL network visualization.

### Expander Module (16HP)
Adds: 6 extra input jacks, per-output attenuverters, secondary display.

---

## Build System

### VCV Rack 2 Plugin Structure

```
vcv/
├── plugin.json          # Plugin manifest
├── Makefile             # VCV SDK Makefile
├── src/
│   ├── plugin.hpp       # Plugin globals
│   ├── plugin.cpp       # Plugin init
│   ├── MEMLNaut.cpp     # Module logic (process, state, threading)
│   └── MEMLNautWidget.cpp  # Panel UI (widgets, display, layout)
├── res/
│   ├── MEMLNaut.svg     # Panel artwork
│   └── components/      # Custom SVG components
└── dep/
    └── nisps-core/      # Symlink or copy of nisps-core headers
```

### Dependencies

- **VCV Rack SDK** (v2.x)
- **nisps-core** (header-only, C++20, already in this repo)
- No other external dependencies

### Build Commands

```bash
cd vcv
export RACK_DIR=/path/to/Rack-SDK
make
make install  # Copies to VCV plugin directory
```

---

## Development Phases

### Phase 1: Skeleton (get it compiling)
- VCV plugin scaffold from template
- Integrate nisps-core headers
- Empty module that appears in VCV module browser
- 2 input ports, 12 output ports, no processing

### Phase 2: Core Engine
- Wire CV inputs → IML → CV outputs
- MLP inference in process() callback (fixed rate)
- Spread knob controlling weight initialization
- Randomize button

### Phase 3: RL Feedback
- +/− buttons on panel
- +/− trigger inputs
- Learn toggle + gate input
- Background thread training with weight double-buffering
- Noise level tracking

### Phase 4: Visual Feedback
- Custom display widget (prototype both bar graph and full visualization)
- LED indicators per output
- Training state display

### Phase 5: Configurability
- Inference rate knob with interpolation
- Per-output range configuration (unipolar/bipolar)
- Attenuverter knobs
- Input count configuration with MLP rebuild

### Phase 6: Persistence
- Full state serialization to patch JSON
- .nisps preset file save/load
- Right-click menu integration

### Phase 7: Derived Outputs
- Mean, spread, delta, novelty, confidence computations
- 5 additional output ports

### Phase 8: Companion Webapp Bridge
- .nisps file format shared between webapp and VCV
- Webapp import/export buttons
- OSC server in VCV module
- OSC client in webapp

### Phase 9: Panel Variants
- Prototype compact, standard, wide, expander layouts
- User testing, converge on final layout

### Phase 10: Polish & Distribution
- Panel artwork / graphic design
- Performance optimization
- VCV Rack v1 compatibility pass
- Documentation
- Distribution packaging

---

## Open Questions (to resolve during implementation)

1. **MLP hidden layer sizing**: [16, 24, 16] is a guess. May need tuning based on real-world training performance with 12 outputs.
2. **Novelty/confidence thresholds**: How to calibrate the novelty gate and confidence output. May need user-adjustable sensitivity.
3. **OSC port conflicts**: What if multiple MEMLNaut instances run in the same patch? Per-instance port assignment?
4. **V1 compatibility**: How much of the v2-specific API (polyphonic ports, new widget system) do we actually use? Determines v1 compat effort.
5. **Attenuverter UX**: Tiny trimpots on a VCV panel can be fiddly. May need to test whether attenuverters per output are actually useful vs. just using VCV's built-in attenuverter modules.
6. **Training convergence with 12 outputs**: The webapp trains 126 outputs — RL feedback on 12 is a different dynamic. May converge faster or feel less "exploratory".
