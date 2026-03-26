# NISPS Control Surface — Comprehensive Spec

## Overview

This spec defines the full control surface for the NISPS playground's immersive app (`a-immersive.html`). The goal: make NISPS work for creatives who need both broad exploration *and* millimeter-precision refinement. The difference between a good guitar player and a great one is within the millimeters and milliseconds — these controls give users that resolution when they want it.

### Design Principles

1. **Compound axes over independent knobs** — Users interact with 3-4 perceptually meaningful axes. Individual parameters exist underneath as overrides, but the default experience is high-level.
2. **Zoom is the core metaphor** — Like Google Maps: same physical movement, different scale of traversal. Zooming in reveals (and teaches) fine structure.
3. **Pinning preserves what works** — Users can protect regions, parameters, or training snapshots from being disturbed while they refine other areas.
4. **Everything is a preset** — Every control state can be saved, restored, and shared. The preset system tames complexity without removing capability.
5. **Embodied first** — Momentum-as-zoom, pressure-sensitive feedback, and vanishing trails make the system feel like an instrument, not a control panel.

### System Diagram

```
                    Physical Input
                    (joystick / hand / gamepad)
                          │
                          ▼
                ┌─────────────────────┐
                │    Input Pipeline   │
                │  deadzone → zoom → │
                │  curve → smoothing → │
                │  momentum scaling   │
                └─────────┬───────────┘
                          │  scaled [0,1]
                          ▼
                ┌─────────────────────┐     ┌──────────────────┐
                │     NISPS MLP       │◄────│  Training Engine  │
                │  (WASM inference)   │     │  LR, iterations,  │
                │                     │     │  convergence       │
                └─────────┬───────────┘     └────────┬─────────┘
                          │  raw [0,1]               │
                          ▼                          │
                ┌─────────────────────┐     ┌────────▼─────────┐
                │  Output Pipeline    │     │  RL Feedback      │
                │  smoothing → slew → │     │  noise, decay,    │
                │  tame → group curve │     │  pinning, zoom-   │
                │  [freeze gate]      │     │  aware scaling     │
                └─────────┬───────────┘     └──────────────────┘
                          │
                    ┌─────┴─────┐
                    ▼           ▼
              Visual Engine  C15 Synth
```

### Pipeline Order Rationale

The input pipeline order is deliberate:

1. **Deadzone** first — kill physical jitter before any processing
2. **Zoom** second — narrow the input window around the anchor
3. **Curve** third — shape movement *within* the zoomed window (so zoomed-in precision gets the benefit of curve shaping, not just the physical input)
4. **Smoothing** fourth — temporal filter on the shaped signal
5. **Momentum scaling** last — velocity-based zoom modulation on the final signal

Alternative orderings are worth experimenting with (curve before zoom means shaping the physical input, which might feel more "instrument-like"). The implementation should make the pipeline order configurable or at least easy to swap during development.

---

## Part 1: Compound Control Axes

These are the primary user-facing controls. Each axis moves multiple underlying parameters along a perceptually coherent dimension.

### Axis 1: Caution ↔ Boldness

*"How adventurous is my exploration?"*

Controls the overall risk/reward balance of the RL loop and weight perturbation.

| Boldness | Input Zoom | Noise Cap | Noise Growth | LR | Weight Decay | Noise Distribution |
|----------|-----------|-----------|-------------|----|--------------|--------------------|
| 0 (Cautious) | 0.1 | 0.02 | 1.1x | 0.1 | 0.15 | gaussian |
| 0.5 (Balanced) | 0.5 | 0.12 | 1.5x | 1.0 | 0.06 | gaussian |
| 1.0 (Bold) | 1.0 | 0.3 | 2.5x | 3.0 | 0.0 | cauchy |

**Perceptual meaning**: At low boldness, everything is gentle — small input range, small perturbations, slow learning, heavy regularisation. At high boldness, full input range, explosive exploration, fast learning, no guardrails.

### Axis 2: Memory ↔ Amnesia

*"How much does the network remember vs adapt to what I'm doing right now?"*

Controls the temporal horizon of learning.

| Memory | Example Capacity | Example Decay | Weight Decay | Noise Decay (per +) | Convergence Threshold |
|--------|-----------------|---------------|--------------|---------------------|-----------------------|
| 0 (Amnesia) | 5 | 0.3 | 0.2 | 0.85 | 1e-3 |
| 0.5 (Balanced) | 50 | 0.7 | 0.06 | 0.97 | 1e-5 |
| 1.0 (Elephant) | 500 | 1.0 | 0.0 | 0.995 | 1e-8 |

**Perceptual meaning**: At low memory, the network forgets quickly — only the last few interactions matter, the mapping is fluid and impermanent. At high memory, every example is sacred, the mapping is stable and hard to shift.

### Axis 3: Precision ↔ Expression

*"How raw and responsive vs filtered and controlled is the input?"*

Controls the input pipeline's character.

| Precision | Input Curve | Deadzone | Smoothing | Slew Rate | Momentum Zoom |
|-----------|-----------|----------|-----------|-----------|---------------|
| 0 (Raw) | linear | 0 | 0 | unlimited | off |
| 0.5 (Balanced) | mild expo (1.5) | 0.05 | 0.15 | 0.3/frame | gentle |
| 1.0 (Precise) | strong expo (3.0) | 0.15 | 0.4 | 0.1/frame | strong |

**Perceptual meaning**: At low precision, input is 1:1 with physical movement — twitchy, expressive, immediate. At high precision, input is heavily shaped — deadzones eat jitter, curves give more resolution in the center, smoothing removes noise, slew rate prevents jumps.

### Axis 4: Stability ↔ Fluidity (stretch goal)

*"How locked-in vs free-flowing are the outputs?"*

Controls post-network output behavior.

| Stability | Output Smoothing | Tame | Global Curve | Pin Strength |
|-----------|-----------------|------|-------------|--------------|
| 0 (Fluid) | 0 | 0 | 1.0 (linear) | none |
| 0.5 (Balanced) | 0.3 | 0.5 | 1.0 | soft pins |
| 1.0 (Locked) | 0.8 | 1.0 | n/a | hard pins |

---

## Part 2: Input Pipeline

### 2.1 Input Zoom

The core navigation control. Narrows the effective input window around an anchor point.

**Metaphor**: Google Maps zoom. Same physical joystick movement, but at zoom=0.1, your full joystick travel covers only 10% of the input space.

**Implementation**:
```
effective_input[i] = anchor[i] + (raw_input[i] - 0.5) * zoom_level
clamped to [0, 1]
```

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `zoom` | 0.01–1.0 (log) | 1.0 | Affects all axes uniformly |
| `zoomX` / `zoomY` | 0.01–1.0 | 1.0 | Per-axis override (joystick only) |
| `anchorMode` | auto / sticky / center | auto | See below |

**Anchor modes**:
- **auto**: Anchor updates to current joystick position whenever zoom level changes. Natural "zoom in on what I'm looking at."
- **sticky**: Anchor stays where last set. Joystick pans within the zoomed window. Change anchor explicitly (e.g., double-tap).
- **center**: Always anchored at (0.5, 0.5). Zooming always narrows toward center of input space.

**Zoom-at-zero = Freeze**: The zoom slider has a detent at the bottom that freezes input. No separate "freeze input" toggle needed — it's the natural limit of zooming in.

**Critical coupling with training**: Zooming in and training teaches the network fine structure in that region. This is the primary refinement workflow:
1. Zoom out → broad explore → find interesting region
2. Zoom in → RL feedback to refine detail
3. Zoom out → verify the big picture wasn't destroyed

**Risk**: Training while zoomed in can distort mappings outside the zoom window. Mitigated by pinning (see Part 4).

### 2.2 Momentum-as-Zoom

An alternative/complementary zoom mechanism tied to movement speed.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `momentumZoom` | off / gentle / strong | off | Toggle, not a slider |
| `velocityWindow` | 50–500ms | 150ms | Time window for velocity estimation |

**When enabled**: Movement speed modulates effective zoom in real time.
- Slow, deliberate movement → high effective zoom (fine control)
- Fast sweeps → low effective zoom (broad traversal)
- Stationary → zoom level holds at last value

**Interaction with explicit zoom**: Momentum zoom multiplies with the manual zoom slider. If manual zoom is 0.5 and you move slowly, effective zoom might be 0.15. If you move fast, effective zoom might be 0.8.

### 2.3 Input Curve

Response curve per input axis. Reshapes the relationship between physical movement and input value.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `inputCurve` | 0.2–5.0 | 1.0 (linear) | Power function exponent |
| `inputCurveX` / `inputCurveY` | 0.2–5.0 | 1.0 | Per-axis override |

**Implementation** (centered power curve):
```
// input in [0,1], centered at 0.5
offset = input - 0.5
shaped = sign(offset) * pow(abs(offset) * 2, exponent) / 2
output = shaped + 0.5
```

- Exponent < 1.0: logarithmic feel — fine at center, coarse at edges
- Exponent = 1.0: linear (no shaping)
- Exponent > 1.0: exponential feel — coarse at center, fine at edges. Good for "I want to stay near center but occasionally sweep to extremes."

### 2.4 Input Deadzone

Percentage of travel from center that produces no change.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `deadzone` | 0–0.4 | 0 (joystick), 0.1 (hands) | Percentage of half-travel |

Remaps the live zone to still cover full [0,1] output range — deadzone doesn't shrink the output, it just eats jitter near center.

### 2.5 Input Smoothing

Exponential moving average on the input signal.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `inputSmoothing` | 0–0.95 | 0 (joystick), 0.3 (hands) | EMA factor (0 = no smoothing) |

**Implementation**:
```
smoothed = smoothing * previous + (1 - smoothing) * raw
```

Higher values = more latency, smoother signal. Essential for hand tracking where raw MediaPipe coordinates jitter.

### 2.6 Axis Invert

| Parameter | Range | Default |
|-----------|-------|---------|
| `invertX` / `invertY` | bool | false |

---

## Part 3: Training Dynamics

### 3.1 Learning Rate

SGD step size passed to WASM `Train()`.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `learningRate` | 0.01–5.0 (log scale) | 1.0 | Affects both example training and RL thumbs-up |

Lower LR = network changes more gently per training call. At 0.01, each thumbs-up barely nudges; at 5.0, each thumbs-up aggressively reshapes. Interacts with max iterations — low LR + low iterations = almost no change; low LR + high iterations = careful convergence.

### 3.2 Max Iterations

How many SGD passes per `train()` call.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `maxIterations` | 10–5000 | 1000 | Higher = more polished fit but longer async wait |

### 3.3 Convergence Threshold

Early-stop when loss drops below this.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `convergenceThreshold` | 1e-8–1e-2 (log) | 1e-5 | Lower = stricter fit |

### 3.4 RL Train Intensity

Number of training calls per thumbs-up event.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `rlTrainIntensity` | 1–10 | 1 | More = stronger reinforcement per positive signal |

### 3.5 Example Memory

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `maxExamples` | 5–500 | 100 | FIFO eviction when full |

### 3.6 Example Decay

Weighted forgetting — older examples contribute less to training loss.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `exampleDecay` | 0.1–1.0 | 1.0 | 1.0 = all equal, 0.5 = half-life per example age |

**Implementation**: During training, each example's loss contribution is weighted by `decay^age` where age is its position from most-recent (0) to oldest (N-1). Requires modifying the WASM training call to accept per-sample weights, or implementing weighted sampling on the JS side before sending to WASM.

---

## Part 4: Pinning System

The ability to say "I like this, don't touch it" — the core of precision refinement.

### 4.1 Region Pinning

Pin a rectangular region of the input space. Training and noise perturbation are suppressed for examples/weights that primarily affect the pinned region.

**Interaction model**:
1. Navigate to the region you like
2. Long-press / dedicated gesture → "Pin this area"
3. A colored overlay appears on the joy-map showing the pinned region
4. Continue exploring elsewhere — pinned region's outputs remain stable

**Implementation approaches** (in order of complexity):

#### Approach A: Example Pinning (simplest)
- When pinning, snapshot all current examples whose inputs fall within the pinned region
- These examples are marked as "pinned" — they're always included in training with high weight and can't be evicted by FIFO
- New training still affects the whole network, but the pinned examples anchor the behavior in that region

#### Approach B: Weight Masking (moderate)
- On pin, snapshot the current weights
- During `moveWeights()`, blend: for each weight, compute how much it contributes to the pinned region (approximated by which input neurons it connects to) and reduce noise proportionally
- During training, add a regularisation term that penalises divergence from the pinned-region snapshot

#### Approach C: Dual Network (most powerful, most complex)
- Maintain a "frozen" copy of weights for pinned regions
- Inference blends: for inputs in/near the pinned region, use frozen weights; for inputs outside, use live weights; blend in the transition zone
- Requires spatial partitioning of the input space

**Recommended starting point**: Approach A (example pinning) — simple, effective, leverages existing training. Approach B as a follow-up.

### 4.2 Parameter Pinning

Pin individual output parameters or parameter groups. Pinned parameters are excluded from `moveWeights()` perturbation and their training targets are held fixed.

This partially exists already — the mute system in the synth visualizer drawer removes params from NISPS control. Pinning is different: the param *stays* NISPS-controlled but its current learned mapping is protected.

**Implementation**:
- Per-param pin flag in the group overrides structure
- During `moveWeights()`, skip weights in the final layer that connect to pinned output nodes
- During training, fix pinned output targets to their current inferred values (so the network maintains its current mapping for those outputs regardless of new examples)

### 4.3 Snapshot Stack (Undo/History)

A stack of weight snapshots that supports multi-level undo and zoom-aware branching.

| Action | Snapshot behavior |
|--------|-------------------|
| Zoom in | Auto-push snapshot ("before refinement") |
| Thumbs-down | Push snapshot (can undo the perturbation) |
| Train | Push snapshot (can undo the training) |
| Randomize | Push snapshot (can undo the randomization) |
| Pin region | Push snapshot + tag as "pinned baseline" |

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `maxSnapshots` | 5–50 | 20 | Ring buffer, oldest evicted |

**UI**: Undo button (single step back). Long-press for snapshot list showing tagged entries.

---

## Part 5: Exploration Noise (RL)

### 5.1 Spread (Master Regime)

Existing parameter, promoted from URL-only to a panel slider.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `spread` | 0–1 | 0.6 | Controls init scale, noise cap, per-layer scaling, weight decay simultaneously |

Spread remains the "personality" of the exploration system. Individual noise parameters below can override spread's derived values.

### 5.2 Noise Floor

Minimum noise level that thumbs-up can't decay below.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `noiseFloor` | 0–0.1 | 0.005 | Higher = always some exploration |

### 5.3 Noise Cap

Maximum noise level reachable via thumbs-down. Overrides spread-derived cap when set explicitly.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `noiseCap` | 0.01–1.0 | derived from spread | `0.3*(1-spread) + 0.05*spread` when not overridden |

### 5.4 Noise Growth Rate

Multiplier per thumbs-down event.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `noiseGrowth` | 1.1–3.0 | 1.5 | Higher = faster escalation to exploration |

### 5.5 Noise Decay Rate

Multiplier per thumbs-up event.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `noiseDecay` | 0.8–0.99 | 0.97 | Lower = faster convergence after positive feedback |

### 5.6 Weight Decay

Per-`moveWeights` call shrinkage. Prevents unbounded weight drift from repeated exploration.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `weightDecay` | 0–0.3 | derived from spread | `0.1 * spread` when not overridden |

### 5.7 Noise Distribution

Shape of random perturbation in `moveWeights()`.

| Parameter | Values | Default | Notes |
|-----------|--------|---------|-------|
| `noiseDistribution` | gaussian / uniform / cauchy | gaussian | Cauchy = rare big jumps, good for escaping local optima |

### 5.8 Layer-Aware Noise

Whether noise scales by 1/sqrt(fan_in) per layer.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `layerAwareNoise` | 0–1 | derived from spread | 0 = flat noise, 1 = Xavier-scaled. Currently tied to spread. |

### 5.9 Zoom-Aware Feedback Scaling

When enabled, feedback intensity scales with zoom level.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `zoomAwareFeedback` | off / on | on | When on: zoomed-in thumbs-down = gentle nudge, zoomed-out = big shake |

**Implementation**: Multiply noise growth and RL train intensity by `zoom_level`. At zoom=0.1, a thumbs-down applies 1/10th the normal perturbation. This is the natural interaction: your feedback matches your exploration scale.

### 5.10 Asymmetric / Pressure-Sensitive Feedback

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `pressureFeedback` | off / on | off | Touch force modulates feedback intensity (where supported) |
| `holdDurationFeedback` | off / on | on | Longer hold = stronger signal (already partially implemented for hand gestures) |

### 5.11 Auto-Explore

Automated thumbs-down at regular intervals. A "wander" mode for weight space — the system drifts continuously while the user only gives thumbs-up when it lands on something good. Useful for hands-free exploration, performance contexts, or when you want to sit back and listen/watch.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `autoExplore` | off / on | off | Toggle |
| `autoExploreInterval` | 0.5–10s | 2s | Time between automatic perturbations |
| `autoExploreIntensity` | 0.1–1.0 | 0.5 | Scales the noise applied per auto-step (relative to current noise level) |

**Interaction with other controls**:
- Respects noise cap, spread, zoom-aware feedback scaling — all the same rules as manual thumbs-down
- Thumbs-up still works normally (trains + decays noise), creating a "selection pressure" against the auto-drift
- Auto-Explore + Follow Mode = fully autonomous exploration (joystick wanders + weights drift + user just watches and occasionally thumbs-up)
- Auto-Explore intensity could scale with zoom: zoomed in = gentler auto-steps, zoomed out = bigger leaps

---

## Part 6: Output Pipeline

### 6.1 Output Smoothing

Temporal smoothing on network outputs. Prevents jarring jumps when the mapping changes.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `outputSmoothing` | 0–0.95 | 0 | EMA factor. Higher = more latency, smoother transitions. |

### 6.2 Output Slew Rate

Maximum change per frame per output. Hard limiter (vs the soft EMA above).

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `outputSlewRate` | 0.005–1.0 | 1.0 (unlimited) | In units per frame. 0.01 = very slow transitions. |

### 6.3 Tame

Existing parameter — constrains synth output ranges toward safe defaults.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `tame` | 0–1 | 1.0 | Already implemented, promote to panel |

### 6.4 Global Output Curve

Apply a single power curve to all outputs.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `globalCurve` | 0.2–5.0 | 1.0 (linear) | < 1 = push toward extremes, > 1 = push toward center |

### 6.5 Freeze Output

Lock current outputs — the network still runs inference as input moves, but the output pipeline doesn't update the synth/visualizer. Use case: "let me hear this sound while I adjust control surface settings" or "hold this visual while I tweak noise parameters."

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `freezeOutput` | bool | false | Gate at the end of the output pipeline |

Distinct from Freeze Input (zoom-at-zero): with Freeze Input, inference stops because input doesn't change. With Freeze Output, inference keeps running (you can watch the heatmap shift) but the audible/visible result stays locked. This lets you preview what *would* change before committing.

### 6.6 A/B Compare

Rapid toggle between two weight states. Snapshot a "reference" state, keep exploring, then flip back and forth to hear/see the difference.

**Interaction model**:
1. Press "A" to snapshot current state (weights + noise level + zoom)
2. Continue exploring (this is the "B" state, live)
3. Toggle A↔B to switch instantly between the two
4. "Accept B" to discard the A snapshot and continue
5. "Revert to A" to restore the snapshot and discard B

| Parameter | Notes |
|-----------|-------|
| `abSnapshot` | Stored weight array + noise level + control state |
| `abActive` | bool — is A/B mode engaged? |

**UI**: Could be a toggle button, or a press-and-hold (hold to hear A, release to return to B — like a preview pedal).

---

## Part 7: Visualization & Feedback

### 7.1 Zoom Minimap

The joy-map canvas shows the zoom window boundary overlaid on the full input space.

**Requirements**:
- Show the full [0,1]x[0,1] input space at all times
- Draw the current zoom window as a rectangle (gets smaller as you zoom in)
- Inside the zoom window, show a "graph paper" grid that subdivides as zoom increases — like zooming into actual graph paper and seeing finer grid lines appear
- Current joystick position shown as a dot within the zoom window
- Pinned regions shown as colored overlays

### 7.2 Vanishing Trail

A fading trail of recent joystick positions on the joy-map.

**Requirements**:
- Trail persists for ~5 seconds, fading from opaque to transparent
- Trail is drawn in the full input space (not zoom-relative), so you can see where you've been even after zooming
- Trail points are clickable/tappable — tap a trail point to snap the joystick back to that position ("I liked what I heard 3 seconds ago, go back")
- Trail color matches current output mode (orange for visual, blue for synth, etc.)
- Optional: trail width encodes zoom level at the time — thicker = more zoomed out, thinner = more zoomed in

The trail already partially exists (joyTrail in a-app.js). This extends it with persistence, interactivity, and zoom-awareness.

### 7.3 Noise Ring

Already exists — ring around joystick showing current noise level.

**Enhancement**: Ring could also encode zoom level (ring radius = zoom, ring thickness = noise). Two concentric rings: inner = zoom window, outer = noise magnitude.

### 7.4 Input Space Heatmap

A 2D color field on the joy-map showing what the network produces across the entire input space. A bird's-eye view of the learned landscape.

**Implementation**:
- Sample the network at a grid of input points (e.g., 8x8 or 16x16)
- For each point, run inference and reduce the output vector to a color (e.g., average output magnitude → brightness, output variance → saturation, dominant output cluster → hue)
- Render as a background layer on the joy-map canvas
- Update on weight change events (train, randomize, moveWeights), NOT every frame
- At higher zoom levels, the heatmap re-samples the zoomed window at the same grid resolution, revealing finer structure (if the network has learned any)

**Use case**: "There's something interesting in that corner — the heatmap shows high variance there, let me navigate over." Also gives immediate visual feedback on whether training actually changed the landscape.

**Cost**: At 16x16 = 256 inference calls per update. With the WASM engine this should be <5ms. Can be throttled to update at most once per 200ms.

**Color reduction strategies** (which to try):
- Mean output luminance (simple, shows "loud" vs "quiet" regions)
- Output entropy / variance (shows "interesting" vs "flat" regions)
- Principal component to RGB (shows the dominant output dimensions as color channels)
- Difference-from-center (shows how much each region diverges from the center point's output)

### 7.5 Weight Health Indicator

A small ambient indicator showing network weight statistics.

| Visual | Meaning |
|--------|---------|
| Calm, low-saturation glow | Weights are well-distributed, network is healthy |
| Hot, pulsing glow | Weights are saturating (high magnitude), sigmoid is clamping |
| Dim/dead | Weights are near-zero, network is underpowered |

Implementation: Compute weight magnitude histogram from `_getFlatWeights()` periodically (not every frame — every 500ms or on weight change events).

### 7.6 Gradient Flow Indicator

During and after training, show per-layer gradient magnitudes — signals whether the network is actually learning or if gradients are vanishing/exploding.

| Visual | Meaning |
|--------|---------|
| Even bars across layers | Healthy gradient flow |
| Bars shrinking left-to-right | Vanishing gradients (deeper layers aren't learning) |
| Bars growing left-to-right | Exploding gradients (unstable training) |
| All bars near zero | Network has converged or is stuck |

**Implementation**: Requires exposing per-layer gradient norms from the WASM training path. Options:
- Add a `nisps_mlp_get_gradient_norms()` binding that returns per-layer L2 gradient norms after a training call
- Or compute approximately on the JS side by measuring weight deltas before/after training (less accurate but no WASM changes)

**Audience**: Power users tuning LR, architecture, or diagnosing why training isn't working. Can be hidden behind an "Advanced" toggle.

---

## Part 8: Engine Configuration (Separate from Runtime Controls)

These require a full network reset and destroy the current mapping. They live in a separate "Engine" panel gated behind a confirmation dialog.

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| `hiddenLayers` | array of ints | [32, 48, 64] | MLP topology |
| `hiddenLayerCount` | 1–6 | 3 | Convenience — resizes the array |
| `outputActivation` | sigmoid / tanh | sigmoid | Final layer activation |
| `hiddenActivation` | relu / leaky_relu / tanh / gelu | relu | Hidden layer activation |

Changing any of these triggers: "This will reset the network and all training. Continue?"

---

## Part 9: Preset System

### Control Presets

Control presets define a complete control surface state (all parameters from Parts 1-6). They do NOT include network weights or training data — those are separate.

**Built-in control presets** (initial set, to be expanded through experimentation):

| Preset | Caution/Boldness | Memory/Amnesia | Precision/Expression | Character |
|--------|-----------------|----------------|---------------------|-----------|
| **Default** | 0.5 | 0.5 | 0.3 | Balanced starting point |
| **First Touch** | 0.2 | 0.7 | 0.6 | Gentle for newcomers. Small changes, stable memory, forgiving input. |
| **Jazz Hands** | 0.8 | 0.2 | 0.0 | Wild exploration. Big noise, short memory, raw input. |
| **Sculptor** | 0.3 | 0.9 | 0.8 | Precision refinement. Small careful changes, long memory, heavy smoothing. |
| **Improviser** | 0.6 | 0.3 | 0.2 | Responsive and forgetful. Medium exploration, recent-biased, low latency. |
| **Microscope** | 0.1 | 1.0 | 1.0 | Maximum zoom, maximum memory, maximum precision. For fine detail work. |

### Preset Storage

```javascript
{
  name: "Sculptor",
  // Compound axis positions (for UI display)
  axes: { boldness: 0.3, memory: 0.9, precision: 0.8, stability: 0.5 },
  // Resolved individual parameters (actual values used)
  input: { zoom: 0.2, momentumZoom: 'gentle', inputCurve: 2.0, deadzone: 0.08, smoothing: 0.3, invertX: false, invertY: false },
  training: { learningRate: 0.3, maxIterations: 2000, convergenceThreshold: 1e-7, rlTrainIntensity: 1, maxExamples: 300, exampleDecay: 0.95 },
  noise: { spread: 0.7, noiseFloor: 0.003, noiseCap: 0.08, noiseGrowth: 1.2, noiseDecay: 0.99, weightDecay: 0.07, noiseDistribution: 'gaussian', layerAwareNoise: 0.8, zoomAwareFeedback: true },
  output: { outputSmoothing: 0.4, outputSlewRate: 0.1, tame: 0.8, globalCurve: 1.0 },
}
```

---

## Part 10: Implementation Priority

### Phase 1 — Core Zoom + Compound Axes ✅ IMPLEMENTED
1. ✅ Input zoom with anchor modes and minimap visualization — `js/ui/input-pipeline.js`, `js/ui/joy-map-enhanced.js`
2. ✅ Zoom-at-zero freeze behavior — `InputPipeline.isFrozen()`, frozen overlay in joy-map
3. ✅ Vanishing trail with tap-to-return — Catmull-Rom spline, ring buffer, 5s duration, zoom-width encoding
4. ✅ Compound axis sliders (Boldness, Memory, Precision) wired to underlying params — `js/ui/control-surface.js`
5. ✅ Spread, LR, noise cap promoted to panel sliders — settings drawer with all params from Parts 2-6
6. ✅ Resolve UI location (Part 11.5) — Option E (hybrid): axes on floating bar, overrides in gear drawer
7. ✅ (bonus) Input curve, deadzone, smoothing, momentum-zoom — all implemented in pipeline, exposed in drawer
8. ✅ (bonus) Zoom-aware feedback scaling — thumbs-down noise scales by zoom level
9. ✅ (bonus) Control presets with offset-based override resolution — 6 built-in presets, trim-pot model
10. ✅ (bonus) Dual concentric noise rings (zoom + noise) replacing CSS-only ring

### Phase 2 — Pinning + History ✅ IMPLEMENTED
7. ✅ Parameter pinning — per-output pin flags, pin mask passed to `moveWeights()`, double-tap to toggle in synth visualizer
8. ✅ Region pinning (Approach A: example pinning) — long-press joy-map pins current zoom window, pinned examples always included in training with high weight
9. ✅ Snapshot stack with undo — ring buffer (20 max), auto-snapshot on train/randomize/thumbs-down, long-press for history popup
10. ✅ A/B Compare toggle — capture A, toggle between states, accept B or revert to A
11. ✅ Modified `mlp.js` moveWeights to accept optional `outputPinMask` for pinned output nodes

### Phase 3 — Input Refinement + Exploration ✅ IMPLEMENTED
12. ✅ Pressure/hold-duration feedback — touch force + hold duration modulate noise growth/decay strength
13. ✅ Auto-Explore mode — automated thumbs-down at configurable interval, zoom-scaled intensity, emerald toggle button with progress ring
14. ✅ Input space heatmap — 16×16 grid inference sampling, 3 color modes (luminance/variance/divergence), zoom-aware resampling, throttled updates

### Phase 4 — Output, Persistence + Polish ✅ IMPLEMENTED
15. ✅ Output pipeline — global curve → smoothing → slew rate → freeze gate, wired into `routeOutputs()`
16. ✅ Weight health indicator — weight magnitude histogram, dead/saturating/healthy status, ambient glow visualization
17. ✅ Gradient flow indicator — per-layer weight-delta analysis, vanishing/exploding/converged detection, bar visualization
18. ✅ Session presets — save/load full state (control surface + synth preset + pipelines), URL sharing via compact params

### Remaining
- Engine configuration panel (Part 8) — network architecture, loss function, optimizer selection

---

## Part 11: Open Design Questions

Issues that need resolution through experimentation. Leaving all possibilities open.

### 11.1 Compound Axis Override Resolution

When a user moves the Boldness axis, it sets ~6 individual parameters. If they then manually override Noise Cap, what happens when they move Boldness again?

**Options**:
- **Axis always wins** — Simple but frustrating. Manual tweaks get blown away.
- **Override sticks** — Manual overrides detach the param from its axis. Moving the axis moves the other 5 params but leaves Noise Cap alone. Visual indicator shows detached params (e.g., dimmed link icon).
- **Override as offset** — The manual tweak becomes a delta on top of the axis-derived value. Moving the axis shifts the base, the offset persists. E.g., if axis says noiseCap=0.12 and user overrides to 0.15, the offset is +0.03. Moving boldness to a new position that says noiseCap=0.08 results in effective noiseCap=0.11.
- **Re-engage gesture** — Double-tap the axis slider to re-link all params. Single moves only affect still-linked params.

All four are worth prototyping. The offset approach is most "musical" (like trim pots on a mixing desk), but the detach approach is most predictable.

### 11.2 Gamepad Input Pipeline

Gamepad sticks (Steam Deck, Xbox) often have OS-level deadzone and response curves applied. The input pipeline would double-process these.

**Options**:
- **Bypass pipeline for gamepad** — Gamepad feeds directly into the zoom stage, skipping deadzone and curve (since the OS already applied them). Smoothing and momentum still apply.
- **Full pipeline, user manages** — Let users set deadzone to 0 for gamepad. Simpler implementation, slight risk of feeling "mushy."
- **Per-input-type pipeline presets** — Different default pipeline settings for joystick vs gamepad vs hand tracking. The "Precision ↔ Expression" axis resolves to different underlying values depending on input type.
- **Raw mode toggle** — Gamepad can request raw stick values (bypassing OS processing) on some platforms. Offer this as an option.

Currently `GamepadInput` in `gamepad.js` maps stick values to joystick position. The pipeline applies on top of that.

### 11.3 Persistence & Sharing

Where are user control presets saved, and how are they shared?

**Storage options**:
- **localStorage** — Current approach for app state (`nisps-a-immersive` key). Natural extension for control presets.
- **URL parameters** — Like existing `?spread=0.6&tame=1`. Enables sharing via link. Gets unwieldy with 30+ params but works well for compound axes (e.g., `?boldness=0.3&memory=0.9&precision=0.8`).
- **Export/Import JSON** — Copy-paste or file download/upload. Full fidelity, shareable, but more friction.
- **Named presets in localStorage** — User can save multiple named presets, select from a dropdown.

**Sharing scenarios**:
- "Try this control setup" → URL with compound axis values
- "Here's my complete session" → JSON export (control preset + synth preset + training data + weights)
- "Starting point for a workshop" → URL with preset name that maps to a built-in

All of these should be possible. URL params for quick sharing, localStorage for persistence, JSON for full export.

### 11.4 Control Presets vs Synth Presets Composition

Control presets (how you explore) and synth presets (what parameters exist and their ranges) are orthogonal. But users will want combined "session" presets.

**Options**:
- **Independent** — Two separate dropdowns. User picks a synth preset AND a control preset. Simple, composable, but requires two decisions.
- **Bundled sessions** — A "session" preset bundles both. "Beginner Sculptor" = beginner-1 synth + Sculptor controls. More opinionated, fewer choices.
- **Synth preset suggests controls** — Loading a beginner synth preset auto-suggests "First Touch" controls. User can override. A soft coupling.
- **All of the above** — Independent selection as the base, with bundled suggestions as convenience shortcuts.

### 11.5 UI Location & Panel Architecture

Where do these controls physically live in the immersive app?

**Options under consideration**:

#### Option A: Settings Drawer (gear icon)
- New gear icon next to the help button (top right)
- Opens a side drawer with compound axis sliders at top, expandable sections for individual params below
- Pro: Doesn't clutter the main performance surface. Con: Hidden, less discoverable.

#### Option B: Extended Bottom Sheet
- Add a "Controls" tab to the existing bottom sheet (alongside the existing examples/training/synth tabs)
- Compound axes as prominent sliders, individual params in expandable sections
- Pro: Consistent with existing architecture. Con: Bottom sheet is already busy.

#### Option C: Floating Control Strip
- A minimal floating strip (like the existing floating bar) with compound axis sliders
- Tap any axis to expand into a popover showing the individual override params
- Pro: Always visible, minimal footprint. Con: Screen real estate on mobile.

#### Option D: Dedicated Mode
- A "Control Surface" mode alongside Visual and Synth modes
- Full-screen control panel when active, hidden during performance
- Pro: Maximum space for controls. Con: Can't adjust while playing.

#### Option E: Hybrid
- Compound axes on the floating bar (always visible, 3 small sliders)
- Individual overrides in a settings drawer (gear icon)
- Pinning/zoom controls integrated into the joy-map (contextual, spatial)
- A/B compare as a floating toggle button near the RL buttons

This is likely the right approach — distribute controls by frequency of use and spatial relevance.

---

## Appendix A: Hand Tracking Zoom

For hand tracking's 14 input dimensions, per-axis zoom is unmanageable. Instead, group inputs into semantic clusters:

| Group | Inputs | Description |
|-------|--------|-------------|
| **Position** | palmX, palmY, depth | Spatial position of the hand |
| **Pose** | 5 finger curls, finger spread | Hand shape |
| **Orientation** | pitch, yaw, roll | Hand rotation |
| **Pinch** | pinch distance, pinch confidence | Fine gesture |

Each group gets a single zoom slider. This is a backlog item for deeper exploration — see beads issue.

## Appendix B: Zoom-Training Coupling

When zoomed in, the training dynamics change fundamentally:

1. **Examples are clustered** — all new examples fall within the zoom window. The network learns fine distinctions in this small region.
2. **Risk of catastrophic forgetting** — the network may distort its mapping for inputs outside the zoom window, since it's not seeing examples from those regions.
3. **Pinning mitigates this** — pinned examples from the broader region anchor the network's behavior outside the zoom window.

**Recommended workflow for refinement**:
1. Explore broadly, find a mapping you mostly like
2. Pin the regions/parameters you want to keep
3. Zoom into the area that needs refinement
4. Use RL feedback at the zoomed-in scale
5. Zoom back out to verify the big picture
6. Unpin and iterate

This workflow should be surfaced in the help modal and possibly guided by an onboarding tooltip sequence.
