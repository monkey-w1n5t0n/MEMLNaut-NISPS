// nisps/engines/base.hpp — common building blocks for AudioEngine
// implementations.
//
// Includes:
//   - NoOpEngine: silent passthrough (engine_id() == "thru"), used directly
//     as the mode-level EngineT wherever a mode produces no audio itself —
//     SoundAnalysisMIDIMode (audio is analysed via a separately-composed
//     AnalysisEngine member, not synthesised) and ExternalSynthMIDIMode
//     (joystick -> MLP -> MIDI CC only, no audio path). BreakOrEngine and
//     ElysiamorfEngine are sequencer-only engines that also return silence
//     from process(), but each implements that directly — neither composes
//     NoOpEngine.
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
