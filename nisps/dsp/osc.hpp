// nisps/dsp/osc.hpp — oscillators.
//
// SineOsc — naive sine via sinf(phase * TWO_PI), used by the firmware
//   selftest's audio sweep. For high-fidelity needs, replace with a wavetable.
//
// PAFOperator — Phase-Aligned Formant operator. Direct port of `maxiPAFOperator`
//   in memllib. Maintains a static gauss/cauchy table populated on first
//   construction; uses a Padé-style cosine approximation in the carrier path.
//   See https://msp.ucsd.edu/Publications/icmc91-paf.pdf for theory.
//
// FMOp — single-operator FM building block, used by Elysiamorf.

#pragma once

#include <array>
#include <cmath>
#include <cstddef>

#include "../core/perf.hpp"

namespace nisps {

namespace detail {
inline constexpr float kPi    = 3.14159265358979323846f;
inline constexpr float kTwoPi = 6.28318530717958647692f;
}  // namespace detail

class SineOsc {
   public:
    SineOsc() noexcept = default;

    void setup(float sample_rate) noexcept {
        inv_sr_ = 1.f / sample_rate;
    }

    NISPS_HOT NISPS_FORCE_INLINE float sine(float frequency) noexcept {
        const float y = std::sin(phase_ * detail::kTwoPi);
        phase_ += inv_sr_ * frequency;
        if (phase_ >= 1.f) phase_ -= 1.f;
        return y;
    }

    void reset(float phase = 0.f) noexcept { phase_ = phase; }

   private:
    float inv_sr_ = 1.f / 48000.f;
    float phase_  = 0.f;
};

// Phase-Aligned Formant operator — port of maxiPAFOperator. The Gaussian and
// Cauchy lookup tables are generated once at first call to `init()` (file-
// local static; safe in single-threaded firmware audio path).
class PAFOperator {
   public:
    static constexpr std::size_t kLogTabSize = 10u;
    static constexpr std::size_t kTabSize    = 1u << kLogTabSize;
    static constexpr std::size_t kTabRange   = 3u;

    struct TabPoint {
        float y;
        float diff;
    };

    PAFOperator() noexcept = default;

    void init() noexcept {
        if (!tabs_generated()) generate_tables();
        x_held_freq_       = 1.f;
        x_held_intcar_     = 0.f;
        x_held_fraccar_    = 0.f;
        x_held_bwquotient_ = 0.f;
        x_phase_           = 0.f;
        x_shiftphase_      = 0.f;
        x_vibphase_        = 0.f;
        x_triggerme_       = 0;
    }

    void setsr(float sr) noexcept { x_isr_ = 1.f / sr; }

    NISPS_HOT NISPS_FORCE_INLINE float play(float freqval, float cfval, float bwval,
                                            float vibval, float vfrval,
                                            float shiftval, bool cauchy = false) noexcept {
        static const float kHalfsineLim   = 0.997f * static_cast<float>(kTabRange);
        static const float kTabRangeRcpr  = 1.f / static_cast<float>(kTabRange);
        static const float kTabScale      = static_cast<float>(kTabSize) * kTabRangeRcpr;
        static const float kPafA1 = 4.f * (detail::kPi * 0.5f);
        static const float kPafA3 = 64.f * (2.5f - detail::kPi);
        static const float kPafA5 = 1024.f * ((detail::kPi * 0.5f) - 1.5f);

        const TabPoint* table = cauchy ? paf_cauchy() : paf_gauss();

        x_shiftphase_ -= std::floor(x_shiftphase_);

        float bwquotient = bwval / freqval;
        float future_vib_phase = x_vibphase_ + 1.f * x_isr_ * vfrval;
        future_vib_phase -= std::floor(future_vib_phase);
        x_vibphase_ = future_vib_phase;

        float sinvib;
        if (future_vib_phase > 0.5f) {
            sinvib = 1.f - 16.f * (0.75f - future_vib_phase) * (0.75f - future_vib_phase);
        } else {
            sinvib = -1.f + 16.f * (0.25f - future_vib_phase) * (0.25f - future_vib_phase);
        }

        freqval = freqval * (1.f + vibval * sinvib);
        const float inv_freqval = 1.f / freqval;
        shiftval *= x_isr_;

        if (x_phase_ == 0.f || x_triggerme_) {
            const float cf_over_freq = cfval * inv_freqval;
            x_held_freq_       = freqval * x_isr_;
            x_held_intcar_     = static_cast<float>(static_cast<int>(cf_over_freq));
            x_held_fraccar_    = cf_over_freq - x_held_intcar_;
            x_held_bwquotient_ = bwquotient;
            x_triggerme_       = 0;
        }

        const float new_phase_raw = x_phase_ + x_held_freq_;
        const float new_phase     = new_phase_raw - std::floor(new_phase_raw);
        const float fphase        = 2.f * new_phase - 1.f;

        if (new_phase < x_phase_) [[unlikely]] {
            const float cf_over_freq = cfval * inv_freqval;
            x_held_freq_       = freqval * x_isr_;
            x_held_intcar_     = std::floor(cf_over_freq);
            x_held_fraccar_    = cf_over_freq - x_held_intcar_;
            x_held_bwquotient_ = bwquotient;
        }
        x_phase_ = new_phase;

        float fcarphase1 = new_phase * x_held_intcar_ + x_shiftphase_;
        fcarphase1 -= std::floor(fcarphase1);
        float fcarphase2 = fcarphase1 + new_phase;
        fcarphase2 -= std::floor(fcarphase2);

        x_shiftphase_ += shiftval;

        float g = (fcarphase1 > 0.5f) ? (fcarphase1 - 0.75f) : (0.25f - fcarphase1);
        const float g2a = g * g;
        const float g3a = g * g2a;
        const float cosine1 = g * kPafA1 + g3a * kPafA3 + g2a * g3a * kPafA5;

        g = (fcarphase2 > 0.5f) ? (fcarphase2 - 0.75f) : (0.25f - fcarphase2);
        const float g2b = g * g;
        const float g3b = g * g2b;
        const float cosine2 = g * kPafA1 + g3b * kPafA3 + g2b * g3b * kPafA5;

        const float carrier = cosine1 + x_held_fraccar_ * (cosine2 - cosine1);

        float halfsine = x_held_bwquotient_ * (1.f - fphase * fphase);
        if (halfsine > kHalfsineLim) halfsine = kHalfsineLim;

        const float halfsine_scaled = halfsine * kTabScale;
        int table_index = static_cast<int>(halfsine_scaled);
        const float tabfrac = halfsine_scaled - static_cast<float>(table_index);
        if (table_index < 0) table_index = 0;
        if (table_index > static_cast<int>(kTabSize) - 2) table_index = static_cast<int>(kTabSize) - 2;

        const TabPoint& p = table[table_index];
        return carrier * (p.y + tabfrac * p.diff);
    }

    void trigger() noexcept { x_triggerme_ = 1; }

   private:
    // Static tables, lazily generated. C++ guarantees thread-safe init on
    // first reference to the local static, which suffices since firmware
    // boots single-threaded.
    static bool& tabs_generated() noexcept {
        static bool flag = false;
        return flag;
    }
    static TabPoint* paf_gauss() noexcept {
        static TabPoint table[kTabSize];
        return table;
    }
    static TabPoint* paf_cauchy() noexcept {
        static TabPoint table[kTabSize];
        return table;
    }
    static void generate_tables() noexcept {
        const float cauchy_val      = 1.f / (1.f + static_cast<float>(kTabRange) * static_cast<float>(kTabRange));
        const float cauchy_slope    = (-2.f * static_cast<float>(kTabRange)) * cauchy_val * cauchy_val;
        const float addsq           = -cauchy_slope / (2.f * static_cast<float>(kTabRange));
        const float fake_at3        = cauchy_val + addsq * static_cast<float>(kTabRange) * static_cast<float>(kTabRange);
        const float resize          = 1.f / (1.f - fake_at3);

        TabPoint* gauss  = paf_gauss();
        TabPoint* cauchy = paf_cauchy();

        for (std::size_t i = 0u; i <= kTabSize; ++i) {
            const float f = static_cast<float>(i) * (static_cast<float>(kTabRange) / static_cast<float>(kTabSize));
            const float gauss_val      = std::exp(-f * f);
            const float cauchy_genuine = 1.f / (1.f + f * f);
            const float cauchy_fake    = cauchy_genuine + addsq * f * f;
            const float cauchy_renorm  = (cauchy_fake - 1.f) * resize + 1.f;
            if (i != kTabSize) {
                gauss[i].y  = gauss_val;
                cauchy[i].y = cauchy_renorm;
            }
            if (i != 0u) {
                gauss[i - 1u].diff  = gauss_val - gauss[i - 1u].y;
                cauchy[i - 1u].diff = cauchy_renorm - cauchy[i - 1u].y;
            }
        }
        tabs_generated() = true;
    }

    float x_isr_             = 1.f / 48000.f;
    float x_held_freq_       = 1.f;
    float x_held_intcar_     = 0.f;
    float x_held_fraccar_    = 0.f;
    float x_held_bwquotient_ = 0.f;
    float x_phase_           = 0.f;
    float x_shiftphase_      = 0.f;
    float x_vibphase_        = 0.f;
    int   x_triggerme_       = 0;
};

// Single-operator FM. `process(phase, modIn, freqMul, modIndex, fbLevel)`
// matches the FMOp in modes/AudioApps/ElysiamorfAudioApp.hpp.
class FMOp {
   public:
    FMOp() noexcept = default;

    NISPS_HOT NISPS_FORCE_INLINE float process(float phase, float mod_in,
                                               float freq_mul, float mod_index,
                                               float fb_level) noexcept {
        float p = std::fmod(phase * freq_mul + mod_index * mod_in
                            + fb_level * prev_, 1.f);
        if (p < 0.f) p += 1.f;
        const float out = std::sin(detail::kTwoPi * p);
        prev_ = out;
        return out;
    }

    void reset() noexcept { prev_ = 0.f; }

   private:
    float prev_ = 0.f;
};

}  // namespace nisps
