# NISPS Core

**N**eural **I**nteractive **S**haping of **P**arameter **S**paces - Core Library

A platform-agnostic C++20 header-only library for interactive machine learning. Train neural networks to map input parameters to output parameters through interactive demonstration.

## What Is This?

NISPS core is a **parameter mapping engine**, not a synthesizer. It takes N input parameters (joystick position, sensor data, audio features) and maps them to M output parameters through an interactively-trained neural network.

**Use it to control**: synthesizers, effects, lights, robots, game parameters, or anything that responds to control data.

## Features

- **Header-only**: No compilation needed, just include and use
- **Platform-agnostic**: Pure C++20 with standard library only
- **Interactive learning**: Train by demonstration, not by code
- **Programmatic training**: `add_example()` API for non-interactive use
- **Lightweight**: ~3,500 lines of optimized neural network code
- **Flexible**: Map 1-100 inputs to 1-100 outputs

## Quick Start

### Installation

Copy the `include/nisps/` directory to your project, or add it to your include path:

```bash
# Option 1: Copy headers
cp -r nisps-core/include/nisps /path/to/your/project/include/

# Option 2: Add to CMakeLists.txt
target_include_directories(your_target PRIVATE /path/to/nisps-core/include)
```

### Basic Usage

```cpp
#include <nisps/nisps.hpp>

// Create IML with 2 inputs, 4 outputs
nisps::IML<float> iml(2, 4);

// Runtime: set inputs and get outputs
void update(float x, float y) {
    iml.set_input(0, x);
    iml.set_input(1, y);
    iml.process();

    const float* outputs = iml.get_outputs();
    my_synth.set_filter_cutoff(outputs[0] * 10000.f);
    my_synth.set_resonance(outputs[1]);
    my_synth.set_envelope_attack(outputs[2] * 5.0f);
    my_synth.set_envelope_release(outputs[3] * 10.0f);
}
```

### Programmatic Training

```cpp
// 1. Enter training mode
iml.set_mode(nisps::IML<float>::Mode::Training);

// 2. Add examples directly
float in1[] = {0.1f, 0.1f}; float out1[] = {0.9f, 0.1f, 0.5f, 0.8f};
float in2[] = {0.9f, 0.9f}; float out2[] = {0.1f, 0.9f, 0.2f, 0.3f};
iml.add_example(in1, 2, out1, 4);
iml.add_example(in2, 2, out2, 4);

// 3. Exit training mode (automatically trains the network)
iml.set_mode(nisps::IML<float>::Mode::Inference);
```

### Interactive Training (hardware/UI)

```cpp
// For interactive systems with physical controls:
iml.set_mode(nisps::IML<float>::Mode::Training);

iml.set_input(0, 0.3f);
iml.set_input(1, 0.7f);
iml.save_example();      // Stops inference
// ... user adjusts output controls ...
iml.set_output(0, 0.8f); // Or read from hardware
iml.save_example();       // Stores the input->output mapping

iml.set_mode(nisps::IML<float>::Mode::Inference);
```

## API Reference

### IML Constructor

```cpp
nisps::IML<Float>(
    size_t n_inputs,                           // Number of input parameters
    size_t n_outputs,                          // Number of output parameters
    std::vector<size_t> hidden_layers = {10, 10, 14},  // Hidden layer sizes
    size_t max_iterations = 1000,              // Training iterations
    Float learning_rate = 1.0f,                // Learning rate
    Float convergence_threshold = 0.00001f     // Stop training threshold
);
```

### Input/Output

```cpp
void set_input(size_t index, Float value);     // Set single input (0-1 range)
void set_inputs(const Float* values, size_t count);  // Set multiple inputs
void set_output(size_t index, Float value);    // Set single output (for training)
void set_outputs(const Float* values, size_t count); // Set multiple outputs
const Float* get_outputs() const;              // Get output array
void process();                                // Run inference
```

### Training

```cpp
enum class Mode { Inference, Training };
void set_mode(Mode mode);                      // Switch modes
void add_example(const Float* in, size_t n_in, // Add training pair directly
                 const Float* out, size_t n_out);
void save_example();                           // Interactive: store input->output pair
void clear_dataset();                          // Clear training data
void randomise_weights();                      // Randomize for exploration
```

### Logging

```cpp
void set_logger(LogFn fn);                     // Set callback for messages
// LogFn = void(*)(const char*)
```

## Building the Tests

```bash
cd nisps-core
mkdir build && cd build
cmake ..
make
ctest --output-on-failure
```

## Requirements

- **C++20** compiler (GCC 10+, Clang 10+, MSVC 2019+)
- **CMake 3.14+** (for building tests only)

## Architecture

### Core Components

- **IML**: High-level interactive ML interface
- **MLP**: Multi-layer perceptron (feedforward neural network)
- **Dataset**: Training data management
- **Layer/Node**: Neural network building blocks
- **Loss**: MSE and categorical cross-entropy functions
- **Utils**: Activation functions (sigmoid, ReLU, tanh, etc.)

### Design Decisions

1. **Header-only**: Simplifies integration, allows template specialization
2. **C++20**: Enables `std::span` for efficient array views
3. **No SIMD**: Portable code, relies on compiler auto-vectorization
4. **RMSProp optimizer**: Fast convergence for interactive training
5. **Gradient clipping**: Prevents numerical instability

## Examples

See `examples/simple_mapping.cpp` for a complete working example that demonstrates:
- Untrained inference
- Programmatic training with `add_example()`
- Interactive training workflow with `save_example()` + `set_output()`

See `test/main.cpp` for tests including convergence verification.

## Origin

Extracted from [MEMLNaut-NISPS](https://github.com/musicallyembodiedml/memlnaut) - an embedded ML platform for audio synthesis on Raspberry Pi Pico.

**Key changes from MEMLNaut-NISPS**:
- Removed Arduino/RP2040 dependencies
- Removed audio synthesis code (use this to *control* your synth)
- Added proper namespacing
- Converted to header-only library
- Updated to modern C++20

## License

Mozilla Public License Version 2.0

Original MLP code derived from [David Alberto Nogueira's MLP project](https://github.com/davidalbertonogueira/MLP).

## Contributing

This library is extracted from an active research project. Contributions welcome:
- Bug fixes
- Performance optimizations
- Example code
- Documentation improvements

Please keep the library dependency-free and platform-agnostic.

## Citation

If you use this in research, please cite:

```
MEMLNaut-NISPS: Neural Interactive Shaping of Parameter Spaces
https://musicallyembodiedml.github.io/memlnaut/approaches/nisps
```

## Support

- **Issues**: File at parent project (MEMLNaut-NISPS repo)
- **Docs**: https://musicallyembodiedml.github.io/memlnaut/
- **Examples**: See `examples/` directory
