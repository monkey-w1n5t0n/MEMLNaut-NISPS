---
kind: spec
stability: evolving
layer: binding
---

# Output Backends — Specification

*Workstream E. Designed 2026-06-27 against the pre-refactor tree; largely built (see the
Implementation status section at the end). British spelling in product copy. The built-in synth
is the **"Powerful Synth Engine"** — the string "C15" must never reach the user.*

> **Grounding note (2026-07-21).** Treat every `file:line` cite in the body as historical
> grounding, not a live pointer: `playground/*` died with the retired SolidJS playground (branch
> `archive/playground-solidjs`); `aimmersive-clone-spec.md` is archived at
> `_archive/aimmersive-clone-spec.md`; `/home/w1n5t0n/deployments/meml-aimmersive/*` cites refer
> to the still-deployed vanilla app *outside this repo*; VCV line numbers pre-date the P6
> reunification. The shipped backends live at `manifold/src/backends/` (not the proposed
> `engine/backends/`); the shipped bridge protocol is **`/nisps/input` + `/nisps/output` +
> `/nisps/feedback` only** — the `/nisps/state` / `/nisps/weights` / `/nisps/examples`
> full-state-sync legs described below were **deleted 2026-07-21** (zero consumers on either
> side; Rack patch save/load owns persistence). The current protocol contract is
> `vcv-module.md` §Browser Bridge.

> **Naming guard (non-negotiable).** The codename `C15` survives only in internal module/file names that the user never sees (`c15-adapter.js`, `c15-bridge.js`). Every label, tooltip, dock entry, menu item, status string, and aria-label says **"Powerful Synth Engine"** (or just "Synth"). A lint allowlist + a Playwright assertion (`expect(page).not.toContainText('C15')`) enforce this across `manifold/` and the VCV panel SVG/strings.

---

## 0. The one idea: backends are adapters behind one interface

Today the deployed app (`js/a-app.js`) fans output out to four ad-hoc sinks inline in `routeOutputs()` (`a-app.js:2425`): synth (`activeEngine.setParam`), MIDI CC (`midiOutput.sendBatch`), audio-canvas, and visual (`visualizer.setParams`). Each has its own throttle, dead-zone, and override handling copy-pasted. That fan-out *is* the debt this workstream removes.

**Replace it with one `OutputBackend` interface and a registry. Exactly one backend is "active" at a time, chosen in the Console dock.** The reactive spine (per `engine-architecture.md` §2 and `findings-design-and-manifold.md` §4) ends in a single side-effect that calls `activeBackend.send(routedOutput)`. Swapping backends swaps nothing else — the input pipeline, ML, output pipeline, training loop, and verdict loop are all backend-agnostic.

```
 gesture → input pipeline → ML (WasmIML) → output pipeline → [ activeBackend.send(routed) ]
                                                                        │
        ┌───────────────┬───────────────┬───────────────┬─────────────┼──────────────┐
   WebAudioBackend  ParticleBackend  WebMidiBackend  OscBridgeBackend  CvGateBackend  VcvBridgeBackend
   (Powerful Synth) (flow field)     (advanced CC)    (paths+ranges)    (1V/oct+gate)  (8→model→16, LED rings)
```

The active backend is a property of the **output dock** (the Console's right rail / a-immersive's Mode drawer). Backends self-describe (id, label, capability) so the dock renders a picker without hard-coding the list.

---

## 1. The `OutputBackend` adapter interface (TS)

Lives at `manifold/src/engine/backends/backend.ts`. The engine never imports a concrete backend; it imports the interface + the registry. Concrete backends may import the engine's pure helpers (curves, param-map data) but **never** React.

```ts
// manifold/src/engine/backends/backend.ts

/** What a backend needs to know about the active mode to map outputs. */
export interface BackendContext {
  modeId: string;
  outputCount: number;             // model output dims actually in use (≤ 126)
  paramMeta: ReadonlyArray<ParamMeta>;  // name/label/min/max/curve/group per output
  sampleRate?: number;             // for audio backends
  audioContext?: AudioContext;     // lazily provided; only audio backends use it
}

export interface ParamMeta {
  id: string;        // stable machine id, e.g. 'Env_A_Att'
  label: string;     // user-facing
  min: number;       // baseline range floor (normalised 0..1 maps here)
  max: number;       // baseline range ceil
  curve: number;     // 0..1, 0.5 = linear (see §3 universal mapping)
  group: string;     // for colour grouping (LED rings, heatmap)
}

export type BackendId =
  | 'synth' | 'particles' | 'midi' | 'osc' | 'cvgate' | 'vcv';

export interface BackendDescriptor {
  id: BackendId;
  label: string;             // dock label — NEVER "C15"
  description: string;
  /** crossOriginIsolated / WebMIDI / WebSocket etc. availability probe. */
  isAvailable(): boolean;
  /** true when this backend can ALSO feed inputs back (VCV bridge, OSC return). */
  bidirectional?: boolean;
}

export interface OutputBackend {
  readonly descriptor: BackendDescriptor;

  /** Called once when this backend becomes active. May be async (audio start,
   *  WS connect, MIDI access). Resolve only when ready to receive send(). */
  start(ctx: BackendContext): Promise<void>;

  /** Hot per-frame path. `routed` is the post-pipeline Float32Array (0..1),
   *  length = ctx.outputCount. MUST NOT allocate; MUST NOT mutate `routed`.
   *  Throttling/dead-zone live INSIDE each backend (rates differ per sink). */
  send(routed: Float32Array): void;

  /** Called when switching away or unmounting. Release WS/MIDI/audio/threads. */
  teardown(): Promise<void>;

  /** Optional input return path for bidirectional backends. The engine
   *  subscribes; values drive model inputs (e.g. VCV CV-in, OSC /nisps/input). */
  onInputs?(cb: (values: Float32Array) => void): () => void;

  /** Optional: backends that own training transport (VCV/OSC bridge) expose
   *  the remote verdict/example surface here. See §7. */
  remote?: RemoteTrainingBridge;
}
```

Registry (`manifold/src/engine/backends/registry.ts`): a `Map<BackendId, () => OutputBackend>` of lazy factories. The dock reads `descriptors` (filtered by `isAvailable()`); selecting one calls `engine.setBackend(id)`, which `teardown()`s the old and `start()`s the new with the current `BackendContext`.

**Why `send(Float32Array)` and not per-param events:** matches the spine's single transferable-buffer effect (`engine-architecture.md` §2.1), keeps the hot path allocation-free, and lets each backend decide its own decimation. The legacy code already proves the pattern — every sink takes the full output vector and self-throttles (synth 50 ms/0.002 dead-zone `a-app.js:2425`; MIDI 50 ms/Δ1 `midi-output.js:114`; OSC 50 ms/0.002 `osc-output.js:97`).

---

## 2. The backends

### 2.1 Built-in Synth — the "Powerful Synth Engine" (`web-audio.ts` + `synth.ts`)

Two cooperating backends, both labelled as the synth in the UI, but architecturally distinct:

- **`WebAudioBackend`** wraps the parity-tested repo engine: `EngineHost` (`playground/src/audio/engine-host.ts`) + the worklet `nisps-processor.ts` running `_nisps_engine_process_block` (`nisps/wasm/bindings.cpp`). This is the firmware-parity audio path — the engine *is* the sound. `send()` → `EngineHost.setParams(routed)` → worklet. This is the default and the one that satisfies browser-parity chokepoint C.
- **`PowerfulSynthBackend`** (the C15 path) wraps `deployments/meml-aimmersive/js/synth/c15-adapter.js` → `c15-bridge.js` (SharedArrayBuffer ring + its own `c15_engine.wasm` worklet). Param mapping comes from `param-map.js` (`SYNTH_PARAM_MAP`, 126 entries) and `presets.js` (tiered presets). `setParam(index, normalised)` maps index→hardware id (`c15-adapter.js:121`). This is browser-only (firmware has no C15), and its 126-param surface + group/section overrides power the synth visualiser and the group-override drawer.

**Reuse, verbatim:** `c15-adapter.js`, `c15-bridge.js`, `param-map.js`, `presets.js` move under `manifold/src/engine/backends/synth/` unchanged (internal names keep "c15"; UI strings do not). The `engine-interface.js` `SynthEngine` base maps cleanly onto `OutputBackend`: `init(ctx)`→`start`, `setParam` loop driven by `send`, `stop`→`teardown`. Curve/override math is `applyCurve`/`applyGroupOverride` (`param-map.js:287`) — fold into the universal mapping (§3).

**Throttle (keep — load-bearing):** ≥50 ms send interval + 0.002 dead-zone per param prevents flooding the C15 ring buffer at 126×30 fps (`a-immersive.html` clone-spec §10 flags this).

`isAvailable()`: WebAudio + (for the C15 path) `crossOriginIsolated === true` (SAB needs COOP/COEP; already server-scoped per `findings-engine-surface.md`).

### 2.2 Particle System — faithful port of `visualizer.js` (`particles.ts`)

A `ParticleBackend` whose `send(routed)` calls a ported `FlowFieldVisualizer.setParams(routed)`. The visual canvas runs in its own `requestAnimationFrame` loop (per `findings-design-and-manifold.md` §4.3 — rAF touches drawing only, never inference); `send()` only updates the param struct. The port MUST look and behave **exactly** as the deployed version. The full algorithm is documented in §4 so the React port is byte-faithful.

`isAvailable()`: always (Canvas2D). This backend produces no audio — it is the "visual" output mode.

### 2.3 MIDI out — advanced CC config (`web-midi.ts`)

A `WebMidiBackend` wrapping the salvaged `midi-output.js` (Web MIDI API, `sendBatch`, per-CC dead-zone + 50 ms throttle, device hot-plug handling — `midi-output.js`). The **advanced CC config comes from workstream D's config model**, persisted as a CC map: per output dim → `{ name, cc (0–127), channel (1–16), min, max, curve, muted, fixedValue }`. The map shape and storage are already defined in `midi-cc-map.js` (`createCCParam`, `loadCCMap`/`saveCCMap`, well-known `CC_NAMES`, default 8-CC starter set). Lift that file verbatim into `manifold/src/engine/backends/midi/cc-map.ts`.

`send(routed)`: for each non-muted CC param, `value = round(applyGroupOverride(routed[i], curve, min, max) * 127)`; batch the changed ones; `midiOutput.sendBatch(...)`. Storage key stays engine-scoped (`nisps-midi-cc-map:<modeId>`) for migration continuity.

`isAvailable()`: `!!navigator.requestMIDIAccess`.

### 2.4 OSC out — paths + ranges (`osc-bridge.ts`)

An `OscBridgeBackend` that **salvages the existing OSC bridge** rather than reinventing it. Two pieces already exist and are good:

- **Browser client:** `deployments/meml-aimmersive/js/synth/osc-output.js` (param-named WS messages, 50 ms/0.002 dead-zone) and the richer `js/nisps/osc-client.js` (`NispsOscClient` — `EventTarget`, auto-reconnect with backoff). The shipped transport is `manifold/src/backends/osc-client.ts` (`sendParams` / `sendInput` / `sendFeedback` — the legacy `sendState`/`sendWeights` legs were deleted with the full-state sync).
- **Bridge server:** the repo's canonical bridge is `manifold/osc-bridge/bridge.ts` — a Deno WebSocket↔UDP-OSC bridge, zero-dependency OSC encode/decode, bidirectional (WS verbs: `params`, `input`, `feedback`).

**OSC path + range contract (the live set):**

| Direction | Address | Args | Meaning |
|---|---|---|---|
| browser→target | `/nisps/<param_name>` | `f` | one param, **post-baseline-mapping value** (see §3) |
| browser→target | `/nisps/input` | `f…f` | input vector → drives model inputs (VCV bridged mode) |
| browser→target | `/nisps/feedback` | `s` | verdict op JSON (`up` / `down` / `rand` / `clear`) |
| target→browser | `/nisps/output` | `f…f` | output vector (visualisation / monitoring) |
| target→browser | `/nisps/input` | `f…f` | input vector echo |

(The 2026-06 design also carried `/nisps/state` and `/nisps/weights` full-JSON sync — deleted, see the grounding note.)

**Ranges:** OSC floats are sent in the param's mapped range by default (`applyGroupOverride` applied before send, matching `osc-output.js`), with a per-backend toggle to send **raw normalised 0..1** instead (some OSC targets want 0..1 and do their own scaling). Address prefix (`/nisps`), target host/port (default `127.0.0.1:9000`), and listen port (default `9001`) are configurable — `bridge.ts` already exposes `--osc-host/--osc-port/--osc-prefix/--ws-port/--listen-port`.

`isAvailable()`: always (attempts WS to `ws://localhost:8765`; surfaces a "bridge not running" status if the connect fails — `osc-client.js` already reconnects with backoff). Bidirectional (`onInputs` wired to `/nisps/input`).

### 2.5 CV / gate backend (`cvgate.ts`)

For browser-side CV/gate there is no native hardware path, so this backend has **two transports** selectable in config:

1. **DC-coupled WebAudio CV** (browser-native): each output dim drives a `ConstantSourceNode` (or a sample-accurate `AudioWorklet` channel) whose `offset` = mapped voltage, summed/routed to the audio interface's output channels. Gate outputs are derived from a configurable threshold on a chosen dim (value > τ → high). Pitch (1V/oct) uses a per-output "voltage role" config: `{ role: 'cv' | 'gate' | 'voct', vmin, vmax, gateThreshold }`. This is the only way to emit real CV from a browser (DC-coupled interface required; surfaced as a caveat in the UI).
2. **Bridged CV via VCV / OSC** (recommended default): reuse the OSC/VCV transport — the *VCV module's 16 CV outputs* (§5) are the real CV/gate jacks. In this mode `CvGateBackend` is a thin alias that delegates to `VcvBridgeBackend` with a "treat outputs as CV/gate" preset (per-output unipolar 0–10 V / bipolar ±5 V / 1V-oct, matching the VCV per-output range menu in `MEMLNaut.cpp:818`).

`isAvailable()`: WebAudio path always; native-CV quality flagged as "requires DC-coupled interface". **Open choice:** whether browser-native DC CV is worth shipping vs. making CV strictly a VCV-bridge concern (recommendation: ship the VCV-bridge alias first, defer DC-coupled WebAudio CV).

### 2.6 VCV Rack module — first-class (`vcv-bridge.ts` browser side + `vcv/` C++ side)

The headline new backend. A first-class **VCV Rack 2 module** (`MEMLNaut`) with **8 CV inputs → model → 16 CV outputs**, an **LED ring around each of the 16 outputs**, and a **browser↔VCV bridge** so the tool is controllable AND trainable from both inside Rack and entirely from the browser. Full design in §5–§7.

The browser-side adapter (shipped as `manifold/src/backends/vcv-backend.ts`) reuses the OSC client (§2.4) as transport. When active in **bridged mode**, the browser supplies inputs in real time (`/nisps/input`) and forwards verdicts to the module's embedded learner (`/nisps/feedback`).

---

## 3. Universal per-output baseline mapping

Every backend shares ONE baseline mapping from a normalised model output `v ∈ [0,1]` to a sink value, so behaviour is identical across sinks and the override UI (heatmap popup, group drawer) is backend-agnostic. This is the existing curve math (`param-map.js:287`), promoted to `manifold/src/engine/backends/mapping.ts`:

```ts
// 0.5 = linear; <0.5 ease-in, >0.5 ease-out. Bit-identical to legacy + nisps/core/math.hpp.
export function applyCurve(v: number, c: number): number {
  return c === 0.5 ? v : Math.pow(v, Math.pow(2, 4 * (c - 0.5)));
}

/** Per-output baseline: curve, then scale into [min,max]; honour freeze/mute. */
export function mapOutput(v: number, p: OutputMapping): number {
  if (p.frozen) return p.fixedValue;        // pinned, ignores model
  return p.min + applyCurve(v, p.curve) * (p.max - p.min);
}

export interface OutputMapping {
  min: number; max: number; curve: number;   // baseline range + curve
  frozen: boolean; fixedValue: number;        // pin
  muted?: boolean;                            // excluded from this sink
}
```

Backends then apply only their **sink-specific final transform** on top of the baseline:

| Backend | Baseline → sink transform |
|---|---|
| Powerful Synth | `mapOutput` → `setParam(i, value)` (value already in param range) |
| Particles | **raw 0..1** (the visualiser owns its own param ranges — see §4); curve/freeze still applied, min/max default to 0..1 |
| MIDI CC | `mapOutput` → `round(value * 127)` clamped 0–127 |
| OSC | `mapOutput` (or raw 0..1 if "send raw" toggled) → `/nisps/<name> <f>` |
| CV/gate | `mapOutput` → voltage by role (`cv`: `value*10` or `(value-0.5)*10`; `voct`: 1V/oct; `gate`: `value>τ ? high : 0`) |
| VCV | model output `0..1` sent raw over bridge; the **module** applies its own per-output range + attenuverter (`MEMLNaut.cpp:342 outputToVoltage`) |

The override store (one per mode, `OutputMapping[]`) is owned by the engine and shared by all backends; freeze/mute/curve/range edits in the UI apply uniformly. Note the legacy split where the heatmap calls it `frozen` and the group drawer calls it `muted` but both map to the same field (`aimmersive-clone-spec.md` §10) — unify to the single `OutputMapping` above.

---

## 4. Particle system — faithful-port plan with the documented algorithm

Source of truth: `deployments/meml-aimmersive/js/ui/visualizer.js` (289 lines, read in full). The React port (`manifold/src/engine/backends/particles/flow-field.ts`) must reproduce this **exactly**. Below is the complete algorithm with line citations so the port is verifiable.

### 4.1 Constants & noise source
- **Particle count: `numParticles = 400`** (`visualizer.js:53`).
- **Noise: a self-contained 2-D value/Perlin-style noise**, not a library. A `Uint8Array(512)` permutation table `PERM` is built once at module load by Fisher–Yates shuffling `[0..255]` then duplicating (`:5–14`). `fade(t)=t³(t(6t−15)+10)` (`:16`), `lerp` (`:17`), `grad(hash,x,y)` using `hash & 3` (`:19–24`), `noise2D(x,y)` doing the standard 4-corner bilinear-with-fade interpolation (`:26–44`). **The shuffle uses `Math.random()` at module load**, so the field is non-deterministic per page load — the port must keep this (or seed it; flagged as an open choice if determinism is wanted for tests).
- `TWO_PI = Math.PI*2` (`:46`); `this.time` advances `+= 0.003` per `draw()` (`:185`).

### 4.2 Output→param mapping (20 dims, `setParams`, `:159–181`) — reproduce verbatim
Guard: returns early if `outputs.length < 20` (`:160`). Then:
```
angleOffset       = out0 * TWO_PI
scale             = 0.001 + out1 * 0.009
speed             = 0.5   + out2 * 4.5
hueBase           = out3 * 360
hueSpread         = out4 * 120
particleSize      = 1     + out5 * 5
fadeRate          = 0.01  + out6 * 0.14
turbulence        = out7 * 2
attractStrength   = 0.1   + out8 * 2.9
attractRadius     = 40    + out9 * 420
dispersionRate    = 0.2   + out10 * 8
dispersionAmount  = out11 * 3
particleLifetime  = 30    + out12 * 470
respawnStyle      = out13                       // 0=random,1=edge,2=center-burst
advectionMode     = out14                       // flow→orbit→radial blend
inertia           = out15 * 0.98
drag              = out16 * 0.35
repulsorStrength  = out17 * 4.5
repulsorCount     = floor(out18 * 4.999)        // 0..4
repulsorOrbitRate = 0.1   + out19 * 2.9
```
The 20 output names (for labels/the heatmap colouring) are `VISUAL_PARAM_NAMES` in `a-app.js:46`: `Flow, Scale, Speed, Hue, Spread, Size, Trail, Turb, Attract, Radius, DispRate, DispAmt, Lifetime, Respawn, Advection, Inertia, Drag, Repulse, RepCnt, RepRate`.

### 4.3 Particle lifecycle (`:104–156`)
- `makeParticle(id)`: random x,y in canvas; `age = floor(rand*particleLifetime)`; `life = computeLifetime()`; `vx=vy=0` (`:104–114`).
- `computeLifetime()`: `max(10, floor(particleLifetime * (0.65 + rand*0.7)))` (`:116–119`).
- `respawnParticle(p)`: `mode = min(2, floor(respawnStyle*2.999))` (`:122`):
  - **edge (1):** spawn on a random one of 4 sides; give inward impulse of magnitude 2.0 toward centre (`:125–137`).
  - **center-burst (2):** spawn within radius `min(w,h)*0.08` of centre at random angle; velocity `2.5` outward along that angle (`:138–145`).
  - **random (0):** random position; velocity `(rand*2−1)*0.5` each axis (`:146–152`).
  - reset `age=0`, `life=computeLifetime()`.

### 4.4 Per-frame `draw()` (`:183–287`) — the exact integration
1. `time += 0.003`. **Trail fade:** fill whole canvas with `rgba(13,13,13, fadeRate)` (`:188`) — this is the trail length control, not a clear.
2. For each particle, with centre `(cx,cy)=(w/2,h/2)`:
   - **Flow field:** `nx=p.x*scale`, `ny=p.y*scale`; `angle = noise2D(nx+time, ny)*TWO_PI + angleOffset`; `curl = noise2D(nx+100, ny+100+time*0.5)*turbulence` (`:196–199`).
   - **Three advection fields** (`:202–214`): flow `(cos(angle+curl), sin(angle+curl))*speed`; orbit = perpendicular to the radial-from-centre unit vector, `*speed`; radial = radial unit vector `*speed`.
   - **Blend by `advectionMode`** (`:216–225`): `modeBlend = advectionMode*2`; if `<1` lerp(flow→orbit, modeBlend) else lerp(orbit→radial, modeBlend−1).
   - **Inertia + drag** (`:226–229`): `vx = vx*inertia + targetVx*(1−inertia)` (same for vy); then `vx *= (1−drag)`.
   - `nextX = x+vx`, `nextY = y+vy`.
   - **Central attractor** (`:233–242`): pull toward centre with `falloff = 1/(1+normDist²)` where `normDist = min(dist/attractRadius, 2)`; add `nCenter * attractStrength * falloff`.
   - **Dispersion pulse** (`:244–248`): `pulse = 0.5+0.5*sin(time*dispersionRate + id*0.07)`; subtract `nCenter * dispersionAmount*pulse*falloff` (pushes outward near centre).
   - **Orbiting repulsors** (`:250–264`): `repulsorRadius = min(w,h)*0.28`; for each of `repulsorCount`: phase from `time*repulsorOrbitRate + (r/4)*TWO_PI`, `wobble = 0.6+0.15*r`, position uses `cos(phase*(1+wobble))`/`sin(phase*(1.3+wobble))`; inverse-square push `force = repulsorStrength*(650/distSq)` with `distSq = d²+160`.
   - **Wrap edges** (`:270–273`); `age += 1`; respawn when `age >= life` (`:275–276`).
   - **Colour** (`:279–282`): `hue = (hueBase + (id/numParticles)*hueSpread) % 360`; `lightness = 50 + sin(id*0.1 + time)*15`; fill `hsl(hue, 75%, lightness%)`; `arc(x,y,particleSize)`.

### 4.5 Port plan
- **Class, not component.** `FlowFieldVisualizer` is a plain TS class taking a `<canvas>` ref — identical to today. The React `<ParticleCanvas>` mounts it in `onMount`, drives `draw()` from one `requestAnimationFrame` loop, and calls `resize()` on the window resize handler (DPR scaling at `:84–92`). React renders the canvas element; the class owns all pixels.
- **`ParticleBackend.send(routed)`** → `viz.setParams(routed)` (no alloc; just field writes). Because the visualiser reads `outputs[0..19]`, the backend asserts `ctx.outputCount >= 20` and slices/pads to 20.
- **Faithfulness gate (Playwright):** pixel-diff a fixed seed (seed the `PERM` shuffle behind a `?seed=` for tests) at fixed param vectors against a golden capture from the deployed app; assert SSIM ≥ threshold. Also unit-test `setParams` mapping numerically (the §4.2 table).
- **Verbatim copy is allowed**: the noise + integration math is pure and has no DOM coupling beyond `ctx`/`canvas`; lift `:1–288` essentially unchanged into TS, add types, keep numeric constants exact.

---

## 5. VCV Rack module design (`MEMLNaut`, 8 in / 16 out)

There is **already a working VCV module** at `vcv/` (`MEMLNaut.cpp`, 959 lines; `plugin.json`; `SPEC.md`; `osc_server.hpp`; `Makefile`; `res/*.svg`) — but it is **2-in / 12-out + 5 derived**. The new requirement is **8-in / 16-out with LED rings**. This is an evolution of the existing module, reusing its threading model, OSC server, and serialization wholesale.

### 5.1 What changes vs. the existing module
- `NUM_ML_INPUTS`: 2 → **8** (the existing `MAX_ML_INPUTS = 8` already anticipated this; `MEMLNaut.cpp:14`). All 8 are first-class jacks (not "reserved").
- `NUM_ML_OUTPUTS`: 12 → **16**. The 5 derived outputs (MEAN/STD/DELTA/NOVELTY/CONFIDENCE) remain but become **optional context-menu extras** or move to the expander — the 16 raw outputs are the headline.
- MLP shape: stays within "the modular N×M envelope" — `nisps::IML<float> iml{8, 16, {16, 24, 16}}` (the existing default hidden stack is fine; sized for real-time inference per `SPEC.md`). Inputs feed model input dims; the 16 outputs are the inference outputs.
- **LED ring per output** replaces the single `SmallLight<WhiteLight>` next to each jack (`MEMLNaut.cpp:804`).

### 5.2 Panel layout (Wide, ~32–44 HP)
```
┌────────────────────────────────────────────┐
│              MEMLNaut                       │   ← brand; "Powerful Synth" wording N/A (this is the CV mapper)
│  ┌──────────────────────────────────────┐  │
│  │  DISPLAY: 16 bars + XY dot + metrics │  │   ← NanoVG LedDisplay/drawLayer (existing :699)
│  └──────────────────────────────────────┘  │
│   SPREAD   RATE          LEARN● RAND CLEAR  │   ← knobs + buttons (existing controls)
│   [+] [−]   (verdict buttons)               │
│                                             │
│  INPUTS  (8 jacks, 2 rows × 4)              │
│   IN1 IN2 IN3 IN4                           │
│   IN5 IN6 IN7 IN8   + LEARN_GATE +TRIG −TRIG│
│                                             │
│  OUTPUTS (16, 4 rows × 4), each:            │
│   ◉jack  with an LED RING around the jack   │
│   [(◯1)(◯2)(◯3)(◯4)]                         │
│   [(◯5)(◯6)(◯7)(◯8)]                         │
│   [(◯9)(◯10)(◯11)(◯12)]                      │
│   [(◯13)(◯14)(◯15)(◯16)]                     │
│  (optional) MEAN STD DELTA NOVELTY CONF     │
└────────────────────────────────────────────┘
```
Each output is a `PJ301MPort` jack with a **`LedRingWidget`** drawn concentric around it (no separate attenuverter trimpot in the default skin — attenuverter moves to right-click/expander to make room for the ring; keep `PARAM_ATTEN_*` in the model for range scaling).

### 5.3 The LED-ring widget + palette mapping
A custom widget that draws a ring whose **arc fill is proportional to the output value** and whose **colour comes from the frontend design tokens**. Per the Rack manual, self-illuminating custom widgets override `drawLayer(args, 1)` and draw on layer 1 (so they stay bright when room brightness is lowered) ([VCV custom lights](https://community.vcvrack.com/t/how-to-use-custom-lights/1941), [Migrate2](https://vcvrack.com/manual/Migrate2)).

```cpp
// vcv/src/LedRing.hpp  (new)
struct LedRingWidget : Widget {
    MEMLNaut* module = nullptr;
    int outIdx = 0;
    NVGcolor ringColor = nvgRGB(0xff, 0x6a, 0x00);  // default --accent
    float radius = 7.f;   // mm-ish, around a PJ301M jack
    void drawLayer(const DrawArgs& args, int layer) override {
        if (layer != 1 || !module) return;
        float v = clamp(module->slewOutputs[outIdx], 0.f, 1.f);   // 0..1
        Vec c = box.size.div(2);
        // track (dim full ring)
        nvgBeginPath(args.vg);
        nvgArc(args.vg, c.x, c.y, radius, -M_PI/2, -M_PI/2 + 2*M_PI, NVG_CW);
        nvgStrokeColor(args.vg, nvgRGBA(ringColor.r*255, ringColor.g*255, ringColor.b*255, 40));
        nvgStrokeWidth(args.vg, 1.4f); nvgStroke(args.vg);
        // value arc (proportional)
        nvgBeginPath(args.vg);
        nvgArc(args.vg, c.x, c.y, radius, -M_PI/2, -M_PI/2 + v*2*M_PI, NVG_CW);
        nvgStrokeColor(args.vg, ringColor);
        nvgStrokeWidth(args.vg, 1.8f); nvgStroke(args.vg);
        // glow halo (matches the frontend "glow not shadow" signature)
        nvgGlobalCompositeOperation(args.vg, NVG_LIGHTER); /* … bloom pass … */
    }
};
```

**Palette mapping — derived from `docs/redesign/manifold-export/tokens/colors.css` (read).** Ring colours come from the design tokens so VCV matches the frontend. A `kRingPalette[16]` table assigns each output a colour by its **parameter group**, cycling through the token accents and group/pin colours:

| Source token (colors.css) | Hex | Used for |
|---|---|---|
| `--accent` | `#ff6a00` | primary outputs / group 0 (orange — the live colour) |
| `--accent-2` | `#00ccff` | data outputs / group 1 (cyan) |
| `--accent-3` | `#ffa860` | group 2 (warm tint) |
| `--pin-3` base `#b464ff` | `#b464ff` | group 3 (violet) |
| `--good` | `#6bc26b` | group 4 (green) |
| `--warn` | `#f5c45e` | group 5 (amber) |
| `--info` | `#5b9eef` | group 6 (blue) |
| `--danger` | `#ff4466` | bipolar / perturbed outputs (red) |

Mapping rule: `ringColor = kRingPalette[paramMeta[i].group % paletteLen]`, so outputs in the same mode-group glow the same colour, identical to the heatmap/Console grouping. Bipolar outputs (per-output range menu) tint toward `--danger`. The palette is a single header (`vcv/src/palette.hpp`) generated from `colors.css` so a token change propagates to both frontend and module (a small codegen step; **open choice** whether to automate or hand-sync).

### 5.4 Reused, unchanged from the existing module
- **Threading model** (`MEMLNaut.cpp:67–312`): audio-thread `iml` + worker-thread `imlShadow`, job queue (Train/Perturb/Randomize/Clear), atomic weight hand-off, single-writer invariant. Already correct; just resize the I/O.
- **Inference-rate decimation + slew + post-swap crossfade** (`:447–499`).
- **Verdict loop** (`:412–445`): `+`/`−` buttons and `+TRIG`/`−TRIG` gated by LEARN. `+` → add example (current inputs→current outputs) + enqueue Train + decay noise ×0.97; `−` → bump noise (cap `0.3(1−s)+0.05s`) + enqueue Perturb. Identical semantics to the browser verdict loop.
- **Serialization** (`dataToJson`/`dataFromJson`) + **`.nisps` preset save/load** + **OSC server** (`osc_server.hpp`). The `.nisps` v3 format is specified in `vcv-module.md` §State Persistence (the separate `vcv/NISPS-FORMAT.md` was deleted).
- Per-output / per-input **range menu** (uni/bipolar, attenuverter) (`:818–843`).

### 5.5 Plugin scaffold files (as they exist today)
```
vcv/
├── plugin.json          # slug MEMLNaut; tags Controller/Utility/Random
├── Makefile             # VCV SDK Makefile; RACK_DIR-driven (make dist via the SDK's plugin.mk)
├── src/
│   ├── plugin.{hpp,cpp} # plugin init / model registration
│   ├── MEMLNaut.cpp     # module — 8 in / 16 out
│   ├── iml.hpp          # thin adapter over the shared nisps/ core (P6)
│   ├── LedRing.hpp      # LED-ring widget (§5.3)
│   ├── palette.hpp      # ring colour table from the design tokens (§5.3)
│   └── osc_server.hpp   # OSC server (transport-only; /nisps/feedback per §7)
├── res/                 # MEMLNaut.svg / -wide.svg / -expander.svg
├── BUILDING.md, DISTRIBUTION.md, README.md
```
(The 2026-06 draft also listed `Makefile.dist`, `test/smoke_test.cpp`, `SPEC.md` and
`NISPS-FORMAT.md` — all since deleted or absorbed; the module spec is `vcv-module.md`.)

---

## 6. Browser↔VCV bridge design

The module must be **controllable AND trainable from BOTH inside Rack AND entirely from the browser**. Both ends operate on the same model; the bridge keeps them coherent.

### 6.1 Transport — propose options (operator open choice)
The existing salvage path is **WebSocket↔UDP-OSC** (`osc-bridge/bridge.ts` + `osc-client.js` + `osc_server.hpp`). This is the recommended default and already works. Three options to flag:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. WS↔OSC bridge server (recommended)** | Browser ⇄ `bridge.ts` (Deno WS server, localhost:8765) ⇄ UDP OSC ⇄ module's `osc_server.hpp` | Already built + bidirectional; standard OSC; works with SuperCollider/Max too; no browser perms | Needs a helper process running locally (Deno, or a compiled `nisps-osc-bridge` binary from `compile.sh`) |
| **B. Direct WebMIDI** | Browser ⇄ Web MIDI ⇄ a virtual MIDI port ⇄ a tiny MIDI-in path in the module | No helper process if a virtual MIDI port exists; browser-native | 7-bit/14-bit only — too coarse for weights/state; really only for live CC; module would need MIDI parsing |
| **C. Native (module hosts a WS server)** | The VCV module itself opens a WebSocket/HTTP server; browser connects directly | No external bridge process | Adds a WS/TLS stack inside the plugin; COOP/COEP + mixed-content (`https://` page → `ws://localhost`) friction; more attack surface in the audio plugin |

**Recommendation:** ship **A** (it exists, it's bidirectional, it already targets this very module — see `osc-client.js:1` "Connects the webapp to VCV Rack MEMLNaut module"). Keep **B** as a live-performance CC convenience only. Treat **C** as a future "no-helper" nicety. **This transport choice is an explicit operator open choice.**

### 6.2 Two modes
- **Standalone:** module runs entirely inside Rack (CV in → model → CV out; verdict via panel buttons/triggers). No browser. Works today.
- **Bridged:** browser connects via the bridge. In bridged mode **the browser supplies inputs in real time** — the Manifold pointer / joystick / pads stream `/nisps/input <f…f>` to the module, which uses them instead of the physical CV-in jacks. The module streams `/nisps/output` and `/nisps/input` back at ~100 ms for browser visualisation.

### 6.3 Coherence model
**One model — the module's.** In bridged mode the browser acts as a remote controller and
trainer for the module's embedded learner: it streams inputs and forwards verdicts
(`/nisps/feedback`), and reads the module's live I/O back. There is **no weight or state sync**
between the browser's own WASM net and the module — the 2026-06 whole-model-snapshot design
(`/nisps/state` / `/nisps/weights`, last-writer-wins, matched-architecture weight transfer) was
deleted 2026-07-21 with zero consumers on either side. Persistence belongs to the Rack patch and
`.nisps` files (`vcv-module.md`).

---

## 7. Training over the bridge — both directions

The verdict loop works from **either** end, on the module's model. The shipped surface:

- OSC verb `/nisps/feedback <s>` carrying a JSON op — **`up` / `down` / `rand` / `clear`**
  (optional `spread`, `input`/`output` vectors). The module's `osc_server.hpp` `onFeedback`
  callback stages the op atomically for the audio thread, which routes it through the **same**
  job/`add_example` paths the panel buttons use.
- **Browser → VCV training:** thumbs-up in the Manifold → `vcv-backend.ts` `sendFeedback('up')`
  → the module's worker trains its shadow instance → atomic weight swap. The browser observes
  the result through the live `/nisps/output` stream (not through weight sync — §6.3).
- **VCV panel training** works exactly as in standalone mode; the browser sees the new mapping
  through the output stream.

The 2026-06 design's richer `RemoteTrainingBridge` (remote `addExample`, `undo`, `onState`
callbacks) was never built; its state-sync legs are deleted (§6.3).

---

## 8. Build / install notes

### Browser side
Backends live under `manifold/src/engine/backends/`; lifted JS (`c15-*`, `param-map`, `presets`, `midi-output`, `midi-cc-map`, `osc-client`, `visualizer`) ported to TS, parity-checked. No new build step — they ride the existing Vite `manifold` build. COOP/COEP stays server-scoped (needed by the Powerful Synth's SAB path).

### OSC bridge server
```bash
cd manifold/osc-bridge
deno run --allow-net --unstable-net bridge.ts
#   --osc-host 127.0.0.1 --osc-port 9000 --ws-port 8765 --listen-port 9001
```
For users without Deno, `compile.sh` cross-compiles standalone `nisps-osc-bridge-<platform>`
binaries into `dist/` via `deno compile`. Surface "bridge not running" in the OSC/VCV backend
status (the client auto-reconnects).

### VCV module
```bash
cd vcv
export RACK_DIR=/path/to/Rack-SDK            # VCV Rack 2 SDK
make                                          # builds plugin.so/.dylib/.dll
make install                                  # copies into the VCV user plugins dir
# distribution: make dist   (SDK plugin.mk; produces the .vcvplugin — see vcv/DISTRIBUTION.md)
```
Requires the VCV Rack 2 SDK; the shared `nisps/` core is header-only C++20, reached via relative
includes from `vcv/src/` (see `vcv/BUILDING.md`). Ship v2-only (rationale in `vcv-module.md`).
License caveat: VCV SDK is GPLv3 — the combined binary is effectively GPL; not submitting to the
VCV Library initially.

---

## 9. Open choices for the operator

1. **Bridge transport (§6.1):** confirm **A — WS↔OSC bridge server** as default (recommended; already built and bidirectional), with WebMIDI as a live-CC-only convenience and a native in-module WS server deferred. This is the biggest call.
2. **Bridged weight-sync vs I/O-only (§6.3):** the browser engine is fixed `MLP<2,…,126>`; the module is `8→16`. Either (a) run a **matched 8-in/16-out browser mode** for true raw-weight transfer, or (b) accept that bridged sessions sync **I/O + examples only** and each side trains its own weights. Recommendation: (b) for v1, (a) when the modular N×M browser MLP lands (workstream F).
3. **CV/gate native path (§2.5):** ship only the **VCV-bridge CV alias** for v1, or also build browser-native DC-coupled WebAudio CV? Recommendation: VCV-bridge first; defer DC CV.
4. **Particle noise determinism (§4.1):** keep the `Math.random()`-seeded permutation (non-deterministic per load, faithful to today) or add a `?seed=` for reproducible visuals/tests? Recommendation: keep default behaviour, add an opt-in test seed.
5. **Ring palette sync (§5.3):** auto-generate `vcv/src/palette.hpp` from `colors.css` via a codegen step, or hand-sync? Recommendation: small codegen so a token change updates both surfaces.
6. **Derived outputs on the 16-out module (§5.1):** keep MEAN/STD/DELTA/NOVELTY/CONFIDENCE as menu-toggled extras / move to the expander, or drop them? Recommendation: move to the expander; keep the 16 raw outputs + LED rings as the headline panel.
7. **Default active backend:** confirm **WebAudioBackend (firmware-parity engine)** is the default, with the Powerful Synth (C15 path), particles, MIDI, OSC, CV, VCV selectable in the dock.

---

## 10. Cited source files (absolute paths)
- Particle algorithm (faithful port): `/home/w1n5t0n/deployments/meml-aimmersive/js/ui/visualizer.js` (`:5–288`)
- Built-in synth: `/home/w1n5t0n/deployments/meml-aimmersive/js/synth/c15-adapter.js`, `…/c15-bridge.js`, `…/param-map.js` (`:287` curve math), `…/presets.js`
- MIDI: `/home/w1n5t0n/deployments/meml-aimmersive/js/midi/midi-output.js` (`:114` batch throttle), `…/midi/midi-cc-map.js`
- OSC client: `/home/w1n5t0n/deployments/meml-aimmersive/js/nisps/osc-client.js`; param-named client `…/js/synth/osc-output.js` (`:97`)
- OSC bridge server: `/home/w1n5t0n/deployments/meml-aimmersive/osc-bridge/bridge.ts` (addresses `:298–305`, encode/decode `:70–182`), `bridge.mjs`, `compile.sh`
- VCV module: `/home/w1n5t0n/src/MEMLNaut-NISPS/vcv/src/MEMLNaut.cpp` (line numbers are pre-P6 grounding), `…/vcv/src/osc_server.hpp`, `…/vcv/plugin.json`, `…/docs/specs/vcv-module.md`, `…/vcv/Makefile`, `…/vcv/res/*.svg`
- Design tokens (ring palette): `/home/w1n5t0n/src/MEMLNaut-NISPS/docs/redesign/manifold-export/tokens/colors.css`
- Spine/engine context: `/home/w1n5t0n/src/MEMLNaut-NISPS/docs/specs/engine-architecture.md` (trimmed 2026-07), `…/recon/findings-design-and-manifold.md` (§4), `…/recon/findings-engine-surface.md`, `…/_archive/aimmersive-clone-spec.md` (routeOutputs §6, §7 visual table, §10)

Sources (VCV SDK / widgets): [VCV custom lights](https://community.vcvrack.com/t/how-to-use-custom-lights/1941), [Migrate2 (drawLayer/layer 1)](https://vcvrack.com/manual/Migrate2), [Plugin Development Tutorial (RACK_DIR/make dist)](https://vcvrack.com/manual/PluginDevelopmentTutorial), [Plugin API Guide](https://vcvrack.com/manual/PluginGuide).
---

## Verification corrections (adversarial pass, 2026-06-27) — verdict: minor-issues

Strongly grounded: every cited file exists, the particle algorithm (§4) is reproduced faithfully, all 8 token
hex values verify against `colors.css`, the VCV cites + OSC bridge protocol + MIDI/OSC salvage files + C15
adapter chain are accurate. Apply these fixes:

- **`applyCurve` must keep the input clamp.** Real code (`param-map.js:287-291`) clamps to [0,1] BEFORE the
  pow: `Math.pow(clamp01(value), exponent)`. Drop the "bit-identical" wording or add the clamp to the TS port.
- **`ParamMeta.id` vs `name` conflation** — the example `id: 'Env_A_Att'` is actually the `name` field; keep
  `id` (slug) and `name` (param key) distinct when porting `param-map.js`.
- VCV module already at `vcv/` (2-in/12-out) — evolve to 8→16, do not rebuild; reuse its threading/OSC/serialisation.

---

## Implementation status (2026-06-28)

MIDI + OSC backends are BUILT in `manifold/src/backends/` (OutputBackend interface + BackendManager consuming the
spine; WebMIDI out with per-output CC#/ch/name/range; OSC-over-WS to the Deno bridge in `manifold/osc-bridge/`).
The Outputs dock panel specialises per backend (`manifold/src/dock/OutputsBackendConfig.tsx`) with named presets
(`manifold/src/backends/presets.ts`). Audio gated via `engine.audio.setMuted` on non-synth modes.

**VCV module** — built: 8 inputs × 16 outputs, an LED ring per output (drawLayer + nvgArc), palette from the
frontend tokens, WS↔OSC bridge (browser VCV backend → `manifold/osc-bridge/` Deno relay → the module's OSC
server), bidirectional training over `/nisps/feedback`, and (P6, 2026-07-18) the core reunification onto
`nisps::ml::MLPCore<DynamicStorage>`. Authoritative module contract: `vcv-module.md`.

**Update 2026-07-21:** the earlier TODOs closed — `/nisps/feedback` browser-side wiring shipped
(`vcv-backend.ts` `sendFeedback`); the flow-field port shipped (`manifold/src/console/flow-field.ts` +
`ParticleStage`; `particle-backend.ts` is a deliberate no-op transport because the visualiser reads the spine
directly, and selecting it gates the synth audio); CV/gate shipped as the `cvgate` uSEQ Web Serial backend
(`manifold/src/backends/cv-backend.ts`, protocol spec `useq-cv-protocol.md`) rather than the §2.5 designs.
