// nisps/modes/external_synth_midi.hpp — Drive an external MIDI synth via CC.
//
// A platform-agnostic mode that maps the abstract joystick inputs through the
// MLP to MIDI Control Change messages for an EXTERNAL hardware synth, using a
// compile-time-selected device template from nisps/midi/generated/midi_devices.hpp
// (the same templates the Manifold browser picker uses).
//
//   - Audio engine = NoOpEngine (engine_id "thru"); no audio is produced.
//   - ML inputs (4) = the abstract joystick channels (joy_x/y/z/w).
//   - ML outputs (NOut) = MIDI CC values pushed into the ControlEvent ring for
//     the firmware glue to dispatch (output_router -> midi_io::queueCC).
//   - Device is chosen at COMPILE TIME (one flashable variant per synth, e.g.
//     MEMLNautModeExtSynthSub37). Which of the device's params occupy the NOut
//     output slots is chosen by `pick_cc_slots` (prefers musical params over
//     Bank Select / global housekeeping CCs). A runtime `enabled_` mask can
//     mute individual slots (set_param_enabled); rich per-param selection is the
//     browser's job — the hardware drives this curated subset.
//
// `kRouteOutputsToEngine = false` (specialised below) so ModeBase skips routing
// ML outputs into engine params, exactly like SoundAnalysisMIDIMode.
//
// NOT folded into the schemas/modes/*.json codegen pipeline (L11, one-core
// simplification 2026-07): that pipeline emits ONE static schema per JSON
// file, but this "mode" is a C++ template family over an externally supplied
// `Device` (one of the nisps/midi/generated device templates) and an output
// count `NOut` — there is no single (device, NOut) pair to author a JSON
// schema for, and its per-output "params" aren't independently named at all;
// they're whichever NOut slots `pick_cc_slots` selects from `Device.params`,
// which is ITSELF already schema-generated (codegen/generate-midi-devices.ts,
// schemas/midi_devices/). Folding would mean inventing a new
// device-templated schema kind for a single, already-degenerate consumer —
// not a behaviour-preserving consolidation. Instead: the net-shape + ML
// defaults this mode needs (identical to every other 4-joystick-input mode —
// see e.g. schemas/modes/memlcelium.json) are named ONCE below
// (`ext_synth_defaults`), so the `MLP<>` shape and the `ParamSchema` instance
// both read from the same place instead of re-typing the same literals.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"
#include "../engines/base.hpp"  // NoOpEngine
#include "../midi/generated/midi_devices.hpp"
#include "../ml/mlp.hpp"
#include "base.hpp"

namespace nisps::modes {

// Shared net-shape + ML defaults for every ExternalSynthMIDIMode
// instantiation (see the file-header comment for why these are hand-named
// rather than codegen'd): 4 joystick inputs -> [10,14,18] hidden -> NOut
// (device-CC-count-driven) outputs, matching every other 4-joystick-input
// mode's schema defaults (default_spread 0.6, default_learning_rate 1.0,
// default_max_iterations 1000).
namespace ext_synth_defaults {
inline constexpr std::size_t kInputSize = 4u;
inline constexpr std::array<std::string_view, 4> kInputChannels{
    std::string_view{"joy_x"}, std::string_view{"joy_y"},
    std::string_view{"joy_z"}, std::string_view{"joy_w"}};
inline constexpr std::array<std::size_t, 3> kHiddenLayers{10u, 14u, 18u};
inline constexpr float       kDefaultSpread        = 0.6f;
inline constexpr float       kDefaultLearningRate  = 1.0f;
inline constexpr std::size_t kDefaultMaxIterations = 1000u;
}  // namespace ext_synth_defaults

// The net-shape alias every instantiation uses (mirrors S6/S25's per-mode
// `<Mode>MLP` codegen alias, generalised to a template parameter since NOut
// varies per device/output-count combination).
template <std::size_t NOut>
using ExtSynthMIDIMLP = ::nisps::ml::MLP<
    ext_synth_defaults::kInputSize,
    ext_synth_defaults::kHiddenLayers[0],
    ext_synth_defaults::kHiddenLayers[1],
    ext_synth_defaults::kHiddenLayers[2],
    NOut>;

template <const ::nisps::midi::generated::MidiDevice& Device, std::size_t NOut>
class ExternalSynthMIDIMode;

// Compile-time slot picker: choose which NOut device params the MLP drives.
// Prefers "musical" params (any group except "global"); fills any remaining
// slots from the leftover (global) params. Deterministic, zero runtime cost.
template <const ::nisps::midi::generated::MidiDevice& Device, std::size_t NOut>
consteval std::array<std::uint8_t, NOut> pick_cc_slots() {
    std::array<std::uint8_t, NOut> slots{};
    std::size_t n = 0u;
    for (std::size_t i = 0u; i < Device.params.size() && n < NOut; ++i) {
        if (Device.params[i].group != std::string_view{"global"}) {
            slots[n++] = static_cast<std::uint8_t>(i);
        }
    }
    for (std::size_t i = 0u; i < Device.params.size() && n < NOut; ++i) {
        if (Device.params[i].group == std::string_view{"global"}) {
            slots[n++] = static_cast<std::uint8_t>(i);
        }
    }
    return slots;
}

}  // namespace nisps::modes

namespace nisps {
// Specialise: this mode does not route ML outputs to engine params.
template <const ::nisps::midi::generated::MidiDevice& D, std::size_t N>
struct ModeRoutesOutputsToEngine<modes::ExternalSynthMIDIMode<D, N>> : std::false_type {};
}  // namespace nisps

namespace nisps::modes {

template <const ::nisps::midi::generated::MidiDevice& Device, std::size_t NOut = 8u>
class ExternalSynthMIDIMode : public ModeBase<
        ExternalSynthMIDIMode<Device, NOut>,
        NoOpEngine,
        ExtSynthMIDIMLP<NOut>,
        4u> {
    static_assert(Device.params.size() >= NOut,
                  "device template has fewer params than the mode's output count");

   public:
    using Base = ModeBase<ExternalSynthMIDIMode<Device, NOut>, NoOpEngine,
                          ExtSynthMIDIMLP<NOut>, 4u>;
    using Base::Base;

    static constexpr std::string_view mode_id() noexcept { return Device.device_id; }
    static constexpr const ParamSchema& param_schema() noexcept { return kSchema; }

    // Map the NOut MLP outputs onto the selected device CCs and queue them.
    void on_post_inference() noexcept {
        const auto outs = this->ml_.outputs();
        const std::uint8_t ch =
            Device.default_channel > 0u ? static_cast<std::uint8_t>(Device.default_channel - 1u) : 0u;
        for (std::size_t i = 0u; i < NOut && i < outs.size(); ++i) {
            if (!enabled_[i]) continue;
            const auto& p = Device.params[kSlots[i]];
            float v = outs[i];
            if (v < 0.f) v = 0.f;
            else if (v > 1.f) v = 1.f;
            const float lo = static_cast<float>(p.min);
            const float hi = static_cast<float>(p.max);
            ControlEvent ce{};
            ce.kind    = ControlEvent::Kind::ControlChange;
            ce.channel = ch;
            ce.data1   = p.cc;
            ce.data2   = static_cast<std::uint8_t>(lo + v * (hi - lo) + 0.5f);
            (void)this->push_control_event(ce);
        }
    }

    // Runtime mute of an individual output slot (hardware has no rich selector;
    // this is the hook a future TFT menu / glue would drive).
    void set_param_enabled(std::size_t slot, bool on) noexcept {
        if (slot < NOut) enabled_[slot] = on;
    }
    static constexpr std::size_t slot_count() noexcept { return NOut; }
    // The device param backing output slot i (for glue / display by name).
    static constexpr const ::nisps::midi::generated::MidiParam& slot_param(std::size_t i) noexcept {
        return Device.params[kSlots[i]];
    }

   private:
    static constexpr auto kSlots = pick_cc_slots<Device, NOut>();

    std::array<bool, NOut> enabled_ = [] {
        std::array<bool, NOut> a{};
        for (auto& b : a) b = true;
        return a;
    }();

    static constexpr std::array<generated::Param, 0> kNoParams{};
    static constexpr std::array<std::string_view, 0> kNoVoiceSpaces{};
    static constexpr generated::UIConfig kUI{generated::PrimaryInput::Joystick, false, false};

    static inline constexpr ParamSchema kSchema = ParamSchema{
        Device.device_id,
        std::string_view{"thru"},
        std::span<const std::string_view>(ext_synth_defaults::kInputChannels),
        ext_synth_defaults::kInputSize,
        std::span<const std::size_t>(ext_synth_defaults::kHiddenLayers),
        NOut,
        ext_synth_defaults::kDefaultSpread,
        ext_synth_defaults::kDefaultLearningRate,
        ext_synth_defaults::kDefaultMaxIterations,
        std::span<const generated::Param>(kNoParams),
        std::span<const std::string_view>(kNoVoiceSpaces),
        kUI,
    };
};

}  // namespace nisps::modes
