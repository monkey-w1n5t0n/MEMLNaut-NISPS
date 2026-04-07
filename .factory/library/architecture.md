# Architecture

How the MEMLNaut NISPS SolidJS app works.

## High-Level Architecture

```
index.html
  └── App.tsx (root component, provider tree)
      ├── BusProvider (signal bus context)
      ├── MLProvider (ML store context)
      ├── InputProvider (input store context)
      ├── OutputProvider (output store context)
      ├── SynthProvider (synth store context)
      ├── EOCProvider (EOC store context)
      └── SessionProvider (persistence)
            └── ImmersiveLayout.tsx
                ├── Background canvases (FlowField or SynthVisualizer)
                ├── HeatmapStrip
                ├── Joystick + JoyMap
                ├── RLButtons
                ├── Dock + DrawerStack
                └── Floating controls
```

## Data Flow

```
User Input (drag/gamepad/hands)
  → Input Store (joyX, joyY)
  → Input Pipeline (deadzone, zoom, curve, smoothing)
  → ML Store (setInputs on IML)
  → IML.process() (WASM inference)
  → Outputs Signal (Float32Array, single signal write)
  → Output Routing (apply overrides, route by mode)
  ├── FlowField (visual mode, own rAF loop reads signal)
  ├── SynthEngine (synth mode, throttled 50ms)
  ├── MIDIOutput (midi-cc mode)
  └── AudioCanvas (audio-canvas mode)
```

## Key Components

### Signal Bus (`bus/signal-bus.ts`)
Unified event system replacing EventBus + CustomEvents. Topics with `equals: false` for event semantics. Wildcard matching via `match()`.

### ML Store (`stores/ml-store.ts`) — IMPLEMENTED
- Factory function `createMLStore(bus)` returns `Promise<MLStore>`
- Dual WasmIML instances: `imlJoy` (2 inputs), `imlHand` (14 inputs)
- `outputs` is a `createSignal<Float32Array>` (NOT a store property — proxies break typed arrays)
- `outputCount` signal tracks current MLP output dimension
- Store state (via createStore): outputMode, midiCCCount, spreadLevel, initialized
- Mode switching via `setOutputMode()` triggers MLP recreation with warm-start weight transfer
- Output count per mode: visual=20, synth=126, midi-cc=8 (configurable), audio-canvas=36
- All ML operations exposed as methods: setInputs, train, trainAsync, randomise, thumbsUp, thumbsDown, etc.
- `noiseLevel` signal — reactive RL exploration noise level (default 0.05)
- `exampleCountSignal` — reactive example count (updates on add/clear)
- `lastLossSignal` — reactive loss value (updates after training)
- `addExample()` — adds current I/O as training example, updates reactive count
- `clearAll()` — clears examples, loss history, resets noise to default
- `getLossHistory()` — returns copy of loss history array
- Undo stack: ring buffer (max 20 entries) of weight snapshots with noise level. `pushUndoSnapshot()` called before `thumbsDown()` and `randomise()`. `undo()` pops snapshot, restores weights and noise. `undoDepthSignal` — reactive depth for UI button state.
- `dispose()` destroys both IML instances (called in App.tsx onCleanup)
- Bus topics created: `ml.outputs`, `ml.outputCount`, `mode.output`
- Debug probe (`probe/debug-probe.ts`) now wraps MLStore instead of raw WasmIML
- `window.__nispsStore` exposed for test access to store methods like `setOutputMode()`
- `_updateOutputs(Float32Array)` — internal method for direct output signal update (used by HeatmapStrip drag-to-set)

### Input Store (`stores/input-store.ts`) — IMPLEMENTED
- Factory function `createInputStore(mlStore, bus)` returns `InputStore`
- joyX, joyY as signals (createSignal, default 0.5)
- isDragging signal tracks active pointer interaction
- followMode signal (toggled by double-tap on joystick)
- `setJoystickPosition(x, y)` clamps to [0,1], guards NaN/Infinity, updates signals + calls ML store setInputs
- Bus topics created: `input.position`
- `window.__nispsInputStore` exposed for e2e test access

### Joystick Component (`components/input/Joystick.tsx`) — IMPLEMENTED
- Canvas-based virtual joystick (180px default size)
- Pointer events (unified mouse/touch): pointerdown → pointermove → pointerup
- Canvas drawing: background circle, crosshair grid, draggable thumb dot, glow effect
- Double-click toggles follow mode (badge + pulse animation)
- Position readout (HOLD/FOLLOW mode label + coordinates)
- Glass morphism styling with CSS custom properties
- Exposed as `#joystick` container for e2e test targeting

### FlowField Component (`components/visual/FlowField.tsx`) — IMPLEMENTED
- Fullscreen Canvas2D particle system (position: fixed, inset: 0)
- Driven by first 20 ML outputs via `FlowFieldVisualizer` (core/ui/flow-field.ts)
- Own rAF render loop — starts when outputMode === 'visual', stops otherwise
- Canvas resizes via ResizeObserver (reinitializes particles on resize)
- 400 particles with flow-field noise, attraction, dispersion, repulsors, trail effects
- 20 parameters: angleOffset, scale, speed, hueBase, hueSpread, particleSize, fadeRate, turbulence, attractStrength, attractRadius, dispersionRate, dispersionAmount, particleLifetime, respawnStyle, advectionMode, inertia, drag, repulsorStrength, repulsorCount, repulsorOrbitRate
- Exposed as `#flowfield-canvas` for e2e test targeting
- Mounted in App.tsx when `ready()` signal is true

### HeatmapStrip Component (`components/visual/HeatmapStrip.tsx`) — IMPLEMENTED
- Fixed-position bar chart strip at top of viewport (height 22px, z-index 20)
- One bar per ML output; bar width proportional to output value (0-100%)
- Bar count matches current output mode: visual=20, synth=126, midi-cc=8, audio-canvas=36
- Reactively rebuilds when `outputCount()` changes (mode switch triggers `<For>` re-render)
- Visual mode uses curated colors/names (VISUAL_PARAM_COLORS/VISUAL_PARAM_NAMES); other modes use hue-based color generation
- Drag-to-set: pointer capture on cell, drag updates output value directly via `iml.setOutput()` + `_updateOutputs()`
- Click-to-popup: short click (no drag) opens ParamPopup component with full controls
- Tooltip on hover: shows "ParamName: value" positioned below hovered cell
- Per-cell event handler factory `createCellHandlers()` captures element reference for pointer events
- ML store exposes `_updateOutputs(Float32Array)` for direct output signal update from drag
- CSS: glass morphism strip, per-bar colored fill, brightness filter on hover, drag cursor

### ParamPopup Component (`components/visual/ParamPopup.tsx`) — IMPLEMENTED
- Full param control popup opened by clicking heatmap cell
- Header: parameter name (colored), current value, close button
- Curve row: 36×36 canvas with response curve drawn, vertical drag adjusts curve factor [0,1]
- Range row: dual min/max range sliders with visual fill bar, enforce min ≤ max
- Freeze row: toggle button freezes parameter at fixed value, shows value slider when frozen
- Reads/writes overrides via ML store `getParamOverride()`/`setParamOverride()`
- Curve math: `applyCurve(value, factor)` with exponential mapping (0.5 = linear)
- Positions below clicked heatmap cell, centered, clamped to viewport edges
- Closes on × button click or Escape key

### Param Override System (`core/param-overrides.ts`) — IMPLEMENTED
- Per-parameter overrides: `{ curve: 0.5, min: 0, max: 1, frozen: false, fixedValue: 0.5 }`
- `applyCurve(value, curveFactor)`: exponential response curve, 0.5 = linear (identity)
- `applyOverride(rawValue, override)`: applies curve + min/max range mapping
- `applyOverrideWithFreeze(rawValue, override)`: respects frozen state
- `drawCurveOnCanvas(ctx, curveFactor, color, w, h)`: renders response curve on canvas
- ML store maintains `paramOverrides[]` array, resized on mode switch (preserves existing overrides)
- Store methods: `getParamOverride(i)`, `setParamOverride(i, key, value)`, `getAllOverrides()`, `getOverriddenOutput(i)`, `applyAllOutputs(Float32Array)`

### Output Store (`stores/output-store.ts`) — NOT YET IMPLEMENTED
- Output mode (visual/synth/midi-cc/audio-canvas)
- Per-mode overrides arrays
- Output pipeline config (globalCurve, smoothing, slewRate, freezeGate)

### Dock Component (`components/layout/Dock.tsx`) — IMPLEMENTED
- Right-side vertical dock with 6 icon buttons: Train, Mode, Synth, NISPS, FX, Help
- macOS-style dock with glass morphism background
- `openDrawers` signal (Set<string>) tracks which drawers are open
- Clicking icon toggles corresponding drawer
- Active state (accent color) shown when drawer is open
- SVG icons matching old playground design

### TrainingDrawer Component (`components/layout/TrainingDrawer.tsx`) — IMPLEMENTED
- Drawer panel with training controls, visible when drawer 'training' is open
- Action buttons: Add Example, Train (async), Clear Ex, Clear All, Randomize
- Loss plot canvas (280×80) drawn with orange line on last 200 loss history entries
- Button flash animation on click
- Uses ML store methods: addExample(), trainAsync(), clearExamples(), clearAll(), randomise()

### StatusLine Component (`components/layout/StatusLine.tsx`) — IMPLEMENTED
- Floating pill at bottom center showing example count, loss/noise state
- Format: "N examples · loss X.XXXXX · noise X.XXX" or "N examples · untrained · noise X.XXX"
- Reactively watches exampleCountSignal, lastLossSignal, noiseLevel signals

### RLButtons Component (`components/rl/RLButtons.tsx`) — IMPLEMENTED
- Three floating circular buttons: thumbs-down (−, key 1), undo (↶, key Z), thumbs-up (+, key 2)
- Positioned bottom-center above status line
- Thumbs-down: push undo snapshot, add noise to weights
- Thumbs-up: add example + async training + decay noise
- Undo: pop undo stack, restore weights + noise level
- Undo button shows muted state when stack empty, cyan accent (`has-undo` class) when entries exist
- Glass morphism styling with per-button accent colors
- Exposed as `#btn-thumbsdown`, `#btn-undo`, `#btn-thumbsup` for e2e tests

### Dual IML System
- `imlJoy`: 2 inputs (joystick), dynamic outputs — warm-started on resize
- `imlHand`: 14 inputs (hand tracking), dynamic outputs — fresh on resize
- `activeIml`: points to whichever is active (default: imlJoy)
- EOC IML: separate instance for Linked/Independent modes (NOT YET IMPLEMENTED)

### WASM Integration
- WASM files in `public/` (no Vite hashing)
- Emscripten glue loaded via dynamic import
- Training worker: lazy-loaded, own WASM instance
- Heap management: persistent buffers for inference

### Canvas Components
Each canvas owns its rAF render loop. The component reads the outputs signal each frame. No shared orchestrator.

### Debug Probe
`window.__nisps` exposed when `?debug=1`. All methods synchronous, bypassing SolidJS batching. `window.__nispsEoc` always exposed.

## Transplanted Modules (from playground/js/)

These are copied with minimal TypeScript adaptation:
- `core/wasm/` — WASM binaries + Emscripten glue (unchanged)
- `core/iml.ts` — WasmIML wrapper (from nisps/nisps-wasm.js)
- `core/dataset.ts` — FIFO ring buffer (from nisps/dataset.js)
- `core/synth/` — All synth engines (c15-bridge, c15-adapter, param-map, presets, additive, fm, faust)
- `core/audio/` — Arpeggiator, AudioCanvas, MIDI I/O
- `core/eoc/` — EOC chain + effect modules
- `core/shapeseq/` — ShapeSeq sequencer
- `core/ui/` — Pure math/logic modules (input-pipeline, output-pipeline, control-surface, flow-field)

## Rewritten Modules

Everything else is rewritten in SolidJS:
- All DOM manipulation → JSX components
- Event wiring → signal bus + reactive effects
- State management → SolidJS stores/signals
- Layout/CSS → new CSS with same design system
- Init/boot → provider tree + onMount hooks

## Key Constants

- N_JOY_INPUTS = 2, N_HAND_INPUTS = 14
- N_VISUAL_OUTPUTS = 20, N_SYNTH_OUTPUTS = 126 (C15)
- STORAGE_KEY = 'nisps-a-immersive'
- MAX_UNDO = 20, PARAM_DEAD_ZONE = 0.002, PARAM_SEND_INTERVAL = 50
- 18 C15 synth sections (SYNTH_SECTIONS)
- 20 visual param names/colors (VISUAL_PARAM_NAMES, VISUAL_PARAM_COLORS)

## COOP/COEP Requirement

C15 synth requires SharedArrayBuffer. Vite dev server must send:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## MLP Resize Cascade

When output count changes (mode switch, engine switch, EOC mode change):
1. Warn user if training data exists → confirmation dialog
2. Destroy old MLP, create new with different output count
3. Warm-start: copy hidden layer weights, reset output layer
4. Update output signal, rebuild heatmap
