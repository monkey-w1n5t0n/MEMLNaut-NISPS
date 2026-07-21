#ifndef ONEPOLESMOOTHER_H
#define ONEPOLESMOOTHER_H

#include <cmath>

template<size_t n_channels>
class OnePoleSmoother {
 public:
    OnePoleSmoother() : sample_rate_(48000), y_{0} {}

    OnePoleSmoother(float time_ms, float sample_rate) :
        sample_rate_(sample_rate),
        y_ { 0 } {
        SetTimeMs(time_ms);
    }

    void Setup(float time_ms, float sample_rate) {
        sample_rate_ = sample_rate;
        SetTimeMs(time_ms);
    }

    void SetTimeMs(float time_ms) {
        //b1_ = std::exp(
        //    std::log(0.01) /
        //    time_ms * sample_rate_ * 0.001
        //);
        b1_ = powf(0.1f, 1.f/ (time_ms * 0.001f * sample_rate_));
    }
    inline __attribute__((always_inline)) void Process(const float * x_ptr, float *y_ptr) {
        float *y2_ptr = y_;
        for (unsigned int c = 0; c < n_channels; c++) {
            const float x = *x_ptr;
            *y2_ptr = *y_ptr = x + b1_ * (*y2_ptr - x);
            ++x_ptr;
            ++y_ptr;
            ++y2_ptr;
        }
    }

 protected:
    float sample_rate_;
    float b1_;
    float y_[n_channels];
};


#endif