# NISPS Playground

Browser-based interactive demo of the NISPS ML engine.

## Run locally

```bash
python3 -m http.server
# Open http://localhost:8000
```

Run the command from the `playground/` directory.

## What it does

- Maps 2D joystick input (X/Y) through an MLP (`[3, 32, 48, 64, 126]`) to 126 outputs.
- **Visual mode**: first 20 outputs drive a flow-field particle visualization on Canvas2D.
- **Synth mode (C15)**: all 126 outputs control the C15 WASM synthesizer — envelopes, oscillators, shapers, filters, feedback/output mixers, cabinet, and effects.
- Supports two learning modes:
  - **Examples**: add explicit input/output pairs and train.
  - **RL Feedback**: give thumbs up/down while exploring outputs.

## C15 synth parameters

The 126 synth parameters (`js/synth/param-map.js`) cover all sonically meaningful continuous parameters of the C15 engine. Excluded from the C15's 287 total params:

- Hardware routing (56) — no physical MIDI in browser
- Macro controls (12) — conflicts with direct ML control
- Scale/tuning (13) — would break pitch
- Key tracking / velocity (22) — depend on note context ML can't observe
- Envelope mod depths (19) — too many multiplicative interactions for 2-input ML
- Discrete/structural/dangerous (19) — pitch sweep, volume, switches, resets
- Secondary config (15) — curves, chirp, shaper blend, source selects

## UI controls

- **Output mode tabs** (floating bar): switch between Visual and Synth modes.
- **Expand / Collapse** chevron: expands bottom sheet with training controls, synth settings, advanced param sliders.
- **Synth presets**: tiered presets (Beginner → Expert) control which of the 126 params the ML engine can modify.
- **Help** (`?`) overlay: in-app usage guide.
- **Follow mode**: double-click joystick in RL mode to toggle no-hold interaction.
- **Keyboard in Follow mode (RL)**: `2` = thumbs up, `1` = thumbs down.
- **Gamepad in RL**: `RB` = thumbs up, `LB` = thumbs down, `A` = train, `X` = randomize, `B` = clear.

## Control Surface

The immersive app has a control surface system (Phase 1 of `SPEC-controls.md`) for tuning how exploration and learning feel.

**Compound axes** on the floating bar (3 sliders: Bold, Mem, Prec):

| Axis | Controls | Low end | High end |
|------|----------|---------|----------|
| **Boldness** | Input zoom, noise cap, noise growth, LR, weight decay | Cautious: small changes, heavy regularisation | Bold: full range, explosive exploration, fast learning |
| **Memory** | Max examples, example decay, noise decay, convergence | Amnesia: only last few interactions matter | Elephant: every example sacred, stable mapping |
| **Precision** | Input curve, deadzone, smoothing, slew rate, momentum | Raw: 1:1 with physical movement, twitchy | Precise: heavy shaping, deadzones, smooth |

**Settings drawer** (gear icon, bottom-right): individual param overrides for Input, Training, Exploration, and Output sections. Manual overrides persist as offsets when compound axes move (trim-pot model). Double-tap an axis to re-link all params.

**Control presets**: Default, First Touch, Jazz Hands, Sculptor, Improviser, Microscope.

**Input pipeline**: joystick input is processed through deadzone → zoom → curve → smoothing → momentum-as-zoom before reaching the MLP. Zoom narrows the effective input window around an anchor. Zoom-at-zero freezes input.

**Enhanced joy-map**: zoom minimap with adaptive grid (4×4 → 32×32), vanishing trail with tap-to-return, dual noise rings (zoom + noise level).

## Files

### Original app (index.html)
- `index.html` - page structure.
- `css/style.css` - layout and visual styling.
- `js/app.js` - app wiring and interaction logic.

### Immersive app (a-immersive.html)
- `a-immersive.html` - fullscreen immersive UI.
- `css/a-immersive.css` - immersive layout and styling.
- `js/a-app.js` - immersive app wiring, state management, persistence.

### Shared modules
- `js/nisps/` - JavaScript MLP + IML core (also WASM variant).
- `js/ui/visualizer.js` - flow-field particle system (Canvas2D).
- `js/ui/joystick.js` - virtual joystick component.
- `js/ui/gamepad.js` - gamepad input handling.
- `js/ui/hand-tracker.js` - MediaPipe hand tracking (14 features).
- `js/ui/input-pipeline.js` - input processing pipeline (zoom, deadzone, curve, smoothing, momentum).
- `js/ui/control-surface.js` - compound axes, override resolution, control presets.
- `js/ui/control-surface-ui.js` - settings drawer and floating bar axis sliders.
- `js/ui/joy-map-enhanced.js` - zoom minimap, vanishing trail, dual noise rings.
- `js/synth/` - C15 WASM bridge, parameter map, presets, arpeggiator.
- `c15/` - C15 engine WASM binary and parameter definitions.
- `SPEC-controls.md` - comprehensive control surface spec (4 phases).
