// nisps/modes/verb_fx.hpp — VerbFX mode binding.
//
// 4 abstract input channels → MLP[4, 10, 14, 18, 47] → VerbFXEngine.
// 12 voice-space presets curated for various reverb characters.

#pragma once

#include <cstddef>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/types.hpp"
#include "../engines/verb_fx.hpp"
#include "base.hpp"
#include "generated/verb_fx_schema.hpp"

namespace nisps::modes {

class VerbFXMode : public ModeBase<
        VerbFXMode,
        VerbFXEngine,
        generated::VerbFxMLP,
        4u> {
   public:
    using Base = ModeBase<VerbFXMode, VerbFXEngine,
                          generated::VerbFxMLP, 4u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept {
        return generated::kVerbFxModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept {
        return generated::kVerbFxSchema;
    }
};

static_assert(Mode<VerbFXMode>, "VerbFXMode must satisfy nisps::Mode");

}  // namespace nisps::modes
