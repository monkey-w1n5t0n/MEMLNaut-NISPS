// tests/cpp/test_engine_xiasri.cpp — XIASRI smoke test.

#include <array>
#include <cmath>

#include "test_helpers.hpp"
#include "../../nisps/engines/xiasri.hpp"

NISPS_TEST(xiasri_concept) {
    static_assert(nisps::AudioEngine<nisps::XIASRIEngine>);
    NISPS_EXPECT(nisps::XIASRIEngine::param_count() == 24u);
    NISPS_EXPECT(nisps::XIASRIEngine::engine_id() == "xiasri");
}

NISPS_TEST(xiasri_finite_output) {
    nisps::XIASRIEngine e;
    e.setup(48000.f);
    std::array<float, 24> p;
    for (auto& v : p) v = 0.3f;
    e.set_params(p);
    float energy = 0.f;
    for (int n = 0; n < 4800; ++n) {
        const float x = std::sin(2.f * 3.14159265f * 220.f * n / 48000.f) * 0.5f;
        const auto y = e.process({x, x});
        NISPS_EXPECT(std::isfinite(y.L));
        NISPS_EXPECT(std::fabs(y.L) < 4.f);
        energy += y.L * y.L;
    }
    NISPS_EXPECT(energy > 0.f);
}
