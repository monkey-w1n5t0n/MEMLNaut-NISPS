// nisps/engines/xiasri.hpp — Reverb + delays + pitch-shift FX engine.
//
// Mirrors firmware XIASRIAudioApp. Direct (no voice space) NN→param mapping —
// the firmware ignored its voice-space slot and read smoothParams[] inline.
// We expose a single "Direct" voice space for schema parity.
//
// Pipeline (per sample):
//   pitch_shift → DC-blocker → 6-allpass + 2-comb reverb tail → 4 parallel
//   delays → wet/dry mix → tanh → mono out
//
// All parameters are smoothed via a OnePoleSmoother before they reach the
// audio path so that ML output discontinuities don't audibly click.

#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <span>
#include <string_view>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/types.hpp"
#include "../dsp/dc_blocker.hpp"
#include "../dsp/delay.hpp"
#include "../dsp/filter.hpp"
#include "../dsp/pitch_shift.hpp"
#include "../dsp/reverb.hpp"

namespace nisps {

class XIASRIEngine {
   public:
    static constexpr std::size_t kNParams = 24u;
    static constexpr std::size_t param_count() noexcept { return kNParams; }
    static constexpr std::string_view engine_id() noexcept { return "xiasri"; }

    enum class VoiceSpace : std::size_t { Direct = 0, Count = 1 };
    static constexpr std::size_t kVoiceSpaceCount = 1u;
    static constexpr std::array<std::string_view, kVoiceSpaceCount> kVoiceSpaceNames = {"Direct"};

    void set_voice_space(VoiceSpace) noexcept {}  // no-op for parity
    VoiceSpace voice_space() const noexcept { return VoiceSpace::Direct; }

    void setup(float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        smoother_.setup(150.f, sample_rate);
        pitch_shifter_.init(sample_rate);
        for (auto& v : nn_outputs_) v = 0.f;
        for (auto& v : smooth_params_) v = 0.f;
    }

    void set_params(std::span<const float> params) noexcept {
        if (params.size() < kNParams) return;
        // Direct copy — actual parameter mapping is per-sample in process().
        for (std::size_t i = 0u; i < kNParams; ++i) nn_outputs_[i] = params[i];
    }

    NISPS_HOT NISPS_FORCE_INLINE stereosample_t process(stereosample_t x) noexcept {
        smoother_.process(nn_outputs_.data(), smooth_params_.data());

        const float dl1mix = smooth_params_[0]  * 0.4f;
        const float dl2mix = smooth_params_[1]  * 0.4f;
        const float dl3mix = smooth_params_[2]  * 0.8f;
        const float dl4mix = smooth_params_[22] * smooth_params_[22] * 0.41f;

        const float allp1fb = smooth_params_[4] * 0.99f;
        const float allp2fb = smooth_params_[5] * 0.99f;
        const float comb1fb = smooth_params_[6] * 0.95f;
        const float comb2fb = smooth_params_[7] * 0.95f;

        const float dl1fb = smooth_params_[8]  * 0.95f;
        const float dl2fb = smooth_params_[9]  * 0.95f;
        const float dl3fb = smooth_params_[10] * 0.95f;
        const float dl4fb = smooth_params_[23] * 0.95f;

        const float wet = (smooth_params_[11] * 0.7f) + 0.3f;
        // Keep firmware's curious +12 semitone offset for parity.
        pitch_shifter_.set_transposition(12.f + smooth_params_[12]);
        const float ps_mix = smooth_params_[13] * 0.99f;

        const float allp3fb = smooth_params_[14] * 0.99f;
        const float allp4fb = smooth_params_[15] * 0.99f;
        const float allp5fb = smooth_params_[16] * 0.99f;
        const float allp6fb = smooth_params_[17] * 0.99f;
        const float allp3mix = smooth_params_[18];
        const float allp4mix = smooth_params_[19];
        const float allp5mix = smooth_params_[20];
        const float allp6mix = smooth_params_[21];

        // Stereo collapsed to mono pre-FX, scaled by 2.
        float mix = (x.L + x.R) * 2.f;

        float ps  = pitch_shifter_.process(mix);
        ps = (mix * (1.f - ps_mix)) + (ps * ps_mix);

        float y = dcb_.play(ps, 0.99f) * 2.f;

        float y1 = allp1_.process(y, 30u, allp1fb);
        y1       = comb1_.process(y1, 127u, comb1fb);

        float y2 = allp2_.process(y, 482u, allp2fb);
        y2       = comb2_.process(y2, 808u, comb2fb);

        const float y3 = allp3_.process(y, 19u,  allp3fb) * allp3mix;
        const float y4 = allp4_.process(y, 69u,  allp4fb) * allp4mix;
        const float y5 = allp5_.process(y, 131u, allp5fb) * allp5mix;
        const float y6 = allp6_.process(y, 287u, allp6fb) * allp6mix;

        y = y1 + y2 + y3 + y4 + y5 + y6;

        const float d1 = dl1_.play(y, 3500u,  dl1fb) * dl1mix;
        const float d2 = dl2_.play(y, 7886u,  dl2fb) * dl2mix;
        const float d3 = dl3_.play(y, 299u,   dl3fb) * dl3mix;
        // d4 captured but not summed in firmware code path; preserve semantics.
        (void)dl4_.play(y, 15873u, dl4fb);
        (void)dl4mix;

        y = y + d1 + d2 + d3;
        y = (y * wet) + (mix * (1.f - wet));
        y = std::tanh(y * 1.2f);
        return {y, y};
    }

    DriverConfig driver_config() const noexcept {
        DriverConfig c;
        c.line_level = 6u;
        c.output_volume = 0.9f;
        return c;
    }

   private:
    float sample_rate_ = 48000.f;

    PitchShifter<8192> pitch_shifter_;
    DCBlocker          dcb_;

    Delay<5000>  dl1_;
    Delay<8000>  dl2_;
    Delay<1201>  dl3_;
    Delay<16000> dl4_;

    AllPass<300> allp1_;
    AllPass<500> allp2_;
    AllPass<500> allp3_;
    AllPass<500> allp4_;
    AllPass<500> allp5_;
    AllPass<500> allp6_;
    Comb<200>    comb1_;
    Comb<900>    comb2_;

    OnePoleSmoother<kNParams> smoother_;
    std::array<float, kNParams> nn_outputs_{};
    std::array<float, kNParams> smooth_params_{};
};

static_assert(AudioEngine<XIASRIEngine>, "XIASRIEngine must satisfy AudioEngine");

}  // namespace nisps
