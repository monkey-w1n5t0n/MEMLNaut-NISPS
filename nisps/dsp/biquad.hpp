// nisps/dsp/biquad.hpp — Biquad filter (PEAK/LOWSHELF/HIGHSHELF/LPF/HPF/BPF/NOTCH).
//
// Direct-form-II transposed implementation, ported from maximilian's
// `maxiBiquad`. Sample-rate is bound at construction time (no global maxiSettings).
// All coefficients computed via standard cookbook formulas (RBJ-style).
//
// Performance:
//   - Per-sample play() is annotated NISPS_HOT/NISPS_FORCE_INLINE.
//   - Denormal flush at the state vars to avoid cliff penalties on x86 / Cortex.
//
// Units:
//   - cutoff in Hz
//   - Q dimensionless (use 0.707 for -3dB Butterworth)
//   - peak_gain_db in dB (positive=boost, negative=cut, ignored for LP/HP/BP/NOTCH)

#pragma once

#include <cmath>
#include <cstddef>

#include "../core/perf.hpp"

namespace nisps {

class Biquad {
   public:
    enum class Type {
        LowPass,
        HighPass,
        BandPass,
        Notch,
        Peak,
        LowShelf,
        HighShelf,
    };

    Biquad() = default;

    // sample_rate in Hz. Coefficients are 0 until set() is called.
    explicit Biquad(float sample_rate) noexcept
        : sample_rate_(sample_rate), inv_sr_(1.f / sample_rate) {}

    void setup(float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        inv_sr_      = 1.f / sample_rate;
    }

    void set(Type type, float cutoff, float q, float peak_gain_db) noexcept {
        static const float kPi = 3.14159265358979323846f;
        static const float kSqrt2 = 1.41421356237f;

        const float k     = std::tan(kPi * cutoff * inv_sr_);
        const float k2    = k * k;
        const float k_q   = k / q;
        const float denom = 1.f + k_q + k2;

        switch (type) {
            case Type::LowPass: {
                const float n = 1.f / denom;
                a0_ = k2 * n;
                a1_ = 2.f * a0_;
                a2_ = a0_;
                b1_ = 2.f * (k2 - 1.f) * n;
                b2_ = (1.f - k_q + k2) * n;
                break;
            }
            case Type::HighPass: {
                const float n = 1.f / denom;
                a0_ = n;
                a1_ = -2.f * a0_;
                a2_ = a0_;
                b1_ = 2.f * (k2 - 1.f) * n;
                b2_ = (1.f - k_q + k2) * n;
                break;
            }
            case Type::BandPass: {
                const float n = 1.f / denom;
                a0_ = k_q * n;
                a1_ = 0.f;
                a2_ = -a0_;
                b1_ = 2.f * (k2 - 1.f) * n;
                b2_ = (1.f - k_q + k2) * n;
                break;
            }
            case Type::Notch: {
                const float n = 1.f / denom;
                const float c = 1.f + k2;
                a0_ = c * n;
                a1_ = 2.f * (k2 - 1.f) * n;
                a2_ = a0_;
                b1_ = a1_;
                b2_ = (1.f - k_q + k2) * n;
                break;
            }
            case Type::Peak: {
                const float v_amp = std::pow(10.f, std::fabs(peak_gain_db) * 0.05f);
                const float v_q   = v_amp / q;
                if (peak_gain_db >= 0.f) {
                    const float n = 1.f / denom;
                    a0_ = (1.f + v_q * k + k2) * n;
                    a1_ = 2.f * (k2 - 1.f) * n;
                    a2_ = (1.f - v_q * k + k2) * n;
                    b1_ = a1_;
                    b2_ = (1.f - k_q + k2) * n;
                } else {
                    const float n = 1.f / (1.f + v_q * k + k2);
                    a0_ = denom * n;
                    a1_ = 2.f * (k2 - 1.f) * n;
                    a2_ = (1.f - k_q + k2) * n;
                    b1_ = a1_;
                    b2_ = (1.f - v_q * k + k2) * n;
                }
                break;
            }
            case Type::LowShelf: {
                const float v_amp   = std::pow(10.f, std::fabs(peak_gain_db) * 0.05f);
                const float vk2     = v_amp * k2;
                const float sqrt2v  = std::sqrt(2.f * v_amp);
                if (peak_gain_db >= 0.f) {
                    const float n = 1.f / (1.f + kSqrt2 * k + k2);
                    a0_ = (1.f + sqrt2v * k + vk2) * n;
                    a1_ = 2.f * (vk2 - 1.f) * n;
                    a2_ = (1.f - sqrt2v * k + vk2) * n;
                    b1_ = 2.f * (k2 - 1.f) * n;
                    b2_ = (1.f - kSqrt2 * k + k2) * n;
                } else {
                    const float n = 1.f / (1.f + sqrt2v * k + vk2);
                    a0_ = (1.f + kSqrt2 * k + k2) * n;
                    a1_ = 2.f * (k2 - 1.f) * n;
                    a2_ = (1.f - kSqrt2 * k + k2) * n;
                    b1_ = 2.f * (vk2 - 1.f) * n;
                    b2_ = (1.f - sqrt2v * k + vk2) * n;
                }
                break;
            }
            case Type::HighShelf: {
                const float v_amp  = std::pow(10.f, std::fabs(peak_gain_db) * 0.05f);
                const float sqrt2v = std::sqrt(2.f * v_amp);
                if (peak_gain_db >= 0.f) {
                    const float n = 1.f / (1.f + kSqrt2 * k + k2);
                    a0_ = (v_amp + sqrt2v * k + k2) * n;
                    a1_ = 2.f * (k2 - v_amp) * n;
                    a2_ = (v_amp - sqrt2v * k + k2) * n;
                    b1_ = 2.f * (k2 - 1.f) * n;
                    b2_ = (1.f - kSqrt2 * k + k2) * n;
                } else {
                    const float n = 1.f / (v_amp + sqrt2v * k + k2);
                    a0_ = (1.f + kSqrt2 * k + k2) * n;
                    a1_ = 2.f * (k2 - 1.f) * n;
                    a2_ = (1.f - kSqrt2 * k + k2) * n;
                    b1_ = 2.f * (k2 - v_amp) * n;
                    b2_ = (v_amp - sqrt2v * k + k2) * n;
                }
                break;
            }
        }
    }

    NISPS_HOT NISPS_FORCE_INLINE float play(float input) noexcept {
        const float v0 = input - (b1_ * v1_) - (b2_ * v2_);
        const float y  = (a0_ * v0) + (a1_ * v1_) + (a2_ * v2_);
        v2_ = v1_;
        v1_ = v0;
        // Flush denormals.
        static const float kEps = 1e-15f;
        if (std::fabs(v1_) < kEps) v1_ = 0.f;
        if (std::fabs(v2_) < kEps) v2_ = 0.f;
        return y;
    }

    void reset() noexcept { v1_ = 0.f; v2_ = 0.f; }

   private:
    float sample_rate_ = 48000.f;
    float inv_sr_      = 1.f / 48000.f;

    float a0_ = 0.f, a1_ = 0.f, a2_ = 0.f;
    float b1_ = 0.f, b2_ = 0.f;
    float v1_ = 0.f, v2_ = 0.f;
};

}  // namespace nisps
