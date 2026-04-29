// nisps/modes/paf_synth.hpp — PAF Synth mode binding.
//
// 4 abstract input channels (joy_x, joy_y, joy_z, joy_w) → MLP[4, 10, 10, 14, 33]
// → PAFSynthEngine.set_params() through the active voice space.
//
// Note triggering (note_on/note_off) lives in the engine; the mode exposes
// thin wrappers so platform glue can route incoming MIDI / touch events.
// No hardware-specific code; firmware glue and browser glue both call the
// same surface.

#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"
#include "../engines/paf_synth.hpp"
#include "../ml/mlp.hpp"
#include "base.hpp"
#include "generated/paf_synth_schema.hpp"

namespace nisps::modes {

class PAFSynthMode : public ModeBase<
        PAFSynthMode,
        PAFSynthEngine,
        ml::MLP<4u, 10u, 10u, 14u, 33u>,
        4u> {
   public:
    using Base = ModeBase<PAFSynthMode, PAFSynthEngine,
                          ml::MLP<4u, 10u, 10u, 14u, 33u>, 4u>;
    using Base::Base;

    // ---- Concept-required statics ----
    static constexpr std::string_view mode_id() noexcept {
        return generated::kPafSynthModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept { return kSchema; }

    // ---- Mode-specific control glue ----
    NISPS_FORCE_INLINE void note_on(std::uint8_t note, std::uint8_t velocity) noexcept {
        engine_.note_on(note, velocity);
    }
    NISPS_FORCE_INLINE void note_off(std::uint8_t note) noexcept {
        engine_.note_off(note);
    }

   private:
    static inline constexpr ParamSchema kSchema = ParamSchema{
        generated::kPafSynthModeId,
        generated::kPafSynthEngineId,
        std::span<const std::string_view>(generated::kPafSynthInputChannels),
        generated::kPafSynthMLConfig.input_size,
        std::span<const std::size_t>(generated::kPafSynthHiddenLayers),
        generated::kPafSynthMLConfig.output_size,
        generated::kPafSynthMLConfig.default_spread,
        generated::kPafSynthMLConfig.default_learning_rate,
        generated::kPafSynthMLConfig.default_max_iterations,
        std::span<const generated::Param>(generated::kPafSynthParams),
        std::span<const std::string_view>(generated::kPafSynthVoiceSpaces),
        generated::kPafSynthUI,
    };
};

static_assert(Mode<PAFSynthMode>, "PAFSynthMode must satisfy nisps::Mode");

}  // namespace nisps::modes
