// iml.hpp — Self-contained runtime IML/MLP for the MEMLNaut VCV module.
//
// This is a VENDORED, runtime-shaped re-implementation of the nisps core
// `nisps::IML<float>` / `nisps::MLP<float>` surface the VCV module relies on.
// The retired `nisps-core` header tree (`-I../nisps-core/include`) is gone, and
// the templated firmware/WASM `nisps/ml` core is fixed-size — neither is a clean
// fit for a runtime 8→16 module. So we ship a small native MLP here that matches
// the firmware/browser TRAINING SEMANTICS as closely as a runtime form allows:
//
//   • ReLU hidden layers, sigmoid output (sigmoid maps to [0,1]).
//   • A trailing bias node (1.0) appended to the input vector.
//   • spread-aware weight init: uniform [-1,1] (spread=0) → Xavier 1/√fan_in
//     (spread=1), interpolated per layer.
//   • spread-aware perturbation (RL "move weights"): flat noise (spread=0) →
//     per-layer Xavier-scaled noise + 10%·spread weight decay (spread=1).
//   • Plain SGD / MSE training over the example dataset.
//   • DETERMINISTIC per-instance RNG (seeded), so behaviour is reproducible and
//     the threading double-buffer stays race-free (each MLP owns its own RNG).
//
// It is NOT bit-identical to the firmware core (different optimiser internals),
// and that divergence is an accepted follow-up (see vcv/SPEC.md delta #5). The
// public method names mirror the core so `MEMLNaut.cpp` is unchanged in spirit.
//
// MPL-2.0 in spirit with the rest of nisps; wrapper code under the VCV module's
// licence. British spelling in comments where it reads naturally.
#pragma once

#include <vector>
#include <cstddef>
#include <cmath>
#include <cstdint>
#include <limits>
#include <algorithm>

namespace nisps {

// ── Tiny deterministic RNG (xorshift128) ──────────────────────────────
// Per-instance state; seeded in the constructor. No std::random_device, no
// shared global generator — this is what keeps the audio/worker MLP pair free
// of data races and makes parity reproducible.
class DetRng {
public:
    explicit DetRng(uint32_t seed = 0x1234567u) { reseed(seed); }
    void reseed(uint32_t seed) {
        s_[0] = seed ? seed : 0xA5A5A5A5u;
        s_[1] = s_[0] ^ 0x9E3779B9u;
        s_[2] = s_[0] * 0x85EBCA6Bu + 1u;
        s_[3] = s_[0] * 0xC2B2AE35u + 0x27D4EB2Fu;
    }
    uint32_t next_u32() {
        uint32_t t = s_[3];
        uint32_t const u = s_[0];
        s_[3] = s_[2]; s_[2] = s_[1]; s_[1] = u;
        t ^= t << 11;
        t ^= t >> 8;
        s_[0] = t ^ u ^ (u >> 19);
        return s_[0];
    }
    // Uniform in [0,1)
    float uniform01() { return (next_u32() >> 8) * (1.0f / 16777216.0f); }
    // Uniform in [-1,1)
    float uniform_pm1() { return uniform01() * 2.0f - 1.0f; }
    // Approx standard-normal: sum of 3 uniforms (matches the core's gen_randn shape)
    float gaussian() {
        return (uniform_pm1() + uniform_pm1() + uniform_pm1()) * 0.5773502692f; // /√3 → unit-ish variance
    }
private:
    uint32_t s_[4];
};

// ── MLP ───────────────────────────────────────────────────────────────
template<typename T = float>
class MLP {
public:
    // 3D weight store: [layer][node][weight] where the final weight per node is
    // the bias (the previous layer's activations get a trailing 1.0).
    using mlp_weights = std::vector<std::vector<std::vector<T>>>;

    // layers_nodes: full sizes including input (with bias) and output, e.g.
    //   {n_in + 1, h0, h1, h2, n_out}
    MLP(const std::vector<size_t>& layers_nodes, uint32_t seed)
        : layers_nodes_(layers_nodes), rng_(seed) {
        build_();
        draw_weights_spread_(static_cast<T>(0));
    }

    size_t num_layers() const { return weights_.size(); }

    // Forward pass. `input_with_bias` has the trailing 1.0 already appended.
    void forward(const std::vector<T>& input_with_bias, std::vector<T>& out) const {
        std::vector<T> act = input_with_bias;
        for (size_t l = 0; l < weights_.size(); ++l) {
            const auto& layer = weights_[l];
            const bool is_output = (l + 1 == weights_.size());
            std::vector<T> next(layer.size());
            for (size_t n = 0; n < layer.size(); ++n) {
                const auto& w = layer[n];
                T sum = 0;
                // w has act.size()+1 entries? No: w spans the *current* input
                // size (which already includes the bias slot of `act`).
                const size_t lim = std::min(w.size(), act.size());
                for (size_t k = 0; k < lim; ++k) sum += w[k] * act[k];
                next[n] = is_output ? sigmoid_(sum) : relu_(sum);
            }
            // For hidden layers, append a bias term for the next layer's input.
            if (!is_output) next.push_back(static_cast<T>(1));
            act = std::move(next);
        }
        out = std::move(act);
    }

    // ── spread-aware weight init ──────────────────────────────────────
    void draw_weights_spread(T spread) { draw_weights_spread_(spread); }

    // ── spread-aware perturbation (RL move_weights) ───────────────────
    void move_weights_spread(T speed, T spread) {
        const T decay = static_cast<T>(1) - static_cast<T>(0.1) * spread;
        for (size_t l = 0; l < weights_.size(); ++l) {
            const T fan_in = static_cast<T>(input_size_of_layer_(l));
            const T xavier = (fan_in > 0) ? static_cast<T>(1) / std::sqrt(fan_in) : static_cast<T>(1);
            // spread=0 → flat noise (scale 1); spread=1 → per-layer Xavier scale
            const T noiseScale = (static_cast<T>(1) - spread) + spread * xavier;
            for (auto& node : weights_[l]) {
                for (auto& w : node) {
                    if (spread > 0) w *= decay;       // weight decay only when spread>0
                    w += rng_.gaussian() * speed * noiseScale;
                }
            }
        }
    }

    // ── plain SGD / MSE training ──────────────────────────────────────
    // features: each row is input WITHOUT bias; labels: target outputs in [0,1].
    void train(const std::vector<std::vector<T>>& features,
               const std::vector<std::vector<T>>& labels,
               int max_iterations, T learning_rate, T convergence) {
        const size_t n = std::min(features.size(), labels.size());
        if (n == 0) return;
        for (int iter = 0; iter < max_iterations; ++iter) {
            T epoch_loss = 0;
            for (size_t s = 0; s < n; ++s) {
                std::vector<T> in = features[s];
                in.push_back(static_cast<T>(1)); // bias
                epoch_loss += backprop_(in, labels[s], learning_rate);
            }
            epoch_loss /= static_cast<T>(n);
            if (epoch_loss < convergence) break;
        }
    }

    mlp_weights get_weights() const { return weights_; }
    void set_weights(const mlp_weights& w) {
        // Only adopt if the topology matches; otherwise ignore (keeps the audio
        // path safe against malformed snapshots from the bridge / patch files).
        if (w.size() != weights_.size()) return;
        for (size_t l = 0; l < w.size(); ++l) {
            if (w[l].size() != weights_[l].size()) return;
        }
        weights_ = w;
    }

private:
    static T relu_(T x) { return x > 0 ? x : 0; }
    static T sigmoid_(T x) { return static_cast<T>(1) / (static_cast<T>(1) + std::exp(-x)); }
    static T dsigmoid_from_out_(T y) { return y * (static_cast<T>(1) - y); }

    size_t input_size_of_layer_(size_t l) const {
        // The number of weights per node in layer l (incl. bias slot).
        return weights_[l].empty() ? 0 : weights_[l][0].size();
    }

    void build_() {
        weights_.clear();
        // layers_nodes_[0] is the input layer WITH bias already counted.
        for (size_t l = 1; l < layers_nodes_.size(); ++l) {
            const size_t in_sz = layers_nodes_[l - 1]; // includes bias slot
            const size_t out_sz = layers_nodes_[l];
            std::vector<std::vector<T>> layer(out_sz, std::vector<T>(in_sz, 0));
            weights_.push_back(std::move(layer));
        }
    }

    void draw_weights_spread_(T spread) {
        for (size_t l = 0; l < weights_.size(); ++l) {
            const T fan_in = static_cast<T>(layers_nodes_[l]); // incl. bias
            const T xavier = (fan_in > 0) ? static_cast<T>(1) / std::sqrt(fan_in) : static_cast<T>(1);
            const T scale = (static_cast<T>(1) - spread) + spread * xavier;
            for (auto& node : weights_[l]) {
                for (size_t k = 0; k < node.size(); ++k) {
                    // bias (last weight) initialised to 0, like the core
                    const bool is_bias = (k + 1 == node.size());
                    node[k] = is_bias ? static_cast<T>(0) : rng_.uniform_pm1() * scale;
                }
            }
        }
    }

    // One SGD step on a single example; returns the MSE for this example.
    T backprop_(const std::vector<T>& in_with_bias, const std::vector<T>& target,
                T lr) {
        // Forward, caching activations per layer.
        std::vector<std::vector<T>> acts;
        acts.reserve(weights_.size() + 1);
        acts.push_back(in_with_bias);
        std::vector<T> act = in_with_bias;
        for (size_t l = 0; l < weights_.size(); ++l) {
            const auto& layer = weights_[l];
            const bool is_output = (l + 1 == weights_.size());
            std::vector<T> next(layer.size());
            for (size_t nidx = 0; nidx < layer.size(); ++nidx) {
                const auto& w = layer[nidx];
                T sum = 0;
                const size_t lim = std::min(w.size(), act.size());
                for (size_t k = 0; k < lim; ++k) sum += w[k] * act[k];
                next[nidx] = is_output ? sigmoid_(sum) : relu_(sum);
            }
            if (!is_output) next.push_back(static_cast<T>(1));
            acts.push_back(next);
            act = next;
        }

        // Output error.
        const size_t L = weights_.size();
        std::vector<T>& out = acts[L];
        T loss = 0;
        std::vector<T> delta(out.size());
        for (size_t o = 0; o < out.size(); ++o) {
            const T t = (o < target.size()) ? target[o] : static_cast<T>(0);
            const T e = out[o] - t;
            loss += e * e;
            delta[o] = e * dsigmoid_from_out_(out[o]); // MSE × sigmoid'
        }
        loss /= static_cast<T>(out.size() ? out.size() : 1);

        // Backprop through layers L-1 .. 0.
        std::vector<T> nextDelta;
        for (size_t li = L; li-- > 0;) {
            const auto& prevAct = acts[li];          // input activations to layer li
            auto& layer = weights_[li];
            const bool is_output = (li + 1 == L);
            // Compute delta to propagate to the previous layer (excludes bias node).
            const size_t prevSize = prevAct.size();   // includes bias slot
            std::vector<T> propagate(prevSize, 0);
            for (size_t nidx = 0; nidx < layer.size(); ++nidx) {
                const T d = delta[nidx];
                auto& w = layer[nidx];
                const size_t lim = std::min(w.size(), prevSize);
                for (size_t k = 0; k < lim; ++k) {
                    propagate[k] += d * w[k];
                    w[k] -= lr * d * prevAct[k];     // gradient step
                }
            }
            // Turn `propagate` into next-layer delta via ReLU' (skip for input).
            if (li > 0) {
                const auto& actPrev = acts[li];       // activations of layer li-1's output
                nextDelta.assign(actPrev.size(), 0);
                for (size_t k = 0; k < actPrev.size(); ++k) {
                    const T relud = actPrev[k] > 0 ? static_cast<T>(1) : static_cast<T>(0);
                    nextDelta[k] = propagate[k] * relud;
                }
                // Drop the trailing bias slot's delta (it has no upstream weights).
                if (!nextDelta.empty()) nextDelta.pop_back();
                delta = nextDelta;
            }
            (void)is_output;
        }
        return loss;
    }

    std::vector<size_t> layers_nodes_;
    mlp_weights weights_;
    mutable DetRng rng_;
};

// ── Dataset (FIFO ring, max 100 examples) ─────────────────────────────
template<typename T = float>
class Dataset {
public:
    static constexpr size_t kMax_examples = 100;
    void add(const std::vector<T>& feat, const std::vector<T>& label) {
        if (features_.size() >= kMax_examples) {
            features_.erase(features_.begin());
            labels_.erase(labels_.begin());
        }
        features_.push_back(feat);
        labels_.push_back(label);
    }
    void clear() { features_.clear(); labels_.clear(); }
    size_t count() const { return features_.size(); }
    const std::vector<std::vector<T>>& features() const { return features_; }
    const std::vector<std::vector<T>>& labels() const { return labels_; }
    void load(const std::vector<std::vector<T>>& f, const std::vector<std::vector<T>>& l) {
        clear();
        const size_t n = std::min(f.size(), l.size());
        for (size_t i = 0; i < n; ++i) add(f[i], l[i]);
    }
private:
    std::vector<std::vector<T>> features_;
    std::vector<std::vector<T>> labels_;
};

// ── IML ───────────────────────────────────────────────────────────────
template<typename Float = float>
class IML {
public:
    enum class Mode { Inference, Training };

    IML(size_t n_inputs, size_t n_outputs,
        std::vector<size_t> hidden_layers = {16, 24, 16},
        size_t max_iterations = 200,
        Float learning_rate = static_cast<Float>(0.1),
        Float convergence_threshold = static_cast<Float>(0.00001),
        uint32_t seed = 0xC0FFEEu)
        : n_inputs_(n_inputs), n_outputs_(n_outputs),
          max_iterations_(max_iterations), learning_rate_(learning_rate),
          convergence_threshold_(convergence_threshold) {
        std::vector<size_t> sizes;
        sizes.push_back(n_inputs_ + 1); // + bias
        for (size_t h : hidden_layers) sizes.push_back(h);
        sizes.push_back(n_outputs_);
        mlp_ = std::make_unique<MLP<Float>>(sizes, seed);
        input_state_.assign(n_inputs_, static_cast<Float>(0.5));
        output_state_.assign(n_outputs_, static_cast<Float>(0));
    }

    size_t num_inputs() const { return n_inputs_; }
    size_t num_outputs() const { return n_outputs_; }

    void set_input(size_t i, Float v) {
        if (i >= n_inputs_) return;
        input_state_[i] = std::clamp(v, static_cast<Float>(0), static_cast<Float>(1));
        input_updated_ = true;
    }

    const Float* get_outputs() const { return output_state_.data(); }

    void process() {
        if (!input_updated_) return;
        std::vector<Float> in = input_state_;
        in.push_back(static_cast<Float>(1));
        mlp_->forward(in, output_state_);
        if (output_state_.size() < n_outputs_) output_state_.resize(n_outputs_, 0);
        input_updated_ = false;
    }

    void set_mode(Mode m) {
        if (m == Mode::Inference && mode_ == Mode::Training) train_();
        mode_ = m;
    }
    Mode get_mode() const { return mode_; }

    void add_example(const Float* inputs, size_t n_in, const Float* outputs, size_t n_out) {
        std::vector<Float> in(inputs, inputs + std::min(n_in, n_inputs_));
        in.resize(n_inputs_, static_cast<Float>(0));
        std::vector<Float> out(outputs, outputs + std::min(n_out, n_outputs_));
        out.resize(n_outputs_, static_cast<Float>(0));
        dataset_.add(in, out);
    }
    void clear_dataset() { dataset_.clear(); }

    void randomise_weights(Float spread) { mlp_->draw_weights_spread(spread); refresh_(); }
    void move_weights(Float speed, Float spread) { mlp_->move_weights_spread(speed, spread); refresh_(); }

    typename MLP<Float>::mlp_weights get_weights() const { return mlp_->get_weights(); }
    void set_weights(typename MLP<Float>::mlp_weights& w) { mlp_->set_weights(w); }

    size_t get_example_count() const { return dataset_.count(); }
    size_t get_max_examples() const { return Dataset<Float>::kMax_examples; }
    std::vector<std::vector<Float>> get_example_features() const { return dataset_.features(); }
    std::vector<std::vector<Float>> get_example_labels() const { return dataset_.labels(); }
    void load_examples(const std::vector<std::vector<Float>>& f,
                       const std::vector<std::vector<Float>>& l) { dataset_.load(f, l); }

    Float nearest_example_distance(const Float* input, size_t n_in) const {
        const auto& feats = dataset_.features();
        if (feats.empty()) return static_cast<Float>(-1);
        Float best = std::numeric_limits<Float>::max();
        const size_t dims = std::min(n_in, n_inputs_);
        for (const auto& f : feats) {
            Float d = 0;
            for (size_t k = 0; k < dims && k < f.size(); ++k) {
                const Float diff = f[k] - input[k];
                d += diff * diff;
            }
            best = std::min(best, std::sqrt(d));
        }
        return best;
    }

private:
    void refresh_() { input_updated_ = true; process(); }
    void train_() {
        if (dataset_.count() == 0) return;
        mlp_->train(dataset_.features(), dataset_.labels(),
                    static_cast<int>(max_iterations_), learning_rate_,
                    convergence_threshold_);
        refresh_();
    }

    size_t n_inputs_, n_outputs_, max_iterations_;
    Float learning_rate_, convergence_threshold_;
    Mode mode_ = Mode::Inference;
    bool input_updated_ = false;
    std::vector<Float> input_state_, output_state_;
    Dataset<Float> dataset_;
    std::unique_ptr<MLP<Float>> mlp_;
};

} // namespace nisps
