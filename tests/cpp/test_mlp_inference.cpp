// tests/cpp/test_mlp_inference.cpp — verify that the forward pass computes
// the expected linear+activation chain. We construct an MLP with known
// weights via set_weights(), run inference, and compare against a hand-
// computed result.

#include <array>
#include <cmath>

#include "test_helpers.hpp"

#include "../../nisps/ml/mlp.hpp"

namespace {

using TinyMLP = nisps::ml::MLP<2, 2, 2, 2, 1, 8, 32>;

// Manually compute the forward pass using the same activation rules as the
// MLP. ReLU on hidden layers (leaky 0.01), sigmoid on output.
float manual_forward(float x0, float x1,
                     const std::array<float, 4>& w0, const std::array<float, 2>& b0,
                     const std::array<float, 4>& w1, const std::array<float, 2>& b1,
                     const std::array<float, 4>& w2, const std::array<float, 2>& b2,
                     const std::array<float, 2>& w3, const std::array<float, 1>& b3) {
    auto leaky_relu = [](float v) { return v > 0.f ? v : 0.01f * v; };
    auto sig        = [](float v) {
        if (v >  40.f) return 1.f;
        if (v < -40.f) return 0.f;
        return 1.f / (1.f + std::exp(-v));
    };

    // Layer 0: 2 → 2, ReLU
    float a0_0 = leaky_relu(b0[0] + w0[0] * x0 + w0[1] * x1);
    float a0_1 = leaky_relu(b0[1] + w0[2] * x0 + w0[3] * x1);
    // Layer 1: 2 → 2, ReLU
    float a1_0 = leaky_relu(b1[0] + w1[0] * a0_0 + w1[1] * a0_1);
    float a1_1 = leaky_relu(b1[1] + w1[2] * a0_0 + w1[3] * a0_1);
    // Layer 2: 2 → 2, ReLU
    float a2_0 = leaky_relu(b2[0] + w2[0] * a1_0 + w2[1] * a1_1);
    float a2_1 = leaky_relu(b2[1] + w2[2] * a1_0 + w2[3] * a1_1);
    // Layer 3: 2 → 1, Sigmoid
    return sig(b3[0] + w3[0] * a2_0 + w3[1] * a2_1);
}

NISPS_TEST(mlp_forward_matches_handcomputed) {
    TinyMLP m(0ull);

    // Set weights to a known pattern: first weight 0.5, second 0.25, etc.
    // (we construct a flat buffer matching the documented layout).
    constexpr std::size_t WC = TinyMLP::weight_count();
    std::array<float, WC> flat{};
    // Weights layer by layer:
    // L0: 4 weights; L1: 4; L2: 4; L3: 2 → 14 weights
    // Biases: L0: 2; L1: 2; L2: 2; L3: 1 → 7 biases
    // Total: 21 (sanity check)
    NISPS_EXPECT(WC == 21u);

    float val = 0.1f;
    for (std::size_t i = 0; i < WC; ++i) {
        flat[i] = val;
        val += 0.05f;
        if (val > 0.7f) val = -0.6f;
    }
    m.set_weights(std::span<const float>(flat));

    // Extract layer slices for the manual check.
    std::array<float, 4> w0{flat[0],  flat[1],  flat[2],  flat[3]};
    std::array<float, 4> w1{flat[4],  flat[5],  flat[6],  flat[7]};
    std::array<float, 4> w2{flat[8],  flat[9],  flat[10], flat[11]};
    std::array<float, 2> w3{flat[12], flat[13]};
    std::array<float, 2> b0{flat[14], flat[15]};
    std::array<float, 2> b1{flat[16], flat[17]};
    std::array<float, 2> b2{flat[18], flat[19]};
    std::array<float, 1> b3{flat[20]};

    const float x0 = 0.3f, x1 = 0.7f;
    m.set_input(0, x0);
    m.set_input(1, x1);
    m.process();
    auto out = m.outputs();
    NISPS_EXPECT(out.size() == 1u);

    const float expected = manual_forward(x0, x1, w0, b0, w1, b1, w2, b2, w3, b3);
    NISPS_EXPECT_NEAR(out[0], expected, 1e-5);
}

NISPS_TEST(mlp_forward_outputs_in_unit_range) {
    // Sigmoid output guarantees [0, 1].
    using M = nisps::ml::MLP<3, 10, 10, 14, 126, 16, 64>;
    M m(42ull);
    m.draw_weights(0.5f);
    for (int t = 0; t < 100; ++t) {
        m.set_input(0, static_cast<float>(t) * 0.013f);
        m.set_input(1, static_cast<float>(t) * 0.027f - 0.5f);
        m.set_input(2, static_cast<float>(t) * 0.041f);
        m.process();
        for (float v : m.outputs()) {
            NISPS_EXPECT(v >= 0.f);
            NISPS_EXPECT(v <= 1.f);
        }
    }
}

NISPS_TEST(mlp_set_input_out_of_range_silently_ignored) {
    TinyMLP m(0ull);
    // Should not crash; index 99 simply does nothing.
    m.set_input(99u, 1.234f);
    m.set_input(0, 0.5f);
    m.set_input(1, 0.5f);
    m.process();
    auto out = m.outputs();
    NISPS_EXPECT(out.size() == 1u);
}

}  // namespace
