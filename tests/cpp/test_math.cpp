// tests/cpp/test_math.cpp — sanity check on clamping, sigmoid bounds, and
// curve catalog endpoint pinning.

#include "test_helpers.hpp"
#include "../../nisps/core/math.hpp"

NISPS_TEST(clamp01_bounds) {
    NISPS_EXPECT(nisps::clamp01(-1.f) == 0.f);
    NISPS_EXPECT(nisps::clamp01( 0.f) == 0.f);
    NISPS_EXPECT(nisps::clamp01( 0.5f) == 0.5f);
    NISPS_EXPECT(nisps::clamp01( 1.f) == 1.f);
    NISPS_EXPECT(nisps::clamp01( 2.f) == 1.f);
}

NISPS_TEST(fast_sigmoid_in_unit_range) {
    for (float x = -10.f; x <= 10.f; x += 0.5f) {
        const float y = nisps::fast_sigmoid(x);
        NISPS_EXPECT(y >= 0.f);
        NISPS_EXPECT(y <= 1.f);
    }
    // Center pinned.
    NISPS_EXPECT_NEAR(nisps::fast_sigmoid(0.f), 0.5f, 1e-6);
}

NISPS_TEST(fast_sigmoid_matches_exact_within_tolerance) {
    // Document that fast_sigmoid is within ~2% of exact_sigmoid on [-6, 6].
    for (float x = -6.f; x <= 6.f; x += 0.25f) {
        const float fy = nisps::fast_sigmoid(x);
        const float ey = nisps::exact_sigmoid(x);
        NISPS_EXPECT_NEAR(fy, ey, 0.02);
    }
}

NISPS_TEST(curve_endpoints_pinned) {
    // Every curve must map 0→0 and 1→1 exactly.
    using nisps::Curve;
    Curve curves[] = {Curve::linear, Curve::exp, Curve::log, Curve::square,
                      Curve::sqrt, Curve::sigmoid, Curve::cubic};
    for (Curve c : curves) {
        NISPS_EXPECT_NEAR(nisps::apply_curve(c, 0.f), 0.0, 1e-5);
        NISPS_EXPECT_NEAR(nisps::apply_curve(c, 1.f), 1.0, 1e-5);
    }
}

NISPS_TEST(curve_monotone_increasing) {
    using nisps::Curve;
    Curve curves[] = {Curve::linear, Curve::exp, Curve::log, Curve::square,
                      Curve::sqrt, Curve::sigmoid, Curve::cubic};
    for (Curve c : curves) {
        float prev = nisps::apply_curve(c, 0.f);
        for (float x = 0.05f; x <= 1.f + 1e-6f; x += 0.05f) {
            const float y = nisps::apply_curve(c, x);
            NISPS_EXPECT(y >= prev - 1e-6f);   // non-decreasing
            prev = y;
        }
    }
}
