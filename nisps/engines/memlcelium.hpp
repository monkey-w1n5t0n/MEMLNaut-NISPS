// nisps/engines/memlcelium.hpp — Dual-voice PAF synth driven by a 2-track
// ratio sequencer. Mirrors firmware MEMLCeliumAudioApp.
//
// Param layout (from `MEMLCeliumAudioApp::ProcessParams`):
//   [0..13]  — sequencer (2 sequences × 7 ratio-seq params)
//   [14..55] — synthesis (V0 + V1, 42 params total)
//
// Voice 0 (3 PAF operators): base freq, 3× cf, 3× bw, vib, vfr, 3× shift,
//   amp ADSR (attack/decay/sustain/release), pitch envelope, pitch emphasis,
//   shape gain/asym/mix, ring-mod gain. (~22 params)
//
// Voice 1 (3 PAF operators): base freq, detune1/2, 3× cf, 3× bw, 3× shift,
//   amp ADSR, pitch envelope, pitch emphasis. (~20 params)
//
// The sequencer fires note events internally to trigger V0/V1 envelopes.
// `pop_events()` exposes that same NoteOn/NoteOff/Clock stream (as BreakOr
// and Elysiamorf do), but no mode currently drains it — MEMLCeliumMode is a
// pure synth with no MIDI/I2C output wired for this engine.

#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"
#include "../dsp/env.hpp"
#include "../dsp/osc.hpp"
#include "../dsp/ratio_seq.hpp"

namespace nisps {

class MEMLCeliumEngine {
   public:
    static constexpr std::size_t kNParams       = 56u;
    static constexpr std::size_t kNSequences    = 2u;
    static constexpr std::size_t kSeqParamsEach = 7u;

    static constexpr std::size_t param_count() noexcept { return kNParams; }
    static constexpr std::string_view engine_id() noexcept { return "memlcelium"; }

    void setup(float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        for (auto* op : {&v0_paf0_, &v0_paf1_, &v0_paf2_,
                         &v1_paf0_, &v1_paf1_, &v1_paf2_}) {
            op->init();
            op->setsr(sample_rate);
        }
        v0_amp_env_.setup(500.f, 500.f, 0.8f, 1000.f, sample_rate);
        v0_pitch_env_.setup(10.f, 500.f, 0.f, 100.f, sample_rate);
        v1_amp_env_.setup(500.f, 500.f, 0.8f, 1000.f, sample_rate);
        v1_pitch_env_.setup(10.f, 500.f, 0.f, 100.f, sample_rate);
        bar_phasor_     = 0.f;
        bar_phasor_inc_ = 0.f;
        update_bpm(120.f);
        sequencing_sample_counter_ = 0u;
    }

    void set_params(std::span<const float> params) noexcept {
        if (params.size() < kNParams) return;
        // ---- sequencer (params 0..13) ----
        for (std::size_t s = 0u; s < kNSequences; ++s) {
            const std::size_t base = s * kSeqParamsEach;
            float sum = 0.f;
            for (std::size_t i = 0u; i < 3u; ++i) {
                seqs_[s].ratios[i] = static_cast<float>(static_cast<int>(params[base + i] * 3.f)) + 1.f;
                sum += seqs_[s].ratios[i];
            }
            seqs_[s].ratio_sum = sum;
            static const float muls[4] = {1.f, 2.f, 4.f, 8.f};
            seqs_[s].phasor_mul  = muls[static_cast<int>(params[base + 3] * 3.999999f) & 3];
            seqs_[s].phase_off   = static_cast<float>(static_cast<int>(params[base + 4] * 4.f)) * 0.25f;
            sum = 0.f;
            for (std::size_t i = 0u; i < 2u; ++i) {
                seqs_[s].amp_ratios[i] = static_cast<float>(static_cast<int>(params[base + 5 + i] * 3.f)) + 1.f;
                sum += seqs_[s].amp_ratios[i];
            }
            seqs_[s].amp_ratio_sum = sum;
        }
        // ---- synthesis (params 14..55) ----
        std::size_t i = 14u;
        auto sq = [&]() { const float p = params[i++]; return p * p; };

        base_freq_ = 60.f + (params[i++] * 10.f);
        v0_paf0_cf_ = params[i++] * 2.f;
        v0_paf1_cf_ = params[i++] * 2.f;
        v0_paf2_cf_ = params[i++] * 2.f;
        v0_paf0_bw_ = 10.f + (params[i++] * 100.f);
        v0_paf1_bw_ = 10.f + (params[i++] * 100.f);
        v0_paf2_bw_ = 10.f + (params[i++] * 100.f);
        v0_paf_vib_ = sq() * 0.01f;
        v0_paf_vfr_ = sq() * 15.f;
        v0_paf0_shift_ = -100.f + (params[i++] * 200.f);
        v0_paf1_shift_ = -100.f + (params[i++] * 200.f);
        v0_paf2_shift_ = -100.f + (params[i++] * 200.f);
        {
            const float a = 0.01f + (params[i++] * 1.f);
            const float d = 0.5f + sq() * 200.f;
            const float s = 0.01f + (params[i++] * 0.5f);
            const float r = 1.f + sq() * 800.f;
            v0_amp_env_.setup(a, d, s, r, sample_rate_);
        }
        {
            const float a = 0.01f + (params[i++] * 3.f);
            const float d = 0.5f + sq() * 100.f;
            v0_pitch_env_.setup(a, d, 0.f, 0.1f, sample_rate_);
        }
        v0_pitch_emph_ = params[i++] * 50.f;
        v0_shape_gain_ = params[i++];
        v0_shape_asym_ = params[i++] * 0.5f;
        v0_shape_mix_  = params[i++];
        rm_gain_       = params[i++];

        v1_base_freq_ = 300.f + (params[i++] * 10.f);
        v1_detune1_   = 1.f + (params[i++] * 1.f);
        v1_detune2_   = 1.f + (params[i++] * 1.f);
        v1_paf0_cf_   = params[i++] * 2.f;
        v1_paf1_cf_   = params[i++] * 2.f;
        v1_paf2_cf_   = params[i++] * 2.f;
        v1_paf0_bw_   = 10.f + (params[i++] * 400.f);
        v1_paf1_bw_   = 10.f + (params[i++] * 600.f);
        v1_paf2_bw_   = 10.f + (params[i++] * 500.f);
        v1_paf0_shift_ = -500.f + (params[i++] * 1000.f);
        v1_paf1_shift_ = -300.f + (params[i++] * 600.f);
        v1_paf2_shift_ = -100.f + (params[i++] * 200.f);
        {
            const float a = 0.01f + (params[i++] * 1.f);
            const float d = 0.5f + sq() * 100.f;
            const float s = 0.01f + (params[i++] * 0.3f);
            const float r = 1.f + sq() * 200.f;
            v1_amp_env_.setup(a, d, s, r, sample_rate_);
        }
        {
            const float a = 0.01f + (params[i++] * 3.f);
            const float d = 0.5f + sq() * 100.f;
            v1_pitch_env_.setup(a, d, 0.f, 0.1f, sample_rate_);
        }
        v1_pitch_emph_ = params[i++] * 10.f;
    }

    NISPS_HOT NISPS_FORCE_INLINE stereosample_t process(stereosample_t /*x*/) noexcept {
        // Sequencer tick — one decision per `kSequencingSampleDiv` audio
        // samples to keep CPU bounded; matches firmware's `sequencingSampleDiv = 400`.
        if (sequencing_sample_counter_ == 0u) {
            bar_phasor_ += bar_phasor_inc_;
            if (bar_phasor_ >= 1.f) bar_phasor_ -= 1.f;
            for (std::size_t i = 0u; i < kNSequences; ++i) {
                auto& s = seqs_[i];
                float seq_phasor = bar_phasor_ * s.phasor_mul;
                seq_phasor = std::fmod(seq_phasor + s.phase_off, 1.f);
                const bool trig     = ratio_seq_3(seq_phasor, s.ratio_sum, s.ratios, 0.5f);
                const bool high_amp = ratio_seq_2(seq_phasor, s.amp_ratio_sum, s.amp_ratios, 0.5f);
                if (trig && !s.last_trig) {
                    const std::uint8_t velocity = high_amp ? 127u : 64u;
                    const float v = static_cast<float>(velocity) / 127.f;
                    const float vsq = v * v;
                    if (i == 0u) { v0_amp_env_.trigger(vsq); v0_pitch_env_.trigger(1.f); }
                    else         { v1_amp_env_.trigger(vsq); v1_pitch_env_.trigger(1.f); }
                } else if (!trig && s.last_trig) {
                    if (i == 0u) { v0_amp_env_.release(); v0_pitch_env_.release(); }
                    else         { v1_amp_env_.release(); v1_pitch_env_.release(); }
                }
                s.last_trig = trig;
            }
        }
        ++sequencing_sample_counter_;
        if (sequencing_sample_counter_ >= kSequencingSampleDiv) sequencing_sample_counter_ = 0u;

        // ----- Voice 0 -----
        const float v0_env  = v0_amp_env_.play();
        const float v0_p    = v0_pitch_env_.play() * v0_pitch_emph_;
        const float fbsmooth = (fbzm1_ * fb_smooth_alpha_) + (feedback_ * (1.f - fb_smooth_alpha_));
        fbzm1_ = fbsmooth;
        const float freq0 = base_freq_ * (1.f + fbsmooth) + (v0_p * base_freq_);
        const float p0 = v0_paf0_.play(freq0, freq0 + (v0_paf0_cf_ * freq0),
                                       v0_paf0_bw_, v0_paf_vib_, v0_paf_vfr_, v0_paf0_shift_, false);
        const float freq1 = freq0 * 1.01f;
        const float p1 = v0_paf1_.play(freq1, freq1 + (v0_paf1_cf_ * freq1),
                                       v0_paf1_bw_, v0_paf_vib_, v0_paf_vfr_, v0_paf1_shift_, true);
        const float freq2 = freq1 * 1.02f;
        const float p2 = v0_paf2_.play(freq2, freq2 + (v0_paf2_cf_ * freq2),
                                       v0_paf2_bw_, v0_paf_vib_, v0_paf_vfr_, v0_paf2_shift_, true);
        float v0 = (p0 + p1 + p2) * v0_env;

        // ----- Voice 1 -----
        const float v1_env = v1_amp_env_.play();
        const float v1_p   = v1_pitch_env_.play() * v1_pitch_emph_;
        const float v1f0   = v1_base_freq_ + (v1_p * v1_base_freq_);
        const float v1p0   = v1_paf0_.play(v1f0, v1f0 + (v1_paf0_cf_ * v1f0),
                                           v1_paf0_bw_, 0.f, 0.f, v1_paf0_shift_, false);
        const float v1f1   = v1f0 * v1_detune1_;
        const float v1p1   = v1_paf1_.play(v1f1, v1f1 + (v1_paf1_cf_ * v1f1),
                                           v1_paf1_bw_, 0.f, 0.f, v1_paf1_shift_, true);
        const float v1f2   = v1f1 * v1_detune2_;
        // Note: firmware has a bug where this line uses `freq2` (V0's freq),
        // but we faithfully port it for sonic parity.
        const float v1p2   = v1_paf2_.play(v1f2, v1f2 + (v1_paf2_cf_ * freq2),
                                           v1_paf2_bw_, 0.f, 0.f, v1_paf2_shift_, true);
        float v1 = v1p0 + v1p1 + v1p2;
        const float rm = v1p0 * v1p1 * v1p2;
        v1 = ((1.f - rm_gain_) * v1) + (rm * rm_gain_);
        v1 = v1 * v1_env;

        // ----- Mix + sine shaper -----
        float mix = v0 + v1;
        static const float kTwoPi = 6.28318530717958647692f;
        float shape = std::sin(mix * kTwoPi);
        shape = std::sin((shape * kTwoPi * v0_shape_gain_) + v0_shape_asym_);
        mix = mix + (shape * v0_shape_mix_);
        mix = std::tanh(mix);
        return {mix, mix};
    }

    DriverConfig driver_config() const noexcept {
        DriverConfig c;
        c.output_volume = 0.9f;
        return c;
    }

    void update_bpm(float bpm) noexcept {
        bpm_ = bpm;
        const float beat_seconds = 60.f / bpm;
        const float bar_seconds  = beat_seconds * 4.f;  // assume 4/4
        const float bar_samples  = bar_seconds * (sample_rate_ / static_cast<float>(kSequencingSampleDiv));
        bar_phasor_inc_ = 1.f / bar_samples;
    }

    void set_playing(bool playing) noexcept {
        if (!playing) {
            bar_phasor_                = 0.f;
            sequencing_sample_counter_ = 0u;
            for (auto& s : seqs_) { s.last_trig = false; }
            v0_amp_env_.release(); v0_pitch_env_.release();
            v1_amp_env_.release(); v1_pitch_env_.release();
        }
    }

   private:
    static constexpr std::size_t kSequencingSampleDiv = 400u;

    struct SeqState {
        std::array<float, 3> ratios{1.f, 1.f, 1.f};
        std::array<float, 2> amp_ratios{1.f, 1.f};
        float ratio_sum     = 3.f;
        float amp_ratio_sum = 2.f;
        float phasor_mul    = 1.f;
        float phase_off     = 0.f;
        bool  last_trig     = false;
    };

    // ratio_seq lives once in dsp/ratio_seq.hpp (shared with BreakOrEngine).
    static bool ratio_seq_3(float p, float s, const std::array<float, 3>& r, float pw) noexcept {
        return ::nisps::ratio_seq<3>(p, s, r, pw);
    }
    static bool ratio_seq_2(float p, float s, const std::array<float, 2>& r, float pw) noexcept {
        return ::nisps::ratio_seq<2>(p, s, r, pw);
    }

    float sample_rate_ = 48000.f;
    float bpm_         = 120.f;

    PAFOperator v0_paf0_, v0_paf1_, v0_paf2_;
    PAFOperator v1_paf0_, v1_paf1_, v1_paf2_;
    ADSR        v0_amp_env_, v0_pitch_env_;
    ADSR        v1_amp_env_, v1_pitch_env_;

    std::array<SeqState, kNSequences> seqs_;
    float       bar_phasor_     = 0.f;
    float       bar_phasor_inc_ = 0.f;
    std::size_t sequencing_sample_counter_ = 0u;

    // Synth state.
    float base_freq_     = 60.f;
    float v0_paf0_cf_    = 0.f, v0_paf1_cf_ = 0.f, v0_paf2_cf_ = 0.f;
    float v0_paf0_bw_    = 50.f, v0_paf1_bw_ = 50.f, v0_paf2_bw_ = 50.f;
    float v0_paf_vib_    = 0.f, v0_paf_vfr_ = 0.f;
    float v0_paf0_shift_ = 0.f, v0_paf1_shift_ = 0.f, v0_paf2_shift_ = 0.f;
    float v0_pitch_emph_ = 0.f;
    float v0_shape_gain_ = 0.f, v0_shape_asym_ = 0.f, v0_shape_mix_ = 0.f;
    float rm_gain_       = 0.f;

    float v1_base_freq_ = 300.f;
    float v1_detune1_   = 1.f, v1_detune2_   = 1.f;
    float v1_paf0_cf_   = 0.f, v1_paf1_cf_   = 0.f, v1_paf2_cf_   = 0.f;
    float v1_paf0_bw_   = 50.f, v1_paf1_bw_  = 50.f, v1_paf2_bw_  = 50.f;
    float v1_paf0_shift_ = 0.f, v1_paf1_shift_ = 0.f, v1_paf2_shift_ = 0.f;
    float v1_pitch_emph_ = 0.f;

    float feedback_       = 0.f;
    float fbzm1_          = 0.f;
    float fb_smooth_alpha_ = 0.5f;
};

static_assert(AudioEngine<MEMLCeliumEngine>, "MEMLCeliumEngine must satisfy AudioEngine");

}  // namespace nisps
