---
kind: plan
status: active
---

# Mode-Layer Reunification — the shared control tick (P5 item 5a)

*Dated 2026-07-21. Spec-first, per `simplification-plan.md` §6 ("each item spec-first, own
session"). Closes `ALIGNMENT.md` defect 1; audit findings A1 + A5
(`../recon/simplification-audit-2026-07.md`). **This document authorises no code.** It fixes
the seam, the invariants, the sequence and the verification so an implementation session can
start cold. §8 lists the decisions that must come from the operator before step 3 lands.*

**Every code claim below was re-read against the working tree on 2026-07-21** (`fd0aee2` plus
the uncommitted in-flight work of parallel sessions — `nisps/modes/base.hpp`,
`nisps/wasm/bindings.cpp` and several `manifold/src/engine/` files are all dirty relative to
HEAD, so line numbers are working-tree numbers and may shift by a few lines once those land).
Where a cited document (audit, plan, ALIGNMENT) disagreed with the code, the code won and the
disagreement is called out inline.

Sibling P5 specs written in the same session: `browser-mode-coverage-spec.md` (5b),
`curated-presets-spec.md` (5c), `hardware-editor-spec.md` (5d). This one is 5a.

---

## 0. The gap, stated precisely

`nisps/modes/` compiles into exactly one binary: the firmware. Its consumers are
`firmware/MEMLNaut-NISPS/glue/{mode_select,midi_io,output_router,peripherals,settings_view}.hpp`
and the host tests in `tests/cpp/test_mode_*.cpp`. `nisps/wasm/bindings.cpp` includes eight
engine headers (lines 54–62) and six `nisps/ml/` headers (65–72) and **zero** mode headers —
verified by `grep -n modes nisps/wasm/bindings.cpp`, whose only hit is the word "modes" inside
a comment about `schemas/modes/*.json` (line 90).

The consequence is not that the browser lacks modes. It is that the **control tick** —
`ModeBase::tick_control()`, `nisps/modes/base.hpp:198–234` — exists twice: once in C++ for the
firmware, once hand-assembled in TypeScript for the browser out of `Spine.setInputs`
(`manifold/src/engine/spine.ts:254–303`) plus `ExplorationController`'s two timers
(`manifold/src/engine/exploration.ts:40–42, 57, 84–120`). The primitives underneath (MLP, Jolt,
OU, feedback, pipelines, curves) are already shared; the **orchestration** is not.

That is the whole defect. Everything in this document serves one outcome: *the control tick is
written once, in C++, and both targets call it.*

---

## 1. Verified ground truth

### 1.1 What `ModeBase` actually does today

`nisps/modes/base.hpp`, `ModeBase<Derived, EngineT, MLPType, NInputs>`:

| Responsibility | Where | Notes |
|---|---|---|
| Own the engine, the MLP, the input channels | members, `:322–341` | `input_channels_`, `input_pinned_`, `pin_value_`, `out_buf_`, `jolt_buf_` |
| `setup(sr)` — engine setup, **all channels to 0.5f**, one inference, route to engine, `on_setup` hook | `:126–142` | |
| `set_input(idx, v)` — bounds-drop + clamp to [0,1] | `:165–170` | |
| Input pinning (single/double-joystick neutralise) | `:179–196` | `set_input_pinned` / `set_pin_value` / `effective_input`; driven by `glue/settings_view.hpp` |
| `tick_control()` — the control tick | `:198–234` | order: `on_pre_inference` → jolt step (if active) → `jolt_.tick_lr_ramp()` → forward pinned channels → `ml_.process()` → OU on a copy (if enabled) → `engine_.set_params()` → `on_post_inference` |
| `apply_jolt_()` — get→glide→set of the flat weights | `:312–320` | out-of-line by design |
| Jolt / OU gesture surface | `:241–255` | `jolt_press/release/active/lr_scale`, `set_explore_intensity`, `jolt()`, `ou_noise()` |
| `driver_config()` | `:157–163` | firmware-only concept (codec / mic vs line) |
| Voice-space selection | `:279–290` | delegates to the engine, re-applies params |
| `ControlEvent` ring (`push`/`pop_control_events`) | `:294–305` | drained by `glue/midi_io.hpp:69–98` |
| `process(stereosample_t)` | `:257–259` | pure engine forward, RT |

Firmware drives it from two cores: `tick_control()` on core 0 every 5 ms
(`firmware/MEMLNaut-NISPS/src/main.cpp:154–160`, `ML_INFERENCE_PERIOD_US 5000`), `process()` on
core 1 from the audio callback, and `drain_outputs()` on core 1 at ~1 kHz
(`main.cpp:208–212`).

### 1.2 What the browser does instead

`Spine.setInputs` (`manifold/src/engine/spine.ts:254–303`) is the browser's control tick:

1. `iml.processInput(x, y, dt)` — the 2-D `InputChain` (**no firmware counterpart**, see 1.3).
2. `iml.setInput(i, v)` for every axis → `nisps_ml_set_input` → `MLPCore::set_input`.
3. `iml.processInto(mlBuf)` → `nisps_ml_process`.
4. `iml.processOutput(routedBuf, dt)` — the `OutputChain`.
5. `this.outputMorph(routedBuf)` — the OU walk, registered by
   `ExplorationController`'s constructor (`exploration.ts:57`) → `nisps_ml_explore_apply`.
6. `backendSend(routedBuf)` → `EngineHost.setParams` → `postMessage` → the **worklet's own
   WASM instance** → `nisps_engine_set_params`.

Jolt is driven by a separate 5 ms `setInterval` (`exploration.ts:40, 84–91`) calling
`nisps_ml_jolt_step` + `engine.process()`; the OU walk gets a second 30 ms interval
(`exploration.ts:42, 107–113`).

**Three WASM instances exist**, not one: main thread (`WasmIML` — MLP, feedback, pipelines),
AudioWorklet (`worklet/nisps-processor.ts` — engine only, four exports), and an on-demand
training worker (`wasm-worker.ts` — a mirror MLP). `manifold/ONBOARDING.md` §3 says "loaded
TWICE"; the training worker is a third. This is why a monolithic mode object cannot be bound
(see §2).

### 1.3 The divergences this hand-mirroring has produced

Each row is a fact about the current tree, verified today.

| # | Divergence | Evidence |
|---|---|---|
| D1 | **`nisps_ml_jolt_step` is a line-for-line duplicate of `ModeBase::apply_jolt_`** | `bindings.cpp:842–849` vs `base.hpp:312–320` — same get→copy→`jolt.step`→set sequence, two copies of the code |
| D2 | **Jolt/OU RNG salts differ between targets** | `base.hpp:122–123` uses `0x91E10C5E` / `0x0CEA0FF5`; `bindings.cpp:101–102` uses `0xB01DFACE` / `0x0DDBA11`. The bindings comment claims it "mirrors the firmware ModeBase seeding" — it mirrors the *practice*, not the values. Same seed ⇒ different jolt/OU streams. (`kFeedbackSalt` *is* matched across `bindings.cpp:98` and `glue/peripherals.hpp:58`.) |
| D3 | **OU is applied at a different point in the chain.** Firmware: ML → OU → engine (`base.hpp:216–229`). Browser: ML → OutputChain → OU (`spine.ts:292, 296`). | Consequence: in the browser the per-output **freeze mask holds a value that the OU walk then moves again** — `OutputChain::process` writes `prev_[i]` for frozen dims (`output_chain.hpp:116–119`) and `nisps_ml_explore_apply` perturbs every entry up to `n_out` (`bindings.cpp:880–887`). Freeze is defeated whenever Explore > 0. |
| D4 | **Input clamping and pinning do not exist in the browser.** `nisps_ml_set_input` bounds-checks the index only (`bindings.cpp:434–441`); `MLPCore::set_input` does not clamp (`mlp.hpp:119–122`). No browser path calls anything equivalent to `set_input_pinned`. | The single/double-joystick neutralise is a firmware-only feature today (`glue/settings_view.hpp`), although the operator decision recorded in memory covers "firmware + manifold input toggle" |
| D5 | **Initial state differs.** Firmware `setup()` sets every channel to `0.5f` before its first inference (`base.hpp:129`). The browser's boot inference comes from `ConsoleApp`'s mount effect calling `engine.setInput(0.5, 0.5)` (`ConsoleApp.tsx:268`), and `Spine.setInputs` zero-fills axes 2..N (`spine.ts:277–281`). | For any mode with >2 inputs the two targets boot from different points in input space |
| D6 | **Stateful gestures advance per *call*, not per unit of time.** `Jolt::morph_rate` is documented "EMA per tick, ~1s @200Hz" (`jolt.hpp:44`); `Jolt::tick_lr_ramp` adds a fixed `0.001` per call (`jolt.hpp:107–111`); `OUNoise` uses a fixed internal `dt_ = 0.001f`, *not* the caller's dt (`ou_noise.hpp:74, 96`). Firmware calls the tick at exactly 200 Hz. The browser advances the OU walk on **every spine tick** — i.e. faster when the user moves the pad faster — plus a 33 Hz idle driver. | The same Explore setting produces materially different roam speeds on the two targets, and a browser-side rate that depends on user gesture speed |
| D7 | **`jolt_lr_scale()` has zero consumers on either target.** | `grep -rn 'jolt_lr_scale\|lr_scale' nisps/ firmware/ manifold/src tests/ vcv/src` → only `base.hpp:246`, `jolt.hpp:65`, and tests. The firmware's two `train()` call sites (`glue/peripherals.hpp:89, 225`) do not scale the LR. The documented "training eases back in after a jolt" behaviour is **not wired anywhere**. |
| D8 | **`nisps/pipeline/` is WASM-only.** `InputChain`/`OutputChain` are included by `bindings.cpp:76–77` and `tests/cpp/parity_check.cpp:67–68` and by nothing else. | Firmware has no input conditioning and no output smoothing/slew/freeze. (`simplification-plan` §6.5d already assigns this wiring to the hardware-editor item, L29.) |

D1, D2, D6 are what this document fixes. D3, D4, D5 are fixed as a side effect and are
behaviour changes that need the operator's eyes (§5, §8). D7 and D8 are named here so an
implementer does not "discover" them mid-flight and widen scope; both are out of scope (§9).

---

## 2. What this design deliberately does **not** do

- **It does not bind mode objects into WASM.** A `ModeBase` instance owns an MLP *and* an
  engine. In the browser those live in different threads and different WASM instances
  (§1.2): the MLP on the main thread, the engine in the AudioWorklet, joined by a
  `postMessage` of a `Float32Array` (`engine-host.ts:162–168`). Binding a mode object would
  require either running the engine on the main thread (kills the RT guarantee) or the MLP in
  the worklet (kills training and the whole feedback surface). The two-instance split is a
  locked decision from the one-core refactor; this design respects it.
- **It does not delete the per-primitive C API.** `nisps_ml_*` stays exactly as it is —
  `simplification-plan` §6.5a and audit A5 both say so explicitly, and the parity harness,
  the training worker, the feedback controller and the probe all consume it.
- **It does not move the audio engine, the voice-space surface, the `ControlEvent` ring, or
  `driver_config()`.** Those are the *other* half of a mode and belong to items 5b (browser
  mode coverage / audio topology) and 5d (hardware editor). Mixing them in is how this becomes
  a month.
- **It does not touch `nisps/pipeline/`'s ownership.** The input chain stays a caller-side
  pre-stage and the output chain stays a caller-side post-stage, both on the existing
  `nisps_pipeline_*` handle. Only their *ordering relative to OU* changes (§5).

---

## 3. Invariants

The repo-wide constraints (`CLAUDE.md`) are the floor. These are the ones specific to this area:

1. **`nisps/` stays platform-neutral and heap-free.** The new shared code lives under
   `nisps/modes/`, and its fixed storage policy must be `std::array`-only. The dynamic policy is
   a second deliberate exception to the no-heap rule and must carry the same
   `#if defined(NISPS_TARGET_EMBEDDED) → #error` guard as `nisps/ml/dynamic_storage.hpp:22–24`,
   and must be added to **both** the allowlist branch (`scripts/lint-cpp.sh:146`) and the
   guard-survival check (`:194–198`). Today that script hardcodes exactly one path; generalise
   it to a list rather than adding a second special case.
2. **Firmware behaviour is bit-identical at the current cadence.** With the mode ticked at
   5 ms, every mode's audio output must be unchanged. `tests/cpp/test_mode_learning.cpp`'s
   inert-parity test and `test_mode_paf_synth.cpp`'s reference-vector tests are the existing
   guards; step 1 of §6 adds a stronger one.
3. **The `nisps::Mode` concept keeps its current shape** (`nisps/core/concepts.hpp:70–88`).
   `tick_control()` must remain callable with no arguments, or every mode `static_assert` and
   all of `firmware/glue/` breaks.
4. **The control tick stays bounded and allocation-free.** It runs on core 0 on firmware and on
   the main thread in the browser; neither may block. Any catch-up loop introduced for
   rate-independence (§4.3) must be hard-capped.
5. **Dual-core ownership and SPSC discipline are preserved.** `engine_.set_params()` is written
   from core 0 while `engine_.process()` runs on core 1 — that is the existing arrangement and
   this change must not add a second writer. The `ControlEvent` ring has exactly one producer
   per mode (core 0 for the CC-emitting modes via `on_post_inference`, core 1 for the sequencer
   modes via `pump_engine_events`); the ring must not move into shared code where a mode could
   acquire two producers.
6. **Deterministic per-instance RNG.** Jolt and OU keep their own `nisps::Rng` streams,
   independent of the MLP's and the feedback controller's. After this change the *salts must
   match across targets* (D2) — that is the point.
7. **Native↔WASM parity ≤1e-5 must cover the new code.** The existing harness does not
   (§7). Extending it is part of the work, not a follow-up.
8. **A WASM C-API addition walks all five layers**: `EMSCRIPTEN_KEEPALIVE` →
   `EXPORTED_FUNCS` in `scripts/build-wasm.sh:40–72` → `NispsModule` in
   `manifold/src/engine/types.ts` → `WasmIML` → `EngineApi`. A missed layer fails at runtime.

---

## 4. The design

### 4.1 The seam: `ControlCore<CtlStorage>`

A new header `nisps/modes/control_core.hpp` defining `nisps::ControlCore<CtlStorage>` — the
control tick and nothing else. It is storage-policied exactly the way `MLPCore<Storage>`
(`nisps/ml/mlp.hpp:91–92`) and `FeedbackControllerCore<FbStorage>` (`nisps/ml/feedback.hpp:42–51`)
already are, including the `ControlCore : public CtlStorage` + forwarded-`StorageArgs`
constructor idiom (`mlp.hpp:103–106`).

It **owns**: the input channels, the pin mask and pin value, a `ml::Jolt`, the OU walk and its
state, the produced parameter buffer, and the fixed-rate accumulator.

It **does not own** the MLP. Like `FeedbackControllerCore`, every method that needs the network
takes it by reference as a method-level template, so a `MLPCore<FixedStorage>` and a
`MLPCore<DynamicStorage>` both work:

```cpp
namespace nisps {

template <typename CtlStorage>
class ControlCore : public CtlStorage {
 public:
  template <typename... StorageArgs>
  explicit ControlCore(std::uint64_t seed, StorageArgs&&... args) noexcept;

  bool valid() const noexcept;                       // dynamic storage may fail to allocate

  // ---- input channels (was ModeBase :165–196) ----
  void  set_input(std::size_t idx, float v) noexcept;      // bounds-drop + clamp [0,1]
  void  set_input_pinned(std::size_t idx, bool p) noexcept;
  bool  is_input_pinned(std::size_t idx) const noexcept;
  void  set_pin_value(float v) noexcept;
  float pin_value() const noexcept;
  float effective_input(std::size_t i) const noexcept;
  std::span<const float> input_channels() const noexcept;
  std::span<float>       mutable_input_channels() noexcept;  // SoundAnalysisMIDI's hook

  // ---- gestures (was ModeBase :241–255) ----
  void  jolt_press(std::size_t weight_count) noexcept;
  void  jolt_release() noexcept;
  bool  jolt_active() const noexcept;
  float jolt_lr_scale() const noexcept;
  void  set_explore_intensity(float level) noexcept;
  float explore_intensity() const noexcept;

  // ---- the tick ----
  // Runs `n` fixed-rate control steps (n derived from dt_s, see 4.3), one
  // inference, and the OU walk. Returns the produced parameter vector — a
  // STABLE span into this object's own buffer, valid until the next reshape.
  template <typename MLPT>
  std::span<const float> tick(MLPT& ml, float dt_s) noexcept;

  std::span<const float> params() const noexcept;   // same span, without ticking
  void reset() noexcept;                            // clears OU state + accumulator
};

}  // namespace nisps
```

### 4.2 Storage policies

Surface (documented in the header the way `nisps/ml/storage.hpp:20–28` documents the MLP's):

```
dims:     n_in(), n_out()
buffers:  input_channels(), input_pinned(), out_buf(), ou_state()
validity: valid()
```

- `nisps/modes/control_storage.hpp` — `FixedControlStorage<NIn, NOut>`: four `std::array`
  members, all dims `constexpr`-foldable, zero heap. Firmware + host tests.
- `nisps/modes/dynamic_control_storage.hpp` — `DynamicControlStorage`: dims at construction,
  **one arena allocation in the constructor and none after**, `#error` under
  `NISPS_TARGET_EMBEDDED`. Browser only. Mirrors `nisps/ml/dynamic_storage.hpp` file-for-file
  in shape so the lint allowlist reads as one pattern rather than two exceptions.

`FixedControlStorage`'s buffers are ~`2*NIn + 2*NOut` floats — for MEMLCelium (4 in, 56 out)
about 480 bytes.

**`jolt_buf_` is deleted, not moved.** `ModeBase::jolt_buf_` is a
`std::array<float, MLPType::weight_count()>` (`base.hpp:341`) — **6,152 bytes of SRAM on every
MEMLCelium-class mode** (`MLP<4,10,14,18,56>` ⇒ 1,538 weights). It exists only to hold a copy of
the flat weights across `jolt_.step()`. But `MLPCore`'s storage already owns exactly such a
buffer: `flat_buf()` (`nisps/ml/storage.hpp:164`, `nisps/ml/dynamic_storage.hpp:162`), which is
what `get_weights()` fills (`mlp.hpp:385–400`). Add a `std::span<float> weights_scratch()`
accessor to `MLPCore` and the jolt step becomes:

```cpp
const auto w = ml.get_weights();            // fills the storage's flat buffer
jolt_.step(ml.weights_scratch().first(w.size()));
ml.set_weights(ml.weights_scratch().first(w.size()));
```

`MLHandle::jolt_scratch` (`bindings.cpp:167`, a `std::vector<float>`) goes the same way.

**`OUNoise` loses its template parameter and splits `apply()` in two.**
`ml::OUNoise<N>` (`nisps/ml/ou_noise.hpp:44–99`) holds `std::array<float, N> state_` and its
`apply()` advances the walk and adds it to the output in one loop (`:68–81`). Two changes:
(i) the state span comes from the caller, so `OUNoise` becomes a plain class and `ControlCore`'s
storage owns the state; (ii) split into `advance(std::span<float> state)` and
`add_to(std::span<float> out, std::span<const float> state)`, because a catch-up tick must
advance N times and add once (§4.3a). Both keep the existing early-out at intensity 0, so the
inert path stays free and parity-safe. This also deletes the browser's
`OUNoise<kMaxDim>` — a 16 KB fixed array (`bindings.cpp:166`) sized for a net that is never
4096-wide. Three call sites: `base.hpp`, `bindings.cpp`, `tests/cpp/test_mlp_ou_noise.cpp`.
*Lower-risk fallback if this proves noisy: keep `OUNoise<N>` and have each storage policy expose
an `OU` typedef at its own N. It costs the browser its 16 KB and leaves a template where none is
needed, but it is strictly smaller.*

### 4.3 The canonical tick

```
tick(ml, dt_s):
    steps = accumulate_steps(dt_s)              # see below; firmware @5ms => exactly 1
    for s in 0..steps-1:
        if jolt.active(): jolt.step(ml's flat weight scratch) ; ml.set_weights(...)
        jolt.tick_lr_ramp()
    for i in 0..n_in-1:  ml.set_input(i, effective_input(i))
    ml.process()
    copy ml.outputs() -> out_buf                # ALWAYS, see below
    for s in 0..steps-1: ou.advance(ou_state)   # no-op while disabled
    ou.add_to(out_buf, ou_state)                # no-op while disabled
    return out_buf
```

Four decisions are baked in here; each is a change from at least one target's current behaviour.

**(a) Fixed-rate stepping (fixes D6).** `ControlCore` owns a `float accum_` and a compile-time
`kControlPeriodS = 1.f / 200.f`. `accumulate_steps(dt_s)` adds `dt_s`, takes out whole periods,
and **caps the result at `kMaxCatchUpSteps` (8)** — invariant 4. At the firmware's exact 5 ms
cadence this yields exactly one step with zero residual, so firmware is unchanged; in the browser
a 30 ms driver call performs six steps and the walk becomes wall-clock-correct regardless of how
fast the user moves the pad. The rate constant, not wall-clock dt, stays the calibration for
`Jolt::morph_rate`, `Jolt::lr_ramp_step` and `OUNoise::dt_` — those are shape constants tuned at
200 Hz upstream. Re-deriving them from wall-clock dt is *not* equivalent: `OUNoise::dt_` is
`0.001`, not the firmware's 5 ms period, so feeding wall-clock dt would multiply firmware's
mean-reversion term by 5 and its per-step noise by √5.

**(b) Inference runs once per `tick()`, not once per control step.** Only the stateful walks are
rate-sensitive; a forward pass is idempotent given the same inputs and weights. This keeps a
catch-up tick cheap.

**(c) The output copy is unconditional.** Today firmware skips the copy when OU is disabled and
hands `ml_.outputs()` straight to the engine (`base.hpp:228`). If `tick()` did that, the returned
span would sometimes point into the MLP's output buffer and sometimes into `out_buf` — a
pointer-stability footgun for the C API, which caches the pointer JS-side. Always copying costs
`n_out` floats per tick (56 at 200 Hz for MEMLCelium: ~11 k float copies/s against a 1,538-weight
forward pass at the same rate) and is bit-identical.

**(d) OU is applied to the mode's parameter vector, before any caller-side output chain
(changes the browser — D3).** Firmware order is preserved; the browser's `OutputChain` moves from
*before* the OU walk to *after* it. Rationale: OU is part of what the mapping *produces*; the
output chain is how the *destination* conditions it. This is also what makes per-output freeze
mean something again. It is user-audible — see §5 and §8-Q1.

### 4.4 `ModeBase` afterwards

`ModeBase` keeps its entire public surface (invariant 3) and becomes a composition:

```cpp
NISPS_HOT void tick_control(float dt_s = kControlPeriodS) noexcept {
    if constexpr (requires(Derived& d) { d.on_pre_inference(); })
        static_cast<Derived&>(*this).on_pre_inference();
    const auto params = control_.tick(ml_, dt_s);
    if constexpr (kRouteOutputsToEngine) engine_.set_params(params);
    if constexpr (requires(Derived& d) { d.on_post_inference(); })
        static_cast<Derived&>(*this).on_post_inference();
}
```

with `control_` a `ControlCore<FixedControlStorage<NInputs, MLPType::kOutput>>`, and
`set_input` / `set_input_pinned` / `pin_value` / `input_channels` / `mutable_input_channels` /
`jolt_*` / `set_explore_intensity` / `explore_intensity` all one-line forwards. The default
argument preserves the concept and every existing call site (`main.cpp:157`,
`test_mode_*.cpp`).

What stays in `ModeBase`: the engine, the CRTP hooks, `setup()`, `driver_config()`,
`set_voice_space()`, the `ControlEvent` ring, `process()`. What leaves: the input-channel state,
`jolt_`, `ou_`, `out_buf_`, `jolt_buf_`, `apply_jolt_()`.

Two accessors need a call: `ml::Jolt& jolt()` (`base.hpp:247–248`) has **no consumer outside
`base.hpp`** — delete it. `ml::OUNoise& ou_noise()` (`:254–255`) is used by
`tests/cpp/test_mode_learning.cpp:89–103` — keep it (forwarding into `control_`) or rewrite those
three assertions against `explore_intensity()`; implementer's call.

The seeding fix (D2) rides along: `ControlCore`'s constructor takes the salts, and both targets
pass the same ones. Name them once, in `control_core.hpp`, as
`kJoltSalt = 0x91E10C5Eull` / `kOUSalt = 0x0CEA0FF5ull` (the firmware's current values, so
firmware weight streams are unchanged; the browser's jolt/OU streams change, which no committed
artifact or golden depends on — verified: no fixture, parity stage or e2e drives jolt/OU).

### 4.5 The browser afterwards

`MLHandle` (`bindings.cpp:148–185`) drops `jolt`, `ou` and `jolt_scratch` and gains one
`ControlCore<DynamicControlStorage>` member, constructed at `(d.n_in, d.n_out)` and rebuilt by
`nisps_ml_reshape` alongside the feedback controller (`bindings.cpp:396–421`).

The existing `nisps_ml_jolt_*` and `nisps_ml_explore_intensity` entries stay in place and
**forward into the head** — so the per-primitive C API survives (§2) while its *implementation*
stops being a second copy (kills D1).

`Spine.setInputs` becomes:

1. `iml.processInput(x, y, dt)` — unchanged.
2. `iml.setControlInput(i, v)` for each axis → `nisps_control_set_input` (clamped + pin-aware).
3. `iml.controlTick(dt)` → `nisps_control_tick` — replaces today's steps 3 *and* 5.
4. read the raw ML outputs (`nisps_ml_outputs`) into `mlBuf` for `liveOutputs`, and the head's
   params (`nisps_control_params`) into `routedBuf`.
5. `iml.processOutput(routedBuf, dt)` — unchanged call, now *after* the OU walk.
6. `backendSend(routedBuf)` — unchanged.

`Spine.setOutputMorph` and the `outputMorph` field are **deleted** (`spine.ts:105–109, 221–229,
294–296`); its only consumer is `ExplorationController`'s constructor and `dispose`
(`exploration.ts:57, 131`). `ExplorationController` collapses from two timers to one ~60 Hz
driver that exists while `joltActive() || exploreIntensity() > 0` and simply calls
`engine.process()` — the fixed-rate accumulator makes the driver's exact period irrelevant.

### 4.6 The C API additions — the five-layer walk

| Export | `bindings.cpp` | `build-wasm.sh` `EXPORTED_FUNCS` | `types.ts` `NispsModule` | `WasmIML` | `EngineApi` |
|---|---|---|---|---|---|
| `void nisps_control_set_input(void* ml, int idx, float v)` | new | add | add | `setControlInput` | via `spine` |
| `void nisps_control_set_input_pinned(void* ml, int idx, int pinned)` | new | add | add | `setControlInputPinned` | `EngineApi.control.setInputPinned` |
| `void nisps_control_set_pin_value(void* ml, float v)` | new | add | add | `setControlPinValue` | `EngineApi.control.setPinValue` |
| `int nisps_control_tick(void* ml, float dt_s)` → n params | new | add | add | `controlTick` | via `spine` |
| `const float* nisps_control_params(void* ml)` | new | add | add | (internal) | — |
| `void nisps_ml_explore_apply(void* ml, float*, int)` | **delete** (`:880–887`) | **remove** (`:63`) | **remove** (`:133`) | **remove** `exploreApply` | **remove** `explore.exploreApply` |

Deleting `nisps_ml_explore_apply` is safe: its consumers are `WasmIML.exploreApply` →
`EngineApi.explore.exploreApply` → `exploration.ts:57`, all of which this change removes. It is
**not** touched by `tests/cpp/parity_wasm.mjs`, `manifold/tests/`, or `src/debug/probe.ts`
(verified by grep). Re-verify before deleting.

`nisps_ml_set_input` **stays**: `tests/cpp/parity_wasm.mjs` drives parity stage 1 through it, and
it is the raw-MLP write that `infer_batch` and the training worker semantics assume. The two are
distinguished in the header comment: `nisps_ml_set_input` = raw network input; `nisps_control_set_input`
= the mode control path (clamped, pinnable).

### 4.7 Deletions, with named consumers

| Deleted | Named consumers, and what happens to them |
|---|---|
| `ModeBase::jolt_buf_` (`base.hpp:341`) + `apply_jolt_` (`:312–320`) | `tick_control` only → replaced by `ControlCore::tick` over `MLPCore::weights_scratch()` |
| `MLHandle::jolt_scratch` (`bindings.cpp:167`) | `nisps_ml_jolt_step` only → same |
| `MLHandle::jolt`, `MLHandle::ou` (`:165–166`) | the `nisps_ml_jolt_*` / `nisps_ml_explore_*` bodies → forward into `control` |
| `ModeBase::ou_` / `out_buf_` / `input_channels_` / `input_pinned_` / `pin_value_` | `ModeBase` methods only → forwarded into `control_` |
| `ml::OUNoise<N>`'s template parameter + `state_` | `base.hpp`, `bindings.cpp:166`, `tests/cpp/test_mlp_ou_noise.cpp` → state moves to `ControlCore`'s storage |
| `ModeBase::jolt()` accessor (`:247–248`) | none — verified by grep across `nisps/ firmware/ manifold/ tests/ vcv/` |
| `nisps_ml_explore_apply` + its 4 downstream layers | see 4.6 |
| `Spine.outputMorph` + `setOutputMorph` (`spine.ts:105–109, 221–229, 294–296`) | `exploration.ts:57, 131` only |
| `ExplorationController`'s `joltTimer`/`exploreTimer` pair | internal → one driver |

---

## 5. Behaviour changes this lands

Stated plainly, because two of them are audible.

1. **Browser: the output chain now runs after the OU walk** (D3). With Explore > 0, per-output
   freeze actually freezes, and the EMA/slew smooth the OU walk instead of the walk overwriting
   smoothed values. Audible whenever Explore > 0 *and* smoothing/slew/freeze are non-default.
2. **Browser: the OU roam rate becomes wall-clock-correct and gesture-independent** (D6).
   Today the walk advances once per spine tick, so it roams faster while the user is moving.
   After: a fixed 200 steps/second. At the current 33 Hz idle driver the browser's walk is
   ~6× slower than firmware's; after the change they match. **Existing Explore slider positions
   will feel different** — most users will want a lower setting.
3. **Browser: inputs are clamped to [0,1] and honour a pin mask** (D4). No current caller feeds
   out-of-range values, so this is latent until the pin mask is wired into the UI (5c).
4. **Browser: jolt/OU RNG streams change** (D2), because the salts become the firmware's. No
   committed artifact depends on them.
5. **Firmware: no behaviour change.** The tick order, the constants, the cadence and the
   arithmetic are preserved by construction; §6 step 1 makes that a test rather than a claim.
   The one *near*-exception is `jolt_lr_scale()`, whose ramp accumulates identically per step —
   and which has no consumers on either target (D7).

---

## 6. Sequenced implementation plan

Each step is separately landable and separately verifiable. Step 1 is pure C++ and changes no
behaviour anywhere. Step 2 adds the browser-side plumbing and, because the jolt/OU salts and the
fixed-rate accumulator take effect as soon as `bindings.cpp` forwards into the head, it already
carries §5.2 and §5.4. Step 3 is the browser swap and carries §5.1 and §5.3.

**Sequencing hazard:** `nisps_ml_explore_apply` must be deleted in **step 3**, not step 2 — it is
still called by `WasmIML.exploreApply` until the TS swap lands, and removing the export first
leaves a runtime failure that no compiler catches (invariant 8, in reverse).

### Step 0 — capture a firmware-behaviour baseline (half a day)

Add `tests/cpp/test_mode_control_tick.cpp` to the `nisps_modes_tests` target
(`nisps/CMakeLists.txt:119–128`) that pins the *current* `tick_control` for at least PAFSynth,
MEMLCelium and SoundAnalysisMIDI: N ticks with a scripted input trace, asserting the exact
engine-param vector and the exact ML output vector, with Jolt and Explore both exercised.
Land it **before** touching `base.hpp` so it is a genuine before/after.

*Verification:* `bash scripts/build-cpp-tests.sh` (baseline today: 4/4 ctest suites pass in
0.03 s — run and confirmed 2026-07-21).

### Step 1 — `ControlCore` + fixed storage; `ModeBase` composes it (1–2 days)

New: `nisps/modes/control_storage.hpp`, `nisps/modes/control_core.hpp`. Modified:
`nisps/modes/base.hpp` (compose + forward), `nisps/ml/mlp.hpp` (`weights_scratch()`),
`nisps/ml/ou_noise.hpp` (externalise state). Concrete mode headers should need **no changes** —
if one does, the forwarding surface is wrong.

*Verification:* step 0's baseline test must pass **unchanged** — that is the whole point of doing
it first. Plus `nisps_modes_tests`, `nisps_core_tests`, `scripts/lint-cpp.sh`, and a firmware
compile of at least `slpworkshop`, `pafsynth`, `soundanalysismidi` via `scripts/build-firmware.sh`
(needs `nix-shell -p platformio-core`; first build pulls 1–2 GB). Compare flash/RAM against the
pre-change build — the expectation is a **reduction** of roughly `weight_count() * 4` bytes of
RAM (6,152 for MEMLCelium-class modes) from the `jolt_buf_` deletion. A size *increase* means
the composition failed to inline and wants investigating.

*Not verifiable here:* that the hardware still boots and sounds right. Operator chokepoint,
same as every firmware change in this repo.

### Step 2 — dynamic storage + the C API + parity coverage (1–2 days)

New: `nisps/modes/dynamic_control_storage.hpp`. Modified: `nisps/wasm/bindings.cpp` (MLHandle
member, reshape, the five new `nisps_control_*` exports, the `nisps_ml_jolt_*` /
`nisps_ml_explore_intensity` bodies forwarding into the head — but **not** the
`nisps_ml_explore_apply` deletion, which waits for step 3), `scripts/build-wasm.sh`,
`scripts/lint-cpp.sh` (allowlist → list).

**Add parity stage 8** to `tests/cpp/parity_check.cpp` and `tests/cpp/parity_wasm.mjs`: drive a
`ControlCore` over the harness's `MLP<32,10,14,18,126>` through a scripted trace — inputs set,
some channels pinned, a jolt pressed and released across several ticks, Explore raised, at least
one catch-up tick with `dt_s` > one period — and push the parameter vector plus a weight probe.
Bump `kVersion` 5 → 6 (`parity_check.cpp:93`) in both drivers, and extend the header's
authoritative stage list (`:14–33`) and `parity_diff.mjs`'s section names.

This is the step that converts "a parity PASS is not evidence for this change" into "it is".
Without stage 8, `scripts/parity-check.sh` exercises PAFSynth and ChannelStrip under an
all-params-0.5 vector and says nothing whatsoever about the control tick.

*Verification:* `bash scripts/build-wasm.sh && bash scripts/parity-check.sh` (both native and
WASM at 1e-5, now including stage 8); `bash scripts/lint-cpp.sh`;
`bash scripts/build-cpp-tests.sh`. `emcc`, `bun`, `cmake` and `ninja` are all on PATH here, so
this step is fully verifiable locally.

### Step 3 — the browser swap (1–2 days)

Modified: `manifold/src/engine/types.ts`, `wasm-iml.ts`, `engine-api.ts`, `spine.ts`,
`exploration.ts`. Deleted: `Spine.setOutputMorph` + the `outputMorph` field, `exploreApply`
through all four TS layers, one of the two exploration timers.

Rebuild and **commit** `manifold/public/nisps.{js,wasm}` in the same change — the webhook builds
only `manifold/` and ships whatever is committed (`manifold/ONBOARDING.md` §2), and CI's WASM
freshness gate runs the parity harness against the committed artifact before rebuilding it.

*Verification:* `cd manifold && bun run typecheck && bun run test && bun run build`, then
Playwright. Note that `manifold`'s test script is deliberately `bun test src tests/*.test.ts` —
do not "fix" it to `tests`, that drags the e2e suite into the unit run. On the VPS, e2e needs the
non-snap node runner (`ONBOARDING.md` §2).

Add e2e coverage for the two changes users can see, in `manifold/tests/e2e/`:
- Explore > 0 with a freeze mask set ⇒ the frozen outputs do **not** move (this fails today).
- Explore > 0 with the pad held still ⇒ the routed vector's drift over 2 s is within a
  tolerance band, i.e. wall-clock-rated rather than tick-rated.

A unit test in the `bun test` set driving `nisps_control_tick` straight at the committed WASM —
the way `manifold/tests/loss-history.test.ts` drives `nisps_ml_loss_history` — is the cheapest
guard on the C ABI and should exist too.

### Step 4 — documentation sync (same commits)

`MAP.md` (`nisps/modes/` and `nisps/wasm/` bullets), `docs/specs/MAIN.md` (registry row +
"Loaded TWICE" is wrong — it is three instances), `manifold/ONBOARDING.md` §3 (same),
`ALIGNMENT.md` defect 1 (delete it when step 3 lands, per the repo's doc-sync rule),
`simplification-plan.md` §6.5a (burn down), and this file's `status:` → `executed`.

---

## 7. What the verification actually covers — and what it does not

| Claim | Covered by | Confidence |
|---|---|---|
| Firmware tick behaviour unchanged | step 0's pinned baseline + `nisps_modes_tests` | **High** — it is a before/after on the exact byte values |
| Fixed↔dynamic control head agree | parity stage 8 (step 2) | **High**, once written |
| Native↔WASM agreement of the new code | `scripts/parity-check.sh` **after** stage 8 exists | High after; **zero** before — the current harness touches neither modes nor jolt nor OU |
| The C API is reachable end-to-end | the `bun test` C-ABI test + Playwright | Medium-high — the 5-layer chain fails at runtime, so a browser-level test is the only real proof |
| Freeze is no longer defeated by Explore | new e2e case | High |
| OU roam rate is wall-clock | new e2e case (tolerance band) | Medium — timing assertions in a browser are inherently soft; keep the band wide |
| Firmware flash/RAM does not regress | `firmware-build` CI job's per-variant report + local `pio run` | High for size |
| **The hardware still boots and sounds correct** | *nothing* | **None.** This is an operator chokepoint, as it was for the PlatformIO cut (`simplification-plan` §5) |
| Engines other than PAFSynth/ChannelStrip behave identically | `nisps_dsp_engine_tests` + `engine_impulse` baseline; unchanged by this work | High, and unaffected — no engine code is touched |

Honest summary: everything except on-device behaviour can be verified in CI, **provided stage 8
is written**. If the implementation session runs out of time and skips stage 8, the change should
not land: the parity gate would go green while covering none of it.

---

## 8. Open questions for the operator

**Q1. The output-chain / OU ordering (§4.3d, §5.1) — confirm.** The recommendation is the
firmware's order: OU is part of the mapping, the output chain conditions what the destination
receives, and per-output freeze starts working. It changes the browser's sound whenever Explore
is up and smoothing/slew/freeze are non-default. The alternative — keeping each target's current
order — means the tick is not actually unified and needs a per-target branch, which is the thing
this whole item exists to remove. **Recommend: adopt the firmware order.**

**Q2. Fixed 200 Hz control rate as a shared contract (§4.3a) — confirm.** This makes the
browser's Explore feel roughly 6× faster at the same slider position. Options: (a) adopt it and
accept that existing slider positions read differently; (b) adopt it and rescale
`kOUMaxAmplitude` or the slider mapping so the browser's *current* feel is preserved — which
then changes the *firmware's* feel; (c) adopt it and expose the rate as a per-target constant,
which re-forks the behaviour. **Recommend (a)**, with a note in the Learning drawer copy.

**Q3. `jolt_lr_scale()` (D7) — wire it or delete it?** It is documented on both `Jolt` and
`ModeBase` as gating the learning rate after a jolt, and *nothing on either target multiplies by
it*. Wiring it means touching the firmware's two `train()` call sites and the browser's train
path — a behaviour change to training, not to this seam. Deleting it removes a documented
feature. It is cheap either way once `ControlCore` exists. **Not blocking**; needed before this
item can be called done rather than parked.

**Q4. Does the browser's input pin mask (D4) get UI in this item or in 5c?** The C API and the
core behaviour come free with `ControlCore`. Rendering a Single/Double control in the Inputs
drawer is UI work that belongs with the curated/advanced split
(`plans/curated-presets-spec.md`). **Recommend: ship the API in this item, the UI in 5c**, and
say so in `inputs-spec.md`.

**Q5. `DynamicControlStorage`'s home.** Recommended: `nisps/modes/`, with `lint-cpp.sh`'s
allowlist generalised from one hardcoded path to a list. The alternative — defining the dynamic
storage policy inside `nisps/wasm/bindings.cpp`, where heap is already legitimate and the lint
does not look — needs no lint change at all, but puts a storage policy outside `nisps/` where a
future consumer (VCV, a native fixture) cannot reach it. **Recommend `nisps/modes/`**; it is a
~10-line shell change and it keeps the "one auditable exception list" discipline.

Not asked, because they were decided here and are recorded rather than open: `ControlCore` does
not own the MLP (§4.1, matching `FeedbackControllerCore`); the parameter copy is unconditional
(§4.3c); the jolt scratch buffer is deleted in favour of `MLPCore`'s existing flat scratch
(§4.2); `OUNoise` loses its template parameter (§4.2); the salts become the firmware's (§4.4).

---

## 9. Explicitly out of scope

- **The engine half of a mode in the browser** — voice-space selection, `note_on`, transport
  (`set_playing`/`update_bpm`), and the `ControlEvent` drain have no browser surface at all
  (verified: `grep -rn 'voiceSpace\|noteOn\|setPlaying\|popEvents' manifold/src` returns only
  generated-schema data). That is item **5b** — see `plans/browser-mode-coverage-spec.md` — and
  it is the reason four catalogued modes cannot actually run in the browser.
- **Firmware `InputChain`/`OutputChain` wiring (D8, L29)** — assigned to **5d** by
  `simplification-plan` §6.5d; see `plans/hardware-editor-spec.md`. This item only fixes where OU
  sits relative to a chain the caller already owns.
- **Feedback-controller ownership.** Firmware keeps it as a function-local static in
  `glue/peripherals.hpp:152`; the browser keeps it inside `MLHandle`. Both already call the same
  shared core, so it is an asymmetry, not a duplication. The related `FOLLOW-UP` comment at
  `glue/peripherals.hpp:33–39` (hold `feedback.static_output()` while Placing instead of running
  fresh inference) *would* have a natural home in `ControlCore::tick` once it exists — note it,
  do not build it here.
- **The browser's multi-anchor ExploreAndPlace session policy**
  (`manifold/src/feedback/controller.ts:200–290`) differs from the firmware's freeze-and-carry
  gesture. That is an application-policy divergence above the core, not a core duplication.
- **`jolt_lr_scale` wiring** (Q3) and **the pin-mask UI** (Q4).

---

## 10. Source-file index

Read in this order.

**The gap**
- `nisps/modes/base.hpp` — `ModeBase`; the tick is `:198–234`, the jolt copy `:312–320`
- `nisps/wasm/bindings.cpp` — `MLHandle` `:148–185`, jolt/OU C API `:827–886`, reshape `:396–421`
- `manifold/src/engine/spine.ts` — `setInputs` `:254–303`, the morph hook `:105–109, 221–229`
- `manifold/src/engine/exploration.ts` — the two timers and the morph registration

**The pattern being copied**
- `nisps/ml/mlp.hpp:91–116` + `nisps/ml/storage.hpp` + `nisps/ml/dynamic_storage.hpp` —
  `MLPCore<Storage>`, the storage-surface documentation style, the embedded `#error` guard
- `nisps/ml/feedback.hpp:42–61` — `FeedbackControllerCore<FbStorage>`, and the
  "does NOT own the MLP" convention this design follows

**Consumers that must keep compiling unchanged**
- `firmware/MEMLNaut-NISPS/glue/peripherals.hpp`, `settings_view.hpp`, `midi_io.hpp`,
  `output_router.hpp`, `src/main.cpp:154–160`
- `tests/cpp/test_mode_{concepts,paf_synth,voice_space,breakor_events,learning,curve_overrides,driver_config}.cpp`
- `nisps/modes/sound_analysis_midi.hpp:86–111` and `external_synth_midi.hpp` — the only modes
  with `on_pre_inference` / `on_post_inference` hooks, i.e. the sharpest test of the forwarding
  surface

**Gates**
- `scripts/build-cpp-tests.sh`, `scripts/parity-check.sh`, `scripts/lint-cpp.sh`,
  `scripts/build-wasm.sh`, `scripts/build-firmware.sh`, `.github/workflows/ci.yml`
- `tests/cpp/parity_check.cpp:14–33` (the authoritative stage list) + `parity_wasm.mjs` +
  `parity_diff.mjs`
