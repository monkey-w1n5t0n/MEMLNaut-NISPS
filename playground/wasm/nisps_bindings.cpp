// WASM bindings for nisps-core MLP engine
// Provides a flat C API for use from JavaScript via Emscripten

#include <emscripten.h>
#include "nisps/mlp.hpp"
#include <cstdlib>
#include <cmath>

// Helper subclass to access protected members for extended training
struct NispsMLPAccessor : public nisps::MLP<float> {
    using nisps::MLP<float>::loss_fn_;
    using nisps::MLP<float>::UpdateWeights;
};

extern "C" {

// ---- Lifecycle ----

EMSCRIPTEN_KEEPALIVE
void* nisps_mlp_create(int* layer_sizes, int n_layers, int* activation_ids, int n_activations) {
    std::vector<size_t> layers(layer_sizes, layer_sizes + n_layers);
    std::vector<nisps::ACTIVATION_FUNCTIONS> activations;
    for (int i = 0; i < n_activations; i++) {
        activations.push_back(static_cast<nisps::ACTIVATION_FUNCTIONS>(activation_ids[i]));
    }
    auto* mlp = new nisps::MLP<float>(layers, activations, nisps::loss::LOSS_MSE, false, 0.0f);
    return mlp;
}

EMSCRIPTEN_KEEPALIVE
void nisps_mlp_destroy(void* ptr) {
    delete static_cast<nisps::MLP<float>*>(ptr);
}

// ---- Weight serialization ----
// Flat format: for each layer, for each node: [w0, w1, ..., wN, bias]

EMSCRIPTEN_KEEPALIVE
int nisps_mlp_weight_count(void* ptr) {
    auto* mlp = static_cast<nisps::MLP<float>*>(ptr);
    int count = 0;
    for (auto& layer : mlp->m_layers) {
        for (auto& node : layer.m_nodes) {
            count += node.m_weights.size() + 1; // weights + bias
        }
    }
    return count;
}

EMSCRIPTEN_KEEPALIVE
void nisps_mlp_get_weights(void* ptr, float* out) {
    auto* mlp = static_cast<nisps::MLP<float>*>(ptr);
    int idx = 0;
    for (auto& layer : mlp->m_layers) {
        for (auto& node : layer.m_nodes) {
            for (size_t j = 0; j < node.m_weights.size(); j++) {
                out[idx++] = node.m_weights[j];
            }
            out[idx++] = node.m_bias;
        }
    }
}

EMSCRIPTEN_KEEPALIVE
void nisps_mlp_set_weights(void* ptr, float* weights) {
    auto* mlp = static_cast<nisps::MLP<float>*>(ptr);
    int idx = 0;
    for (auto& layer : mlp->m_layers) {
        for (auto& node : layer.m_nodes) {
            for (size_t j = 0; j < node.m_weights.size(); j++) {
                node.m_weights[j] = weights[idx++];
            }
            node.m_bias = weights[idx++];
        }
    }
}

// ---- Inference ----

EMSCRIPTEN_KEEPALIVE
void nisps_mlp_inference(void* ptr, float* input, int input_dim, float* output, int output_dim) {
    auto* mlp = static_cast<nisps::MLP<float>*>(ptr);
    std::vector<float> in_vec(input, input + input_dim);
    std::vector<float> out_vec;
    mlp->GetOutput(in_vec, &out_vec, nullptr, true);
    int n = output_dim < (int)out_vec.size() ? output_dim : (int)out_vec.size();
    for (int i = 0; i < n; i++) {
        output[i] = out_vec[i];
    }
}

// ---- Training ----
// Takes flat arrays, builds training pairs, returns final loss

EMSCRIPTEN_KEEPALIVE
float nisps_mlp_train(void* ptr,
    float* features_flat, int n_samples, int feature_dim,
    float* labels_flat, int label_dim,
    float* sample_weights,
    float learning_rate, int max_iterations, float min_error) {

    auto* mlp = static_cast<nisps::MLP<float>*>(ptr);

    std::vector<std::vector<float>> features(n_samples);
    std::vector<std::vector<float>> labels(n_samples);

    for (int i = 0; i < n_samples; i++) {
        features[i].assign(features_flat + i * feature_dim,
                           features_flat + (i + 1) * feature_dim);
        labels[i].assign(labels_flat + i * label_dim,
                         labels_flat + (i + 1) * label_dim);
    }

    // Build weights vector if provided (non-null pointer)
    std::vector<float> weights_vec;
    const std::vector<float>* weights_ptr = nullptr;
    if (sample_weights) {
        weights_vec.assign(sample_weights, sample_weights + n_samples);
        weights_ptr = &weights_vec;
    }

    nisps::MLP<float>::training_pair_t data(features, labels);
    return mlp->Train(data, learning_rate, max_iterations, min_error, false, weights_ptr);
}

// ---- Weight manipulation with spread ----
// These mirror the JS playground's spread-aware versions which the C++ core
// doesn't have natively.

// DrawWeights: randomize with per-layer Xavier scaling controlled by spread
// spread=0: uniform [-1,1], spread=1: Xavier-scaled per layer
EMSCRIPTEN_KEEPALIVE
void nisps_mlp_draw_weights_spread(void* ptr, float spread) {
    auto* mlp = static_cast<nisps::MLP<float>*>(ptr);
    for (size_t l = 0; l < mlp->m_layers.size(); l++) {
        int fan_in = mlp->m_layers[l].GetInputSize();
        float xavier_scale = 1.0f / std::sqrt((float)fan_in);
        float scale = 1.0f * (1.0f - spread) + xavier_scale * spread;
        for (auto& node : mlp->m_layers[l].GetNodesChangeable()) {
            for (size_t j = 0; j < node.m_weights.size(); j++) {
                node.m_weights[j] = ((float)rand() / RAND_MAX * 2.0f - 1.0f) * scale;
            }
            node.m_bias = 0.0f;
        }
    }
}

// MoveWeights: add per-layer noise with weight decay, controlled by spread
// spread=0: flat noise, no decay. spread=1: Xavier-scaled noise, 10% decay.
EMSCRIPTEN_KEEPALIVE
void nisps_mlp_move_weights_spread(void* ptr, float speed, float spread) {
    auto* mlp = static_cast<nisps::MLP<float>*>(ptr);
    float decay = 1.0f - 0.1f * spread;
    for (size_t l = 0; l < mlp->m_layers.size(); l++) {
        int fan_in = mlp->m_layers[l].GetInputSize();
        float xavier_scale = 1.0f / std::sqrt((float)fan_in);
        float layer_scale = 1.0f * (1.0f - spread) + xavier_scale * spread;
        for (auto& node : mlp->m_layers[l].GetNodesChangeable()) {
            for (size_t j = 0; j < node.m_weights.size(); j++) {
                node.m_weights[j] *= decay;
                // gen_randn: sum of 3 uniform randoms
                float accum = 0;
                for (int n = 0; n < 3; n++) {
                    accum += (float)rand() / RAND_MAX * 2.0f - 1.0f;
                }
                node.m_weights[j] += 3.0f * accum * speed * layer_scale;
            }
        }
    }
}

// ---- Batch inference ----

EMSCRIPTEN_KEEPALIVE
void nisps_mlp_infer_batch(void* ptr, float* inputs_flat, int n_points, int input_dim, float* outputs_flat, int output_dim) {
    auto* mlp = static_cast<nisps::MLP<float>*>(ptr);
    std::vector<float> in_vec(input_dim);
    std::vector<float> out_vec;
    for (int i = 0; i < n_points; i++) {
        in_vec.assign(inputs_flat + i * input_dim, inputs_flat + (i + 1) * input_dim);
        out_vec.clear();
        mlp->GetOutput(in_vec, &out_vec, nullptr, true);
        int n = output_dim < (int)out_vec.size() ? output_dim : (int)out_vec.size();
        for (int j = 0; j < n; j++) {
            outputs_flat[i * output_dim + j] = out_vec[j];
        }
    }
}

// ---- Extended training with per-iteration loss history ----

EMSCRIPTEN_KEEPALIVE
int nisps_mlp_train_ex(void* ptr,
    float* features_flat, int n_samples, int feature_dim,
    float* labels_flat, int label_dim,
    float* sample_weights,
    float learning_rate, int max_iterations, float min_error,
    float* loss_history_out) {

    auto* mlp = static_cast<NispsMLPAccessor*>(static_cast<nisps::MLP<float>*>(ptr));

    std::vector<std::vector<float>> features(n_samples);
    std::vector<std::vector<float>> labels(n_samples);

    for (int i = 0; i < n_samples; i++) {
        features[i].assign(features_flat + i * feature_dim,
                           features_flat + (i + 1) * feature_dim);
        labels[i].assign(labels_flat + i * label_dim,
                         labels_flat + (i + 1) * label_dim);
    }

    float sample_size_recip = 1.0f / n_samples;

    int iter = 0;
    for (iter = 0; iter < max_iterations; iter++) {
        float iteration_loss = 0.0f;

        for (int s = 0; s < n_samples; s++) {
            float w = sample_weights ? sample_weights[s] : sample_size_recip;

            std::vector<float> predicted_output;
            std::vector<std::vector<float>> all_layers_activations;

            mlp->GetOutput(features[s], &predicted_output, &all_layers_activations, false);

            std::vector<float> deriv_error_output(predicted_output.size());
            float loss = mlp->loss_fn_(labels[s], predicted_output, deriv_error_output, w);

            iteration_loss += loss;

            mlp->UpdateWeights(all_layers_activations, deriv_error_output, learning_rate);
        }

        if (!sample_weights) {
            iteration_loss *= sample_size_recip;
        }

        loss_history_out[iter] = iteration_loss;

        if (iteration_loss < min_error) {
            iter++;
            break;
        }
    }

    return iter;
}

// ---- moveWeights with output pin mask ----

EMSCRIPTEN_KEEPALIVE
void nisps_mlp_move_weights_ex(void* ptr, float speed, float spread, int* pin_mask, int n_outputs) {
    auto* mlp = static_cast<nisps::MLP<float>*>(ptr);
    float decay = 1.0f - 0.1f * spread;
    size_t n_layers = mlp->m_layers.size();
    for (size_t l = 0; l < n_layers; l++) {
        int fan_in = mlp->m_layers[l].GetInputSize();
        float xavier_scale = 1.0f / std::sqrt((float)fan_in);
        float layer_scale = 1.0f * (1.0f - spread) + xavier_scale * spread;
        bool is_output_layer = (l == n_layers - 1);
        int node_idx = 0;
        for (auto& node : mlp->m_layers[l].GetNodesChangeable()) {
            // Skip pinned output nodes
            if (is_output_layer && pin_mask && node_idx < n_outputs && pin_mask[node_idx] == 1) {
                node_idx++;
                continue;
            }
            for (size_t j = 0; j < node.m_weights.size(); j++) {
                node.m_weights[j] *= decay;
                float accum = 0;
                for (int n = 0; n < 3; n++) {
                    accum += (float)rand() / RAND_MAX * 2.0f - 1.0f;
                }
                node.m_weights[j] += 3.0f * accum * speed * layer_scale;
            }
            node_idx++;
        }
    }
}

// ---- Evaluate loss without updating weights ----

EMSCRIPTEN_KEEPALIVE
float nisps_mlp_eval_loss(void* ptr,
    float* features_flat, int n_samples, int feature_dim,
    float* labels_flat, int label_dim,
    float* sample_weights) {

    auto* mlp = static_cast<NispsMLPAccessor*>(static_cast<nisps::MLP<float>*>(ptr));
    float total_loss = 0.0f;
    float sample_size_recip = 1.0f / n_samples;

    for (int s = 0; s < n_samples; s++) {
        float w = sample_weights ? sample_weights[s] : sample_size_recip;

        std::vector<float> in_vec(features_flat + s * feature_dim,
                                  features_flat + (s + 1) * feature_dim);
        std::vector<float> label_vec(labels_flat + s * label_dim,
                                     labels_flat + (s + 1) * label_dim);

        std::vector<float> predicted_output;
        mlp->GetOutput(in_vec, &predicted_output, nullptr, true);

        std::vector<float> deriv_error_output(predicted_output.size());
        float loss = mlp->loss_fn_(label_vec, predicted_output, deriv_error_output, w);
        total_loss += loss;
    }

    if (!sample_weights) {
        total_loss *= sample_size_recip;
    }

    return total_loss;
}

// ---- Per-layer weight statistics ----

EMSCRIPTEN_KEEPALIVE
void nisps_mlp_get_layer_stats(void* ptr, float* stats_out, int n_layers) {
    auto* mlp = static_cast<nisps::MLP<float>*>(ptr);
    int layers_to_process = n_layers < (int)mlp->m_layers.size() ? n_layers : (int)mlp->m_layers.size();
    for (int l = 0; l < layers_to_process; l++) {
        float sum_abs = 0.0f;
        float max_abs = 0.0f;
        int dead_count = 0;
        int saturating_count = 0;
        int total_weights = 0;

        for (auto& node : mlp->m_layers[l].m_nodes) {
            for (size_t j = 0; j < node.m_weights.size(); j++) {
                float aw = std::fabs(node.m_weights[j]);
                sum_abs += aw;
                if (aw > max_abs) max_abs = aw;
                if (aw < 0.01f) dead_count++;
                if (aw > 3.0f) saturating_count++;
                total_weights++;
            }
        }

        float inv_total = total_weights > 0 ? 1.0f / total_weights : 0.0f;
        stats_out[l * 4 + 0] = sum_abs * inv_total;       // mean absolute weight
        stats_out[l * 4 + 1] = max_abs;                   // max absolute weight
        stats_out[l * 4 + 2] = dead_count * inv_total;    // fraction dead
        stats_out[l * 4 + 3] = saturating_count * inv_total; // fraction saturating
    }
}

// ---- Memory helpers ----

EMSCRIPTEN_KEEPALIVE
float* nisps_alloc(int n) {
    return (float*)malloc(n * sizeof(float));
}

EMSCRIPTEN_KEEPALIVE
void nisps_free(float* ptr) {
    free(ptr);
}

EMSCRIPTEN_KEEPALIVE
int* nisps_alloc_int(int n) {
    return (int*)malloc(n * sizeof(int));
}

EMSCRIPTEN_KEEPALIVE
void nisps_free_int(int* ptr) {
    free(ptr);
}

} // extern "C"
