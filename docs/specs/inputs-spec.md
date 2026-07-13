---
kind: spec
stability: evolving
layer: binding
counterpart: aimmersive-clone-spec.md
---

# Inputs Spec — Modular Input Layer (Workstream F)

*Status: implementation-ready spec for the `manifold/` React app. Scope: the modular input layer — sources (XY pad, MIDI input, gamepad single/double-stick), how they compose into an N-dimensional input vector, the MLP-rebuild-on-input-change mechanism, the binding to the reactive spine, and the dock INPUTS panel. Read alongside `recon/findings-engine-surface.md` (the fixed-2-input gap), `engine-architecture.md` (the `EngineApi` seam — note that doc says SolidJS/`playground2`; this app is React/`manifold/`), and `aimmersive-clone-spec.md` (existing gamepad/MIDI/joystick behaviour). British spelling in product copy. The built-in synth is always shown as the "Powerful Synth Engine" — never "C15".*

---

## 0. The problem this layer solves

Today input is hard-wired to exactly two channels. `WasmIML.inferXY(x, y)` calls `setInput(0,x); setInput(1,y); process()` (`playground/src/ml/wasm-iml.ts:307-312`); the whole input pipeline is a 2-tuple pure function `processInput(raw: readonly [number, number], …)` (`playground/src/input/pipeline.ts:225-230`); the WASM build is fixed at `MLP<2u, 10u, 14u, 18u, 126u>` (`nisps/wasm/bindings.cpp:88`). The mission wants the input set to be **modular**: the operator picks one source *or a combination* (XY pad, MIDI input, single-stick gamepad = 2 dims, double-stick gamepad = 4 dims), and the **MLP is (re)built for N inputs × M outputs** whenever that set changes. The same composed input vector drives all backends (synth / MIDI / OSC / VCV) — it is upstream of the backend choice, which is workstream E/output's concern.

This collides head-on with the fixed-2-input WASM (`findings-engine-surface.md:68-71`, "Gaps to budget for → Fixed MLP arch"). Section 4 resolves that collision and recommends an approach.

---

## 1. Architecture: where the input layer sits

The input layer is **engine-side and headless** — it produces an N-dim `Float32Array` that is the head of the reactive spine. It owns: the registry of active sources, each source's adapter lifecycle, the composition of per-source axes into one vector, and the contract that fires an MLP rebuild when the active-channel count changes. It exposes its surface through `EngineApi` (the React app's single seam to the engine). Skins (the dock INPUTS panel, the Manifold stage) are pure consumers.

```
   physical inputs                    InputLayer (engine-side, headless)              spine
 ┌──────────────┐   adapter    ┌───────────────────────────────────────────┐
 │ XY pad (DOM) │──emit axes──►│ InputSource registry (ordered, enabled)    │
 │ WebMIDI      │──emit axes──►│   → compose into channel vector raw[N]     │──► inputRaw: Float32Array (N)
 │ Gamepad API  │──emit axes──►│   → per-channel pipeline (deadzone…)       │      │
 └──────────────┘              │   → reshape signal on channelCount change  │      ▼
                               └───────────────────────────────────────────┘   processedInput → mlOutput → routedOutput → backends
                                              │ channelCount change
                                              ▼
                                   MLP rebuild (§4): WasmIML.rebuild(N, M) with warm-start
```

Litmus test (from `engine-architecture.md:40`): anything that touches the DOM/JSX is a skin; the InputLayer adapters read raw browser APIs (`PointerEvent`, `navigator.requestMIDIAccess()`, `navigator.getGamepads()`) but emit **plain numeric axes** into the engine — they hold no React state. The dock panel is the only React surface and it only calls `EngineApi` actions and reads `EngineApi` accessors.

### File layout (under `manifold/src/engine/input/`)

```
engine/input/
├── source.ts            # InputSource interface + InputAxis types + SourceId
├── registry.ts          # active source set (ordered, enabled), channel layout derivation
├── compose.ts           # sources' axes → flat raw[N] vector (channel map)
├── pipeline.ts          # LIFTED from playground/src/input/pipeline.ts, generalised to N channels (§3.3)
├── sources/
│   ├── xy-pad.ts        # XYPadSource — 2 axes, fed by the Manifold/XYPad pointer
│   ├── midi-input.ts    # MidiInputSource — WebMIDI, N learn-mapped CC/note channels
│   └── gamepad.ts       # GamepadSource — single (2) or double (4) stick, + buttons→actions
└── reshape.ts           # channelCount-change → MLP rebuild orchestration (§4)
```

---

## 2. The `InputSource` adapter interface

Every source is an adapter that contributes an ordered list of **axes** (each a normalised scalar in `[0,1]`) and, optionally, **action events** (button-style: thumbs-up/down/train/etc., already an a-immersive convention — gamepad LB/RB/A/X/B, `aimmersive-clone-spec.md:161-162`). The interface is deliberately tiny so a fourth source (hand-tracking, OSC-in, sensor) drops in without touching compose/reshape.

```ts
// engine/input/source.ts
export type SourceId = 'xy' | 'midi' | 'gamepad';

/** A single named input dimension produced by a source. Value in [0,1]. */
export interface InputAxis {
  /** Stable per-source key, e.g. 'x', 'y', 'stickL.x', 'cc:74'. Used for persistence + UI labels. */
  readonly key: string;
  /** Human label for the dock panel, British spelling. e.g. 'Stick L — X'. */
  readonly label: string;
  /** Current normalised value [0,1]; 0.5 = centre for bipolar axes. */
  value: number;
}

/** Discrete control event a source can raise (maps to verdict/train actions). */
export type InputAction =
  | 'thumbsUp' | 'thumbsDown' | 'train' | 'randomise' | 'clearExamples' | 'undo';

export interface InputSource {
  readonly id: SourceId;
  /** Stable, ordered axes this source contributes when enabled. Length is fixed
   *  per source *configuration* (gamepad: 2 or 4 depending on stick mode;
   *  midi: however many channels the user has learn-mapped). */
  axes(): readonly InputAxis[];

  /** Begin producing values. `onAxes` is called when any axis changes (coalesced
   *  to display cadence by the engine, not by the source). `onAction` fires discrete
   *  events. Returns a teardown. Idempotent. */
  attach(sink: {
    onAxes: () => void;                 // pull model: engine reads axes() after notify
    onAction: (a: InputAction) => void;
  }): () => void;

  /** Availability + status for the dock panel (e.g. 'no MIDI device', 'gamepad 0 connected'). */
  status(): { available: boolean; connected: boolean; detail: string };

  /** Serialisable per-source config (mappings, invert, stick mode). */
  toJSON(): unknown;
  fromJSON(data: unknown): void;
}
```

Design notes:
- **Pull, not push, for values.** `onAxes()` is a *notify* (a dirty flag); the engine then reads `source.axes()` during composition. This matches the spine's "every consumer reads accessors" rule (`engine-architecture.md:188`) and avoids each source independently writing into the spine — there is exactly one write of `inputRaw` per coalesced tick.
- **Actions are separate from axes.** Gamepad buttons and (optionally) MIDI notes raise `InputAction`s routed to `EngineApi.feedback.*`/`train()`, exactly as the legacy gamepad does (`aimmersive-clone-spec.md:161-162`). They do **not** add input channels.
- **Axis count per source is a function of its config**, not fixed: gamepad single-stick = 2 axes, double-stick = 4; MIDI = the number of learn-mapped controls. This variable count is what drives the rebuild.

---

## 3. The three sources

### 3.1 `XYPadSource` (2 axes)

The default, always-available source. Axes `x`, `y` in `[0,1]`, centre 0.5. Fed by the Manifold stage / dock XYPad pointer through `EngineApi.setInput(x, y)` — i.e. the XYPad does not poll a device; the skin pushes pointer coordinates into this source. This preserves the exact a-immersive joystick mapping (`aimmersive-clone-spec.md:92-94`: tap = snap, drag = relative, Y inverted) which lives in the **skin** XYPad component, not here; the source just receives `(x,y)`.

- `attach`: registers the setter the skin calls; no device polling.
- `status`: always `{available:true, connected:true, detail:'XY pad'}`.
- This is the only source where the skin is the producer; MIDI and gamepad poll the browser directly.

### 3.2 `MidiInputSource` (N learn-mapped axes) — NEW

WebMIDI input, the new required source. Uses `navigator.requestMIDIAccess({ sysex:false })`. The user **learn-maps** physical controls to input channels:

- **Continuous channels** from CC messages: each mapped CC# (on a chosen channel 1–16) becomes one axis, value = `cc/127` → `[0,1]`. This mirrors the *output* CC convention already in the codebase (`aimmersive-clone-spec.md:128`, CC 0–127, Ch 1–16) but inverted to *input*.
- **Note channels (optional)**: a mapped note can act as a momentary axis (`velocity/127` while held, 0 on note-off) or be routed to an `InputAction` (e.g. a pad → thumbsUp). Default: pitch-bend → one bipolar axis (centre 0.5) is offered as a convenience mapping.
- **Learn flow**: dock panel "+ Learn" → next incoming CC/note within a timeout binds a new axis; the axis appears in `axes()` and the channel count increases → triggers a rebuild (§4). Removing a mapping decreases the count → rebuild.

```ts
// engine/input/sources/midi-input.ts (shape)
interface MidiMapping {
  key: string;             // 'cc:74@1' | 'note:36@10' | 'pb@1'
  kind: 'cc' | 'note-hold' | 'pitchbend';
  channel: number;         // 1..16
  selector: number;        // cc# | note#  (ignored for pitchbend)
  label: string;           // user-editable, British copy default 'MIDI CC 74'
  invert: boolean;
}
```

- `attach`: subscribes to `MIDIInput.onmidimessage`, decodes status bytes, updates the matching mapping's axis value, calls `onAxes()`. Hot-plug handled via `access.onstatechange`.
- `status`: reports `access` state and connected input device names; `{available:false}` if `requestMIDIAccess` rejected or unsupported (Safari).
- Persistence: `toJSON` serialises the mapping array under the per-app storage key (consistent with the legacy `nisps-midi-cc-map:<engineId>` pattern, `aimmersive-clone-spec.md:239`, but for the *input* side use `nisps:midi-in-map`).

> **Browser note (open choice):** WebMIDI input is Chromium/Edge/Opera and Firefox-with-flag; **Safari has no WebMIDI**. The dock panel must degrade gracefully (`status.available=false`, greyed source, explanatory copy). See §7.

### 3.3 `GamepadSource` (2 or 4 axes) — single OR double stick

Uses the Gamepad API (`navigator.getGamepads()`), polled inside the engine's single coalescing tick (not its own rAF — the engine already runs one display-cadence loop per `engine-architecture.md:183`). Generalises the legacy `GamepadInput` (`aimmersive-clone-spec.md:161-162`, currently left-stick-only with `invertY:true`).

- **Stick mode `single`** (default): left stick → 2 axes `stick.x`, `stick.y`, mapped `axis*0.5+0.5` → `[0,1]`, Y inverted (preserve legacy `invertY:true`).
- **Stick mode `double`**: left + right stick → 4 axes `stickL.x`, `stickL.y`, `stickR.x`, `stickR.y`. This is the "double joystick = 4 input dims" requirement. Switching single↔double changes the axis count 2↔4 → triggers a rebuild (§4).
- **Buttons → actions** (unchanged from legacy): LB→`thumbsDown`, RB→`thumbsUp`, A→`train`, X→`randomise`, B→`clearExamples`. Raised via `onAction`, never as axes.
- `status`: `{available: 'getGamepads' in navigator, connected: <any pad index present>, detail: pad.id}`. Connection via `gamepadconnected`/`gamepaddisconnected` window events.

### 3.4 The shared per-channel pipeline (lift + generalise `input/pipeline.ts`)

`playground/src/input/pipeline.ts` is a parity-relevant, golden-tested pure function but hard-coded to a 2-tuple with **coupled** X/Y stages (circular clamp to a unit disk, momentum computed from 2D velocity — `pipeline.ts:258-268`, `164-198`). For N channels it must be generalised:

- **Per-channel stages stay**: invert, deadzone, zoom-around-anchor, centred power curve, EMA smoothing, freeze (these are all per-axis already — `pipeline.ts:251-290`).
- **The 2D-coupled stages become opt-in pairing**: circular clamp and 2D-velocity momentum only make sense for a *pair* of axes that represent an XY plane (the XY pad, one gamepad stick). The generalised pipeline groups channels into **pairs declared by the source** (XYPad → one pair; gamepad double → two pairs; MIDI CCs → unpaired/independent). Paired channels run the circular-clamp + 2D-momentum path bit-for-bit identical to today; unpaired channels skip those stages (no behavioural change for the existing 2-input case → parity preserved).
- Config becomes per-channel (`InputConfig[]` indexed by channel, defaults from `defaultInputConfig()` `pipeline.ts:107-125`), and state per-channel (`InputState[]`, `defaultInputState()` `pipeline.ts:127-135`).

**Critical research-validity rule** (`findings-design-and-manifold.md:97-98`): train on **raw model-space**, and feed the MLP the **processed** input — but the *training examples* must record the same channel vector the MLP infers on, and there must be **no phantom input channels**. With a true N-input MLP (§4) this is automatic; with padding (§4 option C) it is the central hazard.

---

## 4. The MLP-rebuild-on-input-change mechanism — the core collision

When the composed channel count changes (gamepad single→double, MIDI learn add/remove, source toggled on/off), the MLP's input dimension must change. The WASM build is `MLP<2,…>` fixed at compile time (`bindings.cpp:88`; `nisps_ml_describe` returns the baked dims, `bindings.cpp:578`; `WasmIML` resolves arch from the build and *warns-and-ignores* caller sizes, `wasm-iml.ts:195-203`). Three candidate approaches:

### Option A — Runtime-shaped MLP (one WASM, dynamic dims)
Make the C++ MLP store layer sizes at runtime (heap-allocated weight buffers sized at `nisps_ml_create(input_size, output_size, hidden, n_hidden)`) instead of as template params. `nisps_ml_create` already *accepts* these args (`bindings.cpp:289`); today they're ignored.
- **Pros**: one WASM module; honest N×M; no padding; cleanest semantics; warm-start across both input- and output-count changes is natural (legacy already has `createWithWarmStart` for output changes, `aimmersive-clone-spec.md:250`).
- **Cons / parity + perf**: **directly contradicts the firmware performance contract** — the firmware path forbids heap in hot paths and relies on compile-time-sized `std::array`/`FixedBuffer` (`CLAUDE.md` "No heap"; `nisps/core`). A runtime-shaped MLP is a *second*, divergent ML implementation → it would **not be the parity-tested core** the operator mandated ("training must use the same core the firmware builds from", `findings-engine-surface.md:7`). Parity check `scripts/parity-check.sh` asserts native==WASM ≤1e-5 against the *fixed* templated MLP; a runtime MLP needs its own parity harness. High cost, high parity risk.

### Option B — Multiple WASM modules (one per common arch)
Pre-build a small matrix of WASM modules: `MLP<2,…,126>`, `MLP<4,…,126>`, and (for MIDI-heavy) `MLP<8,…,126>`. On channel-count change, tear down and recreate `WasmIML` against the module matching N (rounding up to the nearest built arch).
- **Pros**: every module is the *real templated, parity-tested core* — firmware-identical, parity harness unchanged per module. No heap. Honest input dims (up to the nearest built size).
- **Cons / perf**: N is quantised to the built set; download weight ×K modules (each ~94KB, `bindings.cpp` build is small, so ~3 modules ≈ 280KB — acceptable). Warm-start across modules requires weight transplant between *different* WASM instances (hidden weights transfer; new input/output rows re-randomise — the `createWithWarmStart` logic generalised). Build/CI must produce and parity-check each module (`scripts/build-wasm.sh` gains a loop). Medium cost, **low parity risk**.

### Option C — Max-N padded input with active-channel masking
Keep one WASM at a generous fixed arch, e.g. `MLP<8,…,126>`. Always run 8 inputs; "inactive" channels are pinned to a constant (0.5/centre) and masked. The composed vector fills the first N; the rest are held neutral.
- **Pros**: one module; no rebuild ever (zero-latency source switching); single parity harness.
- **Cons / research-validity**: this is exactly the **phantom-input-channel** anti-pattern the redesign explicitly calls a research-validity bug (`findings-design-and-manifold.md:98`, `engine-architecture.md:409` "killing today's phantom-channel OOB writes"). Held-constant inputs still consume weights and bias the network; training examples recorded at different active-channel sets become inconsistent; the model "sees" 8 dims always. Also wastes firmware budget if the same arch ships to hardware. Low rebuild cost but **high validity cost** — rejected on principle.

### Recommendation: **Option B (multiple WASM modules), with a phased rollout**

Option B is the only approach that keeps the **parity-tested, firmware-identical templated core** (the operator's hard constraint) while honestly representing N input dims. Concretely:

1. **Phase F0 (ships first):** build **two** modules — `MLP<2,…,126>` (existing) and `MLP<4,…,126>`. This covers XY pad (2), single-stick gamepad (2), and double-stick gamepad (4) — the gamepad requirement in full. MIDI maps onto these by capping learn-mapped continuous channels and/or rounding N up to 4. Both modules go through `scripts/parity-check.sh` in CI.
2. **Phase F1:** add `MLP<8,…,126>` for richer MIDI rigs (up to 8 continuous channels). N rounds up to the nearest built arch; unused channels of the *chosen* module are still real channels fed real values where present, **never phantom-padded across the active set** — i.e. we only ever select a module whose input size ≥ N, and we feed exactly N real channels, leaving at most a few genuinely-unused trailing channels held at centre *with a recorded "module larger than active set" caveat* (the one residual padding, bounded and surfaced, not silent).
3. **Rebuild orchestration** (`engine/input/reshape.ts`): on channel-count change → (a) snapshot current weights via `WasmIML.getWeights()`; (b) pick target module for new N; (c) `WasmIML.rebuild(targetModule, N, M)` which creates a fresh handle and **warm-starts**: hidden + output weights transfer where shapes match, the input→layer0 weight rows are preserved for surviving channels and re-randomised for new ones (generalise `createWithWarmStart`, `aimmersive-clone-spec.md:250`); (d) if training examples exist and the input dimension changed, the dataset's feature vectors are re-shaped (truncate/zero-extend with a **user confirm**, mirroring the legacy output-count-change confirm at `aimmersive-clone-spec.md:145`) — or cleared; (e) bump `weightsRevision` so the spine re-derives.
4. **The fixed-2 contraction is explicitly time-boxed:** Phase F0/F1 deliver 2 and 4 (and later 8) — *not* arbitrary N. Arbitrary-N runtime shaping (Option A) is deferred and only revisited if a use case needs counts outside the built matrix, and only *behind a passing dedicated parity check* (per `findings-engine-surface.md:68-71` / `engine-architecture.md:409`).

This is a strictly smaller, safer change than Option A and avoids the validity landmine of Option C, while satisfying "the MLP is (re)built for N×M when the input set changes" for the concrete source matrix the operator named.

### `EngineApi` + `WasmIML` surface changes

```ts
// EngineApi additions (engine/types.ts)
interface EngineApi {
  // ... existing spine accessors/actions ...
  input: {
    sources: () => readonly { id: SourceId; enabled: boolean; axisCount: number; status: SourceStatus }[];
    setEnabled: (id: SourceId, on: boolean) => void;     // toggling → may rebuild
    channelCount: Accessor<number>;                       // current N (drives rebuild)
    channelLabels: () => readonly string[];               // for dock + heatmap axes
    setInput: (x: number, y: number) => void;             // XYPad fast-path (back-compat)
    gamepadStickMode: (m: 'single' | 'double') => void;   // → rebuild on change
    midi: MidiInputApi;                                   // learn / map / clear / list devices
    rebuilding: Accessor<boolean>;                        // UI disables training mid-rebuild
  };
}
```

`WasmIML` (lifted from `wasm-iml.ts`) gains `rebuild(moduleUrl, inputSize, outputSize, { warmStart: boolean })`. Today `init_` hard-binds one module and ignores caller dims (`wasm-iml.ts:171-225`); the rebuild path instantiates the module whose `nisps_ml_describe` reports `inputSize===N` (or the smallest ≥ N), re-allocates the heap buffers sized to the new arch (`wasm-iml.ts:218-225`), and re-pushes weights. The per-module factory cache keys on module URL (extend `cachedFactory`, `wasm-iml.ts:45`).

---

## 5. Composition into the N-dim vector

`engine/input/compose.ts` builds the flat `raw[N]` consumed by the spine:

1. **Channel layout** = concatenation, in registry order, of each *enabled* source's `axes()`. So `[XY:x, XY:y]` then `[gamepad:stickL.x, …]` then `[midi:cc74, midi:cc71, …]`. The layout (ordered list of `{sourceId, axisKey, label}`) is the single source of truth for: the MLP input index of each channel, the dock panel rows, and the heatmap/diagnostics axis labels.
2. On any source `onAxes()` notify, the engine (in its one coalescing tick, `coalesce.ts` per `engine-architecture.md:183-185`) reads every enabled source's `axes()`, writes their values into `raw[]` at their layout indices, and sets the `inputRaw` signal `{equals:false}`.
3. **Channel-count change detection:** the layout length is compared to the live MLP input size each time the registry changes (source toggled, gamepad stick mode flipped, MIDI mapping added/removed). A mismatch enqueues a rebuild (§4) *before* the next infer — never mid-tick.
4. **Per-channel pipeline** (§3.4) runs on `raw[]` to produce `processedInput[]`, which is what the MLP infers on and what training examples record (no phantom channels — the recorded feature vector length == live MLP input size).

Multiple simultaneous sources compose naturally: XY pad + a MIDI CC = 3 channels → module `MLP<4,…>` (round up), 3 real channels fed, 1 trailing channel held at centre with the bounded-padding caveat surfaced in the panel.

---

## 6. Binding to the reactive spine (React)

Per `findings-design-and-manifold.md:70-88`, the spine must live **below React** and not on the render cycle. The input layer is the head of that spine:

- `inputRaw` is an external-store signal (`Float32Array(N)`, `{equals:false}`), updated only inside the engine's coalesced tick. React components **never** write it directly except via `EngineApi.input.setInput`/source toggles.
- The dock INPUTS panel subscribes via `useSyncExternalStore(subscribe, () => versionCounter)` (version counter, not the array — `findings-design-and-manifold.md:81-82`) to re-render on source-set / status / channel-count changes. It reads live axis values imperatively for meters.
- The Manifold/visualiser reads channel values in its own `requestAnimationFrame` loop (drawing only; `findings-design-and-manifold.md:84`).
- **Rebuild is an engine action**, not a render effect: `EngineApi.input.setEnabled`/`gamepadStickMode`/`midi.learn` run the §4 reshape synchronously off-render, bump `weightsRevision`, then flip `rebuilding()` back to false. The single send-effect (`engine-architecture.md:173-177`) re-fires once after rebuild.
- **E2E invariant extension** (`findings-design-and-manifold.md:86-87`): the existing `setInputs([x,y]) → getOutputs() changes` probe assertion is extended with a per-source-set case — e.g. enable double-stick gamepad, assert `channelCount()===4`, assert `getOutputs()` length and that moving channel 3 changes outputs. `window.__nisps` (engine probe, `engine-architecture.md:237`) gains `setChannel(i, v)`, `getChannelCount()`, `setSources([...])`.

---

## 7. The dock INPUTS panel (skin)

A dedicated dock entry (its own rail icon + drawer), parallel to the other dock drawers (`findings-design-and-manifold.md:50`). Pure consumer of `EngineApi.input`. Manifold token language: dark glass chrome, orange `--accent #ff6a00` primary, cyan `--accent-2 #00ccff` for live data/meters, uppercase letter-spaced labels, glow halos on live elements (`findings-design-and-manifold.md:24-38`).

**Layout:**

- **Source toggles** (top): three `PillToggle`s — **XY Pad** / **MIDI** / **Gamepad** — each enableable independently (combination allowed). Each shows a `StatusLine`: connected device / "No MIDI device" / "No gamepad detected". A disabled/unavailable source (e.g. MIDI on Safari) is greyed with explanatory copy.
- **Channel readout**: a live list of the composed channels in layout order, each row = label + a cyan value meter (Sparkline/bar) reading the live axis. Shows total **N** prominently ("4 INPUT CHANNELS"). A subtle badge when a module larger than the active set is in use ("1 channel held at centre").
- **MIDI sub-panel** (when MIDI enabled): device picker; a **+ Learn** button (arm → next CC/note binds, with countdown); a list of mappings each with editable **Label**, **CC#/Note**, **Ch**, **Invert**, and a remove (✕). Add/remove warns when training examples exist (rebuild confirm).
- **Gamepad sub-panel** (when gamepad enabled): a `PillToggle` **Single / Double** stick (the 2↔4 dim switch), an invert-Y switch (default on), and a small button-map legend (LB Down / RB Up / A Train / X Randomise / B Clear).
- **XY Pad sub-panel**: per-axis invert switches and the existing input-shaping controls (deadzone / zoom / curve / smoothing / momentum) — these are the per-channel pipeline params (§3.4), reused for any paired axes.
- **Rebuild affordance**: whenever a control would change `channelCount`, the panel shows a confirm if examples exist ("Changing inputs rebuilds the network and may clear training examples"), then disables interaction while `rebuilding()` is true.

**Keyboard / accessibility:** the dock drawer opens via its number key (consistent with `findings-design-and-manifold.md:48`). All hit targets ≥ `--hit-min 44px`.

---

## 8. Persistence & VCV/bridge note

- Per-source config persists via `InputSource.toJSON`/`fromJSON` under one versioned blob (use `engine/persist.ts`, `engine-architecture.md:113`); keys: `nisps:input-sources` (enabled set + per-source config), `nisps:midi-in-map` (mappings). The **active channel count is persisted** so the correct WASM module is selected on load *before* weights rehydrate (rebuild-then-load order, mirroring legacy load-then-train, `aimmersive-clone-spec.md:239`). Never auto-request MIDI/gamepad permission on load beyond what the browser grants silently.
- **Bridge / VCV (workstream E):** the composed `inputRaw[N]` is the same vector the VCV module receives over the bridge — the bridge is just another *producer* into a source slot (a future `BridgeInputSource`) or a *mirror* of the composed vector, depending on direction. This spec keeps the input layer backend-agnostic: it produces channels; who consumes them (synth/MIDI/OSC/VCV) is downstream. The four-source interface (XY/MIDI/gamepad + a future bridge/OSC-in) is why `InputSource` is kept minimal.

---

## 9. Open choices for the operator

1. **MLP-reshape strategy — confirm Option B (multiple WASM modules).** Recommended because it keeps the parity-tested, firmware-identical templated core and avoids phantom channels. Trade-off: input dim is quantised to the built matrix (2/4, later 8), not arbitrary N. Confirm the initial matrix is `{2, 4}` for F0 and `{2, 4, 8}` for F1. If the operator wants *arbitrary* N now, that forces Option A (runtime-shaped MLP) — a divergent, separately-parity-tested core, larger cost, and a departure from "same core as firmware".
2. **Trailing-channel handling when N < module input size.** Recommended: feed N real channels, hold the remaining built-but-unused channels at centre and surface a badge. Confirm this bounded, visible padding is acceptable (it is *not* the rejected silent phantom-channel pattern, but it is a small residual).
3. **Browser support for MIDI/gamepad.** WebMIDI: Chromium/Edge/Opera (+ Firefox flag), **no Safari** → MIDI source degrades to unavailable. Gamepad API: broad including Safari. Confirm the supported-browser target (recommend "Chromium-first, graceful degradation elsewhere", matching the COOP/COEP-heavy build already in `vite.config.ts`).
4. **MIDI note → action vs axis.** Default offered: pitch-bend as a bipolar axis; pads/notes optionally route to `thumbsUp`/`thumbsDown`. Confirm whether note-as-axis (velocity-hold) should be a first-class channel type or stay an advanced toggle.
5. **Does enabling/disabling a source mid-session clear training examples?** Recommended: confirm-and-reshape (truncate/extend feature vectors) rather than hard-clear, to match the legacy warm-start ethos. Confirm acceptable, or prefer the simpler hard-clear-on-input-change.
6. **Dock entry placement/icon** among the existing drawers (`shape/feel/route/health/help`, `findings-design-and-manifold.md:48`) — INPUTS as a new top-level drawer vs a section of an existing one.
