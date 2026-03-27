#ifndef NISPS_IML_IMPL_HPP
#define NISPS_IML_IMPL_HPP

#include <limits>
#include <cmath>

namespace nisps {

template<typename Float>
IML<Float>::IML(size_t n_inputs, size_t n_outputs,
                std::vector<size_t> hidden_layers,
                size_t max_iterations,
                Float learning_rate,
                Float convergence_threshold)
    : n_inputs_(n_inputs)
    , n_outputs_(n_outputs)
    , max_iterations_(max_iterations)
    , learning_rate_(learning_rate)
    , convergence_threshold_(convergence_threshold)
{
    // Build layer sizes: input + hidden + output
    const size_t kBias = 1;
    std::vector<size_t> layer_sizes;
    layer_sizes.push_back(n_inputs + kBias);
    for (size_t h : hidden_layers) {
        layer_sizes.push_back(h);
    }
    layer_sizes.push_back(n_outputs);

    // Activation functions: RELU for hidden, SIGMOID for output
    std::vector<ACTIVATION_FUNCTIONS> activations;
    for (size_t i = 0; i < hidden_layers.size(); ++i) {
        activations.push_back(RELU);
    }
    activations.push_back(SIGMOID);

    dataset_ = std::make_unique<Dataset>();
    mlp_ = std::make_unique<MLP<Float>>(
        layer_sizes,
        activations,
        loss::LOSS_MSE,
        false,  // use_constant_weight_init
        0.0f    // constant_weight_init
    );

    input_state_.resize(n_inputs, static_cast<Float>(0.5));
    output_state_.resize(n_outputs, static_cast<Float>(0));
}

template<typename Float>
void IML<Float>::set_input(size_t index, Float value) {
    if (index >= n_inputs_) return;
    if (value < 0) value = 0;
    if (value > 1) value = 1;
    input_state_[index] = value;
    input_updated_ = true;
}

template<typename Float>
void IML<Float>::set_inputs(const Float* values, size_t count) {
    for (size_t i = 0; i < count && i < n_inputs_; ++i) {
        set_input(i, values[i]);
    }
}

template<typename Float>
const Float* IML<Float>::get_outputs() const {
    return output_state_.data();
}

template<typename Float>
void IML<Float>::set_output(size_t index, Float value) {
    if (index >= n_outputs_) return;
    if (value < 0) value = 0;
    if (value > 1) value = 1;
    output_state_[index] = value;
}

template<typename Float>
void IML<Float>::set_outputs(const Float* values, size_t count) {
    for (size_t i = 0; i < count && i < n_outputs_; ++i) {
        set_output(i, values[i]);
    }
}

template<typename Float>
void IML<Float>::process() {
    if (!perform_inference_ || !input_updated_) return;

    // Add bias term
    std::vector<Float> input_with_bias = input_state_;
    input_with_bias.push_back(static_cast<Float>(1.0));

    // Run inference
    std::vector<Float> output(n_outputs_);
    mlp_->GetOutput(input_with_bias, &output);

    output_state_ = output;
    input_updated_ = false;
}

template<typename Float>
void IML<Float>::set_mode(Mode mode) {
    if (mode == Mode::Inference && mode_ == Mode::Training) {
        train();
    }
    mode_ = mode;
}

template<typename Float>
void IML<Float>::save_example() {
    // First call: stop inference, user will position output
    if (perform_inference_) {
        perform_inference_ = false;
        log("Move to desired output position...");
        return;
    }

    // Second call: store the example
    dataset_->Add(input_state_, output_state_);
    perform_inference_ = true;

    // Run inference with new example
    std::vector<Float> input_with_bias = input_state_;
    input_with_bias.push_back(static_cast<Float>(1.0));
    std::vector<Float> output(n_outputs_);
    mlp_->GetOutput(input_with_bias, &output);
    output_state_ = output;

    log("Example saved.");
}

template<typename Float>
void IML<Float>::add_example(const Float* inputs, size_t n_in, const Float* outputs, size_t n_out) {
    std::vector<Float> in_vec(inputs, inputs + std::min(n_in, n_inputs_));
    in_vec.resize(n_inputs_, static_cast<Float>(0));
    std::vector<Float> out_vec(outputs, outputs + std::min(n_out, n_outputs_));
    out_vec.resize(n_outputs_, static_cast<Float>(0));
    dataset_->Add(in_vec, out_vec);
}

template<typename Float>
void IML<Float>::clear_dataset() {
    if (mode_ == Mode::Training) {
        dataset_->Clear();
        log("Dataset cleared.");
    }
}

template<typename Float>
void IML<Float>::randomise_weights() {
    if (mode_ == Mode::Training) {
        stored_weights_ = mlp_->GetWeights();
        mlp_->DrawWeights();
        weights_randomised_ = true;

        // Run inference to show effect
        std::vector<Float> input_with_bias = input_state_;
        input_with_bias.push_back(static_cast<Float>(1.0));
        std::vector<Float> output(n_outputs_);
        mlp_->GetOutput(input_with_bias, &output);
        output_state_ = output;

        log("Weights randomised.");
    }
}

template<typename Float>
void IML<Float>::randomise_weights(Float spread) {
    if (mode_ == Mode::Training) {
        stored_weights_ = mlp_->GetWeights();
        mlp_->DrawWeightsSpread(spread);
        weights_randomised_ = true;

        // Run inference to show effect
        std::vector<Float> input_with_bias = input_state_;
        input_with_bias.push_back(static_cast<Float>(1.0));
        std::vector<Float> output(n_outputs_);
        mlp_->GetOutput(input_with_bias, &output);
        output_state_ = output;

        log("Weights randomised (spread).");
    }
}

template<typename Float>
void IML<Float>::move_weights(Float speed, Float spread) {
    mlp_->MoveWeightsSpread(speed, spread);

    // Run inference to show effect of perturbation
    input_updated_ = true;
    process();
}

template<typename Float>
void IML<Float>::train() {
    // Restore weights if they were randomised
    if (weights_randomised_) {
        mlp_->SetWeights(stored_weights_);
        weights_randomised_ = false;
    }

    auto features = dataset_->GetFeatures(true);  // with bias
    auto& labels = dataset_->GetLabels();

    if (features.empty() || labels.empty()) {
        log("Empty dataset, skipping training.");
        return;
    }

    typename MLP<Float>::training_pair_t training_data(features, labels);

    log("Training...");
    Float loss = mlp_->Train(
        training_data,
        learning_rate_,
        static_cast<int>(max_iterations_),
        convergence_threshold_,
        false  // output_log
    );

    // Run inference after training
    std::vector<Float> input_with_bias = input_state_;
    input_with_bias.push_back(static_cast<Float>(1.0));
    std::vector<Float> output(n_outputs_);
    mlp_->GetOutput(input_with_bias, &output);
    output_state_ = output;

    log("Training complete.");
}

// ── Serialization accessors ───────────────────────────────────────

template<typename Float>
typename MLP<Float>::mlp_weights IML<Float>::get_weights() const {
    return mlp_->GetWeights();
}

template<typename Float>
void IML<Float>::set_weights(typename MLP<Float>::mlp_weights& weights) {
    mlp_->SetWeights(weights);
}

template<typename Float>
size_t IML<Float>::get_example_count() const {
    Dataset::DatasetVector* feats;
    Dataset::DatasetVector* labels;
    const_cast<Dataset*>(dataset_.get())->Fetch(feats, labels);
    return feats ? feats->size() : 0;
}

template<typename Float>
size_t IML<Float>::get_max_examples() const {
    return Dataset::kMax_examples;
}

template<typename Float>
std::vector<std::vector<Float>> IML<Float>::get_example_features() const {
    auto feats = const_cast<Dataset*>(dataset_.get())->GetFeatures(false);
    std::vector<std::vector<Float>> result;
    result.reserve(feats.size());
    for (auto& f : feats) {
        result.emplace_back(f.begin(), f.end());
    }
    return result;
}

template<typename Float>
std::vector<std::vector<Float>> IML<Float>::get_example_labels() const {
    auto& labels = const_cast<Dataset*>(dataset_.get())->GetLabels();
    std::vector<std::vector<Float>> result;
    result.reserve(labels.size());
    for (auto& l : labels) {
        result.emplace_back(l.begin(), l.end());
    }
    return result;
}

template<typename Float>
void IML<Float>::load_examples(const std::vector<std::vector<Float>>& features,
                                const std::vector<std::vector<Float>>& labels) {
    dataset_->Clear();
    size_t count = std::min(features.size(), labels.size());
    for (size_t i = 0; i < count; i++) {
        std::vector<float> feat(features[i].begin(), features[i].end());
        std::vector<float> label(labels[i].begin(), labels[i].end());
        dataset_->Add(feat, label);
    }
}

template<typename Float>
Float IML<Float>::nearest_example_distance(const Float* input, size_t n_in) const {
    auto feats = const_cast<Dataset*>(dataset_.get())->GetFeatures(false);
    if (feats.empty()) return static_cast<Float>(-1);

    Float minDist = std::numeric_limits<Float>::max();
    size_t dims = std::min(n_in, n_inputs_);
    for (auto& f : feats) {
        Float dist = 0;
        for (size_t d = 0; d < dims && d < f.size(); d++) {
            Float diff = static_cast<Float>(f[d]) - input[d];
            dist += diff * diff;
        }
        dist = std::sqrt(dist);
        if (dist < minDist) minDist = dist;
    }
    return minDist;
}

} // namespace nisps

#endif // NISPS_IML_IMPL_HPP
