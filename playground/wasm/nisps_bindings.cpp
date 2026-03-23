// WASM bindings for nisps-core MLP engine
// Provides a flat C API for use from JavaScript via Emscripten

#include <emscripten.h>
#include "nisps/mlp.hpp"
#include <cstdlib>
#include <cmath>

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

    nisps::MLP<float>::training_pair_t data(features, labels);
    return mlp->Train(data, learning_rate, max_iterations, min_error, false);
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
