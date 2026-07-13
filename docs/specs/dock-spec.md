---
kind: spec
stability: evolving
layer: behavioural
---

# Dock Spec — Console Right-Dock Drawers + Per-Output Controls

*Workstream D. Read-only design, 2026-06-27. Target app: `manifold/` (Vite + React + TS), wired to the parity-tested TS engine (`playground/src`) via the headless `EngineApi` boundary (`engine-architecture.md` §2). Citations are `file:line`. British spelling in product copy. The built-in synth is the **"Powerful Synth Engine"** — the string "C15" MUST NEVER appear in the UI.*

This spec replaces the placeholder Shape/Feel/Route/Health/Help drawers in `ConsoleApp.jsx` (`recon/findings-design-and-manifold.md` §2 — keyboard `1-5` map drawers, `\` toggles depth) with the real dock contents.

---

## 0. The 3-depth dock model (frame the design)

The Console's right dock is a 48px rail (`--dock-width`, `aimmersive-clone-spec.md:181`) of icons; each icon owns one drawer with **three depths**:

| Depth | Width / placement | Purpose | Source vocabulary |
|---|---|---|---|
| **peek** | narrow flyout (~72px) hugging the rail | glanceable status + 1–2 primary toggles; no scrolling | `playground-2026.md` dock+drawer |
| **expand** | glass panel ~300px (cf. a-immersive drawer-stack `width:260px`, `aimmersive-clone-spec.md:312`) | the working surface: the per-output rows, the live sliders, the mode toggles | a-immersive drawers |
| **FULL** | near-fullscreen **modal** (`--z-modal`, glass over dimmed canvas) | the "advanced config page" for one entry — backend CC tables, full param matrix, weight-health lab | mission "advanced" page |

- **Depth is per-drawer state** in `uiStore` (`peek | expand | full`), independent across drawers (a-immersive allows multiple open at once, `aimmersive-clone-spec.md:84`). FULL is mutually exclusive — only one modal at a time (it captures the screen).
- `\` toggles the *focused* drawer peek↔expand; a drawer's header **⤢ button** (or double-click a row) opens FULL.
- Esc closes FULL→expand; closing FULL restores prior depth.
- Drawers slide in via `drawerSlideIn` 0.2s translateX (`aimmersive-clone-spec.md:189`). FULL fades via `helpFadeIn`.
- Dock icons get `.active` tint (`--accent #ff6a00`) when their drawer is open; macOS magnify on hover (`scale(1.35)`, `aimmersive-clone-spec.md:188`).

**Drawer roster** (six icons, top→bottom on the rail):

| Icon | Drawer | One-line role |
|---|---|---|
| 🧠 LEARN | **Learning-Behaviour** | Feedback-mode selector, SOLO/arm chooser, live training params |
| 🎚 IN | **Inputs** | Input source + per-axis pipeline (workstream F territory — referenced, §6) |
| 🔀 OUT | **Outputs / Routing** | The per-output control matrix + backend selector (workstream E + §3, §4) |
| 🔊 SYNTH | **Powerful Synth Engine** | Engine switch + audio/arp controls + group overrides |
| ✦ VISUAL | **Particle / Visual System** | Flow-field visualiser params + presets |
| ? HELP | **Help** | Onboarding overlay (opens modal directly, not a drawer) |

---

## 1. LEARNING-BEHAVIOUR drawer

Owns *how the model learns from your gestures*: the feedback-mode selector, the SOLO/arm variant chooser, and the live training knobs. Binds to `EngineApi.feedback` (`engine-architecture.md` §2.2) and the feedback C API (`findings-engine-surface.md:52`, `nisps_ml_feedback_*`).

### 1.1 FEEDBACK_MODE selector ("Down Action")

The `+` (up) verdict is always "keep this" (`addExample` + train, `findings-feedback-behaviour.md:102`); the `−` (down) verdict is **selectable** among the ported feedback modes (`feedback-modes-port-spec.md` §1; `FeedbackController<MLP_T>`). The new 2-mode product surface (per the prompt's "Mode 1 / Mode 2"):

| Selector label (UI copy) | Engine `FeedbackMode` | Behaviour |
|---|---|---|
| **Push away** (Mode 1) | `Avoid` (`feedback.hpp` enum, `findings-feedback-behaviour.md:90`) | down → geometric-dislike: perturbs the mapping away from what you disliked. In the deployed core this routes to `move_weights(speed, spread, pinMask)` (`feedback-modes-port-spec.md` §2.5 — the true k-NN centroid push is firmware-only, out of scope). |
| **Explore & place** (Mode 2) | `RandomiseMlp` (`findings-feedback-behaviour.md:122`) | down → snapshot + `draw_weights(spread)` re-rolls the whole net into a scratchpad you audition by moving the joystick; `+`/drag commits a `+1` example at the chosen input and **restores the real net** (`findings-feedback-behaviour.md:135-146`); down-again **cancels** (restore snapshot). |

- A third engine mode `RandomiseOutputs` (bypass MLP, hold a static random vector, `findings-feedback-behaviour.md:111`) exists in the core but is **not** surfaced as a product mode in v1 — expose it only behind `?debug=1` as "Static roll". **(Open choice 1.)**
- **Peek**: a 2-segment pill (`Push away` / `Explore & place`), the current mode highlighted in `--accent`. This pill is *also* mirrored next to the Verdict cluster (`VerdictCluster`, `findings-design-and-manifold.md:50`) so it is reachable during live play without opening the drawer — matching how a-immersive puts the `rl-label` above the RL buttons (`aimmersive-clone-spec.md:283`).
- **Expand**: the pill + a one-line plain-English description of the active mode + an **"exploring…" indicator** that lights when `engine.feedback.exploring()` is true (`findings-feedback-behaviour.md:237`), reusing the `<NoiseRing>` colour ramp (off/active/high, `aimmersive-clone-spec.md:98`). While exploring in Mode 2, training is paused (`learning_paused()`, `findings-feedback-behaviour.md:48`) — show a small "learning paused" badge.
- **FULL**: the feedback lab — a diagram of the active state machine (idle → exploring → commit/cancel), the raw `FeedbackAction` log of the last presses (`findings-feedback-behaviour.md:90` enum), plus the spread/tame "Health lab" sliders (§1.3) for radical exploration tuning.
- **Bind point**: `engine.feedback.setMode(mode)` → `nisps_ml_feedback_set_mode` (`feedback-modes-port-spec.md` §4). Switching mode while exploring auto-aborts and restores the net (`set_mode` calls `abort_explore`, `findings-feedback-behaviour.md:96`). Persist `feedbackMode` in the session blob.

### 1.2 SOLO / arm variant chooser

"Solo" and "arm" are the SAME concept (the prompt: *solo(=arm)*): **focus training on one output**. It maps to the engine's **focus mask** (`activeDims_` → `nisps_ml_feedback_set_focus`, `findings-feedback-behaviour.md:159-167`) AND to the **output-pin mask** used by `move_weights`/`buildPinMask` (`findings-feedback-behaviour.md:117`, `mode-runtime.ts:548`).

Two armable scopes (the chooser):

| Variant | Effect | Engine wiring |
|---|---|---|
| **Arm output** (per-row solo) | only the armed output(s) learn/re-roll; all others are frozen in the model | `set_focus(mask)` where `mask[i]=1` for armed dims; unmuted-but-unarmed dims set `0` so `move_weights`/`roll_static_outputs` leave them put (`findings-feedback-behaviour.md:71,103-107`) |
| **Arm all** (default) | every live output learns (empty mask ⇒ all active, `findings-feedback-behaviour.md:161`) | `clear_focus_mask()` |

- Arming is a per-output toggle (the **S** button on each control row, §3) — arming any output flips the drawer into "arm-output" scope automatically; clicking the drawer's **"Arm all"** chip clears it.
- Multiple outputs may be armed at once (mask is a vector). The armed set is highlighted on the ReadoutStrip and on the heatmap (border glow, `--glow-focus`).
- **Peek**: shows "Arm: all" or "Arm: 3 outputs"; tapping cycles to "Arm all".
- **Expand**: the scope chips + a compact list of currently-armed output names with quick-unarm.
- **Persisted** as part of routing state (the focus mask is reconstructable from per-row `armed` flags).

### 1.3 Live training params

Six live knobs, lifted from a-immersive's "NISPS" drawer (`aimmersive-clone-spec.md:67` — the deployed app's *actual* tuning surface, six raw sliders) plus the spread/tame regime controls:

| Slider | Range | Default | Binds to |
|---|---|---|---|
| **Noise** | 0–noiseCap | 0.05 | `mlStore.noiseLevel`; the `−` perturbation magnitude (`findings-feedback-behaviour.md:110`) |
| **Learning rate** | 1e-6 – 1e-2 (log) | 1e-5 | `iml.learningRate` (`aimmersive-clone-spec.md:226`) |
| **Decay** | 0.8–1.0 | 0.97 | `rlExplorationDecay` (`findings-feedback-behaviour.md:103`) |
| **Spread** | 0–1 | 0.6 | `spreadLevel` — master noise/Xavier regime (`findings-feedback-behaviour.md:108`; CLAUDE.md `spread`) |
| **Tame** | 0–1 | 1 | output-range safety toward `[safeMin,safeMax]` (`param-map.js:261` `applyTame`) |
| **Max iters / Convergence** | — | — | `iml.maxIterations`/`convergenceThreshold` (`aimmersive-clone-spec.md:274`) — FULL-depth only |

- **Peek**: Noise + Spread (the two most live).
- **Expand**: Noise, Spread, Tame, Learning rate, Decay as `<Slider>`s.
- **FULL**: all six + Max iters/Convergence + a real `<LossPlot>` (needs `nisps_ml_loss_history`, `findings-design-and-manifold.md:62`) + `<WeightHealth>` edge-glow + `<LayerStats>` + `<GradientFlow>` (the diagnostics suite, `findings-design-and-manifold.md:63`). This is the "advanced learning" page.
- All writes are eager engine setters (no React-render coupling, `engine-architecture.md` §4); persisted in the session blob.

---

## 2. INPUTS drawer (workstream F territory — referenced)

**Owner: workstream F (modular N×M inputs + input pipeline).** This drawer is specified there; here we only fix its *dock shape* so the dock model is complete and the two specs dovetail.

- **Source**: input source selector — **Joystick / Hands / MIDI / Mic** (a-immersive Input pill, `aimmersive-clone-spec.md:150`). v1 browser is **fixed-2-input** (`findings-engine-surface.md:67`; `MLP<2,…>`) — modes needing >2 inputs show a "single-input in browser" badge (`engine-architecture.md` §6 open Q2).
- **Per-axis pipeline** (deadzone→zoom→curve→smoothing→momentum, `input/pipeline.ts`, `findings-design-and-manifold.md:84`): one `<ControlAxis>` row per input axis with its pipeline knobs.
- **Depth**: peek = source + zoom; expand = per-axis pipeline rows; FULL = the N×M input-routing matrix (workstream F).
- **Bind**: `engine.setInput(x,y)` is the only input door (`engine-architecture.md` §2.2); pipeline config lives in `input-store`.
- **Per-axis controls reuse the per-output row component** (§3) where sensible (an input axis has min/max/curve too), but mute/solo/freeze semantics differ — defer those to workstream F. **(Open choice 2: confirm input-axis rows share the §3 component or get their own.)**

---

## 3. OUTPUTS / ROUTING drawer + the per-output control row

The heart of this spec. **Owner of the routing matrix + per-output baseline is shared; backend-specific advanced layouts are workstream E (VCV/OSC/MIDI LED-ring backends, `findings-design-and-manifold.md:30`).**

### 3.1 The per-output baseline (EVERY output, EVERY backend)

Every output — synth param, MIDI CC, OSC path, VCV channel, visual param — shares one baseline control set. This faithfully ports the deployed vanilla-JS per-param override system (`aimmersive-clone-spec.md` §2.4 heatmap popup + §2.5 group drawer; `param-map.js` `applyGroupOverride`/`applyCurve`/`applyTame`). The baseline:

| Control | Glyph / widget | Semantics |
|---|---|---|
| **Mute** | **M** toggle | silenced *downstream* but still computed + visible (distinct from off) |
| **Solo / Arm** | **S** toggle | focus training on this output (§1.2; focus mask + pin mask) |
| **Tri-state** | **off / fixed / live** segmented | model-control state (table §3.3) |
| **Min / Max** | `<DualRangeSlider>` (min blue `#4488ff`, max orange `#ff6a00`, `aimmersive-clone-spec.md:130`) | output range remap; `applyGroupOverride(v,curve,min,max)` (`param-map.js:301`) |
| **Curve** | `<CurvePad>` 36×36 drag canvas, 0.5=linear (`aimmersive-clone-spec.md:128`; `applyCurve`, `param-map.js:287`) | per-output response curve |
| **Value** | inline read-out / drag bar | live model value, or the held value when fixed |

### 3.2 The control-row component + state model

```ts
// manifold/src/engine/routing/output-control.ts  (engine-side, headless)
type OutputState = 'off' | 'fixed' | 'live';   // the tri-state

interface OutputControl {
  index:   number;          // model output index (0..125 for synth)
  name:    string;          // schema label (NEVER "C15"; synth params from SYNTH_PARAM_MAP)
  group:   string;          // section (Env A, Osc B, …) for grouping
  state:   OutputState;     // off | fixed | live
  muted:   boolean;         // downstream silence; still computed
  armed:   boolean;         // solo / focus-training (=arm)
  min:     number;          // [0,1]
  max:     number;          // [0,1], min<=max enforced
  curve:   number;          // [0,1], 0.5 linear
  fixedValue: number;       // held value when state==='fixed' (captured on freeze)
  // backend-specific, populated by the active backend adapter:
  backend?: MidiCcSpec | OscSpec | VcvSpec;
}
```

- Stored in `routing-store` as a `createStore` array indexed by output (`engine-architecture.md` §1; `overrideStore` shape, `aimmersive-clone-spec.md:230`). This unifies a-immersive's split `visualOverrides`/`groupOverrides`/`engineParamOverrides`/`midiCCOverrides` (`aimmersive-clone-spec.md:230-233`) behind one `getSectionView` adapter (`aimmersive-clone-spec.md:140`).
- **Mute ↔ off are distinct fields** (the prompt insists): `muted` is a downstream gate; `state==='off'` excludes from model control. They compose (an output can be off AND muted).
- **The deployed app conflates frozen↔muted via one field** (`aimmersive-clone-spec.md:347` — heatmap popup `frozen` ↔ group drawer `muted` map to the same underlying field). The new model **separates them deliberately**: `state` carries off/fixed/live, `muted` is its own boolean, `armed` its own boolean. This is the one deliberate divergence from the deployed semantics — record in `ALIGNMENT.md`. **(Open choice 3.)**
- **Reactive binding**: the row's controls write the store eagerly; `routedOutput` memo (`engine-architecture.md` §2.1) reads `routing-store` to remap each output via `applyGroupOverride`. The single send-effect pushes to the active backend. A row never holds a second data path.

### 3.3 Tri-state semantics table (precise)

This matches the deployed per-param override system: `off`/`fixed` correspond to a-immersive's `frozen` (excluded/pinned, `aimmersive-clone-spec.md:131`), `live` to the default model-driven path.

| State | Computed by model? | Pin mask (`buildPinMask`) | Sent downstream? | Value emitted | UI |
|---|---|---|---|---|---|
| **off** | **No** — removed from model control; final-layer weights pinned so RL/train never touch it (`findings-feedback-behaviour.md:117`) | pinned (excluded) | yes, at last held value | `fixedValue` (held/excluded) | dimmed row, no bar motion |
| **fixed** (freeze) | computed but result discarded; held at a static value | pinned (protect the held dim) | yes | `fixedValue` (captured on freeze, draggable, `aimmersive-clone-spec.md:131`) | hatched bar overlay (`aimmersive-clone-spec.md:190`), value slider shown |
| **live** | **Yes** — model-driven | not pinned | yes | `applyGroupOverride(modelOut, curve, min, max)` | full bar, animates |

Orthogonal modifiers (compose with any state):

| Modifier | Computed? | Visible? | Sent downstream? | Training focus |
|---|---|---|---|---|
| **mute** | yes (still computed) | **yes** (bar visible) | **no** (silenced) | unaffected |
| **off** (state) | no | yes (dimmed) | yes (held) | excluded |
| **solo / arm** | yes | yes (focus glow) | yes | **this output only** (focus + pin mask) |

> Precise difference the prompt demands: **off** = the model no longer drives this output (excluded from learning, held/pinned). **fixed/freeze** = held at a static value (also pinned, but conceptually "I chose this value", with a draggable `fixedValue`). **mute** = silenced downstream but *still computed and visible* (distinct from off — you still see it move, you just don't hear it). **solo/arm** = focus training on this output.

### 3.4 Drawer depths

- **Peek**: backend badge (Synth / MIDI / OSC / VCV) + count of live/fixed/off/muted outputs + "Arm all" status.
- **Expand**: the **routing matrix** — a scrollable `<For>` of `<OutputControlRow>`s grouped by `group` (collapsible section headers carry a **group master curve** + **mute-group** like a-immersive's group drawer, `aimmersive-clone-spec.md:137`). Each row: name · M · S · [off|fixed|live] · dual-range · curve pad · value. 126 rows for synth — virtualise / collapse non-live by default.
- **FULL**: the **Advanced backend modal** (§4) — backend selector at the top, then the backend-specific editor over the full output set.
- **Backend selector** (workstream E): **Web Audio (synth) / Web MIDI / OSC bridge / VCV** (`engine-architecture.md` §1 backends; `aimmersive-clone-spec.md:143` output-mode tabs). Switching backend may change output count → reuse a-immersive's `confirm()` weight-reset guard (`aimmersive-clone-spec.md:144,344`).

---

## 4. ADVANCED modal — backend-specific layouts (FULL depth)

All backends share the §3.1 baseline (M/S/off-fixed-live/min/max/curve). The FULL modal adds the backend-specific fields. **(Workstream E owns the VCV/OSC/MIDI backend internals; this fixes the modal layout + state contract.)**

### 4.1 MIDI backend

Per-output extra fields (ported from a-immersive's MIDI-CC popup rows, `aimmersive-clone-spec.md:128`):

```ts
interface MidiCcSpec {
  cc:      number;   // 0..127, auto-named from CC_NAMES
  channel: number;   // 1..16
  value:   number;   // last sent, round(v*127)
  // min/max/curve from baseline define the 0..127 range mapping
}
```

- **Top of modal**: **number of CCs** (the output count for the MIDI backend = `midiCCMap.length`, `aimmersive-clone-spec.md:144`), output-device `<select>`, MIDI preset `<select>` (`aimmersive-clone-spec.md:32`).
- **Per-CC row**: editable Name (text), **CC#** (0–127 spinner, auto-renames from `CC_NAMES`), **Ch** (1–16), plus the baseline min/max/curve/state. 7-bit value = `round(applyGroupOverride(v,curve,min,max) * 127)` (`findings-engine-surface.md:36`). Persist via `nisps-midi-cc-map:<engineId>` key (`aimmersive-clone-spec.md:239`).
- **Send**: batched per block via `WebMidiBackend.send` (`engine-architecture.md` §1; `midiOutput.sendBatch`, `aimmersive-clone-spec.md:258`).

### 4.2 OSC backend

```ts
interface OscSpec {
  path:  string;   // e.g. "/synth/cutoff"
  min:   number;   // physical range lo (engineering units, not [0,1])
  max:   number;   // physical range hi
  // curve/state from baseline
}
```

- **Top of modal**: bridge connection status (WS, deferred contract — `engine-architecture.md` §1 `osc-bridge.ts`), add/remove path rows.
- **Per-output row**: **OSC path** (text), **range min/max** (typed numeric, physical units — distinct from the [0,1] baseline dual-range; the baseline min/max selects the normalised window, the OSC range maps that window to engineering units), plus baseline curve/state.
- v1: OSC bridge is **stubbed behind a locked contract** (`engine-architecture.md` §1) — the modal renders and persists config but emits only when a bridge is connected.

### 4.3 VCV backend

```ts
interface VcvSpec {
  // per-output min/max/freeze ONLY — the simplest backend
  // baseline min/max ARE the VCV range; baseline state 'fixed' IS freeze
}
```

- VCV adds **nothing beyond the baseline** — per-output min/max + freeze (= baseline `state==='fixed'`). The LED-ring palette derives from theme tokens (`findings-design-and-manifold.md:30`).
- **Top of modal**: per-channel min/max/freeze grid; that is the whole VCV advanced surface.

### 4.4 Web Audio (synth) — the default

The synth backend's advanced modal *is* the **group-override matrix** (§5 / the Powerful Synth Engine drawer's FULL depth): per-group master curve + per-param min/max/curve/mute over the 126 synth params (`aimmersive-clone-spec.md:137`). No extra per-output struct — the synth output *is* the baseline.

---

## 5. POWERFUL SYNTH ENGINE drawer

Owns the audio engine and its parameter shaping. **The string "C15" must never render** — the built-in engine is labelled **"Powerful Synth Engine"** (`findings-engine-surface.md:74`; CLAUDE.md). Engine display names come from `SynthEngine.displayName` (`aimmersive-clone-spec.md:278`).

- **Peek**: play/pause + master volume + the active engine name ("Powerful Synth Engine") + BPM.
- **Expand**: 
  - **Engine switcher** — Powerful Synth Engine (default) + other engines (PAFSynth, ChannelStrip, etc. from `mode_select`); alternative engines flagged where not-yet-wired (`findings-engine-surface.md:74`).
  - **Audio controls**: Vol, BPM (a-immersive play drawer, `aimmersive-clone-spec.md:31`).
  - **Arpeggiator** controls (`aimmersive-clone-spec.md:278`).
  - **Synth preset `<select>`** — tiered Manual/Beginner/Intermediate/Advanced/Expert (`aimmersive-clone-spec.md:199`); these set which params are active/muted + their min/max/curve (the synth-side override tier — *distinct* from the visual/RL example presets, keep separate, `aimmersive-clone-spec.md:157`).
- **FULL**: the synth **group-override matrix** (§4.4) — 18 collapsible sections (Env A…Mono, `aimmersive-clone-spec.md:298`), each with a group master curve (48×48 drag, applies relative delta to all child curves, `aimmersive-clone-spec.md:138`) and per-param baseline rows (§3.2). This is `<GroupOverrideDrawer>` promoted to FULL depth.
- **Bind**: `engine.audio.start/stop`, `SynthEngine.setParam(i, v)` throttled ≥50ms / dead-zone >0.002 (`aimmersive-clone-spec.md:257,345` — load-bearing, prevents ring-buffer flooding). Audio starts lazily on the play gesture (`aimmersive-clone-spec.md:278`).
- COOP/COEP server-scoped (`findings-design-and-manifold.md:100`); SharedArrayBuffer only for the browser-only Powerful Synth Engine path (`findings-engine-surface.md:74`).

---

## 6. PARTICLE / VISUAL SYSTEM drawer

Owns the flow-field visualiser — a faithful port of `js/ui/visualizer.js` (`findings-design-and-manifold.md:120` — exact look + behaviour; workstream E). 400-particle Canvas2D flow field driven by 20 named outputs (`aimmersive-clone-spec.md:296`).

- **Peek**: visual on/off + the active visual preset name.
- **Expand**: the 20 visual params as per-output rows (§3 baseline — Flow/Scale/Speed/Hue/Spread/… `aimmersive-clone-spec.md:296`), each with its `VISUAL_PARAM_COLORS` swatch; plus **visual/RL preset chips** (Calm/Chaos, Rainbow, Vortex, Spiral, Embers, `aimmersive-clone-spec.md:158`) which teach the *network* by clearing the dataset and adding hardcoded input→output examples (distinct from synth tiers — keep separate).
- **FULL**: the full visual param matrix + the output→visual-param range table (verbatim ranges, `aimmersive-clone-spec.md:296`) as editable advanced mappings + particle-count / lifetime tuning.
- **Bind**: when the visual backend is active, `routedOutput` fans the 20 outputs into `FlowFieldVisualizer.setParams` (`aimmersive-clone-spec.md:260`); the canvas reads `engine.routedOutput()` in one rAF loop, never inference (`engine-architecture.md` §2.1).

---

## 7. React component tree

The Console wraps everything in `<EngineProvider>` (`engine-architecture.md` §2.2). The dock + drawers read `EngineApi` only; no drawer imports engine internals (lint seam, `engine-architecture.md` §6).

```
<ConsoleApp>                              // focus stage + dock; owns rAF for canvases
├── <Dock>                                // 48px right rail
│   └── <DockIcon> ×6                      //   LEARN, IN, OUT, SYNTH, VISUAL, HELP
│       (data-drawer; click → uiStore.setDrawer(depth))
│
├── <DrawerHost>                          // renders the open drawer at its depth
│   ├── <Drawer depth="peek|expand">      // generic glass panel; ⤢ → FULL
│   │   ├── <LearningBehaviourDrawer>
│   │   │   ├── <FeedbackModeSelector>    //   pill → engine.feedback.setMode  (§1.1)
│   │   │   │   └── <ExploringIndicator>  //     <NoiseRing> ramp; learning-paused badge
│   │   │   ├── <ArmScopeChooser>         //   arm-all / arm-output  (§1.2)
│   │   │   └── <TrainingParams>          //   <Slider> ×5/6  (§1.3)
│   │   ├── <InputsDrawer>                //   workstream F (§6); <ControlAxis> rows
│   │   ├── <RoutingDrawer>               //   §3
│   │   │   ├── <BackendSelector>         //     Web Audio/MIDI/OSC/VCV
│   │   │   └── <For each=group>
│   │   │       └── <OutputGroupSection>  //     header: group master curve + mute-group
│   │   │           └── <For each=output>
│   │   │               └── <OutputControlRow>   //  ← the shared baseline component (§3.2)
│   │   │                   ├── <MuteToggle/> M
│   │   │                   ├── <ArmToggle/>  S
│   │   │                   ├── <TriStateSegmented/>   off|fixed|live
│   │   │                   ├── <DualRangeSlider/>     min/max
│   │   │                   ├── <CurvePad/>            36×36
│   │   │                   └── <ValueBar/>            live | fixedValue
│   │   ├── <SynthEngineDrawer>           //   §5  ("Powerful Synth Engine" — never "C15")
│   │   │   ├── <EngineSwitcher/>
│   │   │   ├── <AudioControls/>  Vol/BPM/Arp
│   │   │   └── <SynthPresetSelect/>      //   tiered
│   │   └── <VisualSystemDrawer>          //   §6
│   │       ├── <For each=visualOutput><OutputControlRow/></For>
│   │       └── <VisualPresetChips/>
│   │
│   └── <AdvancedModal depth="full">      // near-fullscreen, --z-modal, glass over dim
│       ├── <FeedbackLab/>                //   LEARN FULL  (state-machine + diagnostics)
│       ├── <InputMatrix/>                //   IN FULL     (workstream F)
│       ├── <BackendAdvanced/>            //   OUT FULL — switches on active backend:
│       │   ├── <MidiCcEditor/>           //     CC#/Ch/Name + count  (§4.1)
│       │   ├── <OscPathEditor/>          //     path + physical range (§4.2)
│       │   ├── <VcvChannelEditor/>       //     min/max/freeze grid   (§4.3)
│       │   └── <SynthGroupMatrix/>       //     18 sections × params  (§4.4 / §5 FULL)
│       └── <VisualMatrix/>               //   VISUAL FULL
│
├── <VerdictCluster>                      // +/−/undo/reroll; mirrors <FeedbackModeSelector> pill
└── <HelpModal>                           // HELP icon opens directly
```

Shared leaf primitives live in `shared/primitives/` (`<Slider>`, `<DualRangeSlider>`, `<CurvePad>`, `<NoiseRing>`, `<LossPlot>`, `<WeightHealth>`, `<LayerStats>`, `<GradientFlow>`, `<PillToggle>`, `<ControlAxis>` — `findings-design-and-manifold.md:60`). `<OutputControlRow>` is the one new composite component this spec introduces, reused across the Routing, Synth, Visual, and (optionally, §6 open choice 2) Inputs drawers.

---

## 8. Binding to the reactive spine + engine API (summary)

| UI surface | EngineApi call | Engine route |
|---|---|---|
| Feedback-mode pill | `engine.feedback.setMode(m)` | `nisps_ml_feedback_set_mode` (`feedback-modes-port-spec.md` §4) |
| `−` verdict | `engine.feedback.thumbsDown()` | dispatch on mode → `on_down` (`findings-feedback-behaviour.md:90`) |
| `+` verdict | `engine.feedback.thumbsUp()` | `addExample` + train, or `CommitStore` when exploring |
| Arm (S) | `engine.feedback.setFocus(mask)` | `nisps_ml_feedback_set_focus` + `buildPinMask` |
| Tri-state off/fixed | `routing-store` write → `weightsRevision`/pin recompute | `routedOutput` memo + pin mask (`engine-architecture.md` §2.1) |
| min/max/curve | `routing-store` write | `routedOutput` memo `applyGroupOverride` (`param-map.js:301`) |
| mute | `routing-store.muted` | send-effect zeroes/holds downstream, value still in `mlOutput` |
| training sliders | `mlStore` setters | live engine params |
| backend select | `engine.setBackend(b)` | swaps `OutputBackend` adapter; output-count guard |
| synth setParam | (internal) send-effect throttle | `SynthEngine.setParam` ≥50ms/>0.002 |

All writes are **eager, synchronous, off-React-render** (`engine-architecture.md` §4) — drawers mutate stores; the single `routedOutput`→send-effect carries it to the backend; canvases read accessors in rAF. No drawer creates a second data path (the live-feedback guarantee, `engine-architecture.md` §2.3).

---

## 9. Open choices for the operator

1. **Surface `RandomiseOutputs` (third feedback mode)?** Spec hides it behind `?debug=1` ("Static roll"). Confirm v1 ships only the two product modes (Push away / Explore & place) or all three.
2. **Do input-axis rows reuse `<OutputControlRow>`?** They share min/max/curve but not mute/off/live semantics. Spec defers to workstream F; confirm whether to unify the component or fork it.
3. **Separate `state`/`muted`/`armed` fields vs the deployed conflated `frozen`↔`muted` single field.** Spec deliberately splits them (cleaner tri-state); this is a divergence from the deployed override system to record in `ALIGNMENT.md`. Confirm.
4. **Default backend output counts on switch** trigger a `confirm()` weight-reset guard (ported from a-immersive). Confirm you want that friction, or prefer silent warm-start (`createWithWarmStart`, `aimmersive-clone-spec.md:250`).
5. **Group master curve relative-delta behaviour** (drag the group curve nudges all child curves preserving offsets, `aimmersive-clone-spec.md:138`) — keep this a-immersive behaviour, or switch to absolute group curve? Spec keeps relative.
6. **Where does the feedback-mode pill live for live play** — only mirrored next to the Verdict cluster, or also a permanent sub-`<StatusLine>` pill (`aimmersive-clone-spec.md:283`)? Spec puts it on the Verdict cluster.

---

## Verification corrections (adversarial pass, 2026-06-27) — verdict: minor-issues

The design reasoning, drawer model, tri-state/mute/arm separation and per-output baseline are sound; most
`aimmersive-clone-spec.md` citations verified line-by-line. Apply these fixes in the build:

- **`engine.feedback.setMode` / `setFocus` / `exploring()` are not yet a JS surface** — only the C ABI
  (`nisps_ml_feedback_set_mode` / `set_focus` / `exploring`) exists. The Manifold `EngineApi.feedback` must
  ADD these JS wrappers over the C ABI in Phase 3 (this is intended new surface, not a mistake — but it must be
  built, not assumed). Likewise `engine.setBackend` and synth `setParam` are internal, not on EngineApi today.
- **`param-map.js` (`applyTame/applyCurve/applyGroupOverride`) lives only in `deployments/meml-aimmersive`**,
  not in `playground/src`. The curve/override math must be **ported into `manifold/`** (see backends-spec
  `mapping.ts`), not imported from the deployed snapshot.
- **`--dock-width` and min-thumb `#4488ff` are deployed-a-immersive values, absent from the Manifold tokens** —
  use Manifold tokens (`manifold-export/tokens/`) or add the missing ones deliberately.
- A few `findings-feedback-behaviour.md:NN` citations are out of range / point at `feedback-modes-port-spec.md`
  instead (`learning_paused()` = `feedback.hpp:85` / port-spec:238; `exploring()` = `feedback.hpp:84`).
- The React `<EngineProvider>`/`useEngine` pattern is in `findings-design-and-manifold.md §4`, not
  `engine-architecture.md §2.2` (that doc is SolidJS).
