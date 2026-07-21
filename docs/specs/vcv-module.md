---
kind: spec
stability: evolving
layer: binding
counterpart: backends-spec.md
---

# MEMLNaut VCV Rack Module — Specification

**Revision note:** pruned 2026-07-21 to the current 8→16 contract. The 2→12-era design
sections (phase plan, per-node cost tables, nisps-core prerequisites, dead OSC verbs) are in git
history. This file is also the single `.nisps`/patch format spec — the separate
`vcv/NISPS-FORMAT.md` (which documented the retired v1 nested-weights format) was deleted with
this prune.

---

## Overview

A VCV Rack module that embeds the NISPS interactive ML engine as a CV-to-CV mapper. Users explore
high-dimensional parameter spaces via reinforcement-learning feedback, producing **16 raw CV
outputs** (each with a custom LED-ring indicator) from **8 CV inputs**.

The module does **not** produce sound. It maps input CVs through a trained neural network to
output CVs, which the user patches into other modules (VCOs, VCFs, VCAs, etc.). The result: a
learned, nonlinear, high-dimensional modulation source shaped by the user's aesthetic preferences.

**Plugin name:** MEMLNaut (`vcv/plugin.json`, currently v0.2.0, license field "proprietary")
**Target:** VCV Rack 2 only (see the v2-only decision at the end)
**Distribution:** not submitted to the VCV Library; `.vcvplugin` bundles published at
`meml.lnfinitemonkeys.org/next/vcv/` (see `vcv/DISTRIBUTION.md`; local builds land in the
git-ignored `vcv/dist/`). Note: VCV SDK is GPLv3 — linking against it effectively makes the
combined binary GPL.

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
│  src/iml.hpp — thin adapter over    │
│  nisps::ml::MLPCore<DynamicStorage> │
│  (the shared C++20 core in nisps/)  │
├─────────────────────────────────────┤
│          State Manager              │
│  Serialize/deserialize weights,     │
│  examples, config to JSON           │
└─────────────────────────────────────┘
```

### Core Library Integration

**Delta #5 CLOSED (2026-07-18, one-core-engine-refactor P6).** The module no longer
vendors its own MLP. `vcv/src/iml.hpp` is a THIN, Rack-free adapter over the shared
core: `nisps::ml::MLPCore<nisps::ml::DynamicStorage>` (the runtime-shaped branch of the one
core MLP — fixed 4-layer ReLU×3 + Sigmoid topology, three runtime hidden sizes) with the
module's real `[16, 24, 16]` shape, `nisps::Rng` (nisps/core/rng.hpp) replacing the vendored
`DetRng`, and the core MLP's own FIFO dataset replacing the vendored `Dataset`. The adapter
includes only nisps headers + the standard library (no Rack includes) so the host ctest can
compile it. Behaviour is **core-exact**: weight init, RL `move_weights`, SGD training,
activations and RNG are bit-identical to the firmware/WASM engine — pinned by
`tests/cpp/test_vcv_iml_parity.cpp` (adapter == bare `MLPCore<DynamicStorage>`, memcmp-equal).

### Threading Model

- **Audio thread** (`process()`): reads input CVs, runs MLP inference (decimated), writes output
  CVs. Never blocks.
- **Worker thread**: handles training (thumbs-up) and weight perturbation (thumbs-down). On
  completion, signals the audio thread to swap in the new weights and crossfade.
- **Widget thread**: draws UI, reads output values for display.

**Threading invariant** (documented at `vcv/src/MEMLNaut.cpp` `iml`/`imlShadow`): only the audio
thread touches `iml`; the worker thread operates exclusively on `imlShadow`. Hand-off is through
atomic-flagged staging buffers (`pendingWeights`, staged example copies) — the worker deep-copies
example vectors into staging before flagging, and the audio thread never reads `imlShadow`
directly. Feedback taps arriving mid-job are coalesced (latest pending state wins).

**Post-swap output crossfade**: when weights are swapped, outputs may jump discontinuously. The
context-menu slew setting (default 10 ms) crossfades old→new output vectors to prevent clicks.

**Multiple instances**: each module instance is fully independent (own adapter instances, own
worker thread, own OSC port = 7001 + instance-id % 64).

### Input Signal Handling

- **Polyphonic inputs**: channel 0 only (monophonic).
- **Input clipping**: CV inputs are hard-clamped to their configured range before normalisation
  to [0, 1]. Unipolar (default): clamp [0, 10 V], ÷10. Bipolar: clamp [−5, +5 V], +5, ÷10.

---

## I/O Specification

### Inputs (8 CV inputs + control ports)

| Port | Description |
|------|-------------|
| IN 1–8 | CV inputs feeding the 8-input MLP |
| SPREAD CV | CV modulation of SPREAD knob (added to knob value, /10 V) |
| LEARN | Gate input: high accepts RL feedback (OR'd with the LEARN toggle) |
| + TRIG | Trigger input: thumbs-up |
| − TRIG | Trigger input: thumbs-down |

### Outputs

| Port | Description |
|------|-------------|
| OUT 1–16 | Raw MLP outputs scaled to the configured CV range; each jack has an LED ring and an attenuverter trimpot (−100%..+100%, default +100%) |

There are **no derived-output jacks** in the 8→16 module (the 2→12-era MEAN/STD/DELTA/NOVELTY/
CONFIDENCE jacks were dropped in the redesign). A context-menu toggle "Compute derived stats
(Mean/Std/Delta)" computes the stats on the audio thread, and a novelty distance is cached after
training — but as of 2026-07-21 **no jack, display, or OSC verb consumes these values** (see Open
Questions).

### Panel Controls

| Control | Type | Description |
|---------|------|-------------|
| SPREAD | Knob (default 60%) | Weight-init scale, RL noise cap, weight decay |
| RATE | Knob | Inference rate: block-rate (~170 Hz) … audio-rate (44.1 kHz) |
| + | Momentary | Thumbs up (requires LEARN) |
| − | Momentary | Thumbs down (requires LEARN) |
| LEARN | Toggle + green LED | Enable/disable learning; inference always runs |
| RAND | Momentary | Randomise network weights (uses SPREAD) |
| CLEAR | Momentary (long-press ~1 s) | Clear all examples and reset network |

A yellow TRAIN LED flashes during worker-thread training. The display strip draws the 16 output
bars (palette-coloured), the noise level (`N:`), the example count (`n/100`), and `TRAIN` while
training.

### Context Menu (the real, current one)

| Setting | Description |
|---------|-------------|
| Output ranges | Per-output Unipolar (0–10 V, default) / Bipolar (±5 V) |
| Input ranges | Per-input Unipolar (0–10 V, default) / Bipolar (±5 V) |
| Compute derived stats (Mean/Std/Delta) | Toggle; see note above — currently unconsumed |
| Output slew | 0 / 5 / 10 (default) / 20 / 50 / 100 ms |
| Presets (.nisps) | Save / Load `.nisps` preset files (format below) |
| Browser bridge (WS↔OSC) | Enable OSC server; listen port ∈ {7001, 7002, 7003, 9000, 9001} |

---

## Visual Feedback — Per-Output LED Rings

Each of the 16 output jacks is surrounded by a custom LED ring (`vcv/src/LedRing.hpp`, NanoVG on
`drawLayer()` layer 1). The ring arc fills proportionally to the output's current value; the
track ring is dimly visible always. Colours come from `vcv/src/palette.hpp` (hand-written from
the frontend design tokens — `--accent` #ff6a00 etc.): the 16 outputs read as a clean
orange→cyan-anchored ramp across the jacks.

---

## MLP Configuration

```
Inputs:  8
Hidden:  [16, 24, 16]  (3 hidden layers, ReLU)
Output:  16 (sigmoid, values in [0, 1])
```

`vcv/src/MEMLNaut.cpp`: `NUM_ML_INPUTS = 8`, `NUM_ML_OUTPUTS = 16`,
`nisps::IML<float> iml{NUM_ML_INPUTS, NUM_ML_OUTPUTS, {16, 24, 16}}`. The topology is fixed; the
core stores biases explicitly (no phantom "+1 bias node" in the layer counts).

### Spread Parameter

Identical to the browser/firmware engine (the core methods):

1. **Weight initialisation**: `draw_weights(spread)` — uniform [−1,1] (spread=0) → Xavier (spread=1)
2. **RL perturbation**: `move_weights(speed, spread)` — per-layer scaling + weight decay
3. **Noise cap**: `0.3·(1−spread) + 0.05·spread`

### Dataset Capacity

100 examples (`vcv/src/iml.hpp` `kMaxExamples = 100`, kept equal to the old vendored capacity so
patch round-trips preserve counts). FIFO: oldest example dropped when full. Note the nisps core's
own default is 128 (`kDefaultMaxExamples`); the VCV adapter pins 100 explicitly.

---

## Inference Rate

RATE knob, exponential mapping `period = 256 · (1/256)^rate` samples:

| Position | Rate | Behavior |
|----------|------|----------|
| Full CCW | ~170 Hz | Once per 256 samples. Cheapest. |
| 12 o'clock | ~2.8 kHz | Every 16 samples. Good for CV-rate modulation. |
| Full CW | 44.1 kHz | Every sample. Audio-rate CV. |

Between inference steps, outputs are linearly interpolated; the post-training crossfade (slew)
composes on top.

---

## RL Feedback Workflow

**Thumbs up (+)**: capture current input/output pair as a training example → enqueue training on
the worker → `noiseLevel *= 0.97`.

**Thumbs down (−)**: `noiseLevel = min(noiseLevel · 1.5, noiseCap)` → enqueue perturbation
(`move_weights(noiseLevel, spread)`) on the worker → audio thread crossfades to the new weights.

**Learn gate**: when LEARN is off (gate low AND toggle off), +/− are ignored; inference always
runs ("learn off = play mode").

---

## State Persistence — the ONE `.nisps`/patch format (version 3)

Both the VCV patch state and menu-saved `.nisps` files use the same JSON, produced by
`MEMLNaut::dataToJson()`:

```json
{
  "version": 3,
  "inputCount": 8,
  "outputCount": 16,
  "noiseLevel": 0.1,
  "slewMs": 10.0,
  "computeDerived": false,
  "oscEnabled": false,
  "oscPort": 7001,
  "outputRangeUnipolar": [true, "… ×16"],
  "inputRangeUnipolar": [true, "… ×8"],
  "weights": ["… flat float array"],
  "examples": { "features": [["… ×8"]], "labels": [["… ×16"]] },
  "mlpConfig": { "layers": [8, 16, 24, 16, 16] },
  "params": ["only in menu-saved .nisps files: all param values incl. attenuverters"]
}
```

- **`weights` is the core's FLAT vector**: `[layer0_w … layer3_w][layer0_b … layer3_b]` — the
  exact `MLPCore` weight layout, biases included. The old v1 nested 3-D
  `weights[layer][node][weight]` blobs (bias not serialised) do **not** load: `set_weights`
  rejects them on a size guard.
- **`mlpConfig.layers`** are true node counts `[8, 16, 24, 16, 16]` — no "+1 bias" first entry.
- **`examples`**: parallel `features` (×8 floats) / `labels` (×16 floats) arrays, ≤100 entries.
- The menu "Load .nisps preset…" rejects files with `version < 1`; unknown extra fields are
  ignored. `params` is appended only by the menu save (patch save round-trips params natively).

---

## Browser Bridge (WS ↔ UDP OSC)

The module runs a UDP OSC server (`vcv/src/osc_server.hpp`, transport-only). The browser
(`manifold/src/backends/vcv-backend.ts`) connects via the Deno WS↔UDP bridge
(`manifold/osc-bridge/bridge.ts`; WS port default 8765 — pass `--osc-port` to match the module's
port, the bridge's own default is 9000).

### Live OSC verbs (the complete set)

| Verb | Direction | Payload |
|------|-----------|---------|
| `/nisps/input` | Browser → VCV | float array — input vector; while streaming, the module runs in **bridged mode** (browser drives the model inputs instead of the jacks) |
| `/nisps/output` | VCV → Browser (~100 ms throttle) | 16 floats — live outputs (alive-proof + visualisation) |
| `/nisps/input` | VCV → Browser (~100 ms throttle) | 8 floats — live inputs (echo) |
| `/nisps/feedback` | Browser → VCV | JSON string op (`up` / `down` / `rand` / `clear`, optional `spread`, `input`/`output` vectors), routed through the same paths as the panel buttons |

The 2→12-era `/nisps/weights`, `/nisps/examples`, and `/nisps/state` full-state sync verbs were
**deleted** (both directions had zero consumers; Rack patch save/load owns persistence).
Bidirectional *training* remains: both the browser verdict loop and the module panel drive the
same MLP.

**Port assignment:** default UDP 7001 + per-instance offset (`7001 + id % 64`); the context menu
offers {7001, 7002, 7003, 9000, 9001}.

---

## Panel Layout

The module is **44HP** (`res/MEMLNaut-wide.svg`, 223.52 mm — the SVG the widget actually loads).
`res/MEMLNaut.svg` is an unused 30HP variant and `res/MEMLNaut-expander.svg` an unused 8HP
expander panel; no expander module is implemented.

- Top: display strip (16 output bars, noise level, example count, TRAIN)
- Upper: SPREAD + RATE knobs, LEARN toggle + LED, RAND, CLEAR, +/− buttons
- Middle: 8 input jacks, SPREAD CV, LEARN gate, +/− trigger inputs
- Lower: 16 output jacks (2 rows of 8) with LED rings and per-output attenuverter trimpots

---

## Build

```bash
cd vcv
export RACK_DIR=/path/to/Rack-SDK   # default: ~/.local/share/Rack2/Rack-SDK
make
make install
```

Files: `src/plugin.{hpp,cpp}`, `src/MEMLNaut.cpp` (module + widget + serialization + OSC wiring),
`src/iml.hpp` (core adapter), `src/osc_server.hpp`, `src/LedRing.hpp`, `src/palette.hpp`,
`res/*.svg`, `Makefile` (adds `-std=c++20`; the core is reached via relative `../../nisps/…`
includes from `src/`, no extra `-I`). Cross-platform bundles are produced by `build-mac.sh` /
`build-win.sh` into `dist/` (see `vcv/BUILDING.md`, `vcv/DISTRIBUTION.md`).

**Rack version decision: ship v2-only.** The v1 SDK lacks the menu/tooltip APIs used throughout
and may not support the C++20 the core requires; the port (~8 h) can be done later if demand
materialises.

---

## Open Questions

1. **Derived stats are computed but unconsumed** — the context-menu toggle computes Mean/Std/
   Delta (and novelty is cached after training) with no jack, display, or OSC consumer. Either
   wire a consumer or delete the compute path.
2. **Hidden-layer sizing**: [16, 24, 16] carried over from the 2→12 era; untuned for 8→16.
3. **Expander**: an 8HP expander SVG exists with no module behind it — build or delete.
