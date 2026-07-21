---
kind: plan
status: executed
---

# Implementation Spec — "Down Action" Negative-Feedback Feature in the `nisps/` Core

**Executed 2026-06/07; not authority for current behaviour.** The port landed, then evolved past
this document: the surviving truth is `docs/adr/rl-feedback-design.md` (which explicitly
supersedes §2.5/§7's AVOID-out-of-scope decision — the geometric push WAS ported, via
`nisps/ml/geo_push.hpp` + `nisps/ml/replay.hpp`) plus the code itself, `nisps/ml/feedback.hpp`
(now `FeedbackControllerCore<FbStorage>`, storage-policied, with ExploreAndPlace added). The
`playground/` paths below refer to the retired SolidJS app (branch `archive/playground-solidjs`);
the browser driver is now `manifold/src/feedback/controller.ts`.

## 0. Provenance

Every behavior below is read directly from local branch `fork-feedback` of the memllib submodule at `/home/w1n5t0n/src/MEMLNaut-NISPS-upstream/`:

- `examples/InterfaceRL.hpp` / `.cpp` — the FEEDBACK_MODE enum, all new state, all helpers.
- `hardware/memlnaut/display/RLView.hpp` — display only (out of scope for the core; informs JS only).
- `modes/MEMLNautModeTR8S.hpp` — selector + focus-mask wiring (`activeDims_` source).

Target core read from `/home/w1n5t0n/src/MEMLNaut-NISPS/`: `nisps/ml/{mlp,rl,init,training}.hpp`, `nisps/core/{concepts,perf,rng}.hpp`, `nisps/wasm/bindings.cpp`, plus the JS driver (`playground/src/modes/mode-runtime.ts`, `playground/src/ml/{wasm-iml.ts,types.ts}`, `playground/src/stores/exploration-store.ts`) and the test/parity harness (`tests/cpp/`).

---

## 1. Exact behavior of all 3 modes (from the real source)

The original feature replaces a single "thumbs-down" semantic with three selectable behaviors. The selector is `FEEDBACK_MODE` (`InterfaceRL.hpp`):

```cpp
enum class FEEDBACK_MODE : uint8_t {
    AVOID = 0,          // down = negative reward / geometric push away (current behaviour)
    RANDOMISE_OUTPUTS,  // down = bypass MLP, hold static random outputs (re-roll on each down); up = keep at current input
    RANDOMISE_MLP       // down = snapshot+randomise the live net (re-roll via left toggle); up/drag = keep & restore; down again = cancel
};
```

The exploration state, all `private` members in `InterfaceRL`:

```cpp
FEEDBACK_MODE feedbackMode_ = FEEDBACK_MODE::AVOID;
bool explore_active_ = false;   // inside a RANDOMISE_OUTPUTS static hold or RANDOMISE_MLP temp net
bool learningPaused_ = false;   // optimise() suspended while exploring
std::vector<float> staticRandomOut_;     // held output in RANDOMISE_OUTPUTS
MLP<float>::mlp_weights weightSnapshot_; // original net, saved in RANDOMISE_MLP
std::vector<bool> activeDims_;           // focus mask (set by the mode; empty == all active)
```

There are exactly three event entry points, dispatched in `loopCallback` (thread context, never ISR):
- **up** = thumbs-up (MomA1) → `_feedback_up()`
- **down** = thumbs-down (MomA2) → `_feedback_down()`
- **drag-store** = joystick-click / Tog-A1 release → `_feedback_drag_store()`

Plus a fourth implicit transition: **switching the mode** while exploring → `_abort_explore()`.

A critical cross-cutting fact: `optimiseSometimes()` early-returns when `learningPaused_` is true, so **training is fully suspended during any active exploration** in modes 2 and 3.

### 1.1 Mode AVOID (`FEEDBACK_MODE::AVOID`) — historical behavior, unchanged

State machine is trivial — `explore_active_`/`learningPaused_` are never touched.

| Event | Action |
|-------|--------|
| **up** | `_perform_like_action()` — store `+1` example at `(controlInput, action)`; reset `dislikeMultiplier_ = 1`. |
| **down** | `_perform_dislike_action()` — store/strengthen a negative example (see below). |
| **drag-store** | `storeExperience(1.f, controlInput, savedAction)` — place the frozen output as a `+1` example. |

`_perform_dislike_action()` (`InterfaceRL.cpp:41`): scan replay memory; if a *negative* item exists within Euclidean distance `0.05` of `controlInput`, **deepen** it (`reward = max(reward - 1, -kMaxDislikeMultiplier)` where `kMaxDislikeMultiplier = 16`) instead of adding a duplicate; otherwise `storeExperience(-1.f, ...)`. Then `dislikeMultiplier_ = min(dislikeMultiplier_ * 2, 16)`.

The actual "push away" happens later in `optimise()` (`InterfaceRL.cpp:717`), **not** at press time. The geometric-push formula (the semantic that matters for reconciliation, §2.5):

```cpp
// meanPositiveAction = mean of the kCentroidK (=4) positive memories
//                      nearest to controlInput (k-NN centroid).
float pushStep = std::clamp(fabsf(avgRewardNeg), 0.25f, 1.0f) * kGeometricPushScale; // kGeometricPushScale = 0.5
for (const auto& neg_action : tsNegative.second) {
    dir[j]  = neg_action[j] - meanPositiveAction[j];   // direction AWAY from positive centroid
    len     = ||dir||;
    const float effectivePushStep = pushStep / (1.0f + len);  // taper when already far
    // useRandom when len <= 1e-4 (degenerate: neg sits on the centroid)
    for each dim j with activeDims_[j]:
        float d = useRandom ? (rand&0xFF/127.5 - 1) : (dir[j]/len);
        target[j] = clamp(neg_action[j] + d * effectivePushStep, 0, 1);
    // train MLP toward `target` (push the disliked action away from the liked centroid)
}
```

So **AVOID = "move the network's output at the disliked input geometrically away from the centroid of nearby liked outputs."** Focus-aware: dims with `activeDims_[j] == false` are left untouched (`if (!active) continue;`).

### 1.2 Mode RANDOMISE_OUTPUTS (`FEEDBACK_MODE::RANDOMISE_OUTPUTS`)

Bypasses the MLP entirely and holds a static, hand-rolled output vector. The MLP and replay memory are not modified until commit.

| Event | `explore_active_ == false` (idle) | `explore_active_ == true` (exploring) |
|-------|-----------------------------------|----------------------------------------|
| **down** (1st) | `_enter_randomise_outputs()` | — |
| **down** (subsequent) | — | `_roll_static_outputs()` (re-roll) |
| **up** | `_perform_like_action()` (normal like) | `_commit_explore(controlInput, action)` (keep) |
| **drag-store** | normal `+1` store | normal `+1` store, **stays in explore** (keep re-rolling) |

`_enter_randomise_outputs()` (`InterfaceRL.cpp:150`):
```cpp
explore_active_ = true;
learningPaused_ = true;
staticRandomOut_ = action;   // seed inactive dims with current value
_roll_static_outputs();
```

`_roll_static_outputs()` — **the randomisation formula** (`InterfaceRL.cpp:159`):
```cpp
if (staticRandomOut_.size() != action.size()) staticRandomOut_ = action;
for (size_t i = 0; i < staticRandomOut_.size(); i++) {
    const bool active = activeDims_.empty() || (i < activeDims_.size() && activeDims_[i]);
    if (active) staticRandomOut_[i] = static_cast<float>(rand() & 0xFFFF) / 65535.f; // uniform [0,1]
    // inactive dims keep their seeded entry value
}
newInput = true;
```

Per-dim: **focused dims → fresh uniform [0,1]; unfocused dims → frozen at the value `action` had on entry.** The held vector is emitted in `generateAction()` with **no inference and no OU noise** (`InterfaceRL.cpp:998`):
```cpp
if (feedbackMode_ == FEEDBACK_MODE::RANDOMISE_OUTPUTS && explore_active_) {
    mappingOutput = staticRandomOut_;   // MLP bypassed
} else { /* GetOutput + OU noise + reflect-at-bounds */ }
```

`_commit_explore(inputPos, outputVal)` (`InterfaceRL.cpp:188`): `storeExperience(1.f, inputPos, outputVal)` then `_restore_after_explore()`. For OUTPUTS, `outputVal == action`, i.e. **the static sound as currently heard becomes a +1 example at the current input**, after which inference resumes.

`_restore_after_explore()` (`InterfaceRL.cpp:194`): for OUTPUTS it does **not** touch weights (no snapshot exists); it only `learningPaused_ = false; explore_active_ = false; newInput = true;`.

### 1.3 Mode RANDOMISE_MLP (`FEEDBACK_MODE::RANDOMISE_MLP`)

Snapshots the live weights, randomises the live net into a "temp net", and lets the user audition. Commit/restore swaps the original net back.

| Event | `explore_active_ == false` (idle) | `explore_active_ == true` (exploring) |
|-------|-----------------------------------|----------------------------------------|
| **down** (1st) | `_enter_randomise_mlp()` | — |
| **down** (subsequent) | — | `_cancel_explore()` (discard temp net, restore original) |
| **re-roll** | — | (firmware: left-toggle → `randomiseTheNetwork()`; **not a `_feedback_*` hook**) |
| **up** | `_perform_like_action()` | `_commit_explore(controlInput, action)` (keep) |
| **drag-store** | normal `+1` store | `+1` store **and** `_restore_after_explore()` (reposition-commit) |

`_enter_randomise_mlp()` (`InterfaceRL.cpp:170`):
```cpp
explore_active_ = true;
weightSnapshot_ = synthMapping->GetWeights();  // stash the REAL net
learningPaused_ = true;
randomiseTheNetwork();   // RandomiseWeightsAndBiasesLin(-0.9,1.1, -0.9,0.3); sets newInput
```

`_cancel_explore()` (`InterfaceRL.cpp:179`): `SetWeights(weightSnapshot_)` (discard temp), resume learning, clear flags.

`_commit_explore()` → `storeExperience(1.f, controlInput, action)` then `_restore_after_explore()`. For MLP, `_restore_after_explore()` **restores the original net** (`SetWeights(weightSnapshot_)`) — the just-stored example then trains the *original* net toward the auditioned output. So the temp net is never kept as-is; instead the example it produced is grafted onto the real net via training.

The drag-store interaction (`_feedback_drag_store()`, `InterfaceRL.cpp:139`) is the only place the drag is more than a plain store:
```cpp
storeExperience(1.f, controlInput, savedAction);
_refresh_mem_counts();
if (feedbackMode_ == FEEDBACK_MODE::RANDOMISE_MLP && explore_active_) {
    _restore_after_explore();   // drag == reposition-commit
}
```

### 1.4 Forced teardown — `_abort_explore()` and mode switching

`setFeedbackMode(m)` (`InterfaceRL.hpp`): `if (explore_active_) _abort_explore(); feedbackMode_ = m;`. `_abort_explore()` is `_restore_after_explore()` minus the display calls: it restores the snapshot **only in MLP mode**, resumes learning, clears flags. This guarantees switching modes mid-exploration leaves the real net intact and learning resumed.

### 1.5 Focus-awareness summary (`activeDims_`)

`activeDims_` is a `std::vector<bool>` set by the mode (`setActiveDims`). Empty ⇒ all dims active. It gates three places:
- AVOID geometric push: unfocused dims not pushed.
- RANDOMISE_OUTPUTS roll: unfocused dims frozen at entry value.
- (RANDOMISE_MLP has no per-dim focus — randomising weights affects all outputs; focus is only relevant via the output transform downstream.)

In TR-8S (`MEMLNautModeTR8S.hpp`) the mask is derived from a `FocusManager<kN_Params, 12>` (one group per drum voice + FX). This is **mode/UI policy**, not core logic.

---

## 2. Clean design for the new core component

### 2.1 Where the semantics diverge between old and new (must reconcile first)

| Concept | Old (`fork-feedback`) | New core (`nisps/ml/`) |
|---------|-----------------------|------------------------|
| MLP type | `MLP<float>` runtime-sized, heap (`std::vector`, `std::make_shared`) | `MLP<NIn,H1,H2,H3,NOut,...>` compile-time, all `std::array`, zero heap |
| Weight snapshot | `MLP<float>::mlp_weights` (nested `std::vector`) | flat `std::span<const float>` from `get_weights()` (size `weight_count()`) |
| RNG | global libc `rand()` | per-instance `nisps::Rng` (xoshiro256+), deterministic |
| Randomise net | `RandomiseWeightsAndBiasesLin(-0.9,1.1,-0.9,0.3)` (asymmetric uniform) | `draw_weights(spread)` (spread-aware Xavier↔uniform) |
| "Avoid" | geometric push toward/away centroid, deferred in `optimise()` | `move_weights(speed, spread, pin_mask)` = decay + Gaussian perturbation |
| Output buffer | `std::vector<float> staticRandomOut_` runtime-sized | fixed `std::array<float, NOut>` |
| Training pause | `learningPaused_` short-circuits `optimise()` | core has no training loop driver; pause must be a queryable flag the *caller's* train path honors |

**Recommendation for "Avoid" in the new core:** Do **not** port the k-NN geometric centroid push. It depends on `ReplayMemory<trainStatelessRLItem>` (rewards, decay, accumulation) which is firmware-only and absent from `nisps/`. The new playground already implements AVOID as **`move_weights(cap, spread, pinMask)` + noise growth** (`mode-runtime.ts::thumbsDown`). Define **`Avoid` in the new core as "delegate to the existing `move_weights` Gaussian perturbation."** This is the documented parity contract in `rl.hpp`. The geometric-centroid behavior is a separate, richer algorithm that should be filed as a follow-up if desired — it is NOT part of this port, and the spec should say so explicitly. The FeedbackController's job for AVOID is purely to **route** to `move_weights`; it owns no AVOID-specific state.

This keeps the controller small: it only owns state for the two RANDOMISE modes.

### 2.2 Proposed component: `nisps::ml::FeedbackController<MLP_T>`

A header-only class template parameterized on the concrete MLP type, living at **`/home/w1n5t0n/src/MEMLNaut-NISPS/nisps/ml/feedback.hpp`**, namespace `nisps::ml`. It does **not** own the MLP; every mutating method takes `MLP_T&`. It owns only the exploration state. No virtual dispatch, no heap, per-instance RNG (its own, seeded independently from the MLP's so the static-output stream is reproducible without perturbing inference noise).

```cpp
// nisps/ml/feedback.hpp
#pragma once
#include <array>
#include <cstdint>
#include <span>
#include "../core/perf.hpp"
#include "../core/rng.hpp"

namespace nisps::ml {

enum class FeedbackMode : std::uint8_t {
    Avoid           = 0,  // down → move_weights (Gaussian perturb). No internal state.
    RandomiseOutputs= 1,  // down → bypass MLP, hold static random vector; re-roll each down.
    RandomiseMlp    = 2,  // down → snapshot+draw_weights live net; down-again cancels.
};

// What a down/up/drag press resolved to — the caller (JS runtime / firmware glue)
// acts on this (store example, run move_weights, refresh UI). Keeps side effects
// that touch replay memory / training OUT of the core.
enum class FeedbackAction : std::uint8_t {
    None,
    AvoidPerturb,      // caller: run mlp.move_weights(speed, spread, pin) + grow noise
    LikeStore,         // caller: add +1 example at (input, output) + train
    EnterExplore,      // entered a RANDOMISE_* exploration (UI: show "exploring")
    Reroll,            // re-rolled within an exploration (UI feedback)
    CommitStore,       // caller: add +1 example at (input, current output), THEN explore ended
    Cancel,            // exploration discarded; net restored
    Restore,           // exploration kept (drag reposition path); net restored
};

template <typename MLP_T>
class FeedbackController {
   public:
    static constexpr std::size_t kNOut = MLP_T::kOutput;
    static constexpr std::size_t kWeights = MLP_T::weight_count();

    explicit FeedbackController(std::uint64_t seed) noexcept : rng_(seed) {}

    void set_mode(FeedbackMode m, MLP_T& mlp) noexcept {
        if (explore_active_) abort_explore(mlp);   // clean teardown on switch
        mode_ = m;
    }
    FeedbackMode mode() const noexcept { return mode_; }

    bool exploring()       const noexcept { return explore_active_; }
    bool learning_paused() const noexcept { return learning_paused_; }

    // Focus mask: 1 byte per output; mask[i]==0 means "frozen" (unfocused).
    // Empty span ⇒ all active. Copied into a fixed buffer (no heap, no dangling).
    void set_focus_mask(std::span<const std::uint8_t> mask) noexcept {
        focus_count_ = (mask.size() < kNOut) ? mask.size() : kNOut;
        for (std::size_t i = 0; i < focus_count_; ++i) focus_[i] = mask[i];
    }
    void clear_focus_mask() noexcept { focus_count_ = 0; }

    // --- press handlers. `current_out` is the live post-pipeline output the
    // user is hearing (NOut floats). They return a FeedbackAction telling the
    // caller what replay-memory / training side effect to perform. ---
    FeedbackAction on_down(MLP_T& mlp, std::span<const float> current_out,
                           float speed, float spread,
                           std::span<const std::uint8_t> pin_mask) noexcept;
    FeedbackAction on_up  (MLP_T& mlp) noexcept;
    FeedbackAction on_drag(MLP_T& mlp) noexcept;

    // Inference hook: returns true and fills `out` with the held static vector
    // when RandomiseOutputs is bypassing the MLP; returns false otherwise
    // (caller should run mlp.process() normally).
    bool static_output(std::span<float> out) const noexcept {
        if (!(mode_ == FeedbackMode::RandomiseOutputs && explore_active_)) return false;
        for (std::size_t i = 0; i < kNOut; ++i) out[i] = static_out_[i];
        return true;
    }

    void seed(std::uint64_t s) noexcept { rng_.seed(s); }

   private:
    void enter_randomise_outputs(std::span<const float> seed_out) noexcept {
        explore_active_ = true; learning_paused_ = true;
        for (std::size_t i = 0; i < kNOut; ++i) static_out_[i] = seed_out[i];
        roll_static_outputs();
    }
    void roll_static_outputs() noexcept {
        for (std::size_t i = 0; i < kNOut; ++i) {
            const bool active = (focus_count_ == 0u) || (i < focus_count_ && focus_[i] != 0u);
            if (active) static_out_[i] = rng_.next_float_uniform(); // [0,1) — see §2.4
        }
    }
    void enter_randomise_mlp(MLP_T& mlp, float spread) noexcept {
        explore_active_ = true; learning_paused_ = true;
        auto w = mlp.get_weights();                  // flat snapshot
        for (std::size_t i = 0; i < kWeights; ++i) snapshot_[i] = w[i];
        mlp.draw_weights(spread);                    // randomise live net
    }
    void restore_after_explore(MLP_T& mlp) noexcept {
        if (mode_ == FeedbackMode::RandomiseMlp)
            mlp.set_weights(std::span<const float>(snapshot_.data(), kWeights));
        learning_paused_ = false; explore_active_ = false;
    }
    void cancel_explore(MLP_T& mlp) noexcept {
        if (mode_ == FeedbackMode::RandomiseMlp)
            mlp.set_weights(std::span<const float>(snapshot_.data(), kWeights));
        learning_paused_ = false; explore_active_ = false;
    }
    void abort_explore(MLP_T& mlp) noexcept { cancel_explore(mlp); }

    FeedbackMode mode_ = FeedbackMode::Avoid;
    bool explore_active_  = false;
    bool learning_paused_ = false;
    std::array<float, kNOut>     static_out_{};
    std::array<float, kWeights>  snapshot_{};   // flat weight snapshot, no heap
    std::array<std::uint8_t, kNOut> focus_{};
    std::size_t focus_count_ = 0;               // 0 ⇒ all active
    Rng rng_;
};
}  // namespace nisps::ml
```

The press handlers mirror the old `_feedback_up/_down/_drag_store` switch exactly:

```cpp
template <typename M>
FeedbackAction FeedbackController<M>::on_down(M& mlp, std::span<const float> current_out,
        float speed, float spread, std::span<const std::uint8_t> pin_mask) noexcept {
    switch (mode_) {
        case FeedbackMode::Avoid:
            mlp.move_weights(speed, spread, pin_mask);   // AVOID == perturb (see §2.5)
            return FeedbackAction::AvoidPerturb;
        case FeedbackMode::RandomiseOutputs:
            if (!explore_active_) { enter_randomise_outputs(current_out); return FeedbackAction::EnterExplore; }
            roll_static_outputs();                       return FeedbackAction::Reroll;
        case FeedbackMode::RandomiseMlp:
            if (!explore_active_) { enter_randomise_mlp(mlp, spread); return FeedbackAction::EnterExplore; }
            cancel_explore(mlp);                         return FeedbackAction::Cancel;
    }
    return FeedbackAction::None;
}

template <typename M>
FeedbackAction FeedbackController<M>::on_up(M& mlp) noexcept {
    if ((mode_ == FeedbackMode::RandomiseOutputs || mode_ == FeedbackMode::RandomiseMlp) && explore_active_) {
        restore_after_explore(mlp);     // caller stores +1 at (input, current_out) FIRST
        return FeedbackAction::CommitStore;
    }
    return FeedbackAction::LikeStore;   // AVOID up, or idle RANDOMISE up
}

template <typename M>
FeedbackAction FeedbackController<M>::on_drag(M& mlp) noexcept {
    if (mode_ == FeedbackMode::RandomiseMlp && explore_active_) {
        restore_after_explore(mlp);
        return FeedbackAction::Restore;  // caller already stored the +1 from savedAction
    }
    return FeedbackAction::LikeStore;    // plain drag-store
}
```

> Note the ordering contract: in the old `_commit_explore`, `storeExperience` runs **before** `_restore_after_explore` (so in MLP mode the example is captured from the temp net's output, then the original net is restored and trained). The new core encodes this as: `on_up` returns `CommitStore` and the **caller must add the example using the output it captured before calling `on_up`** (which is exactly the live `current_out`). Document this loudly at the call site.

### 2.3 Why a "FeedbackController" and not an MLP/engine extension

- **The MLP must stay a pure numeric kernel.** It already satisfies `MLEngine` (`concepts.hpp`) with no notion of "exploration", "focus", or "modes". Bolting feedback state onto `MLP` would (a) inflate `weight_count()`-sized snapshot storage onto every MLP instance even when unused, and (b) couple the parity/golden vectors to UI policy. Keep it separate.
- **The controller is the natural home for the snapshot** because the snapshot size is `MLP_T::weight_count()` — known at compile time, so a `std::array` works and the no-heap rule is honored.
- It composes: firmware modes and the WASM handle both already hold an MLP; they add one `FeedbackController` next to it.

### 2.4 RNG reconciliation

Old `_roll_static_outputs` uses `rand() & 0xFFFF / 65535.f` (libc, non-deterministic, global). New core uses the per-instance `Rng`. Two choices for the static-output stream:
- **Recommended:** the controller owns its **own** `Rng rng_` seeded separately. Rationale: re-rolling outputs must not advance the MLP's inference/move RNG (that would make inference noise depend on how many times the user pressed "down"), and a separate stream makes the OUTPUTS path independently reproducible in tests. `rng_.next_float_uniform()` already returns `[0,1)` — semantically equivalent to the old `[0, 65535]/65535` up to the endpoint and resolution, well within parity tolerance because this value is *generated*, not *compared against the MLP*.
- For RANDOMISE_MLP, `draw_weights(spread)` uses the **MLP's** RNG (correct — it's the net being randomised), matching how `nisps_ml_draw_weights` already advances the MLP stream.

### 2.5 AVOID reconciliation, restated as a decision

`move_weights` (Gaussian decay+perturb) and the old geometric centroid push are **different algorithms**. The new playground already shipped AVOID-as-`move_weights`. Therefore:
- **`FeedbackController::Avoid` routes `on_down` → `mlp.move_weights(speed, spread, pin_mask)`** and returns `AvoidPerturb`. It carries no replay memory and no centroid math.
- The richer geometric-push avoidance (with `ReplayMemory`, reward decay, k-NN centroid) is **explicitly out of scope** for this port; if wanted later it belongs in a separate replay-memory component, not the FeedbackController. Flag this in `ALIGNMENT.md` as an accepted divergence so a future session doesn't "rediscover" it as a bug.

---

## 3. The C++/JS boundary — what lives where

**Lives in C++ (`FeedbackController`, shared with firmware):**
- `mode_` enum, `explore_active_`, `learning_paused_`.
- `static_out_` buffer (`NOut` floats) + the re-roll formula + the bypass-inference hook.
- `snapshot_` flat weights + snapshot/restore/cancel via `get_weights`/`set_weights`.
- focus mask (`NOut` bytes) + the focus-gated roll.
- The on_down/up/drag state-transition logic and the `FeedbackAction` it returns.

**Stays in the SolidJS runtime (inherently UI / orchestration):**
- *Which input/output vector* to store as the example (depends on the pipeline-processed outputs, overrides, mic features) — `mode-runtime.ts::thumbsUp/thumbsDown` already computes these.
- *When* to train, the LR, snapshot stack for undo (`autoSnapshot`), noise growth/decay (`exploration-store.ts`).
- Building the `pin_mask` (`buildPinMask` from overrides + param pins).
- Display strings, "Down Action" selector widget, toasts. (`RLView` in firmware is the analogous display — out of core scope.)
- The replay-memory / example dataset itself stays caller-side (the JS `Dataset` + the MLP's own ring buffer).

**Max-sharing principle honored:** all the *fiddly state-machine logic* (the part with off-by-one re-roll/cancel/commit bugs) is shared C++; only data the core cannot know (pipeline outputs, pins, UI) stays in JS. The boundary is "the controller decides *what transition happened*; the caller decides *what to persist*."

The JS runtime keeps `learning_paused()` honored by gating its `trainOnCurrent()` and auto-explore tick: when paused, skip training (mirrors `optimiseSometimes()`'s early return).

---

## 4. WASM C API additions

Add to `nisps/wasm/bindings.cpp`. The `MLHandle` gains a `FeedbackController` next to its `DefaultMLP` (`FeedbackController<DefaultMLP>`), seeded off the same JS seed XOR a salt so its stream is independent of the MLP's:

```cpp
// inside struct MLHandle:
nisps::ml::FeedbackController<DefaultMLP> feedback;
std::array<float, kDefaultOutputs> static_out_scratch{};   // for nisps_ml_feedback_static_output
explicit MLHandle(std::uint64_t seed) noexcept
    : mlp(seed), feedback(seed ^ 0xFEEDBACC0DEull) {}
```

New `extern "C"` functions (all `EMSCRIPTEN_KEEPALIVE`):

```cpp
// Mode + state.
void   nisps_ml_feedback_set_mode(void* ml, int mode);             // 0=Avoid 1=RandOut 2=RandMlp
int    nisps_ml_feedback_get_mode(void* ml);
int    nisps_ml_feedback_exploring(void* ml);                      // 0/1
int    nisps_ml_feedback_learning_paused(void* ml);                // 0/1

// Focus mask (NOut bytes; pass nullptr/0 to clear).
void   nisps_ml_feedback_set_focus(void* ml, const uint8_t* mask, int n);

// Press handlers. `current_out` = NOut floats the user is hearing.
// `pin_mask` may be null. Return value is the FeedbackAction enum (int) so JS
// knows what to persist (store example / perturb / commit / cancel).
int    nisps_ml_feedback_down(void* ml, const float* current_out,
                              float speed, float spread, const uint8_t* pin_mask);
int    nisps_ml_feedback_up(void* ml);
int    nisps_ml_feedback_drag(void* ml);

// Inference hook: if returns 1, `out` (NOut floats) holds the static bypass
// vector and the caller should NOT call nisps_ml_process(); if 0, run process().
int    nisps_ml_feedback_static_output(void* ml, float* out);
```

Representative implementation (matches the existing guard/cast style in `bindings.cpp`):

```cpp
EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_down(void* ml, const float* current_out,
                           float speed, float spread, const uint8_t* pin_mask) {
    if (!ml) return 0;
    auto* h = static_cast<MLHandle*>(ml);
    std::span<const float> out = current_out
        ? std::span<const float>(current_out, kDefaultOutputs) : std::span<const float>{};
    std::span<const std::uint8_t> mask = pin_mask
        ? std::span<const std::uint8_t>(pin_mask, kDefaultOutputs) : std::span<const std::uint8_t>{};
    return static_cast<int>(h->feedback.on_down(h->mlp, out, speed, spread, mask));
}
```

**TS FFI declarations** to add to `playground/src/ml/types.ts` (`NispsModule` interface, mirroring the existing `_nisps_ml_*` block):

```ts
// Feedback / Down-Action.
_nisps_ml_feedback_set_mode(ml: number, mode: number): void;
_nisps_ml_feedback_get_mode(ml: number): number;
_nisps_ml_feedback_exploring(ml: number): number;
_nisps_ml_feedback_learning_paused(ml: number): number;
_nisps_ml_feedback_set_focus(ml: number, mask_ptr: number, n: number): void;
_nisps_ml_feedback_down(ml: number, current_out_ptr: number, speed: number, spread: number, pin_mask_ptr: number): number;
_nisps_ml_feedback_up(ml: number): number;
_nisps_ml_feedback_drag(ml: number): number;
_nisps_ml_feedback_static_output(ml: number, out_ptr: number): number;
```

Plus a `FeedbackAction` / `FeedbackMode` TS enum in `types.ts` mirroring the C++ enums (numeric values must match). `WasmIML` (`wasm-iml.ts`) gains thin wrappers (`feedbackDown(currentOut, speed, spread, pinMask)`, etc.) that reuse the existing `pinMaskBuf` and add a small `static_out` heap buffer; the parity `.mjs` shim adds `cwrap` bindings for the same names.

---

## 5. Test plan

### 5.1 Host ctest — new file `tests/cpp/test_mlp_feedback.cpp`

Register it in the `nisps_core_tests` executable in `nisps/CMakeLists.txt` (it links `nisps_core`, builds under `-Wall -Wextra -Werror -Wpedantic`). Use the existing harness (`NISPS_TEST` / `NISPS_EXPECT` / `NISPS_EXPECT_NEAR`) and a small MLP like the existing RL test (`MLP<2,4,4,4,6,8,32>`). Because the controller takes `MLP_T&`, instantiate `FeedbackController<SmallMLP>`.

Cases (one `NISPS_TEST` each):

1. **`feedback_avoid_routes_to_move_weights`** — mode Avoid; snapshot weights; `on_down(...)` returns `AvoidPerturb` and weights changed (most distinct), mirroring `mlp_move_weights_changes_unpinned_weights`. `exploring()` stays false; `learning_paused()` stays false.
2. **`feedback_randout_enter_roll_state`** — mode RandomiseOutputs; `on_down` (1st) → `EnterExplore`, `exploring()==true`, `learning_paused()==true`; `static_output(buf)` returns true and buf differs from `current_out` on focused dims.
3. **`feedback_randout_reroll_changes_focused_only`** — set focus mask `{1,0,1,0,1,0}`; enter; capture static; `on_down` again → `Reroll`; assert unfocused dims **unchanged** (frozen at seed value), focused dims **changed**.
4. **`feedback_randout_commit_clears_state`** — while exploring, `on_up` → `CommitStore`, then `exploring()==false`, `learning_paused()==false`, `static_output()` returns false (MLP no longer bypassed). Weights unchanged (OUTPUTS never touches the net).
5. **`feedback_randmlp_snapshot_and_cancel_restores`** — mode RandomiseMlp; snapshot weights `W0` (via `get_weights`); `on_down` (1st) → `EnterExplore`, weights now differ from `W0`; `on_down` again → `Cancel`; `get_weights()` byte-equals `W0` (exact `==`).
6. **`feedback_randmlp_commit_restores_then_caller_trains`** — enter; `on_up` → `CommitStore`; assert net restored to `W0` (the kept example is the caller's responsibility; here we assert the restore semantics: post-commit weights == `W0`).
7. **`feedback_randmlp_drag_repositions`** — enter; `on_drag` → `Restore`, net restored to `W0`, `exploring()==false`.
8. **`feedback_mode_switch_aborts_explore`** — enter RandomiseMlp; `set_mode(Avoid, mlp)` → net restored to `W0`, `exploring()==false`, `learning_paused()==false`.
9. **`feedback_determinism_fixed_seed`** — two `FeedbackController`s with the same seed, same MLP-seed, identical press sequence (enter RandomiseOutputs, two re-rolls) → `static_output` buffers byte-identical. Proves per-instance RNG determinism (no libc `rand()`).
10. **`feedback_focus_empty_means_all_active`** — no focus mask set; enter RandomiseOutputs; all NOut dims changed from a fixed seed-vector of constants.
11. **`feedback_static_output_bypass_only_in_randout`** — `static_output()` returns false in Avoid and in idle RandomiseOutputs, true only when `RandomiseOutputs && exploring`.

### 5.2 Native↔WASM parity

Extend the standalone parity runner in lock-step (`parity_check.cpp` + `parity_wasm.mjs`), appending a feedback block to the existing payload **after** the current stages (bump `kVersion` to 2 in both files and `parity_diff.mjs` if it checks version). Deterministic sequence, identical on both sides:

```
// Stage 5 (feedback): with the SAME ParityMLP, after stage-2 training:
//   feedback.set_mode(RandomiseOutputs)
//   feedback.on_down(current_out = stage-2 outputs, speed=0.1, spread=0.5, pin=null)  → EnterExplore
//   feedback.static_output(buf)  → push 126 floats
//   feedback.on_down(... )       → Reroll
//   feedback.static_output(buf)  → push 126 floats
//   feedback.set_mode(RandomiseMlp); feedback.on_down(...) (enter, draws weights)
//   push 12 probed weights of the now-randomised temp net
//   feedback.on_up()             → CommitStore (restores)
//   push 12 probed weights of the restored net  (must equal pre-explore probes)
```

The controller must be seeded **identically** in `parity_check.cpp` and `parity_wasm.mjs` (e.g. seed `kSeed ^ 0xFEEDBACC0DE`, matching the `MLHandle` salt). `scripts/parity-check.sh` already float32-diffs at 1e-5 — the new floats are covered automatically. The RandomiseOutputs static vectors are RNG output (not compared against the MLP), so as long as both sides run the *same* `nisps::Rng` from the *same* seed they match exactly; the RandomiseMlp restore-probes prove `get_weights`/`set_weights` round-trips identically across native/WASM.

### 5.3 Existing suites

`nisps_core_tests`, `nisps_dsp_engine_tests`, `nisps_modes_tests`, `nisps_golden_tests` are unaffected (controller is additive). `bash scripts/run-all-tests.sh` (chokepoint E) gains the new ctest case and the extended parity blob. **No hardware** is exercised.

---

## 6. Firmware note — feasibility

The same `FeedbackController<MLP_T>` drops into a firmware mode unchanged, because it honors every rule in the RP2350 performance contract (`CLAUDE.md`):
- **No heap:** `static_out_`, `snapshot_`, `focus_` are all `std::array` sized from `MLP_T::weight_count()` / `kOutput` at compile time. No `std::vector`, no `make_shared` (unlike the old `mlp_weights`).
- **No virtual dispatch:** plain class template; press handlers are direct calls.
- **Deterministic per-instance RNG:** uses `nisps::Rng`, constructed with a seed.
- **`.f` literals / `NISPS_*` attrs:** the controller's hot path is trivial (a loop over `NOut`); mark `roll_static_outputs`/`static_output` `NISPS_FORCE_INLINE` and any audio-touched members `NISPS_AUDIO_MEM` if a firmware mode reads `static_out_` from the audio core (it would not — feedback runs on the control/UI core, like the old `loopCallback`).

Wiring in a future firmware mode (analogous to the TR-8S `bind_RL_interface` callbacks):
- MomA1 (up) handler → set a `volatile pendingUp_` flag; control loop calls `controller.on_up(mlp)` and, on `CommitStore`/`LikeStore`, adds the example to whatever replay/dataset the firmware mode keeps.
- MomA2 (down) → `pendingDown_` → `controller.on_down(mlp, current_out, speed, spread, pin)`.
- Joystick-click / Tog-A1 release → `pendingDrag_` → `controller.on_drag(mlp)`.
- The mode's per-sample/synth output path checks `controller.static_output(buf)`: if true, emit `buf` (bypass), else run the MLP — exactly the `generateAction()` branch at `InterfaceRL.cpp:998`.
- The mode's training tick checks `controller.learning_paused()` and skips training when true (mirrors `optimiseSometimes()` early-return).
- The "Down Action" `RotarySelectView` calls `controller.set_mode(m, mlp)` (the old `addFeedbackModeView`).

All handlers run in thread/control context (never ISR), identical to the original which dispatched everything via deferred flags in `loopCallback`. No new locking is needed beyond the mode's existing `mlpActive` spin-lock around `get_weights`/`set_weights`/`draw_weights` — the same lock the old code held around `optimise()`/`generateAction()`.

---

## 7. File-touch summary (implementation-ready)

| File | Change |
|------|--------|
| `/home/w1n5t0n/src/MEMLNaut-NISPS/nisps/ml/feedback.hpp` | **NEW** — `FeedbackMode`, `FeedbackAction`, `FeedbackController<MLP_T>` (as in §2.2). |
| `/home/w1n5t0n/src/MEMLNaut-NISPS/nisps/wasm/bindings.cpp` | Add `FeedbackController<DefaultMLP>` + `static_out_scratch` to `MLHandle`; add 9 `nisps_ml_feedback_*` C functions (§4). |
| `/home/w1n5t0n/src/MEMLNaut-NISPS/playground/src/ml/types.ts` | Add 9 `_nisps_ml_feedback_*` to `NispsModule`; add `FeedbackMode`/`FeedbackAction` enums. |
| `/home/w1n5t0n/src/MEMLNaut-NISPS/playground/src/ml/wasm-iml.ts` | Thin wrapper methods + a small static-output heap buffer; reuse `pinMaskBuf`. |
| `/home/w1n5t0n/src/MEMLNaut-NISPS/playground/src/modes/mode-runtime.ts` | Route `thumbsDown` through the controller per active mode; gate training on `learning_paused()`. |
| `/home/w1n5t0n/src/MEMLNaut-NISPS/playground/src/stores/exploration-store.ts` | Add `feedbackMode` + `exploring` UI state (selector + indicator). |
| `/home/w1n5t0n/src/MEMLNaut-NISPS/tests/cpp/test_mlp_feedback.cpp` | **NEW** — 11 ctest cases (§5.1). |
| `/home/w1n5t0n/src/MEMLNaut-NISPS/nisps/CMakeLists.txt` | Add `test_mlp_feedback.cpp` to `nisps_core_tests`. |
| `/home/w1n5t0n/src/MEMLNaut-NISPS/tests/cpp/parity_check.cpp` + `parity_wasm.mjs` | Append feedback Stage 5; bump version to 2 (§5.2). |

### Key reconciliation decisions to record in `ALIGNMENT.md`
1. **AVOID** in the new core = `move_weights` Gaussian perturbation (the new playground's existing behavior), **not** the old k-NN geometric centroid push (which depended on firmware-only `ReplayMemory` and is out of scope). Accepted divergence.
2. RANDOMISE_OUTPUTS static vector uses the controller's **own** `nisps::Rng` (deterministic, per-instance) instead of libc `rand()` — endpoint/resolution differ trivially from `[0,65535]/65535` but the value is generated, not compared.
3. RANDOMISE_MLP randomisation uses `draw_weights(spread)` (spread-aware) instead of the old asymmetric `RandomiseWeightsAndBiasesLin(-0.9,1.1,-0.9,0.3)`. If the asymmetric distribution matters perceptually, that's a follow-up `draw_weights_range(lo,hi)` primitive — not part of this port.
