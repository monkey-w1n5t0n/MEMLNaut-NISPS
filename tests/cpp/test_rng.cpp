// tests/cpp/test_rng.cpp — verify deterministic seeding, range bounds, and
// reasonable statistical shape on the gaussian helper.

#include "test_helpers.hpp"
#include "../../nisps/core/rng.hpp"

NISPS_TEST(rng_deterministic_for_same_seed) {
    nisps::Rng a(42ull);
    nisps::Rng b(42ull);
    for (int i = 0; i < 1000; ++i) {
        NISPS_EXPECT(a.next_u64() == b.next_u64());
    }
}

NISPS_TEST(rng_diverges_for_different_seeds) {
    nisps::Rng a(0ull);
    nisps::Rng b(1ull);
    int distinct = 0;
    for (int i = 0; i < 100; ++i) {
        if (a.next_u64() != b.next_u64()) ++distinct;
    }
    // Should differ in nearly every draw (probability of collision ~ 2^-64).
    NISPS_EXPECT(distinct >= 99);
}

NISPS_TEST(rng_zero_seed_does_not_lock_up) {
    nisps::Rng r(0ull);
    // Pure xoshiro with all-zero state is degenerate; our splitmix64 fan-out
    // should prevent that. Confirm we get nonzero output.
    bool any_nonzero = false;
    for (int i = 0; i < 16; ++i) {
        if (r.next_u64() != 0ull) { any_nonzero = true; break; }
    }
    NISPS_EXPECT(any_nonzero);
}

NISPS_TEST(rng_uniform_in_unit_interval) {
    nisps::Rng r(7ull);
    for (int i = 0; i < 10000; ++i) {
        const float v = r.next_float_uniform();
        NISPS_EXPECT(v >= 0.f);
        NISPS_EXPECT(v < 1.f);
    }
}

NISPS_TEST(rng_signed_in_minus_plus) {
    nisps::Rng r(7ull);
    for (int i = 0; i < 10000; ++i) {
        const float v = r.next_float_signed();
        NISPS_EXPECT(v >= -1.f);
        NISPS_EXPECT(v <  1.f);
    }
}

NISPS_TEST(rng_uniform_mean_near_half) {
    nisps::Rng r(123ull);
    double sum = 0.0;
    constexpr int N = 100000;
    for (int i = 0; i < N; ++i) sum += r.next_float_uniform();
    const double mean = sum / N;
    NISPS_EXPECT_NEAR(mean, 0.5, 0.01);
}

NISPS_TEST(rng_gaussian_stddev_close_to_one) {
    nisps::Rng r(99ull);
    constexpr int N = 100000;
    double sum = 0.0, sq = 0.0;
    for (int i = 0; i < N; ++i) {
        const double v = r.next_float_gaussian(1.f);
        sum += v;
        sq  += v * v;
    }
    const double mean = sum / N;
    const double var  = sq / N - mean * mean;
    NISPS_EXPECT_NEAR(mean, 0.0, 0.05);
    // sum-of-three-uniforms gives variance exactly 1.0 in the limit.
    NISPS_EXPECT_NEAR(var, 1.0, 0.05);
}
