// tests/cpp/test_engine_analysis.cpp — XiasriAnalysis port smoke test.

#include <cmath>

#include "test_helpers.hpp"
#include "../../nisps/engines/analysis.hpp"

NISPS_TEST(analysis_concept) {
    static_assert(nisps::AudioEngine<nisps::AnalysisEngine>);
    NISPS_EXPECT(nisps::AnalysisEngine::param_count() == 0u);
    NISPS_EXPECT(nisps::AnalysisEngine::engine_id() == "analysis");
}

NISPS_TEST(analysis_features_in_range) {
    nisps::AnalysisEngine e;
    e.setup(48000.f);
    // Feed a 220 Hz sine.
    for (int n = 0; n < 48000; ++n) {
        const float x = std::sin(2.f * 3.14159265f * 220.f * n / 48000.f) * 0.5f;
        e.process({x, x});
    }
    const auto& f = e.features();
    NISPS_EXPECT(f.pitch >= 0.f && f.pitch <= 1.f);
    NISPS_EXPECT(f.aperiodicity >= 0.f && f.aperiodicity <= 1.f);
    NISPS_EXPECT(f.energy >= 0.f && f.energy <= 1.f);
    NISPS_EXPECT(f.attack >= 0.f && f.attack <= 1.f);
    NISPS_EXPECT(f.brightness >= 0.f && f.brightness <= 1.f);
}

NISPS_TEST(analysis_silence_gives_low_energy) {
    nisps::AnalysisEngine e;
    e.setup(48000.f);
    for (int n = 0; n < 48000; ++n) e.process({0.f, 0.f});
    const auto& f = e.features();
    NISPS_EXPECT(f.energy < 0.1f);  // log envelope clamps to ~0
    NISPS_EXPECT(f.energy_crude == 0.f);
}
