# RL / Feedback Learning-Engine Design — Manifold

*Design sign-off. Dated 2026-06-27. Supersedes the AVOID-out-of-scope decision in `docs/redesign/feedback-modes-port-spec.md` §2.5/§7. Author: lead architect, synthesising a 4-candidate / 4-judge design panel against verified source.*

---

## 0. Decision summary

| Setting | Default | Also selectable |
|---|---|---|
| `FEEDBACK_MODE` | **Explore and place** (Mode 2, positive-only) | **Geometric dislike** (Mode 1) |
| `SOLO_MODE` | **MaskGradients** (final-layer column freeze) | **ZeroLoss**, **DontCareExample** |

**Winner of the panel:** *Sift* (musician-UX judge topPick, skeptic topPick; 2nd on feasibility and ML). It is the only candidate that does UX design rather than only porting design, and it satisfies the "Mode 2 is NEVER a dislike" requirement at the level of the performer's mental model.

**Grafted onto Sift's felt-loop spine:**
- *Minimal-Divergence* — the **only candidate whose tree-read is correct** (verified below): the feedback C API, `MLHandle.feedback`, the `0xFEEDBACC0DE` salt, `CMakeLists.txt:59` registration, and parity Stage 5 ALL already exist. Its **append-only `FeedbackAction` enum** discipline and **controller-returns-action / caller-owns-training** boundary contract are kept verbatim.
- *Anchored-Manifold* — the **only candidate with correct provenance** (the upstream tip is `0a541cc "highlighting"`, verified; not the `e291192`/`abe93ec` the others cite). Its **one-`ReplayStore`-three-features** compression, its **bit-identical-frozen-column solo ctest**, and its **explicit TrainBatch-vs-SGD divergence flag** are adopted.
- *Anchor-First* — **keep replay/geometric logic OUT of the MLP kernel** (only minimal backprop hooks go in), and **port the `posMemCount==0` cold-start fallback faithfully** so dislikes-before-any-like don't destabilise the net.

---

## 1. Verified ground truth (read this before building)

All claims below were read from source on 2026-06-27. Where the four candidates disagreed, the verified fact decides.

### 1.1 The scaffold already exists (Minimal-Divergence was right)
- `nisps/wasm/bindings.cpp:95-116` — `struct MLHandle` already holds `nisps::ml::FeedbackController<DefaultMLP> feedback;` + `feedback_static_scratch{}`, constructed `feedback(seed ^ 0xFEEDBACC0DEull)`.
- `nisps/wasm/bindings.cpp:439-535` — the 9 `nisps_ml_feedback_*` C functions (`set_mode`/`get_mode`/`exploring`/`learning_paused`/`set_focus`/`down`/`up`/`drag`/`static_output`) are **already wired**.
- `nisps/CMakeLists.txt:58-59` — `test_mlp_rl.cpp` **and** `test_mlp_feedback.cpp` are **already registered** in `nisps_core_tests`.
- `tests/cpp/parity_check.cpp:86` — `kVersion = 2u` already; `:198-205` — **Stage 5 (feedback) already exists** seeding `FeedbackController<ParityMLP> fb(kSeed ^ kFeedbackSalt)`.

> Candidates 2/3/4 proposed *adding* `MLHandle.feedback`, *registering* `test_mlp_feedback.cpp`, and *creating* Stage 5. That is phantom work — they already exist. This design **edits** the existing `on_down` cases and **extends** the existing enum/API/parity-stage; it does not re-scaffold them.

### 1.2 The current `feedback.hpp` (untracked, verified `nisps/ml/feedback.hpp:1-214`)
- `enum FeedbackMode {Avoid=0, RandomiseOutputs=1, RandomiseMlp=2}` (`:47-51`); `enum FeedbackAction {None=0,…Restore=7}` (`:56-65`).
- `on_down` Avoid case (`:103-105`) calls `mlp.move_weights(speed, spread, pin_mask)` — the **undirected-diffusion placeholder** the requirement now forbids for Mode 1.
- `RandomiseMlp` `on_down` (`:113-119`): 1st press enters (`snapshot_` + `draw_weights`), 2nd press **cancels**. Snapshot/restore is a byte-exact `get_weights`/`set_weights` round-trip (`:186-193`).
- The controller has its **own per-instance `Rng rng_`** (`:210`), seeded independently.

### 1.3 The latest upstream algorithm (Anchored-Manifold's provenance was right)
The actual upstream tip is **`0a541cc "highlighting"`** at `/home/w1n5t0n/src/MEMLNaut-NISPS-upstream/src/memllib/examples/InterfaceRL.{hpp,cpp}`. Constants verified:
- `InterfaceRL.hpp:293` `kGeometricPushScale = 0.5f`; `:294` `kMaxDislikeMultiplier = 16`; `:296` `kCentroidK = 4`.
- `InterfaceRL.cpp:42-66` `_perform_dislike_action()`: nearby negative within Euclidean `0.05f` of `controlInput` → `reward = max(reward-1, -16)`; else `storeExperience(-1, controlInput, action)`; then `dislikeMultiplier_ = min(*2, 16)`.
- `InterfaceRL.cpp:602-627` k-NN centroid: average the `kCentroidK=4` positive memories nearest `controlInput` → `meanPositiveAction`.
- `InterfaceRL.cpp:664` proportional decay `reward += 0.0025f * max(|reward|, 1.0f)`; expired items removed; `dislikeMultiplier_` halved per expiry (`:752-760`).
- `InterfaceRL.cpp:713` `pushStep = clamp(|avgRewardNeg|, 0.25f, 1.0f) * kGeometricPushScale`.
- `InterfaceRL.cpp:721-735` per negative: `dir[j] = neg_action[j] - meanPositiveAction[j]`; `len = ||dir||`; `useRandom = (len <= 1e-4f)`; `effectivePushStep = pushStep / (1 + len)`; for each `j` gated by `activeDims_`: `d = useRandom ? (rand()&0xFF/127.5 - 1) : dir[j]/len`; `target[j] = clamp(neg_action[j] + d*effectivePushStep, 0, 1)`.
- `InterfaceRL.cpp:742-743` `negLRRatio = 0.5f - 0.4f*negFraction`; train geometric targets at `lr*negLRRatio`.
- `InterfaceRL.cpp:746` **cold-start fallback** when `posMemCount==0`: `TrainBatch(tsNegative, lr * 0.1f * avgRewardNeg, …)` — negative-LR training, no geometric push.

### 1.4 The deepest parity hazard (Anchored-Manifold / Anchor-First flagged it)
Upstream `optimise()` trains with **`TrainBatch`** (shuffled, `batchSize≈8`, separate positive/geometric batches at *two distinct* learning rates). The nisps `MLP::train()` (`mlp.hpp:256-300`) is **unshuffled per-sample SGD over the dataset insertion order** (its own comment: *"TrainBatch shuffles, but we're not implementing batch yet"*), has **no reward field** and **no train-toward-arbitrary-targets** entry. Reproducing the two-batch / dynamic-`negLRRatio` dynamics on a non-batch trainer is the real `browser != firmware` line. **We accept behavioural (not bitwise) parity with firmware here, and pin `native == WASM` at 1e-5.** Recorded in `ALIGNMENT.md`.

### 1.5 The injection points the masking/solo mechanism needs
- `mlp.hpp:281` — the per-sample `std::array<float,NOut> deriv{}` is the **exact place** to zero the output-error of non-soloed / don't-care dims before `backprop_` (`:291`). One branch per output dim.
- `rl.hpp:74-99` — `move_weights_layer` already skips the final-layer weight **column + bias** when `is_final_layer && output_pin_mask[node] != 0`. Solo's column-freeze is the **bitwise inverse** of this mask. Note the existing rule (`:88-96`): the RNG is advanced even on skipped weights so the stream is pin-independent — keep that invariant.
- `mode-runtime.ts:548-565` `thumbsDown` currently builds a pin mask and calls `moveWeights` — **no example stored**, no training. `thumbsUp` (`:523-546`) computes the `(features, labels)` and calls `addExample` + `trainOnCurrent`.

---

## 2. FEEDBACK_MODE = two operator-switchable modes

The selector is `exploration-store.ts` state `feedbackMode: 'explore-and-place' | 'geometric-dislike'`, surfaced in the **learning-behaviour dock panel** (§7). British spelling in all copy ("randomise", "auditioning", "centre", "behaviour").

### 2.1 Mode 1 — "Geometric dislike" (negative example + geometric push-away)

**Felt loop:** you have a region you like; thumbs-down carves the current sound *away* from the liked centroid. Directed repulsion, audibly directional — the fix for today's inaudible undirected diffusion (`findings-feedback-behaviour.md §5`).

**Algorithm — port `InterfaceRL.cpp` (0a541cc) into nisps core, keeping parity.** Because nisps has no async `optimise()` driver, the press-time half (`_perform_dislike_action`) and the optimise half collapse into one synchronous core call.

On thumbs-down at `controlInput x_neg` with heard action `a_neg`:
1. `replay.deepen_or_store_negative(x_neg, a_neg, radius=0.05f)` — nearby negative → `reward = max(reward-1, -16.f)`; else store `reward=-1`. `dislikeMultiplier_ = min(*2, 16)`. (`InterfaceRL.cpp:42-66`)
2. If `replay.positive_count() == 0` → **cold-start fallback**: `train_targets(x_neg → a_neg, lr * 0.1f * avgRewardNeg, …)` (`InterfaceRL.cpp:746`). Surface a one-time UI prompt *"like a few sounds first to teach the system what to move away from"* (closes the cold-start gap all four judges flagged).
3. Else: `replay.knn_positive_centroid(x_neg, k=4, &mean)` (`:602-627`); `pushStep = clamp(|avgRewardNeg|, 0.25f, 1.0f) * 0.5f`; per active/soloed dim `j`: `dir[j]=a_neg[j]-mean[j]`, `len=||dir||`, `effectivePushStep=pushStep/(1+len)`, `d = (len<=1e-4f) ? rng_.next_float_signed() : dir[j]/len`, `target[j]=clamp(a_neg[j]+d*effectivePushStep, 0, 1)`; non-active dims keep `a_neg[j]`.
4. `train_targets(x_neg → target, lr * negLRRatio, …)` with `negLRRatio = 0.5f - 0.4f*negFraction`.
5. `replay.decay_negatives()` each call: `reward += 0.0025f*max(|reward|,1)`, evict `reward > -0.01f`.

**Determinism carve-out:** the upstream `useRandom` branch uses libc `rand()&0xFF`; we substitute `rng_.next_float_signed()` (the controller's own per-instance `nisps::Rng`). Both native and WASM run the same Rng from the same seed → 1e-5 parity holds. This branch only fires when a disliked action sits exactly on the centroid. Record as the single deliberate firmware divergence in `ALIGNMENT.md`.

**On thumbs-up** (Mode 1): `replay.store(+1, x, a)` so the centroid sees positives; caller also runs the existing `addExample`+`train` like today.

**Files touched:** edit `feedback.hpp` `on_down` Avoid case (`:103-105`) → route to the geometric path; add `replay_` member; `on_up` LikeStore → `replay.store(+1,…)`. New `nisps/ml/replay.hpp` + `nisps/ml/geo_push.hpp` (§4). `move_weights` stays reachable as a **legacy `Diffuse` sub-mode** for A/B comparison (cheap insurance, lets the A/B-compare feature contrast geometric vs diffusion — graft from Minimal-Divergence).

### 2.2 Mode 2 — "Explore and place" (positive-only; NEVER a dislike) — **DEFAULT**

**Felt loop (Sift's north star):** *"randomise, explore, oh I like that → put it in that corner; meh, randomise…"*. The performer never reasons about "away from what" — they collect sounds they like. Place-by-corner is the **highest audible-effect-per-action gesture in the system**: one drop = one heard anchor the real model then interpolates.

Built on the existing `RandomiseMlp` scaffold (`feedback.hpp:113-119,183-201`) but to the stricter spec. Lifecycle state machine in the reworked `FeedbackController`, `FeedbackMode::ExploreAndPlace`:

1. **ENTER** (verdict-down/explore): `enter_scratchpad(mlp, spread)` — snapshot the real trained net into `snapshot_` (the set-aside model; existing `get_weights` round-trip), set `learning_paused_=true` (gates `trainOnCurrent` + auto-explore, mirroring upstream `optimiseSometimes` early-return), then `draw_weights(spread)` → **random scratchpad net**.
2. **SCRATCHPAD OPS — exactly two, position-agnostic, never trained, never a dislike:**
   - `reroll()` = `draw_weights(spread)` again ("meh, randomise…"). Re-press while exploring **re-rolls** (returns `Reroll`); a dedicated cancel gesture / mode-switch aborts. (This changes the old 2nd-press-cancels semantics — deliberate; rewrite the affected ctest.)
   - `nudge(speed, spread)` = a small `move_weights` on the scratchpad with a templated undo ring `scratch_undo_` (depth `D`; **WASM `D=4`, firmware `D=2`** via template param — Sift's free SRAM tunable). `undo_nudge()` pops. Reuses the byte-exact `get_weights`/`set_weights` round-trip (graft: no new parity surface). New actions `ScratchNudge`, `ScratchUndo`.
   - The scratchpad is **NEVER trained and NEVER reads replay** — auditioning is pure forward inference as the user sweeps the joystick.
3. **PLACE** (user likes a sound): press → **choose a location** in input space → release. `place_begin()` freezes the current scratchpad output vector into `placed_out_` (so the heard sound is held while the user aims; emitted via the existing `static_output` bypass hook so the audition doesn't change). The TS runtime owns the "aim" UI (a JoyMap drag). On release: caller sets the scratchpad input to `chosen_input`, runs `mlp.process()`, reads outputs, calls `place_commit(chosen_input, scratch_out_at_chosen)` → appends a **positive anchor** and returns `AnchorPlaced`. The controller does NOT itself run inference (keeps it pure — Minimal-Divergence's boundary contract).
4. **WARM-START INTERPOLATION** (explicit "Done"/finalise gesture): restore the set-aside net (`set_weights(snapshot_)`), then warm-start it to interpolate **all placed anchors**. **Decision (graft from all four risk-lists): warm-start is ADDITIVE — anchors are added to the existing dataset, NOT `clear_examples()`+refit** — so the user's prior thumbs-up likes are not clobbered. The caller loops `addExample(input, output)` over `replay.anchors()` then `train(lr, maxIter, minErr)` (caller owns training). "Warm-start" = begin from the *restored real net*, not a fresh draw, so prior structure is preserved. Returns `WarmStarted`; `learning_paused_` flips false.
5. **ABORT** (mode-switch / cancel): restore the set-aside net, discard anchors not yet finalised.

**Anchor store** = the same `ReplayStore` instance, positives only (§4). **Coupling decision (Sift's flag):** unifying Mode-1 replay and Mode-2 anchors into one store means a placed anchor also feeds Mode-1's positive centroid. This is a *feature* (mixed-mode sessions), but expose an operator toggle `unifyMemories` (default on) so they can be isolated into two `ReplayStore` instances if surprising.

**Why Mode 2 is the default:** highest audible-effect-per-action, no negative concept to learn, and it directly realises the operator's stated felt loop. Mode 1 is the precision/sculpting tool for when you already have a liked region.

---

## 3. SOLO / arm per output

State: `solo_mask_ : std::array<std::uint8_t, kNOut>` on the controller (`1`=armed/soloed, `0`=frozen; all-zero / empty ⇒ none soloed ⇒ normal training). API `set_solo_mask(span)` / `clear_solo_mask()`, C API `nisps_ml_feedback_set_solo(ml, mask, n)` (mirrors the existing `set_focus` at `bindings.cpp:485`). One operator setting `SOLO_MODE {MaskGradients=0, ZeroLoss=1, DontCareExample=2}`.

All three flow through **one injection point** — the per-sample `deriv` array at `mlp.hpp:281`, fused per Sift's graft (zeroing the loss on non-soloed outputs *is* the don't-care mask).

### 3.1 MaskGradients (DEFAULT) — column-freeze
Predictable: "only this output moves." Derive `pin_mask = bitwise-NOT(solo_mask)` over outputs. In a new `train_masked(lr, max_iter, min_err, out_mask)`: zero `deriv[j]` for non-soloed `j` **before** `backprop_`, **and** freeze hidden layers when any solo is active (skip `layer0_/1_/2_.apply_grad`; apply only `layer3_` for soloed columns). Result: non-soloed final-layer columns AND all hidden weights are **bit-identical** after training. This is the exact inverse of `rl.hpp:74-99`'s pin gating — minimal new code, reuses proven machinery.

### 3.2 ZeroLoss (selectable) — expressive-but-bleeds
Zero `deriv[j]` for non-soloed `j` but **let hidden layers update**. The soloed output gets the full network's expressive capacity, but non-soloed outputs can drift via shared hidden features. One-line variant of 3.1 (drop the hidden-layer freeze).

### 3.3 DontCareExample (selectable) — most faithful to "store with a mask"
Each `ReplayStore` item carries `uint8 mask[NOut]`. An example placed while output `k` is soloed stores `mask = {0…1@k…0}`; `train_masked` consumes the per-example mask so other outputs at that input are never pulled toward a stale label. Survives later training. Costs `Cap*NOut` bytes.

### 3.4 Honest limit (Sift's correctness graft — into product copy + ALIGNMENT.md)
**On a shared-trunk MLP, NO realisation both fully isolates AND stays expressive.** MaskGradients is predictable but weak (only the final linear column moves; hidden capacity frozen). ZeroLoss is expressive but bleeds through shared hidden weights. State this to the operator in the dock panel ("solo freezes the rest as far as a shared network allows") rather than overselling "leaves others unchanged". MaskGradients is the safe default because its guarantee is *provable* (§6.3 bit-identical ctest).

**Solo is honoured in both modes:** Mode-1 geometric `target` only pushes soloed dims (unify `solo_mask_` with the `activeDims_` gate at `InterfaceRL.cpp:730` — Anchor-First's graft); Mode-2 warm-start trains anchors only on soloed dims when solo is active.

---

## 4. Core component changes (keep replay OUT of the MLP kernel — Anchor-First)

### New `nisps/ml/replay.hpp`
`ReplayStore<NIn, NOut, Cap>` — fixed `std::array` ring (no heap; **WASM `Cap=64`, firmware `Cap=16-32` via template param** — Anchored-Manifold's free SRAM/centroid tradeoff). Item `{std::array<float,NIn> input; std::array<float,NOut> action; float reward; std::uint8_t mask[NOut];}`. Methods (all deterministic, per-instance `nisps::Rng`, **no libc rand**):
- `deepen_or_store_negative(x, a, radius=0.05f)` (`InterfaceRL.cpp:42-66`)
- `store(reward, x, a, mask)` / `positive_count()`
- `knn_positive_centroid(x, k=4, &mean, &count)` — linear scan, fixed top-k insertion (no `std::sort`, no heap). **Deterministic tie-break by index** and **fixed accumulation order** so native==WASM (the classic float-sum parity trap).
- `decay_negatives()` (`reward += 0.0025f*max(|reward|,1)`, evict `> -0.01f`)
- `anchors()` / `anchor_count()` accessors for Mode-2 warm-start replay.

### New `nisps/ml/geo_push.hpp`
Pure free function `compute_push_targets(replay, control_input, solo_mask, rng, &target_buf)` implementing `InterfaceRL.cpp:602-738` exactly. Writes into a caller-supplied scratch buffer (no heap). Keeps the geometric math out of both MLP and controller.

### `nisps/ml/mlp.hpp` — minimal backprop hooks only
- `train_targets(span inputs, span targets, span sample_weights, span out_mask, lr)` — trains toward *computed* target vectors (Mode-1 geometric batch; targets are computed, not stored labels). Reuses `forward_`/`backprop_`/`apply_grad`.
- `train_masked(lr, max_iter, min_err, span out_mask)` — the solo path: zeroes `deriv[j]` at `:281` for masked `j`; in MaskGradients freezes hidden `apply_grad`.
- Factor the inner forward→loss→backprop of `train()` into a `train_pair_` helper so both reuse the proven backprop (Minimal-Divergence graft). **No replay/centroid/anchor logic in MLP.**

### `nisps/ml/feedback.hpp` — edits (append-only enum)
- Add `ReplayStore<NIn,NOut> replay_`, `solo_mask_`, `scratch_undo_` ring (templated depth), `placed_out_`, `SoloMode` field.
- Edit `on_down` Avoid case → geometric push via `replay_` + `geo_push` + `train_targets`; keep a `Diffuse` legacy sub-mode.
- Edit `RandomiseMlp`/`ExploreAndPlace` `on_down` so re-press = `Reroll`.
- Add `nudge`/`undo_nudge`, `place_begin`/`place_commit`, `finalise`/`abort`, `set_solo_mask`/`clear_solo_mask`, `set_solo_mode`.
- **Append** new `FeedbackAction` values keeping existing numeric values stable: `GeometricPush=8, ScratchNudge=9, ScratchUndo=10, AnchorPlaced=11, WarmStarted=12` (Minimal-Divergence's single most parity-safe decision — never renumber the TS↔C++ contract).

### `nisps/wasm/bindings.cpp` — extend the existing block (`:439-535`)
Add: `nisps_ml_feedback_set_solo(ml,mask,n)`, `_set_solo_mode(ml,mode)`, `_nudge(ml,speed,spread)`, `_undo_nudge(ml)`, `_place_begin(ml,current_out)`, `_place_commit(ml,chosen_input,scratch_out)`, `_anchor_count(ml)`, `_get_anchors(ml,buf)`, `_finalise(ml)`, `_abort(ml)`. Existing `_down/_up/_drag/_static_output` stay; `_down` now returns the new action ints. Reuse the existing scratch buffers + guard/cast style.

### TS
- `playground/src/ml/types.ts` — add the new `_nisps_ml_feedback_*` decls; extend `FeedbackMode`/`FeedbackAction`/add `SoloMode` enums (numeric parity with C++).
- `playground/src/ml/wasm-iml.ts` — thin wrappers (`feedbackNudge`, `feedbackPlaceCommit`, `feedbackFinalise`, `feedbackSetSolo`, `getAnchors`); reuse `pinMaskBuf` (`:225`); add a small anchor heap buffer.
- `playground/src/modes/mode-runtime.ts` — route `thumbsDown` (`:548`) per active `feedbackMode`; Mode-2 wires press→aim→release to `place_begin`/`place_commit`; a "Done" button → `finalise` → loop `getAnchors`→`addExample`→`train`. Gate `trainOnCurrent` (`:516`) and auto-explore on `learning_paused()`.
- `playground/src/stores/exploration-store.ts` — add `feedbackMode`, `soloMode`, `soloMask`, `exploring`, `anchorCount`, `unifyMemories` + selectors.

---

## 5. Phased integration plan (TS-prototype-first; each step gated on `parity-check.sh`)

**Audible validation is the gate, not green tests.** Prototype the arithmetic in pure TS — driven through the EXISTING `WasmIML` primitives (`drawWeights`, `moveWeights`, `addExample`, `train`, `getWeights`/`setWeights`, `setInput`/`process`/`getOutputs`, verified at `wasm-iml.ts:293-476`) — before any new C++.

### Phase 0 — TS prototype (no new WASM)
A throwaway TS module mirrors `ReplayStore` + `geo_push` + `train_masked`, computed in TS and fed to the real net via existing calls. Oracles:
- **Mode 1:** like 2-3 sounds in distinct corners; dislike a sound near one like; confirm the heard 126-vector at that input moves **audibly AWAY** from the liked timbre (not random wobble). A/B against today's `moveWeights` thumbs-down using the existing A/B-compare feature — directionality must be **perceptible** (Sift's oracle).
- **Mode 2:** randomise → sweep-audition → "like that" → place in a corner → randomise → place opposite corner → Done → sweep the JoyMap and confirm a **smooth morph between the two placed timbres**, and that re-randomising no longer destroys them.
- **Solo:** solo output 0, train, confirm via the heatmap / weight-health views that only that param's mapping changed (MaskGradients: bit-stable elsewhere).
- Use `window.__nisps` (`setInputs`/`getOutputs`/`train`/`thumbsDown`/`getLayerStats`) for scripted Playwright checks.

**Gate:** felt loops audibly correct → freeze `kCentroidK`, `pushStep`, warm-start iteration count, undo depth. Only then crystallise.

### Phase 1 — C++ core
Add `replay.hpp`, `geo_push.hpp`, the `mlp.hpp` hooks, the `feedback.hpp` edits. Build `nisps_core_tests` (`-Wall -Wextra -Werror`). **Gate:** new ctest cases green (§6.1); `scripts/parity-check.sh` still 1e-5 (existing Stage 5 unchanged at this point).

### Phase 2 — C API
Add the new `nisps_ml_feedback_*` exports. Rebuild WASM (`scripts/build-wasm.sh`). **Gate:** `parity-check.sh` green after Stage-5 extension (§6.2); `kVersion` bump.

### Phase 3 — TS FFI
`types.ts` decls + enums, `wasm-iml.ts` wrappers. **Gate:** `bun run typecheck`; a TS↔WASM smoke test reproducing a Phase-0 loop through the real FFI matches the TS prototype's outputs; `parity-check.sh` green.

### Phase 4 — UI selector in the learning-behaviour dock panel
`exploration-store` state + the dock-panel `FEEDBACK_MODE` selector ("Explore and place" / "Geometric dislike"), `SOLO_MODE` selector, exploring/anchor indicators, the cold-start prompt, the honest solo-limit copy (British spelling). **Gate:** `bunx playwright test` (the e2e felt-loop specs); full `scripts/run-all-tests.sh` (chokepoint E) green.

### Phase 5 — firmware readiness (gated, not on the critical path)
Confirm RP2350 SRAM budget with firmware `Cap`/undo-depth template params (`ReplayStore<2,126,16>` + anchors + `scratch_undo_` depth 2). Verify chokepoint A (audio correct) / B (no perf regression) before flashing. Re-pin the orphaned memllib `4733ca0` to `0a541cc`.

---

## 6. Parity + perf contract

Native==WASM within 1e-5 is preserved because **every new operation is deterministic f32 arithmetic on the per-instance `nisps::Rng`** (no libc `rand()` anywhere). Both sides run the same Rng from the same seed (`kSeed ^ kFeedbackSalt`, matching the `MLHandle` `0xFEEDBACC0DE` salt).

### 6.1 Host ctest (`tests/cpp/test_mlp_feedback.cpp`, already registered)
Rewrite the cases that encode the old 2nd-press-cancels state machine (deliberate break). Add: replay dedup/deepen at 0.05; k-NN centroid selection + deterministic tie-break; geometric push direction sign (target moves away from centroid); taper; cold-start `posMemCount==0` fallback; **solo bit-identical assertion** — after `train_masked` with MaskGradients, non-soloed final-layer columns are `==` (not 1e-5-near) to pre-train (Anchored-Manifold's stronger-than-parity oracle); scratchpad-never-trained invariant; place→warm-start reachability (both anchors reproduced at their corners); determinism under fixed seed.

### 6.2 Native↔WASM parity (`parity_check.cpp` + `parity_wasm.mjs`, bump `kVersion`)
Extend Stage 5: **(S5a Mode 1)** seed `ParityMLP`+`ReplayStore`, store 3 fixed positives + 1 negative, run geometric push (centroid→target→`train_targets`), push 126 post-train probe outputs both sides. **(S5b Mode 2)** enter scratchpad, reroll×2, nudge, undo, place 2 anchors at fixed inputs, finalise (warm-start at fixed lr/iters/seed), push probe outputs + 12 weight probes. **(S5c Solo)** set `solo_mask={1,0,…}`, `train_masked`, assert non-soloed columns byte-identical pre/post. `scripts/parity-check.sh` float32-diffs at 1e-5 — new floats covered automatically.

### 6.3 Perf contract
`replay.hpp` + anchors + `solo_mask_` + `scratch_undo_` are all fixed `std::array` (Cap/depth compile-time, zero heap). Hot loops O(Cap*NOut) over fixed arrays; `roll`/`centroid`/`train_pair_` marked `NISPS_FORCE_INLINE` where hot; `.f` on every literal (`0.0025f`, `0.25f`, `0.5f`, `16.f`, `0.05f`). No virtual dispatch (plain template). Feedback runs on the **control core, never the audio ISR** (mirrors firmware `loopCallback`) → chokepoint B structurally satisfied. SRAM budget tuned per-target via `Cap`/depth template params.

---

## 7. UI — learning-behaviour dock panel

- **`FEEDBACK_MODE` segmented control:** *Explore and place* (default) / *Geometric dislike*. One-line description per mode in the operator's language.
- **`SOLO_MODE` selector** (visible when any output is armed): *Mask gradients* (default) / *Zero loss* / *Don't-care example*, with the honest "as far as a shared network allows" caveat.
- **Exploring indicator** + **anchor count** during Mode-2 sessions; a **Done / finalise** button and a **cancel** gesture; nudge + undo controls.
- **Cold-start prompt** (Mode 1, zero positives): *"Like a few sounds first so the system knows what to move away from."*
- **`unifyMemories` toggle** (advanced): share likes/dislikes across modes (default on).
- Copy uses British spelling throughout.

---

## 8. ALIGNMENT.md updates (same commit as the code)
1. **RETRACT** the `feedback-modes-port-spec.md §2.5/§7` "geometric push out of scope / AVOID = move_weights" accepted-divergence note — Mode 1 now ports the latest upstream. Without this, a future session will "rediscover" the geometric push as scope creep.
2. Record the **single deliberate firmware divergence**: the `useRandom` degenerate branch uses `nisps::Rng`, not libc `rand()` (value generated, never compared; native==WASM holds).
3. Record the **TrainBatch-vs-unshuffled-SGD** behavioural divergence: nisps trains per-sample SGD, not shuffled two-LR batches — `browser != firmware` behaviourally, by design (separate verification targets).
4. State the **shared-trunk solo limit** as accepted: no realisation both perfectly isolates and stays expressive.
5. Re-pin orphaned memllib `4733ca0` → `0a541cc`.