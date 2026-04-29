// nisps/core/types.hpp — Foundational scalar/sample types shared by every
// engine, mode and ML component.
//
// `stereosample_t` mirrors the layout/API used in firmware
// (`src/memllib/audio/AudioDriver.hpp`) so engine code can move between
// firmware and WASM unchanged. The `__force_inline` decoration from the
// firmware version is replaced with NISPS_FORCE_INLINE so the same source
// works on host builds.

#pragma once

#include <cstddef>
#include <cstdint>

#include "perf.hpp"

namespace nisps {

using sample_t = float;
using param_t  = float;

struct stereosample_t {
    float L;
    float R;

    NISPS_FORCE_INLINE stereosample_t operator+(const stereosample_t& o) const {
        return {L + o.L, R + o.R};
    }
    NISPS_FORCE_INLINE stereosample_t& operator+=(const stereosample_t& o) {
        L += o.L; R += o.R; return *this;
    }
    NISPS_FORCE_INLINE stereosample_t operator-() const { return {-L, -R}; }
    NISPS_FORCE_INLINE stereosample_t operator-(const stereosample_t& o) const {
        return {L - o.L, R - o.R};
    }
    NISPS_FORCE_INLINE stereosample_t& operator-=(const stereosample_t& o) {
        L -= o.L; R -= o.R; return *this;
    }
    NISPS_FORCE_INLINE stereosample_t operator*(float s) const {
        return {L * s, R * s};
    }
    NISPS_FORCE_INLINE stereosample_t& operator*=(float s) {
        L *= s; R *= s; return *this;
    }
    NISPS_FORCE_INLINE float operator[](std::size_t i) const {
        return i == 0u ? L : R;
    }
};

// Audio driver / engine setup contract. Engines advertise the gain staging and
// sample-rate-hint they want; the concrete driver (firmware glue or WASM
// AudioWorklet) honours what it can. Negotiation, not imperative.
//
// `mic_input`     true ⇒ codec is configured for mic-level input
// `mic_gain_db`   dB of pre-amp gain when `mic_input` is true
// `line_level`    1..15 ish — codec line-input gain step
// `output_volume` 0..1 — analog out master
// `sample_rate`   preferred rate (Hz); 0 means "don't care"
struct DriverConfig {
    bool     mic_input     = false;
    std::uint8_t mic_gain_db   = 0;
    std::uint8_t line_level    = 0;
    float    output_volume = 1.f;
    float    sample_rate   = 0.f;
};

}  // namespace nisps
