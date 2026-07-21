// firmware/glue/audio_driver.hpp — Bridge memllib AudioDriver to nisps modes.
//
// memllib's AudioDriver delivers samples via a *block* callback shaped like:
//     void cb(float in[][kBufferSize], float out[][kBufferSize], size_t nch, size_t nf)
// The nisps `Mode` concept exposes a per-sample `process(stereosample_t)`.
//
// We register a free function as the AudioDriver block callback and pump it
// frame-by-frame into the active mode. The mode pointer is held in a
// templated free function that captures it by reference at call-site (so we
// avoid std::function indirection in the audio path).
//
// The two `stereosample_t` types — the pre-existing firmware POD and the new
// nisps namespaced one — have identical memory layout (two floats L,R) so the
// bridge does an explicit field-wise copy. No reinterpret_cast.

#pragma once

#include <Arduino.h>

#include "nisps/core/perf.hpp"
#include "nisps/core/types.hpp"
#include "audio/AudioDriver.hpp"

#include "codec_config.hpp"

namespace nisps_firmware {

// ---------------------------------------------------------------------------
// Driver configuration — the active mode decides how the codec is set up.
//
// `Mode::driver_config()` (nisps/modes/base.hpp) returns the mode's engine's
// `nisps::DriverConfig`, or the mode's own override when the engine isn't what
// consumes the audio input. Nothing here knows which mode is compiled in: the
// two entry points below are the whole of the glue, and a mode that expresses
// no opinion gets `nisps::DriverConfig{}`'s defaults, which reproduce the
// firmware's historical hardcoded codec setup.
// ---------------------------------------------------------------------------

// Field-for-field translation into memllib's codec struct, after clamping to
// what the SGTL5000 can represent (see codec_config.hpp — that part is
// host-tested in tests/cpp/test_mode_driver_config.cpp).
inline AudioDriver::codec_config_t to_codec_config(const nisps::DriverConfig& cfg) noexcept {
    const nisps::DriverConfig c = clamp_driver_config(cfg);
    AudioDriver::codec_config_t out{};
    out.mic_input     = c.mic_input;
    out.line_level    = static_cast<size_t>(c.line_level);
    out.mic_gain_dB   = static_cast<size_t>(c.mic_gain_db);
    out.output_volume = c.output_volume;
    return out;
}

// Publish the mode's preferred sample rate to the driver.
//
// MUST run before `set_sys_clock_khz(AudioDriver::GetSysClockSpeed(), ...)` —
// the system clock is derived from the rate, and `GetSysClockSpeed()` panics on
// a rate it has no divider for. `select_sample_rate` therefore resolves
// "don't care" (0) and anything unsupported to 48 kHz rather than letting it
// reach the driver. Called on core 0 in setup(), i.e. before core 1 gets past
// its `g_serial_ready` handshake and reads `GetSampleRate()`.
template <typename Mode>
inline void apply_mode_sample_rate(const Mode& mode) noexcept {
    AudioDriver::SetSampleRate(
        static_cast<size_t>(select_sample_rate(mode.driver_config().sample_rate)));
}

// Bring the audio driver up configured for the active mode: codec input source
// (mic vs line), input gain step, mic pre-amp gain, analog output volume.
// Replaces the old parameterless `AudioDriver::Setup()`, which hardcoded line
// input for every variant regardless of what the mode's engine asked for.
template <typename Mode>
inline bool setup_audio_driver(const Mode& mode) {
    return AudioDriver::Setup(to_codec_config(mode.driver_config()));
}

// Pointer to the active mode. The audio block callback reads through this.
// Set during setup1() before AudioDriver::Setup() is called. Marked
// `__not_in_flash("audio")` so the audio ISR path does not pay flash latency.
struct ActiveModeBridge {
    void* mode_ptr = nullptr;                       // type-erased Mode*
    void  (*process_block)(void*,
                           float[][kBufferSize],
                           float[][kBufferSize],
                           size_t, size_t) = nullptr;
};

// Defined in the .ino (not inline-in-header) — `inline` and `__not_in_flash`
// section attributes don't combine cleanly: comdat groups want shared
// linkage, named sections want unique ownership. The .ino owns the
// definition.
extern volatile ActiveModeBridge AUDIO_MEM g_active_mode_bridge;

// Templated trampoline: instantiated once per concrete Mode type. It does the
// per-sample loop and the field-wise stereosample_t copy. Templated rather
// than virtual because the audio path forbids virtual dispatch (architecture
// §3.5).
//
// We can't use `__not_in_flash_func(name)` on a templated function because
// that macro stringifies the function name into the section attribute, and
// the template instantiations all share a single section name — collisions
// are benign at link time but a per-instantiation section would be cleaner.
// Use `__attribute__((hot))` instead for these templated trampolines and
// rely on the platform linker default for placement.
template <typename Mode>
__attribute__((hot)) static void process_block_typed(
    void*  mode_ptr,
    float in[][kBufferSize],
    float out[][kBufferSize],
    size_t /*n_channels*/,
    size_t n_frames) {
    auto* mode = static_cast<Mode*>(mode_ptr);
    for (size_t i = 0; i < n_frames; ++i) {
        ::stereosample_t fw_in{in[0][i], in[1][i]};
        ::nisps::stereosample_t in_ns{fw_in.L, fw_in.R};
        const auto out_ns = mode->process(in_ns);
        out[0][i] = out_ns.L;
        out[1][i] = out_ns.R;

        // Modes that override `analyse(stereosample_t)` (e.g. SoundAnalysisMIDI)
        // see the input frame here, before the next sample.
        if constexpr (requires { mode->analyse(in_ns); }) {
            mode->analyse(in_ns);
        }
    }
}

// Inner forward — the .ino provides the actual block callback (with
// `__not_in_flash_func` placement) and forwards into this. Keeping the
// non-template body in a non-inline function avoids comdat / section
// conflicts.
inline void dispatch_audio_block(
    float in[][kBufferSize],
    float out[][kBufferSize],
    size_t n_channels,
    size_t n_frames) {
    auto& bridge = const_cast<ActiveModeBridge&>(g_active_mode_bridge);
    if (bridge.mode_ptr == nullptr || bridge.process_block == nullptr) {
        for (size_t i = 0; i < n_frames; ++i) {
            out[0][i] = 0.f;
            out[1][i] = 0.f;
        }
        return;
    }
    bridge.process_block(bridge.mode_ptr, in, out, n_channels, n_frames);
}

// Public registration: call from setup1() with the active mode and the
// `__not_in_flash_func`-placed block callback that forwards into
// `dispatch_audio_block`.
template <typename Mode>
inline void register_audio_engine(Mode& mode, audiocallback_block_fptr_t block_cb) {
    ActiveModeBridge b{};
    b.mode_ptr      = static_cast<void*>(&mode);
    b.process_block = &process_block_typed<Mode>;
    __sync_synchronize();
    const_cast<ActiveModeBridge&>(g_active_mode_bridge) = b;
    __sync_synchronize();

    AudioDriver::SetBlockCallback(block_cb);
}

}  // namespace nisps_firmware
