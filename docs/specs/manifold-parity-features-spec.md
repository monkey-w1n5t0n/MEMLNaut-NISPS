---
kind: spec
stability: aspirational
layer: behavioural
---

# Manifold Parity Features — Session Presets · Pins · Jolt · OU-Explore · Control Surface

*Status: draft — awaiting review. Date: 2026-07-12.*
*Scope: prescriptive spec for porting five playground features into `manifold/`. Spec only — no
implementation is authorised by this document; break into ergo issues after sign-off.*

**Traces up to:** `playground-2.0-rewrite-plan.md` §2.3 (Feel drawer), §2.6 (pins), §3.8
(composed-layers presets); `engine-architecture.md` §3.2 (fanout, control-point tri-state), §3.8
(persist helper); `docs/specs/slp-workshop-firmware.md` §3–4 (Jolt / OU-explore, Part I shipped in
firmware); `dock-spec.md` (drawer depths, tri-state semantics); BUILD-PLAN locked decisions
(parity-tested engine; British spelling; the synth is "Powerful Synth Engine", never the forbidden
string).

**Reference implementations:** the playground versions are the behavioural ground truth for
constants and algorithms — `playground/src/features/session-preset.ts`,
`stores/session-store.ts` (pins), `ml/jolt.ts`, `output/ou-explore.ts`, `stores/control-store.ts` +
`features/control-routing.ts`. Where this spec and the playground disagree, this spec wins (each
divergence is called out and justified inline).

---

## 0. Principles applied throughout

1. **C++ owns gesture math where a C++ class exists.** `nisps::ml::Jolt` and
   `nisps::ml::OUNoise<N>` already exist (`nisps/ml/jolt.hpp`, `nisps/ml/ou_noise.hpp`) but are
   not exposed to WASM. Manifold binds them rather than re-porting to TS — this closes two
   documented `--- C++ GAP ---` items and buys deterministic, firmware-parity noise for free.
   (The playground's TS reimplementations used `Math.random()`; that shortcut is *not* carried
   over.)
2. **No new mechanisms where an existing one already expresses the idea.** Param pins are the
   existing `off|fixed|live` tri-state + arm mask, not a parallel pin system (§2.2).
3. **Transparent defaults.** Every default constant appears in this spec as a number with its
   source, and the control surface UI must *show* the derived per-param values live (§5.6) —
   the user should never wonder what an axis is secretly doing.
4. **One persistence pattern.** All new persisted state goes through a single versioned
   `persist<T>(key, version, migrate)` helper modelled on `settings-store.ts`
   (localStorage, debounced 200 ms), per `engine-architecture.md` §3.8.
5. **Probe parity.** Each feature activates its currently-inert `window.__nisps` methods
   (`manifold/src/debug/probe.ts`) so Playwright can drive it headlessly. New e2e specs are part
   of each feature's acceptance criteria.

---

## 1. Session presets (composed layers)

### 1.1 Model

Adopt the composed-layers model prescribed by `engine-architecture.md` §3.8 rather than the
playground's monolithic `SessionPresetPayload`. A preset is a bundle of independently optional
layers:

```ts
interface SessionPresetV1 {
  v: 1;
  id: string;                    // `preset-${epoch36}`
  name: string;
  createdAt: number;
  layers: {
    control?: ControlLayer;      // axes + offsets + presetId          (§5)
    pipelines?: PipelineLayer;   // input/output pipeline params
    routing?: RoutingLayer;      // per-output MFParam state/min/max/curve/mute + backend specs
    mode?: ModeLayer;            // modeId + outputMode
    weights?: string;            // base64url Float32Array — OPT-IN only
  };
}
```

- `ControlLayer` = `{ boldness, memory, precision, presetId, offsets }` exactly as §5.4 state.
- `PipelineLayer` = the configurable params of `engine/input-pipeline.ts` and
  `output-pipeline.ts` (deadzone, zoom, invert, curve, smoothing, momentum; global curve,
  smoothing, slew, freeze).
- `RoutingLayer` = serialised `MFParam[]` control fields + the per-backend specs already handled
  by the `OutputsBackendConfig` preset bar. The existing backend preset bar becomes a *view onto
  the routing layer* — one storage model, two entry points (see §1.4).
- `weights` uses the playground's base64url `Float32Array` codec verbatim
  (`session-preset.ts:63–98`): standard base64 with `+/` → `-_`, padding stripped; byte length
  rounded down to a 4-byte boundary on decode; size-mismatch on restore is silently skipped.

Restore is best-effort and layer-wise: absent layers leave current state untouched; unknown keys
inside a layer are ignored (forward compatibility).

### 1.2 Persistence

- Key: `mf-session`, via the shared `persist<T>` helper, version field `v: 1`, 200 ms debounce.
- Stored shape: `{ v: 1, presets: SessionPresetV1[], regionPins: RegionPin[] }` (pins ride in
  the same document, §2).
- Weights are **excluded by default** on save; the save UI offers an explicit
  "include network weights" toggle (default off). Rationale: weight blobs are ~KB-scale ×
  N presets and stale weights surprise users; matches playground `withWeights=false` default.

### 1.3 URL sharing

Carry over both playground URL forms (`session-preset.ts:249–283`):

- **Compact axis form** — `?boldness=0.5&memory=0.5&precision=0.3`: applies only the control
  layer; each value clamped to [0,1].
- **Full form** — `?session=<base64url(JSON of SessionPresetV1.layers)>`: applied on first load,
  after engine ready, before first render of the dock. Never include weights in a generated
  share URL (URL length); the share button produces the full form minus `weights`.

URL params are read once at boot in `App.tsx` (same place the `?debug=1` probe is installed) and
then stripped from the address bar via `history.replaceState` so a reload doesn't re-apply over
user changes.

### 1.4 UI

- **Save/restore/rename/delete** lives in a preset bar at the top of the **route drawer's
  expanded depth**, reusing the exact interaction pattern of
  `dock/OutputsBackendConfig.tsx` (save-as / restore / rename / delete). The existing
  backend-scoped preset bar remains; a session preset is the superset bundle.
- **Share** button beside the bar copies the URL to the clipboard and flashes confirmation.
- Restoring a preset that contains a `mode` layer while a different mode is active shows the
  same confirm modal used for net-reset (input-layer reshape) — mode switches discard training
  state and must not be silent.

### 1.5 Probe + acceptance

- Probe: `saveSessionPreset(name, withWeights?)`, `loadSessionPreset(id)`, `listSessionPresets()`,
  `buildShareUrl()`, `applySession(json)`.
- e2e: save → mutate axes/routing → restore → assert state round-trips; share URL → fresh page
  load with `?session=` → assert layers applied; weights round-trip when opted in
  (`getWeights()` equality within exact bits).

---

## 2. Region & param pins

### 2.1 Region pins

**Type (unchanged from playground `session-store.ts:34–44`):**

```ts
interface RegionPin {
  id: string;          // `pin-${epoch36}-${rand}`
  x: number; y: number;          // bottom-left corner, [0,1] input space
  width: number; height: number; // [0,1]
  colourSlot: number;  // 0..4 → --pin-1..--pin-5 tokens
  createdAt: number;
}
```

- **Cap: 5 pins, FIFO** (oldest evicted). Colour slot defaults to `pins.length % 5`.
- **Colour tokens** join `manifold/src/styles/tokens/colors.css` with the playground values:
  fills `--pin-1..5` at 0.25 alpha (orange `255,106,0` / cyan `0,204,255` / purple
  `180,100,255` / green `80,200,120` / tan `255,200,80`), borders same hues at 0.7 alpha,
  2 px logical border width.
- **Creation gesture:** long-press (600 ms — the constant Manifold.tsx already uses) on the
  Manifold stage pins the *currently visible region* (whole surface when unzoomed; the zoom
  window once input zoom exists in manifold — until then, `{x:0,y:0,w:1,h:1}` is not useful, so
  the long-press instead opens a small radial affordance: "pin region around cursor"
  creating a 0.25×0.25 region centred on the press point, clamped to [0,1]²).
  *Divergence from playground (which pins the zoom window) because manifold has no input zoom
  yet; revisit when the inputs workstream lands zoom.*
- **Removal:** tap a pin border → small popover with colour dot + "remove"; "clear pins" action
  in the settings drawer.
- **Rendering:** `Manifold.tsx` already accepts `pins: Pin[]` — extend the `Pin` type in
  `console/types.ts` to the full `RegionPin` shape (it currently has only `x/y/colour`), and
  render rects behind trail/markers, in front of the grid. Long-press must not fire when the
  press initiates a drag > 8 px (existing drag threshold logic) or while `picking` is true
  (explore-and-place anchor picking takes priority).
- **Persistence:** in the `mf-session` document (§1.2).
- **Semantics:** purely annotational in v1 (visual memory of "good areas"). They do **not**
  constrain training. A future spec may bind snapshot anchors to pins.

### 2.2 Param pins = the existing tri-state (decision, not new code)

The playground's separate `ParamPin` list + `paramPinMask()` is **not ported**. Manifold already
has a strictly more expressive mechanism, per `dock-spec.md` §3.3:

- `off` — excluded from model control *and* pinned out of training;
- `fixed` — held at a static value, pinned out of training;
- `live` — model-driven, trainable.

"Pinning a param" in manifold = setting it to `fixed` (hold current value) via the existing
`OutputControlRow` segmented control or by clicking the value readout in `OutputStage`.

**Gap this spec closes:** the tri-state must actually feed the training mask. Requirement: the
arm/focus mask sent through `_nisps_ml_feedback_set_focus` (and any `moveWeights`-style
perturbation mask) is computed as `armed ∧ (state === 'live')` — `off`/`fixed` columns are never
perturbed and never accumulate gradient. Owner: `dock/output-state.ts` `buildArmMask()`.

Probe: `pinParam(i)` / `unpinParam(i)` map to `setParam(i, {state:'fixed'|'live'})`; the inert
playground-compat methods in `probe.ts` are rewired to these.

Acceptance: e2e asserts (a) a `fixed` output's value is bit-stable across training and jolt;
(b) region pins survive reload; (c) 6th region pin evicts the 1st.

---

## 3. Jolt

### 3.1 What it is

A held-gesture weight morph: while held, N randomly-chosen weights each glide (EMA) toward their
own random target, re-rolling the target on arrival — a continuous, directional "stirring" of
the network. On release the net freezes where it landed, and the learning rate ramps back up
from 0 so training doesn't immediately fight the new position. Ported from upstream
`InterfaceRL`; C++ implementation shipped in firmware (SLP workshop Part I).

### 3.2 Binding, not porting

Expose the existing `nisps::ml::Jolt` through the C ABI. New bindings in
`nisps/wasm/bindings.cpp` + `scripts/build-wasm.sh` EXPORTED_FUNCS:

```
_nisps_ml_jolt_press(ml)          // picks indices+targets from the MLP's weight count
_nisps_ml_jolt_step(ml)           // one tick: mutates weights in place, then caller reprocesses
_nisps_ml_jolt_release(ml)
_nisps_ml_jolt_active(ml) -> i32
_nisps_ml_jolt_lr_scale(ml) -> f32   // 0 while held; ramps 0→1 after release
_nisps_ml_jolt_tick_lr_ramp(ml)
_nisps_ml_jolt_seed(ml, u64)
```

The Jolt instance lives beside the MLP handle inside the WASM module (one per net), seeded from
the session seed so runs are reproducible. Parity CI: extend `tests/cpp/parity_check.cpp` with a
golden jolt sequence (seed → press → k steps → weight vector) asserted native-vs-WASM.

### 3.3 Constants (defaults — from `nisps/ml/jolt.hpp:42–49`, upstream-verbatim)

| Constant | Value | Meaning |
|---|---|---|
| `num_weights` | 40 | weights morphed simultaneously (hard cap 64) |
| `morph_rate` | 0.017 | EMA per tick: `w += 0.017·(target − w)` |
| `target_min / max` | −1.2 / 0.9 | random target range |
| `target_epsilon` | 0.05 | re-roll target when within this distance |
| `lr_ramp_step` | 0.001 | post-release LR ramp per tick (~5 s at 200 Hz) |
| tick period | 5 ms (200 Hz) | `JOLT_TICK_MS`, matches firmware control rate |

### 3.4 Manifold integration

- **Driver:** a `setInterval(5 ms)` in `FeedbackController` while active: `jolt_step` →
  `engine.reprocess()` (the spine already re-ticks the last input after weight changes) → bump
  version. LR suppression: training calls multiply their LR by `jolt_lr_scale()`; the ramp is
  ticked from the same driver until it reaches 1.0.
- **Snapshot before press:** entering jolt pushes an auto-snapshot (tag `before jolt`) so undo
  recovers the pre-jolt net — same behaviour as playground `mode-runtime.ts:551`.
- **UI:** a press-and-hold **⚡ Jolt** button in the **learn drawer** (condensed depth, beside
  the VerdictCluster-adjacent controls) and keyboard hold `J`. Visual: the Manifold noise ring
  pulses while active. Pointer-cancel/blur must release (never a stuck jolt).
- **Interlocks:** disabled while `exploring` (explore-and-place owns the net during a scratchpad
  session); `off`/`fixed` outputs are unaffected by definition (§2.2 mask applies only to
  training — jolt perturbs *weights*, so v1 explicitly documents that jolt ignores per-output
  pins; a per-column jolt mask is out of scope).

### 3.5 Probe + acceptance

Probe: `joltPress()`, `joltRelease()`, `joltActive()`. e2e: press → 200 ms → assert outputs
changed and `getWeights()` differs; release → assert weights stable; undo restores pre-jolt
weights; determinism: same seed + same step count ⇒ identical weight vector twice.

---

## 4. OU-explore noise

### 4.1 What it is

Ornstein–Uhlenbeck drift added to the *output vector* (not the weights): each output channel
carries a state that takes small random steps while being pulled back toward zero, producing
smooth, temporally-correlated wander around whatever the net currently outputs. Learning stays
live throughout — it is an audition aid, not a training mode. C++ `OUNoise<N>` shipped in
firmware (SLP workshop Part I).

Discrete update per channel (Euler–Maruyama, μ = 0):

```
state += theta · (−state) · dt + noise_scale · N(0,1)
out    = clamp(out + state, 0, 1)
noise_scale = stationary_std · √(2·theta·dt),   stationary_std = intensity · 0.65
```

### 4.2 Binding

Instantiate `nisps::ml::OUNoise<126>` (the WASM output width) beside the MLP handle. Bindings:

```
_nisps_ml_ou_set_intensity(ml, f32)   // [0,1] → stationary_std = v·0.65; 0 disables
_nisps_ml_ou_intensity(ml) -> f32
_nisps_ml_ou_apply(ml, out_ptr, n)    // advance state + add + clamp, in place
_nisps_ml_ou_reset(ml)
_nisps_ml_ou_set_theta(ml, f32)  _nisps_ml_ou_set_dt(ml, f32)
_nisps_ml_ou_seed(ml, u64)
```

### 4.3 Constants (defaults — `nisps/ml/ou_noise.hpp`, upstream-verbatim)

| Constant | Value |
|---|---|
| `theta` (mean reversion) | 0.02 |
| `dt` | 0.001 |
| `kOUMaxAmplitude` (full-scale stationary std) | 0.65 |
| default intensity | 0 (**inert** — `apply()` is a no-op, preserving current behaviour/parity) |
| idle tick period | 30 ms (`EXPLORE_TICK_MS`) |

### 4.4 Manifold integration

- **Where in the chain:** in the spine, after the TS output-pipeline (curve→smoothing→slew→
  freeze) and before the backend send — i.e. `ou_apply` on the routed buffer. This matches the
  playground ordering (post-pipeline, pre-overrides). `fixed`/`off` outputs are re-asserted
  *after* `ou_apply` so pinned values do not wander (this is the §2.2 guarantee).
- **Idle ticking:** when intensity > 0 and no input events arrive, a 30 ms interval calls
  `reprocess()` so the wander is audible with a static joystick. Interval torn down and
  `ou_reset()` called when intensity returns to 0.
- **UI:** an **Explore** slider (0–1) in the **learn drawer** condensed depth, next to the
  existing Noise/Spread knobs; the Manifold noise ring radius reflects
  `noiseCap + ou_intensity·0.65` so the visual language stays truthful.
- **Interaction with Jolt:** independent and composable (jolt stirs weights, OU wanders
  outputs); both default inert.

### 4.5 Probe + acceptance

Probe: `setExploreIntensity(v)`, `getExploreIntensity()`. e2e: intensity 0.5 + static input ⇒
outputs vary over 500 ms with bounded step size; intensity 0 ⇒ outputs bit-stable; `fixed`
output does not wander; determinism under seeded runs.

---

## 5. Boldness / Memory / Precision control surface

### 5.1 Concept

Three compound axes, each a `[0,1]` fader that drives ~5–6 underlying parameters through a
piecewise-linear lookup table, with per-param trim-pot offsets on top. This is the "Feel"
surface from `playground-2.0-rewrite-plan.md` §2.3, ported with the playground's tables as the
**transparent defaults** — reproduced in full below so the mapping is reviewable here, not
buried in code.

### 5.2 Axis tables (defaults — `playground/src/stores/control-store.ts:38–54`, verbatim)

Numeric params interpolate linearly between breakpoints; discrete params snap to the upper row
at t ≥ 0.75.

**Boldness** — "how hard do moves hit"

| axis | zoom | noiseCap | noiseGrowth | learningRate | weightDecay | noiseDistribution |
|---|---|---|---|---|---|---|
| 0.0 | 0.1 | 0.02 | 1.1 | 0.1 | 0.15 | gaussian |
| 0.5 | 0.5 | 0.12 | 1.5 | 1.0 | 0.06 | gaussian |
| 1.0 | 1.0 | 0.30 | 2.5 | 3.0 | 0.00 | cauchy |

**Memory** — "how much does the net remember"

| axis | maxExamples | exampleDecay | memoryWeightDecay | noiseDecay | convergenceThreshold |
|---|---|---|---|---|---|
| 0.0 | 5 | 0.3 | 0.20 | 0.85 | 1e-3 |
| 0.5 | 50 | 0.7 | 0.06 | 0.97 | 1e-5 |
| 1.0 | 500 | 1.0 | 0.00 | 0.995 | 1e-8 |

**Precision** — "how surgical is the gesture"

| axis | inputCurve | deadzone | smoothing | slewRate | momentumZoom |
|---|---|---|---|---|---|
| 0.0 | 1.0 | 0.00 | 0.00 | 1.0 | off |
| 0.5 | 1.5 | 0.05 | 0.15 | 0.3 | off |
| 1.0 | 3.0 | 0.15 | 0.40 | 0.1 | off |

Routing targets in manifold: `zoom/deadzone/inputCurve/smoothing/momentumZoom` →
`engine/input-pipeline` config; `slewRate` → `engine/output-pipeline`; `noiseCap/noiseGrowth/
noiseDecay/learningRate/weightDecay` → `FeedbackController` + training params;
`maxExamples/exampleDecay/convergenceThreshold` → `engine/dataset.ts` + training loop.
`noiseDistribution` and `momentumZoom` are carried in the schema but may no-op until their
consumers exist in manifold (each no-op must be logged once at boot — no silent dead params).
`spread` is deliberately **not** axis-driven (stays an independent lab knob, as in playground).

### 5.3 Presets (defaults — verbatim)

| id | label | boldness | memory | precision |
|---|---|---|---|---|
| `default` | Default | 0.5 | 0.5 | 0.3 |
| `first-touch` | First Touch | 0.2 | 0.7 | 0.6 |
| `jazz-hands` | Jazz Hands | 0.8 | 0.2 | 0.0 |
| `sculptor` | Sculptor | 0.3 | 0.9 | 0.8 |
| `improviser` | Improviser | 0.6 | 0.3 | 0.2 |
| `microscope` | Microscope | 0.1 | 1.0 | 1.0 |

Boot default = the `default` preset (0.5 / 0.5 / 0.3). **This replaces ConsoleApp's current
ad-hoc `{0.55, 0.4, 0.5}` initial state.** Moving any axis manually clears `presetId` (chips
show "custom").

### 5.4 State + trim-pot offsets

```ts
interface ControlState {
  boldness: number; memory: number; precision: number;   // [0,1]
  offsets: Record<'boldness'|'memory'|'precision', Record<string, number>>;
  presetId: string | null;
}
```

Resolution: interpolate all three tables, merge, then add each axis's offsets to numeric params
(`resolved[k] = table[k] + offset[k]`), clamp to each param's legal range. Offsets are created
when the user adjusts a *derived* param directly (§5.6) — the delta from the current table value
becomes the offset ("trim-pot"). Double-tap on a derived param's readout clears its offset
("re-link"); a per-axis "re-link all" clears the axis's offset map. A dot marks any param with a
non-zero offset.

### 5.5 Fanout (architecture requirement)

Per `engine-architecture.md` §3.2: resolution is a memoised derivation per target param — in
React terms one `useMemo` producing the resolved record + an effect per target store that
writes only on change. The playground's `JSON.stringify`-signature-inside-effect pattern
(`control-routing.ts:34`) is explicitly **not** ported. Resolution runs off the render cycle for
engine targets (direct setter calls on the engine config objects), with React state only for
what the UI displays.

### 5.6 UI — transparency is the feature

- **Placement:** the **learn drawer** gains a top "Feel" section (this keeps manifold at five
  drawers; if the section crowds the condensed depth, promoting Feel to its own drawer is a
  pre-approved fallback — note it in the implementation PR).
  - *Condensed:* three vertical `ControlAxis` faders (the existing primitive, finally wired) +
    six preset chips.
  - *Expanded:* under each fader, the live list of its derived params — name, resolved value
    (table + offset), and a mini trim-pot. This satisfies the "reasonable and transparent
    defaults" requirement: the mapping is always visible in the UI, not just in this document.
- Axis moves are continuous (no apply button); param writes are rate-limited to one per frame.
- The existing `preset = 'Sculpt'` placeholder state in ConsoleApp is removed in favour of
  `presetId`.

### 5.7 Persistence, probe, acceptance

- Persisted as the `control` slice of `mf-session` (also the `control` layer of session
  presets, §1 — one shape, two containers).
- Probe: `setAxis(name, v)`, `getAxes()`, `resolveControlParams()`, `applyControlPreset(id)`,
  `setAxisOffset(axis, param, v)`.
- e2e: boldness 0→1 sweeps noiseCap 0.02→0.30 and zoom 0.1→1.0 (assert via
  `resolveControlParams()` + engine config readback); preset chip sets all three axes; manual
  axis move clears presetId; offset survives axis movement (offset is additive, not absolute);
  double-tap re-links; state round-trips through reload and through a session preset.

---

## 6. Cross-cutting

### 6.1 Build & sequencing (proposed ergo breakdown, post-sign-off)

1. **W1 — WASM bindings**: jolt + OU C ABI, EXPORTED_FUNCS, parity golden tests. (Blocks W4, W5.)
2. **W2 — `persist<T>` helper + `mf-session` document** (control slice, pins, presets scaffold).
3. **W3 — Control surface**: state, tables, fanout, Feel section, presets, offsets. (Needs W2.)
4. **W4 — Jolt + OU in FeedbackController + learn drawer UI.** (Needs W1.)
5. **W5 — Region pins** (tokens, gesture, rendering, popover) + tri-state training-mask
   guarantee (§2.2). (Needs W2.)
6. **W6 — Session presets**: layers, preset bar, URL sharing, probe. (Needs W2, W3.)

Each lands with its e2e spec; smoke suite additions run in the same CI gate as the existing
`tests/e2e/smoke.spec.ts`.

### 6.2 Out of scope (explicit)

- Snapshot-with-weights / snapshot DAG, A/B compare (separate spec — the biggest remaining
  parity gap, but architecturally entangled with the C++ feedback snapshot lifecycle).
- 2D heatmap sampler, weight health, gradient flow (blocked on loss-history C API plumbing).
- Input zoom (inputs workstream) — noted where it interacts with region pins (§2.1).
- Per-column jolt masking (§3.4).

### 6.3 Open questions for review

1. §2.1 creation gesture: is the 0.25×0.25 press-centred region an acceptable stand-in until
   input zoom lands, or should region pins wait for the zoom feature?
2. §5.6: Feel section inside the learn drawer vs a sixth drawer — reviewer's call if condensed
   depth gets crowded.
3. §1.1 RoutingLayer: should backend connection details (OSC URL, MIDI port id) be included in
   session presets, or excluded as machine-specific? Proposal: exclude port/URL, include
   per-output mappings.
4. Memory-axis params (`maxExamples`, `exampleDecay`, `convergenceThreshold`): confirm the
   manifold training loop actually consumes these; if any are dead in the current engine, they
   land as logged no-ops (§5.2) with an ergo follow-up.

---

*Doc-sync rule applies: when implementation diverges from this spec, update the spec in the same
commit. When a workstream ships and is verified, migrate its section to ONBOARDING.md ("what
is") and prune it here.*
