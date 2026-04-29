// tests/cpp/test_mlp_init.cpp — exercises MLP construction, deterministic
// seeding, the spread parameter, and the static_assert that the class
// satisfies the MLEngine concept.

#include "test_helpers.hpp"

#include "../../nisps/core/concepts.hpp"
#include "../../nisps/ml/mlp.hpp"

namespace {

// Compact alias used across the test suite.
using SmallMLP = nisps::ml::MLP<2, 8, 8, 8, 4, 16, 64>;

// Hard ground-truth: the class satisfies MLEngine. Compile-time check.
static_assert(nisps::MLEngine<SmallMLP>,
              "MLP<...> must satisfy nisps::MLEngine concept");

NISPS_TEST(mlp_same_seed_same_init_weights) {
    SmallMLP a(123ull);
    SmallMLP b(123ull);

    auto wa = a.get_weights();
    auto wb = b.get_weights();
    NISPS_EXPECT(wa.size() == wb.size());
    for (std::size_t i = 0; i < wa.size(); ++i) {
        NISPS_EXPECT(wa[i] == wb[i]);
    }
}

NISPS_TEST(mlp_diff_seed_diff_init_weights) {
    SmallMLP a(1ull);
    SmallMLP b(2ull);

    auto wa = a.get_weights();
    auto wb = b.get_weights();
    int distinct = 0;
    for (std::size_t i = 0; i < wa.size(); ++i) {
        if (wa[i] != wb[i]) ++distinct;
    }
    // With ~200+ weights, almost all should differ.
    NISPS_EXPECT(distinct > static_cast<int>(wa.size()) / 2);
}

NISPS_TEST(mlp_seed_method_resets_rng) {
    SmallMLP a(5ull);
    a.seed(42ull);
    a.draw_weights(0.5f);

    SmallMLP b(99ull);
    b.seed(42ull);
    b.draw_weights(0.5f);

    auto wa = a.get_weights();
    auto wb = b.get_weights();
    for (std::size_t i = 0; i < wa.size(); ++i) {
        NISPS_EXPECT(wa[i] == wb[i]);
    }
}

NISPS_TEST(mlp_weight_count_matches_topology) {
    using M = nisps::ml::MLP<3, 10, 10, 14, 126>;
    // Layer fan_in*fan_out: 3*10 + 10*10 + 10*14 + 14*126 = 30+100+140+1764 = 2034
    // Biases: 10+10+14+126 = 160
    // Total: 2194
    NISPS_EXPECT(M::weight_count() == 2194u);
}

NISPS_TEST(mlp_spread_zero_uniform_in_minus_one_one_range) {
    // spread=0 → weights drawn from U[-1,1]. The max |w| should be ≤ 1.
    SmallMLP m(7ull);
    m.draw_weights(0.f);
    auto w = m.get_weights();
    float maxabs = 0.f;
    for (float v : w) {
        const float a = v >= 0.f ? v : -v;
        if (a > maxabs) maxabs = a;
    }
    NISPS_EXPECT(maxabs <= 1.f);
}

NISPS_TEST(mlp_spread_one_xavier_smaller_range) {
    // spread=1 → weights scaled by 1/sqrt(fan_in). For fan_in≥2, weights
    // should be strictly smaller in magnitude than the spread=0 case.
    SmallMLP m(7ull);
    m.draw_weights(1.f);
    auto w = m.get_weights();
    float maxabs = 0.f;
    for (float v : w) {
        const float a = v >= 0.f ? v : -v;
        if (a > maxabs) maxabs = a;
    }
    // 1/sqrt(2) ≈ 0.707 — the smallest fan_in is 2 (input). So max possible
    // is ≈ 0.707 (drawn from rng_signed, which is < 1).
    NISPS_EXPECT(maxabs < 1.f);
}

}  // namespace
