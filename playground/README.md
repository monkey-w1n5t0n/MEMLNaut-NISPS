# NISPS Playground

Browser-based interactive demo of the NISPS ML engine.

## Run locally

```bash
python3 -m http.server
# Open http://localhost:8000
```

Run the command from the `playground/` directory.

## What it does

- Maps 2D joystick input (X/Y) through an MLP to 20 visualization parameters.
- Renders a flow-field particle visualization on a Canvas2D surface.
- Supports two learning modes:
  - **Examples**: add explicit input/output pairs and train.
  - **RL Feedback**: give thumbs up/down while exploring outputs.

## UI controls

- **Expand / Collapse** button on the canvas: makes the visual surface nearly full-screen and compresses lower controls into a minimal view.
- **Presets**: quick demo mappings (`Calm/Chaos`, `Rainbow`, `Vortex`).
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
