// tests/cpp/test_mlp_geo_dislike.cpp — geometric dislike (one-core-engine P3;
// docs/adr/rl-feedback-design.md §2.1/§4/§6.1).
//
// Covers: replay dedup/deepen at radius 0.05, k-NN centroid selection with
// deterministic index tie-break, push direction sign (target moves AWAY from
// the liked centroid), cold-start posMemCount==0 fallback, parameterised replay
// dose/lifetime, solo/focus gating, and fixed-seed determinism.

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
    std::array<float, kCap>         age_ms{};
    std::size_t count = 0u;

    ReplayView view() {
        return ReplayView(in, act, rew, age_ms, kNIn, kNOut, kCap, count);
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

NISPS_TEST(replay_wall_clock_lifetime_and_evict) {
    RawReplay raw;
    auto r = raw.view();
    const float x[kNIn] = {0.1f, 0.1f};
    const float a[kNOut] = {};
    r.store(-1.f, std::span<const float>(x), std::span<const float>(a));
    NISPS_ASSERT(r.size() == 1u);
    std::size_t evicted = r.advance_negative_ages(2499.f, 2500.f);
    NISPS_EXPECT(evicted == 0u);
    NISPS_EXPECT(r.size() == 1u);
    NISPS_EXPECT_NEAR(r.age_ms(0), 2499.f, 1e-6);
    evicted = r.advance_negative_ages(1.f, 2500.f);
    NISPS_EXPECT(evicted == 1u);
    NISPS_EXPECT(r.size() == 0u);

    // Positives do not age or expire.
    r.store(1.f, std::span<const float>(x), std::span<const float>(a));
    evicted = r.advance_negative_ages(5000.f, 2500.f);
    NISPS_EXPECT(evicted == 0u);
    NISPS_EXPECT(r.size() == 1u);
    NISPS_EXPECT(r.age_ms(0) == 0.f);
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
    const float step = nisps::ml::geo_push_step(-1.f);  // clamp(1,0.25,1)*1.0 = 1.0
    NISPS_EXPECT_NEAR(step, 1.f, 1e-7);
    nisps::ml::compute_push_target(neg, mean, {}, step, /*have_positives=*/true, rng, target);
    for (std::size_t j = 0; j < kNOut; ++j) {
        NISPS_EXPECT(target[j] > neg[j]);   // strictly away from the centroid
        NISPS_EXPECT(target[j] <= 1.f);
    }

    // NO TAPER (upstream e291192, InterfaceRL.tpp:724): distance from the
    // liked centroid must NOT shrink the push. The direction is a unit
    // vector either way, so a far-away negative is displaced exactly as far
    // as a near one — which is the case the deleted /(1+len) used to kill.
    // (Both are clamped at 1.0 here, so compare an unsaturated dim.)
    std::array<float, kNOut> near_neg{}, far_mean{}, near_mean{};
    std::array<float, kNOut> t_near{}, t_far{};
    for (std::size_t j = 0; j < kNOut; ++j) {
        near_neg[j]  = 0.5f;
        near_mean[j] = 0.49f;  // len ~= 0.024 across 6 dims
        far_mean[j]  = 0.0f;   // len ~= 1.22
    }
    nisps::ml::compute_push_target(near_neg, near_mean, {}, 0.1f, true, rng, t_near);
    nisps::ml::compute_push_target(near_neg, far_mean,  {}, 0.1f, true, rng, t_far);
    NISPS_EXPECT_NEAR(t_far[0] - near_neg[0], t_near[0] - near_neg[0], 1e-6);
}

// With nothing liked yet there is no centroid to push away from, so upstream
// pushes in a RANDOM direction per dim rather than doing nothing
// (`useRandom = !havePositives || ...`, InterfaceRL.tpp:745).
NISPS_TEST(geo_push_target_random_direction_when_no_positives) {
    nisps::Rng rng(11ull);
    std::array<float, kNOut> neg{}, mean{}, target{};
    for (std::size_t j = 0; j < kNOut; ++j) { neg[j] = 0.5f; mean[j] = 0.5f; }

    nisps::ml::compute_push_target(neg, mean, {}, 0.25f, /*have_positives=*/false,
                                   rng, target);
    bool any_moved = false, any_down = false, any_up = false;
    for (std::size_t j = 0; j < kNOut; ++j) {
        if (target[j] != neg[j]) any_moved = true;
        if (target[j] <  neg[j]) any_down  = true;
        if (target[j] >  neg[j]) any_up    = true;
        NISPS_EXPECT(target[j] >= 0.f && target[j] <= 1.f);
    }
    NISPS_EXPECT(any_moved);
    NISPS_EXPECT(any_down && any_up);  // per-dim signs, not one global direction
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
    nisps::ml::compute_push_target(neg, mean, mask, 0.5f, /*have_positives=*/true,
                                   rng, target);
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

    // Cold start: no positives yet. Since the 2026-07-25 re-base onto
    // upstream e291192 this is NOT a separate inert branch — it is the same
    // push, in a random direction because there is no centroid to move away
    // from. So a 'no' moves the mapping even before anything is liked, which
    // is exactly what upstream's comment at InterfaceRL.tpp:724 argues for.
    auto before = m.get_weights();
    std::array<float, GeoMLP::weight_count()> snap{};
    for (std::size_t i = 0; i < snap.size(); ++i) snap[i] = before[i];

    const FeedbackAction a1 = fb.on_down(m, {}, 0.1f, 0.5f, {});
    NISPS_EXPECT(a1 == FeedbackAction::GeometricColdStart);
    NISPS_EXPECT(fb.negative_count() == 1u);
    bool moved = false;
    {
        auto after = m.get_weights();
        for (std::size_t i = 0; i < snap.size(); ++i) {
            if (after[i] != snap[i]) { moved = true; break; }
        }
    }
    NISPS_EXPECT(moved);

    // The same holds when the HEARD action differs from the net's raw output
    // (the real browser/firmware case — the user hears the post-pipeline
    // vector), which used to be the ONLY case that moved anything.
    std::array<float, kNOut> heard{};
    {
        auto outs = m.outputs();
        for (std::size_t j = 0; j < kNOut; ++j) {
            heard[j] = (outs[j] < 0.5f) ? outs[j] + 0.2f : outs[j] - 0.2f;
        }
    }
    const FeedbackAction a1b = fb.on_down(m, heard, 0.1f, 0.5f, {});
    NISPS_EXPECT(a1b == FeedbackAction::GeometricColdStart);

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

NISPS_TEST(geo_dislike_replay_rate_and_lifetime_are_parameterised) {
    GeoMLP m(88ull);
    m.draw_weights(0.5f);
    GeoFB fb(99ull);
    NISPS_EXPECT(fb.geo_lr() == 0.001f);
    NISPS_EXPECT(fb.geo_update_hz() == 200.f);
    NISPS_EXPECT(fb.geo_lifetime_ms() == 2500.f);

    fb.set_geo_lr(0.002f);
    fb.set_geo_update_hz(20.f);
    fb.set_geo_lifetime_ms(100.f);
    set_inputs(m, 0.4f, 0.6f);
    m.process();
    fb.on_down(m, {}, 0.1f, 0.5f, {});  // one immediate update
    NISPS_ASSERT(fb.negative_count() == 1u);

    // 20 Hz gives one replay update per 50 ms. At 100 ms the rejection
    // expires after its second scheduled update.
    NISPS_EXPECT(fb.advance_geometric(m, 0.025f) == 0u);
    NISPS_EXPECT(fb.advance_geometric(m, 0.025f) == 1u);
    NISPS_EXPECT(fb.negative_count() == 1u);
    NISPS_EXPECT(fb.advance_geometric(m, 0.05f) == 1u);
    NISPS_EXPECT(fb.negative_count() == 0u);
    NISPS_EXPECT(fb.advance_geometric(m, 0.05f) == 0u);

    // Zero rate is an explicit one-shot mode: the press still updates once,
    // but no stale negative remains to affect a later press.
    fb.set_geo_update_hz(0.f);
    fb.on_down(m, {}, 0.1f, 0.5f, {});
    NISPS_EXPECT(fb.negative_count() == 0u);
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
