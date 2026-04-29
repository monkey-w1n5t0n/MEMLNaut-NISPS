// nisps/ml/activations.hpp — activation functions used by the MLP.
//
// Three activations are needed for the firmware default: ReLU (hidden layers),
// sigmoid (output layer), and tanh (alternative). Each entry exposes the
// activation and its derivative-given-pre-activation; we keep both around
// because the backprop path multiplies by the derivative of the
// pre-activation, which is cheaper to compute on the inner product than on
// the post-activation in some cases.
//
// Notes on the leak in ReLU:
//   The legacy firmware uses leaky ReLU with slope 0.01 everywhere it claims
//   to use "ReLU". We preserve that behavior for parity — a true zero-slope
//   ReLU would silently change training dynamics in ways that aren't
//   documented. The leak slope is a `static const float` so it lives in SRAM
//   per Chris's rule.
//
// Sigmoid:
//   We use the exact std::exp version here (NOT fast_sigmoid). The MLP
//   training loop multiplies by the sigmoid derivative, and the ~1.2% bias
//   in fast_sigmoid would compound during training. fast_sigmoid is fine for
//   inference-only paths but not for the gradient path. The ML output
//   activation is the place where we want monotonic-AND-accurate.
//
// All literals carry the .f suffix; constants used inside loops live in
// `static const float` so they are hoisted to SRAM on RP2350.

#pragma once

#include <cmath>

#include "../core/perf.hpp"

namespace nisps::ml {

// Match the legacy firmware leaky-ReLU slope. 0.01 matches PyTorch default
// and what `src/memlp/Utils.h::kReLUSlope` had before.
inline constexpr float kReluLeakSlope = 0.01f;

NISPS_FORCE_INLINE float relu(float x) noexcept {
    return (x > 0.f) ? x : kReluLeakSlope * x;
}
NISPS_FORCE_INLINE float relu_deriv_pre(float pre_activation) noexcept {
    return (pre_activation > 0.f) ? 1.f : kReluLeakSlope;
}

NISPS_FORCE_INLINE float sigmoid(float x) noexcept {
    // Saturate inputs to avoid expf overflow / underflow noise. Mirrors
    // nisps::exact_sigmoid clamps from core/math.hpp.
    if (x >  40.f) return 1.f;
    if (x < -40.f) return 0.f;
    return 1.f / (1.f + std::exp(-x));
}
NISPS_FORCE_INLINE float sigmoid_deriv_pre(float pre_activation) noexcept {
    const float s = sigmoid(pre_activation);
    return s * (1.f - s);
}

NISPS_FORCE_INLINE float tanh_act(float x) noexcept {
    return std::tanh(x);
}
NISPS_FORCE_INLINE float tanh_deriv_pre(float pre_activation) noexcept {
    const float t = std::tanh(pre_activation);
    return 1.f - t * t;
}

// Activation kind, dispatched at compile time per layer (see Layer template
// in mlp.hpp). We don't use a runtime tag because activation choice is
// architectural, not per-call.
enum class Activation : int {
    ReLU    = 0,
    Sigmoid = 1,
    Tanh    = 2,
};

template <Activation A>
NISPS_FORCE_INLINE float activate(float x) noexcept {
    if constexpr (A == Activation::ReLU)    return relu(x);
    if constexpr (A == Activation::Sigmoid) return sigmoid(x);
    if constexpr (A == Activation::Tanh)    return tanh_act(x);
    return x;  // unreachable
}

template <Activation A>
NISPS_FORCE_INLINE float activate_deriv_pre(float pre) noexcept {
    if constexpr (A == Activation::ReLU)    return relu_deriv_pre(pre);
    if constexpr (A == Activation::Sigmoid) return sigmoid_deriv_pre(pre);
    if constexpr (A == Activation::Tanh)    return tanh_deriv_pre(pre);
    return 1.f;  // unreachable
}

}  // namespace nisps::ml
