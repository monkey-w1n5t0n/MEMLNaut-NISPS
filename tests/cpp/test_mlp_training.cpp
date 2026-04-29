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

}  // namespace
