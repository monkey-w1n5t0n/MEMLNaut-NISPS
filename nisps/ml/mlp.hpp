// nisps/ml/mlp.hpp — fixed-architecture MLP, four layers (three hidden +
// output). All buffers are template-sized std::array; zero heap allocation
// in inference, training, and the dataset path.
//
// ARCHITECTURE
//   MLP<NIn, NHidden1, NHidden2, NHidden3, NOut, NMaxExamples = 128>
//   ┌──────┐  Linear+Bias   ┌────────┐  ReLU   ┌────────┐  ReLU   ┌────────┐  Sigmoid
//   │ NIn  │ ─────────────▶ │ NH1    │ ──────▶ │ NH2    │ ──────▶ │ NH3    │ ──────▶ NOut
//   └──────┘                └────────┘         └────────┘         └────────┘
//   Layer 0 (NIn  → NH1)  ReLU
//   Layer 1 (NH1  → NH2)  ReLU
//   Layer 2 (NH2  → NH3)  ReLU
//   Layer 3 (NH3  → NOut) Sigmoid
//
// We support exactly three hidden layers. The legacy firmware default is
// [10, 10, 14], so the MVP signature directly matches `MLP<NIn, 10, 10, 14,
// NOut>`. Variable layer count is deferred — see architecture.md.
//
// MEMORY MODEL
//   Per layer L_k with fan_in = N_in[k], fan_out = N_out[k]:
//     std::array<float, fan_in*fan_out> weights        // row-major
//     std::array<float, fan_out>        biases
//     std::array<float, fan_out>        pre_activation // cached for backprop
//     std::array<float, fan_out>        activation     // cached for backprop
//     std::array<float, fan_in*fan_out> grad_w_accum   // for backprop
//     std::array<float, fan_out>        grad_b_accum
//
//   Per MLP:
//     std::array<float, NIn> input_buffer (current set_input values)
//     std::array<float, NOut> output (post-final-activation; outputs())
//     std::array<float, NMaxExamples * NIn>  dataset_features
//     std::array<float, NMaxExamples * NOut> dataset_labels
//     std::size_t dataset_count, dataset_head (FIFO ring buffer)
//     std::array<float, NMaxIter> loss_history (max iters from train())
//     Rng rng_
//     std::array<float, NOut> bp_err_buf, bp_delta_buf  (backprop scratch)
//
// FLAT WEIGHT LAYOUT (`get_weights` / `set_weights`)
//   [layer0_weights ...] [layer1_weights ...] [layer2_weights ...] [layer3_weights ...]
//   [layer0_biases  ...] [layer1_biases  ...] [layer2_biases  ...] [layer3_biases  ...]
//   Documented in detail near `weight_count()`.
//
// CONCEPT SATISFACTION
//   The class satisfies `nisps::MLEngine`:
//     set_input, process, outputs, add_example, train (no-arg overload
//     returning float), move_weights(speed, spread), draw_weights(spread),
//     reset, seed.
//   Plus diagnostics required by the broader API (see Stream 2 brief in
//   architecture.md): eval_loss, layer_stats, get/set_weights, weight_count,
//   infer_batch, loss_history.

#pragma once

#include <array>
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
#include "training.hpp"

namespace nisps::ml {

// Layer<FanIn, FanOut, Act>. Stores its weights, biases, and the work
// buffers needed for forward + backprop. Header-only, all sizes compile-
// time. Each method is small; the compiler will inline through.
template <std::size_t FanIn, std::size_t FanOut, Activation Act>
struct Layer {
    static constexpr std::size_t kFanIn  = FanIn;
    static constexpr std::size_t kFanOut = FanOut;
    static constexpr Activation  kAct    = Act;

    std::array<float, FanIn * FanOut> weights{};
    std::array<float, FanOut>         biases{};
    // Cached during forward(); consumed during backprop().
    std::array<float, FanOut>         pre_activation{};
    std::array<float, FanOut>         activation{};
    // Gradient accumulators — used per-sample for SGD weight update.
    std::array<float, FanIn * FanOut> grad_w{};
    std::array<float, FanOut>         grad_b{};

    NISPS_FORCE_INLINE float& w(std::size_t node, std::size_t in) noexcept {
        return weights[node * FanIn + in];
    }
    NISPS_FORCE_INLINE float w(std::size_t node, std::size_t in) const noexcept {
        return weights[node * FanIn + in];
    }

    // Forward: compute pre_activation and activation given an input span.
    NISPS_HOT NISPS_FORCE_INLINE
    void forward(std::span<const float, FanIn> input) noexcept {
        for (std::size_t node = 0; node < FanOut; ++node) {
            const std::size_t row = node * FanIn;
            float sum = biases[node];
            for (std::size_t j = 0; j < FanIn; ++j) {
                sum += weights[row + j] * input[j];
            }
            pre_activation[node] = sum;
            activation[node]     = activate<Act>(sum);
        }
    }

    // Compute incoming-error vector for the previous layer:
    //   delta_in[j] = sum_node (err_signal[node] * w[node, j])
    // Where err_signal[node] = upstream_err[node] * d/dpre activation.
    // Also accumulates per-weight and per-bias gradients (no LR yet).
    NISPS_HOT NISPS_FORCE_INLINE
    void backprop_accumulate(std::span<const float, FanIn> input,
                             std::span<const float, FanOut> upstream_err,
                             std::span<float, FanIn> delta_in,
                             float                   sample_weight) noexcept {
        for (std::size_t j = 0; j < FanIn; ++j) delta_in[j] = 0.f;

        for (std::size_t node = 0; node < FanOut; ++node) {
            const float err_signal =
                upstream_err[node] * activate_deriv_pre<Act>(pre_activation[node]) * sample_weight;
            const std::size_t row = node * FanIn;
            for (std::size_t j = 0; j < FanIn; ++j) {
                grad_w[row + j] += err_signal * input[j];
                delta_in[j]     += err_signal * weights[row + j];
            }
            grad_b[node] += err_signal;
        }
    }

    // Apply accumulated gradient to weights+biases with clipping. Resets
    // the accumulators to zero for the next sample/iteration.
    NISPS_FORCE_INLINE
    void apply_grad(float lr) noexcept {
        for (std::size_t i = 0; i < FanIn * FanOut; ++i) {
            const float g = clip_gradient(grad_w[i]);
            weights[i] -= lr * g;
            grad_w[i] = 0.f;
        }
        for (std::size_t i = 0; i < FanOut; ++i) {
            const float g = clip_gradient(grad_b[i]);
            biases[i] -= lr * g;
            grad_b[i] = 0.f;
        }
    }

    NISPS_FORCE_INLINE
    void clear_grad() noexcept {
        for (std::size_t i = 0; i < FanIn * FanOut; ++i) grad_w[i] = 0.f;
        for (std::size_t i = 0; i < FanOut;          ++i) grad_b[i] = 0.f;
    }
};

// MLP<NIn, NHidden1, NHidden2, NHidden3, NOut, NMaxExamples = 128>
//
// MaxIterTrain caps the loss-history buffer; if a caller asks for more
// iterations they will be honored at runtime, but only the first
// kMaxIterTrain are recorded for inspection. 4096 fits the playground's
// upper bound and costs 16 KiB.
template <std::size_t NIn,
          std::size_t NHidden1,
          std::size_t NHidden2,
          std::size_t NHidden3,
          std::size_t NOut,
          std::size_t NMaxExamples = 128u,
          std::size_t NMaxIterTrain = 4096u>
class MLP {
   public:
    static constexpr std::size_t kInput          = NIn;
    static constexpr std::size_t kHidden1        = NHidden1;
    static constexpr std::size_t kHidden2        = NHidden2;
    static constexpr std::size_t kHidden3        = NHidden3;
    static constexpr std::size_t kOutput         = NOut;
    static constexpr std::size_t kMaxExamples    = NMaxExamples;
    static constexpr std::size_t kMaxIterTrain   = NMaxIterTrain;
    static constexpr std::size_t kNumLayers      = 4u;

    using Layer0 = Layer<NIn,      NHidden1, Activation::ReLU>;
    using Layer1 = Layer<NHidden1, NHidden2, Activation::ReLU>;
    using Layer2 = Layer<NHidden2, NHidden3, Activation::ReLU>;
    using Layer3 = Layer<NHidden3, NOut,     Activation::Sigmoid>;

    // ---------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------
    explicit MLP(std::uint64_t seed) noexcept : rng_(seed) {
        // Default-init weights with spread=1 (Xavier-like). The IML
        // interface caller is expected to draw_weights() with the
        // playground spread before the first inference; this default
        // simply gives us a non-degenerate starting state for tests
        // that skip an explicit draw.
        draw_weights(1.f);
        clear_dataset_();
        loss_history_count_ = 0u;
    }

    // ---------------------------------------------------------------
    // Inference API (concept: set_input / process / outputs)
    // ---------------------------------------------------------------
    NISPS_FORCE_INLINE void set_input(std::size_t i, float v) noexcept {
        if (i < NIn) input_[i] = v;
    }

    NISPS_HOT void process() noexcept {
        forward_(std::span<const float, NIn>(input_));
        // Mirror final activation into the output buffer so callers can
        // read a stable span.
        const auto& a = layer3_.activation;
        for (std::size_t i = 0; i < NOut; ++i) output_[i] = a[i];
    }

    NISPS_FORCE_INLINE std::span<const float> outputs() const noexcept {
        return std::span<const float>(output_.data(), NOut);
    }

    // ---------------------------------------------------------------
    // Dataset / Training (concept: add_example / train)
    // ---------------------------------------------------------------
    // FIFO ring buffer; oldest example evicted when full. No allocation.
    // We don't track logical insertion order during training because SGD
    // doesn't care — the iteration order over the buffer is arbitrary.
    void add_example(std::span<const float> features,
                     std::span<const float> labels) noexcept {
        if (features.size() < NIn || labels.size() < NOut) return;

        std::size_t slot;
        if (dataset_count_ < NMaxExamples) {
            slot = dataset_count_++;
        } else {
            // Buffer full: overwrite the slot pointed at by head_ (oldest)
            // and advance head_ to the next-oldest.
            slot = dataset_head_;
            dataset_head_ = (dataset_head_ + 1u) % NMaxExamples;
        }
        const std::size_t f_off = slot * NIn;
        const std::size_t l_off = slot * NOut;
        for (std::size_t i = 0; i < NIn;  ++i) ds_features_[f_off + i] = features[i];
        for (std::size_t i = 0; i < NOut; ++i) ds_labels_  [l_off + i] = labels[i];
    }

    // Concept-required no-arg overload. Default learning rate matches the
    // playground's "sane RL training" knob; max_iter and min_err follow.
    float train() noexcept {
        return train(1.f, 1000u, 0.001f, std::span<const float>{});
    }

    // Full SGD training. `sample_weights`, if non-empty, must size to the
    // current example count and sum to 1.0 (caller's responsibility — we
    // do NOT renormalize).
    //
    // Returns final epoch loss. Records per-iteration loss in
    // `loss_history_` (bounded by kMaxIterTrain).
    float train(float lr,
                std::size_t max_iter,
                float min_err,
                std::span<const float> sample_weights = {}) noexcept {
        loss_history_count_ = 0u;
        if (dataset_count_ == 0u) return 0.f;

        const bool weighted = !sample_weights.empty();
        const float uniform_w = 1.f / static_cast<float>(dataset_count_);

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
                std::span<const float, NIn> x = sample_features_(s);
                forward_(x);

                // Per-sample loss (NOT scaled by 1/N — the meml-ues fix).
                std::array<float, NOut> deriv{};
                const float sample_loss = mse_per_sample(
                    sample_labels_(s),
                    std::span<const float>(layer3_.activation.data(), NOut),
                    std::span<float>(deriv.data(), NOut));

                // Aggregate weighted loss.
                epoch_loss += w * sample_loss;

                // Backprop with the same w as the gradient scaler.
                backprop_(x, std::span<const float, NOut>(deriv), w);

                // Apply gradient (per-sample, SGD).
                layer3_.apply_grad(lr);
                layer2_.apply_grad(lr);
                layer1_.apply_grad(lr);
                layer0_.apply_grad(lr);
            }

            if (loss_history_count_ < NMaxIterTrain) {
                loss_history_[loss_history_count_++] = epoch_loss;
            }

            if (epoch_loss < min_err) break;
        }
        return epoch_loss;
    }

    // ---------------------------------------------------------------
    // RL ops (concept: move_weights / draw_weights)
    // ---------------------------------------------------------------
    void move_weights(float speed, float spread,
                      std::span<const std::uint8_t> output_pin_mask = {}) noexcept {
        move_weights_layer(std::span<float>(layer0_.weights), std::span<float>(layer0_.biases),
                           Layer0::kFanIn, speed, spread, /*final=*/false, {}, rng_);
        move_weights_layer(std::span<float>(layer1_.weights), std::span<float>(layer1_.biases),
                           Layer1::kFanIn, speed, spread, /*final=*/false, {}, rng_);
        move_weights_layer(std::span<float>(layer2_.weights), std::span<float>(layer2_.biases),
                           Layer2::kFanIn, speed, spread, /*final=*/false, {}, rng_);
        move_weights_layer(std::span<float>(layer3_.weights), std::span<float>(layer3_.biases),
                           Layer3::kFanIn, speed, spread, /*final=*/true, output_pin_mask, rng_);
    }

    void draw_weights(float spread) noexcept {
        draw_weights_layer(std::span<float>(layer0_.weights), std::span<float>(layer0_.biases),
                           Layer0::kFanIn, spread, rng_);
        draw_weights_layer(std::span<float>(layer1_.weights), std::span<float>(layer1_.biases),
                           Layer1::kFanIn, spread, rng_);
        draw_weights_layer(std::span<float>(layer2_.weights), std::span<float>(layer2_.biases),
                           Layer2::kFanIn, spread, rng_);
        draw_weights_layer(std::span<float>(layer3_.weights), std::span<float>(layer3_.biases),
                           Layer3::kFanIn, spread, rng_);
        layer0_.clear_grad();
        layer1_.clear_grad();
        layer2_.clear_grad();
        layer3_.clear_grad();
    }

    // Concept reset: clear weights, dataset, and loss history. Seed is
    // intentionally NOT reset (use `seed()` for that).
    void reset() noexcept {
        clear_dataset_();
        loss_history_count_ = 0u;
        // Re-init weights from current rng state with default spread.
        draw_weights(1.f);
        for (std::size_t i = 0; i < NIn;  ++i) input_[i]  = 0.f;
        for (std::size_t i = 0; i < NOut; ++i) output_[i] = 0.f;
    }

    void seed(std::uint64_t s) noexcept { rng_.seed(s); }

    // ---------------------------------------------------------------
    // Diagnostics
    // ---------------------------------------------------------------
    // Forward pass + MSE on a single (input, label) implied by current
    // input_ and the most recent training labels — i.e. "what would the
    // loss be on the current input if the label were the current output?"
    // For now we report the average loss across the training set without
    // updating weights. Useful for non-destructive evaluation.
    float eval_loss() const noexcept {
        if (dataset_count_ == 0u) return 0.f;
        const float inv_n = 1.f / static_cast<float>(dataset_count_);
        // We need a non-const forward pass to use the cached buffers; since
        // eval_loss is logically const, fork a local computation that
        // doesn't touch member buffers. That means recomputing through the
        // layer weights against scratch arrays — no allocation, just stack.
        float total = 0.f;
        for (std::size_t s = 0; s < dataset_count_; ++s) {
            std::array<float, NHidden1> a1{};
            std::array<float, NHidden2> a2{};
            std::array<float, NHidden3> a3{};
            std::array<float, NOut>     ao{};

            const std::size_t f_off = s * NIn;
            forward_const_layer<NIn, NHidden1, Activation::ReLU>(
                std::span<const float, NIn>(ds_features_.data() + f_off, NIn),
                layer0_.weights, layer0_.biases, a1);
            forward_const_layer<NHidden1, NHidden2, Activation::ReLU>(
                std::span<const float, NHidden1>(a1), layer1_.weights, layer1_.biases, a2);
            forward_const_layer<NHidden2, NHidden3, Activation::ReLU>(
                std::span<const float, NHidden2>(a2), layer2_.weights, layer2_.biases, a3);
            forward_const_layer<NHidden3, NOut, Activation::Sigmoid>(
                std::span<const float, NHidden3>(a3), layer3_.weights, layer3_.biases, ao);

            float sse = 0.f;
            const float inv_o = 1.f / static_cast<float>(NOut);
            const std::size_t l_off = s * NOut;
            for (std::size_t j = 0; j < NOut; ++j) {
                const float d = ds_labels_[l_off + j] - ao[j];
                sse += d * d * inv_o;
            }
            total += sse * inv_n;
        }
        return total;
    }

    LayerStats layer_stats(std::size_t layer_idx) const noexcept {
        switch (layer_idx) {
            case 0: return compute_layer_stats(layer0_.weights, layer0_.biases);
            case 1: return compute_layer_stats(layer1_.weights, layer1_.biases);
            case 2: return compute_layer_stats(layer2_.weights, layer2_.biases);
            case 3: return compute_layer_stats(layer3_.weights, layer3_.biases);
            default: return {};
        }
    }

    // Flat layout: layer0 weights, layer1 weights, layer2 weights, layer3
    // weights, then layer0..3 biases. The split is `weights first all
    // layers, then biases all layers` so callers serializing weights can
    // pre-compute offsets without consulting layer-specific tables.
    static constexpr std::size_t weight_count() noexcept {
        return NIn * NHidden1 + NHidden1 * NHidden2 + NHidden2 * NHidden3 + NHidden3 * NOut
             + NHidden1 + NHidden2 + NHidden3 + NOut;
    }

    // Returns a span into a member-owned scratch buffer that holds a copy
    // of the flat weights+biases. The buffer is regenerated on each call,
    // so don't hold onto the span across mutations.
    std::span<const float> get_weights() noexcept {
        std::size_t k = 0u;
        // Weights, layer-major.
        for (float v : layer0_.weights) flat_weight_buf_[k++] = v;
        for (float v : layer1_.weights) flat_weight_buf_[k++] = v;
        for (float v : layer2_.weights) flat_weight_buf_[k++] = v;
        for (float v : layer3_.weights) flat_weight_buf_[k++] = v;
        // Biases.
        for (float v : layer0_.biases)  flat_weight_buf_[k++] = v;
        for (float v : layer1_.biases)  flat_weight_buf_[k++] = v;
        for (float v : layer2_.biases)  flat_weight_buf_[k++] = v;
        for (float v : layer3_.biases)  flat_weight_buf_[k++] = v;
        return std::span<const float>(flat_weight_buf_.data(), weight_count());
    }

    void set_weights(std::span<const float> w) noexcept {
        if (w.size() < weight_count()) return;
        std::size_t k = 0u;
        for (float& v : layer0_.weights) v = w[k++];
        for (float& v : layer1_.weights) v = w[k++];
        for (float& v : layer2_.weights) v = w[k++];
        for (float& v : layer3_.weights) v = w[k++];
        for (float& v : layer0_.biases)  v = w[k++];
        for (float& v : layer1_.biases)  v = w[k++];
        for (float& v : layer2_.biases)  v = w[k++];
        for (float& v : layer3_.biases)  v = w[k++];
    }

    // Run inference on N points (each NIn-sized) and write N output vectors
    // (each NOut-sized) into `outs`. NO heap. Modifies the internal cached
    // activations as a side effect.
    void infer_batch(std::span<const float> points,
                     std::span<float>       outs) noexcept {
        const std::size_t n = points.size() / NIn;
        if (outs.size() < n * NOut) return;
        for (std::size_t i = 0; i < n; ++i) {
            const std::size_t in_off = i * NIn;
            for (std::size_t j = 0; j < NIn; ++j) input_[j] = points[in_off + j];
            process();
            const std::size_t out_off = i * NOut;
            for (std::size_t j = 0; j < NOut; ++j) outs[out_off + j] = output_[j];
        }
    }

    std::span<const float> loss_history() const noexcept {
        return std::span<const float>(loss_history_.data(), loss_history_count_);
    }

    std::size_t example_count() const noexcept { return dataset_count_; }

    void clear_examples() noexcept { clear_dataset_(); }

   private:
    // ---------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------
    NISPS_HOT NISPS_FORCE_INLINE
    void forward_(std::span<const float, NIn> in) noexcept {
        layer0_.forward(in);
        layer1_.forward(std::span<const float, NHidden1>(layer0_.activation));
        layer2_.forward(std::span<const float, NHidden2>(layer1_.activation));
        layer3_.forward(std::span<const float, NHidden3>(layer2_.activation));
    }

    // Backprop with sample_weight applied to every error signal (so the
    // accumulated gradient is already weighted). No weight update happens
    // here — caller does it after each sample.
    NISPS_HOT NISPS_FORCE_INLINE
    void backprop_(std::span<const float, NIn> input,
                   std::span<const float, NOut> output_deriv,
                   float sample_weight) noexcept {
        std::array<float, NHidden3> d3{};
        std::array<float, NHidden2> d2{};
        std::array<float, NHidden1> d1{};
        std::array<float, NIn>      d0{};

        layer3_.backprop_accumulate(
            std::span<const float, NHidden3>(layer2_.activation),
            output_deriv,
            std::span<float, NHidden3>(d3),
            sample_weight);
        layer2_.backprop_accumulate(
            std::span<const float, NHidden2>(layer1_.activation),
            std::span<const float, NHidden3>(d3),
            std::span<float, NHidden2>(d2),
            1.f);  // weight already in d3
        layer1_.backprop_accumulate(
            std::span<const float, NHidden1>(layer0_.activation),
            std::span<const float, NHidden2>(d2),
            std::span<float, NHidden1>(d1),
            1.f);
        layer0_.backprop_accumulate(
            input,
            std::span<const float, NHidden1>(d1),
            std::span<float, NIn>(d0),
            1.f);
    }

    // const forward pass for diagnostics. Doesn't touch layer caches.
    template <std::size_t Fi, std::size_t Fo, Activation A>
    static NISPS_FORCE_INLINE void forward_const_layer(
        std::span<const float, Fi>    in,
        const std::array<float, Fi*Fo>& w,
        const std::array<float, Fo>&    b,
        std::array<float, Fo>&          out) noexcept {
        for (std::size_t node = 0; node < Fo; ++node) {
            const std::size_t row = node * Fi;
            float sum = b[node];
            for (std::size_t j = 0; j < Fi; ++j) sum += w[row + j] * in[j];
            out[node] = activate<A>(sum);
        }
    }

    NISPS_FORCE_INLINE std::span<const float, NIn> sample_features_(std::size_t s) const noexcept {
        return std::span<const float, NIn>(ds_features_.data() + s * NIn, NIn);
    }
    NISPS_FORCE_INLINE std::span<const float> sample_labels_(std::size_t s) const noexcept {
        return std::span<const float>(ds_labels_.data() + s * NOut, NOut);
    }

    void clear_dataset_() noexcept {
        dataset_count_ = 0u;
        dataset_head_  = 0u;
    }

    // ---------------------------------------------------------------
    // Members
    // ---------------------------------------------------------------
    Layer0 layer0_{};
    Layer1 layer1_{};
    Layer2 layer2_{};
    Layer3 layer3_{};

    std::array<float, NIn>  input_{};
    std::array<float, NOut> output_{};

    std::array<float, NMaxExamples * NIn>  ds_features_{};
    std::array<float, NMaxExamples * NOut> ds_labels_{};
    std::size_t dataset_count_ = 0u;
    std::size_t dataset_head_  = 0u;

    std::array<float, weight_count()> flat_weight_buf_{};
    std::array<float, NMaxIterTrain>  loss_history_{};
    std::size_t loss_history_count_ = 0u;

    Rng rng_;
};

// MLP satisfies the MLEngine concept. We keep a static_assert in the test
// suite (test_mlp_concept_satisfied) — see test_mlp_init.cpp.

}  // namespace nisps::ml
