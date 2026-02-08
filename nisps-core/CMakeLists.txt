cmake_minimum_required(VERSION 3.14)
project(nisps-core VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Header-only library
add_library(nisps INTERFACE)
target_include_directories(nisps INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

# Tests
option(NISPS_BUILD_TESTS "Build tests" ON)
if(NISPS_BUILD_TESTS)
    enable_testing()
    add_subdirectory(test)
endif()
