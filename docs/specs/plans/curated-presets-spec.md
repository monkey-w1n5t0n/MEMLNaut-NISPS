---
kind: plan
status: active
---

# Curated Presets, the Instrument Library, and Per-Surface Disclosure

*Dated 2026-07-21. The spec for `simplification-plan.md` §6.5c ("5c Curated/advanced split",
audit findings A3 + A7, `ALIGNMENT.md` defect 2). **Proposal only — no code is authorised until the
operator adopts it.** Every code claim below was read out of the tree on 2026-07-21 and is cited
with `file:line`; where a repo document disagrees with the code, the code is recorded as the truth
and the disagreement is called out in §1.6. British spelling in product copy. The built-in synth is
"Powerful Synth Engine" / "Built-in Synth" — the string "C15" must never reach the UI.*

**Reading order for an implementer:** §1 (ground truth) → §2 (product model) → §3–§6 (design) →
§9 (sequenced plan). §7 is the invariant list to check work against; §11 is what the operator still
has to decide.

---

## 0. Scope, and what this supersedes

**In scope** (one item, three limbs that only make sense together):

1. A **preset data model** — what a curated preset is as data, where it is stored, how it is
   validated against schema truth, and how it is applied.
2. The **Instrument Library** — the missing in-UI instrument picker, built as a preset browser
   (choosing a preset is how you choose an instrument).
3. **Progressive disclosure** via per-surface depth *levels*, replacing the accidental use of the
   drawer geometry toggle as the advanced flag.

**Out of scope, deliberately:**

- Browser mode-coverage honesty / audio topology (`simplification-plan.md` §6.5b, spec'd in
  `plans/browser-mode-coverage-spec.md`). The Library renders whatever signal 5b produces; it does
  not invent one. **That spec's §0 calls itself a prerequisite of this item, and it is right** — the
  picker is what makes the latent dishonesty visible. Sequencing recommendation: land 5b before §9
  step 6. If it has not, the Library lists every catalogue entry with no viability claim (§5.4) —
  honest by omission rather than wrong, but a worse first impression.
- The mode-layer reunification (§6.5a) and the hardware editor (§6.5d). Presets are browser-local
  data in this item; §11.Q4 records the promotion path if they later have to reach firmware.
- Region/param pins and the "control surface" (boldness/memory/precision) of
  `manifold-parity-features-spec.md` §2 and §5. Neither is implemented, neither is needed here.

**Supersedes** `plans/manifold-parity-features-spec.md` §1 ("Session presets (composed layers)").
That section has **no code consumer** — nothing under `manifold/src/` implements or references it
(verified: no `SessionPresetV1`, no `mf-session` key, no `persist<T>` helper in the tree). Its
composed-layer idea survives here in reduced form; three of its specifics do not, and the
divergences are explicit:

| §1 of manifold-parity-features-spec | Disposition here |
|---|---|
| `layers.weights?: string` (base64url Float32Array, opt-in) | **Deleted.** Contradicts the operator's §7.6 decision that a curated preset is configuration only, network untrained (§2.1). |
| `PipelineLayer` = params of `engine/input-pipeline.ts` / `output-pipeline.ts` | **Deleted as written** — both files were deleted at one-core-engine P4; the config now lives in `manifold/src/engine/pipeline-types.ts` and has **zero UI writers** (§1.5). Nothing can author it, so a preset cannot meaningfully carry it yet. |
| `ControlLayer` = `{ boldness, memory, precision, presetId, offsets }` | **Deferred** — the control surface (§5 of that spec) is unimplemented and out of scope. |
| URL sharing (`?session=`, `?boldness=`) | **Deferred** to §11.Q5; the model is designed not to preclude it. |

On adoption, `manifold-parity-features-spec.md`'s status block gains a line pointing §1 here. That
edit belongs to whoever lands step 3 of §9, not to this document.

---

## 1. Ground truth (read out of the tree, 2026-07-21)

### 1.1 There is no instrument picker, and the active instrument is invisible

- The instrument mode is a plain `useState` in the console spine:
  `manifold/src/console/ConsoleApp.tsx:99` — `const [modeId, setModeId] = useState('paf_synth')`.
- `ConsoleCtx` carries `modes: MFMode[]` and `setModeId` (`manifold/src/console/types.ts:64-66`),
  populated at `ConsoleApp.tsx:735-737`. **Neither has a single reader.** `grep -rn "ctx.modes|ctx.setModeId" manifold/src`
  returns only the comment at `ConsoleApp.tsx:326` that says so.
- The only place the active instrument's name is rendered anywhere in the app is one sentence of
  explanatory prose — `Drawers.tsx:566`, `The active engine follows the selected mode ({ctx.mode.label})` —
  which is itself gated behind `depth === 'expanded'` *and* the synth output target. In the default
  session (particles target, condensed drawers) the user cannot discover which instrument is loaded.
- `MFMode.glyph`, `MFMode.cls`, `MFMode.placeholder`, `MFMode.badge`
  (`manifold/src/console/model.ts:136-160`) have **zero consumers**. They are display fields
  maintained for a renderer that does not exist. The Library is their first consumer, or they should
  be deleted; see §8.4.
- Mode switching today happens only through the `?debug=1` seam
  (`ConsoleApp.tsx:331-345`, `window.__mf.setMode/getModeId/paramCount/modeIds`), which
  `manifold/tests/e2e/schema-modes.spec.ts` drives. **That seam must survive** (§7.8).

### 1.2 Mode switching itself works, and reshapes the net

Three effects fire on a `modeId` change, in declaration order:

| Effect | Lines | Does |
|---|---|---|
| audio backend | `ConsoleApp.tsx:241-243` | `engine.audio.setBackend(modeEngineId(modeId))` |
| net reshape | `ConsoleApp.tsx:252-257` | `engine.reshape(mode.ml)` — schema dims, warm-started |
| transient reset | `ConsoleApp.tsx:260-271` | rebuilds `params` from the mode, recentres input, clears examples/pins/markers, closes drawers |

`engine.reshape` (`engine-api.ts:323` → `wasm-iml.ts:355` → `nisps_ml_reshape`,
`nisps/wasm/bindings.cpp:397`) constructs a fresh `MLPCore` at the new dims and swaps it in.
Because the dataset lives **inside** `MLPCore` (`nisps/ml/mlp.hpp:143`, `:441`, `:443`), a reshape
destroys every stored example; `wasm-iml.ts:431` clears the TS mirror to match. This is the single
most important fact for preset application ordering — see §4.2.

### 1.3 The only preset machinery is per-backend output routing

`manifold/src/backends/presets.ts` (162 lines) is real, consumed, and narrow:

- `OutputPreset` = `{ name, backend, rows: OutputPresetRow[], settings?, savedAt }` (`:16-37`).
- Storage is localStorage, **namespaced per backend**: `manifold-output-presets:<backend>` (`:38-41`).
- `OutputPresetRow` (`:16-29`) captures `name, status, muted, armed, min, max, curve, val, midi, osc, vcv`.
- The sole UI is `PresetBar` in `manifold/src/dock/OutputsBackendConfig.tsx:99-208`, rendered from
  `:686`, itself gated behind `depth === 'expanded'` in `Drawers.tsx:634`.
- `PresetBar.backendSettings()` (`OutputsBackendConfig.tsx:113-118`) persists MIDI port/ccCount, OSC
  url/sendRaw, VCV url/sendRaw — and `{}` for everything else.

**The `cv` bug is confirmed and is worse than "a missing field".** `MFParam.cv` (`model.ts:133`,
`{ channel, gateThreshold }`) is live state: `useBackendManager.ts:161` reads `p.cv` per output to
build the uSEQ channel map, and `CvConfig` (`OutputsBackendConfig.tsx:590`) edits it. But
`OutputPresetRow` has no `cv` (`presets.ts:16-29`), `rowsFromParams` does not copy it (`:72-86`),
and `applyPreset` does not restore it (`:141-162`). Saving a preset for the `cvgate` backend
therefore silently discards **the entire channel assignment**, which is the only thing a CV preset
is for. Fix = three one-line additions (§9 step 1), exactly as the audit said.

### 1.4 Two different things are called "Mode", and one backend is unreachable

- **Instrument mode**: `MF_MODES` / `modeId`, schema-backed (`model.ts:316`).
- **Output mode**: `OutputMode` (`types.ts:26`) / `OUTPUT_MODES` (`console/output-mode.ts:33-73`),
  which is what the dock's top button is labelled — `Dock.tsx:126` renders the header
  `Mode · output target`.

Adding an instrument picker beside a control already called "Mode" is a naming collision the design
has to resolve (§2.2).

Also observed, and not recorded anywhere: **`BackendId` includes `'vcv'`
(`dock/output-state.ts:31`) but no `OutputModeDescriptor` maps to it** (`output-mode.ts:33-73`
lists particles/midi/osc/cv/synth/editor). `outputBackend` is derived solely from the selected
output mode (`ConsoleApp.tsx:137`), so the VCV backend — `vcv-backend.ts`, 240 lines, registered at
`backends/manager.ts:68`, with its own config panel at `OutputsBackendConfig.tsx:691` — **cannot be
selected from the UI at all.** That is out of this item's scope to fix, but the Library work will
put the output-target list in front of the operator, so it should be reported rather than quietly
inherited.

### 1.5 What state a preset could capture, and what nothing can author

| Candidate state | Where it lives | Authorable in the UI today? |
|---|---|---|
| instrument mode id | `ConsoleApp.tsx:99` | only via `?debug=1` |
| output target | `ConsoleApp.tsx:136` | yes (dock top button) |
| per-output routing (`MFParam` status/muted/armed/min/max/curve/val + midi/osc/vcv/cv) | `ConsoleApp` `params` store; `OutputControlRow` | yes |
| backend settings (MIDI port + CC count, OSC/VCV url + sendRaw) | `ConsoleApp` state, `ConsoleCtx` | yes |
| input source + gamepad stick mode + MIDI learn bindings | `inputs/useInputLayer.ts:113-120` | yes |
| feedback mode, solo mode, explore intensity, noise cap, Xavier spread | `ConsoleApp.tsx:104-133` | yes |
| **input/output pipeline config** (zoom, deadzone, curve, smoothing, slew, freeze) | `engine/pipeline-types.ts` | **no** — `grep` for `setInputConfig|setOutputConfig|defaultInputConfig` outside `src/engine/` finds only `tests/`. There is no UI writer. |
| **voice space** | `nisps/modes/base.hpp:279-291` | **no** — there is no `nisps_*_voice_space` export in `nisps/wasm/bindings.cpp`, and the worklet reaches the audio engine through raw WASM exports (`worklet/nisps-processor.ts:33-36`), so exposing it means walking the full export chain twice. See §11.Q3. |
| network weights | `wasm-iml.ts` | yes (`randomise`, training) — **deliberately excluded**, §2.1 |

Schema fields `ui.show_voice_space_selector` and `ui.show_synth_visualizer` exist in every mode
schema (e.g. `schemas/modes/paf_synth.json`) and reach TS as `UIConfig`
(`manifold/src/modes/generated/types.ts:52-56`) but have **no consumer on either target**.

### 1.6 Where documents disagree with the code

Recorded here so the next session does not re-derive them. None of these are this item's job to fix
except where §8/§9 says so.

1. **`ONBOARDING.md` §4** says `OUTPUT_MODES` = "particles (default) / midi / osc / synth / editor" —
   five. The code has six; `cv` (uSEQ CV/gate) is missing from the doc. `output-mode.ts:32`'s own
   comment ("The five Modes") is wrong the same way, one line above a six-element array.
2. **`model.ts` overlay vs schema — a live dual truth with real drift.** `ModeOverlay.input`
   (`model.ts:211-216`) is hand-written per mode (`:229-247`) while every schema already declares
   `ui.primary_input` (`manifold/src/modes/generated/types.ts:52-56`). They agree for eight of nine
   modes and **disagree for `breakor`**: the schema
   says `xy_pad`, the overlay says `joystick` (`model.ts:235`). The overlay wins today, and it is
   the input to `resolveInputMap(settings.inputMap, mode.input)` (`ConsoleApp.tsx:814`), so Breakor
   renders a circular joystick surface where its schema asks for a rectangular pad. Single consumer,
   five-line fix (§9 step 2).
3. **`dock-spec.md` §0** prescribes three depths (`peek | expand | FULL`) as **per-drawer** state.
   Two shipped, and they are **one global state** shared by all five drawers
   (`ConsoleApp.tsx:110`), reset to `condensed` on every drawer switch (`Dock.tsx:204`) and every
   mode switch (`ConsoleApp.tsx:268`). Its own 2026-07-21 grounding note already records the
   two-depth divergence; the *global-not-per-drawer* part is not recorded anywhere.
4. **`manifold-parity-features-spec.md` §1.1** describes a `PipelineLayer` over
   `engine/input-pipeline.ts` and `output-pipeline.ts`. Both files were deleted at P4.
5. `simplification-plan.md` §7.6 still lists the curated-preset product model as an *open* operator
   decision. The operator has since decided it (§2.1). Reconciling the plan document is the
   orchestrator's, not this spec's.

---

## 2. The product model

### 2.1 What a curated preset is (operator decision, §7.6)

> **A curated preset is configuration only: mode + parameters + routing, with the network
> UNTRAINED — though it may sometimes ship seed training data.**

Consequences taken as binding:

- **A preset never carries weights.** Not optionally, not opt-in. The type has no weights field
  (§3.1) and the apply routine never calls `setWeights`. This is testable — see §7.1.
- **A preset may carry seed examples**: `(input vector, output vector)` pairs at the mode's schema
  arity. Loading them puts them in the dataset; it does **not** train (§4.4).
- Therefore applying a preset is *deterministic and cheap*: it reshapes the net to the mode's schema
  dims (which mode switching already does) and writes UI/routing state. The sound you get is the
  untrained net through the preset's routing — the preset defines the *instrument and the mapping
  space*, and the user teaches it.

### 2.2 Naming: Instrument vs Output

To end the collision in §1.4, product copy uses two words and never the word "Mode":

| Concept | UI label | Code |
|---|---|---|
| which instrument/mode is loaded | **Instrument** | `modeId`, `MF_MODES` (unchanged — `mode_id` is schema truth) |
| where the outputs go | **Output** | `OutputMode` → renamed `OutputTarget` (§8.3) |

`Dock.tsx:126`'s `Mode · output target` header becomes `Output`. This is copy plus a mechanical
type rename; it changes no behaviour and is typecheck-verified.

### 2.3 The Library is the picker

There is no separate "instrument picker" and "preset browser". One surface — the **Library** —
lists curated presets grouped by instrument; choosing one selects its instrument. Below the presets,
at the advanced level, sits the bare instrument list (load an instrument with no preset). This is
one surface instead of two, and it makes the curated path the default path structurally rather than
by exhortation, which is what vision bullet 3 asks for.

---

## 3. Data model

### 3.1 Types

New module `manifold/src/presets/types.ts` — types + pure validation only, no React, no storage:

```ts
import type { ParamStatus } from '../console/model';
import type { OutputTarget } from '../console/types';
import type { CvSpec, MidiCcSpec, OscSpec, VcvSpec } from '../dock/output-state';

/** One output's deviation from the mode default. `i` indexes the mode's schema params. */
export interface OutputOverride {
  i: number;
  /** Display name override (MIDI/OSC outputs get renamed by users). */
  label?: string;
  status?: ParamStatus;
  muted?: boolean;
  armed?: boolean;
  min?: number;
  max?: number;
  curve?: number;
  /** Held value; only meaningful when status === 'fixed'. */
  val?: number;
  midi?: MidiCcSpec;
  osc?: OscSpec;
  vcv?: VcvSpec;
  cv?: CvSpec;
}

export interface PresetRouting {
  /** Status for every output NOT named in `outputs`. Omit to leave mode defaults alone. */
  rest?: ParamStatus;
  outputs: OutputOverride[];
}

export interface PresetInputs {
  mode: 'internal' | 'gamepad' | 'midi';
  gamepadStickMode?: 'single' | 'double';
}

export interface PresetLearning {
  feedbackMode?: 'explore-and-place' | 'geometric-dislike';
  exploreIntensity?: number;
  noiseCap?: number;
  spread?: boolean;
}

/** Seed examples, at the mode's schema arity. Validated in `validatePreset`. */
export interface PresetSeed {
  inputs: number[][];   // each length === schema.ml.input_size
  outputs: number[][];  // each length === schema.ml.output_size
}

export interface Preset {
  v: 1;
  id: string;                 // slug, e.g. 'paf-synth/glass-formants'
  name: string;
  /** Optional one-line description shown in the Library. */
  blurb?: string;
  modeId: string;             // MUST be an MF_MODES id
  target: OutputTarget;
  routing?: PresetRouting;
  backendSettings?: Record<string, unknown>;  // same blob shape PresetBar already writes
  inputs?: PresetInputs;
  learning?: PresetLearning;
  seed?: PresetSeed;
  origin: 'builtin' | 'user';
  savedAt?: number;           // user presets only
}
```

**There is no `weights` field, by design.** A reviewer should treat any future addition of one as a
reversal of §2.1 requiring the operator.

Rationale for the choices that are not obvious:

- **`OutputOverride` carries its own index and layers are optional**, so a hand-authored curated
  preset for a 56-output mode is a dozen lines, not 56 rows of boilerplate. Index (not name) is
  canonical because `MFParam.name` is user-editable for MIDI/OSC (`presets.ts:147-149`) while the schema
  param order is stable codegen output.
- **`rest`** lets a curated preset say "these six outputs are live; everything else is off" in one
  field — which is what curation mostly *is*.
- **Backend settings stay an untyped blob**, matching `OutputPreset.settings`
  (`presets.ts:35`) and the writer/reader pair at `OutputsBackendConfig.tsx:113-131`. Typing it
  properly is a separate, larger job with no consumer asking for it.
- **The layer types are `Preset`-prefixed** because `InputLayer` is already taken: it is the input
  composition hub class in `manifold/src/inputs/input-layer.ts`. Do not reuse the name.

### 3.2 Storage

- **Built-in (curated) presets**: TypeScript data modules, `manifold/src/presets/builtin/<mode_id>.ts`,
  re-exported from `builtin/index.ts` as `BUILTIN_PRESETS: readonly Preset[]`. Typed, typechecked,
  tree-shaken, no build step, no codegen.

  *Why not `schemas/` + codegen?* Codegen exists to keep firmware and browser honest about a shared
  contract. Presets have no firmware consumer today (firmware modes are compile-time
  `-DMEMLNAUT_MODE_TYPE` selections with no on-device persistence — `ALIGNMENT.md` defect 3).
  Adding a C++ emitter for data nothing in C++ reads would be complexity without a requirement.
  **Removal condition:** when §6.5d (hardware editor) gives firmware a command surface and
  persistence, promote presets to `schemas/presets/*.json` + codegen with both outputs in the same
  change, per the standing schema rule.

- **User presets**: one localStorage document, key `mf-presets`, shape
  `{ v: 1, presets: Preset[], lastAppliedId?: string }`, written through a store modelled on
  `settings/settings-store.ts` (framework-neutral class + `useSyncExternalStore` hook + module-level
  singleton). No new persistence mechanism.

- The per-backend namespaces `manifold-output-presets:<backend>` are **retired** (§8.1). See §11.Q1
  — deleting them discards any presets the operator saved in the live app.

### 3.3 Validation against schema truth

`validatePreset(p, schemas): string[]` in `presets/types.ts`, pure, returns human-readable problems:

- `modeId` resolves in `MF_MODES`.
- every `OutputOverride.i` is `< schema.params.length`.
- `min <= max`, all of `min/max/curve/val` within `[0,1]` (the routing-knob space — `MFParam`'s
  `min/max/curve/val` are 0..1 routing semantics; schema engine units live in the `schema*` fields,
  `model.ts:107-121`).
- `seed.inputs[k].length === schema.ml.input_size`, `seed.outputs[k].length === schema.ml.output_size`,
  `inputs.length === outputs.length`, and `inputs.length <= 128` — the shared dataset capacity
  (`nisps::ml::kDefaultMaxExamples`, `nisps/ml/storage.hpp:57`, mirrored at `wasm-iml.ts:52` and
  reported through `nisps_ml_describe`, `bindings.cpp:926`).
- `target` resolves in `OUTPUT_TARGETS`.

A unit test runs `validatePreset` over every entry of `BUILTIN_PRESETS` (§9 step 4). This is the
mechanism that stops curated data rotting when a schema changes — the failure is a red `bun test`,
not a silent misbehaviour.

---

## 4. Applying a preset

### 4.1 One imperative entry point, not an effect chain

`manifold/src/presets/apply.ts` exports:

```ts
export interface PresetApplier {
  engine: EngineApi;
  selectInstrument(modeId: string): void;   // reshape + rebuild params + reset transients
  setParams(next: MFParam[]): void;
  setTarget(t: OutputTarget): void;
  setBackendSettings(s: Record<string, unknown> | undefined): void;
  setInputs(l: PresetInputs | undefined): void;
  setLearning(l: PresetLearning | undefined): void;
}

export function applyPreset(a: PresetApplier, p: Preset): void;
```

`ConsoleApp` provides the applier; the sequencing logic lives in `apply.ts` where it can be unit
tested against a fake applier. `ConsoleApp.tsx` is already 1082 lines — this must not add to it.

### 4.2 The ordering invariant (the thing that will silently break)

`engine.reshape` destroys the dataset (§1.2). Today the reshape happens in an **effect**
(`ConsoleApp.tsx:252-257`), which runs *after* the event handler that changed `modeId`. So the naive
implementation — "handler sets modeId, then adds seed examples" — loads the seeds and then has them
wiped by the effect one tick later, silently, with a dataset counter that briefly reads right.

**Fix, and it is a simplification rather than a workaround:** collapse the three mode-switch effects
(`ConsoleApp.tsx:241-243`, `:252-257`, `:260-271`) into one imperative `selectInstrument(modeId)`
function that does, in order: `engine.audio.setBackend` → `engine.reshape` → rebuild `params` from
the mode → reset transients → `setModeId`. Keep exactly one effect, keyed on `[engine]`, that calls
`selectInstrument(modeId)` once when WASM becomes ready (the boot path the current effects rely on).
`applyPreset` then runs entirely inside one handler, in a guaranteed order, with no implicit
cross-effect contract.

`window.__mf.setMode` (`ConsoleApp.tsx:336`) repoints to `selectInstrument`.

**This is a refactor of live behaviour and must be verified as one** — see §9 step 3.

### 4.3 Apply order

1. `selectInstrument(p.modeId)` — reshape lands here, dataset is now empty.
2. `setTarget(p.target)`; `setBackendSettings(p.backendSettings)`.
3. Build the params array: start from the mode's schema defaults (what step 1 produced), apply
   `routing.rest` to every output, then apply each `OutputOverride` by index. One `setParams`.
4. `setInputs(p.inputs)`, `setLearning(p.learning)`.
5. If `p.seed`: `engine.addExample(inputs[k], outputs[k])` for each pair. **No training.**
6. Record `lastAppliedId`.

Steps 3–5 must not be reordered: 5 after 1 (else wiped), 3 after 1 (else overwritten by the mode
rebuild).

### 4.4 Seeds are loaded, not trained

After apply, the Learning drawer shows `N examples` (its existing chip, `Drawers.tsx:219`, fed
by `ctx.datasetCount`), and the user trains or gives verdicts. Nothing auto-trains, because §2.1
says the network ships untrained and auto-training would make that false. §11.Q2 records the
alternative if the operator wants a preset to be able to opt into one training pass.

---

## 5. The Library (the picker)

### 5.1 Placement

A second pinned control at the top of the dock rail (`Dock.tsx:405`), **above** the existing output
selector, rendering the active instrument's glyph and opening a popover — the same interaction and
the same visual language as `ModeSelector` (`Dock.tsx:64-174`), which becomes `OutputSelector`. Two
labelled controls, top of rail: **Instrument**, **Output**.

Rejected alternatives, briefly: a sixth drawer (a preset browser is a chooser, not a workbench, and
drawers are mutually exclusive with the surface you are auditioning against); a stage-header title
bar (the stages are full-bleed by design and CompositeStage owns its own chrome).

### 5.2 Contents

At **basic** level:

- Curated presets, grouped by instrument, each row: preset name, instrument label + glyph, `blurb`.
- The active preset marked; applying another switches instrument as a side effect.
- A "seeds" chip on presets that carry `seed`, showing the example count — so the difference between
  "config only" and "config + seeds" is visible before you commit to it, not after.

At **advanced** level, additionally:

- **Instruments** — the bare `MF_MODES` list (`ctx.modes`, finally consumed), each entry loading the
  instrument with no preset. This is the authoring entry point: load a bare instrument, configure,
  save as a user preset.
- **Save current as preset** / rename / delete for user presets, reusing `PresetBar`'s interaction
  pattern (`OutputsBackendConfig.tsx:99-208`) rather than inventing a second one.

### 5.3 Applying is not silent

Applying a preset switches instrument, which resets the dataset and the net. Today that is already
true of a mode switch and is done without confirmation ("switching instrument is already a
deliberate act", `ConsoleApp.tsx:250`). Keep that: **no modal** — but the Library rows carry a
persistent one-line warning ("loading resets examples and the network") and, when
`ctx.datasetCount > 0`, the row click routes through the existing `ReshapeModal` pattern
(`console/ReshapeModal.tsx`) with preset-specific copy. Losing 40 hand-taught examples to a
mis-click is the failure this prevents; losing an untouched default session is not worth a modal.
The condition is deliberately `datasetCount` alone — "unsaved routing edits" would need a
dirty-tracking mechanism the app does not have and this item does not justify building.

### 5.4 Viability signalling

The Library renders `MFMode.badge` when present (`model.ts:158`) and disables entries with
`placeholder: true` (`:157`) — both fields exist and neither has a consumer today (§1.1). If §8.5
lands, `c15` is the only `placeholder: true` entry and the disable path becomes
dormant-but-correct; keep it, it costs one line.

The Library does **not** invent a viability model. `plans/browser-mode-coverage-spec.md` §2.3
proposes exactly the right shape — a pure `modeSupport(schema.audio, host)` returning
`{ ok: true } | { ok: false; reason; detail }`, computed from declared per-mode audio topology and
declared host capabilities rather than a hand-maintained flag — and the Library should render that
result verbatim: a chip carrying `detail`, the row disabled when `ok` is false. If 5b has not
landed, entries render unmarked. **Do not add a topology map to `model.ts` in the meantime** — that
is precisely the seventh hand-maintained mode registry Phase 3 spent two days eliminating, and 5b
rejects it by name.

### 5.5 Boot

Boot applies `lastAppliedId` if it resolves, else `DEFAULT_PRESET_ID`.

**`DEFAULT_PRESET_ID` must be a `paf_synth` preset.** The e2e suite clears localStorage before every
run (`tests/e2e/helpers.ts:31-41`), so boot always takes the default path, and `ONBOARDING.md` §5
plus several tests pin the boot shape at `4→[10,10,14]→33`, weights 809. Choosing a default on any
other instrument silently changes the boot contract several tests assert. If a different default is
wanted, the boot-shape claims in `ONBOARDING.md` and the affected specs move in the same change.

---

## 6. Progressive disclosure: per-surface levels

### 6.1 What `depth` actually is today

`DrawerDepth = 'condensed' | 'expanded'` (`types.ts:38`) is **one global state**
(`ConsoleApp.tsx:110`) that simultaneously controls panel geometry (360px side panel vs 80vw×80vh
centred modal, `Dock.tsx:265-299`) and content disclosure. §6.5e adopted `expanded` as "the
advanced-surface flag" for the training-health panel, and `ONBOARDING.md` now documents that as the
rule.

It is not a rule; it is an accident. Classifying every gate in `Drawers.tsx`:

| Site | Content | What the gate is really for |
|---|---|---|
| `:171` | feedback-mode explanation | **prose** |
| `:208` | explore/Jolt explanation | **prose** |
| `:229` | solo/arm scope, solo behaviour, noise-cap slider | **advanced** |
| `:254` | feedback lab, Xavier switch, `<TrainingHealth/>` | **advanced** |
| `:396` | active input source's status message | **status — should never have been hidden** |
| `:403` | internal-pad explanation | **prose** |
| `:410` | gamepad stick mode + button legend | **function** — you cannot pick one/two sticks without opening a modal |
| `:441` | MIDI device picker + MIDI-Learn | **function** — same |
| `:523` | dedicated-dimensions explanation | **prose** |
| `:564`, `:583`, `:592`, `:598` | per-target explanations | **prose** |
| `:620-621` | rows sliced to 6 when condensed | **geometry** |
| `:634` | `<OutputsBackendConfig/>` (CC table, CV channel map, preset bar) | **function + geometry** |
| `:641` | row list max-height 460 vs 220 | **geometry** |
| `:654` | `showCurve` on each row | **geometry** |
| `:659` | "+N more — expand to edit" | **geometry** |
| `:691` | unfocused icon colour + preview | **advanced (cosmetic detail)** |
| `:720`, `:737` | settings explanations | **prose** |

Three of twenty-one gates are genuinely about expertise. The rest are geometry, prose, or — in three
cases — real functionality hidden by a size switch. Using this as the advanced flag means the
advanced surface and the big-panel surface can never diverge, and it means beginners' explanatory
prose is hidden from beginners, which is exactly backwards.

### 6.2 The split

Two orthogonal axes, one existing mechanism each:

- **`presentation: 'panel' | 'modal'`** — today's geometry toggle, renamed. Per-drawer, transient,
  driven by the ⤢ tab (`Dock.tsx:302-328`) and `\` (`ConsoleApp.tsx:642`). Behaviour unchanged.
- **`level: 'basic' | 'advanced'`** — the disclosure axis. **Per surface, persisted** in the existing
  settings document (`settings-store.ts`, key `mf-settings`) as
  `levels: Record<DrawerKey | 'library', DrawerLevel>`. No new store, no new persistence pattern,
  no global boolean. The Library is a surface with a level for the same reason the drawers are, so
  §5.2's advanced tier needs no second mechanism.

Two levels, not `dock-spec.md` §0's three: there is exactly one advanced tier of content to put
anywhere, and inventing a third empty level is the kind of speculative structure this repo has been
deleting all week. `dock-spec.md` §0's `peek` maps onto nothing that shipped.

Control: a small `basic | advanced` segmented toggle in each drawer's header
(`Dock.tsx:355-368`), beside the existing depth label at `:364` — which currently renders the
literal string `condensed`/`expanded` and becomes the presentation state's label.

### 6.3 Re-gating, item by item

Applying §6.1's classification:

- **advanced** (`:229`, `:254`, `:691`): gate on `level === 'advanced'`. `<TrainingHealth/>` keeps
  its advanced gating — the §6.5e decision survives intact, only its mechanism changes.
- **function** (`:410`, `:441`, `:634`): ungate. Configuring your gamepad or your CV channel map is
  not advanced and must not require a modal. They stay in whatever presentation the drawer is in.
- **status** (`:396`): ungate.
- **geometry** (`:620-621`, `:641`, `:654`, `:659`): gate on `presentation === 'modal'`. Unchanged
  behaviour, renamed condition.
- **prose** (`:171`, `:208`, `:403`, `:523`, `:564`, `:583`, `:592`, `:598`, `:720`, `:737`):
  gate on `level === 'basic'` — *shown* to beginners, *hidden* from the advanced surface, which is
  the inversion of today. This is a judgement call, not a derivation; §12.3 records it as mine and
  the cheap fallback (always show) if the operator disagrees.

### 6.4 Level does not reset

`depth` is reset to `condensed` on every drawer switch (`Dock.tsx:204`) and every mode switch
(`ConsoleApp.tsx:268`). `presentation` keeps that behaviour. `level` **must not** reset — a persisted
stance that resets when you change instrument is not a stance. This is the concrete reason level
lives in `settings-store` and not in `ConsoleApp` state.

---

## 7. Invariants

The repo-wide hard constraints (platform-neutral allocation-free `nisps/`, ≤1e-5 native↔WASM parity,
schema changes shipping both codegen outputs, bounded RT-safe worklet comms, dual-core ownership)
are the floor. This item's own:

1. **A preset never changes network weights.** Concretely: from a fixed starting state,
   `applyPreset(p)` and `selectInstrument(p.modeId)` must leave `getWeights()` **bit-identical**.
   (Weights *do* change across the reshape — `nisps_ml_reshape` redraws and warm-starts,
   `bindings.cpp:397-418` — but the preset must contribute nothing beyond it.) This is the machine
   check on §2.1 and belongs in `bun test`.
2. **Seeds load after the reshape or not at all** (§4.2). A preset whose examples vanish is worse
   than one with no examples: the dataset counter lies.
3. **The engine's net shape always equals `MF_MODES[modeId].ml`** after any apply — the P5.3
   contract that `tests/e2e/schema-modes.spec.ts` already enforces.
4. **`ctx.datasetCount` equals the engine's real example count** after apply. Same bar as §6.5e:
   nothing may render a plausible number it did not get from the core.
5. **No C++, no schema, no codegen, no new WASM export in this item.** If a step appears to need one,
   stop and re-spec — it means the scope was wrong. (Corollary: `scripts/parity-check.sh` is
   *irrelevant* to this work; see §10.)
6. **Preset application is main-thread config only** — no worklet message, no audio-thread work
   beyond the existing `setBackend`. `addExample` is a bounded heap copy per example, capped at 128
   by validation (§3.3).
7. **`level` is persisted and never auto-reset** (§6.4); `presentation` is transient.
8. **`window.__mf` survives** with the same four methods (`ConsoleApp.tsx:331-345`), repointed at
   `selectInstrument`. Playwright drives mode switches through it and must keep working *even after
   a real picker exists* — the seam is faster and less brittle than clicking a popover.
9. **No "C15" in the bundle** (`tests/e2e/smoke.spec.ts:59`). The Library renders `MFMode.label`;
   if the `c15` entry survives §8.5, its label is already "Powerful Synth Engine".

---

## 8. Deletions, with their consumers

| Delete | Consumers today | Replacement |
|---|---|---|
| **8.1** `backends/presets.ts` per-backend keying: `OutputPreset.backend`, `KEY_PREFIX:<backend>` namespaces, `listPresets/savePreset/getPreset/deletePreset/renamePreset(backend, …)` signatures, `OutputPresetRow` | `PresetBar` (`OutputsBackendConfig.tsx:99-208`, rendered `:686`) — the only one | `presets/store.ts` + `Preset`/`OutputOverride`. `PresetBar` becomes a view onto the unified store filtered by the active target, keeping its save/restore/rename/delete affordances. **Note the sequencing:** step 1 of §9 fixes the `cv` bug inside the old file; step 5 deletes the file. That is deliberate — the bug fix is independently valuable if 5c is never adopted. |
| **8.2** `DrawerDepth` as a disclosure flag | `Drawers.tsx` (21 sites, §6.1), `Dock.tsx`, `ConsoleApp.tsx:110/268/642` | `presentation` + `level` (§6.2) |
| **8.3** `OutputMode` / `outputMode` / `OUTPUT_MODES` / `output-mode.ts` names | `types.ts:26,110-111`, `output-mode.ts`, `Dock.tsx`, `Drawers.tsx:553,615`, `ConsoleApp.tsx:136-137,280,755-756,882,904` | `OutputTarget` / `target` / `OUTPUT_TARGETS` / `output-target.ts`. Mechanical rename; typecheck is the proof. Optional — §12.2. |
| **8.4** `ModeOverlay.input` + `MFMode.input` + `ModeInput` (`model.ts:41,141,211-216,229-247`) | `resolveInputMap(settings.inputMap, mode.input)` (`ConsoleApp.tsx:814`) — the only one | Derive from `schema.ui.primary_input` in `modeFromSchema` (`model.ts:246`); fixes the Breakor drift (§1.6.2). Manifold-only modes keep a literal. |
| **8.5** the `c15` placeholder mode (`model.ts:301-313`) | `MF_MODES` only; nothing renders it (§1.1) | Delete. It is a 2-fake-param entry on the default net shape that will become *visible* the moment a picker exists — the last survivor of the decorative stratum Phase 1 swept. Keep only if the operator wants roadmap signalling in the Library (§12.4). |

Not deleted, and why: `MFMode.glyph`/`cls`/`badge`/`placeholder` (§1.1) get their first real
consumer here. `visualizer` stays — it works, and its removal is a product call unrelated to this
item.

---

## 9. Sequenced implementation plan

Each step is independently landable and independently verifiable. Steps 1–2 are worth doing even if
the operator rejects everything after them.

**Step 1 — the `cv` preset bug** (§1.3). Three additions to `manifold/src/backends/presets.ts`:
`cv?: MFParam['cv']` in `OutputPresetRow` (`:16-29`), `cv: p.cv` in `rowsFromParams` (`:72-86`),
`cv: r.cv ?? p.cv` in `applyPreset` (`:141-162`).
*Verify:* a new `manifold/tests/presets.test.ts` case — build params with `cv` specs, round-trip
through `rowsFromParams`/`applyPreset`, assert channel + threshold survive. Runs in `bun run test`.
Red before, green after.

**Step 2 — schema-truth input kind** (§8.4, §1.6.2). Derive `MFMode.input` from
`schema.ui.primary_input` in `modeFromSchema`; drop `input` from `ModeOverlay`.
*Verify:* `bun run typecheck`; a unit test asserting `MF_MODES.find(m => m.id === 'breakor')!.input`
now follows the schema. Note this **changes visible behaviour** — Breakor's input surface flips from
circular to rectangular. That is the bug being fixed, and it belongs in the commit message.

**Step 3 — collapse mode switching into `selectInstrument`** (§4.2). Replace the three effects at
`ConsoleApp.tsx:241-243`, `:252-257`, `:260-271` with one function plus one boot effect keyed
`[engine]`. Repoint `window.__mf.setMode`.
*Verify:* this is the step with real regression risk and it already has coverage —
`tests/e2e/schema-modes.spec.ts` (four modes: dims, weight count, output arity, UI param count,
training after switch), `tests/e2e/reshape.spec.ts`, `tests/e2e/spine.spec.ts` (probe survives a
mode switch). Run the full Playwright suite, not just the smoke. On the VPS use the non-snap node
runner (`ONBOARDING.md` §2). **No new test proves the boot path** beyond the suite's own boot — if
this step misbehaves it will most likely be a mode switch that no longer reshapes, which
`schema-modes` catches, or a double-apply on boot, which nothing catches; add an explicit
"reshape called exactly once on boot" assertion via a probe counter if that risk is judged real.

**Step 4 — preset model + store + built-in catalogue** (§3). `presets/types.ts`, `presets/store.ts`,
`presets/builtin/`. Author **two or three** curated presets only — enough to exercise the model
(one config-only, one with `rest: 'off'` plus a handful of overrides, one with seeds). Authoring the
full curated set is a separate, per-mode pass — and note that pass is **not** governed by §7.5: the
20 anonymous "Param NN" slots (`ALIGNMENT.md` deferred debt; `schemas/modes/paf_synth.json` params
`p00`…) can only be named by editing the schemas, which means codegen and both generated outputs in
that change. Keep it out of this item.
*Verify:* `manifold/tests/presets.test.ts` — `validatePreset` over every `BUILTIN_PRESETS` entry
against `ALL_MODE_SCHEMAS`; store round-trip through a localStorage fake. `bun run test`.

**Step 5 — `applyPreset` + the weights invariant** (§4, §7.1). `presets/apply.ts` + `ConsoleApp`
wiring; retire the per-backend preset store (§8.1) and repoint `PresetBar`.
*Verify:* two parts, and neither alone is sufficient — say so in the commit rather than claiming
§7.1 is fully proven.
(a) **Unit, fake applier**: assert the call ORDER (seeds strictly after `selectInstrument`; routing
after the mode rebuild) and assert that no weight-mutating call — `setWeights`, `randomise`,
`train`, `trainAsync` — is made at all. This is the direct machine check on "configuration only".
(b) **C-ABI, real WASM**: in the style of `manifold/tests/loss-history.test.ts` (which drives the
committed `public/nisps.{js,wasm}` under `bun test` via `cwrap` — note it does NOT go through
`WasmIML`/`EngineApi`, which need a browser-ish environment), assert that
`nisps_ml_reshape` followed by N × `nisps_ml_add_example` leaves `nisps_ml_get_weights` bit-identical
to `nisps_ml_reshape` alone. That is the core-side half of the invariant.
**Residual gap:** nothing asserts the invariant end-to-end through the real `EngineApi` under
`bun test`. Step 6's e2e covers it indirectly (dims + dataset count after an apply). Closing it
properly would mean making `WasmIML` constructible headlessly, which is a bigger job than this
item.

**Step 6 — the Library** (§5). `console/InstrumentPicker.tsx` + the rail changes in `Dock.tsx`.
*Depends on* §6.5b (`plans/browser-mode-coverage-spec.md`) if its `modeSupport()` is to be rendered
(§5.4); buildable without it, at the cost of listing modes that cannot run.
*Verify:* a new `tests/e2e/library.spec.ts` — open the Library, apply a preset, assert (a) the
engine reshaped to that preset's mode dims via `window.__nisps.describe()`, (b) the rendered param
count matches the schema via `window.__mf.paramCount()`, (c) `datasetCount` equals the preset's seed
count, (d) no console errors. Plus `bun run test:e2e` for the smoke's no-"C15" assertion.

**Step 7 — presentation/level split** (§6). Rename `DrawerDepth`, add `levels` to `settings-store`,
re-gate all 21 sites per §6.3.
*Verify:* `tests/e2e/training-health.spec.ts` currently asserts the panel appears at `expanded`
depth — it must be updated to `advanced` level in the same change, and it is the direct proof the
mechanism swap preserved the §6.5e behaviour. Add one case: level persists across reload (the e2e
helper clears localStorage per test, so this needs an explicit in-test reload rather than a fresh
`loadProbe`). `bun run typecheck` catches the rename fallout.

**Step 8 — docs.** `manifold/ONBOARDING.md` (§4 drawer/dock description, the "`depth === 'expanded'`
is the advanced-surface flag" rule, the five-vs-six output modes error of §1.6.1), `MAP.md`
(`manifold/src/presets/`), `ALIGNMENT.md` defect 2, `dock-spec.md` (a grounding note recording the
depth model this replaces), `manifold-parity-features-spec.md` §1 (superseded pointer). Same commit
as the code that makes each true.

**Step 9 (optional) — `OutputTarget` rename** (§8.3). Pure mechanical; `bun run typecheck` is the
whole verification. Do it first or last, never in the middle of a behavioural step.

---

## 10. What the gates prove, and what they do not

- `bun run typecheck` / `bun run test` / `bun run test:e2e` are the real gates here. Baseline on
  2026-07-21 before any of this work: typecheck clean, `bun test src tests/*.test.ts` → **23 pass,
  0 fail, 6 files**.
- **`scripts/parity-check.sh` proves nothing about this item, in either direction.** It exercises
  PAFSynth and ChannelStrip from an all-params-0.5 baseline; this item touches no C++ and no
  schema, so a PASS is not evidence of correctness and could not be evidence of a regression. Do
  not cite it. Do not skip it either — CI runs it regardless, and a red one means something else
  broke.
- `bash scripts/build-cpp-tests.sh` and `scripts/lint-cpp.sh` likewise have no bearing; running them
  is cheap insurance against having touched C++ by accident, which §7.5 forbids.
- **The weakest verification in this plan is step 3** (mode-switch refactor). It is covered by e2e,
  which is slow, environment-sensitive on the VPS, and asserts outcomes rather than call counts. If
  the operator wants stronger evidence, the cheap addition is a probe-visible reshape counter.
- **Nothing here needs hardware.** The one place hardware would matter — a preset reaching the
  MEMLNaut — is explicitly out of scope (§0, §11.Q4).

---

## 11. Open questions for the operator

**Q1. Do you have saved output presets in the live app that must survive?**
§8.1 retires the `manifold-output-presets:<backend>` localStorage namespaces. If you have presets
saved at `meml.lnfinitemonkeys.org/next/` you care about, the answer is a one-off import shim
(~20 lines, deleted after one run); if not, they are simply orphaned and the code is cleaner. I
cannot check your browser storage.

**Q2. May a curated preset opt into one training pass over its seeds?**
§2.1 says the network ships untrained, so the default is no. But a preset with seeds and no training
sounds like an untrained net until the user presses Train — which may be exactly the intent
(the seeds are a *starting lesson*, not a *sound*), or may be a footgun. A `seed.autotrain?: boolean`
is three lines. Default proposed: absent, i.e. never.

**Q3. Should voice space be part of a preset?**
Every schema declares `voice_spaces` and `ui.show_voice_space_selector`, `nisps/modes/base.hpp:279`
implements selection, and **the browser cannot reach it** — there is no WASM export, and the audio
engine lives in the worklet behind raw exports (`worklet/nisps-processor.ts:33-36`), so this costs
the full 5-layer export chain *plus* worklet + engine-host message plumbing. It is a real
per-instrument character control that curation would obviously want. Out of scope as specified; say
if it should be pulled in, because it changes this item from "no C++" to "C++ and a new export".

**Q4. Where does curation ultimately live — browser only, or shared with firmware?**
§3.2 chooses browser-local TS data with a stated promotion condition (the hardware editor, §6.5d).
If you expect to author a preset in Manifold and send it to the MEMLNaut, say so now: the format
should then be JSON under `schemas/` from the start, because retrofitting codegen later means
rewriting the catalogue.

**Q5. URL sharing?** `manifold-parity-features-spec.md` §1.3 specified `?session=<base64url>` and a
compact axis form. Deferred here (nothing depends on it, and the axis form's control surface does
not exist). Worth scheduling, or drop it from the corpus?

---

## 12. Decisions I made (not questions)

Recorded so they can be reversed knowingly rather than rediscovered.

1. **The picker *is* the preset browser** (§2.3), one surface not two. Rationale: vision 3 wants the
   curated path to be the default path; a separate mode list beside a preset list would make the raw
   instrument the front door again.
2. **`OutputMode` → `OutputTarget`** (§8.3) is proposed but optional and sequenced last. It is pure
   naming hygiene for a collision that only becomes painful once two "Mode" controls sit adjacent on
   the rail.
3. **Explanatory prose shows at `basic` and hides at `advanced`** (§6.3), inverting today's
   accidental behaviour where beginners' help is behind a modal. If you dislike it, the fallback is
   one line: show prose unconditionally.
4. **Delete the `c15` placeholder mode** (§8.5), because a picker makes it visible and it does
   nothing. Trivially reversible by keeping the entry and rendering its `badge: 'soon'` disabled.
5. **Two disclosure levels, not three** (§6.2) — `dock-spec.md` §0's `peek` never shipped and there
   is exactly one tier of advanced content in the tree.
6. **Index-keyed output overrides** (§3.1), because `MFParam.name` is user-editable while schema
   param order is codegen-stable.
7. **Two or three built-in presets in step 4, not a full catalogue** (§9). Authoring curated presets
   per instrument is real design work that wants ears and hardware; the model must be proven first.
