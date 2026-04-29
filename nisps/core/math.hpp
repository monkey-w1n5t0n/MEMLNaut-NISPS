// nisps/core/math.hpp — small math helpers used by the audio path, the ML
// activations and the parameter curve mapping.
//
// CONTRACT WITH TYPESCRIPT (stream 5)
// The `Curve` enum below is mirrored in `playground/src/output/curves.ts`. The
// numeric meaning of each variant must stay identical so a parameter routed
// through firmware and a parameter routed through the browser produce the
// same value. JSON schemas reference curves by string name, so the source of
// truth for the *names* lives in the schema validator, but the *math* lives
// here. Golden-vector tests in `tests/cpp/parity_check.cpp` (stream 11)
// will pin this down.

#pragma once

#include <cmath>

namespace nisps {

inline float clamp01(float x) noexcept {
    if (x < 0.f) return 0.f;
    if (x > 1.f) return 1.f;
    return x;
}

inline float clamp(float x, float lo, float hi) noexcept {
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
}

// fast_sigmoid: 3rd-order rational approximation via the Padé-approximant of
// tanh. We use the identity sigmoid(x) = 0.5 + 0.5 * tanh(x/2), and approx
//     tanh(u) ≈ u * (27 + u²) / (27 + 9u²)
// which is the (3,2)-Padé expansion of tanh around 0.
//
// Max error vs true logistic 1/(1+e^-x) over x ∈ [-6, 6]: ≈ 0.012 (~1.2%).
// Outside that range the approximation drifts, so we clamp to [0, 1].
//
// For the ML output activation we need monotonic, smooth, bounded — NOT
// log-likelihood-grade accuracy. The MLP can opt into either fast_sigmoid
// or exp-based exact_sigmoid; both are provided.
inline float fast_sigmoid(float x) noexcept {
    const float u  = x * 0.5f;
    const float u2 = u * u;
    const float t  = u * (27.f + u2) / (27.f + 9.f * u2);
    const float y  = 0.5f + 0.5f * t;
    if (y < 0.f) return 0.f;
    if (y > 1.f) return 1.f;
    return y;
}

// True sigmoid via std::exp. Exact, slower; provided so callers that need
// gradient-correct activations have a path that avoids the ~1.8% bias.
inline float exact_sigmoid(float x) noexcept {
    // Guard against extreme inputs to avoid expf overflow / underflow noise.
    if (x >  40.f) return 1.f;
    if (x < -40.f) return 0.f;
    return 1.f / (1.f + std::exp(-x));
}

// Approximate exp via the limit (1 + x/n)^n with n=256. Good to ~0.5% over
// x∈[-4, 4]; falls apart outside that range. Only use where exp is on the
// hot path AND inputs are bounded — otherwise reach for std::exp.
inline float fast_exp(float x) noexcept {
    float r = 1.f + x * (1.f / 256.f);
    r *= r; r *= r; r *= r; r *= r;
    r *= r; r *= r; r *= r; r *= r;     // 8 squarings ⇒ ^256
    return r;
}

// ---------------------------------------------------------------------------
// Curve catalog. Each curve maps [0,1] → [0,1], monotone increasing, with
// the endpoints fixed at 0 and 1. The caller is responsible for clamping the
// input — apply_curve assumes x is already in range.
// ---------------------------------------------------------------------------
enum class Curve : int {
    linear  = 0,
    exp     = 1,
    log     = 2,
    square  = 3,
    sqrt    = 4,
    sigmoid = 5,
    cubic   = 6,
};

inline float apply_curve(Curve c, float x) noexcept {
    switch (c) {
        case Curve::linear:  return x;
        case Curve::exp:     // (e^x - 1) / (e - 1) — concave-up, slow start
                             return (std::exp(x) - 1.f) * (1.f / 1.71828182845904523536f);
        case Curve::log:     // log(1 + (e-1) x) — concave-down, fast start
                             return std::log(1.f + 1.71828182845904523536f * x);
        case Curve::square:  return x * x;
        case Curve::sqrt:    return std::sqrt(x);
        case Curve::sigmoid: {
            // S-curve through (0,0) and (1,1). Stretch logistic and rescale.
            const float k = 6.f;                // slope at midpoint
            const float s = exact_sigmoid(k * (x - 0.5f));
            const float s0 = exact_sigmoid(-k * 0.5f);
            const float s1 = exact_sigmoid( k * 0.5f);
            return (s - s0) / (s1 - s0);
        }
        case Curve::cubic:   return x * x * x;
    }
    return x;  // unreachable, silences -Wreturn-type
}

}  // namespace nisps
