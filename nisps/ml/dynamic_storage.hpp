// nisps/ml/dynamic_storage.hpp — runtime-shaped storage policy for the MLP
// core. WASM / native-test / VCV targets ONLY.
//
// Dimensions are chosen at construction; every buffer lives in ONE arena
// allocated once in the constructor. There is NO allocation after
// construction — the algorithm hot paths are as allocation-free as the
// fixed model.
//
// This header is compile-time excluded from embedded (RP2350) builds: the
// firmware's zero-heap contract is structural, not advisory. lint-cpp.sh
// additionally allowlists exactly this file for its heap audit — heap use
// anywhere else under nisps/ml/ still fails the lint.
//
// See nisps/ml/storage.hpp for the storage surface contract, and
// docs/specs/plans/one-core-engine-refactor.md §P2 for the design.

#pragma once

#include "../core/perf.hpp"

#if defined(NISPS_TARGET_EMBEDDED)
#error "nisps/ml/dynamic_storage.hpp must not be compiled for the RP2350 target (zero-heap contract)"
#endif

#include <cstddef>
#include <cstdint>
#include <new>
#include <span>

#include "storage.hpp"  // kMlpNumLayers

namespace nisps::ml {

class DynamicStorage {
   public:
    static constexpr std::size_t kNumLayers = kMlpNumLayers;

    // hidden must have exactly 3 entries (the 4-layer topology is fixed;
    // only the dimensions are runtime). All dims must be >= 1.
    DynamicStorage(std::size_t n_in,
                   std::span<const std::size_t> hidden,
                   std::size_t n_out,
                   std::size_t max_examples  = 128u,
                   std::size_t max_iter_train = 4096u) noexcept {
        if (hidden.size() != 3u || n_in == 0u || n_out == 0u ||
            hidden[0] == 0u || hidden[1] == 0u || hidden[2] == 0u) {
            return;  // stays invalid
        }
        dims_[0] = n_in;
        dims_[1] = hidden[0];
        dims_[2] = hidden[1];
        dims_[3] = hidden[2];
        dims_[4] = n_out;
        max_ex_   = max_examples;
        max_iter_ = max_iter_train;

        std::size_t total = 0u;
        auto claim = [&total](std::size_t n) {
            const std::size_t off = total;
            total += n;
            return off;
        };
        for (std::size_t l = 0; l < kNumLayers; ++l) {
            off_w_[l]  = claim(fan_in(l) * fan_out(l));
            off_b_[l]  = claim(fan_out(l));
            off_pa_[l] = claim(fan_out(l));
            off_a_[l]  = claim(fan_out(l));
            off_gw_[l] = claim(fan_in(l) * fan_out(l));
            off_gb_[l] = claim(fan_out(l));
            off_d_[l]  = claim(fan_in(l));
            off_e_[l]  = claim(fan_out(l));
        }
        off_input_  = claim(dims_[0]);
        off_output_ = claim(dims_[4]);
        off_dsf_    = claim(max_ex_ * dims_[0]);
        off_dsl_    = claim(max_ex_ * dims_[4]);
        off_flat_   = claim(weight_count());
        off_lh_     = claim(max_iter_);

        // The single arena allocation. Value-init zeroes it, matching the
        // zero-initialised std::array members of FixedStorage.
        arena_ = new (std::nothrow) float[total]();
        total_ = (arena_ != nullptr) ? total : 0u;
    }

    ~DynamicStorage() { delete[] arena_; }

    DynamicStorage(const DynamicStorage&)            = delete;
    DynamicStorage& operator=(const DynamicStorage&) = delete;
    DynamicStorage(DynamicStorage&& o) noexcept { move_from_(o); }
    DynamicStorage& operator=(DynamicStorage&& o) noexcept {
        if (this != &o) {
            delete[] arena_;
            move_from_(o);
        }
        return *this;
    }

    bool valid() const noexcept { return arena_ != nullptr; }

    // ---- dims -----------------------------------------------------------
    std::size_t n_in()           const noexcept { return dims_[0]; }
    std::size_t n_out()          const noexcept { return dims_[4]; }
    std::size_t max_examples()   const noexcept { return max_ex_; }
    std::size_t max_iter_train() const noexcept { return max_iter_; }

    std::size_t fan_in(std::size_t l)  const noexcept { return dims_[l]; }
    std::size_t fan_out(std::size_t l) const noexcept { return dims_[l + 1u]; }

    template <std::size_t L> std::size_t fan_in_l()  const noexcept { return dims_[L]; }
    template <std::size_t L> std::size_t fan_out_l() const noexcept { return dims_[L + 1u]; }

    std::size_t weight_count() const noexcept {
        return dims_[0] * dims_[1] + dims_[1] * dims_[2] + dims_[2] * dims_[3] +
               dims_[3] * dims_[4] + dims_[1] + dims_[2] + dims_[3] + dims_[4];
    }

    // ---- per-layer buffers ------------------------------------------------
    template <std::size_t L> std::span<float> weights_l() noexcept {
        return {arena_ + off_w_[L], fan_in_l<L>() * fan_out_l<L>()};
    }
    template <std::size_t L> std::span<const float> weights_l() const noexcept {
        return {arena_ + off_w_[L], fan_in_l<L>() * fan_out_l<L>()};
    }
    template <std::size_t L> std::span<float> biases_l() noexcept {
        return {arena_ + off_b_[L], fan_out_l<L>()};
    }
    template <std::size_t L> std::span<const float> biases_l() const noexcept {
        return {arena_ + off_b_[L], fan_out_l<L>()};
    }
    template <std::size_t L> std::span<float> pre_act_l() noexcept {
        return {arena_ + off_pa_[L], fan_out_l<L>()};
    }
    template <std::size_t L> std::span<float> act_l() noexcept {
        return {arena_ + off_a_[L], fan_out_l<L>()};
    }
    template <std::size_t L> std::span<const float> act_l() const noexcept {
        return {arena_ + off_a_[L], fan_out_l<L>()};
    }
    template <std::size_t L> std::span<float> grad_w_l() noexcept {
        return {arena_ + off_gw_[L], fan_in_l<L>() * fan_out_l<L>()};
    }
    template <std::size_t L> std::span<float> grad_b_l() noexcept {
        return {arena_ + off_gb_[L], fan_out_l<L>()};
    }
    template <std::size_t L> std::span<float> delta_l() noexcept {
        return {arena_ + off_d_[L], fan_in_l<L>()};
    }
    template <std::size_t L> std::span<float> eval_act_l() const noexcept {
        return {arena_ + off_e_[L], fan_out_l<L>()};
    }

    // ---- global buffers ---------------------------------------------------
    std::span<float>       input_buf()        noexcept { return {arena_ + off_input_, dims_[0]}; }
    std::span<const float> input_buf()  const noexcept { return {arena_ + off_input_, dims_[0]}; }
    std::span<float>       output_buf()       noexcept { return {arena_ + off_output_, dims_[4]}; }
    std::span<const float> output_buf() const noexcept { return {arena_ + off_output_, dims_[4]}; }
    std::span<float>       ds_features()      noexcept { return {arena_ + off_dsf_, max_ex_ * dims_[0]}; }
    std::span<const float> ds_features() const noexcept { return {arena_ + off_dsf_, max_ex_ * dims_[0]}; }
    std::span<float>       ds_labels()        noexcept { return {arena_ + off_dsl_, max_ex_ * dims_[4]}; }
    std::span<const float> ds_labels()  const noexcept { return {arena_ + off_dsl_, max_ex_ * dims_[4]}; }
    std::span<float>       flat_buf()         noexcept { return {arena_ + off_flat_, weight_count()}; }
    std::span<float>       loss_hist_buf()    noexcept { return {arena_ + off_lh_, max_iter_}; }
    std::span<const float> loss_hist_buf() const noexcept { return {arena_ + off_lh_, max_iter_}; }

   private:
    void move_from_(DynamicStorage& o) noexcept {
        for (std::size_t i = 0; i < 5u; ++i) dims_[i] = o.dims_[i];
        max_ex_ = o.max_ex_; max_iter_ = o.max_iter_;
        for (std::size_t l = 0; l < kNumLayers; ++l) {
            off_w_[l] = o.off_w_[l];   off_b_[l] = o.off_b_[l];
            off_pa_[l] = o.off_pa_[l]; off_a_[l] = o.off_a_[l];
            off_gw_[l] = o.off_gw_[l]; off_gb_[l] = o.off_gb_[l];
            off_d_[l] = o.off_d_[l];   off_e_[l] = o.off_e_[l];
        }
        off_input_ = o.off_input_; off_output_ = o.off_output_;
        off_dsf_ = o.off_dsf_; off_dsl_ = o.off_dsl_;
        off_flat_ = o.off_flat_; off_lh_ = o.off_lh_;
        arena_ = o.arena_; total_ = o.total_;
        o.arena_ = nullptr; o.total_ = 0u;
    }

    std::size_t dims_[5]  = {0u, 0u, 0u, 0u, 0u};
    std::size_t max_ex_   = 0u;
    std::size_t max_iter_ = 0u;
    std::size_t off_w_[kNumLayers]{}, off_b_[kNumLayers]{}, off_pa_[kNumLayers]{},
                off_a_[kNumLayers]{}, off_gw_[kNumLayers]{}, off_gb_[kNumLayers]{},
                off_d_[kNumLayers]{}, off_e_[kNumLayers]{};
    std::size_t off_input_ = 0u, off_output_ = 0u, off_dsf_ = 0u, off_dsl_ = 0u,
                off_flat_ = 0u, off_lh_ = 0u;
    float*      arena_ = nullptr;
    std::size_t total_ = 0u;
};

// ---------------------------------------------------------------------------
// Runtime-sized feedback-controller storage (see nisps/ml/feedback.hpp for
// the surface contract). One arena allocation at construction; nothing
// per-call. The focus mask lives in a byte region carved from the same
// arena (aliased through the float arena's tail, kept byte-aligned by
// allocating whole floats for it).
// ---------------------------------------------------------------------------
class DynamicFeedbackStorage {
   public:
    DynamicFeedbackStorage(std::size_t n_out,
                           std::size_t n_weights,
                           std::size_t undo_depth = 4u) noexcept
        : n_out_(n_out), n_weights_(n_weights), undo_cap_(undo_depth) {
        if (n_out == 0u || n_weights == 0u || undo_depth == 0u) return;
        // float regions: static_out, placed_out, snapshot, scratch, undo ring
        // byte region: focus mask (n_out bytes, rounded up to whole floats)
        const std::size_t focus_floats = (n_out + sizeof(float) - 1u) / sizeof(float);
        const std::size_t total = n_out * 2u                 // static_out + placed_out
                                + n_weights * 2u             // snapshot + scratch
                                + n_weights * undo_depth     // undo ring
                                + focus_floats;
        arena_ = new (std::nothrow) float[total]();
        if (!arena_) return;
        off_placed_  = n_out_;
        off_snap_    = off_placed_ + n_out_;
        off_scratch_ = off_snap_ + n_weights_;
        off_undo_    = off_scratch_ + n_weights_;
        off_focus_   = off_undo_ + n_weights_ * undo_cap_;
    }

    ~DynamicFeedbackStorage() { delete[] arena_; }

    DynamicFeedbackStorage(const DynamicFeedbackStorage&)            = delete;
    DynamicFeedbackStorage& operator=(const DynamicFeedbackStorage&) = delete;
    DynamicFeedbackStorage(DynamicFeedbackStorage&& o) noexcept { move_from_(o); }
    DynamicFeedbackStorage& operator=(DynamicFeedbackStorage&& o) noexcept {
        if (this != &o) {
            delete[] arena_;
            move_from_(o);
        }
        return *this;
    }

    bool valid() const noexcept { return arena_ != nullptr; }

    std::size_t n_out()     const noexcept { return n_out_; }
    std::size_t n_weights() const noexcept { return n_weights_; }
    std::size_t undo_cap()  const noexcept { return undo_cap_; }

    std::span<float>       static_out()       noexcept { return {arena_, n_out_}; }
    std::span<const float> static_out() const noexcept { return {arena_, n_out_}; }
    std::span<float>       placed_out()       noexcept { return {arena_ + off_placed_, n_out_}; }
    std::span<const float> placed_out() const noexcept { return {arena_ + off_placed_, n_out_}; }
    std::span<float>       snapshot()         noexcept { return {arena_ + off_snap_, n_weights_}; }
    std::span<const float> snapshot()   const noexcept { return {arena_ + off_snap_, n_weights_}; }
    std::span<float>       scratch_buf()      noexcept { return {arena_ + off_scratch_, n_weights_}; }
    std::span<float> undo_slot(std::size_t i) noexcept {
        return {arena_ + off_undo_ + i * n_weights_, n_weights_};
    }
    std::span<const float> undo_slot(std::size_t i) const noexcept {
        return {arena_ + off_undo_ + i * n_weights_, n_weights_};
    }
    std::span<std::uint8_t> focus() noexcept {
        return {reinterpret_cast<std::uint8_t*>(arena_ + off_focus_), n_out_};
    }
    std::span<const std::uint8_t> focus() const noexcept {
        return {reinterpret_cast<const std::uint8_t*>(arena_ + off_focus_), n_out_};
    }

   private:
    void move_from_(DynamicFeedbackStorage& o) noexcept {
        n_out_ = o.n_out_; n_weights_ = o.n_weights_; undo_cap_ = o.undo_cap_;
        off_placed_ = o.off_placed_; off_snap_ = o.off_snap_;
        off_scratch_ = o.off_scratch_; off_undo_ = o.off_undo_; off_focus_ = o.off_focus_;
        arena_ = o.arena_;
        o.arena_ = nullptr;
    }

    std::size_t n_out_ = 0u, n_weights_ = 0u, undo_cap_ = 0u;
    std::size_t off_placed_ = 0u, off_snap_ = 0u, off_scratch_ = 0u,
                off_undo_ = 0u, off_focus_ = 0u;
    float*      arena_ = nullptr;
};

}  // namespace nisps::ml
