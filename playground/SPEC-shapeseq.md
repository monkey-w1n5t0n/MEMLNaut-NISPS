# ShapeSeq — NISPS Generative Sequencing System

## Overview

ShapeSeq is a generative sequencing system for the NISPS playground where interactive ML (via the NISPS MLP engine) controls **parameters of algorithmic sequencing primitives** rather than raw note data. The user shapes sequences by navigating a learned parameter space with a joystick or hand tracking, can freeze sequences they like, then selectively re-expose specific parameters for further ML-driven exploration.

ShapeSeq replaces the existing placeholder arpeggiator.

## Core Architecture

### Design Principles

1. **MLP outputs are abstract [0,1] values** — musical meaning is applied downstream by a configurable projection layer
2. **Separate NISPS instances** for timbre control and sequence control, with architecture supporting future unification into a single instance
3. **Port-ready JS** — no closures in hot paths, explicit state, data structures that map cleanly to C++ for future RP2040 firmware porting
4. **Modular primitives** — small, combinable algorithmic building blocks that generate musical patterns from continuous parameters

### System Diagram

```
                    ┌─────────────────┐
                    │  Input Router   │
                    │ (configurable)  │
                    └──┬──────────┬───┘
                       │          │
              ┌────────▼──┐  ┌───▼────────┐
              │ NISPS MLP  │  │ NISPS MLP  │
              │ (timbre)   │  │ (sequence) │
              └────────┬───┘  └───┬────────┘
                       │          │
              ┌────────▼──┐  ┌───▼────────────────────┐
              │ Synth      │  │ Delta Controller       │
              │ Param Map  │  │ (frozen vals + deltas) │
              └────────┬───┘  └───┬────────────────────┘
                       │          │
                       │     ┌────▼──────────────┐
                       │     │ Primitive Chain    │
                       │     │ Euclid→ProbGate→… │
                       │     └────┬──────────────┘
                       │          │
                       │     ┌────▼──────────────┐
                       │     │ Projection Layer   │
                       │     │ (scale quant, etc) │
                       │     └────┬──────────────┘
                       │          │
                       │     ┌────▼──────────┐
                       │     │ Clock Engine   │
                       │     │ (AudioContext)  │
                       │     └────┬──────────┘
                       │          │
                  ┌────▼──────────▼────┐
                  │ Namespaced Event Bus│
                  │ seq.* ml.* ui.*    │
                  └────────┬───────────┘
                           │
                  ┌────────▼───────┐
                  │ C15 Synth      │
                  │ (noteOn/Off +  │
                  │  param changes)│
                  └────────────────┘
```

### Namespaced Event Bus

A pub/sub event system with namespaced channels:

| Namespace | Events | Purpose |
|-----------|--------|---------|
| `seq.*` | `seq.step`, `seq.noteOn`, `seq.noteOff`, `seq.paramChange`, `seq.loopStart` | Musical output from sequencer to synth and visualizer |
| `ml.*` | `ml.trained`, `ml.frozen`, `ml.unfrozen`, `ml.deltaUpdate` | ML state changes |
| `ui.*` | `ui.paramSelect`, `ui.chainEdit`, `ui.presetLoad`, `ui.freezeToggle` | User actions |

All events carry a timestamp (AudioContext.currentTime for `seq.*`, performance.now() for others).

### Input Routing Matrix

A configurable routing layer that maps any input source to either NISPS instance's inputs:

**Input sources:**
- Joystick X, Y (2 values)
- Hand tracking features (14 values)
- Gamepad axes (variable)

**Routing targets:**
- Timbre NISPS input 0, input 1
- Sequence NISPS input 0, input 1

Default: joystick → timbre NISPS, hand tracking features 0+1 → sequence NISPS. User-configurable via UI.

## Sequencing Primitives

Each primitive is a pure function (or stateful generator with explicit state) that accepts a parameter object and produces typed output. All parameters are normalized [0,1].

### 1. Euclidean Rhythm Generator

**Params:** `steps` (int, from continuous), `pulses` (int), `rotation` (int)
**Output type:** trigger pattern (boolean array)
**Stateless:** yes

Generates Bjorklund-distributed trigger patterns. The continuous [0,1] params are projected to integer ranges based on current step count.

### 2. Probability Gate

**Params:** `density` [0,1], `accentProbability` [0,1]
**Input type:** trigger pattern
**Output type:** filtered trigger pattern with accent flags
**Stateless:** yes (per-step coin flip using seeded PRNG)

Each incoming trigger survives with probability `density`. Surviving triggers receive accent flag with probability `accentProbability`.

### 3. Pitch Walker

**Params:** `stepSize` [0,1], `directionBias` [0,1] (0.5=unbiased), `gravity` [0,1] (pull toward center), `range` [0,1]
**Input type:** trigger pattern
**Output type:** pitch values [0,1] per triggered step
**Stateful:** yes — maintains current position in pitch space

Constrained random walk that generates melodic contour. `gravity` pulls the walk toward center (0.5), preventing it from getting stuck at extremes. State includes current position and PRNG state.

### 4. Ratchet

**Params:** `maxDivision` [0,1] (maps to 1-4 subdivisions), `probability` [0,1]
**Input type:** trigger pattern
**Output type:** trigger pattern with subdivision timing offsets
**Stateless:** yes (per-step coin flip)

Subdivides triggered steps into rapid repeats. Division count determined by `maxDivision`, applied probabilistically.

### 5. Swing / Groove

**Params:** `swingAmount` [0,1] (0=straight, 1=full swing), `swingGrid` [0,1] (which subdivisions swing)
**Input type:** timing information
**Output type:** modified timing offsets
**Stateless:** yes

Shifts timing of alternating steps. At `swingAmount=0.67` this produces classic 2:1 shuffle. `swingGrid` controls whether swing applies to 8th notes, 16th notes, or triplets.

### 6. Density Morph

**Params:** `density` [0,1], `clustering` [0,1] (0=spread evenly, 1=clustered together)
**Input type:** step count
**Output type:** trigger pattern
**Stateless:** yes

Alternative to Euclidean — generates trigger patterns with controllable density and spatial distribution. At high clustering, triggers group together creating bursts; at low clustering, triggers spread evenly.

### 7. Interval Lock (Scale Quantizer)

**Params:** `root` [0,1] (maps to 0-11 semitones), `mode` [0,1] (maps to scale index), `octaveRange` [0,1] (1-4 octaves)
**Input type:** pitch values [0,1]
**Output type:** MIDI note numbers
**Stateless:** yes

Available scales: chromatic, major, natural minor, harmonic minor, pentatonic major, pentatonic minor, blues, dorian, mixolydian, whole tone, diminished.

### 8. Velocity Shaper

**Params:** `curveType` [0,1] (maps to: flat, accent-every-N, crescendo, decrescendo, random), `depth` [0,1], `phase` [0,1]
**Input type:** trigger pattern with step indices
**Output type:** velocity values [0,1] per step
**Stateless:** yes

Applies cyclic velocity patterns. `phase` rotates the pattern, `depth` controls contrast between quiet and loud.

### Primitive Interface

```javascript
// Port-ready: explicit state, no closures
class Primitive {
  constructor(name, paramSchema) { ... }

  // paramSchema: array of { name, min, max, default, boundary }
  // boundary: 'clamp' | 'wrap' | 'scaled'
  // For 'scaled': operates within ±scaledRange of frozen value

  // Pure processing function
  process(params, input, state, stepCount, rng) → { output, nextState }

  // State management for freeze
  getState() → serializable object
  setState(state) → void
  getSeed() → number
  setSeed(seed) → void
}
```

### Chain Connection Modes

Three configurable modes for how primitives connect in a chain:

**1. Sequential Pipeline** — each primitive transforms the previous output. Order matters. Signal flows left to right.

**2. Parallel + Merge** — each primitive runs independently, outputs merged (OR for triggers, average for continuous values). Order doesn't matter.

**3. Typed Routing** — primitives connect via typed ports. A primitive's output connects to the next primitive that accepts that type. Multiple primitives can feed the same type (merged). Most flexible, most complex.

The chain connection mode is a global setting (per-chain), configurable via UI. Default: sequential pipeline.

## Delta Control System

### Freeze Workflow

1. User plays with NISPS, finds a sequence they like
2. User activates **freeze** — all current parameter values are captured
3. User selects specific parameters to **re-expose** (mark as "live"):
   - Click/tap parameters in the UI
   - Or use hand tracking: point with index finger, pinch gesture to toggle
4. Live parameters receive **deltas** from NISPS MLP output
5. Frozen parameters hold their captured values

### Freeze Modes

**Freeze as Algorithm** — captures parameter values + PRNG seed. Stateful primitives (pitch walker) will replay identically. Re-exposing params resumes algorithmic generation with delta-modified params.

**Freeze as Pattern** — captures the realized note pattern (snapshot of all step events for one full loop). The primitive chain is bypassed; the sequencer loops the frozen pattern directly. Re-exposing params requires switching back to algorithm mode.

User chooses freeze mode via UI toggle.

### Delta Boundary Behavior

Each parameter declares its boundary behavior:

| Behavior | Description | Good for |
|----------|-------------|----------|
| `clamp` | Delta result clamped to [0,1] | Velocity, volume, most continuous params |
| `wrap` | Values wrap around (1.1 → 0.1) | Rotation, phase, cyclic params |
| `scaled` | Delta operates within ±`scaledRange` centered on frozen value | Precision control near a sweet spot |

Parameters also declare a `scaledRange` (default 0.3) for the scaled boundary mode. Example: frozen value 0.8 with scaledRange 0.3 → effective range [0.5, 1.0], clamped at boundaries.

## Clock Engine

Replaces setTimeout-based arpeggiator with AudioContext-scheduled timing.

```javascript
class ClockEngine {
  constructor(audioContext) { ... }

  // Properties
  bpm         // beats per minute
  stepCount   // total steps in sequence
  subdivision // ticks per step (for ratchet/swing resolution)

  // Lookahead scheduling: schedule events slightly ahead of time
  // using AudioContext.currentTime for sample-accurate timing
  start() → void
  stop() → void
  setTempo(bpm) → void

  // Callback: called with { stepIndex, time, isAccent }
  onStep(callback) → void
}
```

The clock uses the standard Web Audio lookahead pattern:
- A setInterval (~25ms) checks if any events need scheduling in the next ~100ms
- Events are scheduled using AudioContext.currentTime for sample-accurate timing
- This decouples visual updates (requestAnimationFrame) from audio timing

## Projection Layer

A composable chain of transform functions that convert raw [0,1] MLP outputs into musical values. Each transform is a small, independent module.

### Available Transforms

| Transform | Input | Output | Params |
|-----------|-------|--------|--------|
| Scale Quantizer | [0,1] | MIDI note | root, scale, octave range |
| Velocity Curve | [0,1] | [0,1] | curve shape (linear, exponential, S-curve) |
| Gate Threshold | [0,1] | boolean | threshold value |
| Range Map | [0,1] | [min,max] | min, max |
| Octave Folder | MIDI note | MIDI note | target octave range |
| Stutter Map | [0,1] | repeat count | max repeats |

Transforms snap together: output type of one must match input type of next. The chain is validated on construction.

### Projection Presets

Pre-built chain configurations for common use cases:
- **Melodic Minor** — scale quant (A minor) → octave fold (2 oct) → velocity curve (exponential)
- **Pentatonic Drift** — scale quant (pentatonic) → octave fold (3 oct) → velocity curve (S)
- **Chromatic Chaos** — range map (full MIDI) → velocity curve (linear)
- **Rhythmic Only** — gate threshold (0.5) → velocity curve (accent)

Users can edit any preset or build custom chains.

## UI Design

### Circular Step Visualizer

Steps arranged in a circle with even angular spacing (7 steps = heptagon, 13 steps = 13-gon, etc.). No grid overlay — the ear provides rhythmic context.

**Visual elements:**
- Each step is a node on the circle
- Active/triggered steps glow or pulse
- Current playback position shown with a rotating indicator
- Pitch mapped to node distance from center (low=outer, high=inner)
- Velocity mapped to node size
- Accents shown with brighter color

**Interaction:**
- Tap a step to solo/mute it
- Long-press for step detail (all params for that step)

### Primitive Chain Builder

Vertical stack layout (like a guitar pedalboard):
- Each primitive is a card with its name and key params visible
- Drag to reorder
- Swipe left to delete
- "+" button at bottom opens primitive palette
- Each card expandable to show all params as sliders
- Params marked as "live" (NISPS-controlled) get a distinct visual indicator (e.g., pulsing border)

### Parameter Selection (for freeze/re-expose)

Two input modes:
1. **Mouse/touch** — tap a parameter slider to toggle it between frozen (dimmed) and live (highlighted)
2. **Hand tracking** — point index finger at parameter, pinch to toggle. Visual cursor follows index finger tip.

Live params show their current NISPS delta as a secondary indicator on the slider.

### Layout

```
┌──────────────────────────────────┐
│         Circular Step Viz        │
│        (upper half of screen)    │
│                                  │
│              ○   ○               │
│           ○         ○            │
│          ○     ▶     ○           │
│           ○         ○            │
│              ○   ○               │
│                                  │
├──────────────────────────────────┤
│ Chain Builder (scrollable stack) │
│ ┌──────────────────────────────┐ │
│ │ Euclidean  [steps][pulses]   │ │
│ │            [rotation]        │ │
│ ├──────────────────────────────┤ │
│ │ Prob Gate  [density][accent] │ │
│ ├──────────────────────────────┤ │
│ │ Pitch Walk [step][bias]      │ │
│ ├──────────────────────────────┤ │
│ │        [ + Add Primitive ]   │ │
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│ [▶ Play] [❄ Freeze] [Chain:Seq] │
│ BPM: 120   Steps: 8   Scale: Cm │
└──────────────────────────────────┘
```

## Phased Implementation Plan

### Phase 1 — Foundation (MVP)

**Goal:** All 8 primitives working, chain builder, basic UI, NISPS control. Full architecture with minimal polish.

1. **Event bus** — namespaced pub/sub system
2. **Clock engine** — AudioContext-based precise timing
3. **Primitive framework** — base class, param schema, state management
4. **All 8 primitives** — implement each with their param schemas
5. **Sequential chain** — primitives connected in sequence (pipeline mode only)
6. **Projection layer** — scale quantizer + velocity curve (2 transforms minimum)
7. **Sequence NISPS instance** — second MLP controlling primitive chain params
8. **Basic circular viz** — step circle with playback indicator
9. **Basic chain UI** — vertical stack with sliders, add/remove primitives
10. **Bridge integration** — sequence events → C15 noteOn/noteOff via event bus
11. **Remove arpeggiator** — replace with ShapeSeq

### Phase 2 — Freeze & Delta Control

1. **Freeze system** — capture params + seed, capture pattern snapshot
2. **Parameter selection UI** — click to toggle frozen/live
3. **Delta controller** — applies MLP deltas to live params with boundary config
4. **Hand tracking param select** — pinch gesture to toggle params
5. **Freeze mode toggle** — algorithm vs pattern freeze

### Phase 3 — Advanced Chain & Routing

1. **Parallel + merge chain mode**
2. **Typed routing chain mode**
3. **Input routing matrix** — configurable input → NISPS instance mapping
4. **Projection chain builder** — user-editable transform chains
5. **Projection presets**

### Phase 4 — Polish & Expansion

1. **Preset chains** — pre-built primitive combinations for common genres
2. **Save/load** — persist chain configs, frozen sequences, NISPS state
3. **Unified NISPS mode** — single MLP controlling both timbre + sequence
4. **Additional primitives** as discovered through experimentation
5. **Freeform lasso param selection** (see Future Work)
6. **Per-track variable step counts** (polyrhythm)

## Future Work

- **Freeform lasso selection** — draw/lasso over the step visualization to select params spatially. Intuitive but complex to implement. (Create bd backlog issue.)
- **MIDI clock sync** — accept external MIDI clock for hardware sync
- **OSC output** — route sequencer events via OSC for external software/hardware
- **C++ port** — port primitive framework and chain system to nisps-core for RP2040 firmware
- **Multi-track** — multiple independent primitive chains running simultaneously with different step counts (polyrhythm)
- **Markov chain primitive** — transition-probability-based note selection
- **L-system primitive** — Lindenmayer system string rewriting for self-similar patterns
- **Cellular automata primitive** — 1D CA rules (e.g., Rule 30) generating trigger patterns

## Technical Notes

### Port-Ready JS Conventions

To facilitate future C++ porting:
- No closures in primitive process functions — all state is explicit
- Use typed arrays (Float32Array) for parameter vectors where possible
- Primitives are pure functions with explicit state in/out
- Seeded PRNG (not Math.random()) for deterministic replay
- All time values in seconds (AudioContext convention), not milliseconds

### PRNG

Use a seedable PRNG (e.g., mulberry32 or xoshiro128) so that:
- Freeze-as-algorithm can replay identical sequences from seed
- Different primitives in a chain get independent PRNG streams (derived from a master seed)
- Deterministic behavior aids debugging and reproducibility

### Performance Budget

The sequencer tick runs at most every ~15ms (at 250 BPM with 16th note subdivision). Each tick must:
1. Query NISPS MLP (already fast — the MLP inference is <1ms)
2. Run primitive chain (8 primitives × simple math = negligible)
3. Apply projection transforms (simple lookups/math)
4. Emit events

Total budget per tick: ~5ms. This is comfortable even on mobile.
