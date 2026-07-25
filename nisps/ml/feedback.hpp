// nisps/ml/feedback.hpp — the "Down Action" negative-feedback controller.
//
// Ported from the firmware InterfaceRL FEEDBACK_MODE state machine (upstream
// branch feat/feedback-explore-modes) into the shared nisps/ core so the SAME
// logic compiles to both WASM (browser) and RP2350 firmware.
//
// Four FeedbackMode behaviours for the "down" (thumbs-down) gesture:
//   * ExploreAndPlace  — the DEFAULT product mode (docs/adr/rl-feedback-design.md).
//                        Idle→Exploring→Placing→Idle scratchpad lifecycle: down
//                        snapshots the real net aside and auditions a random
//                        scratchpad; up freezes the heard output and lets the
//                        user place it at a new input before committing (+1
//                        example, real net restored, trained toward the
//                        placement). See ExploreState below for the full
//                        granular API (firmware maps buttons directly to it).
//   * Avoid            — "down" trains AWAY from the heard action, via one of
//                        two AvoidStyle sub-modes:
//                          - Geometric (DEFAULT) — the ported firmware k-NN
//                            centroid push-away, backed by the controller's
//                            own ReplayMemory (see dislike_geometric() below).
//                            Replays all live negatives for a parameterised
//                            wall-clock window; cold start uses a deterministic
//                            random direction until a positive is stored.
//                          - Diffuse — the pre-P3 undirected MLP::move_weights
//                            perturb. Deliberately-retained research reserve,
//                            not the product default (see its definition below
//                            and docs/adr/rl-feedback-design.md).
//   * RandomiseOutputs — deliberately-retained research reserve (see its
//                        definition below): bypasses the MLP and holds a
//                        static random output vector; each subsequent down
//                        re-rolls it (focus-aware). Up commits the held output
//                        as a +1 example at the current input, then resumes.
//   * RandomiseMlp     — deliberately-retained research reserve (see its
//                        definition below): snapshots the live weights and
//                        randomises the net (draw_weights) so the user
//                        auditions a random mapping by moving the joystick.
//                        Down again cancels (restore). Up/drag commits the
//                        auditioned output as a +1 example then restores the
//                        original net (the kept example then trains the
//                        original net toward the audition).
//
// STORAGE POLICY (one-core-engine-refactor P2): like MLPCore, the controller
// algorithms are written once in `FeedbackControllerCore<FbStorage>` against a
// storage surface. Two models:
//   * `FixedFeedbackStorage<NOut, NWeights, UndoDepth>` — std::array, zero
//     heap. The classic `FeedbackController<MLP_T, UndoDepth>` alias derives
//     the sizes from the fixed MLP type; firmware + tests compile unchanged.
//   * `DynamicFeedbackStorage` (nisps/ml/dynamic_storage.hpp) — sizes at
//     construction for the runtime-shaped browser MLP. Non-embedded only.
//
// Design: the controller does NOT own the MLP — every mutating method takes
// the MLP by reference (method-level template, so fixed and dynamic MLPs both
// work). It owns only the exploration state, with its OWN per-instance Rng so
// re-rolling outputs is deterministic and never perturbs the MLP's RNG stream.
// Honours the RP2350 perf contract in the fixed model: no heap, no virtual
// dispatch, deterministic per-instance RNG.
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

#include "../core/perf.hpp"
#include "../core/rng.hpp"
#include "geo_push.hpp"
#include "replay.hpp"

namespace nisps::ml {

enum class FeedbackMode : std::uint8_t {
    Avoid            = 0,  // down → geometric push-away (or legacy Diffuse — see AvoidStyle).
    // NOTE (2026-07, S20): RandomiseOutputs and RandomiseMlp have no current
    // product caller — firmware/browser both default to ExploreAndPlace.
    // They are DELIBERATELY RETAINED as research reserve: building blocks for
    // experimenting with how different instruments feel under different
    // down-gesture behaviours, not dead code awaiting deletion. Do not re-flag.
    RandomiseOutputs = 1,  // down → bypass MLP, hold static random vector; re-roll each down.
    RandomiseMlp     = 2,  // down → snapshot + draw_weights live net; down-again cancels.
    ExploreAndPlace  = 3,  // Idle→Exploring→Placing→Idle scratchpad lifecycle (default product mode).
};

// How the Avoid mode realises a dislike (rl-feedback-design §2.1). Geometric
// (DEFAULT) is the ported firmware behaviour (replay-backed k-NN centroid
// push-away).
//
// NOTE (2026-07, S20): Diffuse (the pre-P3 undirected move_weights) has no
// current product caller. It is DELIBERATELY RETAINED as research reserve —
// a building block for experimenting with how different instruments feel
// under different down-gesture behaviours, not dead code awaiting deletion.
// Do not re-flag.
enum class AvoidStyle : std::uint8_t {
    Geometric = 0,
    Diffuse   = 1,
};

// The explicit lifecycle state for FeedbackMode::ExploreAndPlace. The whole
// mode is a three-state machine; granular methods drive the transitions
// (firmware maps buttons to them directly), while on_down/on_up implement the
// SOFTWARE default policy (browser) on top of the same machine.
//   Idle      — the real (trained) net is live; no scratchpad.
//   Exploring — real net snapshotted aside; a random SCRATCHPAD net is live and
//               the user auditions it (reroll / nudge / undo). NEVER trained.
//   Placing   — the user liked the current scratchpad sound; its output vector
//               is FROZEN in placed_out and held while they choose WHERE to
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
    BeginPlace    = 11,  // Exploring→Placing; placed_out captured + frozen (no store yet).
    CommitPlace   = 12,  // Placing→Idle; real net restored. CALLER adds +1 (input→placed_output) + trains.
    CancelPlace   = 13,  // Placing→Exploring; backed out of placing (no store).
    // ---- Geometric dislike (append-only) ----
    GeometricPush      = 14,  // dislike trained toward the computed push-away target.
    GeometricColdStart = 15,  // no positives yet: random-direction push ran; UI shows the cold-start prompt.
};

// ---------------------------------------------------------------------------
// Fixed feedback storage — std::array, zero heap. Sizes are compile-time.
// UndoDepth = number of scratchpad ops (reroll/nudge) that can be undone in
// ExploreAndPlace; each undo slot is NWeights floats. WASM historically used
// depth 4, firmware 2 (per rl-feedback-design §2.2 — SRAM budget).
// ---------------------------------------------------------------------------
template <std::size_t NOut, std::size_t NWeights, std::size_t UndoDepth = 4u,
          std::size_t NIn = 2u, std::size_t ReplayCap = 32u>
class FixedFeedbackStorage {
   public:
    static constexpr std::size_t kNOut      = NOut;
    static constexpr std::size_t kWeights   = NWeights;
    static constexpr std::size_t kUndoDepth = UndoDepth;
    static constexpr std::size_t kNIn       = NIn;
    static constexpr std::size_t kReplayCap = ReplayCap;

    static constexpr std::size_t n_out()      noexcept { return NOut; }
    static constexpr std::size_t n_weights()  noexcept { return NWeights; }
    static constexpr std::size_t undo_cap()   noexcept { return UndoDepth; }
    static constexpr std::size_t n_in()       noexcept { return NIn; }
    static constexpr std::size_t replay_cap() noexcept { return ReplayCap; }

    NISPS_FORCE_INLINE std::span<float>        static_out()       noexcept { return static_out_; }
    NISPS_FORCE_INLINE std::span<const float>  static_out() const noexcept { return static_out_; }
    NISPS_FORCE_INLINE std::span<float>        snapshot()         noexcept { return snapshot_; }
    NISPS_FORCE_INLINE std::span<const float>  snapshot()   const noexcept { return snapshot_; }
    NISPS_FORCE_INLINE std::span<std::uint8_t> focus()            noexcept { return focus_; }
    NISPS_FORCE_INLINE std::span<const std::uint8_t> focus() const noexcept { return focus_; }
    NISPS_FORCE_INLINE std::span<float>        placed_out()       noexcept { return placed_out_; }
    NISPS_FORCE_INLINE std::span<const float>  placed_out() const noexcept { return placed_out_; }
    NISPS_FORCE_INLINE std::span<float>        scratch_buf()      noexcept { return scratch_buf_; }
    NISPS_FORCE_INLINE std::span<float> undo_slot(std::size_t i)  noexcept { return undo_ring_[i]; }
    NISPS_FORCE_INLINE std::span<const float> undo_slot(std::size_t i) const noexcept {
        return undo_ring_[i];
    }
    // Replay memory buffers (geometric dislike — nisps/ml/replay.hpp).
    NISPS_FORCE_INLINE std::span<float> replay_inputs()  noexcept { return replay_in_; }
    NISPS_FORCE_INLINE std::span<float> replay_actions() noexcept { return replay_act_; }
    NISPS_FORCE_INLINE std::span<float> replay_rewards() noexcept { return replay_rew_; }
    NISPS_FORCE_INLINE std::span<float> replay_ages_ms() noexcept { return replay_age_ms_; }
    // Centroid + push-target scratch (n_out each).
    NISPS_FORCE_INLINE std::span<float> centroid_buf() noexcept { return centroid_; }
    NISPS_FORCE_INLINE std::span<float> target_buf()   noexcept { return target_; }

   private:
    std::array<float, NOut>         static_out_{};
    std::array<float, NWeights>     snapshot_{};
    std::array<std::uint8_t, NOut>  focus_{};
    std::array<float, NOut>         placed_out_{};
    std::array<std::array<float, NWeights>, UndoDepth> undo_ring_{};
    std::array<float, NWeights>     scratch_buf_{};
    std::array<float, ReplayCap * NIn>  replay_in_{};
    std::array<float, ReplayCap * NOut> replay_act_{};
    std::array<float, ReplayCap>        replay_rew_{};
    std::array<float, ReplayCap>        replay_age_ms_{};
    std::array<float, NOut>             centroid_{};
    std::array<float, NOut>             target_{};
};

// ---------------------------------------------------------------------------
// The controller algorithms, written once against the feedback storage
// surface: n_out(), n_weights(), undo_cap(), static_out(), snapshot(),
// focus(), placed_out(), scratch_buf(), undo_slot(i).
// ---------------------------------------------------------------------------
template <typename FbStorage>
class FeedbackControllerCore : public FbStorage {
   public:
    template <typename... StorageArgs>
    explicit FeedbackControllerCore(std::uint64_t seed, StorageArgs&&... storage_args) noexcept
        : FbStorage(static_cast<StorageArgs&&>(storage_args)...), rng_(seed) {}

    // ---- mode ---------------------------------------------------------------
    // Switching mode mid-exploration cleanly tears down: restores the net (in
    // RandomiseMlp) and resumes learning, so we never strand a randomised net.
    template <typename M>
    void set_mode(FeedbackMode m, M& mlp) noexcept {
        if (explore_active_) abort_explore(mlp);
        if (ep_state_ != ExploreState::Idle) abort_explore_place(mlp);
        mode_ = m;
    }
    FeedbackMode mode() const noexcept { return mode_; }

    // Avoid sub-mode: Geometric (default, the ported firmware behaviour) or
    // Diffuse (legacy undirected move_weights — kept for A/B comparison).
    void set_avoid_style(AvoidStyle s) noexcept { avoid_style_ = s; }
    AvoidStyle avoid_style() const noexcept { return avoid_style_; }

    // Base learning rate for the geometric push training (upstream
    // InterfaceRL default 1e-3, pre-scaling).
    void set_geo_lr(float lr) noexcept { geo_lr_ = lr; }
    float geo_lr() const noexcept { return geo_lr_; }
    void set_geo_update_hz(float hz) noexcept {
        geo_update_hz_ = (hz > 0.f) ? hz : 0.f;
        geo_step_accum_ = 0.f;
        if (!(geo_update_hz_ > 0.f)) replay_().remove_all_negatives();
    }
    float geo_update_hz() const noexcept { return geo_update_hz_; }
    void set_geo_lifetime_ms(float ms) noexcept {
        geo_lifetime_ms_ = (ms > 0.f) ? ms : 0.f;
        if (!(geo_lifetime_ms_ > 0.f)) replay_().remove_all_negatives();
    }
    float geo_lifetime_ms() const noexcept { return geo_lifetime_ms_; }

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
    // snapshot). Both sit in ExploreState::Placing and both hold placed_out via
    // static_output(); only commit/teardown differ (reposition does NOT restore
    // weights — there is nothing to restore).
    bool repositioning() const noexcept { return reposition_; }
    // Depth of the scratchpad undo ring currently available to pop (0..undo_cap).
    std::size_t undo_depth() const noexcept { return undo_count_; }
    // The output vector frozen at like()/begin-place time. Valid only while
    // placing(); empty span otherwise. The caller adds this as the +1 example
    // label at commit (input → placed_output).
    std::span<const float> placed_output() const noexcept {
        if (ep_state_ != ExploreState::Placing) return {};
        return this->placed_out();
    }

    // ---- focus mask: 1 byte per output; 0 == frozen (unfocused). Copied into a
    // fixed buffer (no heap, no dangling span). Empty ⇒ all outputs active.
    void set_focus_mask(std::span<const std::uint8_t> mask) noexcept {
        auto focus = this->focus();
        focus_count_ = (mask.size() < focus.size()) ? mask.size() : focus.size();
        for (std::size_t i = 0; i < focus_count_; ++i) focus[i] = mask[i];
    }
    void clear_focus_mask() noexcept { focus_count_ = 0; }

    // ---- press handlers -----------------------------------------------------
    // `current_out` is the live (post-pipeline) output the user is hearing
    // (n_out floats). `pin_mask` may be empty. Returns the FeedbackAction the
    // caller must act on.
    template <typename M>
    FeedbackAction on_down(M& mlp, std::span<const float> current_out,
                           float speed, float spread,
                           std::span<const std::uint8_t> pin_mask) noexcept {
        switch (mode_) {
            case FeedbackMode::Avoid:
                if (avoid_style_ == AvoidStyle::Diffuse) {
                    mlp.move_weights(speed, spread, pin_mask);
                    return FeedbackAction::AvoidPerturb;
                }
                return dislike_geometric(mlp, current_out, geo_lr_);
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
    template <typename M>
    FeedbackAction on_up(M& mlp) noexcept {
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
        if (mode_ == FeedbackMode::Avoid && avoid_style_ == AvoidStyle::Geometric) {
            // A geometric-mode like also feeds the positive centroid (ADR
            // §2.1); the caller still runs addExample + train as usual.
            store_positive(mlp);
        }
        return FeedbackAction::LikeStore;
    }

    // Drag-store (joystick freeze→reposition→release). In RandomiseMlp this is
    // the "reposition-commit": the caller has already stored the +1 at the new
    // input; we just restore the original net and end exploration.
    //
    // NOTE (2026-07, S20): the RandomiseMlp branch below has no current
    // product caller (ExploreAndPlace's own reposition path is
    // begin_reposition/commit_reposition, not on_drag). DELIBERATELY RETAINED
    // as research reserve alongside RandomiseMlp itself — not dead code
    // awaiting deletion. Do not re-flag.
    template <typename M>
    FeedbackAction on_drag(M& mlp) noexcept {
        if (explore_active_ && mode_ == FeedbackMode::RandomiseMlp) {
            restore_after_explore(mlp);
            return FeedbackAction::Restore;
        }
        return FeedbackAction::LikeStore;
    }

    // Inference hook: fills `out` with the held static vector and returns true
    // when RandomiseOutputs is bypassing the MLP; else returns false (the caller
    // should run mlp.process() normally). `out` should hold at least n_out.
    bool static_output(std::span<float> out) const noexcept {
        const std::size_t n_out = this->n_out();
        // ExploreAndPlace: while PLACING, the audition is the frozen vector the
        // user liked, held steady as they aim at a location.
        if (mode_ == FeedbackMode::ExploreAndPlace && ep_state_ == ExploreState::Placing) {
            const auto placed = this->placed_out();
            const std::size_t n = (out.size() < n_out) ? out.size() : n_out;
            for (std::size_t i = 0; i < n; ++i) out[i] = placed[i];
            return true;
        }
        if (!(mode_ == FeedbackMode::RandomiseOutputs && explore_active_)) return false;
        const auto held = this->static_out();
        const std::size_t n = (out.size() < n_out) ? out.size() : n_out;
        for (std::size_t i = 0; i < n; ++i) out[i] = held[i];
        return true;
    }

    void seed(std::uint64_t s) noexcept { rng_.seed(s); }

    // =========================================================================
    // Geometric dislike (rl-feedback-design §2.1): press stores the rejection
    // and performs one immediate update; advance_geometric() supplies the
    // repeated, wall-clock-bounded optimise dose used by current upstream.
    // =========================================================================

    std::size_t replay_size() const noexcept { return replay_count_; }
    std::size_t positive_count() noexcept { return replay_().positive_count(); }
    std::size_t negative_count() noexcept { return replay_().negative_count(); }

    // Store a positive (like) into the replay so the k-NN centroid sees it.
    // `current_out` may be empty ⇒ the MLP's live output vector is used. The
    // input is the MLP's current input vector.
    template <typename M>
    void store_positive(M& mlp, std::span<const float> current_out = {}) noexcept {
        std::span<const float> a = current_out.empty()
            ? std::span<const float>(mlp.outputs())
            : current_out;
        replay_().store(1.f, std::span<const float>(mlp.input_buf()), a);
    }

    // Thumbs-down at the MLP's CURRENT input with heard action `current_out`
    // (empty ⇒ the MLP's live outputs). Runs the full upstream sequence:
    //   1. deepen-or-store the negative (dedup radius 0.05).
    //   2. immediately optimise all live negatives once. Subsequent updates
    //      come from advance_geometric().
    template <typename M>
    FeedbackAction dislike_geometric(M& mlp, std::span<const float> current_out,
                                     float lr) noexcept {
        auto replay = replay_();
        std::span<const float> a_neg = current_out.empty()
            ? std::span<const float>(mlp.outputs())
            : current_out;
        std::span<const float> x_neg(mlp.input_buf());

        // 1. store/deepen the negative (InterfaceRL.cpp:42-66).
        replay.deepen_or_store_negative(x_neg, a_neg);

        const bool have_positives = replay.positive_count() > 0u;
        (void)optimise_geometric_once_(mlp, lr);
        if (!(geo_update_hz_ > 0.f) || !(geo_lifetime_ms_ > 0.f)) {
            replay.remove_all_negatives();
        }
        return have_positives
            ? FeedbackAction::GeometricPush
            : FeedbackAction::GeometricColdStart;
    }

    // Advance the upstream-style replay optimiser by elapsed wall-clock time.
    // Returns the number of optimisation cycles applied. A long scheduler gap
    // does not create an unbounded catch-up burst: upstream also cannot execute
    // missed loop iterations while blocked. Ages still advance by the full dt.
    template <typename M>
    std::size_t advance_geometric(M& mlp, float dt_seconds) noexcept {
        if (mode_ != FeedbackMode::Avoid || avoid_style_ != AvoidStyle::Geometric ||
            !(dt_seconds > 0.f)) {
            return 0u;
        }
        auto replay = replay_();
        if (replay.negative_count() == 0u) {
            geo_step_accum_ = 0.f;
            return 0u;
        }

        constexpr float kMaxDoseDtSeconds = 0.1f;
        const float dose_dt = (dt_seconds < kMaxDoseDtSeconds)
            ? dt_seconds
            : kMaxDoseDtSeconds;
        geo_step_accum_ += dose_dt * geo_update_hz_;
        std::size_t steps = static_cast<std::size_t>(geo_step_accum_);
        geo_step_accum_ -= static_cast<float>(steps);

        for (std::size_t i = 0; i < steps; ++i) {
            if (!optimise_geometric_once_(mlp, geo_lr_)) break;
        }
        replay.advance_negative_ages(dt_seconds * 1000.f, geo_lifetime_ms_);
        if (replay.negative_count() == 0u) geo_step_accum_ = 0.f;
        return steps;
    }

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
    template <typename M>
    void enter_explore(M& mlp, float spread) noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ != ExploreState::Idle) return;
        take_snapshot(mlp);
        learning_paused_ = true;
        ep_state_        = ExploreState::Exploring;
        undo_count_      = 0u;
        undo_head_       = 0u;
        mlp.draw_weights(spread);  // first scratchpad candidate
    }

    // Exploring→Idle. Restore the real net, discard the scratchpad. No example
    // stored. (The hardware "enter/exit explore toggle" off-path.)
    template <typename M>
    void exit_explore(M& mlp) noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ == ExploreState::Idle) return;
        restore_real_net(mlp);
    }

    // Exploring scratchpad op: re-randomise the scratchpad. Undoable.
    template <typename M>
    void reroll(M& mlp, float spread) noexcept {
        if (!can_scratch_op()) return;
        push_undo(mlp);
        mlp.draw_weights(spread);
    }

    // Exploring scratchpad op: small bounded perturbation of the scratchpad via
    // the controller's OWN Rng (move_weights uses the MLP's Rng; to keep the
    // controller's Rng stream out of the MLP stream we draw the perturbation
    // here and apply it). Undoable. `amount` is the noise stddev (e.g. 0.05).
    template <typename M>
    void nudge(M& mlp, float amount) noexcept {
        if (!can_scratch_op()) return;
        push_undo(mlp);
        auto scratch = this->scratch_buf();
        const std::size_t n_weights = this->n_weights();
        mlp.copy_weights_to(scratch);  // single copy — see take_snapshot.
        for (std::size_t i = 0; i < n_weights; ++i) {
            scratch[i] += rng_.next_float_gaussian(amount);
        }
        mlp.set_weights(std::span<const float>(scratch.data(), n_weights));
    }

    // Exploring scratchpad op: undo the last reroll/nudge (bounded ring).
    template <typename M>
    void undo(M& mlp) noexcept {
        if (!can_scratch_op()) return;
        if (undo_count_ == 0u) return;
        const std::size_t cap = this->undo_cap();
        undo_head_  = (undo_head_ + cap - 1u) % cap;
        --undo_count_;
        const auto slot = this->undo_slot(undo_head_);
        mlp.set_weights(std::span<const float>(slot.data(), this->n_weights()));
    }

    // Exploring→Placing. Capture + FREEZE the current scratchpad output the user
    // is auditioning. The caller MUST have run mlp.process() at the audition
    // input first; pass that output here. While placing, static_output() holds
    // this vector and the caller chooses WHERE to place it.
    template <typename M>
    void begin_place(M& mlp, std::span<const float> current_out) noexcept {
        (void)mlp;
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ != ExploreState::Exploring) return;
        capture_placed(current_out);
        ep_state_ = ExploreState::Placing;
    }

    // Convenience: freeze the scratchpad's output at its CURRENT input (runs the
    // forward pass on the live scratchpad net). Equivalent to process()+capture.
    template <typename M>
    void begin_place(M& mlp) noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ != ExploreState::Exploring) return;
        mlp.process();
        capture_placed(mlp.outputs());
        ep_state_ = ExploreState::Placing;
    }

    // Placing→Idle. Restore the real net. The CALLER then adds a +1 example at
    // (chosen input → placed_output()) and trains.
    template <typename M>
    void commit_place(M& mlp) noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ != ExploreState::Placing) return;
        // Restore the real net but KEEP placed_out valid for the caller until
        // it transitions to Idle; expose via a separate accessor that does not
        // gate on Placing.
        restore_snapshot(mlp);
        last_placed_valid_ = true;  // placed_out holds the just-committed vector
        learning_paused_   = false;
        ep_state_          = ExploreState::Idle;
        undo_count_        = 0u;
    }

    // The output vector committed by the most recent commit_place, valid until
    // the next enter_explore/begin_place. Lets the caller add the +1 example
    // AFTER commit_place has restored the real net.
    std::span<const float> committed_output() const noexcept {
        if (!last_placed_valid_) return {};
        return this->placed_out();
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
        capture_placed(current_out);
        reposition_        = true;
        learning_paused_   = true;
        last_placed_valid_ = false;
        ep_state_          = ExploreState::Placing;
    }

    // Convenience: capture the trained net's output at its CURRENT input
    // (process + capture). Equivalent to begin_reposition(mlp.outputs()).
    template <typename M>
    void begin_reposition(M& mlp) noexcept {
        if (mode_ != FeedbackMode::ExploreAndPlace) return;
        if (ep_state_ != ExploreState::Idle) return;
        mlp.process();
        capture_placed(mlp.outputs());
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
    // The replay view over the storage-owned buffers.
    ReplayView replay_() noexcept {
        return ReplayView(this->replay_inputs(), this->replay_actions(),
                          this->replay_rewards(), this->replay_ages_ms(),
                          this->n_in(), this->n_out(), this->replay_cap(),
                          replay_count_);
    }

    // One upstream-style optimise cycle over ALL live negatives. Unlike the
    // upstream cursor-coupled implementation, the positive centroid is looked
    // up at each negative's own stored input, so moving the cursor cannot
    // reinterpret an older rejection.
    template <typename M>
    bool optimise_geometric_once_(M& mlp, float lr) noexcept {
        auto replay = replay_();
        const std::size_t pos_total = replay.positive_count();
        const std::size_t neg_total = replay.negative_count();
        if (neg_total == 0u) return false;
        const float avg_neg = replay.avg_negative_reward();
        const std::size_t n_out = this->n_out();
        const float ratio = geo_neg_lr_ratio(neg_total, pos_total);

        for (std::size_t i = 0; i < replay.size(); ++i) {
            if (replay.reward(i) > 0.f) continue;
            const auto x_neg = replay.input(i);
            const auto a_neg = replay.action(i);
            auto mean = this->centroid_buf();
            const bool have_positives =
                replay.knn_positive_centroid(x_neg, kCentroidK, mean) > 0u;
            if (!have_positives) {
                for (std::size_t j = 0; j < n_out; ++j) mean[j] = 0.f;
            }
            auto target = this->target_buf();
            compute_push_target(a_neg, std::span<const float>(mean.data(), n_out),
                                focus_span_(), geo_push_step(avg_neg),
                                have_positives, rng_, target);
            mlp.train_targets(x_neg, std::span<const float>(target.data(), n_out),
                              lr * ratio, focus_span_());
        }
        return true;
    }

    // The focus mask as the geometric active-dims gate (empty ⇒ all active).
    std::span<const std::uint8_t> focus_span_() const noexcept {
        if (focus_count_ == 0u) return {};
        const auto focus = this->focus();
        return focus.subspan(0, focus_count_);
    }

    void capture_placed(std::span<const float> src) noexcept {
        auto placed = this->placed_out();
        const std::size_t n = (src.size() < placed.size()) ? src.size() : placed.size();
        for (std::size_t i = 0; i < n; ++i) placed[i] = src[i];
    }

    template <typename M>
    void take_snapshot(M& mlp) noexcept {
        // copy_weights_to writes the live flat weights+biases straight into
        // the snapshot slot — a single copy (no intermediate hop through
        // get_weights()'s flat_ scratch buffer; see storage.hpp L28).
        mlp.copy_weights_to(this->snapshot());
    }

    template <typename M>
    void restore_snapshot(M& mlp) noexcept {
        const auto snap = this->snapshot();
        mlp.set_weights(std::span<const float>(snap.data(), this->n_weights()));
    }

    void enter_randomise_outputs(std::span<const float> seed_out) noexcept {
        explore_active_  = true;
        learning_paused_ = true;
        // Seed every dim with the live output the user is hearing, so unfocused
        // (frozen) dims hold that value through the exploration — matching the
        // firmware `staticRandomOut_ = action; _roll_static_outputs();`. The
        // CALLER CONTRACT is to pass the full n_out live output. Any dims beyond
        // a short seed keep their previous static value (we have no live value
        // to freeze them to); they are only observable if a focus mask freezes
        // a dim the short seed did not cover — an out-of-contract corner.
        auto held = this->static_out();
        const std::size_t n = (seed_out.size() < held.size()) ? seed_out.size() : held.size();
        for (std::size_t i = 0; i < n; ++i) held[i] = seed_out[i];
        roll_static_outputs();
    }

    void roll_static_outputs() noexcept {
        auto held = this->static_out();
        const auto focus = this->focus();
        for (std::size_t i = 0; i < held.size(); ++i) {
            const bool active = (focus_count_ == 0u) || (i < focus_count_ && focus[i] != 0u);
            if (active) held[i] = rng_.next_float_uniform();  // [0, 1)
            // inactive dims keep their seeded entry value
        }
    }

    template <typename M>
    void enter_randomise_mlp(M& mlp, float spread) noexcept {
        explore_active_  = true;
        learning_paused_ = true;
        take_snapshot(mlp);
        mlp.draw_weights(spread);    // randomise the live net
    }

    template <typename M>
    void restore_after_explore(M& mlp) noexcept {
        if (mode_ == FeedbackMode::RandomiseMlp) {
            restore_snapshot(mlp);
        }
        learning_paused_ = false;
        explore_active_  = false;
    }

    // Cancel and abort share restore semantics; the caller stores nothing.
    template <typename M>
    void cancel_explore(M& mlp) noexcept { restore_after_explore(mlp); }
    template <typename M>
    void abort_explore(M& mlp)  noexcept { restore_after_explore(mlp); }

    // ---- ExploreAndPlace helpers --------------------------------------------
    bool can_scratch_op() const noexcept {
        return mode_ == FeedbackMode::ExploreAndPlace &&
               ep_state_ == ExploreState::Exploring;
    }

    // Push the CURRENT scratchpad weights onto the bounded undo ring before a
    // mutating op, so undo() restores the pre-op candidate.
    template <typename M>
    void push_undo(M& mlp) noexcept {
        auto slot = this->undo_slot(undo_head_);
        mlp.copy_weights_to(slot);  // single copy — see take_snapshot.
        const std::size_t cap = this->undo_cap();
        undo_head_ = (undo_head_ + 1u) % cap;
        if (undo_count_ < cap) ++undo_count_;
    }

    // Restore the set-aside real net and return to Idle. Shared by exit_explore
    // and abort_explore_place. No example stored.
    template <typename M>
    void restore_real_net(M& mlp) noexcept {
        restore_snapshot(mlp);
        learning_paused_   = false;
        ep_state_          = ExploreState::Idle;
        undo_count_        = 0u;
        last_placed_valid_ = false;
    }

    template <typename M>
    void abort_explore_place(M& mlp) noexcept {
        if (ep_state_ == ExploreState::Idle) return;
        if (reposition_) {
            // A reposition never set the real net aside, so there is nothing to
            // restore — clearing snapshot into the net here would CLOBBER the
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
    AvoidStyle   avoid_style_     = AvoidStyle::Geometric;
    bool         explore_active_  = false;
    bool         learning_paused_ = false;
    std::size_t  focus_count_     = 0;  // 0 ⇒ all active

    // ---- Geometric dislike state ---------------------------------------------
    std::size_t  replay_count_       = 0u;
    float        geo_lr_             = 0.001f;  // upstream InterfaceRL.hpp:312
    float        geo_update_hz_      = 200.f;   // upstream default optimise loop
    float        geo_lifetime_ms_    = 2500.f;  // upstream kDislikeLifetimeMs
    float        geo_step_accum_     = 0.f;

    // ---- ExploreAndPlace state ----------------------------------------------
    ExploreState ep_state_ = ExploreState::Idle;
    bool         last_placed_valid_ = false;
    bool         reposition_ = false;  // grab→move→drop hold; net NOT set aside
    std::size_t  undo_head_  = 0u;     // next write slot
    std::size_t  undo_count_ = 0u;     // valid entries (0..undo_cap)

    Rng rng_;
};

// The classic fixed-size controller over a compile-time MLP type — the
// firmware model and the default for tests. Sizes derive from the MLP.
// ReplayCap 32 is the firmware SRAM-budget default (rl-feedback-design §4);
// the browser's DynamicFeedbackStorage uses 64.
template <typename MLP_T, std::size_t UndoDepth = 4u, std::size_t ReplayCap = 32u>
using FeedbackController = FeedbackControllerCore<
    FixedFeedbackStorage<MLP_T::kOutput, MLP_T::weight_count(), UndoDepth,
                         MLP_T::kInput, ReplayCap>>;

}  // namespace nisps::ml
