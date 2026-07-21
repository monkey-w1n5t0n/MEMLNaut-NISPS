// nisps/modes/sound_analysis_midi.hpp — Sound-analysis-driven MIDI CC mode.
//
// This mode is structurally different from the synth modes:
//   - Audio engine = NoOpEngine (engine_id "thru"). Audio output is silent
//     by spec; the firmware version forwards audio through unchanged but
//     for clean-slate parity we use NoOp. Platform glue can replace this
//     with a real thru if it wants the input mirrored.
//   - Analysis engine = AnalysisEngine. Runs feature extraction on the
//     incoming audio in process() and exposes 6 features.
//   - ML inputs (10) = 6 analysis features + 4 abstract joystick channels.
//   - ML outputs (8) = MIDI CC values pushed into the mode's ControlEvent
//     ring buffer for hardware glue to dispatch.
//
// Because outputs aren't routed to engine params we set
// `kRouteOutputsToEngine = false` so ModeBase skips the size-match assert.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"
#include "../engines/analysis.hpp"
#include "../engines/base.hpp"  // NoOpEngine
#include "base.hpp"
#include "generated/sound_analysis_midi_schema.hpp"

namespace nisps::modes {

class SoundAnalysisMIDIMode;

}  // namespace nisps::modes

namespace nisps {
// Specialise: this mode does not route ML outputs to engine params.
template <>
struct ModeRoutesOutputsToEngine<modes::SoundAnalysisMIDIMode> : std::false_type {};
}  // namespace nisps

namespace nisps::modes {

class SoundAnalysisMIDIMode : public ModeBase<
        SoundAnalysisMIDIMode,
        NoOpEngine,
        generated::SoundAnalysisMidiMLP,
        10u> {
   public:
    using Base = ModeBase<SoundAnalysisMIDIMode, NoOpEngine,
                          generated::SoundAnalysisMidiMLP, 10u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept {
        return generated::kSoundAnalysisMidiModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept {
        return generated::kSoundAnalysisMidiSchema;
    }

    void on_setup(float sample_rate) noexcept {
        analysis_.setup(sample_rate);
    }

    // Audio path tap — modes call this from the audio thread (or the
    // platform glue does after process()) to feed the analyser. Distinct
    // from the audio engine's process() which is the silent passthrough.
    NISPS_HOT NISPS_FORCE_INLINE void analyse(stereosample_t x) noexcept {
        (void)analysis_.process(x);
    }

    // Splice latest analysis features into the first 6 input channels just
    // before the MLP runs. Joystick channels (idx 6..9) are untouched.
    void on_pre_inference() noexcept {
        std::array<float, AnalysisEngine::kNFeatures> feats{};
        analysis_.copy_features(std::span<float>(feats));
        auto chans = mutable_input_channels();
        for (std::size_t i = 0u; i < AnalysisEngine::kNFeatures; ++i) {
            chans[i] = feats[i];
        }
    }

    // After ML inference, scale the 8 sigmoid outputs to MIDI CC values
    // (CC 0..7) and queue them as ControlEvents.
    void on_post_inference() noexcept {
        const auto outs = ml_.outputs();
        for (std::size_t i = 0u; i < kCCCount && i < outs.size(); ++i) {
            float v = outs[i];
            if (v < 0.f) v = 0.f;
            else if (v > 1.f) v = 1.f;
            const std::uint8_t cc_value = static_cast<std::uint8_t>(v * 127.f + 0.5f);
            ControlEvent ce{};
            ce.kind    = ControlEvent::Kind::ControlChange;
            ce.channel = 0u;
            ce.data1   = static_cast<std::uint8_t>(i);  // CC number
            ce.data2   = cc_value;
            (void)push_control_event(ce);
        }
    }

    AnalysisEngine&       analysis()       noexcept { return analysis_; }
    const AnalysisEngine& analysis() const noexcept { return analysis_; }

   private:
    static constexpr std::size_t kCCCount = 8u;

    AnalysisEngine analysis_{};
};

static_assert(Mode<SoundAnalysisMIDIMode>,
              "SoundAnalysisMIDIMode must satisfy nisps::Mode");

}  // namespace nisps::modes
