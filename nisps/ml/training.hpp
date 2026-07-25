// nisps/ml/training.hpp — gradient clipping and the RMSProp weight update.
//
// The MLP class owns the training loop because it knows the dataset layout
// and weight buffers. This header provides the pieces that are pure scalar
// arithmetic over one accumulated gradient:
//   - kGradClip:        ±10.0, matches upstream Layer.h's gradientClipValue.
//   - clip_gradient():  scalar clipper, applied before the update.
//   - rmsprop_step():   the optimiser step — returns the amount to SUBTRACT
//                       from the weight and advances that weight's running
//                       squared-gradient average in place.
//
// The full training loop (forward, loss, backprop, weight update) is
// implemented inline in mlp.hpp because everything it touches is either a
// member array or layer-templated. Splitting it across translation units
// would require type-erasing the layers, which we don't want.
//
// OPTIMISER: RMSProp, ported from upstream memlp `Layer.h`
// ---------------------------------------------------------------------
// (github.com/MusicallyEmbodiedML/memlp @ ea777502 — the commit
// MEMLNaut-NISPS `upstream/main` pins). Upstream applies RMSProp EVERYWHERE:
// `Layer.h:239 ApplyAccumulatedGradients`, the `m_sq_grad_avg` running
// average at `Layer.h:601`, `StaticMLP.h:268` "Mini-batch RMSProp training".
//
// This file previously shipped SGD only and called the difference an
// optimiser-choice research question. It was not one. RMSProp divides each
// step by the running gradient magnitude, so an upstream `lr` is a
// NORMALISED step size, whereas under SGD the same number multiplies the raw
// gradient. Every learning rate we ported from upstream — most visibly
// `feedback.hpp`'s `geo_lr_ = 0.001f  // upstream InterfaceRL.hpp:312` —
// therefore landed in an optimiser that interprets it completely
// differently, which is why the geometric dislike measured 5.1e-5 of
// movement against an intended 0.5 (`tests/cpp/ml_bench.cpp` D1).
//
// The constants and the clamp order below are upstream's, exactly:
//   grad  = clip(accumulated_grad)                     (±10)
//   sq    = min(0.9*sq + 0.1*grad², 1e6)
//   adj   = min(lr / (sqrt(sq) + 1e-6), 1.0)
//   w    -= adj * grad
// Note the adjusted-LR clamp is one-sided, matching upstream's
// `std::min(adj_lr, maxAdjustedLR)`. A NEGATIVE lr (the "train away from
// this target" path in `MLPCore::train_targets`, used by the geometric
// dislike's cold-start fallback) is therefore left unclamped in magnitude,
// exactly as upstream leaves it.
//
// The per-weight squared-gradient average is new persistent STATE. It lives
// in the storage policy (`storage.hpp` FixedStorage / `dynamic_storage.hpp`
// DynamicStorage) alongside the gradient accumulators, so the firmware's
// zero-heap contract holds. It is optimiser state, not model state: it is
// NOT part of `weight_count()` / `get_weights()` / `set_weights()`, matching
// upstream, and `MLPCore::reset_optimizer_state()` (upstream
// `MLP<T>::ResetOptimizerState`) zeroes it.

#pragma once

#include <cmath>

#include "../core/perf.hpp"

namespace nisps::ml {

// Per-element gradient clip threshold. Matches upstream's gradientClipValue
// in Layer.h::ApplyAccumulatedGradients.
inline constexpr float kGradClip = 10.f;

// RMSProp constants — upstream Layer.h:242-244 and the local constants at
// the top of ApplyAccumulatedGradients.
inline constexpr float kRmsPropDecay    = 0.9f;
inline constexpr float kRmsPropDecayInv = 0.1f;
inline constexpr float kRmsPropEpsilon  = 1.e-6f;
inline constexpr float kMaxSqGradAvg    = 1.e6f;
inline constexpr float kMaxAdjustedLr   = 1.f;

NISPS_FORCE_INLINE float clip_gradient(float g) noexcept {
    if (g >  kGradClip) return  kGradClip;
    if (g < -kGradClip) return -kGradClip;
    return g;
}

// One RMSProp update for a single weight or bias. `sq_avg` is that element's
// running squared-gradient average and is advanced in place. Returns the
// value to SUBTRACT from the parameter (upstream writes `w -= adj_lr * g`).
NISPS_FORCE_INLINE float rmsprop_step(float grad, float& sq_avg, float lr) noexcept {
    const float g = clip_gradient(grad);

    float sq = (kRmsPropDecay * sq_avg) + (kRmsPropDecayInv * g * g);
    if (sq > kMaxSqGradAvg) sq = kMaxSqGradAvg;
    sq_avg = sq;

    float adj_lr = lr / (std::sqrt(sq) + kRmsPropEpsilon);
    if (adj_lr > kMaxAdjustedLr) adj_lr = kMaxAdjustedLr;  // one-sided, as upstream

    return adj_lr * g;
}

}  // namespace nisps::ml
