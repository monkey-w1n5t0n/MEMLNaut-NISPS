# NISPS Core Extraction Plan

Extract a platform-agnostic C++20 controller library from MEMLNaut-NISPS. This is **not** a synth or audio engine - it's a parameter mapping engine: control data in → ML → control data out. Use it to drive synths, effects, lights, robots, whatever.

> **Note**: Originally planned as C++17, upgraded to C++20 during implementation to use `std::span` for efficient array views.

## What This Is

NISPS core takes N input parameters (joystick position, sensor data, audio features) and maps them to M output parameters through an interactively-trained neural network. Users teach it by example: "when I'm here in input space, I want these output values."

## Dependencies to Remove

| Dependency | Replacement |
|------------|-------------|
| `Serial.print*` | Optional log callback |
| `queue_t` (Pico SDK) | Not needed (single-threaded) |
| `WString.h` (Arduino) | `std::string` |
| `__force_inline`, `AUDIO_MEM` | No-op macros |

## Structure

```
nisps/
├── mlp.hpp        # MLP implementation (from memlp, cleaned)
├── dataset.hpp    # Training dataset
├── iml.hpp        # Interactive ML engine (~200 lines)
└── voice_space.hpp # Optional: example parameter mappings
```

## Core API

```cpp
namespace nisps {

template<typename Float = float>
class IML {
public:
    IML(size_t n_inputs, size_t n_outputs,
        std::vector<size_t> hidden_layers = {10, 10, 14});

    // Input
    void set_input(size_t index, Float value);
    void set_inputs(const Float* values, size_t count);

    // Output (valid after process())
    const Float* get_outputs() const;
    size_t num_outputs() const;

    // Runtime
    void process();  // Run inference, call at control rate

    // Training workflow
    enum class Mode { Inference, Training };
    void set_mode(Mode mode);
    void save_example();      // Store current input→output as training pair
    void clear_dataset();
    void randomise_weights(); // For exploration in training mode
    void train();             // Blocking, runs on current dataset

    // Optional
    using LogFn = void(*)(const char*);
    void set_logger(LogFn fn);
};

} // namespace nisps
```

## Usage

```cpp
#include "nisps/iml.hpp"

nisps::IML<float> iml(3, 24);  // 3 inputs (x,y,z), 24 outputs

// Control loop
void update(float x, float y, float z) {
    iml.set_input(0, x);
    iml.set_input(1, y);
    iml.set_input(2, z);
    iml.process();

    const float* params = iml.get_outputs();
    my_synth.set_filter_cutoff(params[0] * 10000.f);
    my_synth.set_resonance(params[1]);
    // ... etc
}

// Training (triggered by user interaction)
void on_user_saves_position() {
    iml.save_example();
}

void on_user_exits_training_mode() {
    iml.set_mode(nisps::IML<>::Mode::Inference);
    // This triggers training internally
}
```

## Voice Spaces (Optional)

Voice spaces are just functions that interpret the raw 0-1 output parameters. Not part of core, but useful as examples:

```cpp
// User-defined mapping
void apply_neve_style(const float* params, MyChannelStrip& strip) {
    strip.pre_gain = 0.5f + params[0] * params[0] * 4.f;
    strip.hp_freq = 30.f + params[8] * params[8] * 270.f;
    strip.comp_threshold = 20.f + params[10] * -40.f;
    // ... etc
}
```

## Phases

### Phase 1: Get memlp building standalone (1-2 days)

1. Copy `memlp` source into `nisps/`
2. Remove `Serial.print` calls (or stub them)
3. Remove Arduino `String` usage
4. Verify it compiles with g++/clang

### Phase 2: Wrap in IML interface (2-3 days)

1. Create `iml.hpp` with the API above
2. Port state machine logic from `IMLInterface.hpp`
3. Simple test: train on XOR, verify inference works

### Phase 3: Example integration (1-2 days)

1. Command-line example that reads CSV input, outputs CSV
2. Or: minimal JUCE/SDL example with mouse input

**Total: ~1 week to something usable**

## Later (only if needed)

- Model serialization (save/load trained weights)
- Thread-safe parameter updates
- Python bindings
- WASM build
