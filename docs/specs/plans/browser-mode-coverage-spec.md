---
kind: plan
status: active
---

# Browser Mode Coverage Honesty — audio topology as declared, verified truth

*Dated 2026-07-21. Spec for `plans/simplification-plan.md` §6.5b (audit finding `A2`), written
spec-first per plan §6 — **proposal only, no phase adopted**. Companion decisions live in §8.
Absorbs the old ALIGNMENT "browser-only engines incomplete / mic input" defect.*

*Every claim below was checked against the tree at `fd0aee2`. Measurements are reproducible; the
exact commands are given. Where I could not verify something I say so instead of asserting it.*

---

## §0 What is actually true today (measured, not inferred)

Two independent probes, both run 2026-07-21:

1. **Native**, engines compiled straight from `nisps/engines/*.hpp` (`g++ -std=gnu++20 -O2 -I nisps`).
2. **The committed WASM artifact** `manifold/public/nisps.{js,wasm}`, driven through the exact C ABI
   the AudioWorklet uses (`nisps_engine_create` / `set_params` / `process_block`), loaded with the
   same glue dance as `manifold/tests/loss-history.test.ts`.

Both were run for 2 s at 48 kHz with all params 0.5, first with a silent input, then with a
0.3-amplitude 220 Hz sine. Output RMS (left channel):

| engine | silent in | sine in | native == wasm |
|---|---|---|---|
| `paf_synth` | **0.000000000** | *(ignores input)* | yes |
| `channel_strip` | 0.000000000 | 0.446555 | yes (≤1e-6) |
| `xiasri` | 0.000000000 | 0.848909 | yes (≤1e-6) |
| `verb_fx` | 0.000346808 | 0.267881 | yes (≤1e-6) |
| `memlcelium` | **0.399765** | *(ignores input)* | yes |
| `breakor` | 0.000000000 | — | yes |
| `elysiamorf` | 0.000000000 | — | yes |
| `analysis` | 0.000000000 | 0.000000000 | yes |
| `thru` | 0.000000000 | — | yes |

Reading that against what the browser host actually supplies:

- **Nothing is ever connected to the worklet's audio input.** `EngineHost` constructs the node with
  `numberOfInputs: 1` (`manifold/src/engine/engine-host.ts:117`) and connects it to the destination
  (`:121`), but there is no `getUserMedia`, `MediaStream`, or `createMediaStreamSource` anywhere in
  `manifold/src` (grep: zero hits). The worklet already *reads* `inputs[0]`
  (`manifold/src/engine/worklet/nisps-processor.ts:266-271`) and zero-fills when absent — so the
  DSP side is done and the gap is one main-thread connection.
- **The engine C ABI has four entry points only**: create / destroy / set_params / process_block
  (`nisps/wasm/bindings.cpp:1074-1108`, exported at `scripts/build-wasm.sh:70-71`). There is no
  `note_on`, no `set_playing`, no `update_bpm`, no `pop_events`, no feature readback.

Therefore, **of the nine schema-backed modes, exactly two produce audio in the browser today**:
`memlcelium` and `slp_workshop` (which share the `memlcelium` engine).

| mode | why it is silent / inert in the browser |
|---|---|
| `paf_synth` | Note-gated. `process()` multiplies by `env_.play()` and the ADSR idles in `WaitToTrig` → exactly 0 (`nisps/engines/paf_synth.hpp:114`, `nisps/dsp/env.hpp`). Only `note_on` starts it (`:132-138`), and no browser path calls it. |
| `channel_strip` | Pure input processor; no audio input connected. |
| `verb_fx` | Pure input processor; RMS 3.5e-4 from a zero input is residual, not a signal. |
| `xiasri` | Pure input processor; no audio input connected. |
| `breakor` | Event-only by design (`nisps/engines/breakor.hpp:81-109` returns `{0,0}`). `playing_` defaults `true` (`:159`) so it *does* tick and enqueue, but `pop_events` is not exported, so the 64-slot `EventQueue` fills and silently drops (`nisps/core/event_queue.hpp:44-49`). |
| `elysiamorf` | Same shape (`nisps/engines/elysiamorf.hpp:100-104`, `playing_ = true` at `:136`). |
| `sound_analysis_midi` | Needs mic *and* a features readback. `AnalysisEngine::process` returns silence and exposes `features()` / `copy_features()` (`nisps/engines/analysis.hpp:129`, `:188-196`) — neither is exported. |
| `visualizer` (manifold-only) | Correctly silent: it is a visual mode on `thru`. |
| `c15` (manifold-only) | Already honest — `placeholder: true`, `badge: 'soon'` (`manifold/src/console/model.ts:301-313`). |

### How the table was produced

Both probes were throwaway scripts in `/tmp`, not committed — **§5 step 2 turns them into permanent
tests, which is the point of this document.** Their shape, so they can be rebuilt in ten minutes:

- **Native.** One `.cpp` including `nisps/engines/*.hpp`; per engine: default-construct,
  `setup(48000.f)`, `set_params` with a `param_count()`-sized vector of `0.5f`, then 96 000 calls to
  `process({s, s})` accumulating `y.L² + y.R²`; `s` is 0 or `0.3 · sin(2π·220·i/48000)`. Built with
  `g++ -std=gnu++20 -O2 -I nisps`.
- **Committed WASM.** A `bun` script using the same glue-loading dance as
  `manifold/tests/loss-history.test.ts:34-45` (`new Function(...)` over `public/nisps.js`, then
  `factory({ wasmBinary: public/nisps.wasm })`), then `M.cwrap` for `nisps_engine_create`,
  `nisps_engine_set_params`, `nisps_engine_process_block`, `nisps_engine_destroy`; engine id written
  as NUL-terminated ASCII into a 32-byte `_malloc` buffer exactly as the worklet does
  (`nisps-processor.ts:217-230`); 750 blocks × 128 frames.

The two agreed to ≤1e-6 on every engine — incidental corroboration that WASM parity holds on a path
`scripts/parity-check.sh` does not cover.

---

## §1 Where the brief and the audit are wrong

Trust the code over these documents, including this one.

1. **"4 modes that structurally cannot run" is an undercount.** Audit `A2` names `breakor`,
   `elysiamorf`, `xiasri`, `sound_analysis_midi`. `channel_strip` and `verb_fx` are in exactly the
   same position as `xiasri` — all three are pure input processors with no input connected — and
   `paf_synth`, the catalogue's flagship, is silent for a *third* reason the audit's four-way enum
   cannot even express. The real number is **7 of 9**.
2. **"The UI presents them as available" is false today.** There is no instrument-mode picker in
   Manifold at all. `ConsoleApp.tsx:326-329` says so explicitly; `ctx.modes` / `ctx.setModeId` are
   plumbed with no renderer (`manifold/src/console/types.ts:50-57, 64-66`); the Dock's "Mode"
   selector is the **output backend** picker, not the instrument (`manifold/src/console/output-mode.ts:1-18`).
   The only way to reach another mode is `window.__mf.setMode()` under `?debug=1`.
   **Consequence for sequencing:** the dishonesty is *latent*. It fires the moment §6.5c builds the
   picker. 5b is therefore a **prerequisite of 5c**, and a "badge" alone would ship a component no
   user can see. What 5b must deliver is the *data* plus the *capabilities*, so that 5c's picker has
   something true to render and most modes no longer need a warning at all.
3. **The parity harness's PAFSynth stage is vacuous.** `tests/cpp/parity_check.cpp:175-190` runs
   PAFSynth for 128 frames with silent input and no `note_on`, then averages — both sides push
   exactly `0.0, 0.0`. Stage 3 compares zero to zero. (Stage 4, ChannelStrip, at least feeds a
   0.25 DC step.) This is on top of the known limits the brief states. A parity PASS is not evidence
   for anything in this document.
4. **§7.2's DriverConfig work changed the firmware, not the browser.** `Mode::driver_config()` is
   now part of the `nisps::Mode` concept (`nisps/core/concepts.hpp:74-80`), defaults to
   `engine().driver_config()` in `ModeBase` (`nisps/modes/base.hpp:145-165`), and firmware brings
   the codec up from it (`firmware/MEMLNaut-NISPS/glue/audio_driver.hpp`). **Mic vs line is real on
   hardware.** Nothing in `manifold/` or `nisps/wasm/bindings.cpp` reads `DriverConfig` — the WASM
   bridge never calls it. So yes, the browser side is the remaining gap for *routing*, but see the
   next point, which is why 5b cannot simply reuse `DriverConfig`.
5. **`DriverConfig` is not a topology declaration and must not be pressed into service as one.** It
   is a codec-negotiation record: `mic_input`, `mic_gain_db`, `line_level`, `output_volume`,
   `sample_rate` (`nisps/core/types.hpp:50-71`, struct at `:65`). It *correlates* with topology by accident — the
   three input-processing engines all set `line_level = 6u` — but `paf_synth` also deviates
   (`output_volume = 0.9f`) while consuming no input, `breakor`/`elysiamorf` return a default
   `{}` identical to a mode that expresses no opinion, and `analysis`'s `mic_input = true` is about
   *which codec pin*, not about *whether audio input is required*. Inferring topology from
   `line_level != 3` would be a guess dressed as a fact. Topology needs its own declaration.

---

## §2 The model

### §2.1 Why not the flat four-class enum

The plan proposes `generator | audio-in-fx | event-only | analysis`. That enum cannot express
`paf_synth`, which is a generator that produces nothing without note events — the single biggest
user-visible gap in the catalogue. Three independent facts are being conflated:

| axis | question | values |
|---|---|---|
| `input` | does the engine need an audio input signal to do its job? | `none` \| `required` |
| `output` | what does the engine emit? | `audio` \| `events` \| `none` |
| `trigger` | does it need note events to sound? | `free` \| `notes` |

The four familiar class names survive as a **derived label**, not stored data:

```
output === 'events'                    → "Event sequencer"
output === 'none' && input==='required'→ "Analysis"
input  === 'required'                  → "Audio FX"
otherwise                              → "Generator"
```

### §2.2 The declared values

| mode | `input` | `output` | `trigger` | derived label |
|---|---|---|---|---|
| `paf_synth` | none | audio | **notes** | Generator |
| `channel_strip` | **required** | audio | free | Audio FX |
| `verb_fx` | **required** | audio | free | Audio FX |
| `xiasri` | **required** | audio | free | Audio FX |
| `memlcelium` | none | audio | free | Generator |
| `slp_workshop` | none | audio | free | Generator |
| `breakor` | none | **events** | free | Event sequencer |
| `elysiamorf` | none | **events** | free | Event sequencer |
| `sound_analysis_midi` | **required** | **none** | free | Analysis |

### §2.3 Host capability, and a derived verdict — not a hard-coded badge

The catalogue must never carry a hand-maintained "works in browser" flag: it would be wrong the day
a capability lands. Instead, the browser declares what it can currently provide, and support is
**computed**:

```ts
interface HostAudioCapabilities {
  audioInput: boolean;        // a MediaStream is connected to the worklet node
  noteTrigger: boolean;       // nisps_engine_note_on/off exist and are wired
  eventDrain: boolean;        // worklet → host event channel exists
  analysisFeatures: boolean;  // analysis feature readback exists
}

type ModeSupport =
  | { ok: true }
  | { ok: false; reason: 'needs-audio-input' | 'needs-note-source' | 'hardware-only'; detail: string };
```

`modeSupport(schema.audio, host)` is a pure function; the UI renders its result. As each capability
in §5 lands, its flag flips to `true` and modes stop being labelled — no catalogue edit, no badge
list to maintain. Today the flags are `{ audioInput: <runtime>, noteTrigger: false, eventDrain:
false, analysisFeatures: false }`.

---

## §3 Where the truth lives

**In `schemas/modes/<mode>.json`, as a new required `audio` object; codegen emits C++ and TS.**

Rejected alternatives, with reasons:

- *A hand-written topology map in `manifold/src/console/model.ts`* (the audit's suggested fix) —
  this is a seventh hand-maintained mode registry, straight against Phase 3, which just finished
  deleting six of them (`simplification-plan.md` §4). It also puts a fact about C++ engines in
  TypeScript, where no C++ test can check it.
- *A WASM export `nisps_engine_topology(id)`* — `MF_MODES` is built at module load
  (`model.ts:267-316`); making it await WASM would make the whole catalogue async for a static fact.
- *Deriving it from `DriverConfig`* — see §1.5.

### §3.1 Schema shape

Added to `schemas/schema.json` (`required` gains `"audio"`, `additionalProperties: false` preserved):

```json
"audio": {
  "type": "object",
  "required": ["input", "output", "trigger"],
  "additionalProperties": false,
  "properties": {
    "input":   { "enum": ["none", "required"] },
    "output":  { "enum": ["audio", "events", "none"] },
    "trigger": { "enum": ["free", "notes"] },
    "dsp_engine_id": {
      "type": "string", "pattern": "^[a-z][a-z0-9_]*$",
      "description": "The engine that occupies the audio path for this mode. Defaults to the mode's engine_id; declared only when the mode's ModeBase engine slot is a NoOp and a separately-composed engine owns the audio (sound_analysis_midi → analysis)."
    }
  }
}
```

`dsp_engine_id` is optional and is set on exactly one mode, `sound_analysis_midi: "analysis"`. It
exists to **delete** a hard-coded exception — see §6.

### §3.2 Codegen anchors

`codegen/generate.ts`, mirroring what `ui` already does — each of these is one line-group:

| what | anchor |
|---|---|
| input TS type for a schema file | `interface ModeSchema` at `:93-126` (its `ui` block is `:116-120`) |
| C++ enums + `struct AudioConfig` in `schema_types.hpp` | beside `enum class PrimaryInput` `:264-272` / `struct UIConfig` `:273-277` |
| `AudioConfig audio;` member on `ParamSchema` | `struct ParamSchema` at `:288-300` |
| per-mode `inline constexpr AudioConfig k<Mode>Audio` | beside the `// UI` block, `:503-518` |
| TS `AudioConfig` interface + `ModeSchema.audio` | `export interface UIConfig` at `:374-378` |
| TS per-mode emission | beside `:631-635` |

Regenerate with `cd codegen && bun run generate.ts`; the golden snapshot
`codegen/tests/golden/paf_synth_schema.{hpp,ts}` must be updated in the same change, and CI's
codegen dirty-diff gate (added in plan §1.3) will fail on anything stale.

---

## §4 Invariants

Beyond the repo-wide constraints (platform-neutral allocation-free `nisps/`, 1e-5 parity, both
codegen outputs in one change, RT-safe worklet/dual-core comms), this area has its own:

1. **Declared topology is verified by behaviour, never by comment.** Every value in §2.2 is asserted
   by a test that drives the engine (§5 step 2). Adding an engine or a mode without a topology
   declaration must fail to build; declaring one falsely must fail a test.
2. **The support verdict is derived, never stored.** No "browser-ok" boolean in a schema, a
   catalogue, or an overlay. See §2.3.
3. **`nisps/` gains no browser-only concept.** `audio` is a schema/codegen fact consumed by the
   generated `ParamSchema` and by tests. Firmware behaviour must not change: no engine or mode
   source file changes in step 1, and `nisps_modes_tests` / `nisps_dsp_engine_tests` must stay green
   with no edits to existing cases.
4. **Microphone input is opt-in, per session, and never auto-enabled.** Mic → worklet → destination
   is an acoustic feedback loop through the room. Enabling requires an explicit user gesture and a
   headphones warning; the mic is disconnected on `EngineHost.stop()` and on mode switch away from
   an `input: 'required'` mode.
5. **No new audio-thread allocation.** Anything crossing worklet↔main (events, analysis features)
   uses a pre-allocated channel. `postMessage` of a freshly-allocated typed array per render quantum
   is not acceptable; COOP/COEP are already set for `manifold` (see `vite.config.ts` /
   `ONBOARDING.md` §2), so `SharedArrayBuffer` is available and is the intended mechanism.
6. **The exclusive `InputMode` picker stays exclusive and stays ML-only.** `internal | gamepad |
   midi` (`manifold/src/console/Drawers.tsx:284-288`) selects the *ML input source*. Microphone
   audio is not an ML input source (except transitively for `sound_analysis_midi`, whose features
   would enter through the engine, not through `input-layer.ts`). Do not add a fourth entry.
7. **Silence must be explained, not shipped.** If a mode is selectable and cannot sound, the UI says
   which capability is missing. "It just doesn't make a noise" is the bug this document exists to
   remove.

---

## §5 Implementation sequence

Each step is independently landable and independently verifiable. Steps 1–3 are the honest minimum;
4–6 are scoped by the decisions in §8.

### Step 1 — declare topology (schema + codegen, both languages)

Edit `schemas/schema.json` (§3.1) and all nine `schemas/modes/*.json` with the §2.2 values, plus
`dsp_engine_id: "analysis"` on `sound_analysis_midi`. Extend `codegen/generate.ts` at the §3.2
anchors. Regenerate; commit `nisps/modes/generated/`, `manifold/src/modes/generated/`, and the
codegen golden.

*No behaviour changes.* Note honestly: `ui.primary_input` / `show_voice_space_selector` /
`show_synth_visualizer` are generated into both languages and read by **nothing** outside codegen and
its golden (verified by grep across `manifold/src`, `nisps/`, `firmware/`). `audio` must not repeat
that — it acquires two consumers in steps 2 and 3 of this same plan.

**Verification:** `bash scripts/build-cpp-tests.sh` (generated headers still compile into
`nisps_modes_tests`); `cd codegen && bun run test` (golden + curve-drift); `cd manifold && bun run
typecheck`; `bun run codegen/generate.ts` twice → no diff (idempotence).

### Step 2 — make the declaration honest (two behavioural tests)

**2a. `tests/cpp/test_mode_audio_topology.cpp`**, added to the `nisps_modes_tests` target
(`nisps/CMakeLists.txt:119-144` — that target already has the repo root on its include path and
already links the generated schemas). For every generated mode schema, resolve
`audio.dsp_engine_id ?? engine_id` to its C++ engine type and assert:

| declared | assertion |
|---|---|
| `input: 'none'` | output is *identical* driven silent vs driven with a noise bed (the engine ignores its input). For `output: 'none'` engines, compare `features()` instead of audio. |
| `input: 'required'` | output RMS with the noise bed exceeds output RMS with silence by > 1e-2. |
| `output: 'audio'` | with the mode's sounding precondition satisfied (a `note_on` when `trigger === 'notes'`, a noise bed when `input === 'required'`), RMS > 1e-3. |
| `output: 'events'` | RMS is exactly 0 under both drives **and** `pop_events()` yields > 0 events within 2 s at the default tempo. |
| `output: 'none'` | RMS is exactly 0 under both drives. |
| `trigger: 'notes'` | RMS is exactly 0 before `note_on`, and > 1e-3 within 1 s after `note_on(60, 100)`. |
| `trigger: 'free'` | covered by the `output: 'audio'` row. |

Drive params pseudo-randomly in [0.05, 0.95] from a fixed-seed `nisps::Rng`, **not** all-0.5 — that
vector is a degenerate corner and is precisely why `parity_check.cpp` stage 3 tests nothing
(`simplification-plan.md` §6.5f(3) made the same call for the bench).

The engine_id → C++ type resolution is a `switch` local to the test. Guard it: assert the set of
resolved ids equals the set of ids across all generated schemas, so a new engine cannot be added
without the test noticing.

**2b. `manifold/tests/engine-topology.test.ts`** (`bun test`, picked up by the existing
`bun test src tests/*.test.ts` glob — do not change that script). The §0 WASM probe, promoted:
drive the **committed** `manifold/public/nisps.{js,wasm}` through `nisps_engine_*` and assert the
same table at the browser's own ABI. This is the layer parity-check does not cover and the layer the
deploy actually ships.

**Verification:** `bash scripts/build-cpp-tests.sh` (5 ctest targets green); `cd manifold && bun run
test`. Both are hardware-free and run in CI. If a §2.2 value is wrong, this is where it surfaces.

### Step 3 — surface the truth in Manifold

- `manifold/src/console/model.ts`: `MFMode` gains `audio: AudioConfig` (derived in
  `modeFromSchema`, `:246-259` — one line, straight off the schema).
- New `manifold/src/console/mode-support.ts`: `HostAudioCapabilities`, `modeSupport()`, and
  `modeClassLabel()` (§2.1/§2.3). Pure, unit-testable, no React.
- `ConsoleApp` builds the capability record from what the engine actually exposes (today:
  `audioInput` from `engine.audio.hasAudioInput`, the other three literal `false` constants that get
  deleted as steps 4–6 land) and puts it on `ConsoleCtx`.
- Render: a support chip in the synth `ModeConfig` block (`manifold/src/console/Drawers.tsx:549-570`,
  the "Transport" section — it already names the active mode), stating why the active mode cannot
  sound. When 5c builds the picker it reads the same `modeSupport()` for its per-entry badge and for
  disabling `hardware-only` entries.

**Verification:** unit test for `modeSupport()` over all nine modes × the current capability record
(`bun test`); `bun run typecheck`; e2e — extend `manifold/tests/e2e/schema-modes.spec.ts`, which
already switches modes through `window.__mf`, to assert the chip's text for one mode per class.

### Step 4 — wire microphone input (makes the Audio FX class real)

This is the cheapest real capability in the document: the worklet already consumes `inputs[0]`
(§0), so **no `nisps/` change, no new WASM export, no worklet change**.

- `EngineHost`: `setAudioInput(stream: MediaStream | null)` — hold a
  `MediaStreamAudioSourceNode`, `connect(this.node)` / `disconnect()`; handle "called before
  `start()`" by stashing the stream and connecting once the node exists; drop it in `stop()`.
- `EngineApi.audio` gains `setAudioInput()` + `hasAudioInput` (`manifold/src/engine/engine-api.ts:95-102,
  203-207`).
- UI in the synth Transport block beside the play button, rendered only when the active mode
  declares `input: 'required'`: an "Audio input" toggle that calls
  `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false,
  autoGainControl: false } })` — the three defaults must be off or the codec fights the DSP — with
  a headphones warning (invariant 4) and a clear denied/unavailable state. Requires a secure
  context: production is HTTPS, dev is `http://localhost:5273`, both fine.
- Device picker: **out of scope**, default device only. Note it.

**Verification, honestly graded:**
- *Strong:* step 2b already proves these three engines transform a driven input correctly at the
  committed-WASM layer.
- *Medium:* an e2e with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` and
  `context.grantPermissions(['microphone'])` can assert `engine.audio.hasAudioInput === true` and
  that the mode chip clears. That proves **wiring**, not audibility.
- *Weak / not automatable here:* that sound actually comes out of the speakers with a real mic. The
  worklet's output is not observable from the page. This needs an operator listening check, once,
  per engine. Say so in the commit rather than implying the gates cover it.

### Step 5 — `paf_synth` note triggering *(gated on decision §8.1)*

Two exports, `nisps_engine_note_on(void*, int note, int vel)` and `nisps_engine_note_off(void*,
int note)`, dispatched with `if constexpr (requires { e->note_on(n, v); })` so only engines that
have them respond (today: `paf_synth` alone). The chain is **worklet-side**, which differs from the
main-thread five-layer chain — the main thread never creates engines:

1. `EMSCRIPTEN_KEEPALIVE` in `nisps/wasm/bindings.cpp` (beside `:1089-1108`)
2. `EXPORTED_FUNCTIONS` in `scripts/build-wasm.sh:70-71`
3. `WasmInstance.exports` interface + a `pickFn(...)` in `init_` and the re-export in the
   `this.instance = { exports: { … } }` shim (`nisps-processor.ts:29-42`, `:145-165`, `:176-188`)
4. `HostToWorkletMessage` union + `onMessage_` branch (`engine-host.ts:35-53`,
   `nisps-processor.ts:72-90`)
5. `EngineHost.noteOn/noteOff` → `EngineAudioApi` (`engine-api.ts:95-102`, `:203`)

Miss a layer and it fails at runtime, not compile time. `manifold/src/engine/types.ts:159-167` also
declares the engine ABI for the main-thread module; it is unused by `wasm-iml.ts` — decide whether
to keep it symmetric or leave it alone, but do not assume it is load-bearing.

RT safety: notes arrive on the worklet's existing `port`, handled between render quanta exactly as
params already are — bounded, no allocation inside `process()`.

Trigger sources: `manifold/src/inputs/midi-input-source.ts:204-211` **already** emits `note:<n>`
press/release actions with velocity from WebMIDI; `ConsoleApp` binds actions to verdicts today, so
routing note actions to `engine.audio.noteOn/Off` is a small addition there. Add one on-screen
momentary "Note" button in the Transport block as the no-hardware fallback.

Note for context: on firmware, `paf_synth` is *also* note-driven — `glue/midi_io.hpp:41-50` routes
MIDI note-in to `mode.note_on`. The browser gap is not a divergence from hardware behaviour, it is
the absence of the same route.

**Verification:** extend `tests/cpp/test_mode_audio_topology.cpp`'s `trigger: 'notes'` row (already
specified in step 2a — it will already be green before this step, since it tests the C++ engine, not
the browser); add a `manifold/tests/engine-topology.test.ts` case asserting the *exported* note
functions exist and produce non-zero output through the committed WASM; e2e asserting the chip
clears after a synthetic note. Audibility again needs an ear.

### Step 6 — event-only and analysis modes *(gated on decisions §8.2 / §8.3)*

**Default position: label them `hardware-only` and stop.** That is honest, costs nothing, and the
label disappears by itself when a capability lands (§2.3).

If instead they are to be made real:

- **Event-only (`breakor`, `elysiamorf`)** needs (a) `nisps_engine_pop_events`,
  `nisps_engine_set_playing`, `nisps_engine_update_bpm` across the step-5 chain; (b) a worklet→main
  event channel — a `SharedArrayBuffer` ring written by the worklet and drained on the main thread's
  rAF (invariant 5; COOP/COEP are already set); (c) transport UI (play/stop/bpm) and a route from
  events to `midi-backend.ts` that bypasses the per-param output path entirely, because these modes
  emit notes, not parameter values. **This overlaps 5a**: on firmware the mode layer owns the event
  drain (`nisps/modes/breakor.hpp:42-46`, `glue/midi_io.hpp:53-63`), so building a second,
  browser-only orchestration here is exactly the duplication 5a exists to remove. **Sequence it
  after 5a.**
- **Analysis (`sound_analysis_midi`)** needs step 4 *plus* `nisps_engine_copy_features` *plus* a
  worklet→main path for six floats per control tick (same SAB channel) *plus* routing those into ML
  input slots 0–5 alongside `joy_*` in slots 6–9 — which is `input-layer.ts`'s composition contract
  and touches the exclusive-source picker (invariant 6, and the dormant multi-source decision,
  §7.7 of the plan). Not a small item; do not smuggle it into 5b.

---

## §6 Proposed deletion

One, with its consumer named:

**`modeEngineId()`'s hard-coded exception** — `manifold/src/console/model.ts:392-395`:

```ts
export function modeEngineId(modeId: string): string {
  if (modeId === 'sound_analysis_midi') return 'analysis';
  return MF_MODES.find((m) => m.id === modeId)?.engineId ?? 'thru';
}
```

Consumer: `ConsoleApp.tsx:242` (`engine.audio.setBackend(...)`). Replaced by
`schema.audio.dsp_engine_id ?? schema.engine_id` (§3.1). This is the same class of hand-exception
Phase 3 spent two days removing, and it is the only place in the app where a mode's audio engine is
decided by an `if`.

Nothing else in this document deletes anything. In particular, do **not** delete `nisps/engines/`
sequencer or analysis code because the browser cannot use it — firmware runs all of it.

---

## §7 Adjacent, verified, deliberately out of scope

Two findings from the same files. Recording them so the implementer does not rediscover them
mid-change; neither is part of 5b.

1. **`SCHEMA_MODE_OVERLAYS.input` duplicates `ui.primary_input` and has already drifted.**
   `model.ts:229-244` hand-declares `breakor: { input: 'joystick' }` while
   `schemas/modes/breakor.json` declares `"primary_input": "xy_pad"`. The overlay value is live —
   `ConsoleApp.tsx:814` feeds it to `resolveInputMap()` (`settings/settings-store.ts:146-153`) to
   pick the input-map shape — so the two sources disagree about a rendered behaviour. Fixing it
   means deriving `MFMode.input` from the schema and deleting the overlay field.
2. **`ui` is generated into both languages and consumed by nothing.** `primary_input`,
   `show_voice_space_selector`, `show_synth_visualizer` have zero readers outside `codegen/` and its
   golden. Either wire them (item 1 above wires `primary_input`) or delete them. Doing this in the
   same commit as step 1 is cheaper than separately — same files, same regeneration — but it is a
   different decision and should be asked for explicitly.

---

## §8 Operator decisions

These genuinely need a call; everything else in this document I decided and justified above.

1. **`paf_synth` note triggering (step 5): build it, or label the flagship mode "needs a note
   source"?** This is the most user-visible silence in the catalogue and the most likely to be read
   as "the app is broken". Building it is two exports plus a UI button, and the MIDI note plumbing
   already exists. Labelling it is free but leaves the best-developed engine unusable in the browser.
   *Recommendation: build it.* Counter-argument worth weighing: note routing is arguably 5a's
   territory (firmware does it in `ModeBase`/`midi_io.hpp`), so building it here creates a small
   browser-only path that 5a will later absorb.
2. **Event-only modes (`breakor`, `elysiamorf`): label hardware-only, or build the event channel?**
   *Recommendation: label now, build after 5a* — the browser-side orchestration is precisely what 5a
   is meant to stop hand-writing.
3. **`sound_analysis_midi`: label hardware-only, or build the analysis path?** It needs mic +
   feature readback + ML-input composition, and it collides with the dormant multi-source input
   decision (plan §7.7). *Recommendation: label now.*
4. **`audio.dsp_engine_id` — adopt the field (and delete the `modeEngineId` exception), or keep the
   exception and give the test a local special case?** Adopting it is the single-source answer and
   is what §3.1/§6 assume; the cost is one more optional schema field used by exactly one mode.
5. **Bundle the §7 `ui` clean-up into step 1?** Same files and same regeneration, so bundling is
   cheaper — but it widens a change that is otherwise purely additive.
6. **How much microphone UX?** Step 4 ships default-device-only with no picker and no input meter.
   A device picker and a level meter are obvious follow-ons; say now whether they are wanted, since
   a meter needs a tap on the input node that the current host does not have.

---

## §9 What this plan does not do

- It does not build the instrument-mode picker. That is §6.5c (`plans/curated-presets-spec.md`);
  this plan gives it truthful data, and 5c should not ship a picker without it.
- It does not touch `nisps/modes/` orchestration. That is §6.5a
  (`plans/mode-layer-reunification.md`), which is also where the browser event pump belongs — see
  §5 step 6 and decision §8.2.
- It does not change firmware behaviour in any step. Every mode remains fully functional on hardware.
- It does not improve the parity harness, despite §1.3. Fixing stage 3 to trigger a note before
  averaging is a one-line change with a golden-baseline consequence; it belongs with whoever next
  touches `tests/cpp/parity_check.cpp`, and would bump `kVersion` (`:93`).
