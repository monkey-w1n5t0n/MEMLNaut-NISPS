// nisps/ml/training.hpp — gradient-clipping helper and per-layer SGD update.
//
// The MLP class owns the training loop because it knows the dataset layout
// and weight buffers. This header provides:
//   - kGradClip:        ±10.0, matches the legacy firmware/Layer.h clamp.
//   - clip_gradient():  scalar clipper, applied to each accumulated gradient
//                       before the weight update.
//
// The full training loop (forward, loss, backprop, weight update) is
// implemented inline in mlp.hpp because everything it touches is either a
// member array or layer-templated. Splitting it across translation units
// would require type-erasing the layers, which we don't want.
//
// Optimizer choice: this MVP ships SGD only. RMSProp is planned (the legacy
// firmware uses it for `TrainBatch`) but the playground was using plain SGD
// until very recently and the XOR-convergence benchmark in the test suite
// is the clearer target. RMSProp can land as a follow-up — see the Ergo
// task notes. For now `train()` is SGD with optional sample-weight
// scaling and gradient clipping.

#pragma once

#include "../core/perf.hpp"

namespace nisps::ml {

// Per-element gradient clip threshold. Matches the legacy firmware's
// gradientClipValue in Layer.h::ApplyAccumulatedGradients.
inline constexpr float kGradClip = 10.f;

NISPS_FORCE_INLINE float clip_gradient(float g) noexcept {
    if (g >  kGradClip) return  kGradClip;
    if (g < -kGradClip) return -kGradClip;
    return g;
}

}  // namespace nisps::ml
