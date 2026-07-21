// nisps/modes/xiasri.hpp — XIASRI FX mode binding.
//
// 4 abstract input channels → MLP[4, 10, 10, 14, 24] → XIASRIEngine
// (pitch-shift, allpass/comb reverb, 4-tap delay). Single voice space
// ("Direct") because the firmware engine ignores its voice-space slot.

#pragma once

#include <cstddef>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/types.hpp"
#include "../engines/xiasri.hpp"
#include "base.hpp"
#include "generated/xiasri_schema.hpp"

namespace nisps::modes {

class XIASRIMode : public ModeBase<
        XIASRIMode,
        XIASRIEngine,
        generated::XiasriMLP,
        4u> {
   public:
    using Base = ModeBase<XIASRIMode, XIASRIEngine,
                          generated::XiasriMLP, 4u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept {
        return generated::kXiasriModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept {
        return generated::kXiasriSchema;
    }
};

static_assert(Mode<XIASRIMode>, "XIASRIMode must satisfy nisps::Mode");

}  // namespace nisps::modes
