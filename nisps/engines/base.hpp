// nisps/engines/base.hpp — common building blocks for AudioEngine
// implementations.
//
// Includes:
//   - NoOpEngine: silent passthrough. Two uses:
//     (1) the standalone "thru" engine for the SoundAnalysisMIDI mode (audio
//         is analysed but not synthesised), exposed via engine_id()=="thru";
//     (2) composed inside sequencer-only engines (BreakOr, Elysiamorf) whose
//         MIDI/I2C event emission lives outside the audio path. Internal
//         composition uses the type directly, not the engine_id lookup.
//   - Helper macros / static_asserts to verify each concrete engine satisfies
//     `nisps::AudioEngine` at compile time.

#pragma once

#include <cstddef>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"

namespace nisps {

class NoOpEngine {
   public:
    static constexpr std::size_t param_count() noexcept { return 0u; }
    static constexpr std::string_view engine_id() noexcept { return "thru"; }

    void setup(float /*sample_rate*/) noexcept {}
    void set_params(std::span<const float> /*params*/) noexcept {}

    NISPS_HOT NISPS_FORCE_INLINE stereosample_t process(stereosample_t /*x*/) noexcept {
        return {0.f, 0.f};
    }

    DriverConfig driver_config() const noexcept { return {}; }
};

static_assert(AudioEngine<NoOpEngine>, "NoOpEngine must satisfy AudioEngine");

}  // namespace nisps
