cmake_minimum_required(VERSION 3.20)
project(nisps_core CXX)

# ---------------------------------------------------------------------------
# Toolchain / standard
# ---------------------------------------------------------------------------
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Default to a Release build when invoked without -DCMAKE_BUILD_TYPE so host
# tests get optimized math; flip with `-DCMAKE_BUILD_TYPE=Debug` for stepping.
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

# ---------------------------------------------------------------------------
# Core interface library — header-only. Other parts of the build (ml/, dsp/,
# engines/, modes/) will link against this once they exist.
# ---------------------------------------------------------------------------
add_library(nisps_core INTERFACE)
target_include_directories(nisps_core
    INTERFACE
        ${CMAKE_CURRENT_SOURCE_DIR}
)
target_compile_features(nisps_core INTERFACE cxx_std_20)

# ---------------------------------------------------------------------------
# Emscripten / WASM target detection
# ---------------------------------------------------------------------------
# When building for WASM via emcmake, ${EMSCRIPTEN} is set automatically. We
# don't actually emit a WASM binary from this CMakeLists yet — the WASM build
# script lives in stream 7 (playground/build) and assembles its own
# Emscripten link command. Here we just gate the host-only test executable so
# `emcmake cmake -S nisps -B build-wasm` configures cleanly.
if(EMSCRIPTEN)
    message(STATUS "nisps_core: configuring for Emscripten/WASM target")
endif()

# ---------------------------------------------------------------------------
# Test scaffold — only built on the host. We use a hand-rolled assertion-
# based harness (see tests/cpp/test_helpers.hpp) rather than Catch2/doctest;
# the rationale is in test_helpers.hpp.
# ---------------------------------------------------------------------------
if(NOT EMSCRIPTEN)
    set(NISPS_TEST_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../tests/cpp)

    add_executable(nisps_core_tests
        ${NISPS_TEST_DIR}/test_main.cpp
        ${NISPS_TEST_DIR}/test_fixed_buffer.cpp
        ${NISPS_TEST_DIR}/test_ring_buffer.cpp
        ${NISPS_TEST_DIR}/test_rng.cpp
        ${NISPS_TEST_DIR}/test_math.cpp
        ${NISPS_TEST_DIR}/test_mlp_init.cpp
        ${NISPS_TEST_DIR}/test_mlp_inference.cpp
        ${NISPS_TEST_DIR}/test_mlp_training.cpp
        ${NISPS_TEST_DIR}/test_mlp_loss.cpp
        ${NISPS_TEST_DIR}/test_mlp_rl.cpp
        ${NISPS_TEST_DIR}/test_mlp_storage_parity.cpp
        ${NISPS_TEST_DIR}/test_mlp_jolt.cpp
        ${NISPS_TEST_DIR}/test_mlp_ou_noise.cpp
        ${NISPS_TEST_DIR}/test_mlp_feedback.cpp
        ${NISPS_TEST_DIR}/test_mlp_serialize.cpp
    )
    target_link_libraries(nisps_core_tests PRIVATE nisps_core)

    # Chris's rule: the core compiles cleanly under -Wall -Wextra -Werror.
    if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang|AppleClang")
        target_compile_options(nisps_core_tests PRIVATE
            -Wall -Wextra -Werror -Wpedantic
        )
    elseif(MSVC)
        target_compile_options(nisps_core_tests PRIVATE /W4 /WX)
    endif()

    enable_testing()
    add_test(NAME nisps_core_tests COMMAND nisps_core_tests)

    # ---------------------------------------------------------------------
    # DSP + engines tests (stream 3). Built as a separate executable so
    # failures here don't take core/ML tests with them.
    # ---------------------------------------------------------------------
    add_executable(nisps_dsp_engine_tests
        ${NISPS_TEST_DIR}/test_main.cpp
        ${NISPS_TEST_DIR}/test_dsp_biquad.cpp
        ${NISPS_TEST_DIR}/test_dsp_delay.cpp
        ${NISPS_TEST_DIR}/test_dsp_reverb.cpp
        ${NISPS_TEST_DIR}/test_dsp_pitch_shift.cpp
        ${NISPS_TEST_DIR}/test_engine_no_op.cpp
        ${NISPS_TEST_DIR}/test_engine_paf_synth.cpp
        ${NISPS_TEST_DIR}/test_engine_channel_strip.cpp
        ${NISPS_TEST_DIR}/test_engine_xiasri.cpp
        ${NISPS_TEST_DIR}/test_engine_verb_fx.cpp
        ${NISPS_TEST_DIR}/test_engine_memlcelium.cpp
        ${NISPS_TEST_DIR}/test_engine_breakor.cpp
        ${NISPS_TEST_DIR}/test_engine_elysiamorf.cpp
        ${NISPS_TEST_DIR}/test_engine_analysis.cpp
    )
    target_link_libraries(nisps_dsp_engine_tests PRIVATE nisps_core)

    if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang|AppleClang")
        target_compile_options(nisps_dsp_engine_tests PRIVATE
            -Wall -Wextra -Werror -Wpedantic
        )
    elseif(MSVC)
        target_compile_options(nisps_dsp_engine_tests PRIVATE /W4 /WX)
    endif()

    add_test(NAME nisps_dsp_engine_tests COMMAND nisps_dsp_engine_tests)

    # ---------------------------------------------------------------------
    # Mode tests (stream 4). Cover concept satisfaction, voice space
    # dispatch, control-event pumping, and end-to-end inference→audio.
    # ---------------------------------------------------------------------
    add_executable(nisps_modes_tests
        ${NISPS_TEST_DIR}/test_main.cpp
        ${NISPS_TEST_DIR}/test_mode_concepts.cpp
        ${NISPS_TEST_DIR}/test_mode_paf_synth.cpp
        ${NISPS_TEST_DIR}/test_mode_voice_space.cpp
        ${NISPS_TEST_DIR}/test_mode_breakor_events.cpp
        ${NISPS_TEST_DIR}/test_mode_learning.cpp
    )
    target_link_libraries(nisps_modes_tests PRIVATE nisps_core)

    if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang|AppleClang")
        target_compile_options(nisps_modes_tests PRIVATE
            -Wall -Wextra -Werror -Wpedantic
        )
    elseif(MSVC)
        target_compile_options(nisps_modes_tests PRIVATE /W4 /WX)
    endif()

    add_test(NAME nisps_modes_tests COMMAND nisps_modes_tests)

    # ---------------------------------------------------------------------
    # Stream 11 verification suite (golden vectors + engine impulse).
    # Lives in tests/cpp/, registered separately so a regression here can
    # be diagnosed without rebuilding the world.
    # ---------------------------------------------------------------------
    add_executable(nisps_golden_tests
        ${NISPS_TEST_DIR}/test_main.cpp
        ${NISPS_TEST_DIR}/ml_golden_vectors.cpp
        ${NISPS_TEST_DIR}/engine_impulse.cpp
    )
    target_link_libraries(nisps_golden_tests PRIVATE nisps_core)

    if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang|AppleClang")
        target_compile_options(nisps_golden_tests PRIVATE
            -Wall -Wextra -Werror -Wpedantic
        )
    elseif(MSVC)
        target_compile_options(nisps_golden_tests PRIVATE /W4 /WX)
    endif()

    add_test(NAME nisps_golden_tests COMMAND nisps_golden_tests)
    # Run the impulse test from the repo root so the relative baseline path
    # in `engine_impulse.cpp` resolves to tests/cpp/engine_impulse_baseline.bin.
    set_tests_properties(nisps_golden_tests PROPERTIES
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/..
    )

    # Standalone parity-check runner. NOT registered with ctest — it's
    # invoked from scripts/parity-check.sh which orchestrates native+WASM
    # together.
    add_executable(nisps_parity_check
        ${NISPS_TEST_DIR}/parity_check.cpp
    )
    target_link_libraries(nisps_parity_check PRIVATE nisps_core)
    if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang|AppleClang")
        target_compile_options(nisps_parity_check PRIVATE
            -Wall -Wextra -Werror -Wpedantic
            # Disable FP multiply-add contraction so native matches the WASM
            # build, which has no FMA instruction. Without this, native clang/gcc
            # fuses MACs in the training backprop and the (chaotic) loop amplifies
            # the rounding difference past the 1e-5 parity tolerance — pronounced
            # since the input layer widened to 32 for mix-and-match inputs.
            -ffp-contract=off
        )
    elseif(MSVC)
        target_compile_options(nisps_parity_check PRIVATE /W4 /WX /fp:precise)
    endif()
endif()
