// nisps/ml/mlp.hpp — four-layer MLP (three hidden + output), written ONCE
// against a storage policy (docs/specs/plans/one-core-engine-refactor.md P2).
//
// ARCHITECTURE
//   MLPCore<Storage>
//   ┌──────┐  Linear+Bias   ┌────────┐  ReLU   ┌────────┐  ReLU   ┌────────┐  Sigmoid
//   │ NIn  │ ─────────────▶ │ NH1    │ ──────▶ │ NH2    │ ──────▶ │ NH3    │ ──────▶ NOut
//   └──────┘                └────────┘         └────────┘         └────────┘
//   Layer 0 (NIn  → NH1)  ReLU
//   Layer 1 (NH1  → NH2)  ReLU
//   Layer 2 (NH2  → NH3)  ReLU
//   Layer 3 (NH3  → NOut) Sigmoid
//
// The topology (4 layers, ReLU×3 + Sigmoid) is fixed; the DIMENSIONS come
// from the storage policy:
//
//   * `MLP<NIn, NH1, NH2, NH3, NOut, NMaxExamples, NMaxIterTrain>` — alias
//     over `MLPCore<FixedStorage<...>>`. All buffers template-sized
//     std::array, zero heap. This is the firmware model and preserves the
//     pre-P2 class's exact compile-time surface (`kInput`, `kHidden1..3`,
//     `kOutput`, `kNumLayers`, `weight_count()` — all constexpr).
//   * `MLPCore<DynamicStorage>` — runtime-shaped (WASM/native-test/VCV
//     only; heap at construction time, never per-call). Compile-time
//     excluded from RP2350 builds.
//
// BIT-PARITY CONTRACT: for identical shapes and seeds the two storage models
// produce bit-identical results — the algorithm code below is shared and
// float op order is storage-independent. Enforced by
// tests/cpp/test_mlp_storage_parity.cpp.
//
// FLAT WEIGHT LAYOUT (`get_weights` / `set_weights`)
//   [layer0_weights ...] [layer1_weights ...] [layer2_weights ...] [layer3_weights ...]
//   [layer0_biases  ...] [layer1_biases  ...] [layer2_biases  ...] [layer3_biases  ...]
//
// CONCEPT SATISFACTION
//   The class satisfies `nisps::MLEngine`: set_input, process, outputs,
//   add_example, train (no-arg overload returning float), move_weights,
//   draw_weights, reset, seed. Plus diagnostics: eval_loss, layer_stats,
//   get/set_weights, weight_count, infer_batch, loss_history.

#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

#include "../core/concepts.hpp"
#include "../core/perf.hpp"
#include "../core/rng.hpp"
#include "activations.hpp"
#include "init.hpp"
#include "loss.hpp"
#include "rl.hpp"
#include "stats.hpp"
#include "storage.hpp"
#include "training.hpp"

namespace nisps::ml {

// Activation of layer L in the fixed 4-layer topology.
template <std::size_t L>
inline constexpr Activation kLayerActivation =
    (L == 3u) ? Activation::Sigmoid : Activation::ReLU;

template <typename Storage>
class MLPCore : public Storage {
   public:
    static constexpr std::size_t kNumLayers = kMlpNumLayers;

    // ---------------------------------------------------------------
    // Lifecycle. Extra arguments are forwarded to the storage policy —
    // FixedStorage takes none (`MLP m(seed)`), DynamicStorage takes its
    // runtime dimensions (`MLPCore<DynamicStorage> m(seed, n_in, hidden,
    // n_out, ...)`).
    // ---------------------------------------------------------------
    template <typename... StorageArgs>
    explicit MLPCore(std::uint64_t seed, StorageArgs&&... storage_args) noexcept
        : Storage(static_cast<StorageArgs&&>(storage_args)...), rng_(seed) {
        // Default-init weights with spread=1 (Xavier-like). The IML
        // interface caller is expected to draw_weights() with its own
        // spread before the first inference; this default simply gives a
        // non-degenerate starting state for tests that skip an explicit
        // draw.
        if (!storage_ok_()) return;
        draw_weights(1.f);
        clear_dataset_();
        loss_history_count_ = 0u;
    }

    // ---------------------------------------------------------------
    // Inference API (concept: set_input / process / outputs)
    // ---------------------------------------------------------------
    NISPS_FORCE_INLINE void set_input(std::size_t i, float v) noexcept {
        if (!storage_ok_()) return;
        if (i < this->n_in()) this->input_buf()[i] = v;
    }

    NISPS_HOT void process() noexcept {
        if (!storage_ok_()) return;
        forward_(this->input_buf());
        // Mirror final activation into the output buffer so callers can
        // read a stable span.
        const auto a   = this->template act_l<3u>();
        auto       out = this->output_buf();
        const std::size_t n_out = this->n_out();
        for (std::size_t i = 0; i < n_out; ++i) out[i] = a[i];
    }

    NISPS_FORCE_INLINE std::span<const float> outputs() const noexcept {
        return this->output_buf();
    }

    // ---------------------------------------------------------------
    // Dataset / Training (concept: add_example / train)
    // ---------------------------------------------------------------
    // FIFO ring buffer; oldest example evicted when full. No allocation.
    void add_example(std::span<const float> features,
                     std::span<const float> labels) noexcept {
        if (!storage_ok_()) return;
        const std::size_t n_in  = this->n_in();
        const std::size_t n_out = this->n_out();
        if (features.size() < n_in || labels.size() < n_out) return;

        std::size_t slot;
        if (dataset_count_ < this->max_examples()) {
            slot = dataset_count_++;
        } else {
            // Buffer full: overwrite the slot pointed at by head_ (oldest)
            // and advance head_ to the next-oldest.
            slot = dataset_head_;
            dataset_head_ = (dataset_head_ + 1u) % this->max_examples();
        }
        auto dsf = this->ds_features();
        auto dsl = this->ds_labels();
        const std::size_t f_off = slot * n_in;
        const std::size_t l_off = slot * n_out;
        for (std::size_t i = 0; i < n_in;  ++i) dsf[f_off + i] = features[i];
        for (std::size_t i = 0; i < n_out; ++i) dsl[l_off + i] = labels[i];
    }

    // Concept-required no-arg overload.
    float train() noexcept {
        return train(1.f, 1000u, 0.001f, std::span<const float>{});
    }

    // Full SGD training. `sample_weights`, if non-empty, must size to the
    // current example count and sum to 1.0 (caller's responsibility — we
    // do NOT renormalize).
    //
    // Returns final epoch loss. Records per-iteration loss in the loss
    // history (bounded by max_iter_train()).
    float train(float lr,
                std::size_t max_iter,
                float min_err,
                std::span<const float> sample_weights = {}) noexcept {
        loss_history_count_ = 0u;
        if (!storage_ok_()) return 0.f;
        if (dataset_count_ == 0u) return 0.f;

        const bool weighted   = !sample_weights.empty();
        const float uniform_w = 1.f / static_cast<float>(dataset_count_);

        auto loss_hist = this->loss_hist_buf();

        float epoch_loss = 0.f;
        for (std::size_t iter = 0; iter < max_iter; ++iter) {
            epoch_loss = 0.f;
            // SGD: per-sample forward → loss → backprop+update. The order
            // is the dataset insertion order; we do not shuffle (matches
            // the legacy `Train()` exactly — `TrainBatch` shuffles, but
            // we're not implementing batch yet).
            for (std::size_t s = 0; s < dataset_count_; ++s) {
                const float w = weighted ? sample_weights[s] : uniform_w;

                // Forward pass on sample s.
                std::span<const float> x = sample_features_(s);
                forward_(x);

                // Per-sample loss (NOT scaled by 1/N — the meml-ues fix).
                // The eval scratch of the final layer doubles as the loss-
                // derivative buffer (mse_per_sample fully overwrites it;
                // eval_loss never runs concurrently).
                auto deriv = this->template eval_act_l<3u>();
                const float sample_loss = mse_per_sample(
                    sample_labels_(s),
                    std::span<const float>(this->template act_l<3u>()),
                    deriv);

                // Aggregate weighted loss.
                epoch_loss += w * sample_loss;

                // Backprop with the same w as the gradient scaler.
                backprop_(x, deriv, w);

                // Apply gradient (per-sample, SGD).
                apply_grad_<3u>(lr);
                apply_grad_<2u>(lr);
                apply_grad_<1u>(lr);
                apply_grad_<0u>(lr);
            }

            if (loss_history_count_ < this->max_iter_train()) {
                loss_hist[loss_history_count_++] = epoch_loss;
            }

            if (epoch_loss < min_err) break;
        }
        return epoch_loss;
    }

    // Train ONE step toward a COMPUTED target vector (not a stored label) —
    // the geometric-dislike hook (docs/adr/rl-feedback-design.md §4). The
    // dataset is untouched. A negative `lr` trains AWAY from the target (the
    // upstream cold-start fallback). `out_mask` (1 = active) zeroes the
    // loss-derivative of inactive output dims before backprop — the solo/
    // focus gate; empty ⇒ all active. Returns the sample loss.
    float train_targets(std::span<const float> input,
                        std::span<const float> target,
                        float lr,
                        std::span<const std::uint8_t> out_mask = {}) noexcept {
        if (!storage_ok_()) return 0.f;
        const std::size_t n_out = this->n_out();
        if (input.size() < this->n_in() || target.size() < n_out) return 0.f;

        forward_(input);

        auto deriv = this->template eval_act_l<3u>();
        const float loss = mse_per_sample(
            target,
            std::span<const float>(this->template act_l<3u>()),
            deriv);
        if (!out_mask.empty()) {
            for (std::size_t j = 0; j < n_out; ++j) {
                const bool active = (j < out_mask.size() && out_mask[j] != 0u);
                if (!active) deriv[j] = 0.f;
            }
        }

        backprop_(input, deriv, 1.f);
        apply_grad_<3u>(lr);
        apply_grad_<2u>(lr);
        apply_grad_<1u>(lr);
        apply_grad_<0u>(lr);
        return loss;
    }

    // ---------------------------------------------------------------
    // RL ops (concept: move_weights / draw_weights)
    // ---------------------------------------------------------------
    void move_weights(float speed, float spread,
                      std::span<const std::uint8_t> output_pin_mask = {}) noexcept {
        if (!storage_ok_()) return;
        move_weights_layer(this->template weights_l<0u>(), this->template biases_l<0u>(),
                           this->template fan_in_l<0u>(), speed, spread, /*final=*/false, {}, rng_);
        move_weights_layer(this->template weights_l<1u>(), this->template biases_l<1u>(),
                           this->template fan_in_l<1u>(), speed, spread, /*final=*/false, {}, rng_);
        move_weights_layer(this->template weights_l<2u>(), this->template biases_l<2u>(),
                           this->template fan_in_l<2u>(), speed, spread, /*final=*/false, {}, rng_);
        move_weights_layer(this->template weights_l<3u>(), this->template biases_l<3u>(),
                           this->template fan_in_l<3u>(), speed, spread, /*final=*/true,
                           output_pin_mask, rng_);
    }

    void draw_weights(float spread) noexcept {
        if (!storage_ok_()) return;
        draw_weights_layer(this->template weights_l<0u>(), this->template biases_l<0u>(),
                           this->template fan_in_l<0u>(), spread, rng_);
        draw_weights_layer(this->template weights_l<1u>(), this->template biases_l<1u>(),
                           this->template fan_in_l<1u>(), spread, rng_);
        draw_weights_layer(this->template weights_l<2u>(), this->template biases_l<2u>(),
                           this->template fan_in_l<2u>(), spread, rng_);
        draw_weights_layer(this->template weights_l<3u>(), this->template biases_l<3u>(),
                           this->template fan_in_l<3u>(), spread, rng_);
        clear_grad_<0u>();
        clear_grad_<1u>();
        clear_grad_<2u>();
        clear_grad_<3u>();
    }

    // Concept reset: clear weights, dataset, and loss history. Seed is
    // intentionally NOT reset (use `seed()` for that).
    void reset() noexcept {
        if (!storage_ok_()) return;
        clear_dataset_();
        loss_history_count_ = 0u;
        // Re-init weights from current rng state with default spread.
        draw_weights(1.f);
        auto in  = this->input_buf();
        auto out = this->output_buf();
        for (std::size_t i = 0; i < in.size();  ++i) in[i]  = 0.f;
        for (std::size_t i = 0; i < out.size(); ++i) out[i] = 0.f;
    }

    void seed(std::uint64_t s) noexcept { rng_.seed(s); }

    // ---------------------------------------------------------------
    // Diagnostics
    // ---------------------------------------------------------------
    // Average MSE across the training set without updating weights or the
    // cached activations (runs through the mutable eval scratch).
    float eval_loss() const noexcept {
        if (!storage_ok_()) return 0.f;
        if (dataset_count_ == 0u) return 0.f;
        const float inv_n = 1.f / static_cast<float>(dataset_count_);
        const std::size_t n_out = this->n_out();
        auto dsl = this->ds_labels();

        float total = 0.f;
        for (std::size_t s = 0; s < dataset_count_; ++s) {
            forward_eval_layer_<0u>(sample_features_(s));
            forward_eval_layer_<1u>(this->template eval_act_l<0u>());
            forward_eval_layer_<2u>(this->template eval_act_l<1u>());
            forward_eval_layer_<3u>(this->template eval_act_l<2u>());

            const auto ao = this->template eval_act_l<3u>();
            float sse = 0.f;
            const float inv_o = 1.f / static_cast<float>(n_out);
            const std::size_t l_off = s * n_out;
            for (std::size_t j = 0; j < n_out; ++j) {
                const float d = dsl[l_off + j] - ao[j];
                sse += d * d * inv_o;
            }
            total += sse * inv_n;
        }
        return total;
    }

    LayerStats layer_stats(std::size_t layer_idx) const noexcept {
        if (!storage_ok_()) return {};
        switch (layer_idx) {
            case 0: return compute_layer_stats(this->template weights_l<0u>(),
                                               this->template biases_l<0u>());
            case 1: return compute_layer_stats(this->template weights_l<1u>(),
                                               this->template biases_l<1u>());
            case 2: return compute_layer_stats(this->template weights_l<2u>(),
                                               this->template biases_l<2u>());
            case 3: return compute_layer_stats(this->template weights_l<3u>(),
                                               this->template biases_l<3u>());
            default: return {};
        }
    }

    // Returns a span into a storage-owned scratch buffer that holds a copy
    // of the flat weights+biases. The buffer is regenerated on each call,
    // so don't hold onto the span across mutations.
    std::span<const float> get_weights() noexcept {
        if (!storage_ok_()) return {};
        auto flat = this->flat_buf();
        std::size_t k = 0u;
        // Weights, layer-major.
        for (float v : this->template weights_l<0u>()) flat[k++] = v;
        for (float v : this->template weights_l<1u>()) flat[k++] = v;
        for (float v : this->template weights_l<2u>()) flat[k++] = v;
        for (float v : this->template weights_l<3u>()) flat[k++] = v;
        // Biases.
        for (float v : this->template biases_l<0u>()) flat[k++] = v;
        for (float v : this->template biases_l<1u>()) flat[k++] = v;
        for (float v : this->template biases_l<2u>()) flat[k++] = v;
        for (float v : this->template biases_l<3u>()) flat[k++] = v;
        return std::span<const float>(flat.data(), k);
    }

    void set_weights(std::span<const float> w) noexcept {
        if (!storage_ok_()) return;
        if (w.size() < this->weight_count()) return;
        std::size_t k = 0u;
        for (float& v : this->template weights_l<0u>()) v = w[k++];
        for (float& v : this->template weights_l<1u>()) v = w[k++];
        for (float& v : this->template weights_l<2u>()) v = w[k++];
        for (float& v : this->template weights_l<3u>()) v = w[k++];
        for (float& v : this->template biases_l<0u>()) v = w[k++];
        for (float& v : this->template biases_l<1u>()) v = w[k++];
        for (float& v : this->template biases_l<2u>()) v = w[k++];
        for (float& v : this->template biases_l<3u>()) v = w[k++];
    }

    // Run inference on N points (each n_in-sized) and write N output vectors
    // (each n_out-sized) into `outs`. NO heap. Modifies the internal cached
    // activations as a side effect.
    void infer_batch(std::span<const float> points,
                     std::span<float>       outs) noexcept {
        if (!storage_ok_()) return;
        const std::size_t n_in  = this->n_in();
        const std::size_t n_out = this->n_out();
        const std::size_t n = points.size() / n_in;
        if (outs.size() < n * n_out) return;
        auto in  = this->input_buf();
        auto out = this->output_buf();
        for (std::size_t i = 0; i < n; ++i) {
            const std::size_t in_off = i * n_in;
            for (std::size_t j = 0; j < n_in; ++j) in[j] = points[in_off + j];
            process();
            const std::size_t out_off = i * n_out;
            for (std::size_t j = 0; j < n_out; ++j) outs[out_off + j] = out[j];
        }
    }

    std::span<const float> loss_history() const noexcept {
        return std::span<const float>(this->loss_hist_buf().data(), loss_history_count_);
    }

    std::size_t example_count() const noexcept { return dataset_count_; }

    void clear_examples() noexcept { clear_dataset_(); }

   private:
    // ---------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------
    // DynamicStorage construction can fail (arena allocation); FixedStorage
    // cannot. The check is compile-time `true` for storages without a
    // `valid()` member, so the fixed/firmware path carries no branch.
    NISPS_FORCE_INLINE bool storage_ok_() const noexcept {
        if constexpr (requires(const Storage& s) { { s.valid() } -> std::convertible_to<bool>; }) {
            return this->valid();
        } else {
            return true;
        }
    }

    template <std::size_t L>
    NISPS_HOT NISPS_FORCE_INLINE void forward_layer_(std::span<const float> in) noexcept {
        const std::size_t fan_in  = this->template fan_in_l<L>();
        const std::size_t fan_out = this->template fan_out_l<L>();
        auto w  = this->template weights_l<L>();
        auto b  = this->template biases_l<L>();
        auto pa = this->template pre_act_l<L>();
        auto a  = this->template act_l<L>();
        for (std::size_t node = 0; node < fan_out; ++node) {
            const std::size_t row = node * fan_in;
            float sum = b[node];
            for (std::size_t j = 0; j < fan_in; ++j) {
                sum += w[row + j] * in[j];
            }
            pa[node] = sum;
            a[node]  = activate<kLayerActivation<L>>(sum);
        }
    }

    NISPS_HOT NISPS_FORCE_INLINE
    void forward_(std::span<const float> in) noexcept {
        forward_layer_<0u>(in);
        forward_layer_<1u>(this->template act_l<0u>());
        forward_layer_<2u>(this->template act_l<1u>());
        forward_layer_<3u>(this->template act_l<2u>());
    }

    // Backprop one layer: compute the incoming-error vector for the previous
    // layer into delta_l<L>() and accumulate per-weight/per-bias gradients.
    template <std::size_t L>
    NISPS_HOT NISPS_FORCE_INLINE
    void backprop_layer_(std::span<const float> input,
                         std::span<const float> upstream_err,
                         float                  sample_weight) noexcept {
        const std::size_t fan_in  = this->template fan_in_l<L>();
        const std::size_t fan_out = this->template fan_out_l<L>();
        auto w        = this->template weights_l<L>();
        auto pa       = this->template pre_act_l<L>();
        auto gw       = this->template grad_w_l<L>();
        auto gb       = this->template grad_b_l<L>();
        auto delta_in = this->template delta_l<L>();

        for (std::size_t j = 0; j < fan_in; ++j) delta_in[j] = 0.f;

        for (std::size_t node = 0; node < fan_out; ++node) {
            const float err_signal =
                upstream_err[node] *
                activate_deriv_pre<kLayerActivation<L>>(pa[node]) * sample_weight;
            const std::size_t row = node * fan_in;
            for (std::size_t j = 0; j < fan_in; ++j) {
                gw[row + j] += err_signal * input[j];
                delta_in[j] += err_signal * w[row + j];
            }
            gb[node] += err_signal;
        }
    }

    // Backprop with sample_weight applied to every error signal (so the
    // accumulated gradient is already weighted). No weight update happens
    // here — caller does it after each sample.
    NISPS_HOT NISPS_FORCE_INLINE
    void backprop_(std::span<const float> input,
                   std::span<const float> output_deriv,
                   float sample_weight) noexcept {
        backprop_layer_<3u>(this->template act_l<2u>(), output_deriv, sample_weight);
        backprop_layer_<2u>(this->template act_l<1u>(), this->template delta_l<3u>(), 1.f);
        backprop_layer_<1u>(this->template act_l<0u>(), this->template delta_l<2u>(), 1.f);
        backprop_layer_<0u>(input,                       this->template delta_l<1u>(), 1.f);
    }

    // Apply accumulated gradient to weights+biases with clipping. Resets
    // the accumulators to zero for the next sample/iteration.
    template <std::size_t L>
    NISPS_FORCE_INLINE void apply_grad_(float lr) noexcept {
        auto w  = this->template weights_l<L>();
        auto b  = this->template biases_l<L>();
        auto gw = this->template grad_w_l<L>();
        auto gb = this->template grad_b_l<L>();
        const std::size_t nw = gw.size();
        const std::size_t nb = gb.size();
        for (std::size_t i = 0; i < nw; ++i) {
            const float g = clip_gradient(gw[i]);
            w[i] -= lr * g;
            gw[i] = 0.f;
        }
        for (std::size_t i = 0; i < nb; ++i) {
            const float g = clip_gradient(gb[i]);
            b[i] -= lr * g;
            gb[i] = 0.f;
        }
    }

    template <std::size_t L>
    NISPS_FORCE_INLINE void clear_grad_() noexcept {
        auto gw = this->template grad_w_l<L>();
        auto gb = this->template grad_b_l<L>();
        for (std::size_t i = 0; i < gw.size(); ++i) gw[i] = 0.f;
        for (std::size_t i = 0; i < gb.size(); ++i) gb[i] = 0.f;
    }

    // const forward pass for diagnostics — writes into the mutable eval
    // scratch, never the real caches.
    template <std::size_t L>
    NISPS_FORCE_INLINE void forward_eval_layer_(std::span<const float> in) const noexcept {
        const std::size_t fan_in  = this->template fan_in_l<L>();
        const std::size_t fan_out = this->template fan_out_l<L>();
        auto w   = this->template weights_l<L>();
        auto b   = this->template biases_l<L>();
        auto out = this->template eval_act_l<L>();
        for (std::size_t node = 0; node < fan_out; ++node) {
            const std::size_t row = node * fan_in;
            float sum = b[node];
            for (std::size_t j = 0; j < fan_in; ++j) sum += w[row + j] * in[j];
            out[node] = activate<kLayerActivation<L>>(sum);
        }
    }

    NISPS_FORCE_INLINE std::span<const float> sample_features_(std::size_t s) const noexcept {
        const std::size_t n_in = this->n_in();
        return this->ds_features().subspan(s * n_in, n_in);
    }
    NISPS_FORCE_INLINE std::span<const float> sample_labels_(std::size_t s) const noexcept {
        const std::size_t n_out = this->n_out();
        return this->ds_labels().subspan(s * n_out, n_out);
    }

    void clear_dataset_() noexcept {
        dataset_count_ = 0u;
        dataset_head_  = 0u;
    }

    // ---------------------------------------------------------------
    // Members (shape-independent; everything sized lives in Storage)
    // ---------------------------------------------------------------
    std::size_t dataset_count_      = 0u;
    std::size_t dataset_head_       = 0u;
    std::size_t loss_history_count_ = 0u;

    Rng rng_;
};

// The classic fixed-architecture MLP — the firmware model and the default
// everywhere a compile-time shape is known. `MLP<NIn, 10, 10, 14, NOut>`
// matches the legacy firmware default [10, 10, 14].
template <std::size_t NIn,
          std::size_t NHidden1,
          std::size_t NHidden2,
          std::size_t NHidden3,
          std::size_t NOut,
          std::size_t NMaxExamples  = kDefaultMaxExamples,
          std::size_t NMaxIterTrain = 4096u>
using MLP = MLPCore<
    FixedStorage<NIn, NHidden1, NHidden2, NHidden3, NOut, NMaxExamples, NMaxIterTrain>>;

// MLP satisfies the MLEngine concept. We keep a static_assert in the test
// suite (test_mlp_concept_satisfied) — see test_mlp_init.cpp.

}  // namespace nisps::ml
