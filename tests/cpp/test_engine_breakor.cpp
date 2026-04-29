// tests/cpp/test_engine_breakor.cpp — sequencer-only engine.

#include <array>

#include "test_helpers.hpp"
#include "../../nisps/engines/breakor.hpp"

NISPS_TEST(breakor_concept_and_silent_audio) {
    static_assert(nisps::AudioEngine<nisps::BreakOrEngine>);
    NISPS_EXPECT(nisps::BreakOrEngine::param_count() == 56u);
    NISPS_EXPECT(nisps::BreakOrEngine::engine_id() == "breakor");

    nisps::BreakOrEngine e;
    e.setup(48000.f);
    std::array<float, 56> p;
    for (auto& v : p) v = 0.5f;
    e.set_params(p);

    // Audio output should be all zeros.
    for (int n = 0; n < 1000; ++n) {
        const auto y = e.process({0.f, 0.f});
        NISPS_EXPECT(y.L == 0.f);
        NISPS_EXPECT(y.R == 0.f);
    }
}

NISPS_TEST(breakor_emits_events_when_playing) {
    nisps::BreakOrEngine e;
    e.setup(48000.f);
    std::array<float, 56> p;
    // Choose params that will trigger (ratios drive the sequencer).
    for (std::size_t i = 0u; i < 56u; ++i) p[i] = 0.5f;
    e.set_params(p);
    e.update_bpm(120.f);
    e.set_playing(true);

    std::array<nisps::BreakOrEngine::Event, 64> events;
    std::size_t total = 0u;
    for (int n = 0; n < 48000 * 4; ++n) {  // 4 seconds
        e.process({0.f, 0.f});
        const std::size_t got = e.pop_events(events);
        total += got;
        if (total > 5u) break;
    }
    NISPS_EXPECT(total > 0u);
}
