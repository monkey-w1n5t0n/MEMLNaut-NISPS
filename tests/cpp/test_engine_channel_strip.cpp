// tests/cpp/test_engine_channel_strip.cpp — channel strip smoke test.

#include <array>
#include <cmath>

#include "test_helpers.hpp"
#include "../../nisps/engines/channel_strip.hpp"

NISPS_TEST(channel_strip_concept) {
    static_assert(nisps::AudioEngine<nisps::ChannelStripEngine>);
    NISPS_EXPECT(nisps::ChannelStripEngine::param_count() == 24u);
    NISPS_EXPECT(nisps::ChannelStripEngine::engine_id() == "channel_strip");
}

NISPS_TEST(channel_strip_bypass_passthrough) {
    nisps::ChannelStripEngine e;
    e.setup(48000.f);
    e.set_bypass_all(true);
    const auto out = e.process({0.7f, -0.3f});
    NISPS_EXPECT_NEAR(out.L, 0.7f, 1e-6);
    NISPS_EXPECT_NEAR(out.R, -0.3f, 1e-6);
}

NISPS_TEST(channel_strip_finite_output_each_voice_space) {
    nisps::ChannelStripEngine e;
    e.setup(48000.f);
    std::array<float, 24> p;
    for (auto& v : p) v = 0.5f;
    for (std::size_t vs = 0u; vs < nisps::ChannelStripEngine::kVoiceSpaceCount; ++vs) {
        e.set_voice_space(static_cast<nisps::ChannelStripEngine::VoiceSpace>(vs));
        e.set_params(p);
        for (int n = 0; n < 1000; ++n) {
            const float x = std::sin(static_cast<float>(n) * 0.05f) * 0.3f;
            const auto y = e.process({x, x});
            NISPS_EXPECT(std::isfinite(y.L));
            NISPS_EXPECT(std::isfinite(y.R));
        }
    }
}
