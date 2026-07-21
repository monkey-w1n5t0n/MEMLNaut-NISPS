#!/usr/bin/env bash
# scripts/build-cpp-tests.sh — configure + build the host C++ test suite.
#
# Output: nisps/build/{nisps_core_tests,nisps_dsp_engine_tests,
#                     nisps_modes_tests,nisps_golden_tests,nisps_parity_check,
#                     nisps_engine_bench}
#
# Adds CTest registration for the first four. The last two are standalone:
# parity_check is invoked by scripts/parity-check.sh (orchestrates native+WASM
# together), and engine_bench by scripts/bench-engines.sh (measures time and
# asserts nothing, so it has no pass/fail for ctest to report).
#
# Honours these env vars:
#   CMAKE_BUILD_TYPE  default Release; pass Debug for stepping
#   NISPS_BUILD_DIR   default nisps/build; override for clean builds
#   NISPS_RUN_TESTS   if "1", run ctest after the build (default 1)
#
# Returns nonzero on configure or build failure, or on test failure when
# NISPS_RUN_TESTS=1.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${NISPS_BUILD_DIR:-$ROOT/nisps/build}"
BUILD_TYPE="${CMAKE_BUILD_TYPE:-Release}"
RUN_TESTS="${NISPS_RUN_TESTS:-1}"

# Pick a generator. Ninja is fastest; fall back to Make if unavailable.
GENERATOR="Unix Makefiles"
if command -v ninja >/dev/null 2>&1; then
    GENERATOR="Ninja"
fi

echo "[build-cpp-tests] root=$ROOT"
echo "[build-cpp-tests] build_dir=$BUILD_DIR generator=$GENERATOR build_type=$BUILD_TYPE"

cmake -S "$ROOT/nisps" -B "$BUILD_DIR" \
    -G "$GENERATOR" \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE"

cmake --build "$BUILD_DIR" --parallel

if [[ "$RUN_TESTS" == "1" ]]; then
    echo "[build-cpp-tests] running ctest..."
    # CTest's default output is terse; --output-on-failure surfaces details
    # only when something breaks. The progress flag keeps CI logs scannable.
    (cd "$BUILD_DIR" && ctest --output-on-failure --progress)
fi

echo "[build-cpp-tests] done."
