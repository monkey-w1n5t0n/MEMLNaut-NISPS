---
stability: evolving
layer: binding
---

# SLP-Workshop Firmware, Learning Gestures & Output Modes

> The single spec for **SLP-Workshop** (built for a workshop at Synth Library
> Portland). It has two parts:
>
> - **Part I (§1–8) — shipped & stable.** The `slp_workshop` mode and the two
>   adaptive-learning gestures it introduced — **Jolt** (held continuous weight
>   morph) and **OU explore** (Ornstein-Uhlenbeck output walk). These live in the
>   shared mode base, so every mode gains them; SLP-Workshop is the mode that
>   surfaces them. Built and merged.
> - **Part II (§9–13) — planned / evolving.** The output-mode evolution: the
>   Continuous/Rhythm stream model, gate sequences, and the Manifold-side
>   configuration UX so firmware and browser stay aligned. **Not implemented
>   yet** — this part fixes the model and shapes, not the final counts.
>
> The file is marked `evolving` because Part II is still being figured out; treat
> Part I as the stable baseline and Part II as the agreed direction.
>
> Migrated from `docs/slp-workshop/SPEC.md` (folded in 2026-06-28; donor removed).
> Provenance of Part I: branch `workshop/synth-fw-audit` (commits `4e60d01` core +
> firmware, `57c9ede` browser controls); merged to `main` at `527b8fc`.

## Source files

- `nisps/modes/slp_workshop.hpp` — `nisps::modes::SLPWorkshopMode` (mode_id `slp_workshop`); reuses the MEMLCelium engine + MLP shape verbatim.
- `nisps/engines/memlcelium.hpp` — the shared engine: one `MLP<4,[10,14,18],56>`, 56 outputs split into sequencer + synthesis; exposes `pop_events()`.
- `nisps/ml/jolt.hpp` — `ml::Jolt`: held-gesture continuous weight morph + post-release LR ramp.
- `nisps/ml/ou_noise.hpp` — `ml::OUNoise<N>`: Ornstein-Uhlenbeck random walk on the output vector.
- `nisps/modes/base.hpp` — `nisps::ModeBase` CRTP base; owns `jolt_`/`ou_` and the guarded integration points.
- `nisps/core/perf.hpp` — `NISPS_NOINLINE` macro (added for the GCC workaround).
- `schemas/modes/slp_workshop.json` — mode schema (engine_id `memlcelium`, 56 params identical to MEMLCelium).
- `nisps/modes/generated/slp_workshop_schema.hpp`, `playground/src/modes/generated/slp_workshop_schema.ts` — codegen outputs.
- `firmware/MEMLNaut-NISPS/glue/mode_select.hpp` — `MEMLNautModeSLPWorkshop` alias.
- `firmware/MEMLNaut-NISPS/MEMLNaut-NISPS.ino` — selectable `MEMLNAUT_MODE_TYPE` line.
- `firmware/MEMLNaut-NISPS/glue/peripherals.hpp` — TogB1 (Jolt) + RVX1 (explore) control wiring.
- `playground/src/modes/SLPWorkshopMode.tsx`, `playground/src/modes/mode-runtime.ts` — browser controls.
- `playground/src/ml/jolt.ts`, `playground/src/output/ou-explore.ts` — browser-side gesture math.
- `tests/cpp/test_mlp_jolt.cpp`, `tests/cpp/test_mlp_ou_noise.cpp`, `tests/cpp/test_mode_learning.cpp`, `tests/cpp/test_mode_concepts.cpp` — anchoring tests.
- **Part II companions (planned work):** `docs/useq-celium/protocol.md` (CV wire protocol), `manifold/src/backends/` (CV/MIDI output backends), `manifold/src/inputs/` (input layer).

---

# Part I — Shipped: mode + adaptive-learning gestures

## 1. Frame

1.1 SLP-Workshop is a distinct nisps mode (`nisps::modes::SLPWorkshopMode`, mode_id `slp_workshop`) that **MUST** reuse the MEMLCelium engine and MLP shape verbatim: engine_id stays `memlcelium`, and the MLP is `MLP<4, 10, 14, 18, 56>`.
**Why:** the workshop wanted its own identity (preset directory, display name) and a UI that foregrounds the two adaptive-learning gestures, but no new synthesis behaviour — so the synthesis mapping is byte-for-byte MEMLCelium's, and only the mode wrapper, identity, and surfaced controls differ.

1.2 The synthesis mapping in SLP-Workshop **MUST** stay identical to `MEMLCeliumMode` for the same seed and inputs.
**Why:** the two adaptive-learning gestures live in the shared base (§5), not in this mode; SLP-Workshop adds only identity and control surfacing. A test asserts SLP-Workshop ≡ MEMLCelium (same seed, identical audio) with the new features off.

1.3 Firmware compiles exactly one mode at a time (`MEMLNAUT_MODE_TYPE`), so the per-mode code cost of an extra mode is negligible.
**Why:** modes are selected at compile time, not linked together; an unused mode contributes nothing to the firmware image.

---

## 2. Why the gestures exist (the investigation)

2.1 Upstream `MusicallyEmbodiedML/MEMLNaut-NISPS` advanced its `memllib` submodule past our fork point (`188496d` → `e291192`). Both upstream MEMLCelium and DJFX share the **same** learning code, `InterfaceRL` (reinforcement: thumbs + joystick); there is no per-mode learning algorithm.
**Why:** establishes that the only thing to port was learning-algorithm changes in one shared file, not mode-specific behaviour.

2.2 The only post-fork **learning-algorithm** gains our fork lacked were **Jolt** (upstream commit `9fcd459`) and **Ornstein-Uhlenbeck exploration noise** (`d0d8a72`). These two **were** ported.
**Why:** scopes the port to exactly these two algorithms.

2.3 The upstream "dislike / geometric-push" cluster **MUST NOT** be ported.
**Why:** it depends on a firmware-only `ReplayMemory` our fork intentionally does not keep (recorded in `ALIGNMENT.md`); porting it would reintroduce that buffer.

2.4 The upstream `staticmlp` refactor (`770a990`) **MUST NOT** be ported.
**Why:** our `MLP` already exceeds it — it is already a fixed-size, no-heap template.

2.5 DJFX's FX DSP chain **MUST NOT** be ported.
**Why:** the operator explicitly did not want DJFX's FX; only the learning changes were in scope.

---

## 3. Jolt (`ml/jolt.hpp`)

3.1 Jolt is a **HELD** gesture operating on the MLP's flat weight buffer via `get_weights()` / `set_weights()` / `weight_count()`, so it **MUST** be architecture-agnostic (independent of layer count or width).
**Why:** the same gesture must work unchanged across every mode's MLP shape.

3.2 On press, Jolt **MUST** pick `num_weights = 40` random global indices into the flat weight buffer, each with a random target in `[-1.2, 0.9]`.
**Why:** these are the upstream `kJolt*` constants reproduced verbatim; the target range matches the weight-init range so jolted weights stay in a plausible regime.

3.3 Each control tick while held, for each selected weight `w`: `w += 0.017 * (target - w)`; when `|target - w| < 0.05`, the target for that weight **MUST** be re-rolled.
**Why:** an EMA glide toward a moving target means the morph never settles — re-rolling on arrival keeps the sound continuously evolving while the button is held.

3.4 On release, Jolt **MUST** freeze the weights where they landed (the change is permanent) and re-arm a learning-rate ramp that climbs `0 → 1` at `0.001`/tick (~5 s @ 200 Hz). `jolt_lr_scale()` returns `0` while held, then the ramping value.
**Why:** the morph is meant to be a committed edit, and easing training back in afterward prevents a resumed trainer from immediately yanking the net off the just-jolted sound. Callers that train multiply their LR by `jolt_lr_scale()`; pure-example modes that train only on explicit gestures may ignore it.

3.5 Jolt **MUST** own a per-instance deterministic `Rng` (seeded by the caller).
**Why:** per-instance deterministic RNG is the project-wide rule that cross-platform parity tests rely on.

3.6 A freshly constructed Jolt **MUST** be inert: inactive, `step()` a no-op that does not advance the RNG, and `lr_scale()` == 1.
**Why:** inertness is what makes adding Jolt to the shared base parity-safe — a mode that never presses the button behaves bit-identically to one without Jolt (§5).

---

## 4. OU explore (`ml/ou_noise.hpp`)

4.1 `OUNoise<N>` adds an Ornstein-Uhlenbeck random walk to the N-channel output vector **before** it reaches the engine.
**Why:** perturbing the post-inference parameter vector (not the weights) lets the mapping stay the anchor and reverts the walk toward it.

4.2 Per channel the update **MUST** be `state += theta * (-state) * dt + noise`, with `theta = 0.02`, `dt = 0.001`, and per-step noise std `= stationary_std * sqrt(2 * theta * dt)` times a unit gaussian; then `out = clamp(out + state, 0, 1)`.
**Why:** these are the upstream OU constants; the `sqrt(2·theta·dt)` factor makes the discrete walk's stationary standard deviation equal the requested `stationary_std`. Mean reversion is to zero (mu = 0), so the network's own output remains the anchor.

4.3 The exploration knob `level ∈ [0,1]` **MUST** map `stationary_std = level * 0.65` (`kMaxAmplitude`).
**Why:** `0.65` is the upstream full-scale amplitude in parameter space.

4.4 The walk **MUST** be temporally correlated (smooth multi-second sweeps), not per-frame jitter, and learning **MUST** stay live while it roams.
**Why:** correlated drift produces explorable sound trajectories rather than noise, and keeping training live means "likes" registered during the wander steer the network toward what the player wants.

4.5 `OUNoise` **MUST** own a per-instance deterministic `Rng`, and **MUST** default inert (intensity 0, `apply()` a no-op that neither advances the RNG nor touches the output).
**Why:** same parity-safety rationale as §3.5–3.6 — intensity 0 leaves the output pass-through bit-identical.

---

## 5. Integration into the shared base

5.1 Both gestures **MUST** be wired into the shared CRTP base `nisps::ModeBase` (`nisps/modes/base.hpp`), so every mode gains `jolt_press()` / `jolt_release()` / `jolt_active()` / `jolt_lr_scale()` and `set_explore_intensity()` / `explore_intensity()`.
**Why:** the gestures are mode-agnostic; putting them in the base avoids per-mode duplication. SLP-Workshop is simply the mode that surfaces them.

5.2 Gesture selection **MUST** be runtime, not compile-time: there is no `#ifdef`/template flag choosing examples-vs-RL or enabling Jolt/OU. Both gestures are plain methods on the same MLP/mode, selected by which control the user touches.
**Why:** runtime selection was a user requirement — the player switches gesture by reaching for a different control, with no rebuild.

5.3 Because §3.6 and §4.5 make both gestures inert by default, existing modes **MUST** stay bit-identical. In `ModeBase::tick_control` the jolt block is guarded by `if (jolt_.active())` and the OU block by `if (ou_.enabled())`; otherwise the original direct path runs.
**Why:** parity-safety: untouched modes hit the original code path unchanged. Proven by the SLP ≡ MEMLCelium test (§1.2) plus unchanged golden and native↔WASM parity.

5.4 The jolt weight-copy **MUST** be an out-of-line `apply_jolt_()` marked `NISPS_NOINLINE` (a macro added to `nisps/core/perf.hpp`), and the members `jolt_`, `ou_`, `out_buf_`, `jolt_buf_` **MUST** be declared **after** `events_` in `ModeBase`.
**Why (load-bearing):** inlining the large get/set-weights copy into `tick_control`, or placing the large `jolt_buf_` before the lock-free `events_` ring buffer, each provoked a spurious GCC `-Wstringop-overflow` (an error under `-Werror`) on the ring's atomic index at `-O3`. Both arrangements are behaviourally identical; this layout is purely to dodge the false-positive diagnostic.

---

## 6. Control mappings

6.1 Firmware (`firmware/MEMLNaut-NISPS/glue/peripherals.hpp`, generic to all modes): **TogB1** toggle **MUST** drive Jolt (up = morph/hold, down = freeze) and **RVX1** pot **MUST** drive exploration amount via `set_explore_intensity`.
**Why:** Jolt is a held gesture, but the MEMLNaut momentary buttons fire only on press — a toggle gives a stable held state. These ride on previously-unused inputs so existing mappings are undisturbed.

6.2 Browser playground (`SLPWorkshopMode.tsx`, via `mode-runtime.ts` `jolt`/`explore`) **MUST** expose a press-and-hold "⚡ Jolt" button and an "Explore" 0..1 slider; the mode runs the MEMLCelium engine via WASM.
**Why:** mirrors the firmware control surface in the browser playground.

---

## 7. Schema & codegen

7.1 `schemas/modes/slp_workshop.json` (mode_id `slp_workshop`, engine_id `memlcelium`) **MUST** declare 56 params identical to MEMLCelium, and codegen **MUST** emit `nisps/modes/generated/slp_workshop_schema.hpp` and `playground/src/modes/generated/slp_workshop_schema.ts`.
**Why:** the mode shares MEMLCelium's parameter contract; codegen auto-discovers `schemas/modes/*.json`, and the golden test enforces byte-identical regeneration.

---

## 8. Firmware wiring & build

8.1 The firmware variant alias `MEMLNautModeSLPWorkshop` **MUST** exist in `firmware/MEMLNaut-NISPS/glue/mode_select.hpp`, with a selectable `MEMLNAUT_MODE_TYPE` line in `MEMLNaut-NISPS.ino`; `scripts/build-firmware.sh` auto-discovers it as variant `SLPWorkshop`.
**Why:** this is the standard firmware-mode registration path; auto-discovery means `scripts/build-firmware.sh SLPWorkshop` works without extra wiring.

---

# Part II — Planned: output modes, gate sequences & config UX

> **Status: planned, not implemented.** This part fixes the *model and shapes*, not
> the final counts. **Locked operator decisions (2026-06-28):** (1) hardware keeps
> exactly **2** ratio sequences (memlcelium verbatim); the browser may instantiate
> as many as the user wants. (2) The 3 uSEQ gate-only jacks make gates **optional**
> — pure CV is valid; if doing gates at all, use those 3 first, then convert CV
> jacks. (3) Split-net input is **per-input-channel** engine routing (each
> pad/stick/CC tagged Continuous or Rhythm). (4) **Internal BPM clock** now;
> external-MIDI-clock sync is a later nicety.

## 9. Ground truth: what `memlcelium` is

9.1 `memlcelium` is **one** MLP (`MLP<4, [10,14,18], 56>`), not two. Its 56 outputs split: `[0..13]` **sequencer** (2 sequences × 7 ratio-seq params), `[14..55]` **synthesis** (42 continuous params, Voice 0 + Voice 1). The single net produces both the continuous values and the RatioSeq params; an internal RatioSeq tick turns the seq params into note triggers, exposed via `pop_events()`.
**Why:** the planned output modes are *slices/reshapes of this one net*, and the gate stream already exists inside the engine — so gate outputs are a routing/consumption feature, not new DSP. (A true two-MLP-head "split" topology is genuinely different and therefore browser-only; §11.2.)

9.2 The 7 ratio-seq params per track are: `ratios[0..2]` (3), `phasor_mul` (1), `phase_off` (1), `amp_ratios[0..1]` (2).
**Why:** firmware parity. (The April browser uSEQ-Celium used 8, adding a pulse-width param; pulse width is an optional 8th later — §13.)

---

## 10. The unifying model: two output streams

10.1 Everything collapses to two output **streams**, each driven by an MLP head:

| Stream         | MLP outputs                      | Generates          | Routes to             |
|----------------|----------------------------------|--------------------|-----------------------|
| **Continuous** | 1 value per channel              | smooth 0..1 values | MIDI CC / CV jack     |
| **Rhythm**     | 7 params per gate-sequence track | clock-driven gates | MIDI note / gate jack |

A **mode** is just *which streams are active* and *whether they share a network*.

10.2 The Rhythm stream **SHOULD** generate gates via RatioSeq, per track per control tick: (1) a shared internal-BPM clock advances a bar phasor; (2) `seq_phasor = (bar_phasor × phasor_mul + phase_off) mod 1`; (3) `ratio_seq_3(seq_phasor, ratios, pw=0.5)` → boolean gate; (4) `ratio_seq_2(amp_ratios)` → 2-level velocity (127/64); (5) rising edge → note-on / gate-high, falling edge → note-off / gate-low.
**Why:** a gate is **clock + learned pattern**, not a threshold on a continuous value — this is what makes Rhythm a distinct stream and why it needs its own 7 params per track rather than one output per gate. Defaults (pulse-width 0.5, 2-level velocity) match firmware.

10.3 Where RatioSeq runs (browser): when the active engine *is* the memlcelium/SLP WASM engine, consume `pop_events()`; for CV/MIDI modes that don't run that audio engine, a small **TS RatioSeq** fed by the Rhythm MLP's 7-params/track drives the gates.
**Why:** the gate generator must work whether or not the WASM audio engine is the active backend.

---

## 11. Modes

11.1 **Firmware (compile-time, one chosen at build)** **MUST** always use exactly 2 ratio sequences (memlcelium verbatim). Three slices of the `slp_workshop` mode:

| Mode                                   | Streams           | Nets | MLP output_size           |
|----------------------------------------|-------------------|------|---------------------------|
| Continuous only                        | Continuous        | 1    | continuous params only    |
| Continuous & Rhythm (= memlcelium)     | both, **shared**  | 1    | 14 seq + 42 synth = 56    |
| Rhythm only                            | Rhythm            | 1    | 2 × 7 = 14 seq params     |

**Why:** the firmware does not vary sequence count (locked decision); exact output_size counts for the sliced modes are the firmware agent's call — this spec fixes the shapes.

11.2 **Browser (Manifold, dynamic, switchable live)** **MAY** offer the same three plus a **split-nets** variant (a separate Continuous MLP and Rhythm MLP), with **as many ratio sequences as the user wants** (each gate sequence = its own 7-param track; the net reshapes to suit). The browser mode is **implied by the Outputs config** (§12), not a separate picker: continuous>0 & gates=0 ⇒ Continuous-only; gates>0 & Shared net ⇒ hybrid-shared; gates>0 & Separate net ⇒ hybrid-split; continuous=0 ⇒ Rhythm-only.
**Why:** the browser has the compute for two MLP heads and dynamic reshape; making the mode a consequence of the config avoids a redundant mode dropdown. Shared-net `output_size = continuous + 7 × n_gates` must respect the 126-output WASM cap (~16 gates max shared); a separate Rhythm net is sized independently and scales further.

---

## 12. Configuring gate sequences (Manifold, CV **and** MIDI)

12.1 Two output kinds: **Continuous** → CC (MIDI) / CV jack (CV); **Gate sequence** → note (MIDI) / gate jack (CV), each = one RatioSeq track.

12.2 **MIDI mode** **SHOULD** expose two independent counts — Continuous (CC) and Gate-sequences — capped by the model output budget.

12.3 **CV mode** hardware is fixed (11 PWM/CV-capable jacks + 3 digital gate-only jacks), so the two counts are **linked** and gates are optional. The rule **MUST** be `gates ∈ [0, 14]`; `CV = gates ≤ 3 ? 11 : 14 − gates`.
**Why:** the first 3 gate sequences land on the dedicated gate-only jacks and cost no CV (0→11 CV, 3→11 CV, 6→8 CV, 14→0 CV); converting CV jacks only begins past 3. Pure CV (0 gates) is valid.

12.4 Wire-protocol impact **MUST** be none: a CV jack acting as a gate carries 0/full (or the 2-level velocity) in its `u16` slot; the 3 dedicated gate bits stay digital pins (`docs/useq-celium/protocol.md`). `CvSpec` extends so PWM jacks can also be gate targets.
**Why:** reusing the existing protocol slots avoids a protocol revision for a routing feature.

12.5 The **Rhythm network** toggle (shown only when gate sequences > 0) selects **Separate** (default) or **Shared**. Separate gives the Rhythm stream its own MLP and routes each input channel to one engine, automatically by source kind: XY pad → a second on-screen pad (pad 1 → Continuous, pad 2 → Rhythm); gamepad → double-stick (left → Continuous, right → Rhythm); MIDI controller → per-CC `Continuous | Rhythm` toggle. Shared uses one MLP for both streams (all inputs feed it; the hardware-parity hybrid).
**Why:** the decision surface stays **two numbers + one toggle** — the second pad / double-stick / per-CC tag is a *consequence* of Separate, surfaced inline, reusing the existing input layer (`InputSource.axisCount()` / `axisLabels()`).

12.6 `BackendAdvanced` (full-depth modal) **MAY** override per-output defaults: which model output drives each CC/CV; which rhythm track drives each note/gate; gate threshold; MIDI note#/channel; CV polarity.
**Why:** identity defaults cover the common case, so advanced overrides stay optional.

---

## 13. Proposed UI (the "simple" target)

13.1 The Outputs panel **SHOULD** read, top to bottom: (1) **Output kinds** — `Continuous [n]` + `Gate sequences [n]` (MIDI) or the linked `Gate sequences 0–14` slider with a live `CV n · Gate n` readout (CV); (2) the **Rhythm network** toggle `( Shared | Separate )` plus its inline input surface (2nd pad / double-stick / per-CC tags), shown only when gate sequences > 0; (3) the existing per-output rows (off/fixed/live, mute, arm, min/max/curve) and per-backend specifics (CC#, CV jack, note#).
**Why:** the counts + toggle *are* the mode, so no mode dropdown is needed for the rhythm/continuous split.

---

## Open / Deferred

Part I (shipped) caveats:

- **Browser↔firmware noise parity is intentionally NOT guaranteed.** `playground/src/ml/jolt.ts` and `playground/src/output/ou-explore.ts` reimplement the gesture math in TypeScript (driving weights via the existing `nisps_ml_get/set_weights` bindings) rather than calling C++ `ml::Jolt` / `ml::OUNoise` through WASM, and they use `Math.random()` not the deterministic `Rng`. Acceptable for stochastic exploration aids, but the noise itself will not be bit-identical across firmware and browser.
- **The post-release LR ramp (§3.4) is not ported to the browser.** The browser SLP mode trains only on explicit gestures, so there is no resumed continuous trainer to ease back in.
- **Verified in the dev environment:** C++ host tests (`tests/cpp/test_mlp_jolt.cpp`, `test_mlp_ou_noise.cpp`, `test_mode_learning.cpp`, `test_mode_concepts.cpp`), lint, WASM build, native↔WASM parity, codegen golden, playground typecheck.
- **NOT verifiable in the dev environment (hardware/toolchain-bound; verification chokepoints A/B):** firmware compile (no arduino-cli / submodules), Playwright e2e, on-hardware audio. To close: run `scripts/build-firmware.sh SLPWorkshop`, then flash on the RP2350.

Part II (planned) build deltas, when we proceed:

- **Manifold engine:** today one MLP head on the spine. "Separate" needs a second Rhythm MLP head + per-input-axis engine routing (engine + input-layer scope).
- **TS RatioSeq:** a browser-side RatioSeq (or a `pop_events()` bridge) to turn Rhythm-MLP params into gate/note events for the CV & MIDI backends (2 sequences on firmware; arbitrary count in the browser).
- **MIDI backend:** gate sequences → note on/off (it currently sends CC only).
- **CvSpec:** allow PWM jacks (`cv1..cv11`) to be gate targets (incl. velocity-CV), with the 3 digital pins as the first-used gate jacks.
- **Reshape:** shared-net `output_size = continuous + 7 × gate_sequences` (≤126 WASM cap) — confirm against the reshape / reset-on-reshape flow.
- **Firmware output_size** for the "Continuous only" / "Rhythm only" slices of `slp_workshop` — the firmware agent's call; this spec fixes the shapes, not exact counts.
- **Deferred niceties (explicitly not blocking):** external-MIDI-clock sync; per-track pulse-width (gate length, the optional 8th ratio-seq param); continuous velocity/accent beyond the 127/64 two-level.
