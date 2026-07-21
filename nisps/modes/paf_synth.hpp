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
#include "base.hpp"
#include "generated/paf_synth_schema.hpp"

namespace nisps::modes {

class PAFSynthMode : public ModeBase<
        PAFSynthMode,
        PAFSynthEngine,
        generated::PafSynthMLP,
        4u> {
   public:
    using Base = ModeBase<PAFSynthMode, PAFSynthEngine,
                          generated::PafSynthMLP, 4u>;
    using Base::Base;

    // ---- Concept-required statics ----
    static constexpr std::string_view mode_id() noexcept {
        return generated::kPafSynthModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept {
        return generated::kPafSynthSchema;
    }

    // ---- Mode-specific control glue ----
    NISPS_FORCE_INLINE void note_on(std::uint8_t note, std::uint8_t velocity) noexcept {
        engine_.note_on(note, velocity);
    }
    NISPS_FORCE_INLINE void note_off(std::uint8_t note) noexcept {
        engine_.note_off(note);
    }
};

static_assert(Mode<PAFSynthMode>, "PAFSynthMode must satisfy nisps::Mode");

}  // namespace nisps::modes
