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
endif()
