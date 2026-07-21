#pragma once

#include "maximilian.h"

// ─────────────────────────────────────────────────────────────────────────────
// FlangerI16
// Short modulated delay (0–BUFSIZE samples).
// process(input, delayBaseSamples, depth, ratHz, feedback, mix)
//   mix 0 = dry, mix 1 = classic 50/50 flange
// ─────────────────────────────────────────────────────────────────────────────
template<size_t BUFSIZE = 1024>
class FlangerI16 {
    static_assert((BUFSIZE & (BUFSIZE - 1)) == 0, "BUFSIZE must be a power of 2");
public:
    float __force_inline process(float input, float delayBase,
                                 float depth, float rate,
                                 float feedback, float mix)
    {
        const float lfoVal = lfo_.sinewave(rate);
        const float delayTime = fmaxf(1.f, delayBase * (1.f + depth * lfoVal));
        const float out = buf_.read(delayTime);
        buf_.write(input + out * feedback);
        // mix=0 → dry; mix=1 → 50% dry + 50% delayed
        return input * (1.f - mix * 0.5f) + out * (mix * 0.5f);
    }

private:
    DynamicDelayI16<BUFSIZE> buf_;
    maxiOsc lfo_;
};


// ─────────────────────────────────────────────────────────────────────────────
// ChorusI16
// Two-voice chorus. Second LFO starts 180° offset and runs at a slightly
// different rate for a richer, detuned character.
// process(input, delayBaseSamples, depth, rateHz, feedback, mix)
//   mix 0 = dry, mix 1 = 1/3 dry + 1/3 voice1 + 1/3 voice2
// ─────────────────────────────────────────────────────────────────────────────
template<size_t BUFSIZE = 4096>
class ChorusI16 {
    static_assert((BUFSIZE & (BUFSIZE - 1)) == 0, "BUFSIZE must be a power of 2");
public:
    ChorusI16() { lfo2_.phase = 0.5f; }

    float __force_inline process(float input, float delayBase,
                                 float depth, float rate,
                                 float feedback, float mix)
    {
        const float lfo1 = lfo1_.sinewave(rate);
        const float lfo2 = lfo2_.sinewave(rate * 1.02f);

        const float out1 = buf1_.read(fmaxf(1.f, delayBase * (1.f + depth * lfo1)));
        const float out2 = buf2_.read(fmaxf(1.f, delayBase * (1.f + depth * lfo2 * 0.97f)));

        buf1_.write(input + out1 * feedback);
        buf2_.write(input + out2 * feedback * 0.98f);

        const float wet = (input + out1 + out2) * 0.3333f;
        return input * (1.f - mix) + wet * mix;
    }

private:
    DynamicDelayI16<BUFSIZE> buf1_, buf2_;
    maxiOsc lfo1_, lfo2_;
};


// ─────────────────────────────────────────────────────────────────────────────
// RingMod
// Multiply input by a sine carrier. mix=0 dry, mix=1 full ring mod.
// process(input, freqHz, mix)
// ─────────────────────────────────────────────────────────────────────────────
class RingMod {
public:
    // Advance oscillator once and return carrier value — use for stereo.
    float __force_inline carrier(float freqHz) { return osc_.sinewave(freqHz); }

    float __force_inline process(float input, float freqHz, float mix)
    {
        const float c = carrier(freqHz);
        return input * (1.f - mix) + (input * c) * mix;
    }
private:
    maxiOsc osc_;
};


// ─────────────────────────────────────────────────────────────────────────────
// StutterGate
// Rhythmic gate synced to a pre-computed period in samples.
// process(input, periodSamples, dutyCycle, mix)
//   dutyCycle: 0-1 fraction of period that is open
//   mix: 0 = dry (gate bypassed), 1 = full stutter
// ─────────────────────────────────────────────────────────────────────────────
class StutterGate {
public:
    // Advance phase once and return gate multiplier (0 or 1) — use for stereo.
    float __force_inline gateValue(float periodSamples, float dutyCycle)
    {
        phase_ += 1.f;
        if (phase_ >= periodSamples) phase_ -= periodSamples;
        return (phase_ / periodSamples < dutyCycle) ? 1.f : 0.f;
    }

    float __force_inline process(float input, float periodSamples, float dutyCycle, float mix)
    {
        const float gate = gateValue(periodSamples, dutyCycle);
        return input * (1.f - mix) + input * gate * mix;
    }
private:
    float phase_{0.f};
};


// ─────────────────────────────────────────────────────────────────────────────
// BitCrusher
// Combines bit-depth reduction and sample-rate reduction.
// process(input, bits, rateDiv, mix)
//   bits   : effective bit depth (e.g. 4.0 = 4-bit)
//   rateDiv: sample-hold period in samples (1 = off, 32 = extreme)
//   mix    : 0 = dry, 1 = full crush
// ─────────────────────────────────────────────────────────────────────────────
class BitCrusher {
public:
    float __force_inline process(float input, float bits, float rateDiv, float mix)
    {
        if (++phase_ >= static_cast<int>(rateDiv)) {
            phase_ = 0;
            heldL_ = input;
        }
        const float levels = powf(2.f, bits) - 1.f;
        return input * (1.f - mix) + roundf(heldL_ * levels) / levels * mix;
    }

    // Stereo version: advances phase once, holds L and R independently.
    void __force_inline processStereo(float& L, float& R, float bits, float rateDiv, float mix)
    {
        if (++phase_ >= static_cast<int>(rateDiv)) {
            phase_ = 0;
            heldL_ = L;
            heldR_ = R;
        }
        const float levels = powf(2.f, bits) - 1.f;
        L = L * (1.f - mix) + roundf(heldL_ * levels) / levels * mix;
        R = R * (1.f - mix) + roundf(heldR_ * levels) / levels * mix;
    }
private:
    float heldL_{0.f}, heldR_{0.f};
    int   phase_{0};
};


// ─────────────────────────────────────────────────────────────────────────────
// AllpassI16
// Schroeder allpass: y[n] = -g*x[n] + x[n-D] + g*y[n-D]
// Unity gain across all frequencies; adds diffuse phase dispersion.
// process(input, delaySamples, g)
//   g: 0–1, typical 0.5–0.7
// ─────────────────────────────────────────────────────────────────────────────
template<size_t BUFSIZE = 4096>
class AllpassI16 {
    static_assert((BUFSIZE & (BUFSIZE - 1)) == 0, "BUFSIZE must be a power of 2");
    static constexpr float kBufF = static_cast<float>(BUFSIZE);
public:
    float __force_inline process(float input, float delaySamples, float g)
    {
        const float dt = fminf(delaySamples, kBufF - 1.f);
        float readPos = static_cast<float>(buf_.getWriteIndex()) - dt;
        if (readPos < 0.f) readPos += kBufF;
        const float delayed = buf_.readAbsolute(readPos);
        const float v = input + g * delayed;
        buf_.write(v);
        return -g * v + delayed;
    }

private:
    DynamicDelayI16<BUFSIZE> buf_;
};
