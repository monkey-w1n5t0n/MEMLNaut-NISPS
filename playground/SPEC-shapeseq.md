# ShapeSeq — NISPS Generative Sequencing System

## Overview

ShapeSeq is a generative sequencing system for the NISPS playground where interactive ML (via the NISPS MLP engine) controls **parameters of algorithmic sequencing primitives** rather than raw note data. The user shapes sequences by navigating a learned parameter space with a joystick or hand tracking, can freeze sequences they like, then selectively re-expose specific parameters for further ML-driven exploration.

ShapeSeq replaces the existing placeholder arpeggiator. In synth output mode, the ShapeSeq UI (circular step visualizer + chain builder + param sliders) replaces the flow-field particle system.

## Core Architecture

### Design Principles

1. **MLP outputs are abstract [0,1] values** — musical meaning is applied downstream by the primitive chain and its symbolic processing
2. **Separate NISPS instances** for timbre control and sequence control, following the existing `imlJoy`/`imlHand` dual-instance pattern in `a-app.js`. Architecture supports future unification into a single instance
3. **Port-ready JS** — no closures in hot paths, explicit state, data structures that map cleanly to C++ for future RP2040 firmware porting. Note: the event bus and clock orchestration are JS-only concerns and not expected to port directly; the primitives themselves are the portable layer
4. **Modular primitives** — small, combinable algorithmic building blocks that generate musical patterns from continuous parameters
5. **Symbolic chain** — primitives compose as transforms over a pattern *description*, not concrete values. Each primitive takes the previous "pattern-generating machine" specification and produces a new one. The chain is evaluated once per loop (or on param change) to produce a complete pattern, which the clock then steps through

### System Diagram

```
              ┌──────────────────┐
              │   Clock Engine   │  ← drives everything
              │  (AudioContext)  │
              └──────┬───────────┘
                     │ tick
                     ▼
              ┌──────────────────┐     ┌─────────────────┐
              │  Sequencer Core  │◄────│  Input Router   │
              │  (orchestrator)  │     │ (configurable)  │
              └──┬───────────┬───┘     └──┬──────────┬───┘
                 │           │            │          │
                 │ query     │ query ┌────▼───┐ ┌───▼────────┐
                 │ pattern   │ MLP   │NISPS   │ │ NISPS MLP  │
                 │           │       │(timbre)│ │ (sequence)  │
                 │           │       └───┬────┘ └───┬────────┘
                 │           │           │          │
                 │    ┌──────▼────────┐  │   ┌─────▼──────────┐
                 │    │ Param Mapping │  │   │ Param Mapping   │
                 │    │ (16 MLP outs  │  │   │ (16 MLP outs →  │
                 │    │  → N prim     │  │   │  126 synth      │
                 │    │  params)      │  │   │  params)        │
                 │    └──────┬────────┘  │   └─────┬──────────┘
                 │           │           │         │
                 │    ┌──────▼────────┐  │  ┌─────▼──────────┐
                 │    │Delta Controller│ │  │ Synth Param Map │
                 │    │(frozen+deltas)│  │  └─────┬──────────┘
                 │    └──────┬────────┘  │        │
                 │           │           │        │
                 │    ┌──────▼────────┐  │        │
                 │    │Primitive Chain │  │        │
                 │    │(symbolic eval) │  │        │
                 │    └──────┬────────┘  │        │
                 │           │           │        │
          ┌──────▼───────────▼───┐       │        │
          │ Namespaced Event Bus │       │        │
          │ seq.* ml.* ui.*      │       │        │
          └──┬───────────────┬───┘       │        │
             │               │           │        │
      ┌──────▼───────┐ ┌────▼───────────▼────────▼──┐
      │ Circular Viz  │ │        C15 Synth           │
      │ + Chain UI    │ │   (noteOn/Off + params)    │
      └──────────────┘ └────────────────────────────┘
```

### Fixed MLP + Param Mapping Layer

The `WasmIML` creates an MLP with a **fixed output count** at construction time — it cannot be resized. Since the primitive chain is dynamic (users add/remove primitives, changing total param count), the MLP cannot output directly to primitive params.

**Solution:** The sequence MLP always outputs a fixed number of values (e.g., 16). A **param mapping layer** fans these 16 outputs to however many primitive params the current chain requires. This is the same pattern used by the timbre MLP (which maps to 126 synth params via `param-map.js`).

The mapping can be:
- **Automatic** (default): outputs are distributed across primitive params in chain order. If there are 30 primitive params and 16 MLP outputs, each output influences ~2 params via interpolation.
- Future: configurable user-defined mapping.

> **Design note:** The fixed-16-output approach is the simplest starting point. If experimentation reveals that 16 is too few (or too many), the MLP can be reconstructed with a different size — this is a one-time setup cost, not a per-frame cost. The mapping layer insulates the rest of the system from this choice. Revisit if the mapping layer becomes a bottleneck for expressiveness.

### Namespaced Event Bus

A pub/sub event system with namespaced channels:

| Namespace | Events | Purpose |
|-----------|--------|---------|
| `seq.*` | `seq.step`, `seq.noteOn`, `seq.noteOff`, `seq.paramChange`, `seq.loopStart` | Musical output from sequencer to synth and visualizer |
| `ml.*` | `ml.trained`, `ml.frozen`, `ml.unfrozen`, `ml.deltaUpdate` | ML state changes |
| `ui.*` | `ui.paramSelect`, `ui.chainEdit`, `ui.presetLoad`, `ui.freezeToggle` | User actions |

All events carry a timestamp (AudioContext.currentTime for `seq.*`, performance.now() for others).

Note: the event bus is a JS-only orchestration concern (string-namespaced pub/sub). It does not need to be port-ready — the portable layer is the primitives themselves.

### Input Routing Matrix

A configurable routing layer that maps any input source to either NISPS instance's inputs. Builds on the existing `imlJoy`/`imlHand` switching pattern in `a-app.js`.

**Input sources:**
- Joystick X, Y (2 values)
- Hand tracking features (14 values)
- Gamepad axes (variable)

**Routing targets:**
- Timbre NISPS input 0, input 1
- Sequence NISPS input 0, input 1

Default: joystick → timbre NISPS, hand tracking features 0+1 → sequence NISPS. User-configurable via UI.

## Sequencing Primitives

### Primitive Categories

Primitives are categorized by their role in the chain:

| Category | Role | Examples |
|----------|------|----------|
| **Generator** | Produces data from params alone (no input required) | Euclidean, Density Morph, Pitch Walker |
| **Processor** | Transforms incoming data | Probability Gate, Velocity Shaper |
| **Timing Modifier** | Modulates the timing of events in the pattern description | Swing/Groove, Ratchet |
| **Converter** | Changes data type (e.g., continuous → discrete) | Interval Lock |

**Generator combination rule:** When multiple generators appear in the same chain, their outputs combine according to the chain's **combination mode** (user-configurable in real time):
- **Additive** (OR) — triggers from any generator fire. Pitch/velocity values are averaged where multiple generators contribute.
- **Multiplicative** (AND) — only steps where ALL generators agree will fire. Creates sparser, more selective patterns.

### Symbolic Chain Evaluation

Primitives do NOT process concrete note data step-by-step. Instead, each primitive takes the previous **pattern description** (a symbolic representation of the entire sequence) and produces a new one. The complete chain is evaluated to produce a full pattern, which the clock then steps through.

This means:
- **Timing modifiers** (Swing, Ratchet) work by annotating the pattern description with timing offsets and subdivisions *before* any concrete scheduling happens
- The clock reads the finalized pattern description and schedules all events (including ratchet subdivisions and swing offsets) using AudioContext.currentTime
- Re-evaluation happens when params change (MLP output updates, user edits), not on every tick

**Pattern description structure:**
```javascript
// The symbolic output of the chain — a complete loop description
{
  steps: [
    {
      trigger: true,          // whether this step fires
      pitch: 0.72,            // [0,1] abstract pitch (pre-quantization)
      velocity: 0.85,         // [0,1]
      accent: false,          // accent flag
      timeOffset: 0.0,        // swing offset in fractions of a step (-0.5 to +0.5)
      subdivisions: 1,        // ratchet: 1 = normal, 2-4 = subdivided
    },
    // ... one per step
  ],
  stepCount: 8,
  metadata: { ... }           // chain-specific info for visualization
}
```

### Primitive Definitions

Each primitive is a pure function (or stateful generator with explicit state) that accepts a parameter object and produces typed output. All parameters are normalized [0,1].

#### 1. Euclidean Rhythm Generator

**Category:** Generator
**Params:** `steps` (int, from continuous), `pulses` (int), `rotation` (int)
**Output:** trigger pattern (boolean array)
**Stateless:** yes

Generates Bjorklund-distributed trigger patterns. The continuous [0,1] params are projected to integer ranges based on current step count.

#### 2. Probability Gate

**Category:** Processor
**Params:** `density` [0,1], `accentProbability` [0,1]
**Input:** trigger pattern
**Output:** filtered trigger pattern with accent flags
**Stateless:** yes (per-step coin flip using seeded PRNG)

Each incoming trigger survives with probability `density`. Surviving triggers receive accent flag with probability `accentProbability`.

#### 3. Pitch Walker

**Category:** Generator
**Params:** `stepSize` [0,1], `directionBias` [0,1] (0.5=unbiased), `gravity` [0,1] (pull toward center), `range` [0,1]
**Output:** pitch values [0,1] per triggered step
**Stateful:** yes — maintains current position in pitch space

Constrained random walk that generates melodic contour. `gravity` pulls the walk toward center (0.5), preventing it from getting stuck at extremes. State includes current position and PRNG state.

#### 4. Ratchet

**Category:** Timing Modifier
**Params:** `maxDivision` [0,1] (maps to 1-4 subdivisions), `probability` [0,1]
**Input:** pattern description with triggers
**Output:** pattern description with `subdivisions` field set per step
**Stateless:** yes (per-step coin flip)

Annotates triggered steps with subdivision counts. The clock engine reads `subdivisions` and schedules rapid repeats within the step's time window. Division count determined by `maxDivision`, applied probabilistically.

#### 5. Swing / Groove

**Category:** Timing Modifier
**Params:** `swingAmount` [0,1] (0=straight, 1=full swing), `swingGrid` [0,1] (which subdivisions swing)
**Input:** pattern description
**Output:** pattern description with `timeOffset` field set per step
**Stateless:** yes

Annotates alternating steps with timing offsets. At `swingAmount=0.67` this produces classic 2:1 shuffle. `swingGrid` controls whether swing applies to 8th notes, 16th notes, or triplets. The clock engine reads `timeOffset` and adjusts scheduling accordingly.

#### 6. Density Morph

**Category:** Generator
**Params:** `density` [0,1], `clustering` [0,1] (0=spread evenly, 1=clustered together)
**Output:** trigger pattern
**Stateless:** yes

Alternative to Euclidean — generates trigger patterns with controllable density and spatial distribution. At high clustering, triggers group together creating bursts; at low clustering, triggers spread evenly.

#### 7. Interval Lock (Scale Quantizer)

**Category:** Converter
**Params:** `root` [0,1] (maps to 0-11 semitones), `mode` [0,1] (maps to scale index), `octaveRange` [0,1] (1-4 octaves)
**Input:** pitch values [0,1]
**Output:** MIDI note numbers
**Stateless:** yes

The sole pitch quantization mechanism — the projection layer does NOT duplicate this. All pitch quantization goes through Interval Lock.

Available scales: chromatic, major, natural minor, harmonic minor, pentatonic major, pentatonic minor, blues, dorian, mixolydian, whole tone, diminished.

#### 8. Velocity Shaper

**Category:** Processor
**Params:** `curveType` [0,1] (maps to: flat, accent-every-N, crescendo, decrescendo, random), `depth` [0,1], `phase` [0,1]
**Input:** trigger pattern with step indices
**Output:** velocity values [0,1] per step
**Stateless:** yes

Applies cyclic velocity patterns. `phase` rotates the pattern, `depth` controls contrast between quiet and loud.

### Primitive Interface

```javascript
// Port-ready: explicit state, no closures
class Primitive {
  constructor(name, paramSchema, category) { ... }

  // category: 'generator' | 'processor' | 'timing' | 'converter'

  // paramSchema: array of { name, min, max, default, boundary }
  // boundary: 'clamp' | 'wrap' | 'scaled'
  // For 'scaled': operates within ±scaledRange of frozen value

  // Symbolic processing: transforms a pattern description
  process(params, patternDesc, state, rng) → { patternDesc, nextState }

  // State management for freeze
  getState() → serializable object
  setState(state) → void
  getSeed() → number
  setSeed(seed) → void
}
```

### Chain Connection Modes

Three configurable modes for how primitives connect in a chain:

**1. Sequential Pipeline** — each primitive transforms the pattern description in order. Generators create initial data, processors/timing modifiers transform it. If multiple generators appear, they combine according to the generator combination mode (additive/multiplicative, configurable in real time).

**2. Parallel + Merge** — each primitive runs independently and produces a pattern description. Descriptions merge (OR for triggers in additive mode, AND in multiplicative mode; average for continuous values). Order doesn't matter.

**3. Typed Routing** — primitives connect via typed ports. A primitive's output connects to the next primitive that accepts that type. Multiple primitives can feed the same type (merged). Most flexible, most complex.

The chain connection mode is a global setting (per-chain), configurable via UI. Default: sequential pipeline.

**Generator combination mode** (additive/multiplicative) is an independent setting, also configurable in real time via UI.

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

  // Lookahead scheduling: schedule events slightly ahead of time
  // using AudioContext.currentTime for sample-accurate timing
  start() → void
  stop() → void
  setTempo(bpm) → void

  // The clock reads the finalized pattern description and schedules
  // all events, including:
  // - timeOffset per step (swing)
  // - subdivisions per step (ratchet)
  // - accent flags (velocity scaling)
  schedulePattern(patternDesc) → void

  // Callback: called with { stepIndex, time, velocity, pitch, isSubdivision }
  onEvent(callback) → void
}
```

The clock uses the standard Web Audio lookahead pattern:
- A setInterval (~25ms) checks if any events need scheduling in the next ~100ms
- Events are scheduled using AudioContext.currentTime for sample-accurate timing
- This decouples visual updates (requestAnimationFrame) from audio timing
- The clock handles ratchet subdivisions and swing offsets natively by reading the pattern description's per-step `subdivisions` and `timeOffset` fields

## Projection Layer

A composable chain of transform functions that convert raw [0,1] primitive outputs into final musical values. Each transform is a small, independent module.

Note: pitch quantization is handled by the **Interval Lock** primitive, not the projection layer. The projection layer handles non-pitch transforms only.

### Available Transforms

| Transform | Input | Output | Params |
|-----------|-------|--------|--------|
| Velocity Curve | [0,1] | [0,1] | curve shape (linear, exponential, S-curve) |
| Gate Threshold | [0,1] | boolean | threshold value |
| Range Map | [0,1] | [min,max] | min, max |
| Octave Folder | MIDI note | MIDI note | target octave range |
| Stutter Map | [0,1] | repeat count | max repeats |

Transforms snap together: output type of one must match input type of next. The chain is validated on construction.

### Projection Presets

Pre-built chain configurations for common use cases:
- **Expressive** — velocity curve (exponential) → range map (48-84)
- **Percussive** — gate threshold (0.5) → velocity curve (accent)
- **Full Range** — range map (24-96) → velocity curve (linear)

Users can edit any preset or build custom chains.

## UI Design

### Mode Integration

ShapeSeq activates in **synth output mode**. When synth mode is active:
- The flow-field particle visualizer is replaced by the ShapeSeq UI (circular step viz + chain builder + param sliders)
- The timbre NISPS instance continues to control C15 synth parameters as before
- The sequence NISPS instance drives the ShapeSeq primitive chain

In visual output mode, the particle system remains unchanged.

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
│ [+×] BPM:120  Steps:8  Gen:Add  │
└──────────────────────────────────┘
```

## Phased Implementation Plan

### Phase 1 — Foundation (MVP)

**Goal:** All 8 primitives working, chain builder, basic UI, NISPS control. Full architecture with minimal polish.

1. **Event bus** — namespaced pub/sub system
2. **Clock engine** — AudioContext-based precise timing with pattern description scheduling (handles swing offsets + ratchet subdivisions)
3. **Primitive framework** — base class, param schema, category system, state management, symbolic pattern description structure
4. **All 8 primitives** — implement each with their param schemas and categories
5. **Sequential chain** — primitives connected in sequence (pipeline mode only), with additive/multiplicative generator combination mode
6. **Param mapping layer** — fixed 16-output MLP → N primitive params, automatic distribution
7. **Projection layer** — velocity curve + gate threshold (2 transforms minimum, no scale quantizer — that's Interval Lock)
8. **Sequence NISPS instance** — second WasmIML (16 outputs), following existing `imlJoy`/`imlHand` pattern
9. **Basic circular viz** — step circle with playback indicator
10. **Basic chain UI** — vertical stack with sliders, add/remove primitives, generator combo mode toggle
11. **Bridge integration** — sequence events → C15 noteOn/noteOff via event bus
12. **Replace arpeggiator** — remove old arpeggiator, ShapeSeq takes over in synth mode

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

## Open Design Questions

These are deliberately deferred decisions to be revisited after experimentation:

1. **MLP output count:** Is 16 the right number for the sequence MLP? Too few may limit expressiveness; too many may make learning harder. The param mapping layer insulates the system, so this can be changed without architectural impact.
2. **Param mapping strategy:** Automatic distribution is the starting point. Should users be able to manually wire MLP outputs to specific primitive params? This could enable more intentional control but adds UI complexity.
3. **Generator combination modes:** Additive and multiplicative are the starting pair. Other modes worth exploring: weighted average, priority (first generator wins), XOR (one or the other but not both).
4. **Chain evaluation frequency:** Currently re-evaluates when params change. Should there be an option for per-loop re-evaluation (stateful primitives produce different patterns each loop)?

## Future Work

- **Freeform lasso selection** — draw/lasso over the step visualization to select params spatially. Intuitive but complex to implement. (Backlog issue: meml-hud)
- **MIDI clock sync** — accept external MIDI clock for hardware sync
- **OSC output** — route sequencer events via OSC for external software/hardware
- **C++ port** — port primitive framework and chain system to nisps-core for RP2040 firmware
- **Multi-track** — multiple independent primitive chains running simultaneously with different step counts (polyrhythm)
- **Markov chain primitive** — transition-probability-based note selection
- **L-system primitive** — Lindenmayer system string rewriting for self-similar patterns
- **Cellular automata primitive** — 1D CA rules (e.g., Rule 30) generating trigger patterns

## Technical Notes

### Port-Ready JS Conventions

To facilitate future C++ porting of the **primitive layer**:
- No closures in primitive process functions — all state is explicit
- Use typed arrays (Float32Array) for parameter vectors where possible
- Primitives are pure functions with explicit state in/out
- Seeded PRNG (not Math.random()) for deterministic replay
- All time values in seconds (AudioContext convention), not milliseconds

The orchestration layer (event bus, clock, UI) is JS-only and not expected to port.

### PRNG

Use a seedable PRNG (e.g., mulberry32 or xoshiro128) so that:
- Freeze-as-algorithm can replay identical sequences from seed
- Different primitives in a chain get independent PRNG streams (derived from a master seed)
- Deterministic behavior aids debugging and reproducibility

### Performance Budget

The chain evaluates on param change, not per tick. The clock merely steps through the pre-computed pattern description. Per-tick cost is minimal: read the next step from the pattern, schedule the event. MLP inference (~<1ms) only runs when input changes.

Chain re-evaluation (all 8 primitives) happens when the MLP output changes. At ~60fps input update rate, this means ~16ms budget per evaluation. Each primitive is simple math, so 8 primitives is well within budget even on mobile.
