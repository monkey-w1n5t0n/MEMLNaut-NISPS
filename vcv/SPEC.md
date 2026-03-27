# MEMLNaut VCV Rack Module — Specification

## Overview

A VCV Rack module that embeds the NISPS interactive ML engine (nisps-core C++ library) as a CV-to-CV mapper. Users explore high-dimensional parameter spaces via reinforcement learning feedback, producing 12 raw CV outputs and 5 derived meta-signals from configurable CV inputs.

The module does **not** produce sound. It maps input CVs through a trained neural network to output CVs, which the user patches into other modules (VCOs, VCFs, VCAs, etc.). The result: a learned, nonlinear, high-dimensional modulation source shaped by the user's aesthetic preferences.

**Plugin name:** MEMLNaut
**Module name:** MEMLNaut (initially single module, future modules possible)
**License:** Undecided. Note: nisps-core is MPL-2.0 (file-level copyleft — MPL files must remain open, but wrapper code can be any license). VCV SDK is GPLv3 — linking against it effectively makes the combined binary GPL. Will not be submitted to VCV Library initially.
**Target:** VCV Rack 2 (primary, both Community Edition [free] and Pro), v1 compatibility where feasible

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
- **Background thread**: Handles training (SGD/RMSProp). On completion, atomically swaps weight buffer into the inference path. Also computes novelty/confidence maps post-training.
- **Widget thread**: Draws UI, handles user interaction (buttons, knobs). Reads output values for display.

**Weight double-buffering**: Two separate MLP instances are maintained (nisps-core is not thread-safe — no locks, public `m_layers`, `std::mt19937` without synchronization). The audio thread reads from MLP-A while the training thread clones weights into MLP-B, trains MLP-B, then signals completion. An `std::atomic<bool>` flag tells the audio thread to swap. Memory cost is ~2x network weights (~20KB for the default architecture — trivial).

**Threading invariant**: Only the background thread ever writes to an MLP instance. This applies to both training (thumbs-up) and weight perturbation (thumbs-down). Both operations are enqueued as jobs for the background thread, which clones → mutates → signals swap. Thumbs-down adds ~1-5ms latency vs. direct mutation, but maintains the single-writer invariant and eliminates data races.

**Rapid feedback queueing**: If the user taps +/− while a training/perturbation job is in progress, incoming examples are buffered into a pending list. When the current job completes, if pending work exists, a new job starts immediately with the full (now-updated) dataset. Maximum queue depth of 1 — latest pending state wins, intermediate states are coalesced.

**Thread lifecycle**: Background thread checks an `std::atomic<bool> shouldStop` flag each training iteration. On module destruction, set flag and join with a timeout (~100ms). If training doesn't finish in time, the thread is detached (VCV can't hang waiting for a stuck training loop). Each module instance owns its own background thread — no shared thread pool (simplicity over efficiency; revisit if profiling shows thread overhead with many instances).

**Multiple instances**: Each module instance is fully independent (own IML, own background thread, own state). 4 instances = 4 threads + ~80KB weight memory — negligible. The OSC server (Phase 8) needs per-instance port assignment to avoid conflicts.

**Post-swap output crossfade**: When weights are swapped, outputs may jump discontinuously. A configurable slew parameter (default ~10ms) linearly interpolates between old and new output vectors over a short crossfade window to prevent audible clicks in downstream audio. Accessible via right-click context menu.

### Input Signal Handling

- **Polyphonic inputs**: Channel 0 only (monophonic). Extra channels are ignored. Standard behavior for non-polyphonic module designs.
- **Input clipping**: All CV inputs are hard-clamped to their expected range before normalization. For 0–10V mode: clamp to [0, 10V]. For ±5V mode: clamp to [-5V, +5V]. Out-of-range signals are silently clipped.

---

## I/O Specification

### Inputs (Configurable: 2–8, default 2)

| Port | Default Label | Notes |
|------|---------------|-------|
| IN 1 | X | Primary input CV |
| IN 2 | Y | Primary input CV |
| IN 3–8 | IN 3–8 | Hidden by default, shown when enabled |
| SPREAD CV | Spread | CV modulation of SPREAD knob (attenuated, added to knob value) |
| LEARN | Learn | Gate input: when high, RL feedback is accepted |
| + TRIG | Positive | Trigger input: register thumbs-up |
| − TRIG | Negative | Trigger input: register thumbs-down |

- All CV inputs normalized to [0, 1] internally. Per-input range configuration via context menu:
  - **Unipolar (0–10V)**: default. Clamp to [0, 10V], divide by 10. Good for envelopes, sequencers.
  - **Bipolar (±5V)**: Clamp to [-5, +5V], add 5, divide by 10. Good for LFOs, oscillators.
- LEARN gate has a corresponding panel toggle button (either/or — gate OR button enables learning)
- +/− triggers work only when LEARN is enabled (gate high OR toggle on)

### Outputs (17 total: 12 raw + 5 derived)

| Port | Type | Description |
|------|------|-------------|
| OUT 1–12 | Raw MLP | Direct MLP output activations, scaled to configured CV range |
| MEAN | Derived | Mean of the 12 raw outputs |
| STD | Derived | Standard deviation of the 12 raw outputs (named "STD" to avoid collision with the SPREAD knob) |
| DELTA | Derived | Rate of change (L2 norm of output difference from previous inference) |
| NOVELTY | Derived | Gate: fires when current input is far from all training examples (computed on training thread, cached). **Default with 0 examples: 10V** (everything is novel when untrained). |
| CONFIDENCE | Derived | Inverse of loss on nearest training example (computed on training thread, cached). **Default with 0 examples: 0V** (no confidence with no data). |

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
| Per-input range | Unipolar (0–10V, default) or Bipolar (±5V) for each CV input |
| Noise level | Manual override for RL exploration noise (default: auto from spread) |
| Decay rate | Weight decay per RL step (default: auto from spread) |
| Learning rate | MLP training learning rate |
| Max iterations | Training iteration cap |
| Per-output range | Unipolar (0–10V) or Bipolar (±5V) for each output |
| Output slew | Post-training crossfade time in ms (default: 10ms, range: 0–100ms) |

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

1. **Weight initialization**: `DrawWeights(spread)` — scales from uniform [-1,1] (spread=0) to Xavier 1/√fan_in (spread=1)
2. **RL noise**: `MoveWeights(speed, spread)` — noise cap from 0.3 (spread=0) to 0.05 (spread=1), per-layer scaling
3. **Weight decay**: 0% (spread=0) to 10% per step (spread=1)
4. **Noise cap**: `0.3*(1-spread) + 0.05*spread`

**Prerequisite**: These spread-aware methods do **not** currently exist in nisps-core C++. The JS webapp implements spread interpolation, per-layer noise scaling, and weight decay in `playground/js/nisps/mlp.js`. The existing C++ `DrawWeights(scale)` is deprecated and `MoveWeights(speed)` has no spread parameter. **Phase 0** (below) ports this logic into nisps-core as proper C++ MLP methods.

### Dataset Capacity

The dataset has a maximum of 100 examples (`Dataset::kMax_examples`). When full, FIFO forgetting drops the oldest example. This means extended RL sessions will gradually lose the user's earliest preferences. This is acceptable for RL exploration but should be surfaced in the UI (example count display should show "42/100" style).

---

## Inference Rate

User-configurable via RATE knob:

| Position | Rate | Behavior |
|----------|------|----------|
| Full CCW | ~170 Hz | Once per VCV process block (256 samples). Cheapest. |
| 12 o'clock | ~2 kHz | Every ~22 samples. Good for CV-rate modulation. |
| Full CW | 44.1 kHz | Every sample. Audio-rate CV. Most expensive. |

Between inference steps, output values are linearly interpolated (slew) to avoid staircase artifacts.

Note: two interpolation systems coexist — decimation interpolation (sub-ms, between inference steps) and post-training crossfade (10ms+, between weight swaps). These compose cleanly: the crossfade produces a smooth target that the decimation interpolation tracks. No special interaction handling needed.

---

## RL Feedback Workflow

### Thumbs Up (+)

1. Capture current input vector and output vector
2. Add as training example to dataset
3. Enqueue training on background thread
4. Decay noise: `noiseLevel *= 0.97`

### Thumbs Down (−)

1. Increase noise: `noiseLevel = min(noiseLevel * 1.5, noiseCap)`
2. Enqueue perturbation job on background thread: clone weights → `mlp.moveWeights(noiseLevel, spread)` → signal swap
3. Audio thread picks up new weights on next swap, crossfades via output slew

Note: perturbation goes through the background thread (not direct mutation) to maintain the single-writer threading invariant. The ~1-5ms latency is imperceptible on a button press.

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
  "version": 1,
  "inputCount": 2,
  "spread": 0.6,
  "inferenceRate": 0.5,
  "noiseLevel": 0.1,
  "slewMs": 10,
  "outputRanges": [{"unipolar": true, "attenuation": 1.0}, ...],
  "weights": [[...], ...],
  "examples": {"features": [[...]], "labels": [[...]]},
  "mlpConfig": {"layers": [3, 16, 24, 16, 12], "activations": ["relu", "relu", "relu", "sigmoid"]}
}
```

The `version` field enables forward compatibility. On load, validate that `mlpConfig.layers` matches the current module configuration; if not, warn the user and offer to rebuild the MLP to match the file's architecture.

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

Three panel variants to prototype. The compact (20HP) option was cut — 22 jacks + 5 buttons + 2 knobs + display cannot physically fit in 128.5mm of vertical panel space.

### Standard (30HP) — minimum viable panel
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
- **OSC library** (Phase 8 only): oscpack or liblo for UDP OSC server. Not needed until Phase 8. Alternative: minimal from-scratch UDP implementation to avoid the dependency.

### Build Commands

```bash
cd vcv
export RACK_DIR=/path/to/Rack-SDK
make
make install  # Copies to VCV plugin directory
```

---

## Development Phases

### Phase 0: nisps-core Spread API
- Port `drawWeights(spread)` from JS `mlp.js:209` to C++ `MLP::DrawWeights(T spread)`
- Port `moveWeights(speed, spread)` from JS `mlp.js:231` to C++ `MLP::MoveWeights(T speed, T spread)`
  - Per-layer Xavier noise scaling
  - Weight decay proportional to spread
- Deprecate old `DrawWeights(float scale)` (already marked `[[deprecated]]`)
- Update `IML` to expose spread-aware methods
- Unit tests for spread=0, spread=0.5, spread=1 behavior

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

### Integration Smoke Test (after Phase 2, before Phase 3)
- Patch MEMLNaut outputs into a VCV synth voice (VCO → VCF → VCA)
- Verify outputs change when inputs change (patch LFO into input)
- Verify Randomize produces audibly different mappings
- Evaluate if [16, 24, 16] network feels expressive enough for 12 outputs
- This is the first "playable moment" — assess if the core concept works before building RL

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
- Mean, spread, delta: computed on audio thread (trivial cost)
- Novelty, confidence: computed on training thread after each training run
  - Pre-compute a novelty/confidence map over a grid of input positions
  - Audio thread looks up nearest grid point (cheap)
  - **Future consideration**: alternative approaches (display-rate update, lazy compute on input change) may be more accurate — document in backlog
- 5 additional output ports

### Phase 8: Companion Webapp Bridge
- .nisps file format shared between webapp and VCV
- Webapp import/export buttons
- OSC server in VCV module
- OSC client in webapp

### Phase 9: Panel Variants
- Prototype standard (30HP), wide (44HP), and expander (16HP) layouts
- User testing, converge on final layout

### Phase 10: Polish & Distribution
- Panel artwork / graphic design
- Performance optimization
- VCV Rack v1 compatibility pass
- Documentation
- Distribution packaging

---

## Performance Characteristics

### Inference Cost

The MLP has architecture `[3, 16, 24, 16, 12]` (3 = 2 inputs + 1 bias node). Each layer's nodes compute a weighted sum of all inputs from the previous layer (including bias weight), then apply an activation function.

| Layer transition | Nodes | Weights per node | Multiply-adds | Activations |
|-----------------|-------|-----------------|---------------|-------------|
| Input (3) -> Hidden 1 (16) | 16 | 3 | 48 | 16 (ReLU) |
| Hidden 1 (16) -> Hidden 2 (24) | 24 | 17 (16 + bias) | 408 | 24 (ReLU) |
| Hidden 2 (24) -> Hidden 3 (16) | 16 | 25 (24 + bias) | 400 | 16 (ReLU) |
| Hidden 3 (16) -> Output (12) | 12 | 17 (16 + bias) | 204 | 12 (sigmoid) |
| **Total** | | | **1,060** | **68** |

One forward pass: ~1,060 multiply-adds + 68 activation evaluations (56 ReLU, 12 sigmoid). This is trivially cheap for any modern CPU.

### Memory

- ~20KB per MLP instance (weights + node state for [3, 16, 24, 16, 12])
- 2 MLP instances per module (double-buffering for thread safety): ~40KB
- Dataset: up to 100 examples, each with 2 floats (inputs) + 12 floats (labels) = 5.6KB max
- Total per module instance: ~46KB — negligible

### Threading

- 1 background thread per module instance for training/perturbation
- No shared thread pool (simplicity over efficiency)
- 4 module instances = 4 threads + ~184KB total memory

### Rate Knob Range

| Knob position | Inference rate | Period (samples at 44.1kHz) | Behavior |
|--------------|---------------|----------------------------|----------|
| Full CCW (0.0) | ~170 Hz | 256 | Once per process block. Cheapest. |
| 12 o'clock (0.5) | ~2,756 Hz | 16 | Good for CV-rate modulation. |
| Full CW (1.0) | 44,100 Hz | 1 | Every sample. Audio-rate CV. |

Mapping is exponential: `period = 256 * (1/256)^rate`, giving perceptually linear response.

### CPU Estimate

At default rate (~2kHz with knob at 0.5): ~2,000 forward passes/sec. Each pass is ~1,060 multiply-adds. Total: ~2.1M multiply-adds/sec. For context, a single modern CPU core can sustain billions of multiply-adds per second. Even at audio rate (44.1kHz = ~46M multiply-adds/sec), the MLP inference is a small fraction of available compute.

The dominant CPU cost at audio rate is not the MLP math but the per-sample overhead in `process()` (derived output computation, slew interpolation, voltage scaling). At default rate this overhead is amortized across ~16 samples.

---

## VCV Rack v1 Compatibility

### v2-Specific APIs Used

The following VCV Rack v2 APIs are used throughout `src/MEMLNaut.cpp`:

| API | Usage | v1 Equivalent |
|-----|-------|--------------|
| `createPanel()` | `setPanel(createPanel(asset::plugin(...)))` — loads SVG panel | `SVGPanel` + `setPanel()` manual setup |
| `configButton()` | Configures momentary button params (RAND, +, -, CLEAR) | `configParam()` with min=0, max=1, default=0 |
| `configSwitch()` | Configures LEARN toggle with string labels | `configParam()` (no label strings) |
| `configParam()` | All knob/attenuverter configuration | Same name, but v2 added display formatting args |
| `configInput()` / `configOutput()` | Port labels for tooltips | Not available in v1 (no port tooltips) |
| `createCheckMenuItem()` | Context menu toggle items (output ranges, input ranges, OSC, slew) | Manual `MenuItem` subclass with `rightText` checkmark |
| `createSubmenuItem()` | Nested submenus (slew time, OSC port) | Manual `MenuItem` subclass overriding `createChildMenu()` |
| `createMenuItem()` | Simple menu actions (save/load preset) | Manual `MenuItem` subclass overriding `onAction()` |
| `createMenuLabel()` | Section headers in context menu | `MenuLabel` direct construction |
| `LedDisplay` | Base class for NanoVG bar graph display widget | `LedDisplayWidget` (similar but slightly different API) |
| `drawLayer()` | Layer-based drawing (layer 1 = foreground) | `draw()` only (no layer separation) |
| `createModel<M, W>()` | Template model registration | Same syntax (available since late v1) |
| `string::f()` | Printf-style string formatting | `string::f()` (available in v1) |
| `dsp::BooleanTrigger` | Edge detection on boolean params | Available in v1 |
| `dsp::SchmittTrigger` | Edge detection on CV triggers | Available in v1 |
| `json_*` (jansson) | State serialization | Same (jansson is used in both v1 and v2) |
| `osdialog_*` | Native file dialogs for preset save/load | Same (osdialog bundled in both) |
| Standard widgets: `RoundBlackKnob`, `VCVButton`, `CKSS`, `Trimpot`, `PJ301MPort`, `SmallLight` | Panel components | All available in v1 (VCVButton may need renaming to `BefacoButton` or similar) |

### APIs Without Direct v1 Equivalents

- **`configInput()` / `configOutput()`**: v1 has no port tooltip system. These calls would simply be removed — ports would work but lack hover labels.
- **`configButton()` / `configSwitch()`**: Would revert to `configParam()` calls. Lose the semantic distinction and string labels.
- **`createCheckMenuItem()` / `createSubmenuItem()`**: The most labor-intensive change. Each menu item in v1 requires a dedicated `struct` subclass of `MenuItem` with `onAction()` and `rightText` overrides. Our context menu has ~20+ items. A v1 port would need ~20 small structs or a templated helper.

### Estimated Effort

- **Mechanical changes** (configButton -> configParam, remove configInput/configOutput labels): ~1 hour
- **Context menu rewrite** (createCheckMenuItem/createSubmenuItem -> manual MenuItem subclasses): ~3-4 hours. This is the bulk of the work — approximately 20 menu items each needing a small struct.
- **Display widget** (LedDisplay/drawLayer -> LedDisplayWidget/draw): ~30 minutes
- **Widget naming** (VCVButton and similar may have different names): ~30 minutes of research + find/replace
- **Testing**: ~2 hours (v1 has different SDK build, need separate build environment)
- **Total estimate**: ~8 hours of focused work

### Recommendation

**Ship v2-only.** Rationale:

1. VCV Rack v1 userbase is declining — v2 Community Edition is free, removing the cost barrier that kept some users on v1.
2. The 8-hour port effort is not large, but maintaining two codepaths adds ongoing cost for every future feature.
3. nisps-core requires C++20 (`std::span`, concepts). The v1 SDK toolchain may not support C++20 on all platforms, which could require additional workarounds or feature-gating.
4. If v1 demand materializes, the port is straightforward and can be done as a one-time effort.

---

## Open Questions (to resolve during implementation)

1. **MLP hidden layer sizing**: [16, 24, 16] is a guess. May need tuning based on real-world training performance with 12 outputs.
2. **Novelty/confidence thresholds**: How to calibrate the novelty gate and confidence output. May need user-adjustable sensitivity.
3. **Novelty grid resolution**: The training-thread novelty map approach trades accuracy for speed. What grid resolution is needed for useful novelty output? With 2 inputs a 32x32 grid is 1024 points; with 8 inputs the grid is impractical (32^8 = 1 trillion). Higher-dimensional inputs may need a different strategy (e.g. only compute for current input neighborhood).
4. **OSC port conflicts**: What if multiple MEMLNaut instances run in the same patch? Per-instance port assignment?
5. **V1 compatibility**: How much of the v2-specific API (polyphonic ports, new widget system) do we actually use? Determines v1 compat effort.
6. **Attenuverter UX**: Tiny trimpots on a VCV panel can be fiddly. May need to test whether attenuverters per output are actually useful vs. just using VCV's built-in attenuverter modules.
7. **Training convergence with 12 outputs**: The webapp trains 126 outputs — RL feedback on 12 is a different dynamic. May converge faster or feel less "exploratory".
8. **Expander module protocol**: VCV uses `ExpanderMessage` structs with left/right adjacency detection. Need to design the data protocol between main module and expander if/when we build it.
9. **C++20 compiler support**: VCV SDK Makefile targets specific compiler versions. Verify that C++20 features used by nisps-core (std::span, concepts) are supported by the VCV toolchain on all platforms (Linux, macOS, Windows).
