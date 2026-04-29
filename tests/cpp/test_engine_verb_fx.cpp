// tests/cpp/test_engine_verb_fx.cpp — VerbFX smoke test.

#include <array>
#include <cmath>

#include "test_helpers.hpp"
#include "../../nisps/engines/verb_fx.hpp"

NISPS_TEST(verb_fx_concept) {
    static_assert(nisps::AudioEngine<nisps::VerbFXEngine>);
    NISPS_EXPECT(nisps::VerbFXEngine::param_count() == 47u);
    NISPS_EXPECT(nisps::VerbFXEngine::engine_id() == "verb_fx");
}

NISPS_TEST(verb_fx_finite_output_default) {
    nisps::VerbFXEngine e;
    e.setup(48000.f);
    std::array<float, 47> p;
    for (auto& v : p) v = 0.3f;
    e.set_params(p);
    for (int n = 0; n < 2400; ++n) {
        const float x = std::sin(static_cast<float>(n) * 0.03f) * 0.3f;
        const auto y = e.process({x, x});
        NISPS_EXPECT(std::isfinite(y.L));
        NISPS_EXPECT(std::fabs(y.L) < 50.f);
    }
}

NISPS_TEST(verb_fx_voice_spaces_finite) {
    nisps::VerbFXEngine e;
    e.setup(48000.f);
    std::array<float, 47> p;
    for (auto& v : p) v = 0.3f;
    for (std::size_t vs = 0u; vs < nisps::VerbFXEngine::kVoiceSpaceCount; ++vs) {
        e.set_voice_space(static_cast<nisps::VerbFXEngine::VoiceSpace>(vs));
        e.set_params(p);
        for (int n = 0; n < 200; ++n) {
            const auto y = e.process({0.1f, 0.1f});
            NISPS_EXPECT(std::isfinite(y.L));
        }
    }
}
