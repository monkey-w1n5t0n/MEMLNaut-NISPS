// tests/cpp/test_engine_memlcelium.cpp — MEMLCelium smoke test.

#include <array>
#include <cmath>

#include "test_helpers.hpp"
#include "../../nisps/engines/memlcelium.hpp"

NISPS_TEST(memlcelium_concept) {
    static_assert(nisps::AudioEngine<nisps::MEMLCeliumEngine>);
    NISPS_EXPECT(nisps::MEMLCeliumEngine::param_count() == 56u);
    NISPS_EXPECT(nisps::MEMLCeliumEngine::engine_id() == "memlcelium");
}

NISPS_TEST(memlcelium_runs) {
    nisps::MEMLCeliumEngine e;
    e.setup(48000.f);
    std::array<float, 56> p;
    for (auto& v : p) v = 0.5f;
    e.set_params(p);
    for (int n = 0; n < 2400; ++n) {
        const auto y = e.process({0.f, 0.f});
        NISPS_EXPECT(std::isfinite(y.L));
        NISPS_EXPECT(std::fabs(y.L) < 5.f);
    }
}
