// nisps/dsp/dc_blocker.hpp — first-order high-pass to remove DC.
//
// y[n] = x[n] - x[n-1] + R * y[n-1]
//
// `R` close to 1 (typical 0.99) gives a very low-frequency cut. This is the
// straight port of maximilian's `maxiDCBlocker`.

#pragma once

#include "../core/perf.hpp"

namespace nisps {

class DCBlocker {
   public:
    DCBlocker() noexcept = default;

    NISPS_HOT NISPS_FORCE_INLINE float play(float input, float r) noexcept {
        ym1_ = input - xm1_ + r * ym1_;
        xm1_ = input;
        return ym1_;
    }

    void reset() noexcept {
        xm1_ = 0.f;
        ym1_ = 0.f;
    }

   private:
    float xm1_ = 0.f;
    float ym1_ = 0.f;
};

}  // namespace nisps
