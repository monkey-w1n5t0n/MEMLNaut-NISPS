#!/usr/bin/env bash
# scripts/run-all-tests.sh — master local entrypoint that exercises every
# check the repo owns. CI (.github/workflows/ci.yml) does NOT invoke this
# script; it re-lists the same stages as discrete steps so failures are
# attributable per-step. Keep the two in sync when adding a stage.
#
# Stages (each fails fast):
#   1. C++ build + ctest  → scripts/build-cpp-tests.sh
#   2. WASM build          → scripts/build-wasm.sh
#   3. Parity check        → scripts/parity-check.sh
#   4. Lint                → scripts/lint-cpp.sh
#   5. Manifold tests      → codegen golden + curve drift, then
#                            cd manifold && typecheck + build + bun test + playwright
#   6. Engine bench SMOKE   → scripts/bench-engines.sh --smoke --native-only
#
# Stage 6 is REPORTING ONLY and deliberately tiny (~0.15 s, native only, no
# emcc). It exists so the benchmark cannot rot unnoticed the way an unbuilt
# firmware variant did, and so every full local run leaves a rough throughput
# table in the log. It does NOT gate: a smoke-sized run has a ±30% noise floor
# and a wall-clock threshold on shared hardware is either meaningless or flaky
# (same reasoning as the firmware flash/RAM CI job). For numbers you can
# actually compare, run scripts/bench-engines.sh on its own — it defaults to
# best-of-3 × 150 ms per engine on both targets and takes --compare.
#
# Flags via env:
#   NISPS_SKIP_PLAYWRIGHT=1   skip the Playwright leg (useful in C++-only loops)
#   NISPS_SKIP_WASM=1         skip WASM build + parity (no emcc available)
#   NISPS_SKIP_BENCH=1        skip the engine-bench smoke report
#   NISPS_LINT_STRICT=1       treat lint warnings as failures
#   PLAYWRIGHT_BROWSERS_PATH  respected (on the VPS point it at the snap-bun
#                             browser cache — see docs/specs/plans/BUILD-PLAN.md)
#
# Exit codes: 0 on full success, otherwise the failing stage's exit code.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

stage() { printf '\n=== %s ===\n' "$1"; }

stage "1/6 C++ build + ctest"
"$ROOT/scripts/build-cpp-tests.sh"

if [[ "${NISPS_SKIP_WASM:-0}" != "1" ]]; then
    stage "2/6 WASM build"
    "$ROOT/scripts/build-wasm.sh"

    stage "3/6 parity check"
    "$ROOT/scripts/parity-check.sh"
else
    stage "2/6 WASM build (skipped: NISPS_SKIP_WASM=1)"
    stage "3/6 parity check (skipped: NISPS_SKIP_WASM=1)"
fi

stage "4/6 lint"
"$ROOT/scripts/lint-cpp.sh"

if [[ "${NISPS_SKIP_PLAYWRIGHT:-0}" != "1" ]]; then
    stage "5/6 manifold tests"
    if ! command -v bun >/dev/null 2>&1; then
        echo "[run-all-tests] bun not on PATH; skipping manifold stage"
    else
        (
            # Codegen idempotence golden (C++ + manifold TS outputs), then the
            # curve drift check: the schemas' declared per-voice-space response
            # curves vs what nisps/engines/*.hpp actually computes.
            cd "$ROOT/codegen"
            bun install --frozen-lockfile 2>/dev/null || bun install
            bun run tests/golden_test.ts
            bun run tests/curve_drift_test.ts
        )
        (
            cd "$ROOT/manifold"
            bun install --frozen-lockfile 2>/dev/null || bun install
            bun run typecheck
            bun run test
            bun run build
            # The Playwright RUNNER goes through non-snap node: snap-confined
            # bun cannot see host browser libraries (BUILD-PLAN gotcha).
            # Ensure browsers are present. `--with-deps` is heavy; leave to CI.
            node node_modules/.bin/playwright install chromium >/dev/null 2>&1 || true
            node node_modules/.bin/playwright test
        )
    fi
else
    stage "5/6 manifold tests (skipped: NISPS_SKIP_PLAYWRIGHT=1)"
fi

# Report-only. See the stage list at the top of this file for why it does not
# gate and why it is smoke-sized here.
if [[ "${NISPS_SKIP_BENCH:-0}" != "1" ]]; then
    stage "6/6 engine bench (report only, does not gate)"
    NISPS_BENCH_NO_BUILD=1 "$ROOT/scripts/bench-engines.sh" --smoke --native-only
else
    stage "6/6 engine bench (skipped: NISPS_SKIP_BENCH=1)"
fi

stage "ALL GREEN"
