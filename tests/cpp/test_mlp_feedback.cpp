// tests/cpp/test_mlp_feedback.cpp — verify the FeedbackController "Down Action"
// state machine: Avoid / RandomiseOutputs / RandomiseMlp.
//
// Mirrors test_mlp_rl.cpp conventions (SmallMLP, snapshot-and-compare). The
// controller owns no MLP; every mutating call passes the MLP by reference.

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>

#include "test_helpers.hpp"

#include "../../nisps/ml/feedback.hpp"
#include "../../nisps/ml/mlp.hpp"

namespace {

using SmallMLP = nisps::ml::MLP<2, 4, 4, 4, 6, 8, 32>;
using FB       = nisps::ml::FeedbackController<SmallMLP>;
using nisps::ml::FeedbackAction;
using nisps::ml::FeedbackMode;

constexpr std::size_t kNOut = SmallMLP::kOutput;     // 6
constexpr std::size_t kW    = SmallMLP::weight_count();

// Empty spans for the "don't care" args.
const std::span<const float>        kNoOut{};
const std::span<const std::uint8_t> kNoMask{};

std::array<float, kW> snapshot_weights(SmallMLP& m) {
    std::array<float, kW> out{};
    auto w = m.get_weights();
    for (std::size_t i = 0; i < w.size(); ++i) out[i] = w[i];
    return out;
}

int distinct(const std::array<float, kW>& a, const std::array<float, kW>& b) {
    int d = 0;
    for (std::size_t i = 0; i < kW; ++i) {
        if (a[i] != b[i]) ++d;
    }
    return d;
}

bool weights_equal(SmallMLP& m, const std::array<float, kW>& ref) {
    auto w = m.get_weights();
    for (std::size_t i = 0; i < w.size(); ++i) {
        if (w[i] != ref[i]) return false;
    }
    return true;
}

// -- Avoid ------------------------------------------------------------------

NISPS_TEST(feedback_avoid_routes_to_move_weights) {
    SmallMLP m(99ull);
    m.draw_weights(0.5f);
    FB fb(7ull);  // default mode is Avoid

    const auto before = snapshot_weights(m);
    const FeedbackAction a = fb.on_down(m, kNoOut, 0.1f, 0.5f, kNoMask);
    const auto after = snapshot_weights(m);

    NISPS_EXPECT(a == FeedbackAction::AvoidPerturb);
    NISPS_EXPECT(distinct(before, after) > static_cast<int>(kW) / 2);  // perturbed
    NISPS_EXPECT(!fb.exploring());
    NISPS_EXPECT(!fb.learning_paused());
}

// -- RandomiseOutputs -------------------------------------------------------

NISPS_TEST(feedback_randout_enter_roll_state) {
    SmallMLP m(0ull);
    FB fb(123ull);
    fb.set_mode(FeedbackMode::RandomiseOutputs, m);

    std::array<float, kNOut> cur{};
    for (auto& v : cur) v = 0.5f;

    const auto before_w = snapshot_weights(m);
    const FeedbackAction a =
        fb.on_down(m, std::span<const float>(cur), 0.1f, 0.5f, kNoMask);

    NISPS_EXPECT(a == FeedbackAction::EnterExplore);
    NISPS_EXPECT(fb.exploring());
    NISPS_EXPECT(fb.learning_paused());

    std::array<float, kNOut> buf{};
    const bool bypass = fb.static_output(std::span<float>(buf));
    NISPS_EXPECT(bypass);  // MLP bypassed while exploring

    int changed = 0;
    for (std::size_t i = 0; i < kNOut; ++i) {
        if (buf[i] != 0.5f) ++changed;
    }
    NISPS_EXPECT(changed == static_cast<int>(kNOut));  // every dim rolled (no mask)

    // RandomiseOutputs must NOT touch the network weights.
    NISPS_EXPECT(weights_equal(m, before_w));
}

NISPS_TEST(feedback_randout_reroll_changes_focused_only) {
    SmallMLP m(0ull);
    FB fb(55ull);
    fb.set_mode(FeedbackMode::RandomiseOutputs, m);

    // Focus mask: roll dims 0,2,4; freeze dims 1,3,5.
    std::array<std::uint8_t, kNOut> mask{1, 0, 1, 0, 1, 0};
    fb.set_focus_mask(std::span<const std::uint8_t>(mask));

    const std::array<float, kNOut> seed{0.2f, 0.3f, 0.4f, 0.5f, 0.6f, 0.7f};
    fb.on_down(m, std::span<const float>(seed), 0.1f, 0.5f, kNoMask);  // enter + first roll

    std::array<float, kNOut> a{};
    fb.static_output(std::span<float>(a));

    fb.on_down(m, kNoOut, 0.1f, 0.5f, kNoMask);  // re-roll
    std::array<float, kNOut> b{};
    fb.static_output(std::span<float>(b));

    // Unfocused dims frozen at their seed value across both rolls.
    for (std::size_t i : {1u, 3u, 5u}) {
        NISPS_EXPECT(a[i] == seed[i]);
        NISPS_EXPECT(b[i] == seed[i]);
    }
    // Focused dims re-rolled → at least 2 of 3 differ between the two rolls.
    int focused_changed = 0;
    for (std::size_t i : {0u, 2u, 4u}) {
        if (a[i] != b[i]) ++focused_changed;
    }
    NISPS_EXPECT(focused_changed == 3);  // all focused dims re-rolled
}

NISPS_TEST(feedback_randout_commit_clears_state) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(9ull);
    fb.set_mode(FeedbackMode::RandomiseOutputs, m);

    const auto w0 = snapshot_weights(m);
    std::array<float, kNOut> cur{};
    for (auto& v : cur) v = 0.5f;
    fb.on_down(m, std::span<const float>(cur), 0.1f, 0.5f, kNoMask);  // enter

    const FeedbackAction a = fb.on_up(m);  // keep
    NISPS_EXPECT(a == FeedbackAction::CommitStore);
    NISPS_EXPECT(!fb.exploring());
    NISPS_EXPECT(!fb.learning_paused());

    std::array<float, kNOut> buf{};
    NISPS_EXPECT(!fb.static_output(std::span<float>(buf)));  // no longer bypassing
    NISPS_EXPECT(weights_equal(m, w0));                      // net untouched
}

// -- RandomiseMlp -----------------------------------------------------------

NISPS_TEST(feedback_randmlp_snapshot_and_cancel_restores) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::RandomiseMlp, m);

    const auto w0 = snapshot_weights(m);
    const FeedbackAction enter = fb.on_down(m, kNoOut, 0.1f, 0.5f, kNoMask);
    NISPS_EXPECT(enter == FeedbackAction::EnterExplore);
    NISPS_EXPECT(fb.exploring());
    NISPS_EXPECT(!weights_equal(m, w0));  // live net randomised

    const FeedbackAction cancel = fb.on_down(m, kNoOut, 0.1f, 0.5f, kNoMask);
    NISPS_EXPECT(cancel == FeedbackAction::Cancel);
    NISPS_EXPECT(!fb.exploring());
    NISPS_EXPECT(weights_equal(m, w0));   // original net byte-restored
}

NISPS_TEST(feedback_randmlp_commit_restores_then_caller_trains) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::RandomiseMlp, m);

    const auto w0 = snapshot_weights(m);
    fb.on_down(m, kNoOut, 0.1f, 0.5f, kNoMask);  // enter (randomise)

    const FeedbackAction a = fb.on_up(m);  // keep
    NISPS_EXPECT(a == FeedbackAction::CommitStore);
    NISPS_EXPECT(!fb.exploring());
    NISPS_EXPECT(weights_equal(m, w0));  // net restored; kept example trains it later
}

NISPS_TEST(feedback_randmlp_drag_repositions) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::RandomiseMlp, m);

    const auto w0 = snapshot_weights(m);
    fb.on_down(m, kNoOut, 0.1f, 0.5f, kNoMask);  // enter

    const FeedbackAction a = fb.on_drag(m);
    NISPS_EXPECT(a == FeedbackAction::Restore);
    NISPS_EXPECT(!fb.exploring());
    NISPS_EXPECT(weights_equal(m, w0));
}

NISPS_TEST(feedback_mode_switch_aborts_explore) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::RandomiseMlp, m);

    const auto w0 = snapshot_weights(m);
    fb.on_down(m, kNoOut, 0.1f, 0.5f, kNoMask);  // enter (randomise)
    NISPS_EXPECT(!weights_equal(m, w0));

    fb.set_mode(FeedbackMode::Avoid, m);  // switching aborts → restore + resume
    NISPS_EXPECT(fb.mode() == FeedbackMode::Avoid);
    NISPS_EXPECT(!fb.exploring());
    NISPS_EXPECT(!fb.learning_paused());
    NISPS_EXPECT(weights_equal(m, w0));
}

// -- determinism + bypass invariants ---------------------------------------

NISPS_TEST(feedback_determinism_fixed_seed) {
    // Same controller seed + same press sequence → byte-identical static output,
    // proving the per-instance Rng (no libc rand()).
    SmallMLP m1(0ull), m2(0ull);
    FB a(42ull), b(42ull);
    a.set_mode(FeedbackMode::RandomiseOutputs, m1);
    b.set_mode(FeedbackMode::RandomiseOutputs, m2);

    std::array<float, kNOut> cur{};
    for (auto& v : cur) v = 0.25f;

    a.on_down(m1, std::span<const float>(cur), 0.1f, 0.5f, kNoMask);  // enter
    b.on_down(m2, std::span<const float>(cur), 0.1f, 0.5f, kNoMask);
    a.on_down(m1, kNoOut, 0.1f, 0.5f, kNoMask);  // reroll
    b.on_down(m2, kNoOut, 0.1f, 0.5f, kNoMask);

    std::array<float, kNOut> ba{}, bb{};
    a.static_output(std::span<float>(ba));
    b.static_output(std::span<float>(bb));
    for (std::size_t i = 0; i < kNOut; ++i) NISPS_EXPECT(ba[i] == bb[i]);
}

NISPS_TEST(feedback_focus_empty_means_all_active) {
    SmallMLP m(0ull);
    FB fb(1ull);
    fb.set_mode(FeedbackMode::RandomiseOutputs, m);  // no focus mask set

    std::array<float, kNOut> cur{};
    for (auto& v : cur) v = 0.5f;
    fb.on_down(m, std::span<const float>(cur), 0.1f, 0.5f, kNoMask);

    std::array<float, kNOut> buf{};
    fb.static_output(std::span<float>(buf));
    int changed = 0;
    for (std::size_t i = 0; i < kNOut; ++i) {
        if (buf[i] != 0.5f) ++changed;
    }
    NISPS_EXPECT(changed == static_cast<int>(kNOut));  // all dims rolled
}

NISPS_TEST(feedback_static_output_bypass_only_in_randout) {
    SmallMLP m(0ull);
    std::array<float, kNOut> buf{};

    FB avoid(0ull);  // Avoid, not exploring
    NISPS_EXPECT(!avoid.static_output(std::span<float>(buf)));

    FB ro(0ull);
    ro.set_mode(FeedbackMode::RandomiseOutputs, m);  // mode set but NOT entered
    NISPS_EXPECT(!ro.static_output(std::span<float>(buf)));

    std::array<float, kNOut> cur{};
    ro.on_down(m, std::span<const float>(cur), 0.1f, 0.5f, kNoMask);  // now exploring
    NISPS_EXPECT(ro.static_output(std::span<float>(buf)));
}

// -- LikeStore / non-exploring fallbacks ------------------------------------

NISPS_TEST(feedback_avoid_up_is_like_store) {
    SmallMLP m(0ull);
    FB fb(0ull);  // Avoid
    NISPS_EXPECT(fb.on_up(m) == FeedbackAction::LikeStore);
    NISPS_EXPECT(!fb.exploring());
}

NISPS_TEST(feedback_idle_up_is_like_store) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::RandomiseOutputs, m);  // mode set, never entered
    const auto w0 = snapshot_weights(m);
    NISPS_EXPECT(fb.on_up(m) == FeedbackAction::LikeStore);
    NISPS_EXPECT(weights_equal(m, w0));  // idle up touches nothing
}

NISPS_TEST(feedback_drag_non_explore_is_like_store) {
    SmallMLP m(0ull);
    FB fb(0ull);  // Avoid, not exploring
    NISPS_EXPECT(fb.on_drag(m) == FeedbackAction::LikeStore);
}

NISPS_TEST(feedback_commit_without_enter_is_like_store) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::RandomiseMlp, m);  // never entered
    const auto w0 = snapshot_weights(m);
    NISPS_EXPECT(fb.on_up(m) == FeedbackAction::LikeStore);
    NISPS_EXPECT(fb.on_drag(m) == FeedbackAction::LikeStore);
    NISPS_EXPECT(weights_equal(m, w0));  // no enter → nothing restored/mutated
}

// -- drag must NOT cancel a RandomiseOutputs exploration (firmware semantics) -

NISPS_TEST(feedback_randout_drag_stays_in_explore) {
    SmallMLP m(0ull);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::RandomiseOutputs, m);
    std::array<float, kNOut> cur{};
    for (auto& v : cur) v = 0.5f;
    fb.on_down(m, std::span<const float>(cur), 0.1f, 0.5f, kNoMask);  // enter
    NISPS_EXPECT(fb.on_drag(m) == FeedbackAction::LikeStore);  // plain store
    NISPS_EXPECT(fb.exploring());        // exploration CONTINUES
    NISPS_EXPECT(fb.learning_paused());
    std::array<float, kNOut> buf{};
    NISPS_EXPECT(fb.static_output(std::span<float>(buf)));  // still bypassing
}

// -- fidelity: unfocused dims freeze at the live (current_out) value ---------

NISPS_TEST(feedback_randout_unfocused_freezes_at_current_out) {
    SmallMLP m(0ull);
    FB fb(3ull);
    fb.set_mode(FeedbackMode::RandomiseOutputs, m);
    std::array<std::uint8_t, kNOut> mask{1, 0, 1, 0, 1, 0};  // freeze 1,3,5
    fb.set_focus_mask(std::span<const std::uint8_t>(mask));
    const std::array<float, kNOut> cur{0.11f, 0.22f, 0.33f, 0.44f, 0.55f, 0.66f};
    fb.on_down(m, std::span<const float>(cur), 0.1f, 0.5f, kNoMask);  // enter
    std::array<float, kNOut> buf{};
    fb.static_output(std::span<float>(buf));
    NISPS_EXPECT(buf[1] == cur[1]);  // frozen at the live value, not 0 or random
    NISPS_EXPECT(buf[3] == cur[3]);
    NISPS_EXPECT(buf[5] == cur[5]);
    int focused_changed = 0;
    for (std::size_t i : {0u, 2u, 4u}) {
        if (buf[i] != cur[i]) ++focused_changed;
    }
    NISPS_EXPECT(focused_changed == 3);
}

// -- golden RNG stream: catches an RNG/seed-mix regression even if symmetric --

NISPS_TEST(feedback_randout_golden_stream) {
    SmallMLP m(0ull);
    FB fb(42ull);
    fb.set_mode(FeedbackMode::RandomiseOutputs, m);
    std::array<float, kNOut> cur{};  // no mask → all dims rolled from the FB RNG
    fb.on_down(m, std::span<const float>(cur), 0.1f, 0.5f, kNoMask);  // enter
    std::array<float, kNOut> buf{};
    fb.static_output(std::span<float>(buf));
    // GOLDEN (seed 42, first roll) — regenerate ONLY on an intentional RNG change.
    NISPS_EXPECT_NEAR(buf[0], 0.0857555866f, 1e-6);
    NISPS_EXPECT_NEAR(buf[1], 0.310411394f, 1e-6);
    NISPS_EXPECT_NEAR(buf[2], 0.0625697374f, 1e-6);
    NISPS_EXPECT_NEAR(buf[5], 0.3030653f, 1e-6);
}

// -- RandomiseMlp: repeated enter/commit re-snapshots each cycle -------------

NISPS_TEST(feedback_randmlp_repeated_enter_commit_restores_each_time) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::RandomiseMlp, m);
    for (int cycle = 0; cycle < 3; ++cycle) {
        const auto w0 = snapshot_weights(m);
        fb.on_down(m, kNoOut, 0.1f, 0.5f, kNoMask);  // enter → randomise temp net
        NISPS_EXPECT(!weights_equal(m, w0));
        fb.on_up(m);                                  // commit → restore
        NISPS_EXPECT(weights_equal(m, w0));           // a stale snapshot would fail here
        m.move_weights(0.05f, 0.5f);                  // mutate the "original" net for next cycle
    }
}

// -- focus mask edge cases ---------------------------------------------------

NISPS_TEST(feedback_clear_focus_restores_all_active) {
    SmallMLP m(0ull);
    FB fb(8ull);
    fb.set_mode(FeedbackMode::RandomiseOutputs, m);
    std::array<std::uint8_t, kNOut> mask{1, 0, 0, 0, 0, 0};
    fb.set_focus_mask(std::span<const std::uint8_t>(mask));
    fb.clear_focus_mask();  // back to all-active
    std::array<float, kNOut> cur{};
    for (auto& v : cur) v = 0.5f;
    fb.on_down(m, std::span<const float>(cur), 0.1f, 0.5f, kNoMask);
    std::array<float, kNOut> buf{};
    fb.static_output(std::span<float>(buf));
    int changed = 0;
    for (std::size_t i = 0; i < kNOut; ++i) {
        if (buf[i] != cur[i]) ++changed;
    }
    NISPS_EXPECT(changed == static_cast<int>(kNOut));  // all dims roll again
}

NISPS_TEST(feedback_focus_mask_truncates_when_oversized) {
    SmallMLP m(0ull);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::RandomiseOutputs, m);
    // Oversized mask (kNOut+4): set_focus_mask must clamp to kNOut, no overflow.
    std::array<std::uint8_t, kNOut + 4> mask{};
    for (auto& v : mask) v = 1;
    fb.set_focus_mask(std::span<const std::uint8_t>(mask));
    std::array<float, kNOut> cur{};
    for (auto& v : cur) v = 0.5f;
    fb.on_down(m, std::span<const float>(cur), 0.1f, 0.5f, kNoMask);  // must not overflow
    std::array<float, kNOut> buf{};
    NISPS_EXPECT(fb.static_output(std::span<float>(buf)));
}

NISPS_TEST(feedback_short_static_buffer_clamps) {
    SmallMLP m(0ull);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::RandomiseOutputs, m);
    std::array<float, kNOut> cur{};
    fb.on_down(m, std::span<const float>(cur), 0.1f, 0.5f, kNoMask);  // enter
    // Caller passes a buffer SHORTER than kNOut — must fill only that many.
    std::array<float, 3> small{-1.f, -1.f, -1.f};
    NISPS_EXPECT(fb.static_output(std::span<float>(small)));
    for (float v : small) NISPS_EXPECT(v != -1.f);  // all 3 written, no overflow
}

// ===========================================================================
// ExploreAndPlace — the Idle → Exploring → Placing → Idle lifecycle.
// ===========================================================================

using nisps::ml::ExploreState;

NISPS_TEST(ep_enter_explore_snapshots_and_randomises) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);

    const auto real = snapshot_weights(m);
    NISPS_EXPECT(fb.explore_state() == ExploreState::Idle);
    NISPS_EXPECT(!fb.exploring());

    fb.enter_explore(m, 0.5f);
    NISPS_EXPECT(fb.explore_state() == ExploreState::Exploring);
    NISPS_EXPECT(fb.exploring());
    NISPS_EXPECT(fb.learning_paused());
    NISPS_EXPECT(!weights_equal(m, real));  // scratchpad net is live

    fb.exit_explore(m);                      // back out → real net restored
    NISPS_EXPECT(fb.explore_state() == ExploreState::Idle);
    NISPS_EXPECT(!fb.learning_paused());
    NISPS_EXPECT(weights_equal(m, real));
}

NISPS_TEST(ep_reroll_changes_scratchpad_undo_restores) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(7ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);
    fb.enter_explore(m, 0.5f);

    const auto cand0 = snapshot_weights(m);
    fb.reroll(m, 0.5f);
    const auto cand1 = snapshot_weights(m);
    NISPS_EXPECT(distinct(cand0, cand1) > 0);          // re-rolled
    NISPS_EXPECT(fb.undo_depth() == 1u);

    fb.undo(m);                                         // back to cand0
    NISPS_EXPECT(weights_equal(m, cand0));
    NISPS_EXPECT(fb.undo_depth() == 0u);
}

NISPS_TEST(ep_nudge_is_bounded_and_undoable) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(3ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);
    fb.enter_explore(m, 0.5f);

    const auto before = snapshot_weights(m);
    fb.nudge(m, 0.05f);
    const auto after = snapshot_weights(m);
    NISPS_EXPECT(distinct(before, after) > 0);         // perturbed
    // Bounded: small stddev → deltas stay modest.
    float max_delta = 0.f;
    for (std::size_t i = 0; i < kW; ++i) {
        const float d = after[i] - before[i];
        const float ad = d < 0.f ? -d : d;
        if (ad > max_delta) max_delta = ad;
    }
    NISPS_EXPECT(max_delta < 1.0f);                    // nudge, not a re-roll

    fb.undo(m);
    NISPS_EXPECT(weights_equal(m, before));
}

NISPS_TEST(ep_undo_ring_bounded_to_depth) {
    // Default UndoDepth = 4. After 6 rerolls, only 4 undos are available.
    SmallMLP m(0ull);
    FB fb(11ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);
    fb.enter_explore(m, 0.5f);
    for (int i = 0; i < 6; ++i) fb.reroll(m, 0.5f);
    NISPS_EXPECT(fb.undo_depth() == FB::kUndoDepth);   // saturated at depth
    for (std::size_t i = 0; i < FB::kUndoDepth; ++i) fb.undo(m);
    NISPS_EXPECT(fb.undo_depth() == 0u);
    fb.undo(m);                                        // extra undo is a no-op
    NISPS_EXPECT(fb.undo_depth() == 0u);
}

NISPS_TEST(ep_place_freezes_output_and_holds_via_static) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);
    fb.enter_explore(m, 0.5f);

    // Audition at a fixed input, then begin_place freezes that output.
    m.set_input(0u, 0.3f);
    m.set_input(1u, 0.7f);
    m.process();
    std::array<float, kNOut> auditioned{};
    {
        auto o = m.outputs();
        for (std::size_t i = 0; i < kNOut; ++i) auditioned[i] = o[i];
    }

    fb.begin_place(m);  // convenience overload: process + capture
    NISPS_EXPECT(fb.placing());
    NISPS_EXPECT(fb.explore_state() == ExploreState::Placing);

    auto placed = fb.placed_output();
    NISPS_EXPECT(placed.size() == kNOut);
    for (std::size_t i = 0; i < kNOut; ++i) NISPS_EXPECT(placed[i] == auditioned[i]);

    // While placing, static_output holds the frozen vector regardless of input.
    std::array<float, kNOut> buf{};
    NISPS_EXPECT(fb.static_output(std::span<float>(buf)));
    for (std::size_t i = 0; i < kNOut; ++i) NISPS_EXPECT(buf[i] == auditioned[i]);
}

NISPS_TEST(ep_commit_place_restores_real_net_exposes_committed) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);

    const auto real = snapshot_weights(m);
    fb.enter_explore(m, 0.5f);
    fb.begin_place(m);
    std::array<float, kNOut> frozen{};
    {
        auto p = fb.placed_output();
        for (std::size_t i = 0; i < kNOut; ++i) frozen[i] = p[i];
    }

    fb.commit_place(m);
    NISPS_EXPECT(fb.explore_state() == ExploreState::Idle);
    NISPS_EXPECT(!fb.learning_paused());
    NISPS_EXPECT(weights_equal(m, real));              // real net restored

    // The caller reads the committed vector AFTER restore to add the +1 example.
    auto committed = fb.committed_output();
    NISPS_EXPECT(committed.size() == kNOut);
    for (std::size_t i = 0; i < kNOut; ++i) NISPS_EXPECT(committed[i] == frozen[i]);
}

NISPS_TEST(ep_cancel_place_returns_to_exploring) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);
    fb.enter_explore(m, 0.5f);
    const auto scratch = snapshot_weights(m);
    fb.begin_place(m);
    NISPS_EXPECT(fb.placing());

    fb.cancel_place();
    NISPS_EXPECT(fb.explore_state() == ExploreState::Exploring);
    NISPS_EXPECT(fb.exploring());
    NISPS_EXPECT(weights_equal(m, scratch));           // scratchpad untouched
}

NISPS_TEST(ep_software_policy_down_up_drives_machine) {
    // on_down / on_up are the BROWSER default policy over the same machine.
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);
    const auto real = snapshot_weights(m);

    NISPS_EXPECT(fb.on_down(m, kNoOut, 0.1f, 0.5f, kNoMask) == FeedbackAction::EnterExplore);
    NISPS_EXPECT(fb.explore_state() == ExploreState::Exploring);

    NISPS_EXPECT(fb.on_down(m, kNoOut, 0.1f, 0.5f, kNoMask) == FeedbackAction::ScratchReroll);
    NISPS_EXPECT(fb.explore_state() == ExploreState::Exploring);

    NISPS_EXPECT(fb.on_up(m) == FeedbackAction::BeginPlace);
    NISPS_EXPECT(fb.placing());

    NISPS_EXPECT(fb.on_up(m) == FeedbackAction::CommitPlace);
    NISPS_EXPECT(fb.explore_state() == ExploreState::Idle);
    NISPS_EXPECT(weights_equal(m, real));

    // Down while placing backs out to exploring.
    fb.on_down(m, kNoOut, 0.1f, 0.5f, kNoMask);  // enter
    fb.on_up(m);                                  // begin place
    NISPS_EXPECT(fb.placing());
    NISPS_EXPECT(fb.on_down(m, kNoOut, 0.1f, 0.5f, kNoMask) == FeedbackAction::CancelPlace);
    NISPS_EXPECT(fb.explore_state() == ExploreState::Exploring);
}

NISPS_TEST(ep_mode_switch_aborts_session_restores) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);
    const auto real = snapshot_weights(m);
    fb.enter_explore(m, 0.5f);
    fb.begin_place(m);
    NISPS_EXPECT(fb.placing());

    fb.set_mode(FeedbackMode::Avoid, m);               // switching aborts
    NISPS_EXPECT(fb.mode() == FeedbackMode::Avoid);
    NISPS_EXPECT(fb.explore_state() == ExploreState::Idle);
    NISPS_EXPECT(!fb.learning_paused());
    NISPS_EXPECT(weights_equal(m, real));
}

NISPS_TEST(ep_determinism_fixed_seed) {
    // Same seed + same op sequence → byte-identical scratchpad nudges, proving
    // the per-instance Rng (the nudge draws from the controller's own stream).
    SmallMLP m1(0ull), m2(0ull);
    m1.draw_weights(0.5f); m2.draw_weights(0.5f);
    FB a(42ull), b(42ull);
    a.set_mode(FeedbackMode::ExploreAndPlace, m1);
    b.set_mode(FeedbackMode::ExploreAndPlace, m2);
    a.enter_explore(m1, 0.5f);
    b.enter_explore(m2, 0.5f);
    a.nudge(m1, 0.05f);
    b.nudge(m2, 0.05f);
    auto wa = snapshot_weights(m1);
    auto wb = snapshot_weights(m2);
    for (std::size_t i = 0; i < kW; ++i) NISPS_EXPECT(wa[i] == wb[i]);
}

NISPS_TEST(ep_full_flow_two_anchors_caller_trains) {
    // End-to-end: explore→place→commit twice, with the CALLER doing the
    // add_example + train (the contract). After warm-start the net should bend
    // toward both placed anchors.
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(5ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);

    const std::array<std::array<float, 2>, 2> inputs{{{{0.1f, 0.1f}}, {{0.9f, 0.9f}}}};
    for (int anchor = 0; anchor < 2; ++anchor) {
        fb.enter_explore(m, 0.5f);
        // audition at the chosen input
        m.set_input(0u, inputs[anchor][0]);
        m.set_input(1u, inputs[anchor][1]);
        m.process();
        fb.begin_place(m);
        fb.commit_place(m);                            // restores real net
        // CALLER stores the +1 example (input → committed output) and trains.
        auto out = fb.committed_output();
        NISPS_EXPECT(out.size() == kNOut);
        m.add_example(std::span<const float>(inputs[anchor].data(), 2u), out);
    }
    const float loss = m.train(0.3f, 200u, 0.0f);
    NISPS_EXPECT(loss >= 0.f);                          // trained, finite
    NISPS_EXPECT(m.example_count() == 2u);
}

// ===========================================================================
// Reposition (grab → move → drop) — relocate an existing positive example's
// output to a new input position. NO scratchpad, NO weight snapshot/restore.
// ===========================================================================

NISPS_TEST(ep_reposition_holds_output_without_setting_net_aside) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);

    // The trained net's output at input A — the sound we want to carry.
    m.set_input(0u, 0.2f);
    m.set_input(1u, 0.8f);
    m.process();
    std::array<float, kNOut> heard{};
    { auto o = m.outputs(); for (std::size_t i = 0; i < kNOut; ++i) heard[i] = o[i]; }
    const auto real = snapshot_weights(m);

    fb.begin_reposition(m);  // GRAB (process + capture at current input)
    NISPS_EXPECT(fb.repositioning());
    NISPS_EXPECT(fb.placing());
    NISPS_EXPECT(fb.learning_paused());
    NISPS_EXPECT(weights_equal(m, real));  // real net NOT snapshotted/randomised

    // The carried output survives moving the input toward B.
    m.set_input(0u, 0.9f);
    m.set_input(1u, 0.1f);
    std::array<float, kNOut> buf{};
    NISPS_EXPECT(fb.static_output(std::span<float>(buf)));
    for (std::size_t i = 0; i < kNOut; ++i) NISPS_EXPECT(buf[i] == heard[i]);
}

NISPS_TEST(ep_reposition_commit_stores_carried_output_no_restore) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);
    m.set_input(0u, 0.2f); m.set_input(1u, 0.8f); m.process();
    std::array<float, kNOut> heard{};
    { auto o = m.outputs(); for (std::size_t i = 0; i < kNOut; ++i) heard[i] = o[i]; }

    fb.begin_reposition(m);
    const auto held = snapshot_weights(m);  // weights frozen during the hold

    fb.commit_reposition();  // DROP
    NISPS_EXPECT(!fb.repositioning());
    NISPS_EXPECT(fb.explore_state() == ExploreState::Idle);
    NISPS_EXPECT(!fb.learning_paused());
    NISPS_EXPECT(weights_equal(m, held));  // NO weight restore on commit

    // The committed vector is the carried (existing) output; the caller stores
    // it at the NEW input B.
    auto out = fb.committed_output();
    NISPS_EXPECT(out.size() == kNOut);
    for (std::size_t i = 0; i < kNOut; ++i) NISPS_EXPECT(out[i] == heard[i]);
    const std::array<float, 2> inputB{0.9f, 0.1f};
    m.add_example(std::span<const float>(inputB.data(), 2u), out);
    NISPS_EXPECT(m.example_count() == 1u);
}

NISPS_TEST(ep_reposition_mode_switch_aborts_without_clobbering_net) {
    // The teardown path must NOT set_weights(stale snapshot_) for a reposition —
    // that would destroy the live trained net.
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);
    m.process();
    const auto real = snapshot_weights(m);
    fb.begin_reposition(m);
    NISPS_EXPECT(fb.repositioning());

    fb.set_mode(FeedbackMode::Avoid, m);  // abort the hold
    NISPS_EXPECT(!fb.repositioning());
    NISPS_EXPECT(fb.explore_state() == ExploreState::Idle);
    NISPS_EXPECT(!fb.learning_paused());
    NISPS_EXPECT(weights_equal(m, real));  // live net preserved
}

NISPS_TEST(ep_reposition_begin_only_from_idle) {
    SmallMLP m(0ull);
    m.draw_weights(0.5f);
    FB fb(0ull);
    fb.set_mode(FeedbackMode::ExploreAndPlace, m);
    fb.enter_explore(m, 0.5f);              // now Exploring, not Idle
    fb.begin_reposition(m);                 // must be a no-op
    NISPS_EXPECT(!fb.repositioning());
    NISPS_EXPECT(fb.explore_state() == ExploreState::Exploring);
    // commit with no hold active is a no-op too.
    fb.commit_reposition();
    NISPS_EXPECT(fb.explore_state() == ExploreState::Exploring);
}

}  // namespace
