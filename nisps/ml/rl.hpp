// nisps/ml/rl.hpp — reinforcement-style weight perturbation primitives.
//
// `move_weights` and `draw_weights` are the two playground RL operations
// applied to network weights:
//   - `draw_weights(spread)`: re-randomize all weights using the spread-
//     aware scale (see init.hpp). This is the "thumbs-down really hard"
//     button.
//   - `move_weights(speed, spread, output_pin_mask)`: per-call weight decay
//     followed by gaussian noise injection. This is the "thumbs-down a
//     little" feedback. The pin mask, if supplied, freezes weights feeding
//     specific OUTPUT nodes — only on the FINAL layer.
//
// PARITY CONTRACT WITH LEGACY JS PLAYGROUND
//   These match `playground/_archive/js/nisps/mlp.js::moveWeights` and
//   `drawWeights` semantically. Specifically:
//     * Per-layer scale: layer_scale = (1 - spread) + spread / sqrt(fan_in)
//     * Weight decay:    each weight gets multiplied by (1 - 0.1 * spread)
//                        BEFORE noise is added. spread=0 ⇒ no decay,
//                        spread=1 ⇒ ~10% decay per call.
//     * Noise:           gaussian via rng.next_float_gaussian(speed *
//                        layer_scale). The legacy code uses a sum-of-three-
//                        uniforms gaussian, and our `Rng` matches that
//                        shape (see core/rng.hpp).
//     * Output pin mask: 1 byte per output node. If mask[i]==1, all weights
//                        AND the bias feeding output node i in the final
//                        layer are skipped. Hidden layers are unaffected by
//                        the mask.
//     * Biases:          included in the noise injection, unaffected by
//                        decay (matching the legacy JS behavior — decay was
//                        applied to weights only there).
//
// The functions are layer-scoped; the MLP class (mlp.hpp) iterates through
// its layers, calling these for each.

#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

#include "../core/rng.hpp"
#include "init.hpp"

namespace nisps::ml {

// Per-call weight-decay coefficient. spread=0 ⇒ 1.0 (no decay), spread=1 ⇒
// 0.9 (10% decay per call). See architecture spread §3 in CLAUDE.md.
inline float weight_decay_factor(float spread) noexcept {
    return 1.f - 0.1f * spread;
}

// Apply RL perturbation to one layer's weights+biases. `is_final_layer`
// gates the application of `output_pin_mask`. `output_pin_mask`, if
// non-empty, must be sized fan_out.
//
// Effects, applied in order per weight w:
//   w *= (1 - 0.1 * spread)
//   w += gaussian(speed * layer_scale)
// Biases:
//   b += gaussian(speed * layer_scale)
// Skip rule on final layer if mask[node]==1: leave w/b untouched.
inline void move_weights_layer(std::span<float>          weights,
                               std::span<float>          biases,
                               std::size_t               fan_in,
                               float                     speed,
                               float                     spread,
                               bool                      is_final_layer,
                               std::span<const std::uint8_t> output_pin_mask,
                               Rng&                      rng) noexcept {
    const float layer_scale = spread_scale(spread, fan_in);
    const float noise_stddev = speed * layer_scale;
    const float decay = weight_decay_factor(spread);

    const std::size_t fan_out = biases.size();

    for (std::size_t node = 0; node < fan_out; ++node) {
        const bool skip =
            is_final_layer && !output_pin_mask.empty() && output_pin_mask[node] != 0u;

        // Bias perturbation.
        if (!skip) {
            biases[node] += rng.next_float_gaussian(noise_stddev);
        }

        // Per-weight decay+noise. We always advance the RNG even on skip
        // so that the random stream is independent of pin-mask state — this
        // makes parity tests deterministic regardless of which outputs are
        // pinned. Otherwise toggling a pin would shift the entire
        // downstream noise sequence, which would be surprising.
        const std::size_t row_off = node * fan_in;
        for (std::size_t j = 0; j < fan_in; ++j) {
            const float noise = rng.next_float_gaussian(noise_stddev);
            if (!skip) {
                float& w = weights[row_off + j];
                w = w * decay + noise;
            }
        }
    }
}

// Re-randomize one layer's weights using the spread-aware scale. Biases are
// reset to zero, matching `init.hpp::spread_init`.
inline void draw_weights_layer(std::span<float> weights,
                               std::span<float> biases,
                               std::size_t      fan_in,
                               float            spread,
                               Rng&             rng) noexcept {
    spread_init(weights, biases, fan_in, spread, rng);
}

}  // namespace nisps::ml
