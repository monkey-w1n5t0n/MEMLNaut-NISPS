#!/usr/bin/env bash
# scripts/parity-check.sh — run nisps_parity_check natively AND via WASM,
# then float32-diff the resulting blobs.
#
# Prerequisites:
#   1. scripts/build-cpp-tests.sh has run (need nisps_parity_check binary).
#   2. scripts/build-wasm.sh has run (need manifold/public/nisps.{js,wasm}).
#
# This script can run either step on demand if the artifacts are missing.
# Skip auto-build with NISPS_PARITY_NO_BUILD=1.
#
# Exit codes:
#   0 — outputs match within 1e-5 absolute tolerance
#   1 — mismatch
#   2 — file/format error or missing artifacts
#   3 — build failure

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TESTS_DIR="$ROOT/tests/cpp"
BUILD_DIR="${NISPS_BUILD_DIR:-$ROOT/nisps/build}"
NATIVE_BIN="$BUILD_DIR/nisps_parity_check"
WASM_GLUE="$ROOT/manifold/public/nisps.js"
WASM_MOD="$ROOT/manifold/public/nisps.wasm"
NATIVE_OUT="$TESTS_DIR/parity_native.bin"
WASM_OUT="$TESTS_DIR/parity_wasm.bin"
TOL="${NISPS_PARITY_TOL:-1e-5}"
NO_BUILD="${NISPS_PARITY_NO_BUILD:-0}"

ensure_native() {
    if [[ -x "$NATIVE_BIN" ]]; then return 0; fi
    if [[ "$NO_BUILD" == "1" ]]; then
        echo "[parity-check] missing $NATIVE_BIN and NISPS_PARITY_NO_BUILD=1; aborting" >&2
        exit 2
    fi
    echo "[parity-check] native binary missing — running build-cpp-tests.sh"
    NISPS_RUN_TESTS=0 "$ROOT/scripts/build-cpp-tests.sh" >/dev/null || {
        echo "[parity-check] C++ build failed" >&2
        exit 3
    }
}

ensure_wasm() {
    if [[ -f "$WASM_GLUE" && -f "$WASM_MOD" ]]; then return 0; fi
    if [[ "$NO_BUILD" == "1" ]]; then
        echo "[parity-check] missing $WASM_GLUE / $WASM_MOD and NISPS_PARITY_NO_BUILD=1; aborting" >&2
        exit 2
    fi
    echo "[parity-check] WASM artifacts missing — running build-wasm.sh"
    "$ROOT/scripts/build-wasm.sh" >/dev/null 2>&1 || {
        echo "[parity-check] WASM build failed" >&2
        exit 3
    }
}

ensure_native
ensure_wasm

echo "[parity-check] running native..."
"$NATIVE_BIN" "$NATIVE_OUT"

echo "[parity-check] running WASM..."
node "$TESTS_DIR/parity_wasm.mjs" "$WASM_OUT"

echo "[parity-check] diffing (tolerance=$TOL)..."
node "$TESTS_DIR/parity_diff.mjs" "$NATIVE_OUT" "$WASM_OUT" "$TOL"
status=$?

if [[ $status -eq 0 ]]; then
    echo "[parity-check] PASS"
else
    echo "[parity-check] FAIL (exit=$status)" >&2
fi
exit $status
