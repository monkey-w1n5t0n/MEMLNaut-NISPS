// nisps/engines/breakor.hpp — 8-track ratio-sequencer.
//
// `process()` returns silence; the engine's job is to emit MIDI/I2C events on
// each tick. Wraps a NoOpEngine for the audio path. Stream 4/6 will hook
// `pop_events()` into the firmware's MIDI/I2C output.
//
// Param layout: 8 tracks × 7 ratio-seq params each = 56 params.
//   per track: [ratio0, ratio1, ratio2, phasorMul, phaseOff, ampRatio0, ampRatio1]
//
// Default MIDI notes: {36,37,38,39,40,42,43,45} (kick/snare/toms/hats etc.).

#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"

namespace nisps {

class BreakOrEngine {
   public:
    static constexpr std::size_t kNSequences    = 8u;
    static constexpr std::size_t kSeqParamsEach = 7u;
    static constexpr std::size_t kNParams       = kNSequences * kSeqParamsEach;  // = 56
    static constexpr std::size_t kEventBufferSize = 64u;

    static constexpr std::size_t param_count() noexcept { return kNParams; }
    static constexpr std::string_view engine_id() noexcept { return "breakor"; }

    enum class VoiceSpace : std::size_t { None = 0, Count = 0 };
    static constexpr std::size_t kVoiceSpaceCount = 0u;
    static constexpr std::array<std::string_view, 0u> kVoiceSpaceNames = {};
    void set_voice_space(VoiceSpace) noexcept {}
    VoiceSpace voice_space() const noexcept { return VoiceSpace::None; }

    enum class EventKind : std::uint8_t { NoteOn, NoteOff, Clock };
    struct Event {
        EventKind     kind;
        std::uint8_t  track;
        std::uint8_t  midi_note;
        std::uint8_t  velocity;
    };

    void setup(float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        static const std::uint8_t default_notes[kNSequences] = {36u,37u,38u,39u,40u,42u,43u,45u};
        for (std::size_t i = 0u; i < kNSequences; ++i) {
            tracks_[i].midi_note = default_notes[i];
            tracks_[i].last_trig = false;
        }
        bar_phasor_     = 0.f;
        midi_clock_phasor_ = 0.f;
        sequencing_sample_counter_ = 0u;
        update_bpm(90.f);
    }

    void set_params(std::span<const float> params) noexcept {
        if (params.size() < kNParams) return;
        std::size_t i = 0u;
        for (auto& t : tracks_) {
            float sum = 0.f;
            for (std::size_t r = 0u; r < 3u; ++r) {
                t.ratios[r] = static_cast<float>(static_cast<int>(params[i++] * 3.f)) + 1.f;
                sum += t.ratios[r];
            }
            t.ratio_sum = sum;
            static const float muls[4] = {1.f, 2.f, 4.f, 8.f};
            t.phasor_mul  = muls[static_cast<int>(params[i++] * 3.999999f) & 3];
            t.phase_off   = static_cast<float>(static_cast<int>(params[i++] * 4.f)) * 0.25f;
            sum = 0.f;
            for (std::size_t r = 0u; r < 2u; ++r) {
                t.amp_ratios[r] = static_cast<float>(static_cast<int>(params[i++] * 3.f)) + 1.f;
                sum += t.amp_ratios[r];
            }
            t.amp_ratio_sum = sum;
        }
    }

    NISPS_HOT NISPS_FORCE_INLINE stereosample_t process(stereosample_t /*x*/) noexcept {
        if (!playing_) return {0.f, 0.f};

        // MIDI clock: 24 PPQN — emit on clock-phasor wrap.
        midi_clock_phasor_ += midi_clock_phasor_inc_;
        if (midi_clock_phasor_ >= 1.f) {
            midi_clock_phasor_ -= 1.f;
            push_event({EventKind::Clock, 0u, 0u, 0u});
        }

        // Sequencer ticks at sample-rate / kSequencingSampleDiv.
        if (sequencing_sample_counter_ == 0u) {
            bar_phasor_ += bar_phasor_inc_;
            if (bar_phasor_ >= 1.f) bar_phasor_ -= 1.f;

            for (std::size_t i = 0u; i < kNSequences; ++i) {
                auto& t = tracks_[i];
                float seq_phasor = bar_phasor_ * t.phasor_mul;
                seq_phasor = std::fmod(seq_phasor + t.phase_off, 1.f);
                const bool trig     = ratio_seq_3(seq_phasor, t.ratio_sum, t.ratios, 0.5f);
                const bool high_amp = ratio_seq_2(seq_phasor, t.amp_ratio_sum, t.amp_ratios, 0.5f);
                if (trig && !t.last_trig) {
                    const std::uint8_t v = high_amp ? 127u : 64u;
                    push_event({EventKind::NoteOn, static_cast<std::uint8_t>(i), t.midi_note, v});
                } else if (!trig && t.last_trig) {
                    push_event({EventKind::NoteOff, static_cast<std::uint8_t>(i), t.midi_note, 0u});
                }
                t.last_trig = trig;
            }
        }
        ++sequencing_sample_counter_;
        if (sequencing_sample_counter_ >= kSequencingSampleDiv) sequencing_sample_counter_ = 0u;
        return {0.f, 0.f};
    }

    DriverConfig driver_config() const noexcept { return {}; }

    // Event interface — drains `out` with up to `out.size()` queued events.
    // Returns how many were copied.
    std::size_t pop_events(std::span<Event> out) noexcept {
        std::size_t n = 0u;
        while (n < out.size() && event_count_ > 0u) {
            out[n++] = events_[event_read_];
            event_read_ = (event_read_ + 1u) % kEventBufferSize;
            --event_count_;
        }
        return n;
    }

    void update_bpm(float bpm) noexcept {
        bpm_ = bpm;
        const float beat_seconds = 60.f / bpm;
        const float bar_seconds  = beat_seconds * 4.f;
        const float bar_samples  = bar_seconds * (sample_rate_ / static_cast<float>(kSequencingSampleDiv));
        bar_phasor_inc_ = 1.f / bar_samples;
        const float clock_seconds = beat_seconds / 24.f;
        midi_clock_phasor_inc_ = 1.f / (clock_seconds * sample_rate_);
    }

    void set_playing(bool playing) noexcept {
        playing_ = playing;
        if (!playing) {
            bar_phasor_                = 0.f;
            midi_clock_phasor_         = 0.f;
            sequencing_sample_counter_ = 0u;
            for (auto& t : tracks_) {
                if (t.last_trig) {
                    push_event({EventKind::NoteOff, 0u, t.midi_note, 0u});
                }
                t.last_trig = false;
            }
        }
    }

    void set_track_note(std::size_t track, std::uint8_t note) noexcept {
        if (track < kNSequences) tracks_[track].midi_note = note;
    }

   private:
    static constexpr std::size_t kSequencingSampleDiv = 400u;

    struct Track {
        std::array<float, 3> ratios{1.f, 1.f, 1.f};
        std::array<float, 2> amp_ratios{1.f, 1.f};
        float        ratio_sum     = 3.f;
        float        amp_ratio_sum = 2.f;
        float        phasor_mul    = 1.f;
        float        phase_off     = 0.f;
        std::uint8_t midi_note     = 36u;
        bool         last_trig     = false;
    };

    template <std::size_t N>
    static bool ratio_seq(float phasor, float ratio_sum,
                          const std::array<float, N>& ratios,
                          float pulse_width) noexcept {
        float offset_phase = phasor;
        if (offset_phase >= 1.f) offset_phase -= 1.f;
        const float phase_adj = ratio_sum * offset_phase;
        float accum = 0.f, last = 0.f;
        for (std::size_t i = 0u; i < N; ++i) {
            accum += ratios[i];
            if (phase_adj <= accum) {
                const float beat_phase = (phase_adj - last) / (accum - last);
                return beat_phase <= pulse_width;
            }
            last = accum;
        }
        return false;
    }
    static bool ratio_seq_3(float p, float s, const std::array<float, 3>& r, float pw) noexcept {
        return ratio_seq<3>(p, s, r, pw);
    }
    static bool ratio_seq_2(float p, float s, const std::array<float, 2>& r, float pw) noexcept {
        return ratio_seq<2>(p, s, r, pw);
    }

    NISPS_FORCE_INLINE void push_event(const Event& e) noexcept {
        if (event_count_ >= kEventBufferSize) return;  // drop on overflow
        events_[event_write_] = e;
        event_write_ = (event_write_ + 1u) % kEventBufferSize;
        ++event_count_;
    }

    float sample_rate_ = 48000.f;
    float bpm_         = 90.f;
    bool  playing_     = true;

    std::array<Track, kNSequences> tracks_;
    float       bar_phasor_     = 0.f;
    float       bar_phasor_inc_ = 0.f;
    float       midi_clock_phasor_     = 0.f;
    float       midi_clock_phasor_inc_ = 0.f;
    std::size_t sequencing_sample_counter_ = 0u;

    std::array<Event, kEventBufferSize> events_{};
    std::size_t event_read_  = 0u;
    std::size_t event_write_ = 0u;
    std::size_t event_count_ = 0u;
};

static_assert(AudioEngine<BreakOrEngine>, "BreakOrEngine must satisfy AudioEngine");

}  // namespace nisps
