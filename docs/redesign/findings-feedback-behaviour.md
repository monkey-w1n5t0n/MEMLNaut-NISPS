# Findings — Current RL / Feedback Behaviour (Phase-1 Audit)

*Read-only audit, 2026-06-27. Citations are `file:line`. "VERIFIED" = read in source; "INFER" = deduced.
Produced by the Phase-1 research fan-out (workflow `wf_db146f21`), persisted by the orchestrator because a
hook blocks subagent report-file writes. Adversarially spot-checked against source.*

## Executive summary

1. The operator's mental model ("negative feedback takes the n-D opposite vector and pushes weights the other
   way — geometric push-away") describes the **firmware `InterfaceRL`** path, NOT what is deployed in the
   browser/aimmersive build.
2. The **deployed JS engine** and the **`nisps/` C++ core** both implement thumbs-down as
   `move_weights(speed, spread, pinMask)` = per-weight decay (`w *= 1-0.1·spread`) then additive Gaussian
   noise (`stddev = speed · layer_scale`). There is **no opposite vector, no centroid, no geometric direction**
   in deployed/core code (VERIFIED: grep for `centroid|geometric|meanPositive|neg_action` returns nothing in
   `deployments/meml-aimmersive/js/`).
3. So "push the weights the other way" is, in the deployed system, actually **"jitter the whole network with
   random Gaussian noise"** — undirected diffusion, not directed avoidance.
4. The true geometric push-away (move output away from k-NN centroid of liked examples) exists only in the
   firmware submodule (`memllib` InterfaceRL; "geo push" commits) and is documented in
   `docs/redesign/feedback-modes-port-spec.md` §1.1. **This is the algorithm Mode 1 must match** (workstream B).
5. **Why often inaudible (deployed AVOID):** noise added across all 4 layers of `MLP<2,10,14,18,126>`,
   per-layer scaled `(1-spread)+spread/√fan_in`, capped at `noiseCap=0.12`, spread default 0.6 → tiny
   per-step perturbation that the sigmoid output + output smoothing/slew pipeline absorb. One press moves the
   heard 126-vector very little, in a random direction uncorrelated with what was disliked.
6. **Three FEEDBACK_MODEs already scaffolded** in untracked working files `nisps/ml/feedback.hpp` +
   `tests/cpp/test_mlp_feedback.cpp` (`FeedbackController<MLP_T>`): `Avoid`, `RandomiseOutputs`,
   `RandomiseMlp`. Not yet wired into bindings/TS/UI; no CMake registration.
7. `RandomiseMlp` = the operator's Mode 2 as an audition: snapshot weights → `draw_weights(spread)` → user
   moves joystick to hear → up commits a +1 example, down/switch restores the snapshot. **This is the seed of
   Mode 2** but the updated spec is stricter (scratchpad NEVER trained; explicit place-at-location; warm-start
   real model to interpolate anchors).
8. `RandomiseOutputs` = bypass the MLP entirely, hold a static random output vector (focus-aware per-dim),
   re-roll on each down; up commits the held vector as a +1 example.
9. The operator's "randomise → anchor → train" alternative maps onto `RandomiseMlp` (randomise) + thumbs-up
   `LikeStore` (anchor) + `trainOnCurrent` (train). Missing in deployed build: the randomise-audition-then-anchor
   loop; today thumbs-down only diffuses noise and never anchors.
10. The full port spec (component, WASM C API, TS FFI, ~22 ctest cases, parity stage) already exists at
    `docs/redesign/feedback-modes-port-spec.md` and matches the untracked `feedback.hpp`.
11. **Parity/perf constraints:** no heap / `std::array` only, per-instance deterministic `nisps::Rng`
    (no libc `rand()`), no virtual dispatch, `.f` literals, fixed WASM arch `MLP<2,10,14,18,126>`,
    native↔WASM parity within `1e-5`.
12. **Bottom line:** deployed negative-feedback is undirected Gaussian noise (not geometric push-away), which is
    why it is weak/inaudible; the in-progress `FeedbackController` already implements the seed of the operator's
    randomise-anchor-train idea but is unplumbed past the header.

## 1. Current algorithm, precisely, per layer

### 1.1 DEPLOYED (browser/aimmersive) — NOT geometric
Thumbs-down = `move_weights`. Pure-JS reference `deployments/meml-aimmersive/js/nisps/mlp.js:238-265`
(VERIFIED): per layer/node/weight `j`: `decay = 1-0.1*spread`; `layerScale = (1-spread)+(1/√fanIn)*spread`;
`node.weights[j] *= decay`; `accum = Σ_{n=0..2}(rand*2-1)`; `node.weights[j] += 3*accum*speed*layerScale`.
Output-layer nodes with `outputPinMask[ni]` skipped (`mlp.js:248`). WASM wrapper `nisps-wasm.js:389-406` →
`cwrap('nisps_mlp_move_weights_ex')`. IML `iml.js:166-170` forwards then re-infers — **no dislike-direction
logic, no example stored on dislike**.

**Key finding (VERIFIED, exhaustive grep):** `deployments/meml-aimmersive/js/` has zero matches for
`centroid|meanPositive|geometric|pushStep|dislikeMultiplier|neg_action|RANDOMISE|FEEDBACK_MODE|explore_active`.
Deployed negative feedback is purely undirected Gaussian weight diffusion. The disliked 126-vector is never read.

### 1.2 `nisps/` C++ core — same move_weights, no geometric push
`nisps/ml/rl.hpp:63-100` `move_weights_layer` (VERIFIED): `layer_scale = spread_scale(spread,fan_in) =
(1-spread)+spread/√fan_in` (`init.hpp:31-35`); `noise_stddev = speed*layer_scale`; `decay = 1-0.1*spread`
(`rl.hpp:49-51`). Bias: `biases[node] += rng.next_float_gaussian(noise_stddev)` unless pinned (`rl.hpp:83`).
Each weight: `w = w*decay + rng.next_float_gaussian(noise_stddev)` (`rl.hpp:92-97`); RNG advanced even on skip.
Pin mask only on `is_final_layer` (`rl.hpp:78-79`). `mlp.hpp:312-322` iterates 4 layers, only layer3
final+masked. `draw_weights` (`mlp.hpp:324-332`→`init.hpp:42-54`): `w = rng.next_float_signed()*spread_scale`,
biases zeroed. C API `nisps_ml_move_weights`/`nisps_ml_draw_weights` (`bindings.cpp:419-437`). TS
`wasm-iml.ts:495-508`. Handler `mode-runtime.ts:548-565`: builds pin mask, `moveWeights(cap,spread,pinMask)`,
`growNoise`, re-`setInput`. **No example stored on thumbs-down** (vs thumbs-up `mode-runtime.ts:523-546`).

### 1.3 TRUE geometric push-away (firmware only) — THE MODE-1 TARGET
Per `feedback-modes-port-spec.md:61-79` (sourced from firmware `InterfaceRL.cpp`), applied in `optimise()` not
at press time: `pushStep = clamp(|avgRewardNeg|,0.25,1.0)*0.5`; `dir[j] = neg_action[j] -
meanPositiveAction[j]` (away from k-NN(+) centroid); `target[j] = clamp(neg_action[j] +
(dir/||dir||)[j]*pushStep/(1+||dir||), 0, 1)`; then train toward `target`. Depends on firmware-only
`ReplayMemory`. Lives in `src/memllib` submodule (commits `2429bcc` "geo push", `d301cc7` "rlview and dislike";
upstream `SB2026`; memllib main `e291192`/`abe93ec`). **Workstream A must confirm the newest variant.**

## 2. FEEDBACK_MODEs implemented / scaffolded, and where

| Mode | Firmware memllib | nisps/ core (untracked) | Deployed JS | Playground TS |
|---|---|---|---|---|
| AVOID geometric push | VERIFIED (geo-push commits) | NOT ported | — | — |
| AVOID = move_weights | — | `feedback.hpp:103-105` | `mlp.js`/`nisps-wasm.js` | `mode-runtime.ts:548` |
| RANDOMISE_OUTPUTS | VERIFIED (spec §1.2) | `feedback.hpp:106-112,160-181` | — | — |
| RANDOMISE_MLP | VERIFIED (spec §1.3) | `feedback.hpp:113-119,183-189` | — | — |

**Untracked `nisps/ml/feedback.hpp`** (214 lines, VERIFIED): `nisps::ml::FeedbackController<MLP_T>`.
`enum FeedbackMode {Avoid=0,RandomiseOutputs=1,RandomiseMlp=2}` (`:47-51`); `enum FeedbackAction
{None,AvoidPerturb,LikeStore,EnterExplore,Reroll,CommitStore,Cancel,Restore}` (`:56-65`). State all
`std::array` (no heap), own `Rng` seeded separately (`:203-210`). `on_down`: Avoid→move_weights;
RandOut→enter/roll; RandMlp→enter(snapshot+draw_weights)/cancel. `on_up`: exploring→restore+CommitStore else
LikeStore. `on_drag`: RandMlp+exploring→restore+Restore else LikeStore. `static_output`: bypass hook only when
RandomiseOutputs&&exploring. `roll_static_outputs`: focused→`rng_.next_float_uniform()`, unfocused frozen.
`set_mode` aborts active exploration first.

**Untracked `tests/cpp/test_mlp_feedback.cpp`** (437 lines, ~22 NISPS_TEST, VERIFIED):
`SmallMLP=MLP<2,4,4,4,6,8,32>`; covers all transitions, RNG determinism, focus edge cases, a golden RNG
stream. **Not registered in `nisps/CMakeLists.txt`** (spec §5.1/§7 lists as TODO).

**Not yet wired (gaps):** no `nisps_ml_feedback_*` in `bindings.cpp`; no `FeedbackController` on `MLHandle`;
no TS FFI in `types.ts`; no UI selector. Firmware parent branch `origin/feat/feedback-explore-modes` wires a
TR-8S FEEDBACK_MODE selector (`5c2d4d2`) and adds `docs/dislike_system_{analysis,design_space}.md` (4 meanings
of "dislike"; here/anywhere × point/radius scope matrix — VERIFIED).

## 3. Spread / noise / zoom machinery
- **spread∈[0,1]** (`exploration-store.ts:35,74`, default 0.6): feeds per-layer scale and decay. spread=0:
  uniform weights, big noise, no decay (saturated); spread=1: Xavier, small noise, 10% decay (spread out).
- **noiseCap∈[floor,1]** (default 0.12): the `speed`/`cap` magnitude for thumbs-down and auto-explore.
- **growNoise/decayNoise** driven by pointer `pressureForce` (`mode-runtime.ts:491-499,544,562`).
- **Zoom** scales auto-explore intensity: `scaledIntensity = intensity*(0.3+0.7*zoom)` — an input-pipeline
  gain, not output magnitude.
- **Auto-explore loop** (`mode-runtime.ts:444-482`): periodic `move_weights`+`growNoise`, default 2000ms, off
  by default — same diffusion as thumbs-down.
- **Pin mask** `buildPinMask(...)`: freezes final-layer weights for pinned/overridden params — the only
  directional gating today (protects dims, doesn't push them). *Relevant to the SOLO/arm design (B).*

## 4. Parity/perf constraints any core change must respect
No heap in `nisps/` (`std::array`/`FixedBuffer`; `feedback.hpp` obeys); deterministic per-instance `nisps::Rng`,
no libc `rand()`; no virtual dispatch; `.f` literals, no double promotion, `NISPS_*` mem attrs; fixed WASM arch
`MLP<2,10,14,18,126>` (snapshot = `weight_count()` floats, compile-time fixed); native↔WASM parity within
`1e-5`. RandomiseMlp snapshot/restore must round-trip `get_weights`/`set_weights` byte-identically;
RandomiseOutputs static vectors need same-seed/same-Rng; golden tests pin RNG streams.

## 5. WHY the effect is inaudible — the mechanism
1. **Undirected, not opposite.** Zero-mean Gaussian noise on every weight in all 4 layers; the disliked output
   is never read. Expected output change ≈ 0; only variance moves — wobbles randomly, doesn't move *away*.
2. **Small magnitude, multiply-attenuated.** `speed=0.12, spread=0.6` → output layer `layer_scale≈0.54`,
   `stddev≈0.065` per weight, squashed by a near-saturated sigmoid, then damped by smoothing→slew→freeze.
3. **Decay fights accumulation.** `w *= 0.94` each press pulls back toward the basin → equilibrium by design.
4. **Pinned/override dims frozen** on the final layer → never respond.
5. **No anchoring.** Thumbs-down stores no example and triggers no training, so there's no learning signal.

## 6. Operator's Mode 2 ("explore-and-place") vs what exists
Already half-built as `RandomiseMlp`:
- **Randomise** = `RandomiseMlp::on_down` enter → `snapshot + draw_weights(spread)`: whole net re-rolled →
  audibly different; user auditions via joystick.
- **Anchor** = `on_up` → `restore_after_explore` + `CommitStore`: caller stores +1 example at
  `(current_input, heard_output)`, original net restored.
- **Train** = existing `trainOnCurrent()` trains restored net toward the anchored example.
- **Discard** = `on_down` again → `Cancel`, or mode-switch `abort_explore` restores snapshot.

**Updated-spec deltas to implement (workstream B):** the scratchpad must be NEVER trained (only randomise +
undoable nudge); the place step must let the user CHOOSE the input location (press → pick location → release);
the real model is warm-started to interpolate ALL placed anchors. The existing `RandomiseMlp` is the closest
prototype but commits at the *current* input position, not a chosen one, and lacks the explicit nudge op.

### Key files
- Deployed: `deployments/meml-aimmersive/js/nisps/{mlp.js,nisps-wasm.js,iml.js}`
- Core RL: `nisps/ml/{rl.hpp,init.hpp,mlp.hpp}`
- Core feedback (untracked): `nisps/ml/feedback.hpp`, `tests/cpp/test_mlp_feedback.cpp`
- WASM API: `nisps/wasm/bindings.cpp:419-437`
- TS: `playground/src/ml/wasm-iml.ts:488-508`; runtime `playground/src/modes/mode-runtime.ts:444-565`
- Exploration knobs: `playground/src/stores/exploration-store.ts`
- Port spec: `docs/redesign/feedback-modes-port-spec.md`
- Firmware geo-push: `src/memllib` (commits `2429bcc`, `d301cc7`; upstream `SB2026`; main `e291192`/`abe93ec`);
  design docs on `origin/feat/feedback-explore-modes`: `docs/dislike_system_{analysis,design_space}.md`
