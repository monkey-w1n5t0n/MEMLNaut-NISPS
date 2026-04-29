// tests/cpp/test_engine_paf_synth.cpp — PAFSynth engine smoke test.

#include <array>
#include <cmath>

#include "test_helpers.hpp"
#include "../../nisps/engines/paf_synth.hpp"

NISPS_TEST(paf_synth_concept) {
    static_assert(nisps::AudioEngine<nisps::PAFSynthEngine>);
    NISPS_EXPECT(nisps::PAFSynthEngine::param_count() == 33u);
    NISPS_EXPECT(nisps::PAFSynthEngine::engine_id() == "paf_synth");
}

NISPS_TEST(paf_synth_produces_nonzero_with_note) {
    nisps::PAFSynthEngine e;
    e.setup(48000.f);
    std::array<float, 33> p;
    for (auto& v : p) v = 0.5f;
    e.set_params(p);
    e.note_on(60u, 100u);
    float energy = 0.f;
    for (int n = 0; n < 4800; ++n) {
        const auto y = e.process({0.f, 0.f});
        NISPS_EXPECT(std::isfinite(y.L));
        NISPS_EXPECT(std::isfinite(y.R));
        energy += y.L * y.L;
    }
    NISPS_EXPECT(energy > 0.f);
}

NISPS_TEST(paf_synth_voice_space_switches) {
    nisps::PAFSynthEngine e;
    e.setup(48000.f);
    std::array<float, 33> p;
    for (auto& v : p) v = 0.5f;
    for (std::size_t vs = 0u; vs < nisps::PAFSynthEngine::kVoiceSpaceCount; ++vs) {
        e.set_voice_space(static_cast<nisps::PAFSynthEngine::VoiceSpace>(vs));
        e.set_params(p);
        for (int n = 0; n < 100; ++n) {
            const auto y = e.process({0.f, 0.f});
            NISPS_EXPECT(std::isfinite(y.L));
        }
    }
}
