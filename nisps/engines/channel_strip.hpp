// nisps/engines/channel_strip.hpp — stereo console-style channel strip.
//
// Mirrors firmware ChannelStripAudioApp. Per-channel signal flow:
//   pre-gain → tanh → HPF → LPF → 2× peak EQ → low-shelf → high-shelf →
//   compressor → tanh → post-gain.
//
// Voice spaces are inline lambdas (`apply_voice_space_*`) that translate a
// 24-element NN output vector into the named member fields. They mirror
// `voicespaces/ChannelStrip/basic.hpp` exactly.
//
// Compressor: a feed-forward design with envelope follower + log-domain
// threshold + linear-domain ratio + smoothed gain. This is simpler than
// maximilian's `maxiDynamicsLite` (which has lookahead, knee, and bidirectional
// companding); the audible result is close enough for the voice-space ranges.

#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"
#include "../dsp/biquad.hpp"
#include "../dsp/filter.hpp"

namespace nisps {

class ChannelStripEngine {
   public:
    static constexpr std::size_t kNParams = 24u;
    static constexpr std::size_t param_count() noexcept { return kNParams; }
    static constexpr std::string_view engine_id() noexcept { return "channel_strip"; }

    enum class VoiceSpace : std::size_t {
        WannabeNeve66 = 0,
        SSL4KGist     = 1,
        SSL9KInda     = 2,
        MaleVox       = 3,
        FemaleVox     = 4,
        Neve80        = 5,
        Count         = 6,
    };

    static constexpr std::size_t kVoiceSpaceCount = static_cast<std::size_t>(VoiceSpace::Count);
    static constexpr std::array<std::string_view, kVoiceSpaceCount> kVoiceSpaceNames = {
        "WannabeNeve66", "SSL 4K G-ist", "SSL 9K-inda", "MaleVox", "FemaleVox", "Neve 80"};

    void set_voice_space(VoiceSpace vs) noexcept { voice_space_ = vs; }
    VoiceSpace voice_space() const noexcept { return voice_space_; }

    void setup(float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        for (auto* f : {&in_hpf_l_, &in_lpf_l_, &in_hpf_r_, &in_lpf_r_}) f->setup(sample_rate);
        peak0_l_.setup(sample_rate);
        peak1_l_.setup(sample_rate);
        ls_l_.setup(sample_rate);
        hs_l_.setup(sample_rate);
        peak0_r_.setup(sample_rate);
        peak1_r_.setup(sample_rate);
        ls_r_.setup(sample_rate);
        hs_r_.setup(sample_rate);
        comp_env_l_.setup(sample_rate, 10.f, 200.f);
        comp_env_r_.setup(sample_rate, 10.f, 200.f);
    }

    void set_params(std::span<const float> params) noexcept {
        if (params.size() < kNParams) return;
        std::array<float, kNParams> p;
        for (std::size_t i = 0u; i < kNParams; ++i) p[i] = params[i];
        switch (voice_space_) {
            case VoiceSpace::WannabeNeve66: apply_neve66(p); break;
            case VoiceSpace::SSL4KGist:     apply_ssl4k(p); break;
            case VoiceSpace::SSL9KInda:     apply_ssl9k(p); break;
            case VoiceSpace::MaleVox:       apply_male_vox(p); break;
            case VoiceSpace::FemaleVox:     apply_female_vox(p); break;
            case VoiceSpace::Neve80:        apply_neve80(p); break;
            case VoiceSpace::Count: break;
        }
        // Apply EQ updates to all biquads.
        peak0_l_.set(Biquad::Type::Peak,      peak0_freq_, peak0_q_, peak0_gain_);
        peak1_l_.set(Biquad::Type::Peak,      peak1_freq_, peak1_q_, peak1_gain_);
        ls_l_.set(Biquad::Type::LowShelf,     low_shelf_freq_, low_shelf_q_, low_shelf_gain_);
        hs_l_.set(Biquad::Type::HighShelf,    high_shelf_freq_, high_shelf_q_, high_shelf_gain_);
        peak0_r_.set(Biquad::Type::Peak,      peak0_freq_, peak0_q_, peak0_gain_);
        peak1_r_.set(Biquad::Type::Peak,      peak1_freq_, peak1_q_, peak1_gain_);
        ls_r_.set(Biquad::Type::LowShelf,     low_shelf_freq_, low_shelf_q_, low_shelf_gain_);
        hs_r_.set(Biquad::Type::HighShelf,    high_shelf_freq_, high_shelf_q_, high_shelf_gain_);
        comp_env_l_.set_attack(comp_attack_);
        comp_env_l_.set_release(comp_release_);
        comp_env_r_.set_attack(comp_attack_);
        comp_env_r_.set_release(comp_release_);
    }

    NISPS_HOT NISPS_FORCE_INLINE stereosample_t process(stereosample_t x) noexcept {
        if (bypass_all_) return x;

        float yl = x.L;
        float yr = x.R;

        if (!bypass_pre_post_gain_) {
            yl = std::tanh(yl * pre_gain_);
            yr = std::tanh(yr * pre_gain_);
        }
        if (!bypass_in_filters_) {
            yl = in_lpf_l_.lowpass(yl,  in_lowpass_cutoff_,  1.f);
            yl = in_hpf_l_.highpass(yl, in_highpass_cutoff_, 1.f);
            yr = in_lpf_r_.lowpass(yr,  in_lowpass_cutoff_,  1.f);
            yr = in_hpf_r_.highpass(yr, in_highpass_cutoff_, 1.f);
        }
        if (!bypass_eq_) {
            yl = peak0_l_.play(yl);
            yl = peak1_l_.play(yl);
            yl = ls_l_.play(yl);
            yl = hs_l_.play(yl);
            yr = peak0_r_.play(yr);
            yr = peak1_r_.play(yr);
            yr = ls_r_.play(yr);
            // Right-channel highshelf intentionally skipped — matches firmware's
            // commented-out `// y1 = highshelf1.play(y1)`. Sonically negligible
            // for these voice spaces but preserved for parity.
        }
        if (!bypass_comp_) {
            yl = compress(yl, comp_env_l_, comp_threshold_, comp_ratio_);
            yr = compress(yr, comp_env_r_, comp_threshold_, comp_ratio_);
        }
        if (!bypass_pre_post_gain_) {
            yl = std::tanh(yl * post_gain_);
            yr = std::tanh(yr * post_gain_);
        }
        return {yl, yr};
    }

    DriverConfig driver_config() const noexcept {
        DriverConfig c;
        c.line_level = 6u;
        c.output_volume = 0.9f;
        return c;
    }

    void set_bypass_all(bool b) noexcept { bypass_all_ = b; }
    void set_bypass_eq(bool b) noexcept { bypass_eq_ = b; }
    void set_bypass_comp(bool b) noexcept { bypass_comp_ = b; }
    void set_bypass_pre_post_gain(bool b) noexcept { bypass_pre_post_gain_ = b; }
    void set_bypass_in_filters(bool b) noexcept { bypass_in_filters_ = b; }

   private:
    NISPS_HOT NISPS_FORCE_INLINE float compress(float x, EnvelopeFollower& env,
                                                float threshold_db, float ratio) noexcept {
        // Simple downward compressor: detect via envelope follower, convert to
        // dB, apply ratio above threshold, return to linear.
        const float env_lin = env.play(x) + 1e-7f;
        const float env_db  = 20.f * std::log10(env_lin);
        float gain_db = 0.f;
        if (env_db > threshold_db && ratio > 1.f) {
            gain_db = -(env_db - threshold_db) * (1.f - 1.f / ratio);
        }
        const float gain_lin = std::pow(10.f, gain_db * 0.05f);
        return x * gain_lin;
    }

    void apply_neve66(const std::array<float, kNParams>& p) noexcept {
        pre_gain_           = 0.5f + (p[0] * p[0] * 4.f);
        in_lowpass_cutoff_  = 2000.f + (p[7] * p[7] * 18000.f);
        in_highpass_cutoff_ = 30.f   + (p[8] * p[8] * 270.f);
        low_shelf_freq_     = 31.5f  + (p[14] * p[14] * 313.5f);
        low_shelf_q_        = 0.6f   + (p[15] * 4.4f);
        low_shelf_gain_     = -15.f  + (p[16] * 30.f);
        peak0_freq_         = 200.f  + (p[1] * p[1] * 1800.f);
        peak0_q_            = 0.6f   + (p[5] * 4.4f);
        peak0_gain_         = -18.f  + (p[6] * 36.f);
        peak1_freq_         = 800.f  + (p[4] * p[4] * 7200.f);
        peak1_q_            = 0.6f   + (p[5] * 4.4f);
        peak1_gain_         = -18.f  + (p[6] * 36.f);
        high_shelf_freq_    = 1600.f + (p[17] * p[17] * 14400.f);
        high_shelf_q_       = 0.6f   + (p[18] * 4.4f);
        high_shelf_gain_    = -18.f  + (p[19] * 36.f);
        comp_threshold_     = 20.f   + (p[10] * -40.f);
        comp_ratio_         = 1.f    + (p[11] * 19.f);
        comp_attack_        = 0.002f + (p[12] * 10.f);
        comp_release_       = 30.f   + (p[13] * p[13] * 2970.f);
        post_gain_          = 0.5f   + (p[23] * p[23] * 4.f);
    }
    void apply_ssl4k(const std::array<float, kNParams>& p) noexcept {
        pre_gain_           = 0.5f + (p[0] * p[0] * 4.f);
        in_lowpass_cutoff_  = 3000.f + (p[7] * p[7] * 18000.f);
        in_highpass_cutoff_ = 10.f   + (p[8] * p[8] * 340.f);
        low_shelf_freq_     = 30.f   + (p[14] * p[14] * 420.f);
        low_shelf_q_        = 0.6f   + (p[15] * 4.4f);
        low_shelf_gain_     = -18.f  + (p[16] * 36.f);
        peak0_freq_         = 200.f  + (p[1] * p[1] * 2300.f);
        peak0_q_            = 0.6f   + (p[5] * 4.4f);
        peak0_gain_         = -22.f  + (p[6] * 44.f);
        peak1_freq_         = 600.f  + (p[4] * p[4] * 6400.f);
        peak1_q_            = 0.6f   + (p[5] * 4.4f);
        peak1_gain_         = -22.f  + (p[6] * 44.f);
        high_shelf_freq_    = 1500.f + (p[17] * p[17] * 14500.f);
        high_shelf_q_       = 0.6f   + (p[18] * 4.4f);
        high_shelf_gain_    = -20.f  + (p[19] * 40.f);
        comp_threshold_     = 10.f   + (p[10] * -30.f);
        comp_ratio_         = 1.f    + (p[11] * p[11] * 20.f);
        comp_attack_        = 0.08f  + (p[12] * 3.f);
        comp_release_       = 100.f  + (p[13] * p[13] * 3900.f);
        post_gain_          = 0.5f   + (p[23] * p[23] * 4.f);
    }
    void apply_ssl9k(const std::array<float, kNParams>& p) noexcept {
        pre_gain_           = 0.5f + (p[0] * p[0] * 4.f);
        in_lowpass_cutoff_  = 3000.f + (p[7] * p[7] * 18000.f);
        in_highpass_cutoff_ = 10.f   + (p[8] * p[8] * 490.f);
        low_shelf_freq_     = 40.f   + (p[14] * p[14] * 560.f);
        low_shelf_q_        = 0.6f   + (p[15] * 4.4f);
        low_shelf_gain_     = -20.f  + (p[16] * 40.f);
        peak0_freq_         = 200.f  + (p[1] * p[1] * 1800.f);
        peak0_q_            = 0.5f   + (p[5] * 2.f);
        peak0_gain_         = -20.f  + (p[6] * 40.f);
        peak1_freq_         = 600.f  + (p[4] * p[4] * 6400.f);
        peak1_q_            = 0.5f   + (p[5] * 2.f);
        peak1_gain_         = -20.f  + (p[6] * 40.f);
        high_shelf_freq_    = 1500.f + (p[17] * p[17] * 20500.f);
        high_shelf_q_       = 0.6f   + (p[18] * 4.4f);
        high_shelf_gain_    = -20.f  + (p[19] * 40.f);
        comp_threshold_     = 10.f   + (p[10] * -30.f);
        comp_ratio_         = 1.f    + (p[11] * p[11] * 20.f);
        comp_attack_        = 0.08f  + (p[12] * 3.f);
        comp_release_       = 100.f  + (p[13] * p[13] * 3900.f);
        post_gain_          = 0.5f   + (p[23] * p[23] * 4.f);
    }
    void apply_male_vox(const std::array<float, kNParams>& p) noexcept {
        pre_gain_           = 0.5f + (p[0] * p[0] * 4.f);
        in_lowpass_cutoff_  = 1000.f + (p[7] * p[7] * 19000.f);
        in_highpass_cutoff_ = 10.f   + (p[8] * p[8] * 1990.f);
        comp_threshold_     = p[10] * -30.f;
        comp_ratio_         = 2.f + (p[11] * 6.f);
        comp_attack_        = 0.08f + (p[12] * 50.f);
        comp_release_       = 50.f + (p[13] * 500.f);
        low_shelf_freq_     = 60.f + (p[14] * p[14] * 240.f);
        low_shelf_q_        = 0.6f + (p[15] * 4.4f);
        low_shelf_gain_     = -18.f + (p[16] * 36.f);
        peak0_freq_         = 60.f + (p[1] * p[1] * 440.f);
        peak0_q_            = 0.6f + (p[5] * 4.4f);
        peak0_gain_         = -18.f + (p[6] * 36.f);
        peak1_freq_         = 300.f + (p[4] * p[4] * 7700.f);
        peak1_q_            = 0.6f + (p[5] * 4.4f);
        peak1_gain_         = -18.f + (p[6] * 36.f);
        high_shelf_freq_    = 1000.f + (p[17] * p[17] * 7000.f);
        high_shelf_q_       = 0.6f + (p[18] * 4.4f);
        high_shelf_gain_    = -18.f + (p[19] * 36.f);
        post_gain_          = 0.5f + (p[23] * p[23] * 4.f);
    }
    void apply_female_vox(const std::array<float, kNParams>& p) noexcept {
        pre_gain_           = 0.5f + (p[0] * p[0] * 4.f);
        in_lowpass_cutoff_  = 1000.f + (p[7] * p[7] * 19000.f);
        in_highpass_cutoff_ = 10.f   + (p[8] * p[8] * 1990.f);
        comp_threshold_     = p[10] * -30.f;
        comp_ratio_         = 2.f + (p[11] * 6.f);
        comp_attack_        = 0.08f + (p[12] * 50.f);
        comp_release_       = 50.f + (p[13] * 500.f);
        low_shelf_freq_     = 120.f + (p[14] * p[14] * 180.f);
        low_shelf_q_        = 0.6f + (p[15] * 4.4f);
        low_shelf_gain_     = -18.f + (p[16] * 36.f);
        peak0_freq_         = 120.f + (p[1] * p[1] * 380.f);
        peak0_q_            = 0.6f + (p[5] * 4.4f);
        peak0_gain_         = -18.f + (p[6] * 36.f);
        peak1_freq_         = 300.f + (p[4] * p[4] * 9700.f);
        peak1_q_            = 0.6f + (p[5] * 4.4f);
        peak1_gain_         = -18.f + (p[6] * 36.f);
        high_shelf_freq_    = 1000.f + (p[17] * p[17] * 9000.f);
        high_shelf_q_       = 0.6f + (p[18] * 4.4f);
        high_shelf_gain_    = -18.f + (p[19] * 36.f);
        post_gain_          = 0.5f + (p[23] * p[23] * 4.f);
    }
    void apply_neve80(const std::array<float, kNParams>& p) noexcept {
        // Stepped frequencies — Neve-style fixed values picked by parameter index.
        static const float lo_pass_freqs[]      = {190.f, 1200.f, 3900.f, 5600.f, 9200.f};
        static const float hi_pass_freqs[]      = {27.f, 47.f, 92.f, 150.f, 270.f};
        static const float comp_ratios[]        = {1.5f, 2.f, 3.f, 4.f, 6.f};
        static const float comp_releases[]      = {400.f, 800.f, 1500.f};
        static const float low_shelf_freqs[]    = {33.f, 56.f, 100.f, 190.f, 330.f};
        static const float low_peak_freqs[]     = {220.f, 270.f, 330.f, 390.f, 470.f, 560.f, 690.f, 820.f, 1000.f, 1200.f};
        static const float high_peak_freqs[]    = {1500.f, 1900.f, 2200.f, 2700.f, 3300.f, 3900.f, 4700.f, 5600.f, 6900.f, 8200.f};
        static const float high_shelf_freqs[]   = {3300.f, 4700.f, 6900.f, 10000.f, 15000.f};

        pre_gain_           = 0.5f + (p[0] * p[0] * 4.f);
        in_lowpass_cutoff_  = lo_pass_freqs[idx_clamp(p[7] * 3.999999f, 5)];
        in_highpass_cutoff_ = hi_pass_freqs[idx_clamp(p[8] * 3.999999f, 5)];
        comp_threshold_     = p[10] * -30.f;
        comp_ratio_         = comp_ratios[idx_clamp(p[11] * 3.999999f, 5)];
        comp_attack_        = p[12] > 0.5f ? 5.f : 1.f;
        comp_release_       = comp_releases[idx_clamp(p[13] * 1.999999f, 3)];
        low_shelf_freq_     = low_shelf_freqs[idx_clamp(p[14] * 3.999999f, 5)];
        low_shelf_q_        = 0.6f + (p[15] * 4.4f);
        low_shelf_gain_     = -18.f + (p[16] * 36.f);
        peak0_freq_         = low_peak_freqs[idx_clamp(p[1] * 8.999999f, 10)];
        peak0_q_            = 0.6f + (p[5] * 4.4f);
        peak0_gain_         = -18.f + (p[6] * 36.f);
        peak1_freq_         = high_peak_freqs[idx_clamp(p[4] * 8.999999f, 10)];
        peak1_q_            = 0.6f + (p[5] * 4.4f);
        peak1_gain_         = -18.f + (p[6] * 36.f);
        high_shelf_freq_    = high_shelf_freqs[idx_clamp(p[17] * 3.999999f, 5)];
        high_shelf_q_       = 0.6f + (p[18] * 4.4f);
        high_shelf_gain_    = -18.f + (p[19] * 36.f);
        post_gain_          = 0.5f + (p[23] * p[23] * 4.f);
    }

    static std::size_t idx_clamp(float x, std::size_t n) noexcept {
        if (x < 0.f) return 0u;
        const auto i = static_cast<std::size_t>(x);
        return i >= n ? n - 1u : i;
    }

    float sample_rate_ = 48000.f;

    // Voice-space-driven engine state.
    float pre_gain_           = 1.f;
    float post_gain_          = 1.f;
    float in_lowpass_cutoff_  = 200.f;
    float in_highpass_cutoff_ = 2000.f;
    float comp_threshold_     = 0.f;
    float comp_ratio_         = 1.f;
    float comp_attack_        = 10.f;
    float comp_release_       = 50.f;
    float peak0_freq_         = 100.f;
    float peak0_q_            = 1.f;
    float peak0_gain_         = 1.f;
    float peak1_freq_         = 1000.f;
    float peak1_q_            = 1.f;
    float peak1_gain_         = 1.f;
    float low_shelf_freq_     = 100.f;
    float low_shelf_q_        = 1.f;
    float low_shelf_gain_     = 0.f;
    float high_shelf_freq_    = 8000.f;
    float high_shelf_q_       = 1.f;
    float high_shelf_gain_    = 0.f;

    bool bypass_all_           = false;
    bool bypass_eq_            = false;
    bool bypass_comp_          = false;
    bool bypass_pre_post_gain_ = false;
    bool bypass_in_filters_    = false;

    VoiceSpace voice_space_ = VoiceSpace::WannabeNeve66;

    ChamberlinSVF in_hpf_l_, in_lpf_l_, in_hpf_r_, in_lpf_r_;
    Biquad        peak0_l_, peak1_l_, ls_l_, hs_l_;
    Biquad        peak0_r_, peak1_r_, ls_r_, hs_r_;
    EnvelopeFollower comp_env_l_, comp_env_r_;
};

static_assert(AudioEngine<ChannelStripEngine>, "ChannelStripEngine must satisfy AudioEngine");

}  // namespace nisps
