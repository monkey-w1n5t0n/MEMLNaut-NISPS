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
#include "../ml/mlp.hpp"
#include "base.hpp"
#include "generated/verb_fx_schema.hpp"

namespace nisps::modes {

class VerbFXMode : public ModeBase<
        VerbFXMode,
        VerbFXEngine,
        ml::MLP<4u, 10u, 14u, 18u, 47u>,
        4u> {
   public:
    using Base = ModeBase<VerbFXMode, VerbFXEngine,
                          ml::MLP<4u, 10u, 14u, 18u, 47u>, 4u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept {
        return generated::kVerbFxModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept { return kSchema; }

   private:
    static inline constexpr ParamSchema kSchema = ParamSchema{
        generated::kVerbFxModeId,
        generated::kVerbFxEngineId,
        std::span<const std::string_view>(generated::kVerbFxInputChannels),
        generated::kVerbFxMLConfig.input_size,
        std::span<const std::size_t>(generated::kVerbFxHiddenLayers),
        generated::kVerbFxMLConfig.output_size,
        generated::kVerbFxMLConfig.default_spread,
        generated::kVerbFxMLConfig.default_learning_rate,
        generated::kVerbFxMLConfig.default_max_iterations,
        std::span<const generated::Param>(generated::kVerbFxParams),
        std::span<const std::string_view>(generated::kVerbFxVoiceSpaces),
        generated::kVerbFxUI,
    };
};

static_assert(Mode<VerbFXMode>, "VerbFXMode must satisfy nisps::Mode");

}  // namespace nisps::modes
