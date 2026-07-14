// nisps/ml/geo_push.hpp — geometric push-away target computation for the
// dislike gesture (docs/adr/rl-feedback-design.md §2.1/§4).
//
// Verbatim port of the per-negative target computation in upstream
// InterfaceRL.cpp:713-735 (memllib @ 0a541cc):
//
//   pushStep          = clamp(|avgRewardNeg|, 0.25, 1.0) * kGeometricPushScale
//   dir[j]            = neg_action[j] - meanPositiveAction[j]
//   len               = ||dir||
//   useRandom         = (len <= 1e-4)                 (disliked ON the centroid)
//   effectivePushStep = pushStep / (1 + len)          (taper for far items)
//   d                 = useRandom ? random ∈ [-1,1] : dir[j] / len
//   target[j]         = clamp(neg_action[j] + d * effectivePushStep, 0, 1)
//   inactive dims keep neg_action[j]
//
// SINGLE DELIBERATE FIRMWARE DIVERGENCE (recorded in ALIGNMENT.md): the
// upstream `useRandom` branch draws libc `rand() & 0xFF`; we draw from the
// caller's deterministic per-instance `nisps::Rng` so native == WASM parity
// holds. The branch only fires when a disliked action sits exactly on the
// centroid.
//
// Pure free functions over spans — no replay/centroid logic in the MLP
// kernel, no state, no heap (Anchor-First graft, ADR §0).

#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

#include "../core/perf.hpp"
#include "../core/rng.hpp"

namespace nisps::ml {

// Upstream InterfaceRL.hpp:293.
inline constexpr float kGeometricPushScale = 0.5f;

// pushStep from the mean negative reward (InterfaceRL.cpp:713).
inline float geo_push_step(float avg_reward_neg) noexcept {
    float mag = (avg_reward_neg < 0.f) ? -avg_reward_neg : avg_reward_neg;
    if (mag < 0.25f) mag = 0.25f;
    if (mag > 1.0f)  mag = 1.0f;
    return mag * kGeometricPushScale;
}

// Compute the push-away target for ONE disliked action. `active_mask`
// (1 = active) gates which dims move — empty ⇒ all active (this is the solo/
// focus mask; upstream `activeDims_`). Writes n_out floats into `target`.
inline void compute_push_target(std::span<const float>         neg_action,
                                std::span<const float>         mean_positive,
                                std::span<const std::uint8_t>  active_mask,
                                float                          push_step,
                                Rng&                           rng,
                                std::span<float>               target) noexcept {
    const std::size_t n = neg_action.size();

    float len_sq = 0.f;
    for (std::size_t j = 0; j < n; ++j) {
        const float d = neg_action[j] - mean_positive[j];
        len_sq += d * d;
    }
    const float len        = std::sqrt(len_sq);
    const bool  use_random = (len <= 1e-4f);
    const float effective  = push_step / (1.0f + len);

    for (std::size_t j = 0; j < n; ++j) {
        const bool active =
            active_mask.empty() || (j < active_mask.size() && active_mask[j] != 0u);
        if (!active) {
            target[j] = neg_action[j];
            continue;
        }
        const float d = use_random
            ? rng.next_float_signed()
            : ((neg_action[j] - mean_positive[j]) / len);
        float t = neg_action[j] + d * effective;
        if (t < 0.f) t = 0.f;
        if (t > 1.f) t = 1.f;
        target[j] = t;
    }
}

// Dynamic LR ratio (InterfaceRL.cpp:742-743): push harder when dislikes are
// rare, gentler when they flood the buffer.
inline float geo_neg_lr_ratio(std::size_t neg_count, std::size_t pos_count) noexcept {
    const std::size_t total = neg_count + pos_count;
    const float neg_fraction = (total > 0u)
        ? static_cast<float>(neg_count) / static_cast<float>(total)
        : 0.f;
    return 0.5f - 0.4f * neg_fraction;
}

}  // namespace nisps::ml
