// nisps/dsp/seq_clock.hpp — shared bar-phasor + 24-PPQN MIDI-clock phasor +
// control-rate sample counter for sequencer engines.
//
// Extracted from the byte-for-byte-identical bar/MIDI-clock/counter/
// update_bpm member blocks previously duplicated in nisps/engines/breakor.hpp
// and nisps/engines/elysiamorf.hpp (2026-07 simplification audit, finding
// L8). The one place the two engines differ is the control-rate divisor
// (breakor: 400 samples/tick, elysiamorf: 500) — SeqClock takes that as a
// constructor argument instead of baking it in, so it stays a per-engine
// choice.
//
// Call shape (matches the original inlined code exactly, just moved behind
// two named methods):
//   process() per sample:
//     if (clock.tick_midi_clock()) { emit Clock event }
//     if (clock.tick_bar()) { use clock.bar_phasor() to drive tracks }
//   setup() / set_playing(false):
//     clock.reset();
//   whenever bpm changes:
//     clock.update_bpm(bpm, sample_rate);

#pragma once

#include <cstddef>

#include "../core/perf.hpp"

namespace nisps {

class SeqClock {
   public:
    explicit SeqClock(std::size_t seq_sample_div) noexcept
        : seq_sample_div_(seq_sample_div) {}

    // Resets phase/counter state. Does NOT touch bpm_/the *_inc_ rates —
    // callers re-derive those via update_bpm() on setup(), matching the
    // original engines (which called update_bpm(90.f) once in setup()).
    void reset() noexcept {
        bar_phasor_        = 0.f;
        midi_clock_phasor_ = 0.f;
        sample_counter_    = 0u;
    }

    void update_bpm(float bpm, float sample_rate) noexcept {
        bpm_ = bpm;
        const float beat_seconds = 60.f / bpm;
        const float bar_seconds  = beat_seconds * 4.f;
        const float bar_samples  = bar_seconds * (sample_rate / static_cast<float>(seq_sample_div_));
        bar_phasor_inc_ = 1.f / bar_samples;
        const float clock_seconds = beat_seconds / 24.f;
        midi_clock_phasor_inc_ = 1.f / (clock_seconds * sample_rate);
    }

    // Advances the MIDI-clock phasor by one sample. Returns true exactly on
    // the sample the phasor wraps (caller emits a Clock event then).
    NISPS_FORCE_INLINE bool tick_midi_clock() noexcept {
        midi_clock_phasor_ += midi_clock_phasor_inc_;
        if (midi_clock_phasor_ >= 1.f) {
            midi_clock_phasor_ -= 1.f;
            return true;
        }
        return false;
    }

    // Advances the control-rate sample counter by one sample, advancing (and
    // wrapping) the bar phasor exactly when the counter was at 0 — i.e. once
    // every `seq_sample_div_` samples. Returns whether the bar phasor
    // advanced this call (caller should re-evaluate tracks against
    // bar_phasor() when true).
    NISPS_FORCE_INLINE bool tick_bar() noexcept {
        bool fired = false;
        if (sample_counter_ == 0u) {
            bar_phasor_ += bar_phasor_inc_;
            if (bar_phasor_ >= 1.f) bar_phasor_ -= 1.f;
            fired = true;
        }
        ++sample_counter_;
        if (sample_counter_ >= seq_sample_div_) sample_counter_ = 0u;
        return fired;
    }

    float bar_phasor() const noexcept { return bar_phasor_; }

   private:
    std::size_t seq_sample_div_;
    float       bpm_                   = 90.f;
    float       bar_phasor_            = 0.f;
    float       bar_phasor_inc_        = 0.f;
    float       midi_clock_phasor_     = 0.f;
    float       midi_clock_phasor_inc_ = 0.f;
    std::size_t sample_counter_        = 0u;
};

}  // namespace nisps
