// nisps/ml/init.hpp — weight initialization strategies.
//
// Three strategies are exposed:
//   - `uniform_init`: w ~ U[-1, 1]. Matches the legacy
//     `utils::gen_rand<T>()` baseline; produces high-magnitude pre-activations
//     that drive sigmoid output saturation.
//   - `xavier_init`: w ~ U[-1, 1] / sqrt(fan_in). Centered pre-activations,
//     better for sigmoid output layers.
//   - `spread_init`: linearly interpolates per-layer scale between the two.
//     scale = (1 - spread) + spread / sqrt(fan_in). spread=0 ⇒ uniform,
//     spread=1 ⇒ Xavier. This is the playground knob.
//
// All three operate on a flat row-major weight buffer of size fan_in*fan_out.
// Biases are initialized separately and ALWAYS to zero — the legacy code
// initialized biases to zero, and the playground spread parameter never
// touches biases. We keep that.

#pragma once

#include <cmath>
#include <cstddef>
#include <span>

#include "../core/rng.hpp"

namespace nisps::ml {

// Compute the spread-aware weight scale for one layer.
//   spread=0 → 1.0 (uniform [-1, 1])
//   spread=1 → 1/sqrt(fan_in) (Xavier)
inline float spread_scale(float spread, std::size_t fan_in) noexcept {
    if (fan_in == 0u) return 1.f;
    const float inv_sqrt = 1.f / std::sqrt(static_cast<float>(fan_in));
    return (1.f - spread) + spread * inv_sqrt;
}

// Initialize one layer's weights (flat row-major) and biases.
//   weights: span of size fan_in * fan_out
//   biases:  span of size fan_out (zeroed)
//   spread:  see spread_scale
//   rng:     state advanced; caller owns it
inline void spread_init(std::span<float> weights,
                        std::span<float> biases,
                        std::size_t      fan_in,
                        float            spread,
                        Rng&             rng) noexcept {
    const float scale = spread_scale(spread, fan_in);
    for (std::size_t i = 0; i < weights.size(); ++i) {
        weights[i] = rng.next_float_signed() * scale;
    }
    for (std::size_t i = 0; i < biases.size(); ++i) {
        biases[i] = 0.f;
    }
}

// Convenience aliases for the endpoints. Cheap to build on top of
// spread_init; useful for tests that want to assert a specific regime.
inline void uniform_init(std::span<float> weights,
                         std::span<float> biases,
                         std::size_t      fan_in,
                         Rng&             rng) noexcept {
    spread_init(weights, biases, fan_in, 0.f, rng);
}

inline void xavier_init(std::span<float> weights,
                        std::span<float> biases,
                        std::size_t      fan_in,
                        Rng&             rng) noexcept {
    spread_init(weights, biases, fan_in, 1.f, rng);
}

}  // namespace nisps::ml
