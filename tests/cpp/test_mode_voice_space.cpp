// tests/cpp/test_mode_voice_space.cpp — verify that switching voice spaces
// changes the engine's parameter mapping. We don't compare audio output
// directly (different voice spaces converge to similar timbres for some
// param vectors); instead we verify the engine stores the new voice-space
// index and that subsequent process() doesn't blow up.

#include <array>
#include <cmath>

#include "test_helpers.hpp"
#include "../../nisps/modes/channel_strip.hpp"
#include "../../nisps/modes/paf_synth.hpp"
#include "../../nisps/modes/verb_fx.hpp"

using nisps::modes::ChannelStripMode;
using nisps::modes::PAFSynthMode;
using nisps::modes::VerbFXMode;

NISPS_TEST(voice_space_paf_synth_round_trip) {
    PAFSynthMode m;
    m.setup(48000.f);

    for (std::size_t i = 0u; i < nisps::PAFSynthEngine::kVoiceSpaceCount; ++i) {
        m.set_voice_space(i);
        NISPS_EXPECT(m.voice_space_index() == i);
        // Tick control + process; no NaN / no crash.
        m.set_input(0, 0.5f);
        m.tick_control();
        for (int n = 0; n < 64; ++n) {
            const auto y = m.process({0.f, 0.f});
            NISPS_EXPECT(std::isfinite(y.L));
            NISPS_EXPECT(std::isfinite(y.R));
        }
    }
}

NISPS_TEST(voice_space_channel_strip_dispatch) {
    ChannelStripMode m;
    m.setup(48000.f);
    for (std::size_t i = 0u; i < nisps::ChannelStripEngine::kVoiceSpaceCount; ++i) {
        m.set_voice_space(i);
        NISPS_EXPECT(m.engine().voice_space() ==
                     static_cast<nisps::ChannelStripEngine::VoiceSpace>(i));
    }
}

NISPS_TEST(voice_space_verb_fx_all_dispatch) {
    VerbFXMode m;
    m.setup(48000.f);
    for (std::size_t i = 0u; i < nisps::VerbFXEngine::kVoiceSpaceCount; ++i) {
        m.set_voice_space(i);
        m.set_input(0, 0.4f);
        m.set_input(1, 0.6f);
        m.tick_control();
        // 64 samples — enough to surface a NaN if one's coming.
        for (int n = 0; n < 64; ++n) {
            const auto y = m.process({0.1f, -0.1f});
            NISPS_EXPECT(std::isfinite(y.L));
            NISPS_EXPECT(std::isfinite(y.R));
        }
    }
}

NISPS_TEST(voice_space_out_of_range_ignored) {
    PAFSynthMode m;
    m.setup(48000.f);
    m.set_voice_space(2u);
    NISPS_EXPECT(m.voice_space_index() == 2u);
    m.set_voice_space(999u);  // out of range — should be a no-op
    NISPS_EXPECT(m.voice_space_index() == 2u);
}
