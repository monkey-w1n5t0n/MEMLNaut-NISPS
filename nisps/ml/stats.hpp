// nisps/ml/stats.hpp — per-layer weight-health diagnostics.
//
// Mirrors the `nisps_mlp_get_layer_stats` WASM binding semantics: for each
// layer, return mean(|w|), max(|w|), dead fraction, and saturating fraction.
// These are used by the playground "weight health" panel.
//
// Definitions:
//   - mean_abs:    average of |w| across all weights+biases of the layer
//   - max_abs:     max  of |w| across all weights+biases
//   - dead_frac:   fraction of weights with |w| < kDeadThresh
//   - saturating_frac: fraction with |w| > kSaturatingThresh
//
// Thresholds are chosen to match the JS engine's heuristic targets:
//   dead: 0.001 (a weight smaller than this contributes negligibly)
//   sat:  3.0   (weights larger than this typically push sigmoid to its
//                rails — a smell during normal training but normal during
//                RL exploration)
//
// We intentionally include biases in mean/max but not in dead/sat fractions
// — biases are scarce relative to weights and including them would skew the
// fractions, especially at startup when biases are zero.

#pragma once

#include <cmath>
#include <cstddef>
#include <span>

namespace nisps::ml {

inline constexpr float kDeadThresh        = 0.001f;
inline constexpr float kSaturatingThresh  = 3.0f;

struct LayerStats {
    float mean_abs        = 0.f;
    float max_abs         = 0.f;
    float dead_frac       = 0.f;
    float saturating_frac = 0.f;
};

inline LayerStats compute_layer_stats(std::span<const float> weights,
                                      std::span<const float> biases) noexcept {
    LayerStats out;
    const std::size_t total = weights.size() + biases.size();
    if (total == 0u) return out;

    float sum = 0.f;
    float max_abs = 0.f;
    std::size_t dead = 0u;
    std::size_t sat  = 0u;

    for (float w : weights) {
        const float a = std::fabs(w);
        sum += a;
        if (a > max_abs) max_abs = a;
        if (a < kDeadThresh)        ++dead;
        if (a > kSaturatingThresh)  ++sat;
    }
    for (float b : biases) {
        const float a = std::fabs(b);
        sum += a;
        if (a > max_abs) max_abs = a;
    }

    out.mean_abs = sum / static_cast<float>(total);
    out.max_abs  = max_abs;

    const float w_count = static_cast<float>(weights.size());
    if (w_count > 0.f) {
        out.dead_frac       = static_cast<float>(dead) / w_count;
        out.saturating_frac = static_cast<float>(sat)  / w_count;
    }
    return out;
}

}  // namespace nisps::ml
