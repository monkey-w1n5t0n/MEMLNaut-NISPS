#ifndef NISPS_IML_IMPL_HPP
#define NISPS_IML_IMPL_HPP

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

} // namespace nisps

#endif // NISPS_IML_IMPL_HPP
