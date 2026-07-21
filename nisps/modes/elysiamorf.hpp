// nisps/modes/elysiamorf.hpp — Elysiamorf 8-track FM-pair MIDI-CC sequencer
// mode binding.
//
// 4 abstract input channels → MLP[4, 10, 14, 18, 40] → ElysiamorfEngine.
// process() returns silence and emits CC + Clock events each tick. The
// mode bridges them into its ControlEvent ring buffer.

#pragma once

#include <array>
#include <cstddef>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"
#include "../engines/elysiamorf.hpp"
#include "base.hpp"
#include "generated/elysiamorf_schema.hpp"

namespace nisps::modes {

class ElysiamorfMode : public ModeBase<
        ElysiamorfMode,
        ElysiamorfEngine,
        generated::ElysiamorfMLP,
        4u> {
   public:
    using Base = ModeBase<ElysiamorfMode, ElysiamorfEngine,
                          generated::ElysiamorfMLP, 4u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept {
        return generated::kElysiamorfModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept {
        return generated::kElysiamorfSchema;
    }

    NISPS_FORCE_INLINE void set_playing(bool playing) noexcept {
        engine_.set_playing(playing);
    }
    NISPS_FORCE_INLINE void update_bpm(float bpm) noexcept {
        engine_.update_bpm(bpm);
    }

    void pump_engine_events() noexcept {
        std::array<ElysiamorfEngine::Event, 32u> buf;
        const std::size_t n = engine_.pop_events(std::span<ElysiamorfEngine::Event>(buf));
        for (std::size_t i = 0u; i < n; ++i) {
            const auto& e = buf[i];
            ControlEvent ce{};
            switch (e.kind) {
                case ElysiamorfEngine::EventKind::CC:
                    ce.kind = ControlEvent::Kind::ControlChange;
                    break;
                case ElysiamorfEngine::EventKind::Clock:
                    ce.kind = ControlEvent::Kind::Clock;
                    break;
            }
            ce.channel = 0u;             // single output channel for now
            ce.data1   = e.cc_number;
            ce.data2   = e.cc_value;
            (void)push_control_event(ce);
        }
    }
};

static_assert(Mode<ElysiamorfMode>, "ElysiamorfMode must satisfy nisps::Mode");

}  // namespace nisps::modes
