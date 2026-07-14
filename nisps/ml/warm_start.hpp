// nisps/ml/warm_start.hpp — copy overlapping weights between two MLPs of
// (possibly) different shapes.
//
// Used by the runtime-reshape path (one-core-engine-refactor P2): reshape =
// construct a NEW instance at the new dimensions, then warm-start it by
// copying every weight/bias whose (layer, node, input) coordinate exists in
// BOTH shapes. Weights outside the overlap keep the destination's fresh
// initialisation. Deterministic, allocation-free, works across storage
// policies (fixed→dynamic, dynamic→dynamic, fixed→fixed).
//
// Row-major layout per layer: w[node * fan_in + j]. The overlap is the
// top-left submatrix min(fan_out) × min(fan_in) plus the bias prefix
// min(fan_out).

#pragma once

#include <cstddef>
#include <span>

#include "../core/perf.hpp"

namespace nisps::ml {

namespace detail {

template <std::size_t L, typename DstMLP, typename SrcMLP>
NISPS_FORCE_INLINE void warm_start_copy_layer(DstMLP& dst, const SrcMLP& src) noexcept {
    const std::size_t src_in  = src.template fan_in_l<L>();
    const std::size_t src_out = src.template fan_out_l<L>();
    const std::size_t dst_in  = dst.template fan_in_l<L>();
    const std::size_t dst_out = dst.template fan_out_l<L>();
    const std::size_t n_in  = (src_in < dst_in) ? src_in : dst_in;
    const std::size_t n_out = (src_out < dst_out) ? src_out : dst_out;

    std::span<const float> sw = src.template weights_l<L>();
    std::span<float>       dw = dst.template weights_l<L>();
    for (std::size_t node = 0; node < n_out; ++node) {
        const std::size_t src_row = node * src_in;
        const std::size_t dst_row = node * dst_in;
        for (std::size_t j = 0; j < n_in; ++j) {
            dw[dst_row + j] = sw[src_row + j];
        }
    }

    std::span<const float> sb = src.template biases_l<L>();
    std::span<float>       db = dst.template biases_l<L>();
    for (std::size_t node = 0; node < n_out; ++node) {
        db[node] = sb[node];
    }
}

}  // namespace detail

// Copy the overlapping region of every layer from `src` into `dst`. Both
// must expose the MLP storage surface (fan_in_l/fan_out_l/weights_l/
// biases_l) — i.e. any MLPCore instantiation.
template <typename DstMLP, typename SrcMLP>
inline void warm_start_copy(DstMLP& dst, const SrcMLP& src) noexcept {
    detail::warm_start_copy_layer<0u>(dst, src);
    detail::warm_start_copy_layer<1u>(dst, src);
    detail::warm_start_copy_layer<2u>(dst, src);
    detail::warm_start_copy_layer<3u>(dst, src);
}

}  // namespace nisps::ml
