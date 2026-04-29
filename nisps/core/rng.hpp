// nisps/core/rng.hpp — deterministic PRNG used everywhere we need
// reproducibility (weight init, RL noise, dataset shuffle, golden vectors).
//
// xoshiro256+ — Blackman & Vigna (2018). 64-bit state, 4× u64 state words,
// passes BigCrush, fast (a handful of ALU ops), no branches in the hot path.
// We use the `+` variant rather than `**` because we only consume the high
// bits for floats; the low-bit linearity that pesters `+` for integer use is
// irrelevant once you mask off the float mantissa.
//
// Seeding: we splitmix64 the user-provided u64 seed to fan it out across the
// four state words, so seed=0 / seed=1 / seed=N all produce uncorrelated
// streams. (Pure xoshiro fails badly for all-zero state.)
//
// Gaussian: sum-of-three-uniforms. Cheaper than Box-Muller (no log/sin) and
// the existing JS engine uses the same shape (`gen_randn = sum of 3
// uniforms scaled by speed`), so by matching it we keep firmware ↔ browser
// noise statistically equivalent without a parity headache. Box-Muller would
// be more accurate, but we want compatibility with the legacy MoveWeights
// shape — see recon/01-ml-stack.md §3.

#pragma once

#include <cstdint>

namespace nisps {

class Rng {
   public:
    explicit Rng(std::uint64_t seed) noexcept { this->seed(seed); }

    void seed(std::uint64_t s) noexcept {
        // splitmix64: avalanche the seed into four uncorrelated state words.
        for (int i = 0; i < 4; ++i) {
            s += 0x9E3779B97F4A7C15ull;
            std::uint64_t z = s;
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
            z = z ^ (z >> 31);
            state_[i] = z;
        }
        // Guarantee non-zero state. Astronomically unlikely to be all-zero
        // post-splitmix anyway, but defense in depth.
        if ((state_[0] | state_[1] | state_[2] | state_[3]) == 0ull) {
            state_[0] = 1ull;
        }
    }

    inline std::uint64_t next_u64() noexcept {
        const std::uint64_t result = state_[0] + state_[3];
        const std::uint64_t t = state_[1] << 17;
        state_[2] ^= state_[0];
        state_[3] ^= state_[1];
        state_[1] ^= state_[2];
        state_[0] ^= state_[3];
        state_[2] ^= t;
        state_[3] = rotl_(state_[3], 45);
        return result;
    }

    // Uniform float in [0, 1). Standard "top 24 bits → mantissa" trick.
    inline float next_float_uniform() noexcept {
        // 1.f / 2^24 = 5.9604644775390625e-08
        constexpr float kInv = 1.f / 16777216.f;
        return static_cast<float>(next_u64() >> 40) * kInv;
    }

    // Uniform float in [-1, 1).
    inline float next_float_signed() noexcept {
        return next_float_uniform() * 2.f - 1.f;
    }

    // Approx Gaussian via sum of three [-1, 1) uniforms.
    // Variance of one such uniform = 1/3, so summing three gives variance 1
    // and stddev 1. We then scale by the requested stddev.
    inline float next_float_gaussian(float stddev = 1.f) noexcept {
        const float a = next_float_signed();
        const float b = next_float_signed();
        const float c = next_float_signed();
        return (a + b + c) * stddev;
    }

   private:
    static inline std::uint64_t rotl_(std::uint64_t x, int k) noexcept {
        return (x << k) | (x >> (64 - k));
    }

    std::uint64_t state_[4]{};
};

}  // namespace nisps
