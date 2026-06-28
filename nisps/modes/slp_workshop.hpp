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
#include "../ml/mlp.hpp"
#include "base.hpp"
#include "generated/slp_workshop_schema.hpp"

namespace nisps::modes {

class SLPWorkshopMode : public ModeBase<
        SLPWorkshopMode,
        MEMLCeliumEngine,
        ml::MLP<4u, 10u, 14u, 18u, 56u>,
        4u> {
   public:
    using Base = ModeBase<SLPWorkshopMode, MEMLCeliumEngine,
                          ml::MLP<4u, 10u, 14u, 18u, 56u>, 4u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept {
        return generated::kSlpWorkshopModeId;
    }
    static constexpr const ParamSchema& param_schema() noexcept { return kSchema; }

    NISPS_FORCE_INLINE void set_playing(bool playing) noexcept {
        engine_.set_playing(playing);
    }
    NISPS_FORCE_INLINE void update_bpm(float bpm) noexcept {
        engine_.update_bpm(bpm);
    }

   private:
    static inline constexpr ParamSchema kSchema = ParamSchema{
        generated::kSlpWorkshopModeId,
        generated::kSlpWorkshopEngineId,
        std::span<const std::string_view>(generated::kSlpWorkshopInputChannels),
        generated::kSlpWorkshopMLConfig.input_size,
        std::span<const std::size_t>(generated::kSlpWorkshopHiddenLayers),
        generated::kSlpWorkshopMLConfig.output_size,
        generated::kSlpWorkshopMLConfig.default_spread,
        generated::kSlpWorkshopMLConfig.default_learning_rate,
        generated::kSlpWorkshopMLConfig.default_max_iterations,
        std::span<const generated::Param>(generated::kSlpWorkshopParams),
        std::span<const std::string_view>(generated::kSlpWorkshopVoiceSpaces),
        generated::kSlpWorkshopUI,
    };
};

static_assert(Mode<SLPWorkshopMode>, "SLPWorkshopMode must satisfy nisps::Mode");

}  // namespace nisps::modes
