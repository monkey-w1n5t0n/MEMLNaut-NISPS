// tests/cpp/test_ml_behaviour.cpp — INVARIANTS of the interaction model.
//
// Split of responsibility with tests/cpp/ml_bench.cpp:
//   ml_bench.cpp  REPORTS behaviour (how local is a dislike? how playable is
//                 the mapping?). Those are descriptions, not pass/fail, so it
//                 asserts nothing and is not a ctest gate.
//   this file     ASSERTS the things that must be TRUE regardless of tuning.
//                 If one of these breaks, the interaction model is broken, not
//                 merely different — a musician would call it a bug.
//
// Every test here is shape-parameterised where it can be, and runs at the
// operator's default 2-in/8-out as well as at degenerate shapes, because the
// edge cases are exactly where an interaction model quietly stops holding.
//
// These use MLPCore<DynamicStorage>, which is host-only by construction
// (dynamic_storage.hpp #errors on RP2350). That is fine: these are behavioural
// invariants of the shared algorithms, and the fixed-storage firmware path is
// bit-pinned to the dynamic one by test_mlp_storage_parity.cpp.

#include <cmath>
#include <span>
#include <vector>

#include "../../nisps/ml/dynamic_storage.hpp"
#include "../../nisps/ml/feedback.hpp"
#include "../../nisps/ml/mlp.hpp"
#include "test_helpers.hpp"

namespace {

using nisps::ml::AvoidStyle;
using nisps::ml::DynamicFeedbackStorage;
using nisps::ml::DynamicStorage;
using nisps::ml::FeedbackControllerCore;
using nisps::ml::FeedbackMode;
using nisps::ml::MLPCore;

using Mlp      = MLPCore<DynamicStorage>;
using Feedback = FeedbackControllerCore<DynamicFeedbackStorage>;

constexpr std::uint64_t kSeed = 0xC0FFEEu;

struct Rig {
    std::size_t n_in, n_out;
    Mlp         mlp;
    Feedback    fb;

    Rig(std::size_t nin, std::size_t nout, std::size_t h = 16u,
        std::size_t max_examples = 128u)
        : n_in(nin), n_out(nout),
          mlp(kSeed, nin, std::span<const std::size_t>(hidden_(h), 3u), nout,
              max_examples, 4096u),
          fb(kSeed ^ 0xF33Dull, nout, mlp.weight_count(), 4u, nin, 64u) {}

    // Static storage for the hidden dims so the span outlives the ctor call.
    static const std::size_t* hidden_(std::size_t h) {
        static std::size_t buf[3];
        buf[0] = buf[1] = buf[2] = h;
        return buf;
    }

    void at(std::span<const float> x, std::vector<float>& out) {
        out.assign(n_out, 0.f);
        for (std::size_t i = 0; i < n_in; ++i) mlp.set_input(i, x[i]);
        mlp.process();
        auto o = mlp.outputs();
        for (std::size_t j = 0; j < n_out; ++j) out[j] = o[j];
    }

    // The product path for a thumbs-up: dataset example AND replay positive.
    void like(std::span<const float> x, std::span<const float> y) {
        for (std::size_t i = 0; i < n_in; ++i) mlp.set_input(i, x[i]);
        mlp.process();
        mlp.add_example(x, y);
        fb.store_positive(mlp, y);
    }

    void down(std::span<const float> x, float speed = 0.1f, float spread = 1.f) {
        std::vector<float> heard;
        at(x, heard);
        for (std::size_t i = 0; i < n_in; ++i) mlp.set_input(i, x[i]);
        mlp.process();
        fb.on_down(mlp, heard, speed, spread, {});
    }

    // get_weights() returns a span into a storage-owned scratch buffer, so it
    // must be COPIED before the next call reuses that buffer.
    void weights(std::vector<float>& w) {
        auto s = mlp.get_weights();
        w.assign(s.begin(), s.end());
    }
};

float l2(std::span<const float> a, std::span<const float> b) {
    float acc = 0.f;
    const std::size_t n = a.size() < b.size() ? a.size() : b.size();
    for (std::size_t i = 0; i < n; ++i) { const float d = a[i] - b[i]; acc += d * d; }
    return std::sqrt(acc);
}

bool all_finite(std::span<const float> v) {
    for (float x : v) if (!std::isfinite(x)) return false;
    return true;
}

}  // namespace

// ===========================================================================
// PLACEMENT — a thumbs-up must actually take.
// ===========================================================================

// The single most basic promise the instrument makes: if you stand somewhere,
// like a set of outputs, and then stand in the SAME place again, you get
// approximately what you liked. Without this nothing else means anything.
NISPS_TEST(behaviour_single_like_is_reachable) {
    Rig rig(2u, 8u);
    const float x[2] = {0.25f, -0.4f};
    std::vector<float> y(8u);
    for (std::size_t j = 0; j < 8u; ++j) y[j] = 0.2f + 0.07f * static_cast<float>(j);

    rig.like(x, y);
    rig.mlp.train();

    std::vector<float> got;
    rig.at(x, got);
    NISPS_EXPECT(all_finite(got));
    // Loose bound on purpose: this asserts "the placement took", not "the
    // optimiser is good". Tightening it would make it a tuning test.
    NISPS_EXPECT(l2(got, y) < 0.25f);
}

// Placing at the same position twice with a NEW target must move toward the
// new one — the musician overwrote their earlier choice and expects that to win.
NISPS_TEST(behaviour_relike_same_spot_overwrites) {
    Rig rig(2u, 8u);
    const float x[2] = {0.1f, 0.1f};
    std::vector<float> y1(8u, 0.2f), y2(8u, 0.8f), got;

    rig.like(x, y1);
    rig.mlp.train();
    rig.at(x, got);
    const float err_to_y2_before = l2(got, y2);

    rig.like(x, y2);
    rig.mlp.train();
    rig.at(x, got);
    const float err_to_y2_after = l2(got, y2);

    NISPS_EXPECT(err_to_y2_after < err_to_y2_before);
}

// ===========================================================================
// FEEDBACK — the negative path must be well-behaved even when it is gentle.
// ===========================================================================

// A dislike must never produce non-finite outputs. This is the one thing that
// turns "the instrument feels wrong" into "the instrument is dead", and a
// perturbation path plus a sigmoid is exactly where NaN would come from.
NISPS_TEST(behaviour_dislike_never_produces_nonfinite) {
    for (AvoidStyle style : {AvoidStyle::Geometric, AvoidStyle::Diffuse}) {
        Rig rig(2u, 8u);
        std::vector<float> y(8u, 0.5f), got;
        const float a[2] = {0.3f, 0.3f};
        const float b[2] = {-0.3f, 0.2f};
        rig.like(a, y);
        rig.like(b, y);
        rig.mlp.train();

        rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
        rig.fb.set_avoid_style(style);
        const float press[2] = {0.f, 0.25f};
        for (int i = 0; i < 32; ++i) rig.down(press);

        rig.at(press, got);
        NISPS_EXPECT(all_finite(got));
        std::vector<float> w;
        rig.weights(w);
        NISPS_EXPECT(all_finite(w));
    }
}

// Dislike at cold start (no positives at all) must not crash or corrupt. This
// is literally the first thing a new user might press.
NISPS_TEST(behaviour_dislike_cold_start_is_safe) {
    Rig rig(2u, 8u);
    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);
    const float press[2] = {0.f, 0.f};

    NISPS_ASSERT(rig.fb.positive_count() == 0u);
    for (int i = 0; i < 8; ++i) rig.down(press);

    std::vector<float> got;
    rig.at(press, got);
    NISPS_EXPECT(all_finite(got));
    NISPS_EXPECT(rig.fb.negative_count() > 0u);
}

// Repeated dislikes at the same point must deepen ONE replay entry rather than
// filling the buffer — replay.hpp's dedup radius (0.05) exists for exactly
// this, and if it regresses a user holding the button evicts their own history.
NISPS_TEST(behaviour_repeat_dislike_dedups_not_accumulates) {
    Rig rig(2u, 8u);
    std::vector<float> y(8u, 0.5f);
    const float a[2] = {0.4f, 0.4f};
    rig.like(a, y);
    rig.mlp.train();

    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);
    const float press[2] = {-0.2f, 0.1f};
    for (int i = 0; i < 20; ++i) rig.down(press);

    // 20 presses inside the dedup radius: one negative, deepened.
    NISPS_EXPECT(rig.fb.negative_count() == 1u);
}

// A dislike far outside the dedup radius must create a SEPARATE negative.
// Together with the test above this pins the "move a little to the left"
// behaviour the operator asked about: inside 0.05 deepens, outside stores.
NISPS_TEST(behaviour_distant_dislike_stores_separately) {
    Rig rig(2u, 8u);
    std::vector<float> y(8u, 0.5f);
    const float a[2] = {0.4f, 0.4f};
    rig.like(a, y);
    rig.mlp.train();

    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);
    const float p1[2] = {-0.5f, 0.f};
    const float p2[2] = {0.5f, 0.f};   // well beyond kReplayDedupRadius
    rig.down(p1);
    rig.down(p2);
    NISPS_EXPECT(rig.fb.negative_count() == 2u);
}

// ===========================================================================
// EXPLORE / UNDO — the scratchpad must be exactly reversible.
// ===========================================================================

// Enter explore, roll, then undo everything and exit: the net must return to
// EXACTLY where it started. Not approximately — the whole point of the
// scratchpad model is that auditioning costs nothing.
NISPS_TEST(behaviour_explore_undo_restores_exactly) {
    Rig rig(2u, 8u);
    std::vector<float> y(8u, 0.5f);
    const float a[2] = {0.2f, -0.2f};
    rig.like(a, y);
    rig.mlp.train();

    std::vector<float> before, after;
    rig.weights(before);

    rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);
    rig.fb.enter_explore(rig.mlp, 1.f);
    for (int i = 0; i < 3; ++i) rig.fb.reroll(rig.mlp, 1.f);
    for (int i = 0; i < 3; ++i) rig.fb.undo(rig.mlp);
    rig.fb.exit_explore(rig.mlp);

    rig.weights(after);
    bool identical = true;
    for (std::size_t i = 0; i < before.size(); ++i) {
        if (before[i] != after[i]) { identical = false; break; }
    }
    NISPS_EXPECT(identical);
}

// Undoing more times than the ring holds must not corrupt anything. The user
// mashing undo is not a bug report.
NISPS_TEST(behaviour_undo_past_ring_depth_is_safe) {
    Rig rig(2u, 8u);
    std::vector<float> y(8u, 0.5f);
    const float a[2] = {0.f, 0.f};
    rig.like(a, y);
    rig.mlp.train();

    rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);
    rig.fb.enter_explore(rig.mlp, 1.f);
    for (int i = 0; i < 3; ++i) rig.fb.reroll(rig.mlp, 1.f);
    for (int i = 0; i < 40; ++i) rig.fb.undo(rig.mlp);   // way past depth 4
    rig.fb.exit_explore(rig.mlp);

    std::vector<float> w, got;
    rig.weights(w);
    NISPS_EXPECT(all_finite(w));
    rig.at(a, got);
    NISPS_EXPECT(all_finite(got));
}

// Output randomisation must NOT touch weights. This is the distinction the
// operator drew explicitly: RandomiseOutputs rolls a patch, RandomiseMlp
// scrambles the net. If the former ever moved weights, auditioning a patch
// would silently damage the instrument.
NISPS_TEST(behaviour_randomise_outputs_leaves_weights_untouched) {
    Rig rig(2u, 8u);
    std::vector<float> y(8u, 0.5f);
    const float a[2] = {0.15f, 0.15f};
    rig.like(a, y);
    rig.mlp.train();

    std::vector<float> before, after;
    rig.weights(before);

    rig.fb.set_mode(FeedbackMode::RandomiseOutputs, rig.mlp);
    const float press[2] = {-0.1f, 0.3f};
    for (int i = 0; i < 5; ++i) rig.down(press);   // enter + 4 re-rolls

    rig.weights(after);
    bool identical = true;
    for (std::size_t i = 0; i < before.size(); ++i) {
        if (before[i] != after[i]) { identical = false; break; }
    }
    NISPS_EXPECT(identical);

    // ...and it must actually be holding a patch to audition.
    std::vector<float> patch(8u, 0.f);
    NISPS_EXPECT(rig.fb.static_output(patch));
    NISPS_EXPECT(all_finite(patch));
}

// ===========================================================================
// DETERMINISM — the benchmark is worthless if the engine is not reproducible.
// ===========================================================================

// Two rigs built with the same seed, driven through the same gesture sequence,
// must end bit-identical. This is what makes a behavioural benchmark
// comparable across commits at all.
NISPS_TEST(behaviour_same_seed_same_journey_is_bit_identical) {
    auto journey = [](Rig& rig) {
        std::vector<float> y(8u);
        for (std::size_t j = 0; j < 8u; ++j) y[j] = 0.3f + 0.05f * static_cast<float>(j);
        const float a[2] = {0.2f, 0.1f};
        const float b[2] = {-0.3f, 0.4f};
        rig.like(a, y);
        rig.like(b, y);
        rig.mlp.train();
        rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
        rig.fb.set_avoid_style(AvoidStyle::Diffuse);
        const float press[2] = {0.f, 0.f};
        for (int i = 0; i < 5; ++i) rig.down(press);
    };

    Rig r1(2u, 8u), r2(2u, 8u);
    journey(r1);
    journey(r2);

    std::vector<float> w1, w2;
    r1.weights(w1);
    r2.weights(w2);
    NISPS_ASSERT(w1.size() == w2.size());
    bool identical = true;
    for (std::size_t i = 0; i < w1.size(); ++i) {
        if (w1[i] != w2[i]) { identical = false; break; }
    }
    NISPS_EXPECT(identical);
}

// ===========================================================================
// CAPACITY + DEGENERATE SHAPES
// ===========================================================================

// Overflowing the example ring must not corrupt state — it evicts, silently,
// and the newest examples must still be the ones honoured.
NISPS_TEST(behaviour_example_overflow_keeps_newest) {
    const std::size_t kCap = 8u;
    Rig rig(2u, 8u, 16u, kCap);
    std::vector<float> got;

    // 3x the cap. Each example has a distinguishable target.
    const std::size_t N = kCap * 3u;
    std::vector<float> xs(N * 2u), ys(N * 8u);
    for (std::size_t i = 0; i < N; ++i) {
        const float t = static_cast<float>(i) / static_cast<float>(N);
        xs[i * 2u] = 2.f * t - 1.f;
        xs[i * 2u + 1u] = 0.f;
        for (std::size_t j = 0; j < 8u; ++j) ys[i * 8u + j] = t;
        rig.like(std::span<const float>(&xs[i * 2u], 2u),
                 std::span<const float>(&ys[i * 8u], 8u));
    }
    rig.mlp.train();

    // The LAST example must be honoured; it cannot have been evicted.
    rig.at(std::span<const float>(&xs[(N - 1u) * 2u], 2u), got);
    NISPS_EXPECT(all_finite(got));
    NISPS_EXPECT(l2(got, std::span<const float>(&ys[(N - 1u) * 8u], 8u)) < 0.5f);
}

// Contradictory examples (same input, different targets) must converge to
// something finite rather than diverging. A musician WILL do this by accident.
NISPS_TEST(behaviour_contradictory_examples_stay_finite) {
    Rig rig(2u, 8u);
    const float x[2] = {0.f, 0.f};
    for (int k = 0; k < 6; ++k) {
        std::vector<float> y(8u, 0.1f + 0.15f * static_cast<float>(k));
        rig.like(x, y);
    }
    rig.mlp.train();

    std::vector<float> got, w;
    rig.at(x, got);
    rig.weights(w);
    NISPS_EXPECT(all_finite(got));
    NISPS_EXPECT(all_finite(w));
}

// The interaction model must hold at degenerate shapes, not just the default.
// 1-in/1-out is the narrowest legal net; a wide-output net is the realistic
// upper end once a mode drives 33 synth parameters.
NISPS_TEST(behaviour_holds_at_degenerate_shapes) {
    struct Shape { std::size_t n_in, n_out, hidden; };
    const Shape shapes[] = {
        {1u, 1u, 4u},      // narrowest legal
        {2u, 8u, 16u},     // operator default
        {1u, 33u, 8u},     // one control, many parameters
        {8u, 2u, 8u},      // many controls, few parameters
        {32u, 8u, 16u},    // the over-provisioned browser head
    };
    for (const Shape& s : shapes) {
        Rig rig(s.n_in, s.n_out, s.hidden);
        std::vector<float> x(s.n_in, 0.2f), y(s.n_out, 0.6f), got, w;
        rig.like(x, y);
        rig.mlp.train();
        rig.at(x, got);
        NISPS_EXPECT(all_finite(got));

        rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
        rig.fb.set_avoid_style(AvoidStyle::Geometric);
        rig.down(x);
        rig.weights(w);
        NISPS_EXPECT(all_finite(w));
        NISPS_EXPECT(rig.mlp.n_in() == s.n_in);
        NISPS_EXPECT(rig.mlp.n_out() == s.n_out);
    }
}

// ===========================================================================
// EXPLORE-AND-PLACE ACCESSOR CONTRACT
//
// This exists because getting it wrong fails SILENTLY, and it did: reading
// placed_output() after commit_place() returns an EMPTY span, l2() over an
// empty span is 0, and 0 reads as a perfect placement. A benchmark scored a
// broken lifecycle as flawless until ASAN found the out-of-bounds downstream.
// ===========================================================================
NISPS_TEST(behaviour_placed_vs_committed_output_contract) {
    Rig rig(2u, 8u);
    std::vector<float> y(8u, 0.4f);
    const float a[2] = {0.1f, -0.1f};
    rig.like(a, y);
    rig.mlp.train();

    rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);
    rig.fb.enter_explore(rig.mlp, 1.f);
    rig.fb.reroll(rig.mlp, 1.f);

    // While Exploring: nothing is placed yet.
    NISPS_EXPECT(rig.fb.placed_output().empty());

    rig.mlp.process();
    std::vector<float> audition(8u);
    { auto o = rig.mlp.outputs();
      for (std::size_t j = 0; j < 8u; ++j) audition[j] = o[j]; }
    rig.fb.begin_place(rig.mlp, audition);

    // While Placing: placed_output() is the live accessor.
    NISPS_ASSERT(rig.fb.placed_output().size() == 8u);
    NISPS_EXPECT(l2(rig.fb.placed_output(), audition) == 0.f);

    rig.fb.commit_place(rig.mlp);

    // After commit: state is Idle, so placed_output() goes EMPTY and the
    // caller must read committed_output() instead.
    NISPS_EXPECT(rig.fb.placed_output().empty());
    NISPS_ASSERT(rig.fb.committed_output().size() == 8u);
    NISPS_EXPECT(l2(rig.fb.committed_output(), audition) == 0.f);
}

// Reposition hands its carried vector over the same way.
NISPS_TEST(behaviour_reposition_carries_via_committed_output) {
    Rig rig(2u, 8u);
    std::vector<float> y(8u, 0.35f);
    const float src[2] = {0.3f, 0.3f};
    rig.like(src, y);
    rig.mlp.train();

    rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);
    for (std::size_t i = 0; i < 2u; ++i) rig.mlp.set_input(i, src[i]);
    rig.mlp.process();
    rig.fb.begin_reposition(rig.mlp);

    NISPS_ASSERT(rig.fb.placed_output().size() == 8u);
    std::vector<float> grabbed(rig.fb.placed_output().begin(),
                              rig.fb.placed_output().end());

    rig.fb.commit_reposition();
    NISPS_ASSERT(rig.fb.committed_output().size() == 8u);
    NISPS_EXPECT(l2(rig.fb.committed_output(), grabbed) == 0.f);
    NISPS_EXPECT(!rig.fb.repositioning());
}

// A fully-masked focus gate must freeze EVERY output: zero active dims means
// zero gradient, so a dislike is a no-op on the weights.
NISPS_TEST(behaviour_full_focus_mask_freezes_everything) {
    Rig rig(2u, 8u);
    std::vector<float> y(8u, 0.5f);
    const float a[2] = {0.2f, 0.2f};
    rig.like(a, y);
    rig.mlp.train();

    std::vector<std::uint8_t> mask(8u, 0u);   // nothing active
    rig.fb.set_focus_mask(mask);
    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);

    std::vector<float> before, after;
    rig.weights(before);
    const float press[2] = {-0.1f, 0.1f};
    for (int i = 0; i < 16; ++i) rig.down(press);
    rig.weights(after);

    bool identical = true;
    for (std::size_t i = 0; i < before.size(); ++i) {
        if (before[i] != after[i]) { identical = false; break; }
    }
    NISPS_EXPECT(identical);
}

// Switching feedback mode mid-exploration must tear down cleanly and never
// strand the net in a randomised scratchpad state. Live, that would be fatal.
NISPS_TEST(behaviour_mode_switch_midflight_never_strands) {
    Rig rig(2u, 8u);
    std::vector<float> y(8u, 0.45f);
    const float a[2] = {0.f, 0.2f};
    rig.like(a, y);
    rig.mlp.train();

    std::vector<float> before, after;
    rig.weights(before);

    rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);
    rig.fb.enter_explore(rig.mlp, 1.f);
    for (int i = 0; i < 3; ++i) rig.fb.reroll(rig.mlp, 1.f);
    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);   // yank it out

    rig.weights(after);
    bool identical = true;
    for (std::size_t i = 0; i < before.size(); ++i) {
        if (before[i] != after[i]) { identical = false; break; }
    }
    NISPS_EXPECT(identical);
    NISPS_EXPECT(!rig.fb.exploring());
}
