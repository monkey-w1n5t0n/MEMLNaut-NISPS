#ifndef NISPS_IML_HPP
#define NISPS_IML_HPP

#include "mlp.hpp"
#include "dataset.hpp"
#include <vector>
#include <cstddef>
#include <functional>

namespace nisps {

template<typename Float = float>
class IML {
public:
    enum class Mode { Inference, Training };

    using LogFn = void(*)(const char*);

    IML(size_t n_inputs, size_t n_outputs,
        std::vector<size_t> hidden_layers = {10, 10, 14},
        size_t max_iterations = 1000,
        Float learning_rate = 1.0f,
        Float convergence_threshold = 0.00001f);

    // Input
    void set_input(size_t index, Float value);
    void set_inputs(const Float* values, size_t count);

    // Output (valid after process())
    const Float* get_outputs() const;
    size_t num_inputs() const { return n_inputs_; }
    size_t num_outputs() const { return n_outputs_; }

    // Runtime
    void process();

    // Training workflow
    void set_mode(Mode mode);
    Mode get_mode() const { return mode_; }
    void save_example();
    void clear_dataset();
    void randomise_weights();

    // Optional logging
    void set_logger(LogFn fn) { log_fn_ = fn; }

private:
    void log(const char* msg) const {
        if (log_fn_) log_fn_(msg);
    }
    void train();

    size_t n_inputs_;
    size_t n_outputs_;
    size_t max_iterations_;
    Float learning_rate_;
    Float convergence_threshold_;

    Mode mode_ = Mode::Inference;
    bool input_updated_ = false;
    bool perform_inference_ = true;

    std::vector<Float> input_state_;
    std::vector<Float> output_state_;

    std::unique_ptr<Dataset> dataset_;
    std::unique_ptr<MLP<Float>> mlp_;
    typename MLP<Float>::mlp_weights stored_weights_;
    bool weights_randomised_ = false;

    LogFn log_fn_ = nullptr;
};

} // namespace nisps

#include "iml_impl.hpp"

#endif // NISPS_IML_HPP
