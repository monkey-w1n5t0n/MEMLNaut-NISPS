/**
 * @file mlp_impl.hpp
 * @brief Multi-layer perceptron implementation
 * @copyright Copyright (c) 2024. Licensed under Mozilla Public License Version 2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * This code is derived from David Alberto Nogueira's MLP project:
 * https://github.com/davidalbertonogueira/MLP
 * Original author: David Nogueira
 */

#ifndef NISPS_MLP_IMPL_HPP
#define NISPS_MLP_IMPL_HPP

#include <stdio.h>
#include <stdlib.h>
#include <sstream>
#include <fstream>
#include <vector>
#include <algorithm>
#include <cassert>
#include <random>

// #define SAFE_MODE


//desired call syntax :  MLP({64*64,20,4}, {"sigmoid", "linear"},
namespace nisps {

template<typename T>
MLP<T>::MLP(const std::vector<size_t> & layers_nodes,
         const std::vector<ACTIVATION_FUNCTIONS> & layers_activfuncs,
         loss::LOSS_FUNCTIONS loss_function,
         bool use_constant_weight_init,
         T constant_weight_init) : g(rd()) {
#ifdef SAFE_MODE
  assert(layers_nodes.size() >= 2);
  assert(layers_activfuncs.size() + 1 == layers_nodes.size());
#endif

  CreateMLP(layers_nodes,
            layers_activfuncs,
            loss_function,
            use_constant_weight_init,
            constant_weight_init);
};


template<typename T>
MLP<T>::MLP(const std::string & filename) {
  if (!LoadMLPNetwork(filename)) {
    // If loading fails, we need to have a valid but empty network
    // Initialize with minimal valid configuration
    m_num_inputs = 0;
    m_num_outputs = 0;
    m_num_hidden_layers = 0;
    m_layers_nodes.clear();
    m_layers.clear();
    // Consider throwing an exception or setting an error flag here
    // For now, we'll have an invalid network that should be checked
  }
}


template<typename T>
MLP<T>::~MLP() {
  m_num_inputs = 0;
  m_num_outputs = 0;
  m_num_hidden_layers = 0;
  m_layers_nodes.clear();
  m_layers.clear();
};


template<typename T>
void MLP<T>::CreateMLP(const std::vector<size_t> & layers_nodes,
                    const std::vector<ACTIVATION_FUNCTIONS> & layers_activfuncs,
                    loss::LOSS_FUNCTIONS loss_function,
                    bool use_constant_weight_init,
                    T constant_weight_init) {
    m_layers_nodes = layers_nodes;
    m_num_inputs = m_layers_nodes[0];
    m_num_outputs = m_layers_nodes[m_layers_nodes.size() - 1];
    m_num_hidden_layers = m_layers_nodes.size() - 2;

    // Store loss function type for inference decisions
    m_loss_function_type = loss_function;

    // Loss function selection
    loss::LossFunctionsManager<T> loss_mgr =
        loss::LossFunctionsManager<T>::Singleton();
    assert(loss_mgr.GetLossFunction(loss_function, &(this->loss_fn_)));

    for (size_t i = 0; i < m_layers_nodes.size() - 1; i++) {
        m_layers.emplace_back(Layer<T>(m_layers_nodes[i],
                                    m_layers_nodes[i + 1],
                                    layers_activfuncs[i],
                                    use_constant_weight_init,
                                    constant_weight_init));
    }
}


template<typename T>
void MLP<T>::ReportProgress(const bool output_log,
    const unsigned int every_n_iter,
    const unsigned int i,
    const T sampleLoss)
{
    if (output_log && ((i % every_n_iter) == 0)) {
        NISPS_DEBUG_PRINTF("Iteration %u cost function f(error): %f\n",
                i, static_cast<double>(sampleLoss));
    }
}


template<typename T>
void MLP<T>::ReportFinish(const unsigned int i, const float current_iteration_cost_function)
{
    NISPS_DEBUG_PRINTF("Iteration %u cost function f(error): %f\n",
        i, static_cast<double>(current_iteration_cost_function));

    NISPS_DEBUG_PRINTLN("******************************");
    NISPS_DEBUG_PRINTLN("******* TRAINING ENDED *******");
    NISPS_DEBUG_PRINTF("******* %d iters *******\n", i);
    NISPS_DEBUG_PRINTLN("******************************");
};


template<typename T>
bool MLP<T>::SaveMLPNetwork(const std::string & filename) const {
    FILE * file = fopen(filename.c_str(), "wb");
    if (!file) {
        return false;
    }

    // Write network structure
    if (fwrite(&m_num_inputs, sizeof(m_num_inputs), 1, file) != 1) {
        fclose(file);
        return false;
    }
    if (fwrite(&m_num_outputs, sizeof(m_num_outputs), 1, file) != 1) {
        fclose(file);
        return false;
    }
    if (fwrite(&m_num_hidden_layers, sizeof(m_num_hidden_layers), 1, file) != 1) {
        fclose(file);
        return false;
    }

    // Write layer nodes
    if (!m_layers_nodes.empty()) {
        if (fwrite(&m_layers_nodes[0], sizeof(m_layers_nodes[0]), m_layers_nodes.size(), file) != m_layers_nodes.size()) {
            fclose(file);
            return false;
        }
    }

    // Write layer weights
    for (size_t i = 0; i < m_layers.size(); i++) {
        if (!m_layers[i].SaveLayer(file)) {
            fclose(file);
            return false;
        }
    }

    fclose(file);
    return true;
}

template<typename T>
bool MLP<T>::LoadMLPNetwork(const std::string & filename) {
    // Check if file exists
    FILE * file = fopen(filename.c_str(), "rb");
    if (!file) {
        return false;
    }

    // Clear existing network
    m_layers_nodes.clear();
    m_layers.clear();

    // Read network structure
    if (fread(&m_num_inputs, sizeof(m_num_inputs), 1, file) != 1) {
        fclose(file);
        return false;
    }
    if (fread(&m_num_outputs, sizeof(m_num_outputs), 1, file) != 1) {
        fclose(file);
        return false;
    }
    if (fread(&m_num_hidden_layers, sizeof(m_num_hidden_layers), 1, file) != 1) {
        fclose(file);
        return false;
    }

    // Read layer nodes
    m_layers_nodes.resize(m_num_hidden_layers + 2);
    if (!m_layers_nodes.empty()) {
        if (fread(&m_layers_nodes[0], sizeof(m_layers_nodes[0]), m_layers_nodes.size(), file) != m_layers_nodes.size()) {
            fclose(file);
            return false;
        }
    }

    // Read layer weights
    m_layers.resize(m_layers_nodes.size() - 1);
    for (size_t i = 0; i < m_layers.size(); i++) {
        if (!m_layers[i].LoadLayer(file)) {
            fclose(file);
            return false;
        }
    }

    fclose(file);
    return true;
}



// Serialization methods commented out - not needed for nisps-core basic functionality
// Uncomment and implement if binary serialization is required
/*
template <typename T>
size_t MLP<T>::Serialise(size_t w_head, std::vector<uint8_t> &buffer)
{
    for (unsigned int n = 0; n < m_layers.size(); n++) {
        auto layer_weights = GetLayerWeights(n);
        w_head = Serialise::FromVector2D(w_head, layer_weights, buffer);
    }
    return w_head;
}


template <typename T>
size_t MLP<T>::FromSerialised(size_t r_head, const std::vector<uint8_t> &buffer)
{
    for (unsigned int n = 0; n < m_layers.size(); n++) {
        std::vector< std::vector<T> > layer_weights;
        r_head = Serialise::ToVector2D(r_head, buffer, layer_weights);
        SetLayerWeights(n, layer_weights);
    }
    return r_head;
};
*/


template<typename T>
void MLP<T>::GetOutput(const std::vector<T> &input,
                    std::vector<T> * output,
                    std::vector<std::vector<T>> * all_layers_activations,
                    bool for_inference) {
    // Add safety check
    if (input.size() != m_num_inputs) {
        NISPS_DEBUG_PRINTF("ERROR: input.size()=%zu != m_num_inputs=%zu\n",
                          input.size(), m_num_inputs);
        return;
    }

    int temp_size;
    if (m_num_hidden_layers == 0)
        temp_size = m_num_outputs;
    else
        temp_size = m_layers_nodes[1];

    // Pre-allocate with capacity to avoid reallocations
    std::vector<T> temp_in;
    temp_in.reserve(m_num_inputs);
    temp_in = input;

    std::vector<T> temp_out;
    temp_out.reserve(temp_size);

    for (size_t i = 0; i < m_layers.size(); ++i) {
        if (i > 0) {
            //Store this layer activation
            if (all_layers_activations != nullptr)
                all_layers_activations->emplace_back(std::move(temp_in));

            temp_in.clear();
            temp_in = temp_out;
            temp_out.clear();
            temp_out.resize(m_layers[i].GetOutputSize());
        }
        m_layers[i].GetOutputAfterActivationFunction(temp_in, &temp_out);
    }

    // Apply softmax for inference with categorical cross-entropy
    if (for_inference &&
        m_loss_function_type == loss::LOSS_FUNCTIONS::LOSS_CATEGORICAL_CROSSENTROPY &&
        temp_out.size() > 1) {
        utils::Softmax(&temp_out);
    }

    *output = temp_out;

    //Add last layer activation
    if (all_layers_activations != nullptr)
        all_layers_activations->emplace_back(std::move(temp_in));
}


template<typename T>
void MLP<T>::GetOutputClass(const std::vector<T> &output, size_t * class_id) const {
    utils::GetIdMaxElement(output, class_id);
}


template<typename T>
void MLP<T>::UpdateWeights(const std::vector<std::vector<T>> & all_layers_activations,
                        const std::vector<T> &deriv_error,
                        float learning_rate) {

    std::vector<T> temp_deriv_error = deriv_error;
    std::vector<T> deltas{};
    //m_layers.size() equals (m_num_hidden_layers + 1)
    for (int i = m_num_hidden_layers; i >= 0; --i) {
        m_layers[i].UpdateWeights(all_layers_activations[i], temp_deriv_error, learning_rate, &deltas);
        if (i > 0) {
            temp_deriv_error.clear();
            temp_deriv_error = std::move(deltas);
            deltas.clear();
        }
    }
};

template<typename T>
T MLP<T>::TrainBatch(const training_pair_t& training_sample_set,
                     float learning_rate,
                     int max_iterations,
                     size_t batch_size,
                     float min_error_cost,
                     bool output_log) {

    auto training_features = training_sample_set.first;
    auto training_labels = training_sample_set.second;

    size_t n_samples = training_features.size();
    size_t n_batches = (n_samples + batch_size - 1) / batch_size;

    T epoch_loss = 0;
    for (int iter = 0; iter < max_iterations; iter++) {

        epoch_loss = 0;

        // Shuffle indices
        std::vector<size_t> indices(n_samples);
        std::iota(indices.begin(), indices.end(), 0);

        std::shuffle(indices.begin(), indices.end(), g);

        size_t sample_idx = 0;

        for (size_t batch = 0; batch < n_batches; batch++) {
            size_t current_batch_size = std::min(batch_size, n_samples - sample_idx);
            T batch_size_reciprocal = (T)1.0 / static_cast<T>(current_batch_size);

            // Initialize gradient accumulators
            InitializeAllGradientAccumulators();

            T batch_loss = 0;

            // Pre-allocate vectors outside loop to avoid repeated allocations
            std::vector<T> predicted_output;
            std::vector<std::vector<T>> all_layers_activations;
            std::vector<T> deriv_error_output;

            // Process batch - accumulate gradients
            for (size_t i = 0; i < current_batch_size; i++) {
                size_t idx = indices[sample_idx++];
#ifdef SAFE_MODE
                // Bounds check
                if (idx >= training_features.size()) {
                    NISPS_DEBUG_PRINTF("ERROR: idx %zu >= training_features.size() %zu\n",
                                      idx, training_features.size());
                    continue;
                }
#endif
                // Clear and reuse vectors
                predicted_output.clear();
                all_layers_activations.clear();

                // Forward pass
                // NISPS_DEBUG_PRINTF("Processing sample %zu (idx=%zu), input_size=%zu\n", i, idx, training_features[idx].size());
                GetOutput(training_features[idx],
                         &predicted_output,
                         &all_layers_activations,
                         false);

                // Compute loss and derivatives
                deriv_error_output.clear();
                deriv_error_output.resize(predicted_output.size());
                T loss = loss_fn_(training_labels[idx],
                                 predicted_output,
                                 deriv_error_output,
                                 1.0f);

                #ifdef MLP_ALLOW_DEBUG
                if (std::isinf(loss) || std::isnan(loss)) {
                    NISPS_DEBUG_PRINTF("[MLP DEBUG] *** INF/NAN loss at sample %zu! loss=%f\n",
                                      i, static_cast<double>(loss));
                    NISPS_DEBUG_PRINTF("[MLP DEBUG]   pred[0]=%f, label[0]=%f\n",
                                 static_cast<double>(predicted_output[0]),
                                 static_cast<double>(training_labels[idx][0]));
                }
                #endif

                batch_loss += loss;

                // Accumulate gradients through backpropagation
                BackpropagateWithAccumulation(all_layers_activations,
                                             deriv_error_output,
                                             true);
            }

            // clipping gradients
            T grad_sumsq = 0.0f;
            for (auto& layer : m_layers) {
                grad_sumsq += layer.GetGradSumSquared(batch_size_reciprocal);
            }
            T grad_norm = std::sqrt(grad_sumsq );

            #ifdef MLP_ALLOW_DEBUG
            NISPS_DEBUG_PRINTF("[MLP DEBUG] Batch %zu/%zu: batch_loss=%f, grad_norm=%f\n",
                         batch, n_batches, static_cast<double>(batch_loss / current_batch_size),
                         static_cast<double>(grad_norm));
            if (std::isinf(grad_norm) || std::isnan(grad_norm)) {
                NISPS_DEBUG_PRINTLN("[MLP DEBUG] *** INF/NAN grad_norm! ***");
            }
            #endif

            if (grad_norm > 5.0f) {
                T clip_coef = 5.0f / grad_norm;
                for (auto& layer : m_layers) {
                    layer.ScaleAccumulatedGradients(clip_coef);
                }
                // NISPS_DEBUG_PRINTF("Clipped gradients with coef: %f\n", static_cast<double>(clip_coef));
            }

            // Apply accumulated gradients
            ApplyAllAccumulatedGradients(learning_rate, batch_size_reciprocal);

            epoch_loss += batch_loss / current_batch_size;
        }

        epoch_loss /= n_batches;

        // Periodic weight corruption check (every 10 iterations)
        // if (iter % 10 == 0) {
        //     if (CheckAndFixWeights()) {
        //         #ifdef MLP_ALLOW_DEBUG
        //         NISPS_DEBUG_PRINTF("[MLP DEBUG] *** Weight corruption detected and fixed at iteration %d! ***\n", iter);
        //         #endif
        //         // Optionally reset optimizer state after corruption
        //         // ResetOptimizerState();
        //     }
        // }

        #ifdef MLP_ALLOW_DEBUG
        if (std::isinf(epoch_loss) || std::isnan(epoch_loss)) {
            NISPS_DEBUG_PRINTF("[MLP DEBUG] *** INF/NAN epoch_loss after iteration %d! ***\n", iter);
        }
        #endif

        if (output_log && (iter % 100 == 0)) {
            ReportProgress(output_log, 100, iter, epoch_loss);
        }

        if (m_progress_callback) {
            m_progress_callback(iter, epoch_loss);
        }

        if (epoch_loss < min_error_cost) {
            break;
        }
    }

    #ifdef MLP_ALLOW_DEBUG
    NISPS_DEBUG_PRINTF("[MLP DEBUG] TrainBatch returning epoch_loss=%f (inf=%d, nan=%d)\n",
                 static_cast<double>(epoch_loss),
                 std::isinf(epoch_loss), std::isnan(epoch_loss));
    #endif

    return epoch_loss;
}

template<typename T>
void MLP<T>::BackpropagateWithAccumulation(const std::vector<std::vector<T>>& all_layers_activations,
                                           const std::vector<T>& deriv_error,
                                           bool accumulate) {
    std::vector<T> temp_deriv_error = deriv_error;
    std::vector<T> deltas;

    for (int i = m_num_hidden_layers; i >= 0; --i) {
        m_layers[i].UpdateWeights(all_layers_activations[i],
                                 temp_deriv_error,
                                 0,  // Learning rate not used when accumulating
                                 &deltas,
                                 accumulate);  // Use accumulation flag

        if (i > 0) {
            temp_deriv_error = std::move(deltas);
            deltas.clear();
        }
    }
}

template<typename T>
T MLP<T>::Train(const training_pair_t& training_sample_set_with_bias,
    float learning_rate,
    int max_iterations,
    float min_error_cost,
    bool) {

    int i = 0;
    T current_iteration_cost_function = 0.f;

    T sampleSizeReciprocal = 1.f / training_sample_set_with_bias.first.size();

    for (i = 0; i < max_iterations; i++) {
        current_iteration_cost_function = 0.f;

        auto training_features = training_sample_set_with_bias.first;
        auto training_labels = training_sample_set_with_bias.second;
        auto t_feat = training_features.begin();
        auto t_label = training_labels.begin();

        while (t_feat != training_features.end() || t_label != training_labels.end()) {

            // Payload
            current_iteration_cost_function +=
                _TrainOnExample(*t_feat, *t_label, learning_rate, sampleSizeReciprocal);

            // \Payload
            if (t_feat != training_features.end())
            {
                ++t_feat;
            }
            if (t_label != training_labels.end())
            {
                ++t_label;
            }
        }

        current_iteration_cost_function *= sampleSizeReciprocal;

        ReportProgress(true, 100, i, current_iteration_cost_function);

        if (m_progress_callback && !(i & 0x1F)) { // Call progress callback every 32 iterations
            m_progress_callback(i, current_iteration_cost_function);
        }

        // Early stopping
        // TODO AM early stopping should be optional and metric-dependent
        if (current_iteration_cost_function < min_error_cost) {
            break;
        }

    }

    ReportFinish(i, current_iteration_cost_function);

    if (m_progress_callback) {
        // Final callback to report completion
        m_progress_callback(i, current_iteration_cost_function);
    }

    return current_iteration_cost_function;
};

template <typename T>
void MLP<T>::CalcGradients(std::vector<T> & feat, std::vector<T> & deriv_error_output)
{
    std::vector<T> predicted_output;
    std::vector< std::vector<T> > all_layers_activations;

    GetOutput(feat,
        &predicted_output,
        &all_layers_activations,
        false); // Training mode - no softmax


    // std::vector<T> deriv_error_output(predicted_output.size(), 1.0);

    // UpdateWeights(all_layers_activations,
    //     deriv_error_output,
    //     learning_rate);

    std::vector<T> temp_deriv_error = deriv_error_output;
    std::vector<T> deltas{};
    //m_layers.size() equals (m_num_hidden_layers + 1)
    for (int i = m_num_hidden_layers; i >= 0; --i) {
        m_layers[i].CalcGradients(all_layers_activations[i], temp_deriv_error, &deltas);
        if (i > 0) {
            temp_deriv_error.clear();
            temp_deriv_error = std::move(deltas);
            deltas.clear();
        }else {
            m_layers[0].SetGrads(deltas);
        }
    }

}

template <typename T>
T MLP<T>::_TrainOnExample(std::vector<T> feat,
                          std::vector<T> label,
                          float learning_rate,
                          T sampleSizeReciprocal)
{
    std::vector<T> predicted_output;
    std::vector< std::vector<T> > all_layers_activations;

    GetOutput(feat,
        &predicted_output,
        &all_layers_activations,
        false); // Training mode - no softmax

    const std::vector<T>& correct_output{ label };

    assert(correct_output.size() == predicted_output.size());
    std::vector<T> deriv_error_output(predicted_output.size());

    // Loss function
    T current_iteration_cost_function =
        this->loss_fn_(correct_output, predicted_output,
        deriv_error_output, sampleSizeReciprocal);

    UpdateWeights(all_layers_activations,
        deriv_error_output,
        learning_rate);

    return current_iteration_cost_function;
}

template <typename T>
void MLP<T>::ApplyLoss(std::vector<T> feat,
                          std::vector<T> loss,
                          float learning_rate)
{
    std::vector<T> predicted_output;
    std::vector< std::vector<T> > all_layers_activations;

    GetOutput(feat,
        &predicted_output,
        &all_layers_activations,
        false); // Training mode - no softmax

    assert(loss.size() == predicted_output.size());

    UpdateWeights(all_layers_activations,
        loss,
        learning_rate);
}

// template<typename T>
// void MLP<T>::ApplyPolicyGradient(const std::vector<T>& state,
//                                   const std::vector<T>& action_gradient,
//                                   float learning_rate) {
//     std::vector<T> predicted_output;
//     std::vector<std::vector<T>> all_layers_activations;

//     // Forward pass
//     GetOutput(state, &predicted_output, &all_layers_activations, false);

//     // Negate gradients for maximization
//     std::vector<T> neg_gradient(action_gradient.size());
//     for(size_t i = 0; i < action_gradient.size(); i++) {
//         neg_gradient[i] = -action_gradient[i];
//     }

//     // Backprop
//     UpdateWeights(all_layers_activations, neg_gradient, learning_rate);
// }

template<typename T>
void MLP<T>::AccumulatePolicyGradient(const std::vector<T>& state,
                                  const std::vector<T>& action_gradient) {
    std::vector<T> predicted_output;
    std::vector<std::vector<T>> all_layers_activations;

    // Forward pass
    GetOutput(state, &predicted_output, &all_layers_activations, false);

    // Negate gradients for maximization
    std::vector<T> neg_gradient(action_gradient.size());
    for(size_t i = 0; i < action_gradient.size(); i++) {
        neg_gradient[i] = -action_gradient[i];
    }

    // Accumulate gradients through backpropagation
    BackpropagateWithAccumulation(all_layers_activations,
                                    neg_gradient,
                                    true);

}


template <typename T>
void MLP<T>::Train(const std::vector<TrainingSample<T>>
        &training_sample_set_with_bias,
        float learning_rate,
        int max_iterations,
        float min_error_cost,
        bool output_log)
{
    std::vector< std::vector<T> > features, labels;

    for (const auto &sample : training_sample_set_with_bias) {
        features.push_back(sample.input_vector());
        labels.push_back(sample.output_vector());
    }

    training_pair_t t_pair(features, labels);
    Train(t_pair, learning_rate, max_iterations,
            min_error_cost, output_log);
};

template<typename T>
size_t MLP<T>::GetNumLayers()
{
    return m_layers.size();
}


template<typename T>
std::vector<std::vector<T>> MLP<T>::GetLayerWeights( size_t layer_i )
{
    std::vector<std::vector<T>> ret_val;
    // check parameters
    assert(layer_i < m_layers.size() /* Incorrect layer number in GetLayerWeights call */);
    {
        Layer<T> current_layer = m_layers[layer_i];
        for( Node<T> & node : current_layer.GetNodesChangeable() )
        {
            ret_val.push_back( node.GetWeights() );
        }
        return ret_val;
    }

}

template <typename T>
typename MLP<T>::mlp_weights MLP<T>::GetWeights()
{
    MLP<T>::mlp_weights out;

    out.resize(m_layers.size());
    for (unsigned int n = 0; n < m_layers.size(); n++) {
        out[n].resize(m_layers[n].m_nodes.size());
        for (unsigned int k = 0; k < m_layers[n].m_nodes.size(); k++) {
            out[n][k].resize(m_layers[n].m_nodes[k].m_weights.size());
            for (unsigned int j = 0; j < m_layers[n].m_nodes[k].m_weights.size(); j++) {
                out[n][k][j] = m_layers[n].m_nodes[k].m_weights[j];
            }
        }
    }

    return out;
}

template<typename T>
void MLP<T>::SetLayerWeights( size_t layer_i, std::vector<std::vector<T>> & weights )
{
    // check parameters
    assert(layer_i < m_layers.size() /* Incorrect layer number in SetLayerWeights call */);
    {
        m_layers[layer_i].SetWeights( weights );
    }
}

template <typename T>
void MLP<T>::SetWeights(MLP<T>::mlp_weights &weights)
{
#ifdef SAFE_MODE
    NISPS_DEBUG_PRINTF("SetWeights: vector dim check. Expected=%zu, actual=%zu\n",
                       m_layers.size(), weights.size());
    assert(weights.size() == m_layers.size());
#endif

    for (unsigned int n = 0; n < m_layers.size(); n++) {
        SetLayerWeights(n, weights[n]);
    }
}

template <typename T>
void MLP<T>::DrawWeights(float scale)
{
    // T before = m_layers[0].m_nodes[0].m_weights[0];
    utils::gen_rand<T> gen;
    // utils::gen_randn<T> gen(0.f, scale); //mean, stddev

    for (unsigned int n = 0; n < m_layers.size(); n++) {
        for (unsigned int k = 0; k < m_layers[n].m_nodes.size(); k++) {
            for (unsigned int j = 0; j < m_layers[n].m_nodes[k].m_weights.size(); j++) {
                float mod = gen() * scale;
                m_layers[n].m_nodes[k].m_weights[j] = mod;
            }
        }
    }

    // assert(m_layers[0].m_nodes[0].m_weights[0] != before);
}

template <typename T>
void MLP<T>::MoveWeights(T speed)
{
    T before = m_layers[0].m_nodes[0].m_weights[0];
    utils::gen_randn<T> gen(speed);

    for (unsigned int n = 0; n < m_layers.size(); n++) {
        // size_t num_inputs = m_layers_nodes[n];
        for (unsigned int k = 0; k < m_layers[n].m_nodes.size(); k++) {
            for (unsigned int j = 0; j < m_layers[n].m_nodes[k].m_weights.size(); j++) {
                T w = m_layers[n].m_nodes[k].m_weights[j];
                m_layers[n].m_nodes[k].m_weights[j] = gen(m_layers[n].m_nodes[k].m_weights[j]);
                T w2 = m_layers[n].m_nodes[k].m_weights[j];
                if (speed != 0) {
                    assert(w != w2);
                }
            }
        }
    }

    assert(m_layers[0].m_nodes[0].m_weights[0] != before);
}

template <typename T>
void MLP<T>::InitXavier() {
    for(auto & layer : m_layers) {
        layer.InitXavier();
    }
}

template <typename T>
void MLP<T>::RandomiseWeightsAndBiasesLin(T weightMin, T weightMax, T biasMin, T biasMax) {
    std::uniform_real_distribution<> disWeight(weightMin, weightMax);
    std::uniform_real_distribution<> disBias(biasMin, biasMin);

    // utils::gen_randn<T> gen(0.f, scale); //mean, stddev
    for (unsigned int n = 0; n < m_layers.size(); n++) {
        for (unsigned int k = 0; k < m_layers[n].m_nodes.size(); k++) {
            for (unsigned int j = 0; j < m_layers[n].m_nodes[k].m_weights.size(); j++) {
                m_layers[n].m_nodes[k].m_weights[j] = disWeight(g);
            }
            m_layers[n].m_nodes[k].m_bias = disBias(g);
        }
    }
}


// Explicit instantiations
#if !defined(__XS3A__)
template class MLP<double>;
#endif
template class MLP<float>;

} // namespace nisps

#endif // NISPS_MLP_IMPL_HPP
