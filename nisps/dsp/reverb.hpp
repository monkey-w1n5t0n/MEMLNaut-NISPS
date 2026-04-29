// nisps/dsp/reverb.hpp — Schroeder-Moorer reverb building blocks.
//
//  AllPass<N>       — feedback all-pass section
//  Comb<N>          — simple feedback comb
//  LpComb<N>        — comb with one-pole lowpass in the feedback path
//                     (Freeverb-style; used by VerbFX's lpcomb bank)
//
// Maximilian's `maxiReverbFilters` jams allpass/comb/lpcombfb into one class
// with a shared `delay_line` — that doesn't compose well when an engine wants
// to use the same instance as both an allpass AND a comb. We split them so
// each instance has one role and one ring buffer.

#pragma once

#include <array>
#include <cstddef>
#include <cstring>

#include "../core/perf.hpp"

namespace nisps {

template <std::size_t N>
class AllPass {
   public:
    AllPass() noexcept { clear(); }

    void clear() noexcept {
        std::memset(line_.data(), 0, N * sizeof(float));
        idx_ = 0u;
    }

    // Schroeder all-pass:
    //   v = x + fb * line[i]
    //   y = line[i] - fb * v
    //   line[i] = v
    NISPS_HOT NISPS_FORCE_INLINE float process(float input,
                                               std::size_t size,
                                               float fb) noexcept {
        if (size == 0u || size >= N) return 0.f;
        const float buffered = line_[idx_];
        const float v = input + fb * buffered;
        const float y = buffered - fb * v;
        line_[idx_]   = v;
        idx_ = (idx_ + 1u) % size;
        return y;
    }

    static constexpr std::size_t capacity() noexcept { return N; }

   private:
    std::array<float, N> line_{};
    std::size_t idx_ = 0u;
};

template <std::size_t N>
class Comb {
   public:
    Comb() noexcept { clear(); }

    void clear() noexcept {
        std::memset(line_.data(), 0, N * sizeof(float));
        idx_ = 0u;
    }

    // y = x + fb * line[i]; line[i] = y; (Schroeder feedback comb)
    NISPS_HOT NISPS_FORCE_INLINE float process(float input,
                                               std::size_t size,
                                               float fb) noexcept {
        if (size == 0u || size >= N) return 0.f;
        const float y = input + fb * line_[idx_];
        line_[idx_]   = y;
        idx_ = (idx_ + 1u) % size;
        return y;
    }

    static constexpr std::size_t capacity() noexcept { return N; }

   private:
    std::array<float, N> line_{};
    std::size_t idx_ = 0u;
};

// Lowpass-in-loop comb. The cutoff is parameterised in normalised
// [0,1] form (smoothing coefficient `alpha` for a one-pole IIR), exactly
// matching the maxiReverbFilters::lpcombfb semantics:
//   lp_y = lp_y * (1 - alpha) + line[i] * alpha
//   y    = x + fb * lp_y
//   line[i] = y
template <std::size_t N>
class LpComb {
   public:
    LpComb() noexcept { clear(); }

    void clear() noexcept {
        std::memset(line_.data(), 0, N * sizeof(float));
        idx_   = 0u;
        lp_y_  = 0.f;
    }

    NISPS_HOT NISPS_FORCE_INLINE float process(float input,
                                               std::size_t size,
                                               float fb,
                                               float lp_alpha) noexcept {
        if (size == 0u || size >= N) return 0.f;
        const float buffered = line_[idx_];
        lp_y_ = lp_y_ * (1.f - lp_alpha) + buffered * lp_alpha;
        const float y = input + fb * lp_y_;
        line_[idx_]   = y;
        idx_ = (idx_ + 1u) % size;
        return y;
    }

    static constexpr std::size_t capacity() noexcept { return N; }

   private:
    std::array<float, N> line_{};
    std::size_t idx_  = 0u;
    float       lp_y_ = 0.f;
};

}  // namespace nisps
