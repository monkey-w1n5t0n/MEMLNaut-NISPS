// nisps/modes/memlcelium.hpp — MEMLCelium dual-voice synth + 2-track ratio
// sequencer mode binding.
//
// 4 abstract input channels → MLP[4, 10, 14, 18, 56] → MEMLCeliumEngine.
// The engine handles sequencer ticks internally inside process(); the mode
// surface adds set_playing()/update_bpm() helpers for platform glue.

#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"
#include "../engines/memlcelium.hpp"
#include "base.hpp"
#include "generated/memlcelium_schema.hpp"

namespace nisps::modes {

class MEMLCeliumMode : public ModeBase<
        MEMLCeliumMode,
        MEMLCeliumEngine,
        generated::MemlceliumMLP,
        4u> {
   public:
    using Base = ModeBase<MEMLCeliumMode, MEMLCeliumEngine,
                          generated::MemlceliumMLP, 4u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept {
        return generated::kMemlceliumModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept {
        return generated::kMemlceliumSchema;
    }

    NISPS_FORCE_INLINE void set_playing(bool playing) noexcept {
        engine_.set_playing(playing);
    }
    NISPS_FORCE_INLINE void update_bpm(float bpm) noexcept {
        engine_.update_bpm(bpm);
    }
};

static_assert(Mode<MEMLCeliumMode>, "MEMLCeliumMode must satisfy nisps::Mode");

}  // namespace nisps::modes
