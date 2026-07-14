// tests/cpp/test_mlp_geo_dislike.cpp — geometric dislike (one-core-engine P3;
// docs/adr/rl-feedback-design.md §2.1/§4/§6.1).
//
// Covers: replay dedup/deepen at radius 0.05, k-NN centroid selection with
// deterministic index tie-break, push direction sign (target moves AWAY from
// the liked centroid), taper, cold-start posMemCount==0 fallback, decay/
// eviction + dislike-multiplier bookkeeping, solo/focus gating, and fixed-seed
// determinism.

#include <array>
#include <cmath>
#include <cstdint>
#include <span>

#include "../../nisps/ml/feedback.hpp"
#include "../../nisps/ml/geo_push.hpp"
#include "../../nisps/ml/mlp.hpp"
#include "../../nisps/ml/replay.hpp"
#include "test_helpers.hpp"

namespace {

using nisps::ml::AvoidStyle;
using nisps::ml::FeedbackAction;
using nisps::ml::FeedbackMode;
using nisps::ml::ReplayView;

using GeoMLP = nisps::ml::MLP<2u, 4u, 4u, 4u, 6u, 8u, 32u>;
using GeoFB  = nisps::ml::FeedbackController<GeoMLP, 2u, 16u>;

constexpr std::size_t kNIn  = 2u;
constexpr std::size_t kNOut = 6u;
constexpr std::size_t kCap  = 16u;

struct RawReplay {
    std::array<float, kCap * kNIn>  in{};
    std::array<float, kCap * kNOut> act{};
    std::array<float, kCap>         rew{};
    std::size_t count = 0u;

    ReplayView view() {
        return ReplayView(in, act, rew, kNIn, kNOut, kCap, count);
    }
};

void set_inputs(GeoMLP& m, float x, float y) {
    m.set_input(0u, x);
    m.set_input(1u, y);
}

}  // namespace

// -- ReplayView primitives ----------------------------------------------------

NISPS_TEST(replay_deepen_within_radius_else_store) {
    RawReplay raw;
    auto r = raw.view();
    const float x1[kNIn]  = {0.5f, 0.5f};
    const float x2[kNIn]  = {0.52f, 0.52f};  // within 0.05 of x1
    const float x3[kNIn]  = {0.9f, 0.9f};    // far away
    const float a[kNOut]  = {0.1f, 0.2f, 0.3f, 0.4f, 0.5f, 0.6f};
    const float a2[kNOut] = {0.9f, 0.8f, 0.7f, 0.6f, 0.5f, 0.4f};

    NISPS_EXPECT(!r.deepen_or_store_negative(std::span<const float>(x1), std::span<const float>(a)));
    NISPS_ASSERT(r.size() == 1u);
    NISPS_EXPECT(r.reward(0) == -1.f);

    // Nearby dislike deepens (reward -2) and refreshes the action.
    NISPS_EXPECT(r.deepen_or_store_negative(std::span<const float>(x2), std::span<const float>(a2)));
    NISPS_ASSERT(r.size() == 1u);
    NISPS_EXPECT(r.reward(0) == -2.f);
    NISPS_EXPECT(r.action(0)[0] == 0.9f);

    // Far dislike stores a new item.
    NISPS_EXPECT(!r.deepen_or_store_negative(std::span<const float>(x3), std::span<const float>(a)));
    NISPS_ASSERT(r.size() == 2u);

    // Deepening clamps at -16.
    for (int i = 0; i < 40; ++i) {
        r.deepen_or_store_negative(std::span<const float>(x1), std::span<const float>(a));
    }
    NISPS_EXPECT(r.reward(0) == -16.f);
}

NISPS_TEST(replay_knn_centroid_deterministic_tie_break) {
    RawReplay raw;
    auto r = raw.view();
    const float probe[kNIn] = {0.5f, 0.5f};

    // Two positives EQUIDISTANT from the probe, distinct actions; k=1 must
    // pick the LOWER index deterministically.
    const float pa[kNIn] = {0.4f, 0.5f};
    const float pb[kNIn] = {0.6f, 0.5f};
    float aa[kNOut]; for (std::size_t j = 0; j < kNOut; ++j) aa[j] = 0.2f;
    float ab[kNOut]; for (std::size_t j = 0; j < kNOut; ++j) ab[j] = 0.8f;
    r.store(1.f, std::span<const float>(pa), std::span<const float>(aa));
    r.store(1.f, std::span<const float>(pb), std::span<const float>(ab));

    std::array<float, kNOut> mean{};
    const std::size_t used = r.knn_positive_centroid(std::span<const float>(probe), 1u, mean);
    NISPS_ASSERT(used == 1u);
    NISPS_EXPECT(mean[0] == 0.2f);  // index 0 wins the tie

    // k=4 with 3 positives → uses all 3; centroid is their mean.
    const float pc[kNIn] = {0.5f, 0.6f};
    float ac[kNOut]; for (std::size_t j = 0; j < kNOut; ++j) ac[j] = 0.5f;
    r.store(1.f, std::span<const float>(pc), std::span<const float>(ac));
    const std::size_t used4 = r.knn_positive_centroid(std::span<const float>(probe), 4u, mean);
    NISPS_ASSERT(used4 == 3u);
    NISPS_EXPECT_NEAR(mean[0], (0.2f + 0.8f + 0.5f) / 3.f, 1e-6);

    // Negatives never contribute.
    const float nx[kNIn] = {0.5f, 0.5f};
    float na[kNOut]; for (std::size_t j = 0; j < kNOut; ++j) na[j] = 0.0f;
    r.store(-1.f, std::span<const float>(nx), std::span<const float>(na));
    const std::size_t used_after_neg =
        r.knn_positive_centroid(std::span<const float>(probe), 4u, mean);
    NISPS_EXPECT(used_after_neg == 3u);
}

NISPS_TEST(replay_decay_and_evict) {
    RawReplay raw;
    auto r = raw.view();
    const float x[kNIn] = {0.1f, 0.1f};
    const float a[kNOut] = {};
    // A shallow negative just above the evict threshold decays out in a few
    // calls; rewards move by +0.0025*max(|r|,1) per call.
    r.store(-0.012f, std::span<const float>(x), std::span<const float>(a));
    NISPS_ASSERT(r.size() == 1u);
    std::size_t evicted = r.decay_negatives();  // -0.012 + 0.0025 = -0.0095 > -0.01 → evict
    NISPS_EXPECT(evicted == 1u);
    NISPS_EXPECT(r.size() == 0u);

    // Positives are never decayed/evicted.
    r.store(1.f, std::span<const float>(x), std::span<const float>(a));
    evicted = r.decay_negatives();
    NISPS_EXPECT(evicted == 0u);
    NISPS_EXPECT(r.size() == 1u);
}

// -- compute_push_target --------------------------------------------------------

NISPS_TEST(geo_push_target_moves_away_from_centroid) {
    nisps::Rng rng(7ull);
    std::array<float, kNOut> neg{};
    std::array<float, kNOut> mean{};
    std::array<float, kNOut> target{};
    for (std::size_t j = 0; j < kNOut; ++j) {
        neg[j]  = 0.6f;
        mean[j] = 0.4f;  // dir = +0.2 per dim → push increases values
    }
    const float step = nisps::ml::geo_push_step(-1.f);  // clamp(1,0.25,1)*0.5 = 0.5
    NISPS_EXPECT_NEAR(step, 0.5f, 1e-7);
    nisps::ml::compute_push_target(neg, mean, {}, step, rng, target);
    for (std::size_t j = 0; j < kNOut; ++j) {
        NISPS_EXPECT(target[j] > neg[j]);   // strictly away from the centroid
        NISPS_EXPECT(target[j] <= 1.f);
    }

    // Taper: a far-away negative moves LESS than a near one for the same step.
    std::array<float, kNOut> mean_far{};
    std::array<float, kNOut> target_far{};
    for (std::size_t j = 0; j < kNOut; ++j) mean_far[j] = 0.0f;  // larger len
    nisps::ml::compute_push_target(neg, mean_far, {}, step, rng, target_far);
    NISPS_EXPECT((target_far[0] - neg[0]) < (target[0] - neg[0]));
}

NISPS_TEST(geo_push_respects_active_mask_and_clamps) {
    nisps::Rng rng(7ull);
    std::array<float, kNOut> neg{};
    std::array<float, kNOut> mean{};
    std::array<float, kNOut> target{};
    for (std::size_t j = 0; j < kNOut; ++j) {
        neg[j]  = 0.99f;
        mean[j] = 0.01f;
    }
    std::array<std::uint8_t, kNOut> mask{1u, 0u, 1u, 0u, 1u, 0u};
    nisps::ml::compute_push_target(neg, mean, mask, 0.5f, rng, target);
    for (std::size_t j = 0; j < kNOut; ++j) {
        if (mask[j]) {
            NISPS_EXPECT(target[j] >= neg[j]);  // pushed (and clamped at 1)
            NISPS_EXPECT(target[j] <= 1.f);
        } else {
            NISPS_EXPECT(target[j] == neg[j]);  // frozen dim untouched
        }
    }
}

// -- controller end-to-end ------------------------------------------------------

NISPS_TEST(geo_dislike_cold_start_then_push) {
    GeoMLP m(42ull);
    m.draw_weights(0.5f);
    GeoFB fb(42ull ^ 0xFEEDBACC0DEull);
    NISPS_ASSERT(fb.avoid_style() == AvoidStyle::Geometric);  // the P3 default

    set_inputs(m, 0.25f, 0.75f);
    m.process();

    // Cold start: no positives yet → negative-LR fallback.
    auto before = m.get_weights();
    std::array<float, GeoMLP::weight_count()> snap{};
    for (std::size_t i = 0; i < snap.size(); ++i) snap[i] = before[i];

    // With the heard action == the net's own output the MSE derivative is
    // zero, so the fallback is INERT — the conservative cold start the ADR
    // mandates (never destabilise before any positives exist).
    const FeedbackAction a1 = fb.on_down(m, {}, 0.1f, 0.5f, {});
    NISPS_EXPECT(a1 == FeedbackAction::GeometricColdStart);
    NISPS_EXPECT(fb.negative_count() == 1u);
    NISPS_EXPECT(fb.dislike_multiplier() == 2u);
    {
        auto after = m.get_weights();
        for (std::size_t i = 0; i < snap.size(); ++i) {
            NISPS_ASSERT(after[i] == snap[i]);
        }
    }

    // When the HEARD action differs from the net's raw output (the real
    // browser/firmware case — the user hears the post-pipeline vector), the
    // negative-LR fallback trains AWAY from it: weights move.
    std::array<float, kNOut> heard{};
    {
        auto outs = m.outputs();
        for (std::size_t j = 0; j < kNOut; ++j) {
            heard[j] = (outs[j] < 0.5f) ? outs[j] + 0.2f : outs[j] - 0.2f;
        }
    }
    const FeedbackAction a1b = fb.on_down(m, heard, 0.1f, 0.5f, {});
    NISPS_EXPECT(a1b == FeedbackAction::GeometricColdStart);
    bool moved = false;
    {
        auto after = m.get_weights();
        for (std::size_t i = 0; i < snap.size(); ++i) {
            if (after[i] != snap[i]) { moved = true; break; }
        }
    }
    NISPS_EXPECT(moved);

    // Feed positives via the like path, then dislike → geometric push.
    set_inputs(m, 0.2f, 0.2f);
    m.process();
    NISPS_EXPECT(fb.on_up(m) == FeedbackAction::LikeStore);
    set_inputs(m, 0.8f, 0.8f);
    m.process();
    NISPS_EXPECT(fb.on_up(m) == FeedbackAction::LikeStore);
    NISPS_EXPECT(fb.positive_count() == 2u);

    set_inputs(m, 0.25f, 0.75f);
    m.process();
    const FeedbackAction a2 = fb.on_down(m, {}, 0.1f, 0.5f, {});
    NISPS_EXPECT(a2 == FeedbackAction::GeometricPush);
    NISPS_EXPECT(!fb.exploring());
    NISPS_EXPECT(!fb.learning_paused());
}

NISPS_TEST(geo_dislike_deterministic_under_fixed_seed) {
    auto run = [](std::span<float> out_weights) {
        GeoMLP m(123ull);
        m.draw_weights(0.6f);
        GeoFB fb(456ull);
        set_inputs(m, 0.3f, 0.3f);
        m.process();
        fb.on_up(m);                       // positive
        set_inputs(m, 0.31f, 0.31f);
        m.process();
        fb.on_down(m, {}, 0.1f, 0.5f, {}); // geometric push
        fb.on_down(m, {}, 0.1f, 0.5f, {}); // deepen + push again
        auto w = m.get_weights();
        for (std::size_t i = 0; i < w.size(); ++i) out_weights[i] = w[i];
    };
    std::array<float, GeoMLP::weight_count()> w1{}, w2{};
    run(w1);
    run(w2);
    for (std::size_t i = 0; i < w1.size(); ++i) {
        NISPS_ASSERT(w1[i] == w2[i]);
    }
}

NISPS_TEST(geo_dislike_diffuse_style_preserves_legacy_path) {
    GeoMLP m(9ull);
    GeoFB fb(9ull);
    fb.set_avoid_style(AvoidStyle::Diffuse);
    set_inputs(m, 0.5f, 0.5f);
    m.process();
    const FeedbackAction a = fb.on_down(m, {}, 0.1f, 0.5f, {});
    NISPS_EXPECT(a == FeedbackAction::AvoidPerturb);
    NISPS_EXPECT(fb.replay_size() == 0u);  // diffuse touches no replay
}
