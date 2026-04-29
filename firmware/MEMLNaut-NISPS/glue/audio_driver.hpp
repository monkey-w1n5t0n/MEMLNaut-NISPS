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
//
// All hot code lives in flash-resident SRAM via NISPS_AUDIO_FUNC.

#pragma once

#include <Arduino.h>

#include "../src/nisps/core/perf.hpp"
#include "../src/nisps/core/types.hpp"
#include "../src/memllib/audio/AudioDriver.hpp"

namespace nisps_firmware {

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
