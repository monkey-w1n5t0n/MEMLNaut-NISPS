// nisps/ml/feedback.hpp — the "Down Action" negative-feedback controller.
//
// Ported from the firmware InterfaceRL FEEDBACK_MODE state machine (upstream
// branch feat/feedback-explore-modes) into the shared nisps/ core so the SAME
// logic compiles to both WASM (browser) and RP2350 firmware.
//
// Three selectable behaviours for the "down" (thumbs-down) gesture:
//   * Avoid            — delegate to MLP::move_weights (Gaussian perturb). This
//                        is the new core's "avoid"; the old firmware's k-NN
//                        geometric centroid push depended on a firmware-only
//                        ReplayMemory and is intentionally NOT ported (see
//                        ALIGNMENT.md). The controller owns no Avoid state.
//   * RandomiseOutputs — bypass the MLP and hold a static random output vector;
//                        each subsequent down re-rolls it (focus-aware). Up
//                        commits the held output as a +1 example at the current
//                        input, then resumes.
//   * RandomiseMlp     — snapshot the live weights and randomise the net
//                        (draw_weights) so the user auditions a random mapping
//                        by moving the joystick. Down again cancels (restore).
//                        Up/drag commits the auditioned output as a +1 example
//                        then restores the original net (the kept example then
//                        trains the original net toward the audition).
//
// Design: header-only class template over the concrete MLP type. The controller
// does NOT own the MLP — every mutating method takes `MLP_T&`. It owns only the
// exploration state, all fixed-size (no heap), with its OWN per-instance Rng so
// re-rolling outputs is deterministic and never perturbs the MLP's RNG stream.
// Honours the RP2350 perf contract: no heap, no virtual dispatch, deterministic
// per-instance RNG.
//
// The C++/JS boundary: the controller decides *what transition happened*
// (returns a FeedbackAction); the caller decides *what to persist* (add example,
// grow noise, train). All inherently-UI state (pins, pipeline outputs, display)
// stays in the caller.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>

#include "../core/rng.hpp"

namespace nisps::ml {

enum class FeedbackMode : std::uint8_t {
    Avoid            = 0,  // down → move_weights (Gaussian perturb). No internal state.
    RandomiseOutputs = 1,  // down → bypass MLP, hold static random vector; re-roll each down.
    RandomiseMlp     = 2,  // down → snapshot + draw_weights live net; down-again cancels.
    ExploreAndPlace  = 3,  // Idle→Exploring→Placing→Idle scratchpad lifecycle (default product mode).
};

// The explicit lifecycle state for FeedbackMode::ExploreAndPlace. The whole
// mode is a three-state machine; granular methods drive the transitions
// (firmware maps buttons to them directly), while on_down/on_up implement the
// SOFTWARE default policy (browser) on top of the same machine.
//   Idle      — the real (trained) net is live; no scratchpad.
//   Exploring — real net snapshotted aside; a random SCRATCHPAD net is live and
//               the user auditions it (reroll / nudge / undo). NEVER trained.
//   Placing   — the user liked the current scratchpad sound; its output vector
//               is FROZEN in placed_out_ and held while they choose WHERE to
//               place it. The caller drives inference at the chosen input but
//               the audition stays the frozen vector.
enum class ExploreState : std::uint8_t {
    Idle      = 0,
    Exploring = 1,
    Placing   = 2,
};

// What a press resolved to. The caller (JS runtime / firmware glue) performs the
// replay-memory / training side effect; the controller owns the in-core state
// machine and the weight snapshot/restore.
enum class FeedbackAction : std::uint8_t {
    None         = 0,
    AvoidPerturb = 1,  // move_weights already applied; caller grows exploration noise.
    LikeStore    = 2,  // caller: add +1 example at (input, output) + train.
    EnterExplore = 3,  // entered a RANDOMISE_* exploration (UI: show "exploring").
    Reroll       = 4,  // re-rolled within a RandomiseOutputs exploration.
    CommitStore  = 5,  // caller: add +1 example at (input, captured output); explore ended.
    Cancel       = 6,  // exploration discarded; net restored (RandomiseMlp).
    Restore      = 7,  // exploration kept via drag; net restored (caller already stored).
    // ---- ExploreAndPlace (append-only; never renumber the TS↔C++ contract) ----
    ScratchReroll = 8,   // scratchpad re-randomised (Exploring); pure audition, no store.
    ScratchNudge  = 9,   // scratchpad nudged (bounded perturb, Exploring); undoable.
    ScratchUndo   = 10,  // last reroll/nudge undone (Exploring).
    BeginPlace    = 11,  // Exploring→Placing; placed_out_ captured + frozen (no store yet).
    CommitPlace   = 12,  // Placing→Idle; real net restored. CALLER adds +1 (input→placed_output) + trains.
    CancelPlace   = 13,  // Placing→Exploring; backed out of placing (no store).
};

// UndoDepth = number of scratchpad ops (reroll/nudge) that can be undone in
// ExploreAndPlace. The undo ring is a fixed std::array of weight snapshots
// (no heap); each slot is kWeights floats. WASM uses depth 4, firmware 2 (per
// rl-feedback-design §2.2 — SRAM budget). Default 4 (the WASM depth).
template <typename MLP_T, std::size_t UndoDepth = 4u>
class FeedbackController {
   public:
    static constexpr std::size_t kNOut     = MLP_T::kOutput;
    static constexpr std::size_t kWeights  = MLP_T::weight_count();
    static constexpr std::size_t kUndoDepth = UndoDepth;

    explicit FeedbackController(std::uint64_t seed) noexcept : rng_(seed) {}

    // ---- mode ---------------------------------------------------------------
    // Switching mode mid-exploration cleanly tears down: restores the net (in
    // RandomiseMlp) and resumes learning, so we never strand a randomised net.
    void set_mode(FeedbackMode m, MLP_T& mlp) noexcept {
        if (explore_active_) abort_explore(mlp);
        if (ep_state_ != ExploreState::Idle) abort_explore_place(mlp);
        mode_ = m;
    }
    FeedbackMode mode() const noexcept { return mode_; }

    // `exploring()` is true whenever a scratchpad net is live and learning is
    // paused — for the legacy RANDOMISE_* modes, AND for ExploreAndPlace in
    // either Exploring or Placing (the real net stays snapshotted aside the
    // whole time). The TS/firmware UI uses it to show the "exploring" state.
    bool exploring() const noexcept {
        return explore_active_ || ep_state_ != ExploreState::Idle;
    }
    bool learning_paused() const noexcept { return learning_paused_; }

    // ---- ExploreAndPlace state introspection --------------------------------
    ExploreState explore_state() const noexcept { return ep_state_; }
    bool placing() const noexcept { return ep_state_ == ExploreState::Placing; }
    // True while a REPOSITION hold is active (grab→move→drop). Distinguishes a
    // reposition (real net never set aside) from an Explore→Place (scratchpad +
    // snapshot). Both sit in ExploreState::Placing and both hold placed_out_ via
    // static_output(); only commit/teardown differ (reposition does NOT restore
    // weights — there is nothing to restore).
    bool repositioning() const noexcept { return reposition_; }
    // Depth of the scratchpad undo ring currently available to pop (0..UndoDepth).
    std::size_t undo_depth() const noexcept { return undo_count_; }
    // The output vector frozen at like()/begin-place time. Valid only while
    // placing(); empty span otherwise. The caller adds this as the +1 example
    // label at commit (input → placed_output).
    std::span<const float> placed_output() const noexcept {
        if (ep_state_ != ExploreState::Placing) return {};
        return std::span<const float>(placed_out_.data(), kNOut);
    }

    // ---- focus mask: 1 byte per output; 0 == frozen (unfocused). Copied into a
    // fixed buffer (no heap, no dangling span). Empty ⇒ all outputs active.
    void set_focus_mask(std::span<const std::uint8_t> mask) noexcept {
        focus_count_ = (mask.size() < kNOut) ? mask.size() : kNOut;
        for (std::size_t i = 0; i < focus_count_; ++i) focus_[i] = mask[i];
    }
    void clear_focus_mask() noexcept { focus_count_ = 0; }

    // ---- press handlers -----------------------------------------------------
    // `current_out` is the live (post-pipeline) output the user is hearing
    // (kNOut floats). `pin_mask` may be empty. Returns the FeedbackAction the
    // caller must act on.
    FeedbackAction on_down(MLP_T& mlp, std::span<const float> current_out,
                           float speed, float spread,
                           std::span<const std::uint8_t> pin_mask) noexcept {
        switch (mode_) {
            case FeedbackMode::Avoid:
                mlp.move_weights(speed, spread, pin_mask);
                return FeedbackAction::AvoidPerturb;
            case FeedbackMode::RandomiseOutputs:
                if (!explore_active_) {
                    enter_randomise_outputs(current_out);
                    return FeedbackAction::EnterExplore;
                }
                roll_static_outputs();
                return FeedbackAction::Reroll;
            case FeedbackMode::RandomiseMlp:
                if (!explore_active_) {
                    enter_randomise_mlp(mlp, spread);
                    return FeedbackAction::EnterExplore;
                }
                cancel_explore(mlp);
                return FeedbackAction::Cancel;
            case FeedbackMode::ExploreAndPlace:
                // SOFTWARE DEFAULT POLICY (browser): down enters explore from
                // Idle, else re-rolls the scratchpad. (Firmware maps its own
                // buttons to the granular methods instead.)
                switch (ep_state_) {
                    case ExploreState::Idle:
                        enter_explore(mlp, spread);
                        return FeedbackAction::EnterExplore;
                    case ExploreState::Exploring:
                        reroll(mlp, spread);
                        return FeedbackAction::ScratchReroll;
                    case ExploreState::Placing:
                        // Down while placing backs out to Exploring.
                        cancel_place();
                        return FeedbackAction::CancelPlace;
                }
                return FeedbackAction::None;
        }
        return FeedbackAction::None;
    }

    // Up = thumbs-up / "keep". While exploring it commits: the CALLER must have
    // captured the heard output BEFORE calling this (on_up restores the original
    // net in RandomiseMlp), then stores it as a +1 example at the current input.
    FeedbackAction on_up(MLP_T& mlp) noexcept {
        if (mode_ == FeedbackMode::ExploreAndPlace) {
            // SOFTWARE DEFAULT POLICY (browser): up begins place from
            // Exploring (freeze the heard output), then commits from Placing
            // (restore the real net; caller stores +1 (input→placed_output)).
            switch (ep_state_) {
                case ExploreState::Idle:
                    return FeedbackAction::LikeStore;  // not exploring → plain like
                case ExploreState::Exploring:
                    begin_place(mlp);
                    return FeedbackAction::BeginPlace;
                case ExploreState::Placing:
                    commit_place(mlp);
                    return FeedbackAction::CommitPlace;
            }
            return FeedbackAction::None;
        }
        if (explore_active_ && (mode_ == FeedbackMode::RandomiseOutputs ||
                                mode_ == FeedbackMode::RandomiseMlp)) {
            restore_after_explore(mlp);
            return FeedbackAction::CommitStore;
        }
        return FeedbackAction::LikeStore;
    }

    // Drag-store (joystick freeze→reposition→release). In RandomiseMlp this is
    // the "reposition-commit": the caller has already stored the +1 at the new
    // input; we just restore the original net and end exploration.
    FeedbackAction on_drag(MLP_T& mlp) noexcept {
        if (explore_active_ && mode_ == FeedbackMode::RandomiseMlp) {
            restore_after_explore(mlp);
            return FeedbackAction::Restore;
        }
        return FeedbackAction::LikeStore;
    }

    // Inference hook: fills `out` with the held static vector and returns true
    // when RandomiseOutputs is bypassing the MLP; else returns false (the caller
    // should run mlp.process() normally). `out` should hold at least kNOut.
    bool static_output(std::span<float> out) const noexcept {
        // ExploreAndPlace: while PLACING, the audition is the frozen vector the
        // user liked, held steady as they aim at a location.
        if (mode_ == FeedbackMode::ExploreAndPlace && ep_state_ == ExploreState::Placing) {
            const std::size_t n = (out.size() < kNOut) ? out.size() : kNOut;
            for (std::size_t i = 0; i < n; ++i) out[i] = placed_out_[i];
            return true;
        }
        if (!(mode_ == FeedbackMode::RandomiseOutputs && explore_active_)) return false;
        const std::size_t n = (out.size() < kNOut) ? out.size() : kNOut;
        for (std::size_t i = 0; i < n; ++i) out[i] = static_out_[i];
        return true;
    }

    void seed(std::uint64_t s) noexcept { rng_.seed(s); }

    // =========================================================================
    // ExploreAndPlace — granular lifecycle methods (firmware maps buttons to
    // these directly; on_down/on_up call them for the browser default policy).
    //
    // CONTRACT: the controller owns the WEIGHT snapshot/restore and all scratch
    // state; the CALLER owns example-storage + training. On commit_place the
    // controller restores the real net and the caller does add_example(current
    // input → placed_output()) + train (warm-start to interpolate all anchors).
    // =========================================================================

    // Idle→Exploring. Snapshot the real (trained) net aside, randomise a
    // scratchpad net the user auditions. No-op if not Idle.
    void enter_explore(MLP_T& mlp, float spread) noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ != ExploreState::Idle) return;
        auto w = mlp.get_weights();  // flat snapshot (size == kWeights)
        for (std::size_t i = 0; i < kWeights; ++i) snapshot_[i] = w[i];
        learning_paused_ = true;
        ep_state_        = ExploreState::Exploring;
        undo_count_      = 0u;
        undo_head_       = 0u;
        mlp.draw_weights(spread);  // first scratchpad candidate
    }

    // Exploring→Idle. Restore the real net, discard the scratchpad. No example
    // stored. (The hardware "enter/exit explore toggle" off-path.)
    void exit_explore(MLP_T& mlp) noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ == ExploreState::Idle) return;
        restore_real_net(mlp);
    }

    // Exploring scratchpad op: re-randomise the scratchpad. Undoable.
    void reroll(MLP_T& mlp, float spread) noexcept {
        if (!can_scratch_op()) return;
        push_undo(mlp);
        mlp.draw_weights(spread);
    }

    // Exploring scratchpad op: small bounded perturbation of the scratchpad via
    // move_weights on the controller's OWN Rng-free path — move_weights uses the
    // MLP's Rng, so to keep the controller's Rng stream out of the MLP stream we
    // draw the perturbation here and apply it. Undoable. `amount` is the noise
    // stddev (small, e.g. 0.05).
    void nudge(MLP_T& mlp, float amount) noexcept {
        if (!can_scratch_op()) return;
        push_undo(mlp);
        auto w = mlp.get_weights();
        for (std::size_t i = 0; i < kWeights; ++i) {
            scratch_buf_[i] = w[i] + rng_.next_float_gaussian(amount);
        }
        mlp.set_weights(std::span<const float>(scratch_buf_.data(), kWeights));
    }

    // Exploring scratchpad op: undo the last reroll/nudge (bounded ring).
    void undo(MLP_T& mlp) noexcept {
        if (!can_scratch_op()) return;
        if (undo_count_ == 0u) return;
        undo_head_  = (undo_head_ + kUndoDepth - 1u) % kUndoDepth;
        --undo_count_;
        mlp.set_weights(std::span<const float>(undo_ring_[undo_head_].data(), kWeights));
    }

    // Exploring→Placing. Capture + FREEZE the current scratchpad output the user
    // is auditioning. The caller MUST have run mlp.process() at the audition
    // input first; pass that output here. While placing, static_output() holds
    // this vector and the caller chooses WHERE to place it.
    void begin_place(MLP_T& mlp, std::span<const float> current_out) noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ != ExploreState::Exploring) return;
        const std::size_t n = (current_out.size() < kNOut) ? current_out.size() : kNOut;
        for (std::size_t i = 0; i < n; ++i) placed_out_[i] = current_out[i];
        ep_state_ = ExploreState::Placing;
    }

    // Convenience: freeze the scratchpad's output at its CURRENT input (runs the
    // forward pass on the live scratchpad net). Equivalent to process()+capture.
    void begin_place(MLP_T& mlp) noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ != ExploreState::Exploring) return;
        mlp.process();
        const auto outs = mlp.outputs();
        const std::size_t n = (outs.size() < kNOut) ? outs.size() : kNOut;
        for (std::size_t i = 0; i < n; ++i) placed_out_[i] = outs[i];
        ep_state_ = ExploreState::Placing;
    }

    // Placing→Idle. Restore the real net. The CALLER then adds a +1 example at
    // (chosen input → placed_output()) and trains. Returns the placed output so
    // the caller can read it after the restore (it survives the restore).
    void commit_place(MLP_T& mlp) noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ != ExploreState::Placing) return;
        // Restore the real net but KEEP placed_out_ valid for the caller until
        // it transitions to Idle; expose via a separate accessor that does not
        // gate on Placing.
        mlp.set_weights(std::span<const float>(snapshot_.data(), kWeights));
        last_placed_valid_ = true;  // placed_out_ holds the just-committed vector
        learning_paused_   = false;
        ep_state_          = ExploreState::Idle;
        undo_count_        = 0u;
    }

    // The output vector committed by the most recent commit_place, valid until
    // the next enter_explore/begin_place. Lets the caller add the +1 example
    // AFTER commit_place has restored the real net.
    std::span<const float> committed_output() const noexcept {
        if (!last_placed_valid_) return {};
        return std::span<const float>(placed_out_.data(), kNOut);
    }

    // Placing→Exploring. Back out of placing without storing; resume auditioning
    // the scratchpad (which is still live — begin_place did not touch weights).
    // A reposition hold has no scratchpad to return to, so it backs out to Idle.
    void cancel_place() noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ != ExploreState::Placing) return;
        if (reposition_) {
            reposition_      = false;
            learning_paused_ = false;
            ep_state_        = ExploreState::Idle;
            return;
        }
        ep_state_ = ExploreState::Exploring;
    }

    // =========================================================================
    // Reposition (grab → move → drop) — relocate an EXISTING positive example's
    // output to a new input position. Distinct from Explore→Place: there is NO
    // scratchpad and NO weight snapshot — the real (trained) net stays live the
    // whole time. We only FREEZE the currently-heard output and hold it (via
    // static_output) while the user moves to a new input, then the caller adds
    // a +1 example (new input → carried output) and trains. This is the new
    // core's home for the upstream "drag-store / reposition-commit" gesture.
    // =========================================================================

    // Idle→Placing(reposition). Freeze `current_out` — the output the user is
    // hearing from the TRAINED net — and hold it. No-op unless Idle.
    void begin_reposition(std::span<const float> current_out) noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ != ExploreState::Idle) return;
        const std::size_t n = (current_out.size() < kNOut) ? current_out.size() : kNOut;
        for (std::size_t i = 0; i < n; ++i) placed_out_[i] = current_out[i];
        reposition_        = true;
        learning_paused_   = true;
        last_placed_valid_ = false;
        ep_state_          = ExploreState::Placing;
    }

    // Convenience: capture the trained net's output at its CURRENT input
    // (process + capture). Equivalent to begin_reposition(mlp.outputs()).
    void begin_reposition(MLP_T& mlp) noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ != ExploreState::Idle) return;
        mlp.process();
        const auto outs = mlp.outputs();
        const std::size_t n = (outs.size() < kNOut) ? outs.size() : kNOut;
        for (std::size_t i = 0; i < n; ++i) placed_out_[i] = outs[i];
        reposition_        = true;
        learning_paused_   = true;
        last_placed_valid_ = false;
        ep_state_          = ExploreState::Placing;
    }

    // Placing(reposition)→Idle. NO weight restore (the net was never set aside).
    // committed_output() then holds the carried vector so the caller can add the
    // +1 example at the new input and train. No-op unless repositioning.
    void commit_reposition() noexcept {
        if (!reposition_ || ep_state_ != ExploreState::Placing) return;
        reposition_        = false;
        last_placed_valid_ = true;   // committed_output() valid for the caller
        learning_paused_   = false;
        ep_state_          = ExploreState::Idle;
        undo_count_        = 0u;
    }

   private:
    void enter_randomise_outputs(std::span<const float> seed_out) noexcept {
        explore_active_  = true;
        learning_paused_ = true;
        // Seed every dim with the live output the user is hearing, so unfocused
        // (frozen) dims hold that value through the exploration — matching the
        // firmware `staticRandomOut_ = action; _roll_static_outputs();`. The
        // CALLER CONTRACT is to pass the full kNOut live output. Any dims beyond
        // a short seed keep their previous static value (we have no live value
        // to freeze them to); they are only observable if a focus mask freezes
        // a dim the short seed did not cover — an out-of-contract corner.
        const std::size_t n = (seed_out.size() < kNOut) ? seed_out.size() : kNOut;
        for (std::size_t i = 0; i < n; ++i) static_out_[i] = seed_out[i];
        roll_static_outputs();
    }

    void roll_static_outputs() noexcept {
        for (std::size_t i = 0; i < kNOut; ++i) {
            const bool active = (focus_count_ == 0u) || (i < focus_count_ && focus_[i] != 0u);
            if (active) static_out_[i] = rng_.next_float_uniform();  // [0, 1)
            // inactive dims keep their seeded entry value
        }
    }

    void enter_randomise_mlp(MLP_T& mlp, float spread) noexcept {
        explore_active_  = true;
        learning_paused_ = true;
        auto w = mlp.get_weights();  // flat snapshot (size == kWeights)
        for (std::size_t i = 0; i < kWeights; ++i) snapshot_[i] = w[i];
        mlp.draw_weights(spread);    // randomise the live net
    }

    void restore_after_explore(MLP_T& mlp) noexcept {
        if (mode_ == FeedbackMode::RandomiseMlp) {
            mlp.set_weights(std::span<const float>(snapshot_.data(), kWeights));
        }
        learning_paused_ = false;
        explore_active_  = false;
    }

    // Cancel and abort share restore semantics; the caller stores nothing.
    void cancel_explore(MLP_T& mlp) noexcept { restore_after_explore(mlp); }
    void abort_explore(MLP_T& mlp)  noexcept { restore_after_explore(mlp); }

    // ---- ExploreAndPlace helpers --------------------------------------------
    bool can_scratch_op() const noexcept {
        return mode_ == FeedbackMode::ExploreAndPlace &&
               ep_state_ == ExploreState::Exploring;
    }

    // Push the CURRENT scratchpad weights onto the bounded undo ring before a
    // mutating op, so undo() restores the pre-op candidate.
    void push_undo(MLP_T& mlp) noexcept {
        auto w = mlp.get_weights();
        for (std::size_t i = 0; i < kWeights; ++i) undo_ring_[undo_head_][i] = w[i];
        undo_head_ = (undo_head_ + 1u) % kUndoDepth;
        if (undo_count_ < kUndoDepth) ++undo_count_;
    }

    // Restore the set-aside real net and return to Idle. Shared by exit_explore
    // and abort_explore_place. No example stored.
    void restore_real_net(MLP_T& mlp) noexcept {
        mlp.set_weights(std::span<const float>(snapshot_.data(), kWeights));
        learning_paused_   = false;
        ep_state_          = ExploreState::Idle;
        undo_count_        = 0u;
        last_placed_valid_ = false;
    }

    void abort_explore_place(MLP_T& mlp) noexcept {
        if (ep_state_ == ExploreState::Idle) return;
        if (reposition_) {
            // A reposition never set the real net aside, so there is nothing to
            // restore — clearing snapshot_ into the net here would CLOBBER the
            // live trained weights. Just drop the hold.
            reposition_        = false;
            learning_paused_   = false;
            ep_state_          = ExploreState::Idle;
            undo_count_        = 0u;
            last_placed_valid_ = false;
            return;
        }
        restore_real_net(mlp);
    }

    FeedbackMode mode_            = FeedbackMode::Avoid;
    bool         explore_active_  = false;
    bool         learning_paused_ = false;
    std::array<float, kNOut>        static_out_{};
    std::array<float, kWeights>     snapshot_{};
    std::array<std::uint8_t, kNOut> focus_{};
    std::size_t                     focus_count_ = 0;  // 0 ⇒ all active

    // ---- ExploreAndPlace state (all fixed-size, no heap) --------------------
    ExploreState                                    ep_state_ = ExploreState::Idle;
    std::array<float, kNOut>                        placed_out_{};       // frozen audition/carried vector
    bool                                            last_placed_valid_ = false;
    bool                                            reposition_ = false; // grab→move→drop hold; net NOT set aside
    std::array<std::array<float, kWeights>, kUndoDepth> undo_ring_{};    // bounded undo
    std::size_t                                     undo_head_  = 0u;    // next write slot
    std::size_t                                     undo_count_ = 0u;    // valid entries (0..kUndoDepth)
    std::array<float, kWeights>                     scratch_buf_{};      // nudge scratch (no heap)

    Rng                             rng_;
};

}  // namespace nisps::ml
