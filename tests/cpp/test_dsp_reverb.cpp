// tests/cpp/test_dsp_reverb.cpp — bounded-output sanity for reverb sections.

#include <cmath>

#include "test_helpers.hpp"
#include "../../nisps/dsp/reverb.hpp"

NISPS_TEST(allpass_finite_and_bounded) {
    nisps::AllPass<256> ap;
    for (int n = 0; n < 10000; ++n) {
        const float x = std::sin(static_cast<float>(n) * 0.05f) * 0.5f;
        const float y = ap.process(x, 137u, 0.7f);
        NISPS_EXPECT(std::isfinite(y));
        NISPS_EXPECT(std::fabs(y) < 50.f);  // generous bound
    }
}

NISPS_TEST(comb_decays_after_impulse) {
    nisps::Comb<256> c;
    c.process(1.f, 100u, 0.5f);  // impulse
    float max_after = 0.f;
    for (int n = 1; n < 1000; ++n) {
        const float y = c.process(0.f, 100u, 0.5f);
        if (std::fabs(y) > max_after) max_after = std::fabs(y);
        NISPS_EXPECT(std::isfinite(y));
    }
    NISPS_EXPECT(max_after < 5.f);
}

NISPS_TEST(lpcomb_finite_with_lp) {
    nisps::LpComb<512> lp;
    for (int n = 0; n < 5000; ++n) {
        const float x = (n % 20 == 0) ? 1.f : 0.f;
        const float y = lp.process(x, 200u, 0.7f, 0.3f);
        NISPS_EXPECT(std::isfinite(y));
    }
}
