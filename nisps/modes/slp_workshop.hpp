// nisps/modes/slp_workshop.hpp — SLP-Workshop mode binding.
//
// The Synth Library Portland workshop instrument. It reuses the MEMLCelium
// engine and MLP shape verbatim (4 input channels → MLP[4,10,14,18,56] →
// MEMLCeliumEngine, sequencer ticked internally in process()), but exists as
// a distinct mode so the workshop firmware carries its own identity (preset
// dir, display name) and foregrounds the adaptive-learning gestures that now
// live in ModeBase for every mode:
//
//   - Jolt   — held gesture, continuously morphs a scatter of weights and
//              freezes them on release  (Base::jolt_press/jolt_release).
//   - OU explore — Ornstein-Uhlenbeck random walk on the output vector
//              (Base::set_explore_intensity).
//
// Both were ported from upstream memllib InterfaceRL (see ml/jolt.hpp,
// ml/ou_noise.hpp). Because they sit in the shared base, the synthesis
// mapping here is identical to MEMLCeliumMode — only the surfaced controls
// and identity differ.

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
#include "generated/slp_workshop_schema.hpp"

namespace nisps::modes {

class SLPWorkshopMode : public ModeBase<
        SLPWorkshopMode,
        MEMLCeliumEngine,
        generated::SlpWorkshopMLP,
        4u> {
   public:
    using Base = ModeBase<SLPWorkshopMode, MEMLCeliumEngine,
                          generated::SlpWorkshopMLP, 4u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept {
        return generated::kSlpWorkshopModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept {
        return generated::kSlpWorkshopSchema;
    }

    NISPS_FORCE_INLINE void set_playing(bool playing) noexcept {
        engine_.set_playing(playing);
    }
    NISPS_FORCE_INLINE void update_bpm(float bpm) noexcept {
        engine_.update_bpm(bpm);
    }
};

static_assert(Mode<SLPWorkshopMode>, "SLPWorkshopMode must satisfy nisps::Mode");

}  // namespace nisps::modes
