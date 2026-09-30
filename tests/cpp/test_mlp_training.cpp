// tests/cpp/test_mlp_training.cpp — convergence test on XOR.
//
// XOR is the classic minimum non-linear problem: a 2-layer linear net
// cannot solve it; an MLP with one hidden layer (and a non-linear
// activation) can. Our 4-layer MLP with sigmoid output is more than enough.
//
// We check loss < 0.01 within a generous iteration budget. If this test
// regresses to taking >1000 iterations, something is wrong with the
// gradient or weight-update path.

#include <array>
#include <cmath>

#include "test_helpers.hpp"

#include "../../nisps/ml/mlp.hpp"

namespace {

NISPS_TEST(mlp_xor_converges) {
    // Modest network: 2 inputs, [4, 4, 4] hidden, 1 output.
    using M = nisps::ml::MLP<2, 4, 4, 4, 1, 4, 1024>;
    M m(7ull);
    m.draw_weights(1.f);  // Xavier-ish; needed for sigmoid output to start reasonable

    // XOR truth table.
    std::array<std::array<float, 2>, 4> X = {{
        {0.f, 0.f},
        {0.f, 1.f},
        {1.f, 0.f},
        {1.f, 1.f},
    }};
    std::array<std::array<float, 1>, 4> Y = {{
        {0.f},
        {1.f},
        {1.f},
        {0.f},
    }};

    for (std::size_t i = 0; i < 4u; ++i) {
        m.add_example(std::span<const float>(X[i]), std::span<const float>(Y[i]));
    }
    NISPS_EXPECT(m.example_count() == 4u);

    // Train. Higher LR + more iterations is fine — the test is "did it
    // converge AT ALL within a generous budget".
    const float final_loss = m.train(/*lr=*/0.5f, /*max_iter=*/2000u, /*min_err=*/0.01f);
    NISPS_EXPECT(final_loss < 0.01f);

    // Sanity: outputs should be near labels for each input.
    for (std::size_t i = 0; i < 4u; ++i) {
        m.set_input(0, X[i][0]);
        m.set_input(1, X[i][1]);
        m.process();
        const float o = m.outputs()[0];
        NISPS_EXPECT_NEAR(o, Y[i][0], 0.2);
    }

    // Loss history should record at least one entry.
    NISPS_EXPECT(m.loss_history().size() >= 1u);
}

// The loss history is the ONLY on-device record of how a fit went (firmware)
// and the source the browser's training-health panel reads through
// `nisps_ml_loss_history` (simplification-plan §6.5e). Pin its contract:
// one entry per iteration actually run, last entry == the value train()
// returned, and a fresh run replaces rather than appends.
NISPS_TEST(mlp_loss_history_records_every_iteration) {
    using M = nisps::ml::MLP<2, 4, 4, 4, 1, 4, 64>;
    M m(11ull);
    m.draw_weights(1.f);

    std::array<float, 2> x{0.25f, 0.75f};
    std::array<float, 1> y{0.9f};
    m.add_example(std::span<const float>(x), std::span<const float>(y));

    // min_err = 0 ⇒ the early-out never fires, so we run exactly max_iter.
    const float loss = m.train(/*lr=*/0.2f, /*max_iter=*/12u, /*min_err=*/0.f);
    NISPS_EXPECT(m.loss_history().size() == 12u);
    NISPS_EXPECT_NEAR(m.loss_history()[11], loss, 1e-6);
    // A real fit descends.
    NISPS_EXPECT(m.loss_history()[11] < m.loss_history()[0]);

    // A second run REPLACES the curve (it describes exactly one training run).
    m.train(/*lr=*/0.2f, /*max_iter=*/3u, /*min_err=*/0.f);
    NISPS_EXPECT(m.loss_history().size() == 3u);

    // The single-step geometric-dislike path does NOT record — a dislike must
    // not overwrite the last fit's curve with a 1-point one.
    std::array<float, 1> target{0.1f};
    m.train_targets(std::span<const float>(x), std::span<const float>(target), 0.05f);
    NISPS_EXPECT(m.loss_history().size() == 3u);

    // Early convergence truncates: an absurd min_err stops after iteration 1.
    m.train(/*lr=*/0.2f, /*max_iter=*/50u, /*min_err=*/1e9f);
    NISPS_EXPECT(m.loss_history().size() == 1u);

    // Bounded by the storage cap, never past it.
    M capped(11ull);
    capped.add_example(std::span<const float>(x), std::span<const float>(y));
    capped.train(/*lr=*/0.2f, /*max_iter=*/200u, /*min_err=*/0.f);
    NISPS_EXPECT(capped.loss_history().size() == 64u);
}

NISPS_TEST(mlp_train_with_no_examples_returns_zero) {
    using M = nisps::ml::MLP<2, 4, 4, 4, 1, 4, 8>;
    M m(0ull);
    const float loss = m.train(0.5f, 100u, 0.001f);
    NISPS_EXPECT(loss == 0.f);
}

NISPS_TEST(mlp_clear_examples_works) {
    using M = nisps::ml::MLP<2, 4, 4, 4, 1, 4, 8>;
    M m(0ull);
    std::array<float, 2> f{0.f, 1.f};
    std::array<float, 1> l{0.5f};
    m.add_example(std::span<const float>(f), std::span<const float>(l));
    NISPS_EXPECT(m.example_count() == 1u);
    m.clear_examples();
    NISPS_EXPECT(m.example_count() == 0u);
}

NISPS_TEST(mlp_dataset_ring_buffer_evicts_oldest) {
    // NMaxExamples=4, add 6 examples; oldest 2 should be evicted.
    using M = nisps::ml::MLP<1, 2, 2, 2, 1, 4, 8>;
    M m(0ull);
    for (int i = 0; i < 6; ++i) {
        std::array<float, 1> f{static_cast<float>(i)};
        std::array<float, 1> l{static_cast<float>(i) * 0.1f};
        m.add_example(std::span<const float>(f), std::span<const float>(l));
    }
    NISPS_EXPECT(m.example_count() == 4u);
}

// ---------------------------------------------------------------------------
// OptimConfig (runtime RMSProp settings) and the saturated step cap.
//
// The MLP scales each per-sample gradient by 1/N, so gradients are ~1e-3 and
// RMSProp's step is min(lr / sqrt(sq), max_adj_lr) * g: at the shipped cap of 1
// every lr from ~1e-3 up hits the cap on nearly every step, and training is
// plain SGD at rate 1 whatever lr says. These tests pin that (so nobody
// "tunes" lr and wonders why nothing moves) and pin that lifting the cap
// makes lr a real, normalised step.
// docs/specs/recon/findings-learning-does-little-2026-09-30.md
// ---------------------------------------------------------------------------

using Wide = nisps::ml::MLP<2, 10, 10, 14, 8, 16, 1024>;

float fit_loss(float lr, std::size_t iters, const nisps::ml::OptimConfig* optim) {
    Wide m(5ull);
    m.draw_weights(0.f);
    if (optim) m.set_optim(*optim);
    // 12 deterministic examples with awkward 8-D targets.
    for (std::size_t i = 0; i < 12u; ++i) {
        const float fi = static_cast<float>(i);
        const std::array<float, 2> x = {std::fmod(0.37f * fi + 0.11f, 1.f), std::fmod(0.61f * fi + 0.29f, 1.f)};
        std::array<float, 8> y{};
        for (std::size_t j = 0; j < 8u; ++j) {
            y[j] = 0.1f + 0.8f * std::fmod(0.173f * (fi + 1.f) * static_cast<float>(j + 1u), 1.f);
        }
        m.add_example(std::span<const float>(x), std::span<const float>(y));
    }
    return m.train(lr, iters, 0.f);
}

NISPS_TEST(optim_default_config_is_a_no_op) {
    // Setting the shipped defaults explicitly must not change one bit.
    const nisps::ml::OptimConfig shipped{};
    const nisps::ml::OptimConfig rebuilt = nisps::ml::OptimConfig::make(
        nisps::ml::kRmsPropDecay, nisps::ml::kRmsPropEpsilon, nisps::ml::kGradClip, nisps::ml::kMaxAdjustedLr);
    NISPS_EXPECT(fit_loss(1.f, 50u, nullptr) == fit_loss(1.f, 50u, &shipped));
    NISPS_EXPECT(fit_loss(1.f, 50u, nullptr) == fit_loss(1.f, 50u, &rebuilt));
}

NISPS_TEST(optim_learning_rate_is_nearly_inert_at_the_shipped_cap) {
    const float at_1    = fit_loss(1.f,    300u, nullptr);
    const float at_p01  = fit_loss(0.01f,  300u, nullptr);
    const float at_p001 = fit_loss(0.001f, 300u, nullptr);
    // A 1000x change in lr moves the loss by well under 5%.
    NISPS_EXPECT(std::fabs(at_p01 - at_1) < 0.05f * at_1);
    NISPS_EXPECT(std::fabs(at_p001 - at_1) < 0.05f * at_1);
}

NISPS_TEST(optim_lifting_the_cap_makes_learning_rate_real) {
    const nisps::ml::OptimConfig uncapped =
        nisps::ml::OptimConfig::make(nisps::ml::kRmsPropDecay, nisps::ml::kRmsPropEpsilon,
                                     nisps::ml::kGradClip, 1.0e6f);
    const float shipped = fit_loss(1.f, 300u, nullptr);
    const float normalised = fit_loss(0.01f, 300u, &uncapped);
    // A normalised step fits the same examples far better...
    NISPS_EXPECT(normalised < 0.5f * shipped);
    // ...and lr now matters: 100x higher is a genuinely different result.
    NISPS_EXPECT(std::fabs(fit_loss(1.f, 300u, &uncapped) - normalised) > 0.05f * normalised);
}

}  // namespace
