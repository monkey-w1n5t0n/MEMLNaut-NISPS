// nisps/ml/storage.hpp — storage policies for the MLP core (fixed flavour).
//
// The MLP algorithms (nisps/ml/mlp.hpp `MLPCore<Storage>`) are written ONCE
// against a storage concept; the storage supplies every dimension and every
// buffer. Two models exist:
//
//   * `FixedStorage<NIn, NH1, NH2, NH3, NOut, NMaxExamples, NMaxIterTrain>`
//     (this file) — all buffers are template-sized `std::array`, zero heap.
//     This is the firmware model; the classic
//     `MLP<...>` template is an alias over it and its compile-time constants
//     (`kInput`, `kHidden1..3`, `kOutput`, `weight_count()`) are preserved.
//
//   * `DynamicStorage` (nisps/ml/dynamic_storage.hpp) — dimensions chosen at
//     construction, one arena allocation, no allocation after construction.
//     Compile-time EXCLUDED from embedded builds (see NISPS_TARGET_EMBEDDED
//     in nisps/core/perf.hpp).
//
// STORAGE SURFACE (both models; L is the layer index 0..3)
//   dims:    n_in(), n_out(), fan_in_l<L>(), fan_out_l<L>(),
//            max_examples(), max_iter_train(), weight_count()
//   layers:  weights_l<L>(), biases_l<L>(), pre_act_l<L>(), act_l<L>(),
//            grad_w_l<L>(), grad_b_l<L>(),
//            sq_grad_w_l<L>(), sq_grad_b_l<L>()          [RMSProp running
//            squared-gradient averages, same shape as the gradient
//            accumulators — see nisps/ml/training.hpp],
//            delta_l<L>()                                [backprop scratch,
//            sized fan_in(L)], eval_act_l<L>()           [const-eval scratch,
//            sized fan_out(L), mutable]
//   global:  input_buf(), output_buf(), ds_features(), ds_labels(),
//            flat_buf(), loss_hist_buf(), copy_weights_to(dst)
//
// For `FixedStorage` every dim accessor is constexpr-foldable, so the
// algorithms compile to the same fully-unrolled/constant-bound code the old
// hand-fixed MLP produced (verified against the RP2350 `.text` budget —
// chokepoint B of docs/specs/plans/one-core-engine-refactor.md).
//
// Bit-parity contract: for identical shapes and seeds, MLPCore over
// FixedStorage and DynamicStorage must produce bit-identical results — the
// algorithm code is shared and the buffers are just memory. A ctest enforces
// this (tests/cpp/test_mlp_storage_parity.cpp).

#pragma once

#include <array>
#include <cstddef>
#include <span>

#include "../core/perf.hpp"

namespace nisps::ml {

inline constexpr std::size_t kMlpNumLayers = 4u;

// Default example-store capacity, named ONCE and shared by FixedStorage's
// compile-time default (below) and DynamicStorage's runtime-default
// constructor argument (nisps/ml/dynamic_storage.hpp). `nisps_ml_describe`
// (nisps/wasm/bindings.cpp) reports the live instance's max_examples() so
// the Manifold TS side (manifold/src/engine/wasm-iml.ts) can size its JS
// Dataset mirror to match instead of hardcoding a second, divergent number
// (see docs/specs/recon/simplification-audit-2026-07.md S35).
inline constexpr std::size_t kDefaultMaxExamples = 128u;

template <std::size_t NIn,
          std::size_t NHidden1,
          std::size_t NHidden2,
          std::size_t NHidden3,
          std::size_t NOut,
          std::size_t NMaxExamples  = kDefaultMaxExamples,
          std::size_t NMaxIterTrain = 4096u>
class FixedStorage {
   public:
    static constexpr std::size_t kInput        = NIn;
    static constexpr std::size_t kHidden1      = NHidden1;
    static constexpr std::size_t kHidden2      = NHidden2;
    static constexpr std::size_t kHidden3      = NHidden3;
    static constexpr std::size_t kOutput       = NOut;
    static constexpr std::size_t kMaxExamples  = NMaxExamples;
    static constexpr std::size_t kMaxIterTrain = NMaxIterTrain;
    static constexpr std::size_t kNumLayers    = kMlpNumLayers;

    static constexpr std::size_t weight_count() noexcept {
        return NIn * NHidden1 + NHidden1 * NHidden2 + NHidden2 * NHidden3 + NHidden3 * NOut
             + NHidden1 + NHidden2 + NHidden3 + NOut;
    }

    // ---- dims -----------------------------------------------------------
    static constexpr std::size_t n_in()           noexcept { return NIn; }
    static constexpr std::size_t n_out()          noexcept { return NOut; }
    static constexpr std::size_t max_examples()   noexcept { return NMaxExamples; }
    static constexpr std::size_t max_iter_train() noexcept { return NMaxIterTrain; }

    template <std::size_t L>
    static constexpr std::size_t fan_in_l() noexcept {
        static_assert(L < kNumLayers);
        if constexpr (L == 0u) return NIn;
        else if constexpr (L == 1u) return NHidden1;
        else if constexpr (L == 2u) return NHidden2;
        else return NHidden3;
    }
    template <std::size_t L>
    static constexpr std::size_t fan_out_l() noexcept {
        static_assert(L < kNumLayers);
        if constexpr (L == 0u) return NHidden1;
        else if constexpr (L == 1u) return NHidden2;
        else if constexpr (L == 2u) return NHidden3;
        else return NOut;
    }

    // ---- per-layer buffers ------------------------------------------------
    template <std::size_t L> NISPS_FORCE_INLINE std::span<float> weights_l() noexcept {
        if constexpr (L == 0u) return w0_; else if constexpr (L == 1u) return w1_;
        else if constexpr (L == 2u) return w2_; else return w3_;
    }
    template <std::size_t L> NISPS_FORCE_INLINE std::span<const float> weights_l() const noexcept {
        if constexpr (L == 0u) return w0_; else if constexpr (L == 1u) return w1_;
        else if constexpr (L == 2u) return w2_; else return w3_;
    }
    template <std::size_t L> NISPS_FORCE_INLINE std::span<float> biases_l() noexcept {
        if constexpr (L == 0u) return b0_; else if constexpr (L == 1u) return b1_;
        else if constexpr (L == 2u) return b2_; else return b3_;
    }
    template <std::size_t L> NISPS_FORCE_INLINE std::span<const float> biases_l() const noexcept {
        if constexpr (L == 0u) return b0_; else if constexpr (L == 1u) return b1_;
        else if constexpr (L == 2u) return b2_; else return b3_;
    }
    template <std::size_t L> NISPS_FORCE_INLINE std::span<float> pre_act_l() noexcept {
        if constexpr (L == 0u) return pa0_; else if constexpr (L == 1u) return pa1_;
        else if constexpr (L == 2u) return pa2_; else return pa3_;
    }
    template <std::size_t L> NISPS_FORCE_INLINE std::span<float> act_l() noexcept {
        if constexpr (L == 0u) return a0_; else if constexpr (L == 1u) return a1_;
        else if constexpr (L == 2u) return a2_; else return a3_;
    }
    template <std::size_t L> NISPS_FORCE_INLINE std::span<const float> act_l() const noexcept {
        if constexpr (L == 0u) return a0_; else if constexpr (L == 1u) return a1_;
        else if constexpr (L == 2u) return a2_; else return a3_;
    }
    template <std::size_t L> NISPS_FORCE_INLINE std::span<float> grad_w_l() noexcept {
        if constexpr (L == 0u) return gw0_; else if constexpr (L == 1u) return gw1_;
        else if constexpr (L == 2u) return gw2_; else return gw3_;
    }
    template <std::size_t L> NISPS_FORCE_INLINE std::span<float> grad_b_l() noexcept {
        if constexpr (L == 0u) return gb0_; else if constexpr (L == 1u) return gb1_;
        else if constexpr (L == 2u) return gb2_; else return gb3_;
    }
    // RMSProp running squared-gradient averages (training.hpp). Optimiser
    // state, not model state: excluded from weight_count()/copy_weights_to().
    template <std::size_t L> NISPS_FORCE_INLINE std::span<float> sq_grad_w_l() noexcept {
        if constexpr (L == 0u) return sw0_; else if constexpr (L == 1u) return sw1_;
        else if constexpr (L == 2u) return sw2_; else return sw3_;
    }
    template <std::size_t L> NISPS_FORCE_INLINE std::span<float> sq_grad_b_l() noexcept {
        if constexpr (L == 0u) return sb0_; else if constexpr (L == 1u) return sb1_;
        else if constexpr (L == 2u) return sb2_; else return sb3_;
    }
    // Backprop scratch (delta into layer L's input), sized fan_in(L).
    template <std::size_t L> NISPS_FORCE_INLINE std::span<float> delta_l() noexcept {
        if constexpr (L == 0u) return d0_; else if constexpr (L == 1u) return d1_;
        else if constexpr (L == 2u) return d2_; else return d3_;
    }
    // Const-eval scratch (activation of layer L), sized fan_out(L). Mutable
    // so `eval_loss() const` can run the shared forward code without touching
    // the real activation caches.
    template <std::size_t L> NISPS_FORCE_INLINE std::span<float> eval_act_l() const noexcept {
        if constexpr (L == 0u) return e0_; else if constexpr (L == 1u) return e1_;
        else if constexpr (L == 2u) return e2_; else return e3_;
    }

    // ---- global buffers ---------------------------------------------------
    NISPS_FORCE_INLINE std::span<float>       input_buf()        noexcept { return input_; }
    NISPS_FORCE_INLINE std::span<const float> input_buf()  const noexcept { return input_; }
    NISPS_FORCE_INLINE std::span<float>       output_buf()       noexcept { return output_; }
    NISPS_FORCE_INLINE std::span<const float> output_buf() const noexcept { return output_; }
    NISPS_FORCE_INLINE std::span<float>       ds_features()      noexcept { return dsf_; }
    NISPS_FORCE_INLINE std::span<const float> ds_features() const noexcept { return dsf_; }
    NISPS_FORCE_INLINE std::span<float>       ds_labels()        noexcept { return dsl_; }
    NISPS_FORCE_INLINE std::span<const float> ds_labels()  const noexcept { return dsl_; }
    NISPS_FORCE_INLINE std::span<float>       flat_buf()         noexcept { return flat_; }
    NISPS_FORCE_INLINE std::span<float>       loss_hist_buf()    noexcept { return lh_; }
    NISPS_FORCE_INLINE std::span<const float> loss_hist_buf() const noexcept { return lh_; }

    // Copies the live weights+biases directly into `dst` in the same flat
    // layout as MLPCore::get_weights() (weights layer-major, then biases
    // layer-major) — but writes straight from the layer buffers, with no
    // intermediate flat_/flat_buf() hop. `dst` must be at least
    // weight_count() long. Lets a caller that only needs a transient copy
    // (feedback.hpp's snapshot/undo/nudge ops) take a single copy instead of
    // double-copying through get_weights()'s scratch buffer.
    void copy_weights_to(std::span<float> dst) const noexcept {
        std::size_t k = 0u;
        for (float v : weights_l<0u>()) dst[k++] = v;
        for (float v : weights_l<1u>()) dst[k++] = v;
        for (float v : weights_l<2u>()) dst[k++] = v;
        for (float v : weights_l<3u>()) dst[k++] = v;
        for (float v : biases_l<0u>())  dst[k++] = v;
        for (float v : biases_l<1u>())  dst[k++] = v;
        for (float v : biases_l<2u>())  dst[k++] = v;
        for (float v : biases_l<3u>())  dst[k++] = v;
    }

   private:
    std::array<float, NIn * NHidden1>      w0_{};
    std::array<float, NHidden1 * NHidden2> w1_{};
    std::array<float, NHidden2 * NHidden3> w2_{};
    std::array<float, NHidden3 * NOut>     w3_{};
    std::array<float, NHidden1> b0_{};
    std::array<float, NHidden2> b1_{};
    std::array<float, NHidden3> b2_{};
    std::array<float, NOut>     b3_{};
    std::array<float, NHidden1> pa0_{};
    std::array<float, NHidden2> pa1_{};
    std::array<float, NHidden3> pa2_{};
    std::array<float, NOut>     pa3_{};
    std::array<float, NHidden1> a0_{};
    std::array<float, NHidden2> a1_{};
    std::array<float, NHidden3> a2_{};
    std::array<float, NOut>     a3_{};
    std::array<float, NIn * NHidden1>      gw0_{};
    std::array<float, NHidden1 * NHidden2> gw1_{};
    std::array<float, NHidden2 * NHidden3> gw2_{};
    std::array<float, NHidden3 * NOut>     gw3_{};
    std::array<float, NHidden1> gb0_{};
    std::array<float, NHidden2> gb1_{};
    std::array<float, NHidden3> gb2_{};
    std::array<float, NOut>     gb3_{};
    std::array<float, NIn * NHidden1>      sw0_{};
    std::array<float, NHidden1 * NHidden2> sw1_{};
    std::array<float, NHidden2 * NHidden3> sw2_{};
    std::array<float, NHidden3 * NOut>     sw3_{};
    std::array<float, NHidden1> sb0_{};
    std::array<float, NHidden2> sb1_{};
    std::array<float, NHidden3> sb2_{};
    std::array<float, NOut>     sb3_{};
    std::array<float, NIn>      d0_{};
    std::array<float, NHidden1> d1_{};
    std::array<float, NHidden2> d2_{};
    std::array<float, NHidden3> d3_{};
    mutable std::array<float, NHidden1> e0_{};
    mutable std::array<float, NHidden2> e1_{};
    mutable std::array<float, NHidden3> e2_{};
    mutable std::array<float, NOut>     e3_{};

    std::array<float, NIn>  input_{};
    std::array<float, NOut> output_{};

    std::array<float, NMaxExamples * NIn>  dsf_{};
    std::array<float, NMaxExamples * NOut> dsl_{};

    std::array<float, weight_count()> flat_{};
    std::array<float, NMaxIterTrain>  lh_{};
};

}  // namespace nisps::ml
