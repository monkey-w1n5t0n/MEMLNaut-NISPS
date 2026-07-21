// nisps/engines/analysis.hpp — input-side audio analysis engine for the
// SoundAnalysisMIDI mode. Mirrors firmware XiasriAnalysis.
//
// On each sample, computes 6 features:
//   pitch         — fundamental frequency from zero-crossing detection
//   aperiodicity  — variance of period lengths (jitter)
//   energy        — log-domain envelope follower
//   attack        — derivative of energy (transient detector)
//   brightness    — high-band energy / total band energy ratio
//   energy_crude  — |x| (one-sample peak)
//
// All features clamped to [0, 1].
//
// Despite producing analysis-side output, this still satisfies AudioEngine —
// `process()` returns silence. Modes pull the latest features via `features()`.
// The 8-output SoundAnalysisMIDI schema feeds these features (plus the 4
// joystick channels) as ML INPUTS, then routes ML outputs to MIDI CC.

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

// Fixed-size median filter — replaces memllib's std::vector-based version.
template <std::size_t N>
class MedianFilter {
   public:
    static_assert(N > 0u && (N & 1u) == 1u, "MedianFilter size must be odd > 0");

    void reset(float value = 0.f) noexcept {
        for (auto& v : buf_) v = value;
        idx_ = 0u;
    }

    float process(float input) noexcept {
        buf_[idx_] = input;
        idx_ = (idx_ + 1u) % N;
        std::array<float, N> tmp = buf_;
        // Selection sort up to median index — O(N²/2), N = 16 is fine.
        constexpr std::size_t kCenter = N / 2u;
        for (std::size_t i = 0u; i <= kCenter; ++i) {
            std::size_t min_i = i;
            for (std::size_t j = i + 1u; j < N; ++j) {
                if (tmp[j] < tmp[min_i]) min_i = j;
            }
            if (min_i != i) {
                const float t = tmp[i];
                tmp[i] = tmp[min_i];
                tmp[min_i] = t;
            }
        }
        return tmp[kCenter];
    }

   private:
    std::array<float, N> buf_{};
    std::size_t idx_ = 0u;
};

// Fixed-size circular buffer with [] access counted from oldest.
template <typename T, std::size_t N>
class CircularBuffer {
   public:
    void push(T value) noexcept {
        buf_[idx_] = value;
        idx_ = (idx_ + 1u) % N;
    }
    T operator[](std::size_t i) const noexcept {
        // i==0 ⇒ oldest, i==N-1 ⇒ newest.
        return buf_[(idx_ + i) % N];
    }
    static constexpr std::size_t size() noexcept { return N; }

   private:
    std::array<T, N> buf_{};
    std::size_t      idx_ = 0u;
};

class AnalysisEngine {
   public:
    static constexpr std::size_t kNFeatures = 6u;
    // The engine itself produces no audio; expose a no-op param surface.
    static constexpr std::size_t param_count() noexcept { return 0u; }
    static constexpr std::string_view engine_id() noexcept { return "analysis"; }

    struct Features {
        float pitch         = 0.f;
        float aperiodicity  = 0.f;
        float energy        = 0.f;
        float attack        = 0.f;
        float brightness    = 0.f;
        float energy_crude  = 0.f;
    };

    void setup(float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        common_hpf_.setup(sample_rate);
        zc_lpf_.setup(sample_rate);
        br_lpf1_.setup(sample_rate);
        br_hpf2_.setup(sample_rate);
        br_lpf2_.setup(sample_rate);
        common_hpf_.set(Biquad::Type::HighPass, 20.f,   0.707f, 0.f);
        zc_lpf_.set(   Biquad::Type::LowPass,  4000.f, 0.707f, 0.f);
        br_lpf1_.set(  Biquad::Type::LowPass,  1000.f, 0.707f, 0.f);
        br_hpf2_.set(  Biquad::Type::HighPass, 1000.f, 0.707f, 0.f);
        br_lpf2_.set(  Biquad::Type::LowPass,  4000.f, 0.707f, 0.f);
        ef_follower_.setup(sample_rate, 10.f, 100.f);
        br_low_follower_.setup(sample_rate, 10.f, 100.f);
        br_high_follower_.setup(sample_rate, 10.f, 100.f);
        zc_median_.reset(0.f);
        elapsed_samples_ = 0u;
        prev_zx_         = 0.f;
        ef_deriv_y_      = 0.f;
    }

    void set_params(std::span<const float> /*params*/) noexcept {}

    NISPS_HOT NISPS_FORCE_INLINE stereosample_t process(stereosample_t x) noexcept {
        const float input = x.L;  // analyse left channel
        const float pre   = common_hpf_.play(input);

        // ---- Pitch via zero-crossing ----
        const float zc_y = zc_lpf_.play(pre);
        const bool zx = (zc_y > 0.f && prev_zx_ <= 0.f);
        prev_zx_ = zc_y;
        if (zx) {
            const float median = zc_median_.process(static_cast<float>(elapsed_samples_));
            zc_buffer_.push(median);
            elapsed_samples_ = 0u;
        }
        ++elapsed_samples_;

        const float zc_value     = zc_buffer_[kZCBufSize - 1u];
        const float pitch_hz     = (zc_value > 1.f) ? (sample_rate_ / zc_value) : 0.f;
        const float norm_pitch   = clamp01((pitch_hz - kPitchMin) * kInvPitchRange);

        // ---- Aperiodicity from MAD of period lengths ----
        std::array<float, kZCBufSize> zc_copy;
        for (std::size_t i = 0u; i < kZCBufSize; ++i) zc_copy[i] = zc_buffer_[i];
        const float mad = mean_abs_deviation(zc_copy);
        const float median_period = zc_value;
        const float rel_mad = mad / (median_period + 1.f);
        const float norm_aperiodicity = std::min(1.f, rel_mad * (1.f / 0.3f));

        // ---- Energy via envelope follower + log mapping ----
        const float ef_lin = ef_follower_.play(pre);
        const float ef_log = log_envelope(ef_lin);
        const float deriv  = ef_log - ef_deriv_y_;
        ef_deriv_y_ = ef_log;
        const float attack = std::max(0.f, std::min(deriv * 10.f, 1.f));

        // ---- Brightness ----
        const float low  = br_lpf1_.play(pre);
        float       high = br_hpf2_.play(pre);
        high = br_lpf2_.play(high);
        const float low_env  = br_low_follower_.play(low);
        const float high_env = br_high_follower_.play(high);
        const float total    = low_env + high_env + 1e-8f;
        const float brightness = std::min(high_env / total, 1.f);

        features_.pitch        = norm_pitch;
        features_.aperiodicity = norm_aperiodicity;
        features_.energy       = ef_log;
        features_.attack       = attack;
        features_.brightness   = brightness;
        features_.energy_crude = std::fabs(input);
        return {0.f, 0.f};
    }

    DriverConfig driver_config() const noexcept {
        DriverConfig c;
        c.mic_input    = true;
        c.mic_gain_db  = 20u;
        return c;
    }

    // Exposed for modes — read the latest computed feature snapshot.
    const Features& features() const noexcept { return features_; }

    // Pack into a 6-channel array, in same order as Features fields.
    void copy_features(std::span<float> out) const noexcept {
        if (out.size() < kNFeatures) return;
        out[0] = features_.pitch;
        out[1] = features_.aperiodicity;
        out[2] = features_.energy;
        out[3] = features_.attack;
        out[4] = features_.brightness;
        out[5] = features_.energy_crude;
    }

   private:
    static constexpr std::size_t kZCMedianSize = 15u;  // odd
    static constexpr std::size_t kZCBufSize    = 32u;
    static constexpr float kPitchMin       = 20.f;
    static constexpr float kPitchMax       = 800.f;
    static constexpr float kInvPitchRange  = 1.f / (kPitchMax - kPitchMin);

    static float clamp01(float x) noexcept {
        if (x < 0.f) return 0.f;
        if (x > 1.f) return 1.f;
        return x;
    }

    static float mean_abs_deviation(const std::array<float, kZCBufSize>& v) noexcept {
        float sum = 0.f;
        for (auto x : v) sum += x;
        const float mean = sum / static_cast<float>(kZCBufSize);
        float acc = 0.f;
        for (auto x : v) acc += std::fabs(x - mean);
        return acc / static_cast<float>(kZCBufSize);
    }

    static float log_envelope(float linear_env) noexcept {
        // Map [0.001 (-60dB), 1.0 (0dB)] → [0, 1].
        static const float kMinEnv      = 1e-3f;
        static const float kLog2MinEnv  = -3.f * 3.321928095f;  // -3 * log2(10)
        static const float kInvLogRange = 1.f / (0.f - kLog2MinEnv);
        if (linear_env < kMinEnv) linear_env = kMinEnv;
        const float lg = std::log2(linear_env);
        const float y  = (lg - kLog2MinEnv) * kInvLogRange;
        return clamp01(y);
    }

    float sample_rate_ = 48000.f;

    Biquad common_hpf_;
    Biquad zc_lpf_;
    Biquad br_lpf1_;
    Biquad br_hpf2_;
    Biquad br_lpf2_;

    EnvelopeFollower ef_follower_;
    EnvelopeFollower br_low_follower_;
    EnvelopeFollower br_high_follower_;

    MedianFilter<kZCMedianSize>          zc_median_;
    CircularBuffer<float, kZCBufSize>    zc_buffer_;

    std::size_t elapsed_samples_ = 0u;
    float       prev_zx_         = 0.f;
    float       ef_deriv_y_      = 0.f;

    Features features_;
};

static_assert(AudioEngine<AnalysisEngine>, "AnalysisEngine must satisfy AudioEngine");

}  // namespace nisps
