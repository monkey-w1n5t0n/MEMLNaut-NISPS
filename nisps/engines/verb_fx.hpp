// nisps/engines/verb_fx.hpp — 47-param reverb/delay/filterbank effects engine.
//
// Mirrors firmware VerbFXAudioApp. Pipeline:
//   - Filterbank (8× SVF bandpass) injects mid into delay/verb paths.
//   - 3 dynamic delay lines (long/medium/short) with configurable feedback.
//   - 8× LP-comb feedback bank + 4× allpass = Freeverb-style reverb tail.
//   - Cross-fade between delay sum and verb output via verbVsDelayLevel.
//   - Wet/dry mix.
//
// Voice-space lambdas are stored as function pointers and dispatched in
// `set_params()`. This adds one indirection per non-RT param update — the
// audio path itself is unaffected. Keeps each voice-space body in its own
// (private static) function for readability and lets the compiler inline.

#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"
#include "../dsp/delay.hpp"
#include "../dsp/filter.hpp"
#include "../dsp/reverb.hpp"

namespace nisps {

class VerbFXEngine {
   public:
    static constexpr std::size_t kNParams = 47u;
    static constexpr std::size_t param_count() noexcept { return kNParams; }
    static constexpr std::string_view engine_id() noexcept { return "verb_fx"; }

    enum class VoiceSpace : std::size_t {
        Default   = 0,
        Resonant  = 1,
        Soft      = 2,
        Cathedral = 3,
        Shimmer   = 4,
        Chamber   = 5,
        Metallic  = 6,
        Granular  = 7,
        Diffuse   = 8,
        Dark      = 9,
        Bright    = 10,
        Harmonic  = 11,
        Count     = 12,
    };
    static constexpr std::size_t kVoiceSpaceCount = static_cast<std::size_t>(VoiceSpace::Count);
    static constexpr std::array<std::string_view, kVoiceSpaceCount> kVoiceSpaceNames = {
        "Default", "Resonant", "Soft", "Cathedral", "Shimmer", "Chamber",
        "Metallic", "Granular", "Diffuse", "Dark", "Bright", "Harmonic"};

    void set_voice_space(VoiceSpace vs) noexcept { voice_space_ = vs; }
    VoiceSpace voice_space() const noexcept { return voice_space_; }

    void setup(float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        smoother_.setup(150.f, sample_rate);
        for (auto& v : nn_outputs_)    v = 0.f;
        for (auto& v : smooth_params_) v = 0.f;
        for (auto* fb : {&fb0_, &fb1_, &fb2_, &fb3_, &fb4_, &fb5_, &fb6_, &fb7_}) {
            fb->setup(sample_rate);
        }
    }

    void set_params(std::span<const float> params) noexcept {
        if (params.size() < kNParams) return;
        for (std::size_t i = 0u; i < kNParams; ++i) nn_outputs_[i] = params[i];
    }

    NISPS_HOT NISPS_FORCE_INLINE stereosample_t process(stereosample_t x) noexcept {
        smoother_.process(nn_outputs_.data(), smooth_params_.data());
        apply_voice_space();

        const float mix = x.L + x.R;

        // Cross-fade levels between filterbank and delay-feedback into the bank.
        const float fb_xfade_a   = std::sqrt(filter_bank_delay_xfade_);
        const float fb_xfade_inv = std::sqrt(1.f - filter_bank_delay_xfade_);

        // FILTERBANK
        const float fb_in = mix + (fb_xfade_a * ddelay_feedback_);
        float fb_out;
        if (enable_filterbank_) {
            fb_out  = fb0_.bandpass(fb_in, fb_freqs_[0], fb_res_[0]);
            fb_out += fb1_.bandpass(fb_in, fb_freqs_[1], fb_res_[1]);
            fb_out += fb2_.bandpass(fb_in, fb_freqs_[2], fb_res_[2]);
            fb_out += fb3_.bandpass(fb_in, fb_freqs_[3], fb_res_[3]);
            fb_out += fb4_.bandpass(fb_in, fb_freqs_[4], fb_res_[4]);
            fb_out += fb5_.bandpass(fb_in, fb_freqs_[5], fb_res_[5]);
            fb_out += fb6_.bandpass(fb_in, fb_freqs_[6], fb_res_[6]);
            fb_out += fb7_.bandpass(fb_in, fb_freqs_[7], fb_res_[7]);
            fb_out *= 0.125f;
        } else {
            fb_out = mix;
        }

        // DELAYS
        const float delay_in = fb_out;
        const float d_long  = enable_long_delay_   ? ddelay_long_.read(ddelay_time_)    : 0.f;
        ddelay_long_.write((delay_in * fb_xfade_inv)
                           + ((ddelay_feedback_ + (delay_in * fb_xfade_a)) * d_long));

        const float d_med   = enable_medium_delay_ ? ddelay_med_.read(ddelay_time1_)    : 0.f;
        ddelay_med_.write(delay_in + (ddelay_feedback1_ * d_med));

        const float d_short = enable_short_delay_  ? ddelay_short_.read(ddelay_time2_)  : 0.f;
        ddelay_short_.write(delay_in + (ddelay_feedback2_ * d_short));

        // Crossfade morph (constant-power-ish blend between three lanes).
        const float a = std::min(delay_morph_ * 2.f, 1.f);
        const float b = std::max(delay_morph_ * 2.f - 1.f, 0.f);
        static const float kEqualMix = 0.57735f;  // 1/sqrt(3)
        const float w_short = kEqualMix + delay_blend_ * (std::sqrt(1.f - a)               - kEqualMix);
        const float w_med   = kEqualMix + delay_blend_ * (std::sqrt(a) * std::sqrt(1.f - b) - kEqualMix);
        const float w_long  = kEqualMix + delay_blend_ * (std::sqrt(a) * std::sqrt(b)       - kEqualMix);
        const float delay_sum = (w_short * d_short) + (w_med * d_med) + (w_long * d_long);

        // VERB (Freeverb-style: 8 lp-comb in parallel, then 4 allpass in series)
        // Note: firmware feeds `filterBankOut` straight into the verb regardless
        // of `enableReverb` (the gating only controls the verbIn variable, which
        // is then unused). Keep that exact behaviour for sonic parity.
        float verb_out = 0.f;
        verb_out  = lpcomb0_.process(fb_out, kSizeComb0, lp_fb_[0], lp_cutoff_[0]);
        verb_out += lpcomb1_.process(fb_out, kSizeComb1, lp_fb_[1], lp_cutoff_[1]);
        verb_out += lpcomb2_.process(fb_out, kSizeComb2, lp_fb_[2], lp_cutoff_[2]);
        verb_out += lpcomb3_.process(fb_out, kSizeComb3, lp_fb_[3], lp_cutoff_[3]);
        verb_out += lpcomb4_.process(fb_out, kSizeComb4, lp_fb_[4], lp_cutoff_[4]);
        verb_out += lpcomb5_.process(fb_out, kSizeComb5, lp_fb_[5], lp_cutoff_[5]);
        verb_out += lpcomb6_.process(fb_out, kSizeComb6, lp_fb_[6], lp_cutoff_[6]);
        verb_out += lpcomb7_.process(fb_out, kSizeComb7, lp_fb_[7], lp_cutoff_[7]);

        verb_out = allp0_.process(verb_out, kSizeAllP0, allp_fb_[0]);
        verb_out = allp1_.process(verb_out, kSizeAllP1, allp_fb_[1]);
        verb_out = allp2_.process(verb_out, kSizeAllP2, allp_fb_[2]);
        verb_out = allp3_.process(verb_out, kSizeAllP3, allp_fb_[3]);

        // Cross-fade verb vs delay
        float y = (std::sqrt(verb_vs_delay_) * delay_sum)
                + (std::sqrt(1.f - verb_vs_delay_) * verb_out);

        // Wet/dry
        y = (y * std::sqrt(wet_dry_)) + (mix * std::sqrt(1.f - wet_dry_));
        return {y, y};
    }

    DriverConfig driver_config() const noexcept {
        DriverConfig c;
        c.line_level    = 6u;
        c.output_volume = 0.9f;
        return c;
    }

    void set_enable_filterbank(bool v)    noexcept { enable_filterbank_ = v; }
    void set_enable_short_delay(bool v)   noexcept { enable_short_delay_ = v; }
    void set_enable_medium_delay(bool v)  noexcept { enable_medium_delay_ = v; }
    void set_enable_long_delay(bool v)    noexcept { enable_long_delay_ = v; }
    void set_wet_dry_override(float v)    noexcept { wet_dry_ = v; }

   private:
    static constexpr std::size_t kSizeAllP0 = 244u;
    static constexpr std::size_t kSizeAllP1 = 605u;
    static constexpr std::size_t kSizeAllP2 = 479u;
    static constexpr std::size_t kSizeAllP3 = 371u;

    static constexpr std::size_t kSizeComb0 = 1694u;
    static constexpr std::size_t kSizeComb1 = 1759u;
    static constexpr std::size_t kSizeComb2 = 1622u;
    static constexpr std::size_t kSizeComb3 = 1547u;
    static constexpr std::size_t kSizeComb4 = 1379u;
    static constexpr std::size_t kSizeComb5 = 1464u;
    static constexpr std::size_t kSizeComb6 = 1283u;
    static constexpr std::size_t kSizeComb7 = 1205u;

    NISPS_FORCE_INLINE void apply_voice_space() noexcept {
        const float* p = smooth_params_.data();
        switch (voice_space_) {
            case VoiceSpace::Default:   apply_default(p);   break;
            case VoiceSpace::Resonant:  apply_resonant(p);  break;
            case VoiceSpace::Soft:      apply_soft(p);      break;
            case VoiceSpace::Cathedral: apply_cathedral(p); break;
            case VoiceSpace::Shimmer:   apply_shimmer(p);   break;
            case VoiceSpace::Chamber:   apply_chamber(p);   break;
            case VoiceSpace::Metallic:  apply_metallic(p);  break;
            case VoiceSpace::Granular:  apply_granular(p);  break;
            case VoiceSpace::Diffuse:   apply_diffuse(p);   break;
            case VoiceSpace::Dark:      apply_dark(p);      break;
            case VoiceSpace::Bright:    apply_bright(p);    break;
            case VoiceSpace::Harmonic:  apply_harmonic(p);  break;
            case VoiceSpace::Count: break;
        }
    }

    // Helpers that compute filterbank freqs as octaves-of-40Hz (the dominant
    // pattern across Default/Resonant/Soft/Cathedral/Shimmer/Chamber).
    NISPS_FORCE_INLINE void filterbank_octaves_default(const float* p) noexcept {
        fb_freqs_[0] = 40.f   + p[21] * 40.f;
        fb_freqs_[1] = 80.f   + p[22] * 80.f;
        fb_freqs_[2] = 160.f  + p[23] * 160.f;
        fb_freqs_[3] = 320.f  + p[24] * 320.f;
        fb_freqs_[4] = 640.f  + p[25] * 640.f;
        fb_freqs_[5] = 1280.f + p[26] * 1280.f;
        fb_freqs_[6] = 2560.f + p[27] * 2560.f;
        fb_freqs_[7] = 5120.f + p[28] * 5120.f;
    }
    NISPS_FORCE_INLINE void filterbank_res_linear(const float* p, float scale) noexcept {
        for (std::size_t i = 0u; i < 8u; ++i) fb_res_[i] = 1.f + p[29 + i] * scale;
    }
    NISPS_FORCE_INLINE void filterbank_res_squared(const float* p, float scale) noexcept {
        for (std::size_t i = 0u; i < 8u; ++i) fb_res_[i] = 1.f + (p[29 + i] * p[29 + i]) * scale;
    }
    NISPS_FORCE_INLINE void filterbank_res_sqrt(const float* p, float scale) noexcept {
        for (std::size_t i = 0u; i < 8u; ++i) fb_res_[i] = 1.f + std::sqrt(p[29 + i]) * scale;
    }
    NISPS_FORCE_INLINE void common_delays_linear(const float* p) noexcept {
        ddelay_time_      = 10.f + p[37] * 16373.f;
        ddelay_feedback_  = p[38] * 0.98f;
        ddelay_time1_     = 10.f + p[39] * 2037.f;
        ddelay_feedback1_ = p[40] * 0.98f;
        ddelay_time2_     = 10.f + p[41] * 501.f;
        ddelay_feedback2_ = p[42] * 0.98f;
    }

    void apply_default(const float* p) noexcept {
        filter_bank_delay_xfade_ = p[0];
        for (std::size_t i = 0u; i < 8u; ++i) {
            lp_fb_[i]     = p[1 + 2 * i] * (i == 5 ? 0.98f : 0.9f);
            lp_cutoff_[i] = p[2 + 2 * i] * 0.5f + 0.05f;
        }
        for (std::size_t i = 0u; i < 4u; ++i) allp_fb_[i] = p[17 + i] * 0.9f;
        filterbank_octaves_default(p);
        filterbank_res_linear(p, 19.f);
        common_delays_linear(p);
        verb_vs_delay_     = p[43];
        delay_morph_       = p[45];
        delay_blend_       = p[46];
    }

    void apply_resonant(const float* p) noexcept {
        filter_bank_delay_xfade_ = p[0];
        for (std::size_t i = 0u; i < 8u; ++i) {
            lp_fb_[i]     = p[1 + 2 * i] * 0.99f;
            lp_cutoff_[i] = p[2 + 2 * i] * 0.5f + 0.05f;
        }
        for (std::size_t i = 0u; i < 4u; ++i) allp_fb_[i] = p[17 + i] * 0.99f;
        filterbank_octaves_default(p);
        filterbank_res_sqrt(p, 25.f);
        ddelay_time_      = 10.f + p[37] * 16373.f;
        ddelay_feedback_  = p[38] * 0.99f;
        ddelay_time1_     = 10.f + p[39] * 2037.f;
        ddelay_feedback1_ = p[40] * 0.99f;
        ddelay_time2_     = 10.f + p[41] * 501.f;
        ddelay_feedback2_ = p[42] * 0.99f;
        verb_vs_delay_ = p[43];
        delay_morph_   = p[45]; delay_blend_   = p[46];
    }

    void apply_soft(const float* p) noexcept {
        filter_bank_delay_xfade_ = p[0];
        for (std::size_t i = 0u; i < 8u; ++i) {
            const float v = p[1 + 2 * i];
            lp_fb_[i]     = v * v * (i == 5 ? 0.98f : 0.9f);
            lp_cutoff_[i] = p[2 + 2 * i] * 0.5f + 0.05f;
        }
        for (std::size_t i = 0u; i < 4u; ++i) {
            const float v = p[17 + i];
            allp_fb_[i]   = v * v * 0.9f;
        }
        filterbank_octaves_default(p);
        filterbank_res_squared(p, 19.f);
        ddelay_time_      = 10.f + p[37] * 16373.f;
        ddelay_feedback_  = p[38] * p[38] * 0.98f;
        ddelay_time1_     = 10.f + p[39] * 2037.f;
        ddelay_feedback1_ = p[40] * p[40] * 0.98f;
        ddelay_time2_     = 10.f + p[41] * 501.f;
        ddelay_feedback2_ = p[42] * p[42] * 0.98f;
        verb_vs_delay_ = p[43];
        delay_morph_   = p[45]; delay_blend_   = p[46];
    }

    void apply_cathedral(const float* p) noexcept {
        filter_bank_delay_xfade_ = p[0];
        for (std::size_t i = 0u; i < 8u; ++i) {
            lp_fb_[i]     = std::sqrt(p[1 + 2 * i]) * 0.98f;
            lp_cutoff_[i] = p[2 + 2 * i] * 0.3f + 0.02f;
        }
        for (std::size_t i = 0u; i < 4u; ++i) allp_fb_[i] = std::sqrt(p[17 + i]) * 0.9f;
        filterbank_octaves_default(p);
        filterbank_res_linear(p, 19.f);
        ddelay_time_      = 10.f + std::sqrt(p[37]) * 16373.f;
        ddelay_feedback_  = std::sqrt(p[38]) * 0.98f;
        ddelay_time1_     = 10.f + std::sqrt(p[39]) * 2037.f;
        ddelay_feedback1_ = std::sqrt(p[40]) * 0.98f;
        ddelay_time2_     = 10.f + std::sqrt(p[41]) * 501.f;
        ddelay_feedback2_ = std::sqrt(p[42]) * 0.98f;
        verb_vs_delay_ = p[43] * p[43];
        delay_morph_   = p[45]; delay_blend_ = p[46];
    }

    void apply_shimmer(const float* p) noexcept {
        filter_bank_delay_xfade_ = p[0];
        for (std::size_t i = 0u; i < 8u; ++i) {
            lp_fb_[i]     = std::sqrt(p[1 + 2 * i]) * 0.98f;
            lp_cutoff_[i] = p[2 + 2 * i] * 0.4f + 0.05f;
        }
        for (std::size_t i = 0u; i < 4u; ++i) allp_fb_[i] = std::sqrt(p[17 + i]) * 0.99f;
        filterbank_octaves_default(p);
        filterbank_res_sqrt(p, 19.f);
        ddelay_time_      = 10.f + p[37] * 16373.f;
        ddelay_feedback_  = std::sqrt(p[38]) * 0.95f;
        ddelay_time1_     = 10.f + p[39] * 2037.f;
        ddelay_feedback1_ = std::sqrt(p[40]) * 0.95f;
        ddelay_time2_     = 10.f + p[41] * 501.f;
        ddelay_feedback2_ = std::sqrt(p[42]) * 0.95f;
        verb_vs_delay_ = p[43] * p[43];
        delay_morph_   = p[45]; delay_blend_ = p[46];
    }

    void apply_chamber(const float* p) noexcept {
        filter_bank_delay_xfade_ = p[0];
        for (std::size_t i = 0u; i < 8u; ++i) {
            const float v = p[1 + 2 * i];
            lp_fb_[i]     = v * v * 0.9f;
            lp_cutoff_[i] = p[2 + 2 * i] * 0.5f + 0.1f;
        }
        for (std::size_t i = 0u; i < 4u; ++i) {
            const float v = p[17 + i];
            allp_fb_[i]   = v * v * 0.9f;
        }
        filterbank_octaves_default(p);
        filterbank_res_squared(p, 19.f);
        ddelay_time_      = 10.f + p[37] * p[37] * 16373.f;
        ddelay_feedback_  = p[38] * p[38] * 0.98f;
        ddelay_time1_     = 10.f + p[39] * p[39] * 2037.f;
        ddelay_feedback1_ = p[40] * p[40] * 0.98f;
        ddelay_time2_     = 10.f + p[41] * p[41] * 501.f;
        ddelay_feedback2_ = p[42] * p[42] * 0.98f;
        verb_vs_delay_ = p[43];
        delay_morph_   = p[45]; delay_blend_ = p[46];
    }

    void apply_metallic(const float* p) noexcept {
        filter_bank_delay_xfade_ = p[0];
        for (std::size_t i = 0u; i < 8u; ++i) {
            lp_fb_[i]     = p[1 + 2 * i] * 0.9f;
            lp_cutoff_[i] = p[2 + 2 * i] * 0.5f + 0.05f;
        }
        for (std::size_t i = 0u; i < 4u; ++i) allp_fb_[i] = std::sqrt(p[17 + i]) * 0.95f;
        filterbank_octaves_default(p);
        // Alternating sqrt/squared res — metallic peaky character.
        for (std::size_t i = 0u; i < 8u; ++i) {
            const float v = p[29 + i];
            fb_res_[i] = (i % 2u == 0u) ? (1.f + std::sqrt(v) * 25.f)
                                        : (1.f + v * v * 19.f);
        }
        common_delays_linear(p);
        verb_vs_delay_ = p[43];
        delay_morph_   = p[45]; delay_blend_ = p[46];
    }

    void apply_granular(const float* p) noexcept {
        // Same shape as Soft, with sqrt on a couple of late params.
        apply_soft(p);
        ddelay_feedback2_ = std::sqrt(p[42]) * 0.98f;
        verb_vs_delay_    = std::sqrt(p[43]);
        delay_morph_      = p[45] * p[45];
        delay_blend_      = std::sqrt(p[46]);
    }

    void apply_diffuse(const float* p) noexcept {
        filter_bank_delay_xfade_ = std::sqrt(p[0]);
        for (std::size_t i = 0u; i < 8u; ++i) {
            lp_fb_[i]     = p[1 + 2 * i] * 0.9f;
            lp_cutoff_[i] = p[2 + 2 * i] * 0.5f + 0.05f;
        }
        for (std::size_t i = 0u; i < 4u; ++i) allp_fb_[i] = std::sqrt(p[17 + i]) * 0.95f;
        filterbank_octaves_default(p);
        filterbank_res_squared(p, 19.f);
        ddelay_time_      = 10.f + p[37] * 16373.f;
        ddelay_feedback_  = std::sqrt(p[38]) * 0.98f;
        ddelay_time1_     = 10.f + p[39] * 2037.f;
        ddelay_feedback1_ = std::sqrt(p[40]) * 0.98f;
        ddelay_time2_     = 10.f + p[41] * 501.f;
        ddelay_feedback2_ = std::sqrt(p[42]) * 0.98f;
        verb_vs_delay_ = p[43];
        delay_morph_   = p[45]; delay_blend_ = p[46];
    }

    void apply_dark(const float* p) noexcept {
        filter_bank_delay_xfade_ = p[0];
        for (std::size_t i = 0u; i < 8u; ++i) {
            lp_fb_[i]     = p[1 + 2 * i] * 0.9f;
            lp_cutoff_[i] = p[2 + 2 * i] * 0.3f + 0.02f;
        }
        for (std::size_t i = 0u; i < 4u; ++i) allp_fb_[i] = p[17 + i] * 0.9f;
        // Squared filterbank freqs — pulls them lower on average.
        const float bases[8] = {40.f, 80.f, 160.f, 320.f, 640.f, 1280.f, 2560.f, 5120.f};
        for (std::size_t i = 0u; i < 8u; ++i) {
            const float pp = p[21 + i];
            fb_freqs_[i] = bases[i] + (pp * pp) * bases[i];
        }
        // Mixed: first half sqrt, second half squared.
        for (std::size_t i = 0u; i < 8u; ++i) {
            const float v = p[29 + i];
            fb_res_[i] = (i < 4u) ? (1.f + std::sqrt(v) * 19.f)
                                  : (1.f + v * v * 19.f);
        }
        common_delays_linear(p);
        verb_vs_delay_ = p[43];
        delay_morph_   = p[45]; delay_blend_ = p[46];
    }

    void apply_bright(const float* p) noexcept {
        filter_bank_delay_xfade_ = p[0];
        for (std::size_t i = 0u; i < 8u; ++i) {
            lp_fb_[i]     = p[1 + 2 * i] * 0.9f;
            lp_cutoff_[i] = p[2 + 2 * i] * 0.5f + 0.1f;
        }
        for (std::size_t i = 0u; i < 4u; ++i) allp_fb_[i] = p[17 + i] * 0.9f;
        const float bases[8] = {40.f, 80.f, 160.f, 320.f, 640.f, 1280.f, 2560.f, 5120.f};
        for (std::size_t i = 0u; i < 8u; ++i) {
            fb_freqs_[i] = bases[i] + std::sqrt(p[21 + i]) * bases[i];
        }
        for (std::size_t i = 0u; i < 8u; ++i) {
            const float v = p[29 + i];
            fb_res_[i] = (i < 4u) ? (1.f + v * v * 19.f)
                                  : (1.f + std::sqrt(v) * 25.f);
        }
        common_delays_linear(p);
        verb_vs_delay_ = p[43];
        delay_morph_   = p[45]; delay_blend_ = p[46];
    }

    void apply_harmonic(const float* p) noexcept {
        filter_bank_delay_xfade_ = p[0];
        for (std::size_t i = 0u; i < 8u; ++i) {
            lp_fb_[i]     = p[1 + 2 * i] * (i == 5 ? 0.98f : 0.9f);
            lp_cutoff_[i] = p[2 + 2 * i] * 0.5f + 0.05f;
        }
        for (std::size_t i = 0u; i < 4u; ++i) allp_fb_[i] = p[17 + i] * 0.9f;
        // Harmonic series-ish base freqs (every ~100 Hz).
        const float harm_bases[8] = {80.f, 180.f, 280.f, 380.f, 480.f, 580.f, 680.f, 780.f};
        for (std::size_t i = 0u; i < 8u; ++i) fb_freqs_[i] = harm_bases[i] + p[21 + i] * 40.f;
        filterbank_res_sqrt(p, 19.f);
        common_delays_linear(p);
        verb_vs_delay_ = p[43];
        delay_morph_   = p[45]; delay_blend_ = p[46];
    }

    float sample_rate_ = 48000.f;

    OnePoleSmoother<kNParams>   smoother_;
    std::array<float, kNParams> nn_outputs_{};
    std::array<float, kNParams> smooth_params_{};

    AllPass<kSizeAllP0> allp0_;
    AllPass<kSizeAllP1> allp1_;
    AllPass<kSizeAllP2> allp2_;
    AllPass<kSizeAllP3> allp3_;

    LpComb<kSizeComb0> lpcomb0_;
    LpComb<kSizeComb1> lpcomb1_;
    LpComb<kSizeComb2> lpcomb2_;
    LpComb<kSizeComb3> lpcomb3_;
    LpComb<kSizeComb4> lpcomb4_;
    LpComb<kSizeComb5> lpcomb5_;
    LpComb<kSizeComb6> lpcomb6_;
    LpComb<kSizeComb7> lpcomb7_;

    ChamberlinSVF fb0_, fb1_, fb2_, fb3_, fb4_, fb5_, fb6_, fb7_;

    DynamicDelay<16384> ddelay_long_;
    DynamicDelay<2048>  ddelay_med_;
    DynamicDelay<512>   ddelay_short_;

    // Voice-space outputs.
    float lp_fb_[8]{};
    float lp_cutoff_[8]{};
    float allp_fb_[4]{};
    float fb_freqs_[8]{};
    float fb_res_[8]{};
    float ddelay_time_      = 0.f, ddelay_feedback_  = 0.f;
    float ddelay_time1_     = 0.f, ddelay_feedback1_ = 0.f;
    float ddelay_time2_     = 0.f, ddelay_feedback2_ = 0.f;
    float verb_vs_delay_    = 0.f;
    float delay_morph_      = 0.5f, delay_blend_     = 0.f;
    float filter_bank_delay_xfade_ = 0.f;
    float wet_dry_          = 0.5f;

    bool enable_filterbank_      = true;
    bool enable_short_delay_     = true;
    bool enable_medium_delay_    = true;
    bool enable_long_delay_      = true;

    VoiceSpace voice_space_ = VoiceSpace::Default;
};

static_assert(AudioEngine<VerbFXEngine>, "VerbFXEngine must satisfy AudioEngine");

}  // namespace nisps
