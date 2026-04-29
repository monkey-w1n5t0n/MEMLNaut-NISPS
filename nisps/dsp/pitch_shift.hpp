// nisps/dsp/pitch_shift.hpp — granular pitch shifter.
//
// Replaces daisysp::PitchShifter (the lone daisysp dependency in firmware).
//
// Algorithm
//   - Circular buffer of size N (8192 samples by default; ~170ms at 48kHz).
//   - Two read heads, each running at a rate determined by the pitch ratio.
//   - Heads are 180 degrees out of phase (offset by N/2 samples).
//   - Equal-power crossfade between the two heads as they wrap.
//
// `SetTransposition(semitones)` accepts +/- semitones. ratio = 2^(semitones/12).
//   Internally reads run *backwards* relative to write head, so a higher pitch
//   means the read head catches up to the write head faster.
//
// This is the standard naive approach; not pristine, but cheap and good enough
// for the XIASRI shimmer use case (and matches what the firmware currently
// produces sonically).

#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <cstring>

#include "../core/perf.hpp"

namespace nisps {

template <std::size_t N = 8192>
class PitchShifter {
    static_assert((N & (N - 1u)) == 0u, "PitchShifter buffer size must be power of two");
    static constexpr std::size_t kMask = N - 1u;

   public:
    PitchShifter() noexcept = default;

    void init(float sample_rate) noexcept {
        sample_rate_ = sample_rate;
        std::memset(buffer_.data(), 0, N * sizeof(float));
        write_idx_ = 0u;
        // Two read heads N/2 apart.
        read_pos_[0] = 0.f;
        read_pos_[1] = static_cast<float>(N) * 0.5f;
        set_transposition(0.f);
    }

    void set_transposition(float semitones) noexcept {
        // ratio = 2^(semitones/12). We don't bother with denormal guards; the
        // pow is ok off the audio path (called from set_params, not process).
        ratio_ = std::pow(2.f, semitones / 12.f);
    }

    NISPS_HOT NISPS_FORCE_INLINE float process(float input) noexcept {
        // Write incoming sample.
        buffer_[write_idx_] = input;
        write_idx_ = (write_idx_ + 1u) & kMask;

        // Each head's read rate is `ratio_`. Heads chase the write head; we
        // want the *delay* between write and read to vary. Increment by ratio
        // each sample so a ratio>1 advances faster than the write pointer
        // (eventually wrapping, hence the crossfade).
        float out = 0.f;
        for (std::size_t h = 0u; h < 2u; ++h) {
            float rp = read_pos_[h];
            // Linear interp.
            const std::size_t i1 = static_cast<std::size_t>(rp) & kMask;
            const std::size_t i2 = (i1 + 1u) & kMask;
            const float frac     = rp - std::floor(rp);
            const float s = buffer_[i1] + frac * (buffer_[i2] - buffer_[i1]);

            // Crossfade window: each head fades in/out as it traverses N. A
            // simple raised-cosine across the relative position 0..1.
            // pos in [0,1) measures how far through the buffer this head is.
            const float pos = (rp / static_cast<float>(N))
                              - std::floor(rp / static_cast<float>(N));
            // Equal-power: gain = sin(pi * pos)
            static const float kPi = 3.14159265358979323846f;
            const float gain = std::sin(kPi * pos);
            out += s * gain;

            rp += ratio_;
            if (rp >= static_cast<float>(N)) rp -= static_cast<float>(N);
            if (rp < 0.f) rp += static_cast<float>(N);
            read_pos_[h] = rp;
        }
        // Two heads with sin(pi*pos) windows phase-offset by N/2 sum to ~1
        // average; scale to keep RMS roughly equal to input.
        return out * 0.7071f;
    }

    float ratio() const noexcept { return ratio_; }

   private:
    float sample_rate_ = 48000.f;
    float ratio_       = 1.f;
    std::array<float, N> buffer_{};
    std::size_t write_idx_ = 0u;
    float read_pos_[2]     = {0.f, static_cast<float>(N) * 0.5f};
};

}  // namespace nisps
