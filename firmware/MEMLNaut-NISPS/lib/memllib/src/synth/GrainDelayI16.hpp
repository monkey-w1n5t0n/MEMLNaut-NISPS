#pragma once

#include <cmath>
#include <cstddef>
#include "maximilian.h"
#include "../audio/AudioDriver.hpp"

template<size_t BUFSIZE = 16384, size_t NGRAINS = 4>
class GrainDelayI16 {
    static_assert((BUFSIZE & (BUFSIZE - 1)) == 0, "BUFSIZE must be a power of 2");
    static constexpr size_t kEnvSize = 512;
    static constexpr float kBufSizeF = static_cast<float>(BUFSIZE);
    static constexpr float kNGrainGain = 2.0f / static_cast<float>(NGRAINS);

public:
    void setup(float sample_rate) {
        sample_rate_ = sample_rate;
        for (size_t i = 0; i < kEnvSize; ++i) {
            float phase = static_cast<float>(i) / static_cast<float>(kEnvSize);
            env_[i] = 0.5f * (1.f - cosf(2.f * M_PI * phase));
        }
        for (size_t g = 0; g < NGRAINS; ++g) {
            phase_[g]    = static_cast<float>(g) / static_cast<float>(NGRAINS);
            read_pos_[g] = 0.f;
        }
        updateGrainPitches();
    }

    float __force_inline process(float input, float externalFb = 0.f) {
        if (!frozen_) buf_.write(input + out_ * feedback_ + externalFb + tap_out_ * tap_feedback_);

        float sum = 0.f;
        const float write_idx = static_cast<float>(buf_.getWriteIndex());

        if (hasTap_) {
            float tap_pos = write_idx - start_time_;
            if (tap_pos < 0.f) tap_pos += kBufSizeF;
            tap_out_ = buf_.readAbsolute(tap_pos);
        }

        for (size_t g = 0; g < NGRAINS; ++g) {
            phase_[g] += phase_inc_;
            if (phase_[g] >= 1.0f) {
                phase_[g] -= 1.0f;
                read_pos_[g] = write_idx - start_time_;
                if (read_pos_[g] < 0.f) read_pos_[g] += kBufSizeF;
            }
            const size_t env_idx = static_cast<size_t>(phase_[g] * kEnvSize) & (kEnvSize - 1);
            sum += buf_.readAbsolute(read_pos_[g]) * env_[env_idx];
            read_pos_[g] += grain_pitch_[g];
            if (read_pos_[g] >= kBufSizeF) read_pos_[g] -= kBufSizeF;
            if (read_pos_[g] < 0.f)        read_pos_[g] += kBufSizeF;
        }
        out_ = sum * kNGrainGain;  // grains only — keeps tap out of the grain feedback path
        return out_ + tap_out_ * tap_level_;
    }

    stereosample_t __force_inline processStereo(float input) {
        if (!frozen_) buf_.write(input + out_ * feedback_ + tap_out_ * tap_feedback_);

        float sumL = 0.f, sumR = 0.f;
        const float write_idx = static_cast<float>(buf_.getWriteIndex());

        if (hasTap_) {
            float tap_pos = write_idx - start_time_;
            if (tap_pos < 0.f) tap_pos += kBufSizeF;
            tap_out_ = buf_.readAbsolute(tap_pos);
        }

        for (size_t g = 0; g < NGRAINS; ++g) {
            phase_[g] += phase_inc_;
            if (phase_[g] >= 1.0f) {
                phase_[g] -= 1.0f;
                read_pos_[g] = write_idx - start_time_;
                if (read_pos_[g] < 0.f) read_pos_[g] += kBufSizeF;
            }
            const size_t env_idx = static_cast<size_t>(phase_[g] * kEnvSize) & (kEnvSize - 1);
            const float grainOut = buf_.readAbsolute(read_pos_[g]) * env_[env_idx];
            if (g & 1) sumR += grainOut;
            else       sumL += grainOut;
            read_pos_[g] += grain_pitch_[g];
            if (read_pos_[g] >= kBufSizeF) read_pos_[g] -= kBufSizeF;
            if (read_pos_[g] < 0.f)        read_pos_[g] += kBufSizeF;
        }
        out_ = (sumL + sumR) * kNGrainGain;
        const float tapContrib = tap_out_ * tap_level_;
        return { sumL * kNGrainGain + tapContrib,
                 sumR * kNGrainGain + tapContrib };
    }

    void setGrainLengthSamples(float samples) { phase_inc_ = 1.0f / samples; }
    void setGrainLengthMs(float ms)  { setGrainLengthSamples(ms * 0.001f * sample_rate_); }
    void setStartTimeSamples(float s) { start_time_ = s; }
    void setStartTimeMs(float ms)    { setStartTimeSamples(ms * 0.001f * sample_rate_); }
    void setFeedback(float fb)       { feedback_ = fb; }
    void setPitch(float ratio)       { pitch_ = ratio; updateGrainPitches(); }
    void setPitchSpread(float spread){ pitch_spread_ = spread; updateGrainPitches(); }
    void setTapLevel(float level)    { tap_level_ = level;   hasTap_ = (tap_level_ > 0.f || tap_feedback_ > 0.f); }
    void setTapFeedback(float fb)    { tap_feedback_ = fb;   hasTap_ = (tap_level_ > 0.f || tap_feedback_ > 0.f); }
    void setFreeze(bool freeze)      { frozen_ = freeze; }

    void fillWithSaw(float freqHz) {
        const size_t period = periodSamples(freqHz);
        static int16_t cycle[kMaxPeriod];
        const float inv_period = static_cast<float>(period);
        const float inc = 1.f / inv_period;
        float phase = 0.f;
        for (size_t i = 0; i < period; ++i) {
            float saw = phase * 2.f - 1.f;
            saw -= polyBlep(phase, inc, inv_period);
            cycle[i] = static_cast<int16_t>(saw * 32767.f);
            phase += inc;
            if (phase >= 1.f) phase -= 1.f;
        }
        buf_.fillRepeating(cycle, period);
        resetGrains();
    }

    void fillWithSquare(float freqHz, float duty = 0.5f) {
        const size_t period = periodSamples(freqHz);
        static int16_t cycle[kMaxPeriod];
        const float inv_period = static_cast<float>(period);
        const float inc = 1.f / inv_period;
        float phase = 0.f;
        for (size_t i = 0; i < period; ++i) {
            float sq = (phase < duty) ? 1.f : -1.f;
            sq += polyBlep(phase, inc, inv_period);
            float t2 = phase - duty;
            if (t2 < 0.f) t2 += 1.f;
            sq -= polyBlep(t2, inc, inv_period);
            cycle[i] = static_cast<int16_t>(sq * 32767.f);
            phase += inc;
            if (phase >= 1.f) phase -= 1.f;
        }
        buf_.fillRepeating(cycle, period);
        resetGrains();
    }

    void fillWithTriangle(float freqHz) {
        const size_t period = periodSamples(freqHz);
        static int16_t cycle[kMaxPeriod];
        const float inv_period = static_cast<float>(period);
        const float inc = 1.f / inv_period;
        float phase = 0.f;
        for (size_t i = 0; i < period; ++i) {
            float tri = 2.f * fabsf(2.f * phase - 1.f) - 1.f;
            tri += polyBlamp(phase, inc, inv_period);
            tri -= polyBlamp(phase - 0.5f < 0.f ? phase + 0.5f : phase - 0.5f, inc, inv_period);
            cycle[i] = static_cast<int16_t>(tri * 32767.f);
            phase += inc;
            if (phase >= 1.f) phase -= 1.f;
        }
        buf_.fillRepeating(cycle, period);
        resetGrains();
    }

    void fillWithFallingSaw(float freqHz) {
        const size_t period = periodSamples(freqHz);
        static int16_t cycle[kMaxPeriod];
        const float inv_period = static_cast<float>(period);
        const float inc = 1.f / inv_period;
        float phase = 0.f;
        for (size_t i = 0; i < period; ++i) {
            float saw = 1.f - phase * 2.f;
            saw += polyBlep(phase, inc, inv_period);
            cycle[i] = static_cast<int16_t>(saw * 32767.f);
            phase += inc;
            if (phase >= 1.f) phase -= 1.f;
        }
        buf_.fillRepeating(cycle, period);
        resetGrains();
    }

    void fillWithSine(float freqHz) {
        const size_t period = periodSamples(freqHz);
        static int16_t cycle[kMaxPeriod];
        const float phase_inc = 2.f * static_cast<float>(M_PI) / static_cast<float>(period);
        float phase = 0.f;
        for (size_t i = 0; i < period; ++i) {
            cycle[i] = static_cast<int16_t>(sinf(phase) * 32767.f);
            phase += phase_inc;
        }
        buf_.fillRepeating(cycle, period);
        resetGrains();
    }

    // Half-rectified sine: positive half of sine, zero for negative half.
    // PolyBLAMP at both zero crossings (both are positive slope jumps).
    void fillWithHalfRectSine(float freqHz) {
        const size_t period = periodSamples(freqHz);
        static int16_t cycle[kMaxPeriod];
        const float inv_period = static_cast<float>(period);
        const float inc = 1.f / inv_period;
        float phase = 0.f;
        for (size_t i = 0; i < period; ++i) {
            const float s = sinf(phase * 2.f * static_cast<float>(M_PI));
            float val = s > 0.f ? s : 0.f;
            val += polyBlamp(phase, inc, inv_period);
            const float t2 = phase >= 0.5f ? phase - 0.5f : phase + 0.5f;
            val += polyBlamp(t2, inc, inv_period);
            cycle[i] = static_cast<int16_t>(val * 32767.f);
            phase += inc;
            if (phase >= 1.f) phase -= 1.f;
        }
        buf_.fillRepeating(cycle, period);
        resetGrains();
    }

    // Trapezoidal: square with sloped edges. rise=0 → square, rise=0.5 → triangle.
    // PolyBLAMP at all 4 corners.
    void fillWithTrapezoid(float freqHz, float rise = 0.2f) {
        rise = fmaxf(0.01f, fminf(0.49f, rise));
        const size_t period = periodSamples(freqHz);
        static int16_t cycle[kMaxPeriod];
        const float inv_period = static_cast<float>(period);
        const float inc = 1.f / inv_period;
        float phase = 0.f;
        for (size_t i = 0; i < period; ++i) {
            float trap;
            if      (phase < rise)          trap =  phase / rise * 2.f - 1.f;
            else if (phase < 0.5f)          trap =  1.f;
            else if (phase < 0.5f + rise)   trap =  1.f - (phase - 0.5f) / rise * 2.f;
            else                            trap = -1.f;

            // corners: 0(+), rise(-), 0.5(-), 0.5+rise(+)
            trap += polyBlamp(phase, inc, inv_period);
            float t1 = phase - rise;           if (t1 < 0.f) t1 += 1.f;
            trap -= polyBlamp(t1, inc, inv_period);
            float t2 = phase - 0.5f;           if (t2 < 0.f) t2 += 1.f;
            trap -= polyBlamp(t2, inc, inv_period);
            float t3 = phase - (0.5f + rise);  if (t3 < 0.f) t3 += 1.f;
            trap += polyBlamp(t3, inc, inv_period);

            cycle[i] = static_cast<int16_t>(trap * 32767.f);
            phase += inc;
            if (phase >= 1.f) phase -= 1.f;
        }
        buf_.fillRepeating(cycle, period);
        resetGrains();
    }

    // Asymmetric triangle: peak position 0..1 (0.5 = symmetric triangle,
    // 0 → falling saw, 1 → rising saw). PolyBLAMP at both corners.
    void fillWithAsymTriangle(float freqHz, float peak = 0.5f) {
        peak = fmaxf(0.01f, fminf(0.99f, peak));
        const size_t period = periodSamples(freqHz);
        static int16_t cycle[kMaxPeriod];
        const float inv_period = static_cast<float>(period);
        const float inc = 1.f / inv_period;
        float phase = 0.f;
        for (size_t i = 0; i < period; ++i) {
            float tri = (phase < peak)
                ? (phase / peak * 2.f - 1.f)
                : (1.f - (phase - peak) / (1.f - peak) * 2.f);
            tri += polyBlamp(phase, inc, inv_period);
            float t1 = phase - peak; if (t1 < 0.f) t1 += 1.f;
            tri -= polyBlamp(t1, inc, inv_period);
            cycle[i] = static_cast<int16_t>(tri * 32767.f);
            phase += inc;
            if (phase >= 1.f) phase -= 1.f;
        }
        buf_.fillRepeating(cycle, period);
        resetGrains();
    }

    // Staircase: quantised rising saw. PolyBLEP corrects the wrap discontinuity;
    // individual step transitions are small (2/(steps-1)) so their aliasing is mild.
    void fillWithStaircase(float freqHz, size_t steps = 8) {
        steps = std::max(size_t(2), std::min(steps, size_t(32)));
        const size_t period = periodSamples(freqHz);
        static int16_t cycle[kMaxPeriod];
        const float inv_period = static_cast<float>(period);
        const float inc = 1.f / inv_period;
        const float fsteps = static_cast<float>(steps);
        float phase = 0.f;
        for (size_t i = 0; i < period; ++i) {
            float saw = phase * 2.f - 1.f;
            saw -= polyBlep(phase, inc, inv_period);
            const float stair = roundf((saw + 1.f) * 0.5f * (fsteps - 1.f))
                                * 2.f / (fsteps - 1.f) - 1.f;
            cycle[i] = static_cast<int16_t>(stair * 32767.f);
            phase += inc;
            if (phase >= 1.f) phase -= 1.f;
        }
        buf_.fillRepeating(cycle, period);
        resetGrains();
    }

private:
    DynamicDelayI16<BUFSIZE> buf_;
    float env_[kEnvSize] = {};
    float phase_[NGRAINS]    = {};
    float read_pos_[NGRAINS] = {};
    float phase_inc_  = 1.0f / 4800.f;  // default 100ms at 48kHz
    float start_time_ = 8000.f;          // default ~167ms
    float feedback_   = 0.3f;
    float pitch_      = 1.0f;
    float pitch_spread_ = 0.f;
    float grain_pitch_[NGRAINS] = {};
    float tap_level_   = 0.f;
    float tap_feedback_= 0.f;
    float tap_out_     = 0.f;
    float out_        = 0.f;
    bool  frozen_     = false;
    bool  hasTap_     = false;
    float sample_rate_= 48000.f;

    static constexpr size_t kMaxPeriod = 4096;

    size_t periodSamples(float freqHz) const {
        return std::min(static_cast<size_t>(sample_rate_ / freqHz + 0.5f), kMaxPeriod);
    }

    void resetGrains() {
        const float wi = static_cast<float>(buf_.getWriteIndex());
        for (size_t g = 0; g < NGRAINS; ++g) {
            read_pos_[g] = wi - start_time_;
            if (read_pos_[g] < 0.f) read_pos_[g] += kBufSizeF;
            phase_[g] = static_cast<float>(g) / static_cast<float>(NGRAINS);
        }
        out_ = 0.f;
        tap_out_ = 0.f;
    }

    static float polyBlep(float t, float dt, float inv_dt) {
        if      (t < dt)       { t *= inv_dt;             return  t + t - t*t - 1.f; }
        else if (t > 1.f - dt) { t = (t - 1.f) * inv_dt; return t*t + t + t + 1.f; }
        return 0.f;
    }

    // PolyBLAMP: corrects slope discontinuities (triangle wave corners)
    static float polyBlamp(float t, float dt, float inv_dt) {
        if      (t < dt)       { t *= inv_dt; return dt * ( t*t*t/3.f - t*t + 1.f); }
        else if (t > 1.f - dt) { t = (t - 1.f) * inv_dt; return dt * (t*t*t/3.f + t*t + 1.f); }
        return 0.f;
    }

    void updateGrainPitches() {
        for (size_t g = 0; g < NGRAINS; ++g) {
            float t = NGRAINS > 1
                ? static_cast<float>(g) / static_cast<float>(NGRAINS - 1)
                : 0.5f;
            grain_pitch_[g] = pitch_ + pitch_spread_ * (t - 0.5f);
        }
    }
};
