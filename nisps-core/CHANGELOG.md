# Changelog

All notable changes to NISPS Core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
- Basic XOR test example
- Comprehensive README documentation

### Changed
- Converted from Arduino/RP2040 embedded code to platform-agnostic C++
- Updated from C++17 to C++20 (required for std::span)
- Removed all platform-specific code (Serial, SD card, Pico SDK)
- Converted to header-only implementation pattern
- Added `nisps` namespace to all code
- Changed file extensions from .h/.cpp to .hpp

### Removed
- Arduino and RP2040 dependencies
- Serial debugging (replaced with optional callbacks)
- SD card save/load functionality
- Binary serialization (temporarily disabled)
- Audio synthesis code (nisps-core is control-only)

### Technical Details
- **Language**: C++20
- **Dependencies**: None (pure standard library)
- **Architecture**: Header-only library
- **Lines of code**: ~3,500
- **Build system**: CMake 3.14+
- **Optimizer**: RMSProp with gradient clipping
- **Activation functions**: Sigmoid, ReLU, tanh, linear, hardsigmoid, hardswish, hardtanh
- **Loss functions**: MSE, categorical cross-entropy

### Known Issues
- Binary serialization methods commented out (not needed for basic functionality)
- No example for actual training workflow yet (requires interactive I/O)
- Documentation references parent project URLs (MEMLNaut-NISPS)

### Migration from MEMLNaut-NISPS
If you're using the old embedded IMLInterface class:
```cpp
// Old (embedded):
IMLInterface iml(n_inputs, n_outputs);

// New (nisps-core):
nisps::IML<float> iml(n_inputs, n_outputs);
```

All method names remain the same, just add the namespace.
