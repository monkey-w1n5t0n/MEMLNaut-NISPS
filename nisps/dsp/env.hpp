// nisps/dsp/env.hpp — ADSR + AR envelope generators.
//
// Direct port of memllib's ADSRLite (which we used in the firmware engines).
// All time arguments in milliseconds; sample-rate is bound at `setup()`.
//
// ADSR semantics
//   trigger(velocity)  — start ATTACK with given velocity scale
//   release()          — switch to RELEASE from current value
//   reset()            — back to WAITTOTRIG (silent)
//
// `play()` advances one sample and returns env * velocity.

#pragma once

#include <cmath>

#include "../core/perf.hpp"

namespace nisps {

class ADSR {
   public:
    enum class Stage { WaitToTrig, Attack, Decay, Sustain, Release };

    ADSR() noexcept = default;

    void setup(float attack_ms, float decay_ms,
               float sustain_level, float release_ms,
               float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        set_attack(attack_ms);
        set_decay(decay_ms);
        sustain_level_ = sustain_level;
        // decay travels (1 - sustain) per attack-time worth of samples
        decay_inc_ *= (1.f - sustain_level_);
        release_ms_ = release_ms;
    }

    void set_attack(float attack_ms) noexcept {
        if (attack_ms > 0.f) {
            attack_inc_full_ = 1.f / ((attack_ms * 0.001f) * sample_rate_);
        } else {
            attack_inc_full_ = 0.f;
        }
        attack_inc_ = attack_inc_full_;
    }
    void set_decay(float decay_ms) noexcept {
        if (decay_ms > 0.f) {
            decay_inc_ = 1.f / ((decay_ms * 0.001f) * sample_rate_);
        } else {
            decay_inc_ = 0.f;
        }
    }
    void set_release(float release_ms) noexcept { release_ms_ = release_ms; }
    void set_sustain(float level) noexcept { sustain_level_ = level; }

    NISPS_HOT NISPS_FORCE_INLINE float play() noexcept {
        switch (stage_) {
            case Stage::WaitToTrig: env_ = 0.f; break;
            case Stage::Attack:
                env_ += attack_inc_;
                if (env_ >= 1.f) { env_ = 1.f; stage_ = Stage::Decay; }
                break;
            case Stage::Decay:
                env_ -= decay_inc_;
                if (env_ <= sustain_level_) { env_ = sustain_level_; stage_ = Stage::Sustain; }
                break;
            case Stage::Sustain: break;
            case Stage::Release:
                env_ -= rel_inc_;
                if (env_ <= 0.f) { env_ = 0.f; stage_ = Stage::WaitToTrig; }
                break;
        }
        return env_ * velocity_;
    }

    void reset() noexcept {
        stage_ = Stage::WaitToTrig;
        env_   = 0.f;
    }

    void trigger(float velocity) noexcept {
        stage_      = Stage::Attack;
        attack_inc_ = attack_inc_full_ * (1.f - env_);
        velocity_   = velocity;
    }

    void trigger_if_ready(float velocity) noexcept {
        if (stage_ == Stage::WaitToTrig) trigger(velocity);
    }

    void release() noexcept {
        if (release_ms_ > 0.f) {
            rel_inc_ = 1.f / ((release_ms_ * 0.001f) * sample_rate_);
            rel_inc_ *= env_;
            stage_ = Stage::Release;
        } else {
            rel_inc_ = 0.f;
            stage_   = Stage::WaitToTrig;
        }
    }

    Stage stage() const noexcept { return stage_; }

   private:
    float sample_rate_     = 48000.f;
    float attack_inc_      = 0.f;
    float attack_inc_full_ = 0.f;
    float decay_inc_       = 0.f;
    float sustain_level_   = 0.f;
    float rel_inc_         = 0.f;
    float release_ms_      = 0.f;
    float env_             = 0.f;
    float velocity_        = 1.f;
    Stage stage_           = Stage::WaitToTrig;
};

}  // namespace nisps
