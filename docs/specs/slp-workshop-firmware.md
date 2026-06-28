---
stability: stable
layer: binding
---

# SLP-Workshop Firmware & Adaptive-Learning Gestures

> Reference spec for the **SLP-Workshop** firmware mode (built for a workshop at
> Synth Library Portland) and the two adaptive-learning gestures it introduced —
> **Jolt** (held continuous weight morph) and **OU explore** (Ornstein-Uhlenbeck
> output walk). Both gestures live in the shared mode base, so they are available
> to every mode; SLP-Workshop is the mode that surfaces them.
>
> This describes a feature that is already built and merged. It is a stable
> reference, not a forward plan: it records what is, and why the load-bearing
> decisions were made the way they were.
>
> Provenance: landed on branch `workshop/synth-fw-audit` (commits `4e60d01`
> core + firmware, `57c9ede` browser controls); merged to `main` at `527b8fc`.

## Source files

- `nisps/modes/slp_workshop.hpp` — `nisps::modes::SLPWorkshopMode` (mode_id `slp_workshop`); reuses the MEMLCelium engine + MLP shape verbatim.
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

---

## 1. Frame

1.1 SLP-Workshop is a distinct nisps mode (`nisps::modes::SLPWorkshopMode`, mode_id `slp_workshop`) that **MUST** reuse the MEMLCelium engine and MLP shape verbatim: engine_id stays `memlcelium`, and the MLP is `MLP<4, 10, 14, 18, 56>`.
**Why:** the workshop wanted its own identity (preset directory, display name) and a UI that foregrounds the two adaptive-learning gestures, but no new synthesis behaviour — so the synthesis mapping is byte-for-byte MEMLCelium's, and only the mode wrapper, identity, and surfaced controls differ.

1.2 The synthesis mapping in SLP-Workshop **MUST** stay identical to `MEMLCeliumMode` for the same seed and inputs.
**Why:** the two adaptive-learning gestures live in the shared base (§2), not in this mode; SLP-Workshop adds only identity and control surfacing. A test asserts SLP-Workshop ≡ MEMLCelium (same seed, identical audio) with the new features off.

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

## Open / Deferred

- **Browser↔firmware noise parity is intentionally NOT guaranteed.** `playground/src/ml/jolt.ts` and `playground/src/output/ou-explore.ts` reimplement the gesture math in TypeScript (driving weights via the existing `nisps_ml_get/set_weights` bindings) rather than calling C++ `ml::Jolt` / `ml::OUNoise` through WASM, and they use `Math.random()` not the deterministic `Rng`. Acceptable for stochastic exploration aids, but the noise itself will not be bit-identical across firmware and browser.
- **The post-release LR ramp (§3.4) is not ported to the browser.** The browser SLP mode trains only on explicit gestures, so there is no resumed continuous trainer to ease back in.
- **Verified in the dev environment:** C++ host tests (`tests/cpp/test_mlp_jolt.cpp`, `test_mlp_ou_noise.cpp`, `test_mode_learning.cpp`, `test_mode_concepts.cpp`), lint, WASM build, native↔WASM parity, codegen golden, playground typecheck.
- **NOT verifiable in the dev environment (hardware/toolchain-bound; corresponds to verification chokepoints A/B):** firmware compile (no arduino-cli / submodules), Playwright e2e, on-hardware audio. To close: run `scripts/build-firmware.sh SLPWorkshop`, then flash on the RP2350.
