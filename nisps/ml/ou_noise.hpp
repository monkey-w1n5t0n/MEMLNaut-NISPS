// nisps/ml/ou_noise.hpp — Ornstein-Uhlenbeck exploration noise.
//
// Ported from upstream memllib InterfaceRL (commit d0d8a72 "noise",
// e291192), which adds a per-output Ornstein-Uhlenbeck random walk to the
// network's action vector. Unlike i.i.d. per-frame noise (which jitters),
// an OU process is temporally correlated: each output drifts in long, smooth
// sweeps and is gently pulled back toward the mapping output (mean reversion).
// Because learning stays active while the noise roams, "likes" registered
// during the wander steer the network toward sounds the player wants.
//
// Discrete Euler-Maruyama update, per output channel x:
//     x += theta * (mu - x) * dt + noise_scale * N(0,1)
//     out = clamp(out + x, 0, 1)
// where, to make the process's stationary standard deviation equal a
// requested `std`:
//     sigma        = std * sqrt(2 * theta)        (continuous OU relation)
//     noise_scale  = sigma * sqrt(dt) = std * sqrt(2 * theta * dt)
//
// The exploration knob [0,1] maps to the stationary std via
// `set_intensity(level)` → std = level * kMaxAmplitude (0.65, upstream).
//
// DEFAULT STATE IS INERT: intensity defaults to 0, `enabled()` is false, and
// `apply()` neither advances the RNG nor touches the output — so a mode that
// never sets an intensity behaves bit-identically to one without OU at all
// (parity-safe). Owns a per-instance deterministic `Rng`.

#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

#include "../core/perf.hpp"
#include "../core/rng.hpp"

namespace nisps::ml {

// Upstream kMaxAmplitude: the exploration knob's full-scale stationary std in
// parameter space.
inline constexpr float kOUMaxAmplitude = 0.65f;

template <std::size_t N>
class OUNoise {
   public:
    explicit OUNoise(std::uint64_t seed) noexcept : rng_(seed) {
        recompute_scale_();
    }

    // Exploration amount in [0,1]; 0 disables (inert). Maps to the OU
    // stationary std = level * kMaxAmplitude.
    void set_intensity(float level) noexcept {
        if (level < 0.f) level = 0.f;
        else if (level > 1.f) level = 1.f;
        stationary_std_ = level * kOUMaxAmplitude;
        recompute_scale_();
    }
    float intensity() const noexcept { return stationary_std_ / kOUMaxAmplitude; }
    bool  enabled() const noexcept { return stationary_std_ > 0.f; }

    // OU smoothness controls (upstream defaults theta=0.02, dt=0.001).
    void set_theta(float theta) noexcept { theta_ = theta; recompute_scale_(); }
    void set_dt(float dt) noexcept { dt_ = dt; recompute_scale_(); }

    // Advance the per-channel OU state and add it (clamped) to `out`. No-op
    // when disabled. `out` is the post-inference parameter vector.
    NISPS_HOT void apply(std::span<float> out) noexcept {
        if (!enabled()) return;
        const std::size_t n = out.size() < N ? out.size() : N;
        for (std::size_t i = 0u; i < n; ++i) {
            // mu = 0: the walk is an offset that mean-reverts to zero, so the
            // network's own mapping output stays the anchor.
            state_[i] += theta_ * (-state_[i]) * dt_ +
                         noise_scale_ * rng_.next_float_gaussian(1.f);
            float v = out[i] + state_[i];
            if (v < 0.f) v = 0.f;
            else if (v > 1.f) v = 1.f;
            out[i] = v;
        }
    }

    void reset() noexcept { state_.fill(0.f); }
    void seed(std::uint64_t s) noexcept { rng_.seed(s); }

   private:
    NISPS_FORCE_INLINE void recompute_scale_() noexcept {
        float k = 2.f * theta_ * dt_;
        if (k < 0.f) k = 0.f;
        noise_scale_ = stationary_std_ * std::sqrt(k);
    }

    Rng                  rng_;
    std::array<float, N> state_{};
    float                theta_          = 0.02f;
    float                dt_             = 0.001f;
    float                stationary_std_ = 0.f;
    float                noise_scale_    = 0.f;
};

}  // namespace nisps::ml
