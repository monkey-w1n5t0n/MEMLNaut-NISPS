// nisps/engines/paf_synth.hpp — 4-voice PAF (Phase-Aligned Formant) synth.
//
// Mirrors firmware PAFSynthAudioApp. Process pipeline:
//   - 4 PAF operators with independent freq/cf/bw/vib/vfr/shift settings
//   - cross-operator detune cascade
//   - sum + ring-mod + sine-shaper
//   - ADSR envelope on the carrier
//   - tanh saturation
//   - feedback delay line
//
// Note triggering is NOT done via set_params (firmware uses a separate MIDI
// queue). We expose `note_on(note, velocity)` / `note_off(note)` directly;
// modes call them from a non-RT context.
//
// 7 voice spaces (Ellipticacacia, Rowantares, Neemeda, Aquillow, Magnetarch,
// Elderstar, Ipeleiades) re-map the 33 NN outputs to engine state.

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
#include "../dsp/delay.hpp"
#include "../dsp/env.hpp"
#include "../dsp/osc.hpp"

namespace nisps {

class PAFSynthEngine {
   public:
    static constexpr std::size_t kNParams = 33u;
    static constexpr std::size_t param_count() noexcept { return kNParams; }
    static constexpr std::string_view engine_id() noexcept { return "paf_synth"; }

    enum class VoiceSpace : std::size_t {
        Ellipticacacia = 0,  // QuadDetune
        Rowantares     = 1,  // VS1
        Neemeda        = 2,  // VS2
        Aquillow       = 3,  // Perc
        Magnetarch     = 4,  // Single1
        Elderstar      = 5,  // QuadOct
        Ipeleiades     = 6,  // QuadDist
        Count          = 7,
    };

    static constexpr std::size_t kVoiceSpaceCount = static_cast<std::size_t>(VoiceSpace::Count);
    static constexpr std::array<std::string_view, kVoiceSpaceCount> kVoiceSpaceNames = {
        "Ellipticacacia", "Rowantares", "Neemeda", "Aquillow",
        "Magnetarch", "Elderstar", "Ipeleiades"};

    void set_voice_space(VoiceSpace vs) noexcept { voice_space_ = vs; }
    VoiceSpace voice_space() const noexcept { return voice_space_; }

    void setup(float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        for (auto* op : {&paf0_, &paf1_, &paf2_, &paf3_}) {
            op->init();
            op->setsr(sample_rate);
        }
        env_.setup(500.f, 500.f, 0.8f, 1000.f, sample_rate);
        delay_.clear();
    }

    void set_params(std::span<const float> params) noexcept {
        if (params.size() < kNParams) return;
        std::array<float, kNParams> p;
        for (std::size_t i = 0u; i < kNParams; ++i) p[i] = params[i];
        switch (voice_space_) {
            case VoiceSpace::Ellipticacacia: apply_quad_detune(p); break;
            case VoiceSpace::Rowantares:     apply_vs1(p); break;
            case VoiceSpace::Neemeda:        apply_vs2(p); break;
            case VoiceSpace::Aquillow:       apply_perc(p); break;
            case VoiceSpace::Magnetarch:     apply_single1(p); break;
            case VoiceSpace::Elderstar:      apply_quad_oct(p); break;
            case VoiceSpace::Ipeleiades:     apply_quad_dist(p); break;
            case VoiceSpace::Count: break;
        }
    }

    NISPS_HOT NISPS_FORCE_INLINE stereosample_t process(stereosample_t /*x*/) noexcept {
        // Smooth feedback amount.
        const float fbsmooth = (fbzm1_ * fb_smooth_alpha_) + (feedback_ * (1.f - fb_smooth_alpha_));
        fbzm1_ = fbsmooth;

        const float freq0 = base_freq_ * (1.f + fbsmooth);
        const float p0 = paf0_.play(freq0, freq0 + (paf0_cf_ * freq0),
                                    paf0_bw_, paf0_vib_, paf0_vfr_, paf0_shift_, false) * p0_gain_;
        const float freq1 = freq0 * detune1_;
        const float p1 = paf1_.play(freq1, freq1 + (paf1_cf_ * freq1),
                                    paf1_bw_, paf1_vib_, paf1_vfr_, paf1_shift_, true) * p1_gain_;
        const float freq2 = freq1 * detune2_;
        const float p2 = paf2_.play(freq2, freq2 + (paf2_cf_ * freq2),
                                    paf2_bw_, paf2_vib_, paf2_vfr_, paf2_shift_, true) * p2_gain_;
        const float freq3 = freq2 * detune3_;
        const float p3 = paf3_.play(freq3, freq3 + (paf3_cf_ * freq3),
                                    paf3_bw_ * freq3, paf3_vib_, paf3_vfr_, paf3_shift_, true) * p3_gain_;

        float y = p0 + p1 + p2 + p3;
        const float rm = p0 * p1 * p2 * p3;
        y = y + (rm * rm_gain_);

        static const float kTwoPi = 6.28318530717958647692f;
        float shape = std::sin(y * kTwoPi);
        shape = std::sin(((shape * kTwoPi) * sine_shape_gain_) + sine_shape_asym_);
        y = y + (shape * sine_shape_mix_);

        const float envval = env_.play();
        y = y * envval;
        y = std::tanh(y);

        const float d1 = delay_.play(y, delay_max_, dl_fb_) * dl1_mix_;
        y = y + d1;
        feedback_ = y * feedback_gain_;

        return {y, y};
    }

    DriverConfig driver_config() const noexcept {
        DriverConfig c;
        c.output_volume = 0.9f;
        return c;
    }

    // Note interface — called from non-RT mode glue (MIDI keyboard / sequencer).
    void note_on(std::uint8_t midi_note, std::uint8_t velocity) noexcept {
        base_freq_ = mtof(midi_note);
        const float v = static_cast<float>(velocity) / 127.f;
        const float vsq = v * v;
        env_.trigger(vsq);
        current_note_ = midi_note;
    }
    void note_off(std::uint8_t midi_note) noexcept {
        if (midi_note == current_note_) env_.release();
    }

    static constexpr float mtof(std::uint8_t note) noexcept {
        return 440.f * std::exp2((static_cast<float>(note) - 69.f) / 12.f);
    }

   private:
    // -------- voice space implementations --------
    // VS1 — Rowantares
    void apply_vs1(const std::array<float, kNParams>& p) noexcept {
        p0_gain_ = 1.f; p1_gain_ = 1.f; p2_gain_ = 0.f; p3_gain_ = 0.f;
        detune1_ = 2.f; detune2_ = 1.f; detune3_ = 1.f;
        paf0_cf_ = p[2]; paf1_cf_ = p[3];
        paf0_bw_ = 10.f + (p[5] * 200.f);
        paf1_bw_ = 10.f + (p[6] * 200.f);
        paf0_vib_ = p[8] * p[8] * 0.05f;
        paf1_vib_ = p[9] * p[9] * 0.05f;
        paf0_vfr_ = p[11] * p[11] * 5.f;
        paf1_vfr_ = p[12] * p[12] * 5.f;
        paf0_shift_ = -50.f + (p[14] * 100.f);
        paf1_shift_ = -50.f + (p[15] * 100.f);
        dl1_mix_   = p[17] * p[17] * 0.8f;
        dl_fb_     = p[19] * 0.9f;
        env_.setup(1.f + p[30] * 200.f,
                   1.f + p[20] * p[20] * 500.f,
                   0.01f + (p[31] * 0.5f),
                   1.f + p[32] * 500.f,
                   sample_rate_);
        sine_shape_gain_ = p[26] * p[26];
        sine_shape_asym_ = p[27] * p[27] * 0.1f;
        sine_shape_mix_  = p[28];
        rm_gain_         = p[29] * p[29];
        feedback_gain_   = 0.f;
        delay_max_       = 1000u;
        fb_smooth_alpha_ = 0.f;
    }
    // VS2 — Neemeda
    void apply_vs2(const std::array<float, kNParams>& p) noexcept {
        p0_gain_ = 1.f; p1_gain_ = 1.f; p2_gain_ = 1.f; p3_gain_ = 1.f;
        detune1_ = 2.f; detune2_ = 0.5f; detune3_ = 1.f;
        paf0_cf_ = p[2]; paf1_cf_ = p[3]; paf2_cf_ = p[4]; paf3_cf_ = p[21];
        paf0_bw_ = 10.f + p[5]  * 400.f;
        paf1_bw_ = 10.f + p[6]  * 300.f;
        paf2_bw_ = 10.f + p[7]  * 200.f;
        paf3_bw_ = 10.f + p[22] * 100.f;
        paf0_vib_ = p[8]  * p[8]  * 0.1f;
        paf1_vib_ = p[9]  * p[9]  * 0.05f;
        paf2_vib_ = p[10] * p[10] * 0.05f;
        paf3_vib_ = p[23] * p[23] * 0.05f;
        paf0_vfr_ = p[11] * p[11] * 5.f;
        paf1_vfr_ = p[12] * p[12] * 5.f;
        paf2_vfr_ = p[13] * p[13] * 10.f;
        paf3_vfr_ = p[24] * p[24] * 10.f;
        paf0_shift_ = -50.f + p[14] * 200.f;
        paf1_shift_ = -50.f + p[15] * 200.f;
        paf2_shift_ = -50.f + p[16] * 300.f;
        paf3_shift_ = -50.f + p[25] * 400.f;
        dl1_mix_ = p[17] * p[17] * 0.3f;
        dl_fb_   = p[19] * 0.95f;
        env_.setup(1.f + p[30] * 200.f, 1.f + p[20] * p[20] * 500.f,
                   0.01f + p[31] * 0.5f, 1.f + p[32] * 500.f, sample_rate_);
        sine_shape_gain_ = p[26] * p[26];
        sine_shape_asym_ = p[27] * p[27] * 0.2f;
        sine_shape_mix_  = p[28];
        rm_gain_         = p[29] * p[29];
        feedback_gain_   = 0.01f;
        delay_max_       = 3000u;
        fb_smooth_alpha_ = 0.94f;
    }
    // Perc — Aquillow
    void apply_perc(const std::array<float, kNParams>& p) noexcept {
        p0_gain_ = 1.f; p1_gain_ = 1.f; p2_gain_ = 1.f; p3_gain_ = 1.f;
        detune1_ = 1.f; detune2_ = 1.1f; detune3_ = 1.2f;
        paf0_cf_ = p[2]  * 2.f; paf1_cf_ = p[3]  * 2.f;
        paf2_cf_ = p[4]  * 2.f; paf3_cf_ = p[21] * 2.f;
        paf0_bw_ = 10.f + p[5]  * 400.f;
        paf1_bw_ = 10.f + p[6]  * 50.f;
        paf2_bw_ = 10.f + p[7]  * 50.f;
        paf3_bw_ = 10.f + p[22] * 100.f;
        paf0_vib_ = p[8]  * p[8]  * 0.01f;
        paf1_vib_ = p[9]  * p[9]  * 0.01f;
        paf2_vib_ = p[10] * p[10] * 0.01f;
        paf3_vib_ = p[23] * p[23] * 0.01f;
        paf0_vfr_ = p[11] * p[11] * 15.f;
        paf1_vfr_ = p[12] * p[12] * 15.f;
        paf2_vfr_ = p[13] * p[13] * 15.f;
        paf3_vfr_ = p[24] * p[24] * 15.f;
        paf0_shift_ = -500.f + p[14] * 500.f;
        paf1_shift_ = -300.f + p[15] * 300.f;
        paf2_shift_ = -300.f + p[16] * 300.f;
        paf3_shift_ = -300.f + p[25] * 300.f;
        dl1_mix_ = p[17] * p[17] * 0.5f;
        dl_fb_   = p[19] * 0.95f;
        env_.setup(0.2f + p[30] * 1.f,
                   0.5f + p[20] * p[20] * 100.f,
                   0.01f + p[31] * 0.1f,
                   1.f + p[32] * p[32] * 300.f,
                   sample_rate_);
        sine_shape_gain_ = p[26];
        sine_shape_asym_ = p[27] * 0.5f;
        sine_shape_mix_  = p[28];
        rm_gain_         = p[29];
        feedback_gain_   = 0.1f;
        delay_max_       = 178u;
        fb_smooth_alpha_ = 0.5f;
    }
    // Single1 — Magnetarch
    void apply_single1(const std::array<float, kNParams>& p) noexcept {
        p0_gain_ = 1.f; p1_gain_ = 0.f; p2_gain_ = 0.f; p3_gain_ = 0.f;
        static const float kTwoPi = 6.28318530717958647692f;
        float p1v = p[0] + p[7] + p[8];
        p1v = ((std::sin(p1v * kTwoPi)) + 1.f) * 0.5f;
        float p2v = p[9] + p[10] + p[11];
        p2v = ((std::sin(p2v * kTwoPi)) + 1.f) * 0.5f;
        float p3v = p[12] + p[13] + p[14] + p[15];
        p3v = ((std::sin(p3v * kTwoPi)) + 1.f) * 0.5f;
        paf0_cf_   = p1v * 2.f;
        paf0_bw_   = 10.f + p2v * 700.f;
        paf0_vib_  = 0.f; paf0_vfr_ = 0.f;
        paf0_shift_ = -20.f + p3v * 40.f;
        dl1_mix_ = 0.f; dl_fb_ = 0.f;
        env_.setup(1.f + p[1] * 50.f,
                   1.f + p[2] * 300.f,
                   p[3] * 0.7f,
                   10.f + p[4] * 500.f,
                   sample_rate_);
        sine_shape_gain_ = p[5] * p[5] * 0.2f;
        sine_shape_asym_ = 0.f;
        sine_shape_mix_  = p[6] * 0.3f;
        rm_gain_         = 0.f;
        feedback_gain_   = 0.f;
        delay_max_       = 1000u;
        fb_smooth_alpha_ = 0.f;
    }
    // QuadDetune — Ellipticacacia
    void apply_quad_detune(const std::array<float, kNParams>& p) noexcept {
        p0_gain_ = 1.f; p1_gain_ = 1.f; p2_gain_ = 1.f; p3_gain_ = 0.8f;
        const float factor = 1.f + (p[17] * 0.2f);
        detune1_ = 1.f * factor;
        detune2_ = detune1_ * factor;
        detune3_ = detune2_ * factor;
        paf0_cf_ = p[0] * 1.f; paf1_cf_ = p[0] * 2.f;
        paf2_cf_ = p[1] * 3.f; paf3_cf_ = p[1] * 5.f;
        paf0_bw_ = 10.f + p[2] * 500.f;
        paf1_bw_ = 10.f + p[3] * 500.f;
        paf2_bw_ = 10.f + p[4] * 500.f;
        paf3_bw_ = 10.f + p[5] * 2000.f;
        paf0_vib_ = p[18] * p[18] * 0.05f; paf1_vib_ = paf0_vib_;
        paf2_vib_ = 0.f; paf3_vib_ = 0.f;
        paf0_vfr_ = p[19] * p[19] * 15.f; paf1_vfr_ = paf0_vfr_;
        paf2_vfr_ = 0.f; paf3_vfr_ = 0.f;
        paf0_shift_ = 0.f; paf1_shift_ = 0.f; paf2_shift_ = 0.f;
        paf3_shift_ = -40.f + p[9] * 80.f;
        dl1_mix_ = 0.f; dl_fb_ = 0.f;
        env_.setup(1.f + p[10] * 20.f, 1.f + p[11] * 200.f,
                   p[12] * 0.4f, 10.f + p[13] * 300.f, sample_rate_);
        sine_shape_gain_ = p[14] * p[14] * 0.2f;
        sine_shape_asym_ = p[15] * 0.05f;
        sine_shape_mix_  = p[16] * 0.3f;
        rm_gain_ = 0.f; feedback_gain_ = 0.f;
        delay_max_ = 1000u; fb_smooth_alpha_ = 0.f;
    }
    // QuadOct — Elderstar
    void apply_quad_oct(const std::array<float, kNParams>& p) noexcept {
        p0_gain_ = 1.f; p1_gain_ = p[24]; p2_gain_ = p[25]; p3_gain_ = p[26];
        const float factor = 1.f + (p[17] + p[27] * 0.2f);
        detune1_ = (1.f * factor) * 0.5f;
        detune2_ = (1.f * factor * factor) * 2.f;
        detune3_ = (detune2_ * factor) * 2.f;
        paf0_cf_ = p[0] * 1.f; paf1_cf_ = p[0] * 2.f;
        paf2_cf_ = p[1] * 3.f; paf3_cf_ = p[1] * 5.f;
        paf0_bw_ = 10.f + p[2] * 500.f;
        paf1_bw_ = 10.f + p[3] * 500.f;
        paf2_bw_ = 10.f + p[4] * 500.f;
        paf3_bw_ = 10.f + p[5] * 2000.f;
        paf0_vib_ = p[18] * p[18] * 0.05f;
        paf1_vib_ = paf0_vib_ * 2.f;
        paf2_vib_ = p[28] * 0.1f;
        paf3_vib_ = p[29] * 0.1f;
        paf0_vfr_ = p[19] * p[19] * 15.f; paf1_vfr_ = paf0_vfr_;
        paf2_vfr_ = 0.f; paf3_vfr_ = 0.f;
        paf0_shift_ = 0.f; paf1_shift_ = 0.f;
        paf2_shift_ = -100.f + p[8] * 200.f;
        paf3_shift_ = -150.f + p[9] * 300.f;
        dl1_mix_ = p[20] * p[20] * 0.1f;
        dl_fb_   = p[21] * p[21] * 0.7f;
        env_.setup(1.f + p[10] * 20.f, 1.f + p[11] * 200.f,
                   p[12] * 0.4f, 10.f + p[13] * 300.f, sample_rate_);
        sine_shape_gain_ = p[14] * p[14] * 0.9f;
        sine_shape_asym_ = p[15] * 0.5f;
        sine_shape_mix_  = p[16] * 0.8f;
        rm_gain_       = p[22] * p[22] * 0.7f;
        feedback_gain_ = p[23] * p[23] * 0.4f;
        delay_max_     = 4000u;
        fb_smooth_alpha_ = 0.9f;
    }
    // QuadDist — Ipeleiades
    void apply_quad_dist(const std::array<float, kNParams>& p) noexcept {
        p0_gain_ = 1.f; p1_gain_ = p[24]; p2_gain_ = p[25]; p3_gain_ = p[26];
        const float factor = 1.f + (p[17] + p[27] * 0.6f);
        detune1_ = (1.f * factor) * 0.5f;
        detune2_ = (1.f * factor * factor) * 2.f;
        detune3_ = (detune2_ * factor) * 2.f;
        paf0_cf_ = p[0] * 4.f; paf1_cf_ = p[0] * 4.f;
        paf2_cf_ = p[1] * 8.f; paf3_cf_ = p[1] * 8.f;
        paf0_bw_ = 10.f + p[2] * 5000.f;
        paf1_bw_ = 10.f + p[3] * 5000.f;
        paf2_bw_ = 10.f + p[4] * 5000.f;
        paf3_bw_ = 10.f + p[5] * 2000.f;
        paf0_vib_ = p[18] * p[18] * 0.05f;
        paf1_vib_ = paf0_vib_ * 2.f;
        paf2_vib_ = p[28] * 0.1f;
        paf3_vib_ = p[29] * 0.1f;
        paf0_vfr_ = p[19] * 15.f;
        paf1_vfr_ = p[28] * 15.f;
        paf2_vfr_ = p[29] * 15.f;
        paf3_vfr_ = p[30] * 15.f;
        paf0_shift_ = 0.f;
        paf1_shift_ = -800.f + p[27] * 600.f;
        paf2_shift_ = -300.f + p[8]  * 600.f;
        paf3_shift_ = -350.f + p[9]  * 100.f;
        dl1_mix_ = p[20] * p[20] * 0.1f;
        dl_fb_   = p[21] * p[21] * 0.7f;
        env_.setup(1.f + p[10] * 20.f, 1.f + p[11] * 200.f,
                   p[12] * 0.4f, 10.f + p[13] * 300.f, sample_rate_);
        sine_shape_gain_ = p[14] * p[14] * 0.9f;
        sine_shape_asym_ = p[15] * 0.5f;
        sine_shape_mix_  = p[16] * 0.8f;
        rm_gain_         = p[22] * p[22] * 0.99f;
        feedback_gain_   = p[23] * p[23] * 0.7f;
        delay_max_       = 10000u;
        fb_smooth_alpha_ = 0.9f;
    }

    float sample_rate_ = 48000.f;

    PAFOperator paf0_, paf1_, paf2_, paf3_;
    Delay<11000> delay_;
    ADSR        env_;

    VoiceSpace voice_space_ = VoiceSpace::Ellipticacacia;

    // Engine state set by voice spaces.
    float p0_gain_ = 1.f, p1_gain_ = 1.f, p2_gain_ = 1.f, p3_gain_ = 1.f;
    float paf0_cf_ = 200.f, paf1_cf_ = 250.f, paf2_cf_ = 250.f, paf3_cf_ = 250.f;
    float paf0_bw_ = 100.f, paf1_bw_ = 5000.f, paf2_bw_ = 5000.f, paf3_bw_ = 5000.f;
    float paf0_vib_ = 0.f, paf1_vib_ = 1.f, paf2_vib_ = 1.f, paf3_vib_ = 1.f;
    float paf0_vfr_ = 2.f, paf1_vfr_ = 2.f, paf2_vfr_ = 2.f, paf3_vfr_ = 2.f;
    float paf0_shift_ = 0.f, paf1_shift_ = 0.f, paf2_shift_ = 0.f, paf3_shift_ = 0.f;
    float detune1_ = 1.f, detune2_ = 1.f, detune3_ = 1.f;
    float dl1_mix_ = 0.f, dl_fb_ = 0.5f;
    float rm_gain_ = 0.f;
    float sine_shape_gain_ = 0.1f, sine_shape_asym_ = 0.f, sine_shape_mix_ = 0.f;
    float feedback_gain_ = 0.f;
    float fb_smooth_alpha_ = 0.95f;
    std::size_t delay_max_ = 10u;

    // Per-process state.
    float feedback_ = 0.f;
    float fbzm1_    = 0.f;
    float base_freq_ = 50.f;
    std::uint8_t current_note_ = 60u;
};

static_assert(AudioEngine<PAFSynthEngine>, "PAFSynthEngine must satisfy AudioEngine");

}  // namespace nisps
