// nisps/modes/channel_strip.hpp — Channel-strip mode binding.
//
// 4 abstract input channels → MLP[4, 10, 10, 14, 24] → ChannelStripEngine
// (HPF/LPF + 2× peak EQ + low/high shelf + compressor + tanh saturation),
// dispatched through one of 6 console-emulation voice spaces.

#pragma once

#include <cstddef>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/types.hpp"
#include "../engines/channel_strip.hpp"
#include "../ml/mlp.hpp"
#include "base.hpp"
#include "generated/channel_strip_schema.hpp"

namespace nisps::modes {

class ChannelStripMode : public ModeBase<
        ChannelStripMode,
        ChannelStripEngine,
        ml::MLP<4u, 10u, 10u, 14u, 24u>,
        4u> {
   public:
    using Base = ModeBase<ChannelStripMode, ChannelStripEngine,
                          ml::MLP<4u, 10u, 10u, 14u, 24u>, 4u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept {
        return generated::kChannelStripModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept { return kSchema; }

   private:
    static inline constexpr ParamSchema kSchema = ParamSchema{
        generated::kChannelStripModeId,
        generated::kChannelStripEngineId,
        std::span<const std::string_view>(generated::kChannelStripInputChannels),
        generated::kChannelStripMLConfig.input_size,
        std::span<const std::size_t>(generated::kChannelStripHiddenLayers),
        generated::kChannelStripMLConfig.output_size,
        generated::kChannelStripMLConfig.default_spread,
        generated::kChannelStripMLConfig.default_learning_rate,
        generated::kChannelStripMLConfig.default_max_iterations,
        std::span<const generated::Param>(generated::kChannelStripParams),
        std::span<const std::string_view>(generated::kChannelStripVoiceSpaces),
        generated::kChannelStripUI,
    };
};

static_assert(Mode<ChannelStripMode>, "ChannelStripMode must satisfy nisps::Mode");

}  // namespace nisps::modes
