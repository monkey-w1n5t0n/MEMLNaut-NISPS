// nisps/ml/jolt.hpp — "Jolt": held-button continuous weight morph.
//
// Ported from upstream memllib InterfaceRL (commit 9fcd459 "jolts",
// e291192). While a button/pedal is held, pick a handful of random weights
// scattered across the whole network and EMA-glide each toward a bounded
// random target; on arrival, re-roll the target so the motion never stops.
// Releasing freezes the weights where they landed (the change is permanent),
// then ramps the effective learning rate back from 0 → 1 over ~5 s so any
// subsequent training eases in instead of yanking the net off the jolted
// sound.
//
// This operates on the MLP's FLAT weight buffer (mlp.hpp `get_weights()` /
// `set_weights()` / `weight_count()`), so it is architecture-agnostic — it
// does not care how many layers or how wide. It owns a per-instance
// deterministic `Rng` (seeded by the caller) so firmware ↔ browser parity
// holds.
//
// DEFAULT STATE IS INERT: a freshly constructed Jolt is inactive, `step()`
// is a no-op, and `lr_scale()` returns 1.0 (full LR). Nothing perturbs the
// network until `press()` is called.
//
// Upstream constants (InterfaceRL.hpp kJolt*) are reproduced verbatim in
// JoltParams defaults.

#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

#include "../core/perf.hpp"
#include "../core/rng.hpp"

namespace nisps::ml {

// Upper bound on simultaneously-morphed weights; sizes the index/target
// arrays so the class stays heap-free. Upstream uses 40.
inline constexpr std::size_t kJoltMaxWeights = 64u;

struct JoltParams {
    std::size_t num_weights    = 40u;     // kJoltNumWeights
    float       morph_rate     = 0.017f;  // kJoltMorphRate (EMA per tick, ~1s @200Hz)
    float       target_min     = -1.2f;   // kJoltWeightMin (== weight-init range)
    float       target_max     = 0.9f;    // kJoltWeightMax
    float       target_epsilon = 0.05f;   // kJoltTargetEpsilon (re-roll within this)
    float       lr_ramp_step   = 0.001f;  // kJoltLRRampStep (1/(5s*200Hz))
};

class Jolt {
   public:
    explicit Jolt(std::uint64_t seed) noexcept : rng_(seed) {}

    void               set_params(const JoltParams& p) noexcept { params_ = p; }
    const JoltParams&  params() const noexcept { return params_; }

    bool active() const noexcept { return active_; }

    // Effective-learning-rate multiplier for the caller's training step:
    // 0 while the jolt is held, then ramps 0 → 1 after release. Callers that
    // train (firmware optimise / playground continuous trainer) should
    // multiply their LR by this. Pure-example modes that only train on an
    // explicit gesture may ignore it.
    float lr_scale() const noexcept { return active_ ? 0.f : lr_ramp_; }

    // Begin a jolt over a flat weight buffer of `weight_count` entries: pick
    // `num_weights` random global indices and a bounded random target each.
    void press(std::size_t weight_count) noexcept {
        active_ = true;
        lr_ramp_ = 0.f;
        n_ = params_.num_weights;
        if (n_ > kJoltMaxWeights) n_ = kJoltMaxWeights;
        if (weight_count == 0u) { n_ = 0u; return; }
        for (std::size_t i = 0u; i < n_; ++i) {
            idx_[i]    = static_cast<std::size_t>(rng_.next_u64() % weight_count);
            target_[i] = roll_target_();
        }
    }

    // Per control tick while held: EMA-glide each selected weight toward its
    // target, re-rolling targets that have been reached. No-op when inactive.
    NISPS_HOT void step(std::span<float> weights) noexcept {
        if (!active_) return;
        const std::size_t wc = weights.size();
        for (std::size_t i = 0u; i < n_; ++i) {
            const std::size_t k = idx_[i];
            if (k >= wc) continue;
            float w = weights[k];
            w += params_.morph_rate * (target_[i] - w);
            weights[k] = w;
            if (std::fabs(target_[i] - w) < params_.target_epsilon) {
                target_[i] = roll_target_();
            }
        }
    }

    // Release: freeze weights where they are (permanent) and re-arm the LR
    // ramp from 0.
    void release() noexcept {
        active_  = false;
        lr_ramp_ = 0.f;
    }

    // Advance the post-release LR ramp toward full. Call once per control
    // tick; a no-op while active or already ramped.
    void tick_lr_ramp() noexcept {
        if (active_ || lr_ramp_ >= 1.f) return;
        lr_ramp_ += params_.lr_ramp_step;
        if (lr_ramp_ > 1.f) lr_ramp_ = 1.f;
    }

    // Re-seed the internal RNG (parity / reset).
    void seed(std::uint64_t s) noexcept { rng_.seed(s); }

   private:
    NISPS_FORCE_INLINE float roll_target_() noexcept {
        return params_.target_min +
               rng_.next_float_uniform() * (params_.target_max - params_.target_min);
    }

    JoltParams                            params_{};
    Rng                                   rng_;
    bool                                  active_  = false;
    float                                 lr_ramp_ = 1.f;
    std::size_t                           n_       = 0u;
    std::array<std::size_t, kJoltMaxWeights> idx_{};
    std::array<float, kJoltMaxWeights>       target_{};
};

}  // namespace nisps::ml
