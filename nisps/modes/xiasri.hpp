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
#include "../ml/mlp.hpp"
#include "base.hpp"
#include "generated/xiasri_schema.hpp"

namespace nisps::modes {

class XIASRIMode : public ModeBase<
        XIASRIMode,
        XIASRIEngine,
        ml::MLP<4u, 10u, 10u, 14u, 24u>,
        4u> {
   public:
    using Base = ModeBase<XIASRIMode, XIASRIEngine,
                          ml::MLP<4u, 10u, 10u, 14u, 24u>, 4u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept {
        return generated::kXiasriModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept { return kSchema; }

   private:
    static inline constexpr ParamSchema kSchema = ParamSchema{
        generated::kXiasriModeId,
        generated::kXiasriEngineId,
        std::span<const std::string_view>(generated::kXiasriInputChannels),
        generated::kXiasriMLConfig.input_size,
        std::span<const std::size_t>(generated::kXiasriHiddenLayers),
        generated::kXiasriMLConfig.output_size,
        generated::kXiasriMLConfig.default_spread,
        generated::kXiasriMLConfig.default_learning_rate,
        generated::kXiasriMLConfig.default_max_iterations,
        std::span<const generated::Param>(generated::kXiasriParams),
        std::span<const std::string_view>(generated::kXiasriVoiceSpaces),
        generated::kXiasriUI,
    };
};

static_assert(Mode<XIASRIMode>, "XIASRIMode must satisfy nisps::Mode");

}  // namespace nisps::modes
