// tests/cpp/test_mlp_rl.cpp — verify draw_weights and move_weights
// behavior:
//   - draw_weights with spread=0 vs spread=1 produces different weight
//     magnitude regimes.
//   - move_weights perturbs all weights in unmasked layers.
//   - move_weights with output_pin_mask preserves the corresponding
//     final-layer weight rows AND biases exactly.

#include <array>
#include <cstdint>

#include "test_helpers.hpp"

#include "../../nisps/ml/mlp.hpp"

namespace {

using SmallMLP = nisps::ml::MLP<2, 4, 4, 4, 6, 8, 32>;

NISPS_TEST(mlp_draw_weights_spread_zero_full_range) {
    SmallMLP m(0ull);
    m.draw_weights(0.f);
    auto w = m.get_weights();
    float maxabs = 0.f;
    for (float v : w) {
        const float a = v >= 0.f ? v : -v;
        if (a > maxabs) maxabs = a;
    }
    // spread=0 ⇒ U[-1,1] (no Xavier scale). Most weights will fall in
    // (0.5, 1.0) band — we expect at least one above 0.5.
    NISPS_EXPECT(maxabs > 0.5f);
}

NISPS_TEST(mlp_draw_weights_spread_one_xavier_compressed) {
    SmallMLP m(0ull);
    m.draw_weights(1.f);
    auto w = m.get_weights();
    float maxabs = 0.f;
    for (float v : w) {
        const float a = v >= 0.f ? v : -v;
        if (a > maxabs) maxabs = a;
    }
    // Xavier scale: 1/sqrt(fan_in). Smallest fan_in = 2 → scale ~0.707.
    // Largest weight magnitude bounded by that.
    NISPS_EXPECT(maxabs < 0.71f);
}

NISPS_TEST(mlp_move_weights_changes_unpinned_weights) {
    SmallMLP m(99ull);
    m.draw_weights(0.5f);

    // Snapshot weights.
    std::array<float, SmallMLP::weight_count()> before{};
    {
        auto w = m.get_weights();
        for (std::size_t i = 0; i < w.size(); ++i) before[i] = w[i];
    }

    m.move_weights(0.1f, 0.5f);

    auto after = m.get_weights();
    int distinct = 0;
    for (std::size_t i = 0; i < after.size(); ++i) {
        if (before[i] != after[i]) ++distinct;
    }
    // Most weights should have changed (gaussian noise + decay).
    NISPS_EXPECT(distinct > static_cast<int>(after.size()) / 2);
}

NISPS_TEST(mlp_move_weights_pin_mask_skips_final_outputs) {
    SmallMLP m(33ull);
    m.draw_weights(0.5f);

    auto w_before = m.get_weights();
    std::array<float, SmallMLP::weight_count()> before{};
    for (std::size_t i = 0; i < w_before.size(); ++i) before[i] = w_before[i];

    // NOut = 6. Pin nodes 0, 2, 4.
    std::array<std::uint8_t, 6> mask{1, 0, 1, 0, 1, 0};
    m.move_weights(0.1f, 0.5f, std::span<const std::uint8_t>(mask));

    auto after = m.get_weights();

    // Layout: weights = [L0(8) L1(16) L2(16) L3(24)] then biases [L0(4) L1(4) L2(4) L3(6)].
    constexpr std::size_t L0_W = 2*4;   // 8
    constexpr std::size_t L1_W = 4*4;   // 16
    constexpr std::size_t L2_W = 4*4;   // 16
    constexpr std::size_t L3_W = 4*6;   // 24
    constexpr std::size_t L3_W_OFF = L0_W + L1_W + L2_W;
    constexpr std::size_t BIAS_OFF = L0_W + L1_W + L2_W + L3_W;
    constexpr std::size_t L3_B_OFF = BIAS_OFF + 4 + 4 + 4;  // 76 + 0 → biases start

    // Final layer weights row-major: [node*4 + j] for j ∈ [0,4).
    // Pinned nodes 0, 2, 4 → rows 0, 2, 4 should be preserved.
    for (std::size_t node : {0u, 2u, 4u}) {
        for (std::size_t j = 0; j < 4u; ++j) {
            const std::size_t idx = L3_W_OFF + node * 4u + j;
            NISPS_EXPECT(before[idx] == after[idx]);
        }
        // Bias too.
        NISPS_EXPECT(before[L3_B_OFF + node] == after[L3_B_OFF + node]);
    }
    // Unpinned nodes 1, 3, 5 → rows changed (most weights distinct).
    int unpinned_changed = 0;
    for (std::size_t node : {1u, 3u, 5u}) {
        for (std::size_t j = 0; j < 4u; ++j) {
            const std::size_t idx = L3_W_OFF + node * 4u + j;
            if (before[idx] != after[idx]) ++unpinned_changed;
        }
    }
    // 12 unpinned weights; gaussian noise w/ stddev > 0 → almost all change.
    NISPS_EXPECT(unpinned_changed >= 10);
}

NISPS_TEST(mlp_draw_weights_clears_grad_accumulators) {
    // After draw_weights, calling train() shouldn't see stale gradients.
    // Smoke test: draw → train → loss should drop normally.
    using M = nisps::ml::MLP<2, 4, 4, 4, 1, 4, 64>;
    M m(0ull);
    m.draw_weights(0.5f);
    std::array<float, 2> f{0.3f, 0.7f};
    std::array<float, 1> l{0.5f};
    m.add_example(std::span<const float>(f), std::span<const float>(l));
    const float l1 = m.train(0.5f, 50u, -1.f);
    m.draw_weights(0.5f);
    const float l2 = m.train(0.5f, 50u, -1.f);
    // Both should be finite and >= 0. We don't assert about ordering; the
    // point is that no NaNs leak through stale grads.
    NISPS_EXPECT(l1 >= 0.f && l1 < 100.f);
    NISPS_EXPECT(l2 >= 0.f && l2 < 100.f);
}

}  // namespace
