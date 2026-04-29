#!/usr/bin/env bash
# scripts/run-all-tests.sh — master entrypoint that exercises every check
# stream 11 owns. Designed to be the single command CI invokes.
#
# Stages (each fails fast):
#   1. C++ build + ctest  → scripts/build-cpp-tests.sh
#   2. WASM build          → scripts/build-wasm.sh
#   3. Parity check        → scripts/parity-check.sh
#   4. Lint                → scripts/lint-cpp.sh
#   5. Playground tests    → cd playground && bun run typecheck + bunx playwright test
#
# Flags via env:
#   NISPS_SKIP_PLAYWRIGHT=1   skip the Playwright leg (useful in C++-only loops)
#   NISPS_SKIP_WASM=1         skip WASM build + parity (no emcc available)
#   NISPS_LINT_STRICT=1       treat lint warnings as failures
#
# Exit codes: 0 on full success, otherwise the failing stage's exit code.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

stage() { printf '\n=== %s ===\n' "$1"; }

stage "1/5 C++ build + ctest"
"$ROOT/scripts/build-cpp-tests.sh"

if [[ "${NISPS_SKIP_WASM:-0}" != "1" ]]; then
    stage "2/5 WASM build"
    "$ROOT/scripts/build-wasm.sh"

    stage "3/5 parity check"
    "$ROOT/scripts/parity-check.sh"
else
    stage "2/5 WASM build (skipped: NISPS_SKIP_WASM=1)"
    stage "3/5 parity check (skipped: NISPS_SKIP_WASM=1)"
fi

stage "4/5 lint"
"$ROOT/scripts/lint-cpp.sh"

if [[ "${NISPS_SKIP_PLAYWRIGHT:-0}" != "1" ]]; then
    stage "5/5 playground tests"
    if ! command -v bun >/dev/null 2>&1; then
        echo "[run-all-tests] bun not on PATH; skipping playground stage"
    else
        (
            cd "$ROOT/playground"
            bun install --frozen-lockfile 2>/dev/null || bun install
            bun run typecheck
            # Ensure browsers are present. `--with-deps` is heavy; leave to CI.
            bunx playwright install chromium >/dev/null 2>&1 || true
            bunx playwright test
        )
    fi
else
    stage "5/5 playground tests (skipped: NISPS_SKIP_PLAYWRIGHT=1)"
fi

stage "ALL GREEN"
