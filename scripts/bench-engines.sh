#!/usr/bin/env bash
# scripts/bench-engines.sh — measure engine throughput on BOTH host targets.
#
# The repo's performance constraint ("super performance-sensitive", ALIGNMENT
# defect 5) was enforced entirely by static discipline: a no-heap lint, section
# attributes, and — since Phase 4 — a firmware flash/RAM report. Nothing
# measured time. This does.
#
# It builds tests/cpp/engine_bench.cpp twice from ONE source:
#   native — CMake target nisps_engine_bench (Release/-O3)
#   wasm   — emcc, with the same flags scripts/build-wasm.sh uses for the
#            shipped module, run under node
# then prints a side-by-side table of ns/sample, blocks/s and realtime factor
# per engine, plus a wasm/native ratio.
#
# NOTHING HERE FAILS. A wall-clock threshold on shared CI hardware is either
# slack enough to be meaningless or tight enough to fail on an unrelated noisy
# runner — the same call the firmware size job made. A regression is noticed by
# running this with --compare against a previous report, which prints per-engine
# Δ% (positive = slower). Reports are plain JSON; keep one around to diff.
#
# Usage:
#   scripts/bench-engines.sh                       # native + wasm, full run
#   scripts/bench-engines.sh --native-only         # skip emcc
#   scripts/bench-engines.sh --smoke               # ~1 s, proves it still runs
#   scripts/bench-engines.sh --engine verb_fx      # one engine
#   scripts/bench-engines.sh --compare old.json    # diff vs a previous report
#   scripts/bench-engines.sh --out bench-2026-07-21.json
#
# Env:
#   NISPS_BUILD_DIR        default nisps/build
#   NISPS_BENCH_NO_BUILD   1 = never invoke a build; fail if artifacts missing
#   EMCC                   emcc path (same convention as build-wasm.sh)
#
# Exit codes: 0 on a completed run, 2 on missing artifacts/args, 3 on build
# failure.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${NISPS_BUILD_DIR:-$ROOT/nisps/build}"
BENCH_DIR="$BUILD_DIR/bench"
NATIVE_BIN="$BUILD_DIR/nisps_engine_bench"
SRC="$ROOT/tests/cpp/engine_bench.cpp"
REPORT="$ROOT/tests/cpp/bench_report.mjs"
NO_BUILD="${NISPS_BENCH_NO_BUILD:-0}"

run_native=1
run_wasm=1
out_path=""
compare_path=""
bench_args=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --native-only) run_wasm=0; shift ;;
        --wasm-only)   run_native=0; shift ;;
        --out)         out_path="${2:?--out needs a path}"; shift 2 ;;
        --compare)     compare_path="${2:?--compare needs a path}"; shift 2 ;;
        --smoke)       bench_args+=("--smoke"); shift ;;
        --engine|--repeats|--target-ms|--block-size|--sample-rate|--seed)
                       bench_args+=("$1" "${2:?$1 needs a value}"); shift 2 ;;
        -h|--help)
            sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *)
            echo "[bench-engines] unknown argument: $1" >&2
            exit 2 ;;
    esac
done

if [[ $run_native -eq 0 && $run_wasm -eq 0 ]]; then
    echo "[bench-engines] --native-only and --wasm-only are mutually exclusive" >&2
    exit 2
fi

mkdir -p "$BENCH_DIR"
runs=()

# ---------------------------------------------------------------------------
# Native
# ---------------------------------------------------------------------------
if [[ $run_native -eq 1 ]]; then
    if [[ ! -x "$NATIVE_BIN" ]]; then
        if [[ "$NO_BUILD" == "1" ]]; then
            echo "[bench-engines] missing $NATIVE_BIN and NISPS_BENCH_NO_BUILD=1" >&2
            exit 2
        fi
        echo "[bench-engines] native binary missing — running build-cpp-tests.sh"
        NISPS_RUN_TESTS=0 "$ROOT/scripts/build-cpp-tests.sh" >/dev/null || {
            echo "[bench-engines] C++ build failed" >&2
            exit 3
        }
    fi
    echo "[bench-engines] running native..."
    "$NATIVE_BIN" --json --label native "${bench_args[@]}" > "$BENCH_DIR/native.json"
    runs+=("$BENCH_DIR/native.json")
fi

# ---------------------------------------------------------------------------
# WASM — same source, same optimisation/exception/RTTI flags as the shipped
# module (scripts/build-wasm.sh), plus a node-shaped runtime. STACK_SIZE is
# raised for the same reason build-wasm.sh raises it: the DSP objects are big.
# ---------------------------------------------------------------------------
if [[ $run_wasm -eq 1 ]]; then
    EMCC="${EMCC:-$(command -v emcc || echo /usr/lib/emscripten/emcc)}"
    if [[ "$EMCC" != */* ]]; then EMCC="$(command -v "$EMCC" || echo "$EMCC")"; fi
    if [[ ! -x "$EMCC" && ! -f "$EMCC" ]]; then
        echo "[bench-engines] emcc not found at $EMCC — skipping the WASM leg" >&2
        echo "[bench-engines] (set EMCC=/path/to/emcc, or pass --native-only)" >&2
        run_wasm=0
    elif ! command -v node >/dev/null 2>&1; then
        echo "[bench-engines] node not on PATH — skipping the WASM leg" >&2
        run_wasm=0
    fi
fi

if [[ $run_wasm -eq 1 ]]; then
    if [[ "$NO_BUILD" == "1" && ! -f "$BENCH_DIR/engine_bench.js" ]]; then
        echo "[bench-engines] missing $BENCH_DIR/engine_bench.js and NISPS_BENCH_NO_BUILD=1" >&2
        exit 2
    fi
    if [[ "$NO_BUILD" != "1" ]]; then
        echo "[bench-engines] compiling WASM bench..."
        "$EMCC" "$SRC" \
            -std=c++20 -O3 \
            -fno-exceptions \
            -fno-rtti \
            -s ENVIRONMENT=node \
            -s ALLOW_MEMORY_GROWTH=1 \
            -s INITIAL_MEMORY=16777216 \
            -s STACK_SIZE=1048576 \
            -s ASSERTIONS=0 \
            -s EXIT_RUNTIME=1 \
            -o "$BENCH_DIR/engine_bench.js" || {
            echo "[bench-engines] WASM build failed" >&2
            exit 3
        }
    fi
    echo "[bench-engines] running wasm..."
    node "$BENCH_DIR/engine_bench.js" --json --label wasm "${bench_args[@]}" > "$BENCH_DIR/wasm.json"
    runs+=("$BENCH_DIR/wasm.json")
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
if [[ ${#runs[@]} -eq 0 ]]; then
    echo "[bench-engines] no target ran" >&2
    exit 2
fi

report_args=("${runs[@]}")
report_args+=(--out "${out_path:-$BENCH_DIR/latest.json}")
if [[ -n "$compare_path" ]]; then
    if [[ ! -f "$compare_path" ]]; then
        echo "[bench-engines] --compare file not found: $compare_path" >&2
        exit 2
    fi
    report_args+=(--compare "$compare_path")
fi

echo ""
node "$REPORT" "${report_args[@]}"
