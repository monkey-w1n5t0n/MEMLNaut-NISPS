# SolidJS Migration Plan

## Decision Record

| Decision | Choice |
|----------|--------|
| Framework | SolidJS (reactivity + components) |
| Build | Vite + vite-plugin-solid |
| Apps | Immersive only, extensible for future layouts |
| Core integration | Deep — ML/synth/audio modeled as SolidJS stores/signals |
| Output reactivity | Batch at frame rate (one signal update per rAF) |
| Event system | Unified signal bus with topics (replaces EventBus + CustomEvents) |
| Migration strategy | Big bang rewrite, old code as reference |
| Routing | None — signals only, URL params for config |
| Canvas | Components with refs, internal render loops |
| Mobile | Desktop-first, mobile later |
| Layout | Headless UI primitives (Drawer, Overlay, Panel, Dock) |

---

## Architecture Overview

```
src/
├── index.html                    # Single entry point
├── App.tsx                       # Root component, provider tree
├── vite.config.ts
│
├── core/                         # Framework-agnostic engines (transplanted)
│   ├── wasm/                     # WASM binaries + Emscripten glue (unchanged)
│   │   ├── nisps.wasm
│   │   ├── nisps.js
│   │   └── nisps-wasm-worker.js
│   ├── iml.ts                    # WasmIML wrapper (thin adaptation)
│   ├── dataset.ts                # Training dataset (FIFO ring buffer)
│   ├── synth/                    # Synth engines (transplanted, minimal changes)
│   │   ├── engine-interface.ts
│   │   ├── c15-adapter.ts
│   │   ├── c15-bridge.ts
│   │   ├── additive-engine.ts
│   │   ├── fm-engine.ts
│   │   ├── faust-engine-base.ts
│   │   ├── param-map.ts          # 126 C15 params (data, unchanged)
│   │   └── presets.ts            # Synth presets (data, unchanged)
│   ├── audio/
│   │   ├── arpeggiator.ts
│   │   ├── arpeggiator-worker.js
│   │   ├── audio-canvas.ts
│   │   └── midi-io.ts            # MIDIInput + MIDIOutput merged
│   ├── eoc/                      # Effects chain (transplanted)
│   │   ├── eoc-chain.ts
│   │   ├── eoc-module.ts
│   │   └── modules/              # Individual effect modules
│   └── shapeseq/                 # Sequencer (transplanted, minimal changes)
│       ├── sequencer.ts
│       ├── chain.ts
│       ├── clock.ts
│       ├── pattern.ts
│       ├── primitives.ts
│       └── ...
│
├── bus/                          # Signal bus
│   └── signal-bus.ts             # createSignalBus(), topic(), match(), emit()
│
├── stores/                       # SolidJS stores (the reactive state layer)
│   ├── ml-store.ts               # IML instances, outputs, loss, training state
│   ├── input-store.ts            # Joystick position, input mode, pipeline config
│   ├── output-store.ts           # Output mode, overrides, routing config
│   ├── synth-store.ts            # Active engine, arpeggiator, volume, presets
│   ├── eoc-store.ts              # EOC chain state, nisps mode, modules
│   ├── midi-store.ts             # MIDI CC map, devices, output state
│   ├── session-store.ts          # Persistence (save/load localStorage)
│   └── ui-store.ts               # Drawer state, active panels, help seen
│
├── hooks/                        # Reactive glue (SolidJS "hooks" / composables)
│   ├── useInference.ts           # Per-frame inference loop
│   ├── useTraining.ts            # Train/thumbs-up/thumbs-down actions
│   ├── useOutputRouting.ts       # Route outputs → synth/visual/midi/audio-canvas
│   ├── useInputPipeline.ts       # Deadzone, zoom, curve, smoothing, momentum
│   ├── useOutputPipeline.ts      # Slew rate, smoothing, freeze gate
│   ├── usePersistence.ts         # Auto-save/load, URL param parsing
│   ├── useAudioContext.ts        # Lazy AudioContext creation, resume on gesture
│   ├── useGamepad.ts             # Gamepad polling
│   └── useKeyboard.ts            # Keyboard shortcuts
│
├── primitives/                   # Headless UI primitives
│   ├── Drawer.tsx                # Slide-in panel (headless)
│   ├── Overlay.tsx               # Floating positioned element
│   ├── Panel.tsx                 # Collapsible content section
│   ├── Dock.tsx                  # Icon bar with drawer triggers
│   ├── PillToggle.tsx            # Segmented toggle (output mode, input mode)
│   ├── Slider.tsx                # Range input with label/value display
│   └── Canvas.tsx                # Canvas wrapper with ref + resize observer
│
├── components/                   # Feature components
│   ├── app/
│   │   └── ImmersiveLayout.tsx   # Main layout shell
│   ├── input/
│   │   ├── Joystick.tsx          # Virtual joystick (pointer events)
│   │   ├── JoyMap.tsx            # Zoom minimap + trails (canvas)
│   │   └── InputModeToggle.tsx
│   ├── output/
│   │   ├── FlowField.tsx         # Particle visualizer (canvas)
│   │   ├── SynthVisualizer.tsx   # Param bar chart (canvas)
│   │   ├── Heatmap.tsx           # Parameter heatmap grid
│   │   └── OutputModeToggle.tsx
│   ├── training/
│   │   ├── TrainingControls.tsx  # Add/Train/Clear/Randomize buttons
│   │   ├── RLControls.tsx        # Thumbs up/down, noise display
│   │   ├── LossPlot.tsx          # Loss history (canvas)
│   │   └── StatusLine.tsx        # Example count, loss, mode
│   ├── synth/
│   │   ├── SynthControls.tsx     # Start/stop, volume, arp controls
│   │   ├── PresetSelector.tsx    # Synth preset chips
│   │   ├── EngineSwitcher.tsx    # Engine dropdown
│   │   └── ParamEditor.tsx       # Per-param override popup
│   ├── eoc/
│   │   ├── EOCPanel.tsx          # Effects chain UI
│   │   ├── EOCModule.tsx         # Single effect module card
│   │   └── EOCJoystick.tsx       # Independent mode joystick
│   ├── midi/
│   │   ├── MIDIInputPanel.tsx    # Device select, CC mapping
│   │   ├── MIDICCPanel.tsx       # CC output config
│   │   └── MIDIPresets.tsx       # CC preset management
│   ├── shapeseq/
│   │   ├── ShapeSeqPanel.tsx     # Sequencer controls
│   │   ├── StepVisualizer.tsx    # Step display (canvas)
│   │   └── ChainBuilder.tsx      # Primitive chain editor
│   ├── controls/
│   │   ├── ControlSurface.tsx    # Boldness/Memory/Precision axes
│   │   ├── InputHeatmap.tsx      # 2D input space heatmap (canvas)
│   │   └── EngineParams.tsx      # Spread, noise, decay sliders
│   └── debug/
│       ├── DevPanel.tsx          # Debug tools
│       ├── WeightHealth.tsx      # Weight magnitude histogram (canvas)
│       └── GradientFlow.tsx      # Per-layer gradient analysis (canvas)
│
├── actions/                      # Imperative operations (not reactive)
│   ├── resize-mlp.ts             # Resize MLP, warm-start weights
│   ├── apply-overrides.ts        # Override application logic
│   └── export-import.ts          # Session export/import
│
└── assets/
    ├── c15/                      # C15 WASM synth binary
    └── faust/                    # Faust DSP files
```

---

## Store Design (Deep Integration)

### ML Store (`stores/ml-store.ts`)

```typescript
import { createStore, produce } from "solid-js/store";
import { createSignal } from "solid-js";

// The hot path: batched per-frame, NOT per-parameter
const [outputs, setOutputs] = createSignal(new Float32Array(126));
const [rawParams, setRawParams] = createSignal(new Float32Array(126));

const [mlState, setMlState] = createStore({
  // IML instances (not reactive themselves — opaque handles)
  imlJoy: null as WasmIML | null,
  imlHand: null as WasmIML | null,
  activeIml: 'joy' as 'joy' | 'hand',

  // Reactive state derived from IML
  outputCount: 126,
  loss: null as number | null,
  lossHistory: [] as number[],
  exampleCount: 0,
  isTraining: false,
  layerStats: null,

  // RL config
  spreadLevel: 0.6,
  noiseLevel: 0.05,
  rlDecay: 0.97,
  learningRate: 0.1,
  maxIterations: 50,

  // Undo
  undoStack: [] as Float32Array[],
});

// The IML instances live OUTSIDE the store (mutable, non-proxy-safe).
// The store tracks their *state* reactively.
// After each inference: setOutputs(iml.getOutputs())
// After each train: setMlState({ loss, exampleCount, lossHistory })
```

**Key design choice**: `Float32Array` outputs are a signal, not a store property. Stores use proxies which don't play well with typed arrays. A signal holding the array reference, replaced each frame, gives us batch reactivity cheaply.

### Input Store (`stores/input-store.ts`)

```typescript
const [inputState, setInputState] = createStore({
  mode: 'joystick' as 'joystick' | 'hands',
  joyX: 0.5,
  joyY: 0.5,
  isDragging: false,
  followMode: false,

  // Input pipeline config
  pipeline: {
    deadzone: 0.02,
    zoom: 1.0,
    zoomAnchorX: 0.5,
    zoomAnchorY: 0.5,
    anchorMode: 'auto' as 'auto' | 'sticky' | 'center',
    curve: 1.0,        // 1.0 = linear
    smoothing: 0.0,    // 0.0 = none
    momentumZoom: false,
  },
});
```

### Output Store (`stores/output-store.ts`)

```typescript
const [outputState, setOutputState] = createStore({
  mode: 'visual' as 'visual' | 'synth' | 'midi-cc' | 'audio-canvas',

  // Per-mode overrides (arrays of { min, max, curve, muted, fixedValue })
  visualOverrides: [] as ParamOverride[],
  synthOverrides: {
    type: 'grouped' as 'grouped' | 'flat',
    groups: [] as GroupOverride[],    // C15 grouped
    flat: [] as ParamOverride[],      // Faust flat
  },
  midiCCOverrides: [] as ParamOverride[],
  audioCanvasOverrides: [] as ParamOverride[],

  // Output pipeline config
  pipeline: {
    globalCurve: 1.0,
    smoothing: 0.0,
    slewRate: 1.0,
    freezeGate: false,
  },
});
```

### Synth Store (`stores/synth-store.ts`)

```typescript
const [synthState, setSynthState] = createStore({
  engineId: 'shaper-feedback' as string,
  engine: null as SynthEngine | null,  // Opaque handle
  isRunning: false,
  volume: 0.7,

  // Arpeggiator
  arp: {
    enabled: false,
    tempo: 120,
    progression: 'major' as string,
    octaves: 1,
    offset: 0,
  },

  // Current preset
  presetId: null as string | null,
});
```

---

## Signal Bus Design (`bus/signal-bus.ts`)

```typescript
import { createSignal, createMemo } from "solid-js";

type Topic<T = any> = {
  (): T | undefined;          // Read (reactive)
  fire: (data: T) => void;    // Write (imperative)
};

export function createSignalBus() {
  const topics = new Map<string, ReturnType<typeof createSignal>>();

  function topic<T = any>(name: string): Topic<T> {
    if (!topics.has(name)) {
      const [get, set] = createSignal<T | undefined>(undefined, { equals: false });
      topics.set(name, [get, set]);
    }
    const [get, set] = topics.get(name)!;
    const accessor = () => get() as T | undefined;
    accessor.fire = (data: T) => set(() => data);
    return accessor as Topic<T>;
  }

  function emit<T = any>(name: string, data: T) {
    topic<T>(name).fire(data);
  }

  function match(pattern: string) {
    // 'seq.*' → derived signal merging all seq.* topics
    const prefix = pattern.replace('*', '');
    return createMemo(() => {
      let latest: { name: string; data: any } | undefined;
      for (const [name, [get]] of topics) {
        if (name.startsWith(prefix)) {
          const val = get();
          if (val !== undefined) {
            latest = { name, data: val };
          }
        }
      }
      return latest;
    });
  }

  return { topic, emit, match };
}
```

**Usage equals: false** is critical — it means every `emit()` triggers subscribers even if the data is identical. This matches event semantics (every `seq.step` matters, even if the step number repeats).

---

## Inference Loop (`hooks/useInference.ts`)

```typescript
import { createEffect, onCleanup } from "solid-js";

export function useInference(mlStore, inputStore, outputStore, bus) {
  let rafId: number;

  function tick() {
    const iml = mlStore.activeIml === 'joy' ? mlStore.imlJoy : mlStore.imlHand;
    if (!iml) { rafId = requestAnimationFrame(tick); return; }

    // Set inputs
    iml.setInput(0, inputStore.joyX);
    iml.setInput(1, inputStore.joyY);

    // Forward pass
    iml.process();
    const raw = iml.getOutputs();

    // Batch update — single signal write per frame
    setOutputs(new Float32Array(raw));

    // Route to active output
    routeOutputs(raw, outputStore, synthStore, bus);

    // Fire bus event (for non-UI subscribers like sequencer)
    bus.emit('ml.inference', { outputs: raw });

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);
  onCleanup(() => cancelAnimationFrame(rafId));
}
```

---

## Output Routing (`hooks/useOutputRouting.ts`)

```typescript
function routeOutputs(raw: Float32Array, outputStore, synthStore, bus) {
  const mode = outputStore.mode;
  const overrides = getOverridesForMode(mode, outputStore);

  // Apply overrides (pure function, no side effects)
  const processed = applyOverrides(raw, overrides);

  switch (mode) {
    case 'visual':
      bus.emit('output.visual', processed);
      break;
    case 'synth':
      // Throttled: only send to engine at 20fps
      bus.emit('output.synth', processed);
      break;
    case 'midi-cc':
      bus.emit('output.midi', processed);
      break;
    case 'audio-canvas':
      bus.emit('output.audiocanvas', processed);
      break;
  }

  // Always update heatmap (unthrottled — it's just DOM)
  bus.emit('output.heatmap', raw);
}
```

Each output component subscribes to its own bus topic. The FlowField listens to `output.visual`, the SynthVisualizer to `output.synth`, etc. Throttling for synth param sends lives inside the synth subscriber, not in the routing.

---

## Component Examples

### Joystick Component

```tsx
const Joystick = () => {
  const { inputState, setInputState } = useInputStore();
  const bus = useBus();

  const onPointerDown = (e: PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const rect = (e.target as Element).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1 - (e.clientY - rect.top) / rect.height;
    setInputState({ joyX: x, joyY: y, isDragging: true });
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!inputState.isDragging) return;
    const rect = (e.target as Element).getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    setInputState({ joyX: x, joyY: y });
  };

  const onPointerUp = () => setInputState({ isDragging: false });

  return (
    <div
      class="joystick"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        class="joystick-dot"
        style={{
          left: `${inputState.joyX * 100}%`,
          bottom: `${inputState.joyY * 100}%`,
        }}
      />
    </div>
  );
};
```

### FlowField (Canvas Component)

```tsx
const FlowField = () => {
  let canvasRef: HTMLCanvasElement;
  const bus = useBus();
  const visualData = bus.topic<Float32Array>('output.visual');

  onMount(() => {
    const ctx = canvasRef.getContext('2d')!;
    const vis = new FlowFieldVisualizer(ctx);  // Transplanted engine

    // Internal render loop — reads signal each frame
    let raf: number;
    const loop = () => {
      const data = visualData();
      if (data) vis.setParams(data);
      vis.draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return <canvas ref={canvasRef!} class="flow-field" />;
};
```

### Heatmap (Reactive DOM)

```tsx
const Heatmap = () => {
  const bus = useBus();
  const heatmapData = bus.topic<Float32Array>('output.heatmap');
  const { outputState } = useOutputStore();
  const paramMeta = () => getParamMeta(outputState.mode);

  return (
    <div class="heatmap-grid">
      <For each={paramMeta()}>
        {(param, i) => (
          <HeatmapCell
            index={i()}
            param={param}
            value={() => heatmapData()?.[i()] ?? 0}
          />
        )}
      </For>
    </div>
  );
};

const HeatmapCell = (props) => {
  const width = () => `${(props.value() * 100).toFixed(1)}%`;
  return (
    <div class="heatmap-cell" title={props.param.name}>
      <div class="heatmap-bar" style={{ width: width() }} />
    </div>
  );
};
```

---

## Provider Tree (`App.tsx`)

```tsx
const App = () => {
  return (
    <BusProvider>
      <MLProvider>
        <InputProvider>
          <OutputProvider>
            <SynthProvider>
              <EOCProvider>
                <SessionProvider>
                  <ImmersiveLayout />
                </SessionProvider>
              </EOCProvider>
            </SynthProvider>
          </OutputProvider>
        </InputProvider>
      </MLProvider>
    </BusProvider>
  );
};
```

Each provider creates its store and exposes it via context. The `SessionProvider` handles persistence (auto-save on interval, load on mount, URL param parsing).

---

## Migration Phases

### Phase 1: Skeleton + Core Loop

**Goal**: Joystick → MLP → FlowField working in SolidJS. **Also**: validate all risky integration points early.

1. `npm create vite@latest playground-solid -- --template solid-ts`
2. Set up project structure (`core/`, `stores/`, `components/`, `bus/`)
3. **Configure Vite**: COOP/COEP headers, WASM asset handling (spike `public/` vs `locateFile`)
4. Transplant WASM files (`nisps.wasm`, `nisps.js`, worker) into `core/wasm/`
5. **Spike**: Verify WASM loads and runs inference in Vite dev server (before building any UI)
6. **Spike**: Verify C15 WASM + SharedArrayBuffer works with COOP/COEP headers
7. Implement `createSignalBus()`
8. Implement `ml-store.ts` and `input-store.ts` (minimal)
9. Implement reactive inference (`createEffect` on input signals, not rAF)
10. Build `Joystick` component
11. Build `FlowField` component (transplant `FlowFieldVisualizer` class, own rAF loop)
12. Wire it up in `App.tsx` with minimal `ImmersiveLayout`
13. Verify: drag joystick → see particles respond
14. Add worker `dispose()` to IML, verify cleanup in `onCleanup()`

**Validates**: SolidJS + WASM integration, COOP/COEP, signal bus, reactive inference, canvas components, worker lifecycle.

### Phase 2: Training + RL

**Goal**: Full ML interaction loop.

1. Implement `useTraining` hook (add example, train async, thumbs up/down)
2. Implement `output-store.ts` (visual overrides only for now)
3. Build `TrainingControls` (Add/Train/Clear/Randomize)
4. Build `RLControls` (thumbs up/down, noise display)
5. Build `LossPlot` (canvas)
6. Build `StatusLine`
7. Implement undo stack in `ml-store`
8. Implement `useOutputRouting` (visual mode only)

**Validates**: Async training with UI updates, RL feedback loop, undo.

### Phase 3: Synth Integration

**Goal**: Synth output mode working.

1. Transplant `c15-adapter.ts`, `c15-bridge.ts`, `param-map.ts`, `presets.ts`
2. Implement `synth-store.ts`
3. Implement `useAudioContext` (lazy creation, gesture resume)
4. Build `SynthControls` (start/stop, volume)
5. Build `SynthVisualizer` (canvas, param bars)
6. Build `PresetSelector`
7. Build `EngineSwitcher` (C15, Additive, FM)
8. Implement synth output routing with throttling
9. Implement `output-store` grouped overrides for C15
10. Build `Heatmap` + `ParamEditor` popup

**Validates**: Multi-engine support, override system, audio integration.

### Phase 4: Layout + UI Primitives

**Goal**: Full immersive UI.

1. Build headless primitives: `Drawer`, `Overlay`, `Dock`, `PillToggle`, `Slider`
2. Build `ImmersiveLayout` (fullscreen canvas + floating controls + drawer stack)
3. Build `ControlSurface` (Boldness/Memory/Precision compound axes)
4. Implement `useInputPipeline` (deadzone, zoom, curve, smoothing)
5. Build `JoyMap` (zoom minimap with trails, canvas)
6. Build `InputHeatmap` (2D color field, canvas)
7. Implement `useKeyboard` (shortcuts: 1/2/Z etc.)
8. Wire drawer system (dock icons → drawer toggles)

**Validates**: Layout primitives, compound axis system, input pipeline.

### Phase 5: Remaining Features

**Goal**: Feature parity with a-immersive.

1. **MIDI**: `MIDIInputPanel`, `MIDICCPanel`, `MIDIPresets`, midi-cc output mode
2. **Audio Canvas**: Transplant, wire as output mode
3. **EOC Chain**: `EOCPanel`, `EOCModule`, EOC joystick, nisps modes (Shared/Linked/Independent)
4. **Arpeggiator**: Controls, worker integration
5. **Output Pipeline**: `useOutputPipeline` (slew, smoothing, freeze)
6. **Weight Health**: `WeightHealth`, `GradientFlow` (canvas)
7. **Session Presets**: Save/load full state, URL sharing
8. **Persistence**: Auto-save, localStorage round-trip
9. **Debug probe**: `window.__nisps` when `?debug=1`

### Phase 6: ShapeSeq

**Goal**: Sequencer as optional subsystem.

1. Transplant sequencer core (already modular)
2. Build `ShapeSeqPanel`, `StepVisualizer`, `ChainBuilder`
3. Wire to signal bus (`seq.*` topics)
4. Lazy-load when enabled via URL param

### Phase 7: Polish + Tests

1. Port Playwright e2e tests (update selectors for new DOM)
2. Add component-level tests (vitest + solid-testing-library)
3. Responsive CSS pass
4. Performance profiling (ensure 60fps inference + rendering)
5. Accessibility pass on interactive elements

---

## Fresh Eyes: What the Plan Was Missing

### 1. COOP/COEP Headers & SharedArrayBuffer (Blocker)

The C15 synth engine requires `SharedArrayBuffer` for its audio ring buffer. This means the server **must** send:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The current codebase uses `serve-coop.py` for this. **Vite dev server must be configured** with these headers or C15 synth mode will fail silently. This should be validated in Phase 1, not Phase 3.

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

### 2. Worker Lifecycle (Currently Leaked)

Workers are **never terminated** in the current code:
- `nisps-wasm-worker.js` — created lazily on first `trainAsync()`, lives forever
- `arpeggiator-worker.js` — created on arpeggiator init, lives forever

In a SolidJS app where components mount/unmount, workers must be cleaned up in `onCleanup()`. The current code leaks them because the page never changes — the SolidJS version will need explicit termination, especially if engine switching or mode changes recreate IML instances.

**Add to architecture**: `core/iml.ts` must expose a `dispose()` method that terminates the worker. `synth-store` cleanup must terminate the arpeggiator worker.

### 3. AudioContext Lifecycle Gotchas

- **C15Bridge creates its own AudioContext internally**; Faust engines require one passed in. This API inconsistency means `useAudioContext()` can't own the single context — C15 creates its own.
- **No `dispose()` on C15Bridge** — relies on GC of the AudioContext. Engine switching disconnects audio nodes (line 1121 in a-app.js) but doesn't explicitly close the context.
- **AudioWorklet module loading** via `addModule()` — browsers deduplicate, but if the context is recreated, modules must be re-registered.

**Add to architecture**: The `useAudioContext` hook needs to handle two patterns: "I own the context" (Faust) vs "the engine owns the context" (C15). Consider normalizing this in the transplant — make C15Bridge accept an external AudioContext.

### 4. Debug Probe Synchrony Contract

The Playwright tests depend on `window.__nisps` methods being **synchronous**:
- `setInputs(x, y)` → synchronously runs inference + routes outputs + updates heatmap
- `thumbsUp()` → synchronously calls `addExample()` before returning
- `saveState()` → synchronously writes to localStorage
- `train()` → synchronously trains and returns loss (not the async variant)

In SolidJS, store updates are batched by default. If `setInputs()` writes to a signal but the effect that runs inference hasn't flushed yet, the probe will return stale data. **The probe must bypass SolidJS reactivity** and call imperative methods directly on the IML instance.

**Add to Phase 5 (debug probe)**: Build the probe as a direct imperative bridge to the IML/store internals, not as a reactive consumer. Use `batch()` or `untrack()` where needed.

### 5. MIDI CC Map — Engine-Scoped Dynamic Storage Keys

MIDI CC maps are stored with engine-scoped localStorage keys: `nisps-midi-cc-map:${activeEngine.id}`. When the engine switches:
1. Current map is saved to the old engine's key
2. New map is loaded from the new engine's key
3. `midiCCMap` and `midiCCOverrides` arrays are mutated in-place

In SolidJS, in-place array mutation (`arr.length = 0; arr.push(...)`) won't trigger reactivity. The `midi-store` must use `setStore(produce(...))` or replace arrays entirely. The engine-scoped key pattern needs to be replicated in `session-store.ts`.

### 6. EOC Chain — Mutable Audio Graph + MLP Resize Cascade

When EOC modules are added/removed in "Shared" mode:
1. MLP output count changes → MLP must be destroyed and recreated
2. Training examples are lost (different output dimensionality)
3. Audio graph nodes must be reconnected
4. Heatmap must be rebuilt

This is a **cascade of side effects** triggered by a single user action. In the current code it's handled by a `window.addEventListener('eoc:change', ...)` handler that orchestrates everything imperatively.

In SolidJS, this should be modeled as: EOC module list is a store → derived signal computes total output count → `createEffect` watches output count and triggers MLP resize when it changes. But the MLP resize is async (WASM allocation) and has a confirmation dialog ("this will clear examples"). **Effects can't show dialogs**.

**Proposed pattern**: EOC store exposes a `pendingResize` signal. A component watches it and shows the confirmation UI. On confirm, an action triggers the actual resize. Don't try to make this fully reactive — keep it as an explicit action flow.

### 7. WASM + Emscripten Glue Loading in Vite

The WASM is loaded via Emscripten's `nisps.js` glue file, which does its own `fetch()` of `nisps.wasm` using a relative path. Vite's asset handling will hash filenames in production builds, breaking the hardcoded path.

**Options**:
- Configure Vite to copy WASM files to `public/` (no hashing, always available at known path)
- Modify the Emscripten glue to accept a custom `locateFile` override
- Use Vite's `?url` import to get the resolved asset path and pass it to the WASM loader

This must be spiked in Phase 1. Same issue applies to C15 WASM (`c15/c15_engine.wasm`), C15 parameters (`c15/parameters.json`), and Faust DSP files.

### 8. Session Presets Are Shared Across Apps

`nisps-session-presets` localStorage key is **shared across all three current apps**. Since we're consolidating to one app, this is fine — but the key should be documented, and the migration should handle importing presets saved by the old app.

### 9. Lazy Loading Needs Suspense Boundaries

Three features are lazily loaded:
- **ShapeSeq**: dynamic `import()` when `?shapeseq=1`
- **Hand tracking**: imports MediaPipe from CDN (`cdn.jsdelivr.net`) — external dependency that can fail
- **Audio Canvas**: created on first switch to audio-canvas mode

SolidJS `lazy()` + `<Suspense>` handles this naturally, but:
- MediaPipe CDN fetch failure needs a fallback UI (not just a blank screen)
- ShapeSeq lazy loading should show a loading state, not block the whole app
- Audio Canvas creation involves AudioContext (requires gesture) — can't be wrapped in Suspense naively

### 10. CSS Animations Are Stateful

Several CSS classes trigger animations that encode UI state:
- `.follow-pulse` — 1.5s infinite pulse (follow mode active)
- `.btn-flash` / `.rl-flash` — 0.2s feedback flash
- `.drawerSlideIn` — drawer appearance

If SolidJS re-renders a component (e.g., `<Show>` toggling), CSS animations restart from the beginning. For the pulse animation this is fine, but for the flash animations, a re-render mid-flash would cause visual glitches.

**Mitigation**: Use `classList` toggling on stable DOM nodes rather than conditional rendering for animation-bearing elements. Or use the Web Animations API for imperative control.

### 11. `window.__nispsEoc` Is Unconditional

Unlike `window.__nisps` (gated by `?debug=1`), `window.__nispsEoc` is **always exposed** (line 1528 in a-app.js). It provides `trainingTarget` getter/setter and `imlEoc` reference. If external code depends on this, it needs to be preserved in the SolidJS version unconditionally.

### 12. Inference Should NOT Be in rAF

The plan puts inference in a `requestAnimationFrame` loop. But inference only needs to run **when inputs change** (joystick drag, gamepad poll, hand tracking frame). Running it every frame when the joystick is idle wastes CPU.

**Better pattern**: Run inference reactively — `createEffect` watching `inputState.joyX` and `inputState.joyY`. When they change, run inference and update outputs. The canvas render loops (FlowField, SynthVisualizer) still run on rAF for smooth animation, but they just read the latest outputs signal — they don't trigger inference.

Exception: gamepad polling needs a rAF loop to read the Gamepad API, but that loop should only set input signals, not run inference directly.

---

## Key Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| WASM + SolidJS reactivity overhead | Typed arrays stay as signals (not store properties). Batch per frame. Profile early in Phase 1. |
| 126 params × 20fps = 2520 synth param sends/sec | Keep existing throttle (50ms interval, 0.002 dead zone) in synth subscriber, not in routing. |
| Store proxy overhead on large arrays | Use `createSignal` for `Float32Array` outputs, not `createStore`. Stores only for structured config. |
| Signal bus wildcard `match()` perf | Memoize prefix scans. Most topics are fixed at startup. Profile if >50 topics. |
| Canvas components fighting rAF | Each canvas owns its loop. No shared orchestrator unless profiling shows frame contention. |
| MLP resize destroys training data | Same as current: warn user, warm-start weights for joystick IML. Store handles the state transition. |
| `equals: false` on bus signals | Required for event semantics but means every emit triggers all subscribers. Keep topic count bounded. |
| SharedArrayBuffer / COOP+COEP | Configure Vite dev server headers in Phase 1. Validate C15 works before Phase 3. |
| WASM asset paths broken by Vite hashing | Spike in Phase 1: use `public/` dir or `locateFile` override for all WASM/JSON assets. |
| Worker leak on component unmount | Add `dispose()` to IML and arpeggiator. Call in `onCleanup()`. |
| EOC resize cascade needs confirmation dialog | Model as pending action, not reactive effect. Component shows dialog, action triggers resize. |
| Debug probe expects synchronous execution | Build probe as imperative bridge, bypass SolidJS batching with `batch()`/`untrack()`. |
| CSS animation restart on re-render | Use `classList` on stable nodes, not `<Show>`/`<Switch>` for animated elements. |
| Idle inference wastes CPU | Make inference reactive to input changes, not rAF-driven. Canvas loops stay on rAF. |

---

## What Gets Transplanted vs Rewritten

### Transplanted (minimal changes, mostly just TS types)
- `nisps-wasm.js` + worker + WASM binary
- `dataset.ts` (FIFO ring buffer)
- `FlowFieldVisualizer` class (canvas rendering)
- `c15-bridge.ts`, `c15-adapter.ts`
- `param-map.ts`, `presets.ts` (pure data)
- `additive-engine.ts`, `fm-engine.ts`, `faust-engine-base.ts`
- `arpeggiator.ts` + worker
- `eoc-chain.ts`, `eoc-module.ts`, all effect modules
- ShapeSeq core (`sequencer.ts`, `chain.ts`, `clock.ts`, `pattern.ts`, `primitives.ts`)
- `audio-canvas.ts`
- `input-pipeline.ts` logic (becomes `useInputPipeline` hook wrapping same math)
- `output-pipeline.ts` logic (becomes `useOutputPipeline` hook)
- `control-surface.ts` compound axis logic (data tables + interpolation)

### Rewritten from scratch
- All DOM manipulation (→ JSX components)
- Event wiring (→ signal bus + reactive effects)
- State management (scattered module-scope vars → stores)
- Override application (→ `apply-overrides.ts` pure function)
- Persistence (→ `SessionProvider` with `createEffect` auto-save)
- Layout/CSS (→ new CSS with headless primitives)
- Init/boot sequence (→ provider tree + `onMount` hooks)

### Deleted (not ported)
- `b-app.js`, `c-app.js`, `app.js` (consolidated into one app)
- `b-workbench.html`, `c-journey.html`, `index.html` (single entry point)
- `iml.js`, `mlp.js`, `layer.js`, `node.js` (legacy JS ML engine, WASM only)
- `event-bus.js` (replaced by signal bus)
- All `wire*()` functions (replaced by component-local event handlers)
- DOM-string-building functions (`buildHeatmap`, `buildDrawerHTML`, etc.)

---

## Open Questions

1. **TypeScript strictness**: Full strict mode from day one, or gradual? (Transplanted JS modules will need type annotations.)
2. **CSS approach**: Plain CSS files per component? CSS modules? Vanilla Extract? (Plain CSS is simplest and matches the current approach.)
3. **Testing during migration**: Run old Playwright tests against old code in parallel, or wait for Phase 7?
4. **WASM loading**: Vite handles `.wasm` imports natively, but the Emscripten glue (`nisps.js`) may need special config. Spike this in Phase 1.
5. **Faust DSP loading**: Currently fetched at runtime. Keep as-is or bundle?
