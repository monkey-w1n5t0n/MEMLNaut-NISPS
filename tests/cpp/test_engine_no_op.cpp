// tests/cpp/test_engine_no_op.cpp — the silent engine.

#include "test_helpers.hpp"
#include "../../nisps/engines/base.hpp"

NISPS_TEST(no_op_engine_returns_zero) {
    nisps::NoOpEngine e;
    e.setup(48000.f);
    e.set_params({});
    for (int n = 0; n < 100; ++n) {
        const auto out = e.process({0.5f, -0.5f});
        NISPS_EXPECT(out.L == 0.f);
        NISPS_EXPECT(out.R == 0.f);
    }
}

NISPS_TEST(no_op_engine_param_count_zero) {
    NISPS_EXPECT(nisps::NoOpEngine::param_count() == 0u);
}

NISPS_TEST(no_op_engine_satisfies_concept) {
    static_assert(nisps::AudioEngine<nisps::NoOpEngine>);
    NISPS_EXPECT(true);
}
