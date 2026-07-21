#ifndef __SAX_ANALYSIS_HPP__
#define __SAX_ANALYSIS_HPP__

#include "../audio/AudioDriver.hpp"
#include "../utils/MedianFilter.h"
#include "../utils/CircularBuffer.hpp"
#include "maximilian.h"

#include <cmath>


class SaxAnalysis {

public:
    struct parameters_t {
        float pitch;
        float aperiodicity;
        float energy;
        float attack;
        float brightness;
        float energy_crude;
    };
    static constexpr size_t kN_Params = sizeof(parameters_t) / sizeof(float);

    SaxAnalysis(const float sample_rate);

    parameters_t Process(const float x);

protected:
    const float sample_rate_;
    const float one_over_sample_rate_;
    // Pre-filter
    maxiBiquad common_hpf_;
    // Zero crossing
    static constexpr size_t kZC_MedianFilterSize = 16;
    static constexpr size_t kZC_ZCBufferSize = 32;
    static constexpr float kPitchMin = 100.0f;
    static constexpr float kPitchMax = 800.0f;
    static constexpr float kPitchRange = kPitchMax - kPitchMin;  // 700.0f
    static constexpr float kPitchScale = 1.0f / kPitchRange;    // 1/700
    maxiBiquad zc_lpf_;
    maxiZeroCrossingDetector zc_detector_;
    size_t elapsed_samples_;
    MedianFilter<size_t> zc_median_filter_;
    CircularBuffer<size_t, kZC_ZCBufferSize> zc_buffer_;
    // Envelope follower
    maxiEnvelopeFollowerF ef_follower_;
    float ef_deriv_y_;
    // Brightness
    static constexpr size_t kBR_NBands = 2;
    maxiBiquad br_lpf1_;
    maxiBiquad br_hpf2_;
    maxiBiquad br_lpf2_;
    maxiEnvelopeFollowerF br_follower_[kBR_NBands];

};


#endif  // __SAX_ANALYSIS_HPP__
