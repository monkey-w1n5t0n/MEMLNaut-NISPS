# Changelog

All notable changes to NISPS Core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.2.0] - 2026-02-08

### Added
- `set_output()` / `set_outputs()` methods for programmatic output control
- `add_example()` method for adding training pairs without interactive workflow
- Real training convergence tests (identity mapping, multi-output)
- Working example with actual training (`examples/simple_mapping.cpp`)

### Fixed
- Release build crash: loss function pointer not initialized due to side effect inside `assert()` (mlp_impl.hpp)
- Removed ARM CMSIS-DSP conditional code from node.hpp (`ARM_MATH_CM33`)
- Removed XMOS `__XS3A__` conditional attributes from utils.hpp and loss.hpp
- Removed `std::printf` logging from dataset_impl.hpp (use IML logger callback instead)

### Changed
- README updated to document new APIs and remove false claims
- CHANGELOG rewritten to accurately reflect library state

## [0.1.0] - 2026-02-08

### Added
- Initial extraction from MEMLNaut-NISPS firmware
- Header-only C++20 library structure
- Core IML (Interactive Machine Learning) interface
- MLP (Multi-Layer Perceptron) neural network implementation
- Dataset management with replay memory support
- Training and inference modes
- Logging callback support
- CMake build system for tests

### Changed
- Converted from Arduino/RP2040 embedded code to platform-agnostic C++
- Updated to C++20 (required for std::span)
- Converted to header-only implementation pattern
- Added `nisps` namespace to all code

### Removed
- Arduino and RP2040 dependencies
- Serial debugging (replaced with optional callbacks)
- SD card save/load functionality
- Audio synthesis code (nisps-core is control-only)

### Migration from MEMLNaut-NISPS
If you're using the old embedded IMLInterface class:
```cpp
// Old (embedded):
IMLInterface iml(n_inputs, n_outputs);

// New (nisps-core):
nisps::IML<float> iml(n_inputs, n_outputs);
```
