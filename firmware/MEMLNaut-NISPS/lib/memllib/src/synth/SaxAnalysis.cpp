#include "SaxAnalysis.hpp"

#include <cmath>

#include "../hardware/memlnaut/Pins.hpp"
#include "../utils/Maths.hpp"
#include "../PicoDefs.hpp"


SaxAnalysis::SaxAnalysis(const float sample_rate) :
    sample_rate_(sample_rate),
    one_over_sample_rate_(1.0f / sample_rate),
    zc_median_filter_(kZC_MedianFilterSize) {

    // Initialize filters and detectors
    common_hpf_.set(maxiBiquad::filterTypes::HIGHPASS, 100.f, 0.707f, 0);
    // Zero crossing
    zc_lpf_.set(maxiBiquad::filterTypes::LOWPASS, 800.0f, 0.707f, 0);
    elapsed_samples_ = 0;
    // Envelope follower
    ef_follower_.setAttack(10.0f);
    ef_follower_.setRelease(100.0f);
    ef_deriv_y_ = 0;
    // Brightness
    br_lpf1_.set(maxiBiquad::filterTypes::LOWPASS, 1000.0f, 0.707f, 0);
    br_hpf2_.set(maxiBiquad::filterTypes::HIGHPASS, 1000.0f, 0.707f, 0);
    br_lpf2_.set(maxiBiquad::filterTypes::LOWPASS, 4000.0f, 0.707f, 0);
    for (size_t i = 0; i < kBR_NBands; ++i) {
        br_follower_[i].setAttack(10.f);
        br_follower_[i].setRelease(100.f);
    }
}


inline float logEnvelopeFast(float linearEnv) {
    // -60 dBFS corresponds to a linear amplitude ratio of 10^(-60/20) = 10^(-3) = 0.001
    static constexpr float MIN_ENV = 1e-3f;  // 10^(-60dB/20dB) = 0.001 linear

    // Mathematical derivation:
    // We want to map linear amplitude [0.001, 1.0] to normalized range [0, 1]
    // where 0.001 corresponds to -60 dBFS and 1.0 corresponds to 0 dBFS
    //
    // Using logarithmic mapping: output = (log2(input) - log2(min)) / (log2(max) - log2(min))
    // log2(0.001) = log2(10^-3) = -3 * log2(10) ≈ -9.966
    // log2(1.0) = 0
    // Range = 0 - (-9.966) = 9.966

    static constexpr float LOG2_MIN_ENV = -3.0f * 3.321928095f;  // -3 * log2(10) ≈ -9.966
    static constexpr float LOG2_MAX_ENV = 0.0f;                  // log2(1.0) = 0
    static constexpr float LOG_RANGE = LOG2_MAX_ENV - LOG2_MIN_ENV;  // 9.966
    static constexpr float INV_LOG_RANGE = 1.0f / LOG_RANGE;    // 1 / 9.966 ≈ 0.1003

    // Clamp input to minimum envelope value
    linearEnv = (linearEnv > MIN_ENV) ? linearEnv : MIN_ENV;

    // Precise logarithmic conversion
    float log2_val = std::log2f(linearEnv);

    // Map to [0,1]: (log2_val - log2_min) / (log2_max - log2_min)
    float y = (log2_val - LOG2_MIN_ENV) * INV_LOG_RANGE;

    // Clamp to [0,1] range (should be unnecessary given our math, but safety first)
    y = (y > 1.0f) ? 1.0f : y;
    y = (y < 0.0f) ? 0.0f : y;

    return y;
}

SaxAnalysis::parameters_t AUDIO_FUNC(SaxAnalysis::Process)(const float x) {
    parameters_t params = {};

    // Pre-filter
    float pre_filtered = common_hpf_.play(x);

    // Zero crossing detection
    float zc_y = zc_lpf_.play(pre_filtered);
    bool positive_zero_crossing = zc_detector_.zx(zc_y);
    if (positive_zero_crossing) {
        size_t median_elapsed_samples = zc_median_filter_.process(elapsed_samples_);
        zc_buffer_.push(median_elapsed_samples);
        elapsed_samples_ = 0;
    }
    // Convert zero crossing value to pitch
    size_t zc_value = zc_buffer_[zc_buffer_.size() - 1];
    float pitch = 1.0f / (zc_value * one_over_sample_rate_);
    // Map [100..800] hz to [0..1] range
    float normalized_pitch;
    if (pitch <= kPitchMin) {
        normalized_pitch = 0.0f;
    } else if (pitch >= kPitchMax) {
        normalized_pitch = 1.0f;
    } else {
        normalized_pitch = (pitch - kPitchMin) * kPitchScale;
    }
    elapsed_samples_++;
    // Aperiodicity calculation
    float zc_copy[kZC_ZCBufferSize];
    // Copy contents of circular buffer to float array
    for (size_t i = 0; i < kZC_ZCBufferSize; ++i) {
        zc_copy[i] = static_cast<float>(zc_buffer_[i]);
    }
    float mad = meanAbsoluteDeviation(zc_copy, kZC_ZCBufferSize);
    // Scale MAD relative to median period
    float medianPeriod = static_cast<float>(zc_value);
    float relativeMad = mad / (medianPeriod + 1.0f);  // +1 to avoid div/0

    // Typical relative MAD ranges from 0 to 0.3 for musical sounds
    static constexpr float ONE_OVER_RELATIVE_MAD_MAX = 1/0.3f;
    float normalizedAperiodicity = std::min(1.0f, relativeMad * ONE_OVER_RELATIVE_MAD_MAX);

    // Envelope follower
    float ef_y = ef_follower_.play(pre_filtered);
    // Convert to log
    ef_y = logEnvelopeFast(ef_y);
    float ef_d_dy = ef_y - ef_deriv_y_;
    ef_deriv_y_ = ef_y;
    // Half-wave rectify the derivative
    if (ef_d_dy < 0) {
        ef_d_dy = 0;
    }
    // Scale to [0..1] range
    ef_d_dy = std::min(ef_d_dy * 10.0f, 1.0f);


    // Brightness calculation
    float br_low = br_lpf1_.play(pre_filtered);
    float br_high = br_hpf2_.play(pre_filtered);
    br_high = br_lpf2_.play(br_high);

    br_low = br_follower_[0].play(br_low);
    br_high = br_follower_[1].play(br_high);
    // brightness = high_band_energy / (low_band_energy + high_band_energy)
    float br_energy = br_low + br_high;
    if (br_energy > 0.0f) {
        br_high /= br_energy;
    } else {
        br_high = 0.0f;  // Avoid division by zero
    }

    // Fill parameters
    params.pitch = normalized_pitch;
    params.aperiodicity = normalizedAperiodicity;
    params.energy = ef_y;
    params.attack = ef_d_dy;
    params.brightness = br_high;
    params.energy_crude = std::abs(x);

    return params;
}