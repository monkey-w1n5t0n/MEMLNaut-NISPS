// nisps/ml/geo_push.hpp — geometric push-away target computation for the
// dislike gesture (docs/adr/rl-feedback-design.md §2.1/§4).
//
// Verbatim port of the per-negative target computation in upstream
// InterfaceRL.tpp:723-760 (memllib @ e291192 — vendored read-only at
// firmware/MEMLNaut-NISPS/lib/memllib/reference/):
//
//   pushStep     = clamp(|avgRewardNeg|, 0.25, 1.0) * kGeometricPushScale
//   dir[j]       = neg_action[j] - meanPositiveAction[j]   (zeros when no likes)
//   len          = ||dir||
//   useRandom    = !havePositives || (len <= 1e-4)
//   d            = useRandom ? random ∈ [-1,1] : dir[j] / len
//   target[j]    = clamp(neg_action[j] + d * pushStep, 0, 1)
//   inactive dims keep neg_action[j]
//
// RE-BASED 2026-07-25 from `0a541cc` to `e291192`, where upstream had
// deliberately redesigned this and we had not noticed (the reference impl was
// out of tree — see reference/README.md). Three changes, all upstream's:
// kGeometricPushScale 0.5 -> 1.0, kNegLRBase 0.5 -> 1.5, and the `/(1+len)`
// TAPER DELETED. Upstream's own comment on the taper, at InterfaceRL.tpp:724:
//
//   "No taper: a 'no' should clearly move the mapping away even from a sound
//    already far from the liked region (the taper used to kill exactly that
//    case). Bigger kGeometricPushScale + higher negLRRatio => the sound
//    slides away faster/further."
//
// SINGLE DELIBERATE FIRMWARE DIVERGENCE (recorded in ALIGNMENT.md): the
// upstream `useRandom` branch draws libc `rand() & 0xFF`; we draw from the
// caller's deterministic per-instance `nisps::Rng` so native == WASM parity
// holds.
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

// Upstream InterfaceRL.hpp:409.
inline constexpr float kGeometricPushScale = 1.f;

// Upstream InterfaceRL.hpp:410 — `negLRRatio = kNegLRBase - 0.4*negFraction`.
inline constexpr float kNegLRBase = 1.5f;

// pushStep from the mean negative reward (InterfaceRL.tpp:733).
inline float geo_push_step(float avg_reward_neg) noexcept {
    float mag = (avg_reward_neg < 0.f) ? -avg_reward_neg : avg_reward_neg;
    if (mag < 0.25f) mag = 0.25f;
    if (mag > 1.0f)  mag = 1.0f;
    return mag * kGeometricPushScale;
}

// Compute the push-away target for ONE disliked action. `active_mask`
// (1 = active) gates which dims move — empty ⇒ all active (this is the solo/
// focus mask; upstream `activeDims_`). `have_positives` is upstream's
// `posMemCount > 0`: with no likes stored yet there is no centroid to push
// away FROM, so every dim goes in a random direction instead (upstream passes
// an all-zero `meanPositiveAction` in that case, and `mean_positive` may be
// zeros here too — the flag, not the vector, is what selects the branch).
// Writes n_out floats into `target`.
inline void compute_push_target(std::span<const float>         neg_action,
                                std::span<const float>         mean_positive,
                                std::span<const std::uint8_t>  active_mask,
                                float                          push_step,
                                bool                           have_positives,
                                Rng&                           rng,
                                std::span<float>               target) noexcept {
    const std::size_t n = neg_action.size();

    float len_sq = 0.f;
    for (std::size_t j = 0; j < n; ++j) {
        const float d = neg_action[j] - mean_positive[j];
        len_sq += d * d;
    }
    const float len        = std::sqrt(len_sq);
    const bool  use_random = !have_positives || (len <= 1e-4f);

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
        float t = neg_action[j] + d * push_step;
        if (t < 0.f) t = 0.f;
        if (t > 1.f) t = 1.f;
        target[j] = t;
    }
}

// Dynamic LR ratio (InterfaceRL.tpp:758-760): push harder when dislikes are
// rare, gentler when they flood the buffer.
inline float geo_neg_lr_ratio(std::size_t neg_count, std::size_t pos_count) noexcept {
    const std::size_t total = neg_count + pos_count;
    const float neg_fraction = (total > 0u)
        ? static_cast<float>(neg_count) / static_cast<float>(total)
        : 0.f;
    return kNegLRBase - 0.4f * neg_fraction;
}

}  // namespace nisps::ml
