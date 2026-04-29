// nisps/dsp/filter.hpp — Chamberlin SVF + OnePole smoother.
//
// ChamberlinSVF
//   State-variable filter with low/high/band outputs from a single topology.
//   Pre-warped via `f = 2 * sin(pi * fc / sr)` and damped by `q = 1 / Q`.
//   Stable up to ~0.45 * sample_rate; clamp upstream if you need more headroom.
//
// OnePoleSmoother<NCh>
//   Per-channel one-pole low-pass, used to smooth ML-output parameter vectors
//   before they hit the audio path. Time constant in milliseconds; the
//   coefficient `b1` is computed once per `setup()` call.

#pragma once

#include <array>
#include <cmath>
#include <cstddef>

#include "../core/perf.hpp"

namespace nisps {

class ChamberlinSVF {
   public:
    ChamberlinSVF() noexcept = default;

    void setup(float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        inv_sr_      = 1.f / sample_rate;
    }

    void reset() noexcept {
        low_  = 0.f;
        band_ = 0.f;
    }

    // Lowpass output. cutoff in Hz, resonance >= 0.5 (1 = no resonance).
    NISPS_HOT NISPS_FORCE_INLINE float lowpass(float input, float cutoff,
                                               float resonance) noexcept {
        static const float kPi = 3.14159265358979323846f;
        const float omega   = 2.f * kPi * cutoff * inv_sr_;
        const float f       = 2.f * std::sin(omega * 0.5f);
        const float q       = 1.f / resonance;
        const float qadjust = 1.f + q * f + f * f;
        low_ += f * band_;
        const float high = input - low_ - q * band_;
        band_ += f * high / qadjust;
        return low_;
    }

    NISPS_HOT NISPS_FORCE_INLINE float highpass(float input, float cutoff,
                                                float resonance) noexcept {
        static const float kPi = 3.14159265358979323846f;
        const float omega   = 2.f * kPi * cutoff * inv_sr_;
        const float f       = 2.f * std::sin(omega * 0.5f);
        const float q       = 1.f / resonance;
        const float qadjust = 1.f + q * f + f * f;
        low_ += f * band_;
        const float high = input - low_ - q * band_;
        band_ += f * high / qadjust;
        return high;
    }

    NISPS_HOT NISPS_FORCE_INLINE float bandpass(float input, float cutoff,
                                                float resonance) noexcept {
        static const float kPi = 3.14159265358979323846f;
        const float omega   = 2.f * kPi * cutoff * inv_sr_;
        const float f       = 2.f * std::sin(omega * 0.5f);
        const float q       = 1.f / resonance;
        const float qadjust = 1.f + q * f + f * f;
        low_ += f * band_;
        const float high = input - low_ - q * band_;
        band_ += f * high / qadjust;
        return band_;
    }

   private:
    float sample_rate_ = 48000.f;
    float inv_sr_      = 1.f / 48000.f;
    float low_         = 0.f;
    float band_        = 0.f;
};

template <std::size_t NCh>
class OnePoleSmoother {
   public:
    OnePoleSmoother() noexcept = default;

    void setup(float time_ms, float sample_rate) noexcept {
        // b1 such that step response decays 90% in `time_ms`.
        // b1 = 0.1 ^ (1 / (time_ms * 1e-3 * sr))
        b1_ = std::pow(0.1f, 1.f / (time_ms * 0.001f * sample_rate));
        for (auto& v : y_) v = 0.f;
    }

    NISPS_HOT NISPS_FORCE_INLINE void process(const float* x, float* y) noexcept {
        for (std::size_t c = 0; c < NCh; ++c) {
            const float xv = x[c];
            const float yv = xv + b1_ * (y_[c] - xv);
            y_[c] = yv;
            y[c]  = yv;
        }
    }

   private:
    float b1_ = 0.f;
    std::array<float, NCh> y_{};
};

// Single-channel envelope follower (positive-peak), abs-rectifier.
//   if |x| > env: env = attack_coef * (env - |x|) + |x|
//   else:         env = release_coef * (env - |x|) + |x|
// Coefficients computed via `pow(0.01, 1 / (ms * sr * 1e-3))` — same as
// maximilian's `maxiEnvelopeFollowerType`.
class EnvelopeFollower {
   public:
    EnvelopeFollower() noexcept = default;

    void setup(float sample_rate, float attack_ms, float release_ms) noexcept {
        sample_rate_ = sample_rate;
        set_attack(attack_ms);
        set_release(release_ms);
    }

    void set_attack(float attack_ms) noexcept {
        attack_ = std::pow(0.01f, 1.f / (attack_ms * sample_rate_ * 0.001f));
    }
    void set_release(float release_ms) noexcept {
        release_ = std::pow(0.01f, 1.f / (release_ms * sample_rate_ * 0.001f));
    }

    NISPS_HOT NISPS_FORCE_INLINE float play(float input) noexcept {
        const float a = std::fabs(input);
        if (a > env_) env_ = attack_  * (env_ - a) + a;
        else          env_ = release_ * (env_ - a) + a;
        return env_;
    }

    void reset() noexcept { env_ = 0.f; }
    float value() const noexcept { return env_; }

   private:
    float sample_rate_ = 48000.f;
    float attack_      = 0.f;
    float release_     = 0.f;
    float env_         = 0.f;
};

}  // namespace nisps
