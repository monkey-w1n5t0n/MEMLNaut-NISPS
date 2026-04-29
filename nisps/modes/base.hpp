// nisps/modes/base.hpp — Common scaffolding for every concrete mode.
//
// Two responsibilities:
//   1. Define `nisps::ParamSchema` (the aggregate type that the `Mode`
//      concept's `param_schema()` returns a const-reference to). The codegen
//      output in `nisps/modes/generated/` lives in a different namespace and
//      provides typed constants per mode; we wrap those in a uniform view-
//      style `ParamSchema` here so the concept is satisfied without touching
//      generated code.
//
//   2. Provide `ModeBase<Derived, EngineT, MLPType, NInputs>` — a CRTP base
//      that absorbs the per-mode boilerplate (input forwarding, ML inference
//      driving engine params, voice space selection, control event ring
//      buffer). Concrete modes derive from this and only specialise:
//       - the schema reference (static),
//       - the "extra" pre-mapping done before set_params (e.g. analysis
//         features stitched into ML inputs in SoundAnalysisMIDI),
//       - any engine-specific control glue (note_on/note_off, sequencer
//         play/stop, BPM updates).
//
// Modes are platform-agnostic. Hardware/browser glue maps abstract input
// channels (float [0, 1]) into `set_input(idx, value)` and drains
// `pop_control_events()` for MIDI/I2C dispatch.
//
// No heap, no virtuals, no pico/Arduino headers.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>
#include <type_traits>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/ring_buffer.hpp"
#include "../core/types.hpp"
#include "generated/schema_types.hpp"

namespace nisps {

// ---------------------------------------------------------------------------
// ParamSchema — view-style aggregate matching the concept's forward decl.
// All members are spans/views into compile-time generated arrays; the
// schema itself can be `inline constexpr` per mode.
// ---------------------------------------------------------------------------
struct ParamSchema {
    std::string_view                                              mode_id;
    std::string_view                                              engine_id;
    std::span<const std::string_view>                             input_channels;
    std::size_t                                                   input_size;
    std::span<const std::size_t>                                  hidden_layers;
    std::size_t                                                   output_size;
    float                                                         default_spread;
    float                                                         default_learning_rate;
    std::size_t                                                   default_max_iterations;
    std::span<const ::nisps::modes::generated::Param>             params;
    std::span<const std::string_view>                             voice_spaces;
    ::nisps::modes::generated::UIConfig                           ui;
};

// ---------------------------------------------------------------------------
// Abstract control event — emitted by modes for the platform glue to drain.
// Sequencer modes (BreakOr, Elysiamorf) push real events; synth modes push
// none unless they want to relay MIDI thru.
// ---------------------------------------------------------------------------
struct ControlEvent {
    enum class Kind : std::uint8_t {
        None,
        NoteOn,
        NoteOff,
        ControlChange,
        Clock,
    };
    Kind         kind     = Kind::None;
    std::uint8_t channel  = 0u;
    std::uint8_t data1    = 0u;
    std::uint8_t data2    = 0u;
};

// Sized at the larger of the engines' event buffers (BreakOr/Elysiamorf
// publish 64 entries; we mirror that for consistency).
inline constexpr std::size_t kModeEventBufferSize = 64u;

// Trait controlling whether ModeBase routes ML outputs into engine.set_params().
// Default: true (every synth/effect mode). Specialise to `false` for modes
// that don't (e.g. SoundAnalysisMIDIMode where outputs become MIDI CC).
template <typename Derived>
struct ModeRoutesOutputsToEngine : std::true_type {};

// ---------------------------------------------------------------------------
// ModeBase — CRTP scaffold.
//
// Derived classes provide:
//   static constexpr const ParamSchema& schema()  // their generated schema
//   void on_setup(float sample_rate) noexcept     // optional hook
//   void on_pre_inference() noexcept              // optional, before ml_.process()
//   void on_post_inference() noexcept             // optional, after engine.set_params()
//
// Derived classes may choose the engine type (`EngineT`) and ML type
// (`MLPType`) freely; both must satisfy `MLEngine` and `AudioEngine`
// respectively, except for sequencer modes whose engine still satisfies
// `AudioEngine` (process() returns silence).
// ---------------------------------------------------------------------------
template <typename Derived,
          typename EngineT,
          typename MLPType,
          std::size_t NInputs>
class ModeBase {
   public:
    using Engine = EngineT;
    using ML     = MLPType;

    static_assert(AudioEngine<EngineT>,
                  "ModeBase: EngineT must satisfy nisps::AudioEngine concept");
    static_assert(MLEngine<MLPType>,
                  "ModeBase: MLPType must satisfy nisps::MLEngine concept");
    static_assert(MLPType::kInput  == NInputs,
                  "ModeBase: NInputs must equal MLP::kInput");
    // Most modes route ML outputs directly into engine params; require the
    // sizes to match. SoundAnalysisMIDI opts out by specialising
    // ModeRoutesOutputsToEngine<Derived> to std::false_type.
    static constexpr bool kRouteOutputsToEngine =
        ModeRoutesOutputsToEngine<Derived>::value;
    static_assert(!kRouteOutputsToEngine ||
                  MLPType::kOutput == EngineT::param_count(),
                  "ModeBase: MLP output_size must equal engine param_count() "
                  "unless ModeRoutesOutputsToEngine<Derived> is false");

    static constexpr std::size_t input_channel_count() noexcept { return NInputs; }

    explicit ModeBase(std::uint64_t seed = 0xC0FFEEu) noexcept : ml_(seed) {}

    // ---- Mode concept surface ----
    void setup(float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        engine_.setup(sample_rate);
        for (auto& v : input_channels_) v = 0.5f;
        // Run an inference at default inputs so engine has params on first
        // process() call, even if no input has been touched.
        for (std::size_t i = 0u; i < NInputs; ++i) {
            ml_.set_input(i, input_channels_[i]);
        }
        ml_.process();
        if constexpr (kRouteOutputsToEngine) {
            engine_.set_params(ml_.outputs());
        }
        if constexpr (requires(Derived& d, float s) { d.on_setup(s); }) {
            static_cast<Derived&>(*this).on_setup(sample_rate);
        }
    }

    NISPS_FORCE_INLINE void set_input(std::size_t idx, float value) noexcept {
        if (idx >= NInputs) return;
        if (value < 0.f) value = 0.f;
        else if (value > 1.f) value = 1.f;
        input_channels_[idx] = value;
        input_dirty_ = true;
    }

    NISPS_HOT void tick_control() noexcept {
        if constexpr (requires(Derived& d) { d.on_pre_inference(); }) {
            static_cast<Derived&>(*this).on_pre_inference();
        }
        // Forward (possibly Derived-mutated) channels into the MLP.
        for (std::size_t i = 0u; i < NInputs; ++i) {
            ml_.set_input(i, input_channels_[i]);
        }
        ml_.process();
        if constexpr (kRouteOutputsToEngine) {
            engine_.set_params(ml_.outputs());
        }
        input_dirty_ = false;
        if constexpr (requires(Derived& d) { d.on_post_inference(); }) {
            static_cast<Derived&>(*this).on_post_inference();
        }
    }

    NISPS_HOT NISPS_FORCE_INLINE stereosample_t process(stereosample_t x) noexcept {
        return engine_.process(x);
    }

    Engine&        engine()       noexcept { return engine_; }
    const Engine&  engine() const noexcept { return engine_; }
    ML&            ml()           noexcept { return ml_; }
    const ML&      ml()     const noexcept { return ml_; }

    // ---- Common helpers ----

    // Read-only view of latest input-channel values [0, 1].
    std::span<const float> input_channels() const noexcept {
        return std::span<const float>(input_channels_.data(), NInputs);
    }
    // Mutable accessor for derived classes (e.g. SoundAnalysisMIDI splices
    // analysis features into the channel array before forwarding to ML).
    std::span<float> mutable_input_channels() noexcept {
        return std::span<float>(input_channels_.data(), NInputs);
    }

    // Voice space selection (engines that support it expose set_voice_space).
    void set_voice_space(std::size_t idx) noexcept {
        if constexpr (requires(EngineT& e) { e.set_voice_space(typename EngineT::VoiceSpace{}); }) {
            using VS = typename EngineT::VoiceSpace;
            if (idx >= EngineT::kVoiceSpaceCount) return;
            engine_.set_voice_space(static_cast<VS>(idx));
            voice_space_idx_ = idx;
            // Re-apply current params under the new voice space mapping.
            engine_.set_params(ml_.outputs());
        } else {
            (void)idx;
        }
    }
    std::size_t voice_space_index() const noexcept { return voice_space_idx_; }

    // Control event ring — modes/derived classes push, hardware glue pops.
    NISPS_FORCE_INLINE bool push_control_event(const ControlEvent& e) noexcept {
        return events_.try_push(e);
    }
    std::size_t pop_control_events(std::span<ControlEvent> out) noexcept {
        std::size_t n = 0u;
        while (n < out.size()) {
            ControlEvent e;
            if (!events_.try_pop(e)) break;
            out[n++] = e;
        }
        return n;
    }

    float sample_rate() const noexcept { return sample_rate_; }

   protected:
    float                                            sample_rate_ = 48000.f;
    EngineT                                          engine_{};
    MLPType                                          ml_;
    std::array<float, NInputs>                       input_channels_{};
    bool                                             input_dirty_ = false;
    std::size_t                                      voice_space_idx_ = 0u;
    RingBuffer<ControlEvent, kModeEventBufferSize>   events_{};
};

}  // namespace nisps
