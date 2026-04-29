// nisps/engines/elysiamorf.hpp — 8-track FM-pair sequencer emitting MIDI CC.
//
// `process()` returns silence; on each tick the engine evaluates 8 FM-pair
// generators and emits CC events scaled to MIDI 0..127. Voice 0 → CC1, voice
// 1 → CC2, etc. (firmware mapping: {1,2,3,4,5,9,11,12}).
//
// Per-track param layout (5 params each, 40 total): carrier_freq, mod_freq,
// mod_index, phasor_mul, phase_off. Firmware NPARAMS template defaults to 56
// but only consumes 40 — `param_notes.md` flags this and we follow consumption.

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
#include "../dsp/osc.hpp"

namespace nisps {

class ElysiamorfEngine {
   public:
    static constexpr std::size_t kNSequences    = 8u;
    static constexpr std::size_t kSeqParamsEach = 5u;
    static constexpr std::size_t kNParams       = kNSequences * kSeqParamsEach;  // = 40
    static constexpr std::size_t kEventBufferSize = 64u;

    static constexpr std::size_t param_count() noexcept { return kNParams; }
    static constexpr std::string_view engine_id() noexcept { return "elysiamorf"; }

    enum class VoiceSpace : std::size_t { None = 0, Count = 0 };
    static constexpr std::size_t kVoiceSpaceCount = 0u;
    static constexpr std::array<std::string_view, 0u> kVoiceSpaceNames = {};
    void set_voice_space(VoiceSpace) noexcept {}
    VoiceSpace voice_space() const noexcept { return VoiceSpace::None; }

    enum class EventKind : std::uint8_t { CC, Clock };
    struct Event {
        EventKind     kind;
        std::uint8_t  cc_number;
        std::uint8_t  cc_value;
        std::uint8_t  pad;
    };

    void setup(float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        bar_phasor_                = 0.f;
        midi_clock_phasor_         = 0.f;
        sequencing_sample_counter_ = 0u;
        update_bpm(90.f);
        for (auto& t : tracks_) {
            t.carrier_freq = 1.f;
            t.mod_freq     = 2.f;
            t.mod_index    = 0.f;
            t.phasor_mul   = 1.f;
            t.phase_off    = 0.f;
            t.carrier.reset();
            t.modulator.reset();
        }
    }

    void set_params(std::span<const float> params) noexcept {
        if (params.size() < kNParams) return;
        std::size_t i = 0u;
        for (auto& t : tracks_) {
            t.carrier_freq = (0.25f + params[i++] * 0.75f) * 0.125f;
            t.mod_freq     = (0.25f + params[i++] * 0.75f) * 0.25f;
            t.mod_index    = params[i++] * 4.f;
            static const float muls[4] = {1.f, 2.f, 3.f, 4.f};
            t.phasor_mul = muls[static_cast<int>(params[i++] * 3.999f) & 3];
            t.phase_off  = static_cast<float>(static_cast<int>(params[i++] * 4.f)) * 0.25f;
        }
    }

    NISPS_HOT NISPS_FORCE_INLINE stereosample_t process(stereosample_t /*x*/) noexcept {
        if (!playing_) return {0.f, 0.f};

        midi_clock_phasor_ += midi_clock_phasor_inc_;
        if (midi_clock_phasor_ >= 1.f) {
            midi_clock_phasor_ -= 1.f;
            push_event({EventKind::Clock, 0u, 0u, 0u});
        }

        if (sequencing_sample_counter_ == 0u) {
            bar_phasor_ += bar_phasor_inc_;
            if (bar_phasor_ >= 1.f) bar_phasor_ -= 1.f;
            for (std::size_t i = 0u; i < kNSequences; ++i) {
                auto& t = tracks_[i];
                float seq_phasor = bar_phasor_ * t.phasor_mul;
                seq_phasor = std::fmod(seq_phasor + t.phase_off, 1.f);
                const float mod_out = t.modulator.process(seq_phasor, 0.f, t.mod_freq, 0.f, 0.f);
                const float fm = t.carrier.process(seq_phasor, mod_out, t.carrier_freq, t.mod_index, 0.f);
                // Map [-1, 1] → [0, 127].
                float scaled = (fm + 1.f) * 0.5f * 127.f;
                if (scaled < 0.f) scaled = 0.f;
                if (scaled > 127.f) scaled = 127.f;
                push_event({EventKind::CC, kCCNumbers[i], static_cast<std::uint8_t>(scaled), 0u});
            }
        }
        ++sequencing_sample_counter_;
        if (sequencing_sample_counter_ >= kSequencingSampleDiv) sequencing_sample_counter_ = 0u;
        return {0.f, 0.f};
    }

    DriverConfig driver_config() const noexcept { return {}; }

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
        }
    }

   private:
    static constexpr std::size_t kSequencingSampleDiv = 500u;
    static constexpr std::uint8_t kCCNumbers[kNSequences] = {1u, 2u, 3u, 4u, 5u, 9u, 11u, 12u};

    struct Track {
        float carrier_freq = 1.f;
        float mod_freq     = 2.f;
        float mod_index    = 0.f;
        float phasor_mul   = 1.f;
        float phase_off    = 0.f;
        FMOp  carrier;
        FMOp  modulator;
    };

    NISPS_FORCE_INLINE void push_event(const Event& e) noexcept {
        if (event_count_ >= kEventBufferSize) return;
        events_[event_write_] = e;
        event_write_ = (event_write_ + 1u) % kEventBufferSize;
        ++event_count_;
    }

    float sample_rate_ = 48000.f;
    float bpm_         = 90.f;
    bool  playing_     = true;

    std::array<Track, kNSequences> tracks_{};
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

static_assert(AudioEngine<ElysiamorfEngine>, "ElysiamorfEngine must satisfy AudioEngine");

}  // namespace nisps
