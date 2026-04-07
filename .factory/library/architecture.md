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
- `dispose()` destroys both IML instances (called in App.tsx onCleanup)
- Bus topics created: `ml.outputs`, `ml.outputCount`, `mode.output`
- Debug probe (`probe/debug-probe.ts`) now wraps MLStore instead of raw WasmIML
- `window.__nispsStore` exposed for test access to store methods like `setOutputMode()`

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

### Output Store (`stores/output-store.ts`) — NOT YET IMPLEMENTED
- Output mode (visual/synth/midi-cc/audio-canvas)
- Per-mode overrides arrays
- Output pipeline config (globalCurve, smoothing, slewRate, freezeGate)

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
- `core/ui/` — Pure math/logic modules (input-pipeline, output-pipeline, control-surface, visualizer)

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
