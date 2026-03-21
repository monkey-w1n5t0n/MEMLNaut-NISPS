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

- **Output mode tabs** (side panel): switch between Visual and Synth modes.
- **Expand / Collapse** button on the canvas: makes the visual surface nearly full-screen and compresses lower controls into a minimal view.
- **Presets**: quick demo mappings (`Calm/Chaos`, `Rainbow`, `Vortex`) — visual mode only.
- **Help** (`?`) overlay: in-app usage guide.
- **Follow mode**: double-click joystick in RL mode to toggle no-hold interaction.
- **Keyboard in Follow mode (RL)**: `2` = thumbs up, `1` = thumbs down.
- **Gamepad in RL**: `RB` = thumbs up, `LB` = thumbs down.

## Files

- `index.html` - page structure.
- `css/style.css` - layout and visual styling.
- `js/app.js` - app wiring and interaction logic.
- `js/ui/` - visualizer, joystick, controls, parameter display.
- `js/nisps/` - JavaScript MLP + IML core.
- `js/synth/` - C15 WASM bridge, parameter map, arpeggiator.
- `c15/` - C15 engine WASM binary and parameter definitions.
