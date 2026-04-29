// nisps/ml/loss.hpp — MSE loss with a deliberate fix for the meml-ues
// double-scaling bug.
//
// THE BUG (in `src/memlp/Loss.h::MSE` and `src/memlp/MLP.cpp::Train`):
//   The legacy MSE computed loss as
//       sum((diff^2) / NOut) * sampleSizeReciprocal       in Loss.h
//   and then `Train()` did
//       current_iteration_cost_function *= sampleSizeReciprocal;  // ← second
//   So the unweighted average loss was scaled by 1/N twice — once in MSE()
//   and once in the outer training loop. Loss values for the same training
//   set get reported 1/N too small, which is misleading for diagnostics.
//
// THE FIX:
//   Loss is computed PER-SAMPLE here. The training loop is responsible for
//   averaging across samples once. There is no implicit per-sample weight in
//   the MSE function — that is the caller's policy decision.
//
//   For a single sample: mse = (1/NOut) * sum_j (label_j - pred_j)^2
//   Derivative wrt pred_j: -(2/NOut) * (label_j - pred_j)
//
//   When sample weights are supplied to `train()` they are applied at the
//   sample level (loss_total = sum_i weight_i * mse_i), and the gradient
//   per-sample is scaled by weight_i. Sample weights must sum to 1.0 — the
//   caller normalizes (matches legacy contract).

#pragma once

#include <cstddef>
#include <span>

#include "../core/perf.hpp"

namespace nisps::ml {

// Compute MSE loss for one sample and write the per-output derivative into
// `loss_deriv`. Returns the scalar loss for this sample.
//
//   loss = (1/NOut) * sum_j (label_j - pred_j)^2
//   d(loss)/d(pred_j) = -(2/NOut) * (label_j - pred_j)
//
// `loss_deriv` and `pred` must both have size NOut. `label` likewise.
//
// NB: We deliberately do NOT multiply by any sampleSizeReciprocal here. The
// caller is responsible for averaging across samples (and scaling by sample
// weights, if any) — see training.hpp.
NISPS_FORCE_INLINE float mse_per_sample(std::span<const float> label,
                                        std::span<const float> pred,
                                        std::span<float>       loss_deriv) noexcept {
    const std::size_t n = pred.size();
    if (n == 0u) return 0.f;
    const float inv_n = 1.f / static_cast<float>(n);

    float accum = 0.f;
    for (std::size_t j = 0; j < n; ++j) {
        const float diff = label[j] - pred[j];                 // sign chosen so deriv is wrt pred
        accum += diff * diff * inv_n;
        loss_deriv[j] = -2.f * inv_n * diff;
    }
    return accum;
}

}  // namespace nisps::ml
