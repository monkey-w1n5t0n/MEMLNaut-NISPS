// tests/cpp/test_mlp_loss.cpp — regression test for the meml-ues
// double-scaling bug.
//
// Setup: one training example (label = current network output exactly).
// Expected loss = 0.
//
// Then: one example with label = output + small_delta.
// Expected loss = (1/NOut) * sum(small_delta^2). NOT scaled additionally
// by 1/N (here N=1 so any extra 1/N would still be 1, but the per-element
// derivative path is what would expose double-scaling).
//
// We compare the value reported by `train()` after a single iteration
// (with lr=0 — so no weight update — but the loss should be reported)
// against the expected formula.

#include <array>
#include <cmath>

#include "test_helpers.hpp"

#include "../../nisps/ml/loss.hpp"
#include "../../nisps/ml/mlp.hpp"

namespace {

// Direct test of mse_per_sample.
NISPS_TEST(mse_per_sample_matches_formula) {
    std::array<float, 4> label = {0.5f, 0.25f, 0.75f, 0.f};
    std::array<float, 4> pred  = {0.4f, 0.30f, 0.70f, 0.1f};
    std::array<float, 4> deriv{};

    const float l = nisps::ml::mse_per_sample(
        std::span<const float>(label),
        std::span<const float>(pred),
        std::span<float>(deriv));

    // (0.1^2 + 0.05^2 + 0.05^2 + 0.1^2) / 4 = (0.01 + 0.0025 + 0.0025 + 0.01) / 4 = 0.025/4
    const float expected = (0.01f + 0.0025f + 0.0025f + 0.01f) * 0.25f;
    NISPS_EXPECT_NEAR(l, expected, 1e-7);

    // Derivatives: -(2/N) * (label - pred). For element 0: -(2/4) * (0.5 - 0.4) = -0.05
    NISPS_EXPECT_NEAR(deriv[0], -0.05f, 1e-7);
    NISPS_EXPECT_NEAR(deriv[3],  0.05f, 1e-7);  // -(2/4) * (0 - 0.1) = +0.05
}

NISPS_TEST(mlp_train_loss_not_double_scaled_single_sample) {
    // 1 example. The reported epoch_loss should equal the per-sample MSE
    // exactly (with sample_weight=1/N=1.0). If the legacy double-scaling
    // bug crept in, we'd see it scaled by an extra 1/1 = 1.0 (invisible)
    // — so we use TWO samples and check the relationship.
    using M = nisps::ml::MLP<1, 2, 2, 2, 2, 4, 8>;
    M m(11ull);
    m.draw_weights(0.5f);

    std::array<float, 1> f1{0.3f};
    std::array<float, 2> l1{0.7f, 0.2f};
    std::array<float, 1> f2{0.6f};
    std::array<float, 2> l2{0.1f, 0.9f};
    m.add_example(std::span<const float>(f1), std::span<const float>(l1));
    m.add_example(std::span<const float>(f2), std::span<const float>(l2));

    // Compute the expected loss manually: average of per-sample MSE.
    // Run inference on each, get pred, compute MSE manually.
    auto compute_mse = [&](std::array<float, 1>& f, std::array<float, 2>& lab) {
        m.set_input(0, f[0]);
        m.process();
        auto out = m.outputs();
        float sse = 0.f;
        for (std::size_t j = 0; j < 2u; ++j) {
            const float d = lab[j] - out[j];
            sse += d * d;
        }
        return sse * 0.5f;  // (1/NOut) sum of squared diff
    };
    const float mse1 = compute_mse(f1, l1);
    const float mse2 = compute_mse(f2, l2);
    const float expected_epoch_loss = 0.5f * (mse1 + mse2);  // avg over 2 samples

    // train() with lr=0 leaves weights unchanged but reports the per-iter
    // loss. We use max_iter=1 to grab exactly one epoch_loss.
    const float reported = m.train(/*lr=*/0.f, /*max_iter=*/1u, /*min_err=*/-1.f);

    NISPS_EXPECT_NEAR(reported, expected_epoch_loss, 1e-5);

    // If the legacy bug were present, reported would be expected/2 (extra
    // 1/N multiplication). That would fail at 1e-5 tolerance for any
    // non-tiny mse. Sanity-confirm:
    NISPS_EXPECT(reported > expected_epoch_loss * 0.9f);
}

NISPS_TEST(mlp_train_with_sample_weights_uses_them) {
    using M = nisps::ml::MLP<1, 2, 2, 2, 2, 4, 8>;
    M m(13ull);
    m.draw_weights(0.5f);

    std::array<float, 1> f1{0.1f};
    std::array<float, 2> l1{0.5f, 0.5f};
    std::array<float, 1> f2{0.9f};
    std::array<float, 2> l2{0.5f, 0.5f};
    m.add_example(std::span<const float>(f1), std::span<const float>(l1));
    m.add_example(std::span<const float>(f2), std::span<const float>(l2));

    // Concentrate all weight on sample 0.
    std::array<float, 2> sw{1.f, 0.f};

    auto compute_mse = [&](std::array<float, 1>& f, std::array<float, 2>& lab) {
        m.set_input(0, f[0]);
        m.process();
        auto out = m.outputs();
        float sse = 0.f;
        for (std::size_t j = 0; j < 2u; ++j) {
            const float d = lab[j] - out[j];
            sse += d * d;
        }
        return sse * 0.5f;
    };
    const float mse1 = compute_mse(f1, l1);

    const float reported = m.train(0.f, 1u, -1.f, std::span<const float>(sw));
    // Under uniform weights this would be 0.5*(mse1+mse2). With sw={1,0}
    // it should equal mse1.
    NISPS_EXPECT_NEAR(reported, mse1, 1e-5);
}

}  // namespace
