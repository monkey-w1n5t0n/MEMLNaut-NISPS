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
#include "base.hpp"
#include "generated/channel_strip_schema.hpp"

namespace nisps::modes {

class ChannelStripMode : public ModeBase<
        ChannelStripMode,
        ChannelStripEngine,
        generated::ChannelStripMLP,
        4u> {
   public:
    using Base = ModeBase<ChannelStripMode, ChannelStripEngine,
                          generated::ChannelStripMLP, 4u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept {
        return generated::kChannelStripModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept {
        return generated::kChannelStripSchema;
    }
};

static_assert(Mode<ChannelStripMode>, "ChannelStripMode must satisfy nisps::Mode");

}  // namespace nisps::modes
