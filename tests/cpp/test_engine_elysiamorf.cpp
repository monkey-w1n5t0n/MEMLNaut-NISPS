// tests/cpp/test_engine_elysiamorf.cpp — sequencer-only FM-CC emitter.

#include <array>

#include "test_helpers.hpp"
#include "../../nisps/engines/elysiamorf.hpp"

NISPS_TEST(elysiamorf_concept) {
    static_assert(nisps::AudioEngine<nisps::ElysiamorfEngine>);
    NISPS_EXPECT(nisps::ElysiamorfEngine::param_count() == 40u);
    NISPS_EXPECT(nisps::ElysiamorfEngine::engine_id() == "elysiamorf");
}

NISPS_TEST(elysiamorf_silent_audio_with_events) {
    nisps::ElysiamorfEngine e;
    e.setup(48000.f);
    std::array<float, 40> p;
    for (auto& v : p) v = 0.5f;
    e.set_params(p);
    e.update_bpm(120.f);
    e.set_playing(true);

    std::array<nisps::ElysiamorfEngine::Event, 64> events;
    std::size_t total = 0u;
    for (int n = 0; n < 48000; ++n) {
        const auto y = e.process({0.f, 0.f});
        NISPS_EXPECT(y.L == 0.f);
        NISPS_EXPECT(y.R == 0.f);
        total += e.pop_events(events);
        if (total > 8u) break;
    }
    NISPS_EXPECT(total > 0u);
}
