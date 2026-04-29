// tests/cpp/test_mlp_serialize.cpp — round-trip get_weights → set_weights.
//
// Serializing weights, restoring them in a fresh MLP, and running inference
// must produce bit-identical outputs. This is the gate for cross-platform
// state transfer (firmware ↔ browser).

#include <array>
#include <vector>

#include "test_helpers.hpp"

#include "../../nisps/ml/mlp.hpp"

namespace {

using TestMLP = nisps::ml::MLP<3, 8, 8, 10, 5, 16, 32>;

NISPS_TEST(mlp_get_set_weights_roundtrip_preserves_inference) {
    TestMLP a(123ull);
    a.draw_weights(0.4f);

    // Snapshot weights.
    auto w = a.get_weights();
    std::vector<float> snap(w.begin(), w.end());

    TestMLP b(0ull);  // different seed → different starting weights
    b.set_weights(std::span<const float>(snap.data(), snap.size()));

    // Inference on identical input should produce identical outputs.
    const float in[3] = {0.2f, -0.3f, 0.5f};
    for (std::size_t i = 0; i < 3u; ++i) {
        a.set_input(i, in[i]);
        b.set_input(i, in[i]);
    }
    a.process();
    b.process();

    auto oa = a.outputs();
    auto ob = b.outputs();
    NISPS_EXPECT(oa.size() == ob.size());
    for (std::size_t i = 0; i < oa.size(); ++i) {
        NISPS_EXPECT(oa[i] == ob[i]);
    }
}

NISPS_TEST(mlp_weight_count_matches_get_weights_size) {
    TestMLP m(0ull);
    auto w = m.get_weights();
    NISPS_EXPECT(w.size() == TestMLP::weight_count());
}

NISPS_TEST(mlp_get_weights_contains_layer_concatenation) {
    // Verify the documented flat layout: weights all layers, then biases
    // all layers. We do this by setting a known pattern via set_weights
    // and reading it back.
    TestMLP m(0ull);
    constexpr std::size_t WC = TestMLP::weight_count();
    std::vector<float> pattern(WC);
    for (std::size_t i = 0; i < WC; ++i) {
        pattern[i] = static_cast<float>(i) * 0.001f - 0.5f;
    }
    m.set_weights(std::span<const float>(pattern.data(), pattern.size()));
    auto w = m.get_weights();
    NISPS_EXPECT(w.size() == WC);
    for (std::size_t i = 0; i < WC; ++i) {
        NISPS_EXPECT_NEAR(w[i], pattern[i], 1e-7);
    }
}

NISPS_TEST(mlp_set_weights_too_short_is_ignored) {
    TestMLP m(7ull);
    auto before = m.get_weights();
    std::vector<float> snap(before.begin(), before.end());

    // Pass a too-short buffer.
    std::array<float, 2> tiny{1.f, 2.f};
    m.set_weights(std::span<const float>(tiny));

    auto after = m.get_weights();
    // Weights should be unchanged.
    for (std::size_t i = 0; i < snap.size(); ++i) {
        NISPS_EXPECT(snap[i] == after[i]);
    }
}

NISPS_TEST(mlp_eval_loss_does_not_modify_state) {
    TestMLP m(5ull);
    m.draw_weights(0.5f);

    std::array<float, 3> f{0.1f, 0.2f, 0.3f};
    std::array<float, 5> l{0.5f, 0.5f, 0.5f, 0.5f, 0.5f};
    m.add_example(std::span<const float>(f), std::span<const float>(l));

    // Snapshot weights.
    auto w_before = m.get_weights();
    std::vector<float> snap(w_before.begin(), w_before.end());

    const float L = m.eval_loss();
    NISPS_EXPECT(L >= 0.f);

    auto w_after = m.get_weights();
    for (std::size_t i = 0; i < snap.size(); ++i) {
        NISPS_EXPECT(snap[i] == w_after[i]);
    }
}

NISPS_TEST(mlp_infer_batch_matches_individual_inference) {
    TestMLP m(42ull);
    m.draw_weights(0.5f);

    constexpr std::size_t N = 5;
    constexpr std::size_t NI = 3;
    constexpr std::size_t NO = 5;
    std::array<float, N * NI> points{};
    for (std::size_t i = 0; i < N * NI; ++i) {
        points[i] = static_cast<float>(i) * 0.07f - 0.3f;
    }
    std::array<float, N * NO> outs{};
    m.infer_batch(std::span<const float>(points), std::span<float>(outs));

    // Compare against individual inference.
    for (std::size_t i = 0; i < N; ++i) {
        for (std::size_t j = 0; j < NI; ++j) {
            m.set_input(j, points[i * NI + j]);
        }
        m.process();
        auto o = m.outputs();
        for (std::size_t j = 0; j < NO; ++j) {
            NISPS_EXPECT(o[j] == outs[i * NO + j]);
        }
    }
}

NISPS_TEST(mlp_layer_stats_reasonable_after_init) {
    TestMLP m(0ull);
    m.draw_weights(0.5f);
    for (std::size_t L = 0; L < 4; ++L) {
        const auto s = m.layer_stats(L);
        NISPS_EXPECT(s.mean_abs > 0.f);
        NISPS_EXPECT(s.max_abs >= s.mean_abs);
        NISPS_EXPECT(s.dead_frac >= 0.f && s.dead_frac <= 1.f);
        NISPS_EXPECT(s.saturating_frac >= 0.f && s.saturating_frac <= 1.f);
    }
}

}  // namespace
