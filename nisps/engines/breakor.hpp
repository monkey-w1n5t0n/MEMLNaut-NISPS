// nisps/engines/breakor.hpp — 8-track ratio-sequencer.
//
// `process()` returns silence directly; the engine's job is to emit
// NoteOn/NoteOff/Clock events on each tick via `pop_events()`. BreakOrMode
// (mode layer) drains these into its ControlEvent ring for platform glue
// (firmware MIDI/I2C, browser WebMIDI) to forward.
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
#include "../core/event_queue.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"
#include "../dsp/ratio_seq.hpp"
#include "../dsp/seq_clock.hpp"

namespace nisps {

class BreakOrEngine {
   public:
    static constexpr std::size_t kNSequences    = 8u;
    static constexpr std::size_t kSeqParamsEach = 7u;
    static constexpr std::size_t kNParams       = kNSequences * kSeqParamsEach;  // = 56
    static constexpr std::size_t kEventBufferSize = 64u;

    static constexpr std::size_t param_count() noexcept { return kNParams; }
    static constexpr std::string_view engine_id() noexcept { return "breakor"; }

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
        clock_.reset();
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
        if (clock_.tick_midi_clock()) {
            push_event({EventKind::Clock, 0u, 0u, 0u});
        }

        // Sequencer ticks at sample-rate / kSequencingSampleDiv.
        if (clock_.tick_bar()) {
            const float bar_phasor = clock_.bar_phasor();
            for (std::size_t i = 0u; i < kNSequences; ++i) {
                auto& t = tracks_[i];
                float seq_phasor = bar_phasor * t.phasor_mul;
                seq_phasor = std::fmod(seq_phasor + t.phase_off, 1.f);
                const bool trig     = ratio_seq<3u>(seq_phasor, t.ratio_sum, t.ratios, 0.5f);
                const bool high_amp = ratio_seq<2u>(seq_phasor, t.amp_ratio_sum, t.amp_ratios, 0.5f);
                if (trig && !t.last_trig) {
                    const std::uint8_t v = high_amp ? 127u : 64u;
                    push_event({EventKind::NoteOn, static_cast<std::uint8_t>(i), t.midi_note, v});
                } else if (!trig && t.last_trig) {
                    push_event({EventKind::NoteOff, static_cast<std::uint8_t>(i), t.midi_note, 0u});
                }
                t.last_trig = trig;
            }
        }
        return {0.f, 0.f};
    }

    DriverConfig driver_config() const noexcept { return {}; }

    // Event interface — drains `out` with up to `out.size()` queued events.
    // Returns how many were copied.
    std::size_t pop_events(std::span<Event> out) noexcept {
        return events_.pop(out);
    }

    void update_bpm(float bpm) noexcept {
        clock_.update_bpm(bpm, sample_rate_);
    }

    void set_playing(bool playing) noexcept {
        playing_ = playing;
        if (!playing) {
            clock_.reset();
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

    NISPS_FORCE_INLINE void push_event(const Event& e) noexcept {
        events_.push(e);
    }

    float sample_rate_ = 48000.f;
    bool  playing_     = true;

    std::array<Track, kNSequences> tracks_;
    SeqClock clock_{kSequencingSampleDiv};
    EventQueue<Event, kEventBufferSize> events_;
};

static_assert(AudioEngine<BreakOrEngine>, "BreakOrEngine must satisfy AudioEngine");

}  // namespace nisps
