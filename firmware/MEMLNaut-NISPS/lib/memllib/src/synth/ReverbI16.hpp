#pragma once

#include "maximilian.h"
#include <utility>
#include <cmath>

// Freeverb-style reverb using int16 delay lines.
// 4 parallel LP-filtered feedback combs → 2 serial Schroeder allpasses → stereo out.
// COMB_SIZE must be a power of 2 (DynamicDelayI16 bitmask requirement).
// At default COMB_SIZE=4096: ~40 KB RAM, ~75 ops/sample ≈ 1.5% CPU at 200MHz/48kHz.
template<size_t COMB_SIZE = 4096>
class ReverbI16 {
    static_assert((COMB_SIZE & (COMB_SIZE - 1)) == 0, "COMB_SIZE must be a power of 2");
    static constexpr size_t AP_SIZE    = COMB_SIZE / 4;  // 1024
    static constexpr size_t PRE_SIZE   = COMB_SIZE / 2;  // 2048 (~42ms at 48kHz)
    static constexpr size_t DECOR_SIZE = 64;

    // Comb bases as fraction of sample rate; scale range [0.5, 1.1] keeps max < COMB_SIZE.
    // (Read only at control rate in setSize, so flash residence is fine here.)
    static constexpr float kCombBases[4] = {0.0500f, 0.0561f, 0.0625f, 0.0688f};
    // Allpass fixed times live as SRAM statics in processCore() (hot path) — see note there.

    DynamicDelayI16<COMB_SIZE> combs_[4];
    DynamicDelayI16<AP_SIZE>   aps_[2];
    DynamicDelayI16<PRE_SIZE>  preDelay_;
    DynamicDelayI16<DECOR_SIZE> decorR_;

    float dampState_[4] = {};
    float hpfLpState_   = 0.f;

    float lfo1_ = 0.f;
    float lfo2_ = 0.5f;

    // Written by ProcessParams (Core 1 bg), read by process() ISR (Core 1 hi).
    // Same-core aligned float reads/writes are safe on Cortex-M33.
    float combTimes_[4]    = {};
    float feedbackGain_    = 0.60f;
    float dampCoeff_       = 0.50f;
    float apGain_          = 0.50f;
    float modDepth_        = 0.f;
    float modInc_          = 0.f;
    float preDelaySamples_ = 0.f;
    float hpfCoeff_        = 0.f;
    float width_           = 0.7f;
    float satDrive_        = 0.f;
    float sampleRate_      = 48000.f;

    // Cheap cubic soft-clip (no divide): ~unity for |x|<1, smoothly reaches ±1 at ±1.5,
    // hard-limits beyond. Applied to the recirculating writes so overload saturates gently
    // instead of the int16 delay line's harsh ±1 hard-clamp.
    static float __force_inline softLimit(float x) {
        // Constants in SRAM (non-const static) to avoid flash literal-pool reads in the hot path.
        static float kLim = 1.5f;
        static float kCub = 0.148148f;  // 4/27
        if (x >  kLim) return  1.f;
        if (x < -kLim) return -1.f;
        return x - x * x * x * kCub;
    }

public:
    void setup(float sr) {
        sampleRate_ = sr;
        // Fast smoothing on combs so LFO modulation tracks correctly
        for (auto& c : combs_) c.setSmoothCoeff(0.99f);
        setSize(0.5f);
    }

    // 0-1 → scale 0.5-1.1; combTimes_ derived from base × scale × sr
    void setSize(float v) {
        const float scale = 0.5f + v * 0.6f;
        const float maxT  = static_cast<float>(COMB_SIZE - 2);
        for (int i = 0; i < 4; ++i)
            combTimes_[i] = fminf(kCombBases[i] * sampleRate_ * scale, maxT);
    }

    void setDecay(float v)       { feedbackGain_    = 0.30f + v * 0.67f; }
    void setDamping(float v)     { dampCoeff_       = v * 0.92f; }
    void setDiffusion(float v)   { apGain_          = 0.30f + v * 0.45f; }
    void setModDepth(float v)    { modDepth_        = v * 20.f; }
    void setModRate(float v)     { modInc_          = (0.1f + v * 4.9f) / sampleRate_; }
    void setPreDelay(float v)    { preDelaySamples_ = v * static_cast<float>(PRE_SIZE - 1); }
    void setLowCut(float v)      { hpfCoeff_        = v * 0.05f; }
    void setStereoWidth(float v) { width_           = v; }
    void setSaturation(float v)  { satDrive_        = v * 4.f; }

    // Shared mono reverb core: HPF → predelay → 4 LP-combs → saturation → 2 allpasses.
    // Returns the wet mono signal; process()/processMono() build their output from it.
    float __force_inline processCore(float in) {
        // Hot-path constants kept in SRAM (non-const static) so the per-sample loop reads them
        // from RAM rather than the flash literal pool (XIP reads are far slower). NOT const.
        static float kAPTimes[2] = {605.f, 480.f};  // Schroeder allpass delay times
        static float kLfo2Rate   = 1.3f;
        static float kTriA       = 4.f;
        static float kTriB       = 3.f;
        static float kCombScale  = 0.25f;            // average of 4 combs
        static float kSatA       = 27.f;
        static float kSatB       = 9.f;

        // Input HPF (1-pole: y_lp += coeff*(x - y_lp); y_hp = x - y_lp).
        // coeff IS the cutoff: 0 => y_lp frozen => y_hp = x (no cut, full signal).
        hpfLpState_ += hpfCoeff_ * (in - hpfLpState_);
        float sig = in - hpfLpState_;

        // Pre-delay
        if (preDelaySamples_ >= 1.f) {
            const float pd = preDelay_.read(preDelaySamples_);
            preDelay_.write(softLimit(sig));
            sig = pd;
        }

        // Dual triangle LFOs (antiphase: lfo2 offset by 0.5 period, runs at 1.3× rate)
        lfo1_ += modInc_;
        if (lfo1_ >= 1.f) lfo1_ -= 1.f;
        lfo2_ += modInc_ * kLfo2Rate;
        if (lfo2_ >= 1.f) lfo2_ -= 1.f;
        const float tri1 = lfo1_ < 0.5f ? kTriA * lfo1_ - 1.f : kTriB - kTriA * lfo1_;
        const float tri2 = lfo2_ < 0.5f ? kTriA * lfo2_ - 1.f : kTriB - kTriA * lfo2_;

        // 4 parallel LP-comb filters
        float combSum = 0.f;
        for (int i = 0; i < 4; ++i) {
            const float lfo = (i < 2) ? tri1 : tri2;
            const float y   = combs_[i].read(combTimes_[i] + lfo * modDepth_);
            dampState_[i]   = dampState_[i] * dampCoeff_ + y * (1.f - dampCoeff_);
            combs_[i].write(softLimit(sig + dampState_[i] * feedbackGain_));
            combSum += dampState_[i];
        }
        combSum *= kCombScale;

        // Optional tail saturation (normalised fasttanh)
        if (satDrive_ > 0.f) {
            const float xd = combSum * satDrive_;
            const float x2 = xd * xd;
            combSum = (xd * (kSatA + x2) / (kSatA + kSatB * x2)) / satDrive_;
        }

        // 2 serial Schroeder allpasses
        for (int i = 0; i < 2; ++i) {
            const float delayed = aps_[i].read(kAPTimes[i]);
            const float v = combSum - delayed * apGain_;
            aps_[i].write(softLimit(v));
            combSum = v * apGain_ + delayed;
        }
        return combSum;
    }

    // Wet-only MONO output — cheapest path (skips the stereo decorrelation tail). Use when
    // the caller only needs a mono reverb (copies to L/R itself).
    float __force_inline processMono(float in) { return processCore(in); }

    // Wet-only stereo pair; caller applies wet/dry crossfade.
    std::pair<float, float> __force_inline process(float in) {
        const float combSum = processCore(in);
        // Stereo decorrelation on R (fixed 23-sample delay) + width (mid-side)
        const float L = combSum;
        const float R = decorR_.read(23.f);
        decorR_.write(combSum);
        const float mid  = (L + R) * 0.5f;
        const float side = (L - R) * 0.5f;
        return { mid + side * width_, mid - side * width_ };
    }
};


// Larger, denser, true-stereo variant. Same public API as ReverbI16 (drop-in), but:
//   input diffusion (2 allpasses) → 8 LP-combs split into L/R banks → per-channel
//   allpass chains → width. ~2x the RAM/CPU of ReverbI16 (~78 KB, ~3% CPU at COMB_SIZE
//   4096). Pick per mode by choosing the class: DJFX uses this; SaxFX uses ReverbI16.
template<size_t COMB_SIZE = 4096>
class ReverbI16Large {
    static_assert((COMB_SIZE & (COMB_SIZE - 1)) == 0, "COMB_SIZE must be a power of 2");
    // AP/PRE/DIFF are fixed (independent of COMB_SIZE) so the allpass/predelay/diffuser
    // times always fit even when COMB_SIZE is small (e.g. 2048). Only the combs — which
    // set the room size and dominate RAM — scale with COMB_SIZE.
    static constexpr size_t AP_SIZE   = 1024;  // holds <=556
    static constexpr size_t PRE_SIZE  = 2048;  // ~42ms predelay
    static constexpr size_t DIFF_SIZE = 512;   // input diffusers (holds <=142)

    // 8 comb bases (Freeverb tunings ×2 for a bigger room), as fraction of sample rate.
    // Longest = 0.0733·48k·1.1 ≈ 3870 < COMB_SIZE, so they fit at max size.
    static constexpr float kCombBases[8] = {
        0.0506f, 0.0539f, 0.0579f, 0.0615f, 0.0645f, 0.0676f, 0.0706f, 0.0733f
    };
    // Per-sample-read allpass/diffuser times + gain live as SRAM statics in process()
    // (avoid flash literal-pool reads in the hot loop). kCombBases stays — read only in setSize.

    DynamicDelayI16<COMB_SIZE> combs_[8];
    DynamicDelayI16<AP_SIZE>   apsL_[2];
    DynamicDelayI16<AP_SIZE>   apsR_[2];
    DynamicDelayI16<DIFF_SIZE> inDiff_[2];
    DynamicDelayI16<PRE_SIZE>  preDelay_;

    float dampState_[8] = {};
    float hpfLpState_   = 0.f;
    float lfo1_ = 0.f, lfo2_ = 0.5f;

    float combTimes_[8]    = {};
    float feedbackGain_    = 0.60f;
    float dampCoeff_       = 0.50f;
    float apGain_          = 0.50f;
    float modDepth_        = 0.f;
    float modInc_          = 0.f;
    float preDelaySamples_ = 0.f;
    float hpfCoeff_        = 0.f;
    float width_           = 0.7f;
    float satDrive_        = 0.f;
    float sampleRate_      = 48000.f;

    float __force_inline saturate(float x) const {
        static float kA = 27.f, kB = 9.f;  // SRAM, not flash literals
        const float xd = x * satDrive_;
        const float x2 = xd * xd;
        return (xd * (kA + x2) / (kA + kB * x2)) / satDrive_;
    }

    // Cheap cubic soft-clip (no divide): ~unity for |x|<1, smoothly reaches ±1 at ±1.5,
    // hard-limits beyond. Applied to the reverb's recirculating writes so overload becomes
    // gentle saturation instead of the int16 delay line's harsh ±1 hard-clamp.
    static float __force_inline softLimit(float x) {
        // Constants in SRAM (non-const static) to avoid flash literal-pool reads in the hot path.
        static float kLim = 1.5f;
        static float kCub = 0.148148f;  // 4/27
        if (x >  kLim) return  1.f;
        if (x < -kLim) return -1.f;
        return x - x * x * x * kCub;
    }

public:
    void setup(float sr) {
        sampleRate_ = sr;
        for (auto& c : combs_) c.setSmoothCoeff(0.99f);
        setSize(0.5f);
    }

    void setSize(float v) {
        // Comb base tunings are sized for COMB_SIZE=4096; scale them by COMB_SIZE/4096 so
        // they fit (and stay mutually distinct) at any buffer size — a smaller COMB_SIZE
        // simply gives a smaller room.
        const float scale = (0.5f + v * 0.6f) * (static_cast<float>(COMB_SIZE) / 4096.f);
        const float maxT  = static_cast<float>(COMB_SIZE - 2);
        for (int i = 0; i < 8; ++i)
            combTimes_[i] = fminf(kCombBases[i] * sampleRate_ * scale, maxT);
    }

    void setDecay(float v)       { feedbackGain_    = 0.30f + v * 0.685f; } // up to ~0.985
    void setDamping(float v)     { dampCoeff_       = v * 0.92f; }
    void setDiffusion(float v)   { apGain_          = 0.30f + v * 0.45f; }
    void setModDepth(float v)    { modDepth_        = v * 20.f; }
    void setModRate(float v)     { modInc_          = (0.1f + v * 4.9f) / sampleRate_; }
    void setPreDelay(float v)    { preDelaySamples_ = v * static_cast<float>(PRE_SIZE - 1); }
    void setLowCut(float v)      { hpfCoeff_        = v * 0.05f; }
    void setStereoWidth(float v) { width_           = v; }
    void setSaturation(float v)  { satDrive_        = v * 4.f; }

    std::pair<float, float> __force_inline process(float in) {
        // Hot-path constants in SRAM (non-const static) — avoid flash literal-pool reads.
        static float kInDiffTimes[2] = {142.f, 107.f};
        static float kAPTimesL[2]    = {556.f, 441.f};
        static float kAPTimesR[2]    = {341.f, 225.f};
        static float kInDiffGain     = 0.7f;
        static float kLfo2Rate       = 1.3f;
        static float kTriA           = 4.f;
        static float kTriB           = 3.f;
        static float kCombScale      = 0.25f;  // 4 combs per channel

        // Input HPF (see ReverbI16 for the 1-pole derivation)
        hpfLpState_ += hpfCoeff_ * (in - hpfLpState_);
        float sig = in - hpfLpState_;

        // Pre-delay
        if (preDelaySamples_ >= 1.f) {
            const float pd = preDelay_.read(preDelaySamples_);
            preDelay_.write(softLimit(sig));
            sig = pd;
        }

        // Input diffusion — 2 allpasses smear transients into a dense wash
        for (int k = 0; k < 2; ++k) {
            const float d = inDiff_[k].read(kInDiffTimes[k]);
            const float v = sig - d * kInDiffGain;
            inDiff_[k].write(softLimit(v));
            sig = v * kInDiffGain + d;
        }

        // Dual triangle LFOs (antiphase, lfo2 at 1.3× rate)
        lfo1_ += modInc_;              if (lfo1_ >= 1.f) lfo1_ -= 1.f;
        lfo2_ += modInc_ * kLfo2Rate;  if (lfo2_ >= 1.f) lfo2_ -= 1.f;
        const float tri1 = lfo1_ < 0.5f ? kTriA * lfo1_ - 1.f : kTriB - kTriA * lfo1_;
        const float tri2 = lfo2_ < 0.5f ? kTriA * lfo2_ - 1.f : kTriB - kTriA * lfo2_;

        // 8 LP-combs, split into L (even) / R (odd) banks for true stereo
        float combL = 0.f, combR = 0.f;
        for (int i = 0; i < 8; ++i) {
            const float lfo = (i < 4) ? tri1 : tri2;
            const float y   = combs_[i].read(combTimes_[i] + lfo * modDepth_);
            dampState_[i]   = dampState_[i] * dampCoeff_ + y * (1.f - dampCoeff_);
            combs_[i].write(softLimit(sig + dampState_[i] * feedbackGain_));
            if (i & 1) combR += dampState_[i]; else combL += dampState_[i];
        }
        combL *= kCombScale;
        combR *= kCombScale;

        if (satDrive_ > 0.f) { combL = saturate(combL); combR = saturate(combR); }

        // Per-channel allpass chains (stereo diffusion)
        for (int k = 0; k < 2; ++k) {
            const float d = apsL_[k].read(kAPTimesL[k]);
            const float v = combL - d * apGain_;
            apsL_[k].write(softLimit(v));
            combL = v * apGain_ + d;
        }
        for (int k = 0; k < 2; ++k) {
            const float d = apsR_[k].read(kAPTimesR[k]);
            const float v = combR - d * apGain_;
            apsR_[k].write(softLimit(v));
            combR = v * apGain_ + d;
        }

        // Width (mid-side)
        const float mid  = (combL + combR) * 0.5f;
        const float side = (combL - combR) * 0.5f;
        return { mid + side * width_, mid - side * width_ };
    }
};
