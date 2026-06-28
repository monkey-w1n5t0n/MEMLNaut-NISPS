I now have a thorough, complete understanding of the entire deployed app — DOM, CSS theme tokens, all interaction handlers, state model, engine call points, persistence, and the help-modal copy. I have everything needed to write the faithful clone spec. Let me write it now.

# NISPS Immersive (`a-immersive.html`) — SolidJS Clone Spec

This is a faithful, component-by-component rebuild spec for the deployed vanilla-JS app at `/home/w1n5t0n/deployments/meml-aimmersive/`. Source of truth: `a-immersive.html` (446-line DOM), `css/a-immersive.css` (2538 lines), `js/a-app.js` (4521-line module), and supporting modules under `js/nisps/`, `js/ui/`, `js/synth/`, `js/midi/`, `js/audio/`. Goal: a from-scratch SolidJS reimplementation that matches the look and behaviour 1:1, binding to a shared engine layer (the WASM IML + synth engines) rather than re-porting it.

---

## 0. Critical scoping note before you build

**The deployed app does NOT use the Boldness/Memory/Precision control surface.** `README.md` and `SPEC-controls.md` describe that system (`js/ui/control-surface.js`, `control-surface-ui.js`, `input-pipeline.js`), but **`js/a-app.js` never imports any of them**. (Verified: `grep "control-surface" js/a-app.js` → no hits.) Those modules belong to a different design and to the SolidJS migration target (`PLAN-solidjs-migration.md`).

What a-immersive *actually* exposes for ML tuning is a flat **"NISPS" params drawer** with 6 raw sliders: **Spread, Noise, RL Decay, Learn Rate, Max Iters, Convergence** (`buildEngineParams()`, a-app.js:3137). To clone a-immersive 1:1, build **that** drawer. If the new SolidJS app is meant to also gain Boldness/Memory/Precision, treat it as an additive feature on top of this spec, not a replacement.

Joystick input is fed **directly** (`joyX, joyY` ∈ [0,1]) into `iml.setInput(0/1, …)` — there is **no deadzone/zoom/curve/smoothing pipeline** in a-immersive. The only output-side shaping is the per-param override system (curve/min/max/freeze).

Many imports in a-app.js are for features visible only behind flags or that exist as dock entries (EOC Effects Chain, Modular engine, ShapeSeq behind `?shapeseq=1`, Faust additive/FM engines, audio-canvas, hand tracking). See §10 for what's core vs deferrable.

---

## 1. Component tree

Top-level provider tree wraps everything in store contexts (see §5). All components are absolutely/fixed-positioned over a full-viewport canvas — this is a single-screen HUD, not a flow layout.

```
<ImmersiveShell>                         // root; owns rAF loop, resize, init, keyboard, gamepad
├── <BackButton>                         // fixed top-left chevron → designs.html
├── <SynthQuickControls>                 // shown only when outputMode==='synth'
│   ├── <PlayButton>                     //   play/pause icon, audio-needs-init pulse
│   ├── <PlayDrawer>                     //   hover flyout: Vol + BPM sliders
│   └── <SynthPresetSelect>              //   tiered <select> (Manual/Beginner/.../Expert)
├── <MidiCcQuickControls>               // shown only when outputMode==='midi-cc'
│   ├── enable button, output-device <select>, preset <select>, status span
├── <AudioCanvasMount>                   // div, populated by AudioCanvas (deferrable)
├── <ShapeSeqContainer>                  // behind ?shapeseq=1 (deferrable)
│
├── <FlowFieldCanvas>                    // #vis-canvas — visual mode particle system
├── <SynthVisualizer>                    // #synth-vis-canvas — 126-bar synth chart (synth mode)
│
├── <HeatmapStrip>                       // top strip; hidden in synth mode
│   ├── <HeatmapCell> × N                //   one per output param; drag-to-set, click-to-popup
│   ├── <HeatmapTooltip>                 //   hover quick-info
│   └── <ParamOverridePopup>             //   portal: curve/min-max/freeze (+ CC editors)
│
├── <FloatingJoystick>                   // bottom-left; canvas knob + minimap + noise ring
│   ├── <JoyMapCanvas>                   //   #joy-map: bg grid, training dots, knob, crosshair
│   ├── <NoiseRing>                      //   RL exploration indicator (off/active/high)
│   ├── <FollowBadge>                    //   "FOLLOW" pill when follow mode on
│   └── <GamepadStatus>                  //   tiny orange status text
├── <HandTrackingPip>                    // replaces joystick when input==='hands' (deferrable)
├── <EocJoystick>                        // independent EOC mode only (deferrable)
│
├── <RlButtons>                          // bottom-center: −/+ cluster + undo + (linked label)
│   ├── <RlDownButton> (−, key 1)
│   ├── <RlUpButton>   (+, key 2)
│   └── <UndoButton>   (Z)
├── <EocRlButtons>                       // FX −/+ (keys 3/4), linked mode only (deferrable)
│
├── <StatusLine>                         // bottom: "N examples · loss X · noise Y"
│
├── <Dock>                               // right-side macOS dock
│   └── <DockIcon> × 6                   //   Train, Mode, Synth, NISPS, FX, Help
├── <DrawerStack>                        // stacked glass panels left of dock
│   ├── <TrainingDrawer>                 //   actions, visual presets, loss canvas
│   ├── <ModeDrawer>                     //   input + output pill toggles + follow pill
│   ├── <SynthDrawer>                    //   engine switcher + audio/arp controls
│   ├── <MidiCcDrawer>                   //   CC param management
│   ├── <ParamsDrawer>                   //   "NISPS" tuning sliders (the 6 above)
│   └── <EocDrawer>                      //   effects chain UI mount (deferrable)
├── <GroupOverrideDrawer>                // portal: per-group curve + per-param rows (synth mode)
│
├── <HelpModal>                          // overlay; auto-opens on first visit
└── <Toast>                              // transient bottom message
```

### What each owns / renders

- **`<ImmersiveShell>`** — orchestrator. Holds no visual markup of its own beyond children. Owns: the `requestAnimationFrame` loop (`animate()`, a-app.js:4251 — polls gamepad, draws whichever canvas is active), the global `resize` handler (`onResize()`:4217 — resizes both canvases + joymap, re-inits particles, hides popups), keyboard (`wireKeyboard()`:3675), gamepad wiring, init sequence (`init()`:1265), auto-save interval (10 s), and the `?debug=1` probe (`window.__nisps`). Mounts `<Toast>` lazily.
- **`<FlowFieldCanvas>`** — wraps `FlowFieldVisualizer` (`js/ui/visualizer.js`). 400-particle Canvas2D flow field driven by 20 outputs (see §7). Visible when `outputMode==='visual'`; gets `.hidden-canvas` otherwise. Internal render loop is driven by the shell's rAF, not its own.
- **`<SynthVisualizer>`** — wraps the `SynthVisualizer` class (defined inline in a-app.js:584). Draws all visible (non-muted) param bars grouped into labeled sections, with hover tooltip and drag-to-set. Hovering a **section label** opens `<GroupOverrideDrawer>`. Visible (`.active`) only in synth mode.
- **`<HeatmapStrip>`** — 22 px top strip of equal-flex bars, one per output. Each bar's width = output value %. Bars: hover→tooltip, drag→set value, click→`<ParamOverridePopup>`. Hidden in synth mode (the SynthVisualizer replaces it there). Gets `.shared-mode` (adds "+ FX" label) when EOC shared mode is active.
- **`<FloatingJoystick>`** — the primary input. A 160×160 canvas knob with integrated minimap (training-example dots + current position). Drag = relative move; tap = snap-to-position; double-tap = toggle follow. See §2.
- **`<RlButtons>`** — the −/+/undo cluster (see §2). `<StatusLine>` is a read-only floating string.
- **`<Dock>` + `<DrawerStack>`** — dock icons toggle the matching drawer (Help opens the modal instead). Each drawer is an independent glass panel that shows/hides via a `.hidden` class; multiple can be open at once.

---

## 2. Every control and interaction (exact behaviour)

### 2.1 Floating joystick (`wireJoystick()`, a-app.js:2280)
Listeners are on `#joy-map` (pointerdown) + `window` (pointermove/up/cancel).
- **Tap / pointerdown**: snap `joyX/joyY` to the tapped position inside the circle. Mapping: `dx = clientX - rectLeft - size/2`; `maxR = size/2 - 8`; `joyX = clamp(0.5 + (dx/maxR)*0.5)`; `joyY = clamp(0.5 - (dy/maxR)*0.5)` (Y inverted). Then `drawJoyMap()` + `onJoystickMove()`. Starts a drag.
- **Double-tap** (two pointerdowns < 350 ms apart): `toggleFollowMode()`; consume (no drag).
- **Drag / pointermove**: relative — `joyX = clamp(startJX + dx*scale*0.5)` where `scale = 1/maxR`; Y inverted. Redraw + `onJoystickMove()` each move.
- **Follow mode**: when on, pointer motion anywhere over `#vis-canvas` (and during window pointermove) sets `joyX = clamp(clientX/innerWidth)`, `joyY = clamp(1 - clientY/innerHeight)` — i.e. the whole screen becomes the pad, no hold needed.
- **`onJoystickMove()`** (2378): `iml.setInput(0,joyX); setInput(1,joyY); process()`; route + heatmap + `syncRawParamsFromOutputs`; push to `joyTrail` (cap 30, used by enhanced map / not strictly needed for base clone). Skips when `inputMode!=='joystick'`.
- **`drawJoyMap()`** (2193): circular clip; bg `rgba(13,13,13,0.7)`; quarter grid lines `rgba(255,255,255,0.06)`; ring border; **training dots** at `(fx = features[i][0]*w, fy=(1-features[i][1])*h)`, hue = `(labels[i][3]||0)*360` (i.e. coloured by output #3 = Hue), radius 3; **knob** orange `rgba(255,106,0,0.9)` r=8 with shadowBlur 12 + white inner dot r=3; orange crosshair.
- **Noise ring** (`updateNoiseRing()`:2879): `noiseLevel>0.15` → `.active.high` (6 px red border); `>0.01` → `.active` (3 px); else none.

### 2.2 RL +/−/undo cluster (`onThumbsUp`/`onThumbsDown`/`onUndo`)
Wired in both `wireControls()` (2567) and via keyboard.
- **`+` (Up, key `2` / Numpad2 / gamepad RB / hand "thumbsup")** — `onThumbsUp()` (2988):
  1. `pushUndoSnapshot()` (weights + noiseLevel + exampleCount; stack cap 20).
  2. `target.addExample(getCurrentInputs(), [...rawParamValues])` — **adds the current input→current-output pair as a training example** (i.e. "this mapping is good, keep it").
  3. `noiseLevel *= rlExplorationDecay (0.97)`, floored at 0.005.
  4. `flash('btn-thumbsup')`, `updateNoiseRing()`, then **async train** (`trainModelAsync()`); EOC target trains directly.
- **`−` (Down, key `1` / Numpad1 / gamepad LB / hand "thumbsdown")** — `onThumbsDown()` (3012):
  1. `pushUndoSnapshot()`.
  2. `noiseCap = 0.3*(1-spread) + 0.05*spread`; `noiseLevel = min(noiseLevel*1.5, noiseCap)`.
  3. `target.moveWeights(noiseLevel, spread)` — **perturbs network weights to explore a new mapping** (no example added).
  4. Re-route outputs from the affected IML; `updateStatus()`, `updateNoiseRing()`, `flash('btn-thumbsdown')`.
- **Undo (key `z`/`Z`, button between +/−)** — `onUndo()` (2949): pop snapshot, restore weights (`_setFlatWeights`) + noiseLevel, re-infer, route. Button gets `.has-undo` when stack non-empty (`updateUndoButton()`).
- **`flash(id)`**: add `.flash` class for 250 ms (scale pop animation).

### 2.3 Keyboard accelerators (`wireKeyboard()`, 3675)
Ignored when focus is in INPUT/SELECT/TEXTAREA, and on `e.repeat`. `preventDefault()` each.
- `1`/Numpad1 → `onThumbsDown()`; `2`/Numpad2 → `onThumbsUp()`.
- `3`/Numpad3 → FX thumbs-down (only if `imlEoc` && linked mode); `4`/Numpad4 → FX thumbs-up (same guard). These temporarily set `eocTrainingTarget='eoc'`, fire, restore, `flash('eoc-rl-minus/plus')`.
- `z`/`Z` → `onUndo()`.

### 2.4 Interactive heatmap (`buildHeatmap()`:1728, `setHeatmapValue()`:1829, `<ParamOverridePopup>`:1930)
Per cell:
- **Hover** (pointerenter): tooltip `"<name>: <value.toFixed(3)>  ▾"`, positioned at cell's left. pointerleave hides; if its popup is open, schedule hide in 300 ms.
- **pointerdown**: record down position, set `_dragging`, `setPointerCapture`, add `.dragging` (→ `cursor:ew-resize`).
- **pointermove**: if moved >3 px in x or y, mark `_didDrag` and call `setHeatmapValue(i,e,cell)` — `x = clamp((clientX-rectLeft)/rectWidth)`; writes `rawParamValues[i]=x`, routes, updates heatmap, syncs; if param frozen, drag updates its `fixedValue`. Tooltip follows.
- **pointerup**: if **not** dragged → it's a click → toggle the override popup (`showParamPopup(i)` / `hideParamPopup()`).
- **Override popup** (`<ParamOverridePopup>`): glass card positioned below the cell (260 px wide, clamped to viewport). Rows:
  - *(MIDI CC mode only)* editable **Name** (text), **CC#** (0–127; auto-renames from `CC_NAMES`), **Ch** (1–16) — each persists via `saveCCMap`.
  - **Curve**: 36×36 draggable canvas (`_drawCurveOnCanvas` + `_wireCurveDrag`), value label; vertical drag sets curve ∈ [0,1], 0.5 = linear. Routes live.
  - **Range (min/max)**: dual-thumb overlapping `<input type=range>` (min blue `#4488ff`, max orange `#ff6a00`) with a fill bar; clamps min≤max; label `"min–max"`. Routes live.
  - **Freeze**: button toggles `frozen`; when frozen, captures current output into `fixedValue`, reveals a value slider (blue), and the param is removed from NISPS control (its output is pinned to `fixedValue`). Frozen cells get a hatched overlay + dimmed bar (`.heatmap-cell-frozen`).
  - Popup stays open while hovered; closes 300 ms after leaving both popup and cell.

### 2.5 Synth visualizer + group drawer (`SynthVisualizer`:584, `showGroupDrawer()`:3953)
- **Bars**: only non-muted params drawn, grouped with 2 px gaps between sections; each section gets a centered label at the top (`_drawSectionLabel`). Bar height = display value (lerped at 0.12/frame toward target). Hover any bar → in-canvas tooltip (name / Val / Range / Curve).
- **Drag a bar** (`enableInteraction(true)` in synth mode): sets that param's raw value from Y (`yToValue`), routes + updates heatmap. Sliding across bars reassigns the dragged index.
- **Hover/click a section label** → `<GroupOverrideDrawer>` (320 px glass card, portal). Contents:
  - **Group master curve**: 48×48 draggable canvas. Vertical drag applies a *relative delta* to the group curve **and to every per-param curve** in the section (preserving relative offsets). `delta = dy/80`.
  - **Per-param rows**: name, 28×28 per-param curve canvas (vertical drag), dual-range min/max slider, and an **M (mute)** button. Muted rows hide curve+range, show a grey value slider, and strike-through the name. Mute removes the param from NISPS control.
  - For C15 this is backed by `groupOverrides[si]` + `SYNTH_SECTIONS`; for Faust engines by `engineParamOverrides` + `nonC15Sections` (group curves remembered by name across engine swaps). Unify behind a `getSectionView(sectionIndex)` adapter (a-app.js:3916).

### 2.6 Output-mode tabs (`setOutputMode()`:2786)
In `<ModeDrawer>`, pill toggle: **Visual / Synth / MIDI CC / Audio Canvas** (`#output-toggle-float`). On switch:
- Compute `targetOutputs = outputCountForMode(mode)` (visual 20, synth = engine paramCount [126 for C15], midi-cc = `midiCCMap.length`, audio-canvas = `audioCanvas.getOutputCount()`).
- If output count changes **and** there are training examples: `confirm()` a weight-reset warning; on cancel, revert pill. Then `resizeMLP()` (warm-starts joystick weights, clears examples, recreates hand IML).
- Toggle canvases/strips: synth → hide `#vis-canvas` (`.hidden-canvas`), show `#synth-vis-canvas` (`.active`), hide heatmap strip, show synth quick controls, `synthVisualizer.enableInteraction(true)`. Other modes show heatmap strip, hide synth vis, disable interaction; midi-cc shows MIDI quick controls; audio-canvas shows its wrap.
- `buildHeatmap()` + `routeOutputs()` + `buildEngineParams()` + sync.

### 2.7 Input toggle + follow (`wireInputToggle()`:2622, `toggleFollowMode()`:2360)
- `<ModeDrawer>` "Input" pill toggle: **Joystick / Hands**. Switching to Hands lazily constructs `HandTracker`, requests camera, swaps `iml=imlHand`, hides joystick, shows PIP; on camera error reverts to joystick. (Hand tracking deferrable — see §10.)
- **Follow pill** (`#follow-pill`) and the joystick double-tap both call `toggleFollowMode()`. `updateFollowUI()` shows the FOLLOW badge, adds `.follow-active` (pulsing border) and marks the pill active.

### 2.8 Dock icons → drawers (`wireDock()`:2521)
- Click a `.dock-icon[data-drawer=X]`: if `X==='help'` open the modal; else toggle `#drawer-X` `.hidden` and the icon's `.active`. `.drawer-close` buttons close their drawer + deactivate the icon. Drawers are independent (stack scrolls). The 6 icons: **Training, Mode, Synth, NISPS (params), FX (eoc), Help**.

### 2.9 Presets
Two distinct preset systems — keep them separate:
- **Visual/RL presets** (`<TrainingDrawer>` chips: Calm/Chaos, Rainbow, Vortex, Spiral, Embers) — `loadPreset(name)` (3060): clears the **joystick** dataset, adds the preset's hardcoded input→output examples (`PRESETS`, a-app.js:59; each output is 20 floats padded to N), trains synchronously, re-infers. These teach the *network*.
- **Synth presets** (`<SynthPresetSelect>` dropdown, tiered) — `applyPreset(presetId)` (460): sets which of the engine's params are active vs muted and their min/max/curve/fixedValue, via `groupOverrides` (C15) or `engineParamOverrides` (Faust). Tiers expose progressively more params (Beginner 15 → Expert full). These shape the *output mapping*, not the network. `?preset=<id>` URL param auto-applies on load.

### 2.10 Gamepad (`wireGamepad()`:3645)
`GamepadInput` with `invertY:true`. Left stick → `joyX/joyY` + `onJoystickMove`. Buttons: LB→down, RB→up, A→train, X→randomize, B→clearExamples. Status text in `#gamepad-status`.

---

## 3. Theme / branding tokens and key copy

### CSS custom properties (`:root`, css:11) — reproduce verbatim
```css
--glass-bg: rgba(13, 13, 13, 0.65);
--glass-border: rgba(255, 255, 255, 0.08);
--glass-blur: 16px;
--accent: #ff6a00;          /* signature orange */
--accent-dim: rgba(255, 106, 0, 0.25);
--danger: #ff4466;
--text: #e0e0e0;
--text-dim: #888;
--radius: 12px;
--radius-sm: 8px;
--safe-bottom: env(safe-area-inset-bottom, 0px);
--dock-width: 48px;
--dock-gap: 8px;
```
- **Background**: `#0d0d0d` everywhere; `html,body { overflow:hidden; touch-action:none; user-select:none }`.
- **Font**: `'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace`; base `13px`. Loaded from Google Fonts (`JetBrains+Mono:wght@400;500;700`).
- **Glass mixin**: `background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--glass-border)`. Drawers use a denser `rgba(13,13,13,0.88)` + `blur(20px)`.
- **RL up** = teal `#00c8a0` (border/bg tinted); **RL down** = red-orange `#dc3c14`. EOC RL up = `#4ecdc4`. Noise ring = `rgba(255,100,50,…)` → high `rgba(255,60,40,…)`.
- **Dock**: macOS magnify — `.dock-icon:hover { transform: scale(1.35) }`, neighbours scale 1.12 via `:has()`/sibling selectors; active icon tinted orange.
- **Animations to reproduce**: `drawerSlideIn` (0.2 s translateX), `follow-pulse` (1.5 s box-shadow), `rl-flash` / `btn-flash` (0.25 s scale), `audioInitPulse` (2 s, on play button when audio not started), `helpFadeIn`.
- **Heatmap frozen cell**: 45° hatched `rgba(80,160,255,0.15)` overlay + bar opacity 0.4.

### Key copy to reproduce verbatim
- **Title** (`<title>`): "NISPS Immersive". **Help modal H2**: "Welcome to NISPS"; subtitle: "Neural Interactive Shaping of Parameter Spaces".
- **Status line** default: `"0 examples · untrained"`; live format: `"<N> example(s) · loss <0.00000> · noise <0.000>"` (or `· untrained` when never trained). Middots are U+00B7.
- **RL buttons**: down has `−` + `1`; up has `+` + `2`; titles "Explore more" / "Keep this". Undo title "Undo last action".
- **Help modal** is a long static block — reproduce sections **What is this? / How it works / What to expect / Controls (Touch/Mouse, Keyboard 1/2/3/4/Z, Gamepad) / Hand Tracking / Synth Controls**, plus the "Got it" button. (Full text is in `a-immersive.html` lines 354–441 — copy it wholesale; it's the authoritative onboarding copy.) Auto-opens when `localStorage['nisps-help-seen']` is unset; closing sets it.
- **Dock labels**: Train, Mode, Synth, NISPS, FX, Help. **Drawer headers** (uppercase orange): Training, Mode, Synth, MIDI CC, NISPS, Effects Chain.
- **Training drawer buttons**: Add Example, Train, Clear Ex, Clear All, Randomize; preset chips Calm/Chaos, Rainbow, Vortex, Spiral, Embers.
- **Synth preset `<select>`**: option "Manual" (value `""`), then optgroups Beginner(1.1–1.4), Intermediate(2.1–2.4), Advanced(3.1–3.3), Expert(4.1–4.2).
- **Back button** → `designs.html`.

---

## 4. SVG icons (inline, reproduce as components)
All dock icons, the back chevron, the undo arrow, the play/pause/MIDI-keyboard icons, and the gesture ring are inline SVGs in the HTML. Reproduce as small SolidJS components (paths are in `a-immersive.html`):
- Back: `<path d="M10 2L4 8l6 6"/>` (stroke).
- Play: `<path d="M4 2l10 6-10 6z"/>` (fill); Pause: two rects.
- Dock: Train (mixer faders), Mode (two circles + diagonal), Synth (sine wave `M2 10c2-4 4-4 6 0s4-4 6 0`), NISPS (gear), FX (infinity-ish loop), Help (question mark in circle).
- Undo: `<path d="M3 7h6a4 4 0 0 1 0 8H7"/><path d="M3 7l3-3M3 7l3 3"/>`.

---

## 5. State model → SolidJS stores/signals

The deployed app keeps state in module-level `let`s. Map to stores/signals. **Performance rule** (from migration plan): ML outputs should be a single `Float32Array` signal updated once per frame, not a reactive array of 126 cells — drive canvases imperatively, drive the heatmap DOM widths via a cheap effect.

| Deployed state (a-app.js) | SolidJS home | Notes |
|---|---|---|
| `iml`/`imlJoy`/`imlHand`/`imlEoc` | non-reactive refs in an **EngineContext** | WASM instances; never put in a store |
| `inputMode` ('joystick'\|'hands') | `inputStore` signal | drives joystick vs PIP |
| `outputMode` ('visual'\|'synth'\|'midi-cc'\|'audio-canvas') | `modeStore` signal | gates canvases, heatmap, quick controls |
| `joyX,joyY,joyDragging,joyFollowMode,joyTrail` | `inputStore` (x/y signals + follow signal) | x/y change every frame → keep as plain signals |
| current outputs (`iml.getOutputs()`) | `outputStore` — **one `Float32Array` signal** | updated once per `routeOutputs` |
| `rawParamValues` | `outputStore.raw` (Float32Array signal) | the "set sliders" buffer for examples/heatmap drag |
| `noiseLevel,spreadLevel,rlExplorationDecay` | `mlStore` signals | spread also from `?spread`; default 0.6, noise 0.05, decay 0.97 |
| `iml.learningRate / maxIterations / convergenceThreshold` | exposed via `mlStore` getters/setters | the 6 NISPS sliders write these |
| `exampleCount,lastLoss,lossHistory` | `mlStore` (derived from iml after each op) | status line + loss canvas |
| `undoStack` (cap 20) | `mlStore.undo` (non-reactive array + `hasUndo` signal) | snapshot = {weights,noiseLevel,exampleCount} |
| `visualOverrides[20]` | `overrideStore.visual` (createStore) | {min,max,curve,frozen,fixedValue} |
| `groupOverrides[18]` (C15 sections) | `overrideStore.group` (createStore) | {curve, params:[{min,max,curve,muted,fixedValue}]} |
| `engineParamOverrides` (Faust, flat) | `overrideStore.engine` | null for C15 |
| `midiCCMap,midiCCOverrides` | `midiStore` | per-engine storage key |
| `audioCanvasOverrides` | `overrideStore.audioCanvas` | dynamic length |
| `activeEngine,activeSynthPresetId` | `synthStore` signals | engine id + preset id |
| `eocChain,eocTrainingTarget,nispsMode` | `eocStore` | deferrable |
| drawer open flags, active dock icon | `uiStore` (per-drawer booleans) | independent drawers |
| `activePopupParam,activeDrawerSection` | `uiStore` signals | popup/group-drawer routing |

**Persistence** (`saveState()`:4298, `loadState()`:4346): single `localStorage['nisps-a-immersive']` JSON blob. Saved fields: `features/labels` (joystick dataset), `handFeatures/handLabels`, `noiseLevel`, `outputMode`, `inputMode`, `joyX/joyY`, `groupOverrides`, `visualOverrides`, `midiCCOverrides`, `audioCanvasState`, `synthPresetId`, `engineId`, EOC module/mode state, `modularDspState`. On load: re-add examples and **train synchronously**, restore overrides, restore output mode (`skipConfirm:true`), but **never auto-restore `inputMode='hands'`** (camera permission). Auto-save fires on a 10 s interval and `saveState()` is also called after preset apply etc. In SolidJS, run a debounced effect (the migration plan uses 200 ms) that serializes the same shape; keep the storage key identical for migration continuity. Separate keys: `nisps-help-seen`, `nisps-midi-cc-map:<engineId>`, `nisps-modular-state`.

---

## 6. Engine call points (bind to the shared engine layer)

The shared engine layer is **`WasmIML`** (`js/nisps/nisps-wasm.js`) for ML, plus a **`SynthEngine`** (default `C15Adapter`) for audio. The new SolidJS app should transplant these (per migration plan they move under `core/` largely unchanged) and call them from store actions. Exact bind points:

**Construction (`init()` / `resizeMLP()`):**
- `imlJoy = await WasmIML.create(2, N_OUTPUTS, [32,48,64], 1000, 1.0, 0.00001)` then `imlJoy.randomiseWeights(spreadLevel)`.
- `imlHand = await WasmIML.create(14, N_OUTPUTS, [48,48,64], …)`.
- On output-count change: `WasmIML.createWithWarmStart(snapshot, newCount, …)` for the joystick IML (preserves hidden weights, re-randomises new output nodes), fresh `create` for hand.
- WASM module loaded from `wasm/nisps.js` (Emscripten). Note: the **engine MLP that runs audio in the worklet** is a separate WASM instance fixed at `MLP<2,10,14,18,126>` per CLAUDE.md — but in a-immersive the *inference path* is this `WasmIML`, sized to the active mode's output count.

**Per-frame inference (joystick/hand move, `onJoystickMove`/`onHandInput`):**
- `iml.setInput(0,x); iml.setInput(1,y); iml.process(); const out = iml.getOutputs();` → `routeOutputs(out)`.

**`routeOutputs(out)` (2425) — the output fan-out** (bind one store action):
- **synth**: apply `applyGroupOverrides(out[i], i)` per index → `synthVisualizer.setParams(overridden)`; throttled (≥50 ms) + dead-zone (>0.002) `activeEngine.setParam(i, v)` for indices < engine paramCount; shared-mode EOC params routed to `eocChain.setParam`.
- **midi-cc**: per CC, `applyGroupOverride(out[i],curve,min,max)` → `midiOutput.sendBatch([{channel,cc,value:round(v*127)}])`.
- **audio-canvas**: `audioCanvas.setOutputs(out)`.
- **visual**: per-index `applyGroupOverride` (or `fixedValue` if frozen) → `visualizer.setParams(vis)`.

**RL / training engine calls** (the interaction→engine mapping the prompt cares about):
| UI action | Engine call |
|---|---|
| **thumbsUp / + / key 2 / RB / hand-up** | `iml.addExample(inputs, rawOutputs)` **+** `iml.trainAsync(cb)` |
| **thumbsDown / − / key 1 / LB / hand-down** | `iml.moveWeights(noiseLevel, spread)` *(no example)* |
| **Add Example button** | `iml.addExample(getCurrentInputs(), [...rawParamValues])` |
| **Train button / gamepad A** | `iml.trainAsync(cb)` (async; updates loss canvas) |
| **Randomize / gamepad X** | `iml.randomiseWeights(spread)` → re-infer; resets noise to 0.05 |
| **Clear Ex / gamepad B** | `iml.clearDataset()` |
| **Clear All** | `clearDataset()` + reset `lossHistory/bestLoss/iterations` + `clearState()` |
| **Undo / key Z** | `iml._setFlatWeights(snapshot.weights)` → re-infer |
| **Visual preset chip** | clear joystick dataset, `addExample` × preset rows, `iml.train()` (sync) |
| **NISPS sliders** | write `spreadLevel` / `noiseLevel` / `iml.learningRate` / `iml.maxIterations` / `iml.convergenceThreshold` |

**WasmIML public surface to rely on** (stable contract): `setInput/setInputs/getOutputs/process/inferBatch`, `addExample/clearDataset/exampleCount`, `train()/trainAsync(cb)/isTraining/evalLoss()`, `randomiseWeights(spread)`, `moveWeights(speed,spread,pinMask?)`, `extractWeights()/createWithWarmStart()`, `_getFlatWeights()/_setFlatWeights()`, `getLayerStats()`, `lastLoss/bestLoss/lossHistory/totalTrainingIterations`, `dataset.features/labels`, `destroy()`. Training runs in a disposable Web Worker (`nisps-wasm-worker.js`).

**SynthEngine (`C15Adapter`) surface**: `id`, `displayName`, `paramMeta` (array of `{id,name,min,max,init,curve,group}`), `paramCount`, `init(ctx?)`, `stop()`, `running`, `setParam(index, normalized)`, `noteOn(note,vel)`, `noteOff(note)`, `getOutputNode()`, `setMasterVolume(v)`, `panic()`. Audio is started lazily on the play button (`activeEngine.init()`), which also wires EOC and (behind flag) ShapeSeq. Arpeggiator (`Arpeggiator`) and `MIDIInput` are attached to the active engine.

### Where the NEW 3-mode feedback selector ("Down Action") slots in
Today **`−` (thumbsDown) is hardcoded to `moveWeights`** (explore) while **`+` is hardcoded to `addExample`+`train`** (reinforce). The new feature wants the `−` action to be selectable among 3 feedback modes. Slot it as a **`<DownActionSelector>`** control:

- **Placement (UI)**: a small segmented control. Most faithful spot is inside the **Training drawer** (a new "Down Action" row above the example actions) and/or a compact 3-way toggle adjacent to the RL cluster (mirroring how the existing `rl-label`/EOC label sit above the buttons in linked mode). It must be reachable without opening a drawer if it's meant for live use — consider a tiny pill under `<StatusLine>` or next to the `−` button.
- **State**: add `downAction: 'explore' | <mode2> | <mode3>` to `mlStore` (persist it in the state blob).
- **Bind point**: `onThumbsDown()` is the single chokepoint. Branch on `mlStore.downAction`:
  - `explore` (current): `target.moveWeights(noiseLevel, spread)`.
  - the two new modes: call the corresponding engine primitive (e.g. a "negative example" path via `addExample` of a contrasting target, or a stronger/weighted `moveWeights`, or `randomiseWeights` — whatever the 3 modes are defined to do). `WasmIML.moveWeights` already accepts an `outputPinMask`, so a "pin-aware explore" mode is a natural third option.
  - Keep `pushUndoSnapshot()` + `updateNoiseRing()` + `flash` shared across all branches.
- The existing `_rlTarget()` indirection (which lets EOC linked-mode redirect feedback to `imlEoc`) should compose with the new selector — i.e. `downAction` chooses *what* the feedback does, `_rlTarget()` chooses *which network* receives it.

---

## 7. Reference data tables (must match exactly)

### Visual mode: 20 named outputs (`VISUAL_PARAM_NAMES`, a-app.js:46 + `visualizer.setParams`:159)
Names: `Flow, Scale, Speed, Hue, Spread, Size, Trail, Turb, Attract, Radius, DispRate, DispAmt, Lifetime, Respawn, Advection, Inertia, Drag, Repulse, RepCnt, RepRate`. Colors in `VISUAL_PARAM_COLORS` (a-app.js:51, e.g. `Flow=#ff6a00, Scale=#00ccff, Speed=#ff6600, Hue=#ff00cc, …`). Output→visual-param ranges (verbatim, for the FlowFieldCanvas): `angleOffset=out0*2π`, `scale=0.001+out1*0.009`, `speed=0.5+out2*4.5`, `hueBase=out3*360`, `hueSpread=out4*120`, `particleSize=1+out5*5`, `fadeRate=0.01+out6*0.14`, `turbulence=out7*2`, `attractStrength=0.1+out8*2.9`, `attractRadius=40+out9*420`, `dispersionRate=0.2+out10*8`, `dispersionAmount=out11*3`, `particleLifetime=30+out12*470`, `respawnStyle=out13`, `advectionMode=out14`, `inertia=out15*0.98`, `drag=out16*0.35`, `repulsorStrength=out17*4.5`, `repulsorCount=floor(out18*4.999)`, `repulsorOrbitRate=0.1+out19*2.9`. 400 particles, value-noise flow field with central attractor, dispersion pulses, and orbiting repulsors. Transplant `FlowFieldVisualizer` as-is.

### Synth mode: C15 sections (`SYNTH_SECTIONS`, a-app.js:217) — for grouping the 126 bars
`Env A(7), Env B(7), Env C(6), Osc A(5), Osc B(5), Shp A(6), Shp B(6), Comb(8), SVF(9), Gap(6), FB Mix(9), Out Mix(14), Cabinet(8), Flanger(13), Echo(7), Reverb(6), Unison(3), Mono(1)` = 126, each with a section color. Param data (id/name/label/default/safeMin/safeMax/bipolar) is `SYNTH_PARAM_MAP` (`js/synth/param-map.js`, 126 entries) — transplant as data, unchanged.

### Curve math (`param-map.js`:287) — reproduce exactly
```
applyCurve(v, c)        = c===0.5 ? v : v^(2^(4*(c-0.5)))    // 0.5 = linear
applyGroupOverride(v,c,min,max) = min + applyCurve(v,c) * (max-min)
```

### `?tame` (default 1): seeds each C15 param's default override range to `[safeMin*tame, 1-(1-safeMax)*tame]` (a-app.js:248). `?spread` (default 0.6), `?preset`, `?debug`, `?shapeseq=1` are the URL params.

---

## 8. Layout / positioning cheat-sheet (fixed coordinates to match)
- Back button: `top:45px; left:8px; 36×36`. Synth quick controls: `top:45px; left:52px` (row). Heatmap strip: `top:0; height:22px`. Joystick: `bottom:100px; left:24px; 160×160`. Hand PIP: same anchor, `180×135`. RL buttons: `bottom:36px; left:50%` centered, 64×64 circles, 12 px grid gap, undo 28×28 spanning. EOC RL: `bottom:36px; left:calc(50%+100px)`, 48×48. Status line: `bottom:8px; center`. Dock: `right:8px; top:50%` vertical, 36×36 icons, 16 px radius glass. Drawer stack: `right:calc(48px+16px); top:28px; bottom:28px; width:260px`, scrolls, `pointer-events:none` on stack / `auto` on each drawer. Drawer max-height 400 px. Group drawer 320 px, param popup 260 px — both portalled to body and positioned relative to the hovered element.
- z-index ladder: canvases 0–1, heatmap strip 20, tooltip 25, joystick/back/quick 30, status 40, drawers/RL 45, dock 50, group-drawer/popup 50, dev panel 90, help overlay 100.

---

## 9. SolidJS implementation notes
- **Canvases**: `<FlowFieldCanvas>` / `<SynthVisualizer>` / `<JoyMapCanvas>` are components with a `ref` and an internal draw method; the **shell's single rAF** calls the active one (don't give each its own loop — matches `animate()` and avoids double-drawing). Resize via a window listener that re-inits particles.
- **Heatmap**: render `<For>` over `count` cells once per mode change; update bar widths via a `createEffect` reading the outputs signal — but throttle DOM writes (the deployed app writes width % directly each frame; with 126 cells prefer writing only changed cells).
- **Drawers/overlays**: build headless primitives (`Drawer`, `Overlay`, `Popover`, `Dock`) per the migration plan; the dock/drawer toggle is just boolean signals in `uiStore`. Independent open state (multiple drawers can coexist).
- **Pointer capture**: the joystick, heatmap cells, synth bars, curve canvases, and dual-range sliders all use `setPointerCapture` + manual drag math — replicate the exact thresholds (3 px click-vs-drag on heatmap; double-tap 350 ms; group-curve `dy/80`; per-param curve drag).
- **Untracked debug probe**: keep `window.__nisps` (synchronous, bypasses reactivity via `untrack`/`batch`) for Playwright — its API is the table in §6 plus `getLayerStats/inferBatch/saveState/evalLoss`. Also `window.__nispsEoc` (training target). These are how E2E tests drive the app.

---

## 10. Gaps / risks for a faithful clone

**Core (must build to match the page):**
- WASM IML inference + sync/async training + `moveWeights`/`randomiseWeights`/warm-start — the whole ML surface. Non-negotiable; transplant `nisps-wasm.js` + `nisps.wasm`.
- C15 synth engine (`C15Adapter`/`C15Bridge` + `param-map.js` + `presets.js`) — runs via AudioWorklet + SharedArrayBuffer; needs COOP/COEP headers (the deployed app uses `serve-coop.py`). The 126-param map, tiered presets, group/param overrides, and the synth visualizer are all core to "synth mode."
- Flow-field visualizer (20 outputs), heatmap + override popup, joystick + noise ring, RL cluster + keyboard + undo, dock/drawers, status line, help modal, the 6-slider NISPS drawer, visual presets, persistence. All core.
- Arpeggiator + MIDI input (used by synth mode); MIDI CC output mode (`midi-output.js`, `midi-cc-map.js`, `midi-cc-presets.js`).

**Deferrable / flagged (render scaffolds but feature can lag):**
- **Hand tracking / MediaPipe** (`hand-tracker.js`, PIP, gesture ring, 14-input `imlHand`) — heavy dep, camera permission; the help text and Mode toggle reference it but it can be a later add. Note as optional.
- **EOC Effects Chain** (`eoc/`, `eoc-chain-ui.js`, `eoc-joystick.js`, linked/independent/shared NISPS modes, second `imlEoc`, FX RL buttons, keys 3/4) — large subsystem; the dock has an "FX" icon but it's a self-contained module. Deferrable.
- **Modular engine** (512 params, `modular-engine.js`, `modular-ui.js` — 51 KB UI) and **Faust additive/FM engines** (`faust-engine-base.js`, additive/fm presets) — accessed via the engine switcher in the Synth drawer. The switcher + C15 are core; the alternative engines are deferrable (and Faust needs a running AudioContext + the Faust runtime). CLAUDE.md flags Faust engines as not-yet-wired in the new codebase.
- **Audio Canvas mode** (`audio/audio-canvas.js`, 60 KB) — a fourth output mode with dynamic output count; scaffolded but can defer.
- **ShapeSeq** (`shapeseq/`, behind `?shapeseq=1`) — sequencer; explicitly flag-gated, defer.
- **OSC bridge** (`nisps/osc-client.js`, `synth/osc-output.js`, `osc-bridge/`) — desktop/hardware bridge, not used in the default browser path; defer.
- **Gamepad** — small (`gamepad.js`), low-risk; include if cheap, else defer (it just mirrors joystick + RL).

**Behavioural risks to watch:**
- Output-count changes trigger `confirm()` dialogs and weight warm-start — replicate the guard so mode switches don't silently wipe training.
- Param throttling (50 ms / 0.002 dead-zone) on synth param sends is load-bearing (prevents ring-buffer flooding at 126×30 fps); keep it.
- The two preset systems (visual examples vs synth override tiers) are easy to conflate — keep them as distinct stores/actions.
- Frozen/muted semantics differ between the heatmap popup (`frozen`) and the group drawer (`muted`) but map to the same underlying field via the `getParamOverride` adapter — preserve that mapping (`muted`↔`frozen`).
- Help/onboarding, `nisps-help-seen`, and the 10 s autosave are small but part of the felt experience.

**Files that ARE the engine layer to bind to** (absolute paths): `/home/w1n5t0n/deployments/meml-aimmersive/js/nisps/nisps-wasm.js`, `/home/w1n5t0n/deployments/meml-aimmersive/js/nisps/nisps-wasm-worker.js`, `/home/w1n5t0n/deployments/meml-aimmersive/js/nisps/dataset.js`, `/home/w1n5t0n/deployments/meml-aimmersive/js/synth/c15-adapter.js`, `/home/w1n5t0n/deployments/meml-aimmersive/js/synth/c15-bridge.js`, `/home/w1n5t0n/deployments/meml-aimmersive/js/synth/param-map.js`, `/home/w1n5t0n/deployments/meml-aimmersive/js/synth/presets.js`, `/home/w1n5t0n/deployments/meml-aimmersive/js/ui/visualizer.js`. UI behaviour source of truth: `/home/w1n5t0n/deployments/meml-aimmersive/js/a-app.js`. Theme: `/home/w1n5t0n/deployments/meml-aimmersive/css/a-immersive.css`. DOM + copy: `/home/w1n5t0n/deployments/meml-aimmersive/a-immersive.html`.
