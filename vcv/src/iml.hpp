// iml.hpp — THIN adapter over the real NISPS core for the MEMLNaut VCV module.
//
// P6 REUNIFICATION (one-core-engine-refactor, 2026-07-18): this file USED to
// be a self-contained, vendored runtime MLP (a `DetRng` + 3D-weight-store MLP
// with a trailing-bias-node model + its own Dataset). That vendored copy has
// been DELETED. The module now consumes the shared engine directly:
//
//   • `nisps::ml::MLPCore<nisps::ml::DynamicStorage>` — the runtime-shaped
//     branch of the ONE core MLP (fixed 4-layer topology: ReLU×3 + Sigmoid,
//     three runtime hidden sizes). This is exactly the P2 dynamic case.
//   • `nisps::Rng` (nisps/core/rng.hpp, xoshiro256+) — owned by MLPCore,
//     replacing the vendored `DetRng` (xorshift128).
//   • The core MLP's own FIFO dataset (add_example / train / clear_examples),
//     replacing the vendored `Dataset`.
//
// BEHAVIOUR CHANGED (this is the point of the phase): outputs are no longer the
// vendored *approximation* of firmware/browser training semantics — they are
// now CORE-EXACT. Weight init, RL `move_weights`, SGD training, activations and
// RNG are bit-identical to what the firmware and the WASM/browser build run
// (see tests/cpp/test_vcv_iml_parity.cpp, which pins adapter == direct
// MLPCore<DynamicStorage> bit-for-bit). Old `.nisps`/patch weight blobs written
// by the vendored 3D model will NOT load — the persisted weight vector is now
// the core's FLAT [weights…][biases…] layout (patch `version` bumped to 3).
//
// This adapter includes ONLY nisps headers + the standard library (no Rack
// includes) so the host ctest can compile it standalone. It keeps the public
// surface as close to the old vendored `IML` as practical so `MEMLNaut.cpp`
// stays mechanical; the one deliberate surface change is `get_weights` /
// `set_weights`, which now speak the core's flat `std::vector<float>` instead
// of the old 3D `mlp_weights` node tree.
//
// MPL-2.0 in spirit with the rest of nisps; wrapper code under the VCV module's
// licence. British spelling in comments where it reads naturally.
#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <span>
#include <vector>

#include "../../nisps/core/rng.hpp"
#include "../../nisps/ml/dynamic_storage.hpp"
#include "../../nisps/ml/mlp.hpp"
#include "../../nisps/ml/generated/ml_defaults.hpp"

namespace nisps {

// ── IML — runtime-shaped interactive-ML adapter ───────────────────────
//
// One instance owns one `MLPCore<DynamicStorage>` (its own weights, RNG and
// dataset — nothing is shared). The MEMLNaut module keeps two instances (an
// audio-thread `iml` and a worker-thread `imlShadow`) and hands flat weight
// snapshots between them; because each instance is fully self-contained the
// core's lack of internal locking is fine — the module's single-writer
// double-buffer discipline is preserved around this adapter unchanged.
template <typename Float = float>
class IML {
    static_assert(std::is_same<Float, float>::value,
                  "the shared MLP core is float-only");

   public:
    // Flat weight vector: the core's [layer0_w … layer3_w][layer0_b … layer3_b]
    // layout. Cheap to copy between the audio and worker threads.
    using Weights = std::vector<float>;
    using Examples = std::vector<std::vector<float>>;

    enum class Mode { Inference, Training };

    // Matches the old vendored capacity so `get_max_examples()` and the FIFO
    // eviction threshold are unchanged for the UI / persistence.
    static constexpr std::size_t kMaxExamples = 100u;

    // Signature mirrors the old vendored IML so the module's construction sites
    // are unchanged. `hidden` MUST carry exactly three sizes (the core topology
    // is fixed at three hidden layers); fewer are padded from the default,
    // extras ignored.
    // BEHAVIOUR CHANGE (S26, docs/specs/recon/simplification-audit-2026-07.md):
    // these three defaults used to be private to this adapter (200 / 0.1 /
    // 0.00001) and disagreed with the firmware/WASM default (1000 / 1.0 /
    // 0.001) that every other target already used. They now come from the
    // ONE shared generated constant (schemas/ml_defaults.json ->
    // nisps::ml::generated::kMlTrainDefaults) instead of a private copy.
    // `MEMLNaut.cpp` constructs `IML` with only 3 positional args, so this is
    // a REAL runtime behaviour change for the module: 5x more max iterations,
    // 10x the learning rate, and a 100x looser (larger) early-stop threshold.
    explicit IML(std::size_t n_inputs, std::size_t n_outputs,
                 std::vector<std::size_t> hidden = {16u, 24u, 16u},
                 std::size_t max_iterations =
                     ::nisps::ml::generated::kMlTrainDefaults.max_iterations,
                 Float learning_rate = static_cast<Float>(
                     ::nisps::ml::generated::kMlTrainDefaults.learning_rate),
                 Float convergence_threshold = static_cast<Float>(
                     ::nisps::ml::generated::kMlTrainDefaults.min_error),
                 std::uint64_t seed = 0xC0FFEEu)
        : n_inputs_(n_inputs),
          n_outputs_(n_outputs),
          max_iterations_(max_iterations),
          learning_rate_(learning_rate),
          convergence_threshold_(convergence_threshold),
          hidden_(to_hidden3_(hidden)),
          core_(seed, n_inputs, std::span<const std::size_t>(hidden_.data(), hidden_.size()),
                n_outputs, kMaxExamples, max_iterations) {}

    std::size_t num_inputs() const { return n_inputs_; }
    std::size_t num_outputs() const { return n_outputs_; }

    // ── Inference ─────────────────────────────────────────────────────
    void set_input(std::size_t i, Float v) { core_.set_input(i, v); }
    void process() { core_.process(); }
    const Float* get_outputs() const { return core_.outputs().data(); }

    // ── Mode / training ───────────────────────────────────────────────
    // Preserves the vendored two-step semantics the module relies on: a
    // Training→Inference transition trains the network over the current
    // dataset. (The module drives this on both the audio `iml` — for immediate
    // local feedback — and the worker `imlShadow`.)
    void set_mode(Mode m) {
        if (m == Mode::Inference && mode_ == Mode::Training) train_();
        mode_ = m;
    }
    Mode get_mode() const { return mode_; }

    // Direct training entry (used by the parity test); returns final epoch loss.
    float train() {
        if (features_.empty()) return 0.f;
        return core_.train(learning_rate_, max_iterations_, convergence_threshold_);
    }

    // ── Dataset ───────────────────────────────────────────────────────
    void add_example(const Float* inputs, std::size_t n_in,
                     const Float* outputs, std::size_t n_out) {
        std::vector<float> in(n_inputs_, 0.f);
        for (std::size_t i = 0; i < n_inputs_ && i < n_in; ++i) in[i] = inputs[i];
        std::vector<float> out(n_outputs_, 0.f);
        for (std::size_t i = 0; i < n_outputs_ && i < n_out; ++i) out[i] = outputs[i];
        add_example_(in, out);
    }
    void clear_dataset() {
        features_.clear();
        labels_.clear();
        core_.clear_examples();
    }
    std::size_t get_example_count() const { return core_.example_count(); }
    std::size_t get_max_examples() const { return kMaxExamples; }
    Examples get_example_features() const { return features_; }
    Examples get_example_labels() const { return labels_; }
    void load_examples(const Examples& f, const Examples& l) {
        clear_dataset();
        const std::size_t n = std::min(f.size(), l.size());
        for (std::size_t i = 0; i < n; ++i) {
            std::vector<float> in(n_inputs_, 0.f);
            for (std::size_t k = 0; k < n_inputs_ && k < f[i].size(); ++k) in[k] = f[i][k];
            std::vector<float> out(n_outputs_, 0.f);
            for (std::size_t k = 0; k < n_outputs_ && k < l[i].size(); ++k) out[k] = l[i][k];
            add_example_(in, out);
        }
    }

    // ── RL / weight ops ───────────────────────────────────────────────
    void randomise_weights(Float spread) { core_.draw_weights(spread); }
    void move_weights(Float speed, Float spread,
                      std::span<const std::uint8_t> pin_mask = {}) {
        core_.move_weights(speed, spread, pin_mask);
    }

    // ── Flat weight get/set (core-exact layout) ───────────────────────
    // Non-const: the core regenerates a scratch copy on each `get_weights`.
    Weights get_weights() {
        auto s = core_.get_weights();
        return Weights(s.begin(), s.end());
    }
    void set_weights(const Weights& w) {
        core_.set_weights(std::span<const float>(w.data(), w.size()));
    }

    // Novelty helper (used for the display / derived outputs) — nearest
    // Euclidean distance from `input` to any stored example, or -1 when empty.
    Float nearest_example_distance(const Float* input, std::size_t n_in) const {
        if (features_.empty()) return static_cast<Float>(-1);
        Float best = std::numeric_limits<Float>::max();
        const std::size_t dims = std::min(n_in, n_inputs_);
        for (const auto& f : features_) {
            Float d = 0;
            for (std::size_t k = 0; k < dims && k < f.size(); ++k) {
                const Float diff = f[k] - input[k];
                d += diff * diff;
            }
            best = std::min(best, static_cast<Float>(std::sqrt(d)));
        }
        return best;
    }

    // Training parameters (exposed so a parity harness can drive a bare
    // MLPCore with the same values the adapter's `train()` uses).
    float train_lr() const { return learning_rate_; }
    std::size_t train_max_iter() const { return max_iterations_; }
    float train_min_err() const { return convergence_threshold_; }

   private:
    static std::array<std::size_t, 3> to_hidden3_(const std::vector<std::size_t>& h) {
        std::array<std::size_t, 3> a{16u, 24u, 16u};
        for (std::size_t i = 0; i < 3u && i < h.size(); ++i) a[i] = h[i];
        return a;
    }

    // Adds to the core dataset AND to the insertion-order mirror. The mirror
    // exists because MLPCore's FIFO ring keeps its head index private and its
    // slot order scrambles once the buffer fills — but the module needs the
    // examples enumerable *in insertion order* for JSON persistence and for
    // cross-thread staging (get_example_features/labels → load_examples). The
    // core stays the single source of truth for TRAINING; the mirror is purely
    // a serialisation/enumeration view and never feeds the network. Both evict
    // at kMaxExamples so counts stay equal.
    void add_example_(const std::vector<float>& in, const std::vector<float>& out) {
        if (features_.size() >= kMaxExamples) {
            features_.erase(features_.begin());
            labels_.erase(labels_.begin());
        }
        features_.push_back(in);
        labels_.push_back(out);
        core_.add_example(std::span<const float>(in.data(), in.size()),
                          std::span<const float>(out.data(), out.size()));
    }

    void train_() {
        if (features_.empty()) return;
        core_.train(learning_rate_, max_iterations_, convergence_threshold_);
    }

    std::size_t n_inputs_;
    std::size_t n_outputs_;
    std::size_t max_iterations_;
    Float learning_rate_;
    Float convergence_threshold_;
    std::array<std::size_t, 3> hidden_;
    nisps::ml::MLPCore<nisps::ml::DynamicStorage> core_;
    Mode mode_ = Mode::Inference;
    Examples features_;
    Examples labels_;
};

}  // namespace nisps
