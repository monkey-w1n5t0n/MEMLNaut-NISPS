// nisps/modes/breakor.hpp — Break|| 8-track ratio sequencer mode binding.
//
// 4 abstract input channels → MLP[4, 10, 14, 18, 56] → BreakOrEngine.
// process() returns silence; the engine queues NoteOn/NoteOff/Clock events
// each tick. The mode forwards them through its ControlEvent ring buffer
// for the platform glue (firmware MIDI/I2C, browser WebMIDI) to drain.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"
#include "../engines/breakor.hpp"
#include "base.hpp"
#include "generated/breakor_schema.hpp"

namespace nisps::modes {

class BreakOrMode : public ModeBase<
        BreakOrMode,
        BreakOrEngine,
        generated::BreakorMLP,
        4u> {
   public:
    using Base = ModeBase<BreakOrMode, BreakOrEngine,
                          generated::BreakorMLP, 4u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept {
        return generated::kBreakorModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept {
        return generated::kBreakorSchema;
    }

    NISPS_FORCE_INLINE void set_playing(bool playing) noexcept {
        engine_.set_playing(playing);
    }
    NISPS_FORCE_INLINE void update_bpm(float bpm) noexcept {
        engine_.update_bpm(bpm);
    }
    NISPS_FORCE_INLINE void set_track_note(std::size_t track, std::uint8_t note) noexcept {
        engine_.set_track_note(track, note);
    }

    // Drains queued engine events, repackages them as ControlEvent and pushes
    // them into the mode's event ring. Called by hardware glue from the
    // audio thread (or right after process()) to forward MIDI/I2C output.
    void pump_engine_events() noexcept {
        std::array<BreakOrEngine::Event, 32u> buf;
        const std::size_t n = engine_.pop_events(std::span<BreakOrEngine::Event>(buf));
        for (std::size_t i = 0u; i < n; ++i) {
            const auto& e = buf[i];
            ControlEvent ce{};
            switch (e.kind) {
                case BreakOrEngine::EventKind::NoteOn:
                    ce.kind = ControlEvent::Kind::NoteOn;  break;
                case BreakOrEngine::EventKind::NoteOff:
                    ce.kind = ControlEvent::Kind::NoteOff; break;
                case BreakOrEngine::EventKind::Clock:
                    ce.kind = ControlEvent::Kind::Clock;   break;
            }
            ce.channel = e.track;
            ce.data1   = e.midi_note;
            ce.data2   = e.velocity;
            (void)push_control_event(ce);
        }
    }
};

static_assert(Mode<BreakOrMode>, "BreakOrMode must satisfy nisps::Mode");

}  // namespace nisps::modes
