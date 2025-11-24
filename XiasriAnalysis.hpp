#ifndef __SAX_ANALYSIS_HPP__
#define __SAX_ANALYSIS_HPP__

#include "src/memllib/audio/AudioDriver.hpp"
#include "src/memllib/utils/MedianFilter.h"
#include "src/memllib/utils/CircularBuffer.hpp"
#include "src/memllib/synth/maximilian.h"

#include <cmath>


class XiasriAnalysis {

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

    XiasriAnalysis(const float sample_rate);

    parameters_t Process(const float x);

    // Reinitialize filters after maxiSettings is properly configured
    void ReinitFilters();

protected:
    const float sample_rate_;
    const float one_over_sample_rate_;
    // Pre-filter
    maxiBiquad common_hpf_;
    // Zero crossing
    static constexpr size_t kZC_MedianFilterSize = 16;
    static constexpr size_t kZC_ZCBufferSize = 32;
    static constexpr float kPitchMin = 20.0f;
    static constexpr float kPitchMax = 800.0f;
    static constexpr float kPitchRange = kPitchMax - kPitchMin;  
    static constexpr float kPitchScale = 1.0f / kPitchRange;    
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
