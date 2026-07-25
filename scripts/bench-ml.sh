#!/usr/bin/env bash
# scripts/bench-ml.sh — behavioural benchmark for the NISPS control mapping.
#
# Sibling to bench-engines.sh, and deliberately the same shape: it builds
# tests/cpp/ml_bench.cpp twice from ONE source (native via CMake, WASM via
# emcc with the flags build-wasm.sh uses), runs both, and reports.
#
# NOTHING HERE FAILS. Behaviour is not a threshold — a "cliff index of 4.9" is
# neither pass nor fail, it is a description. Regressions are noticed by
# running with --compare against a previous report, which prints per-metric Δ.
# Invariants that genuinely must hold are ctest assertions in
# tests/cpp/test_ml_behaviour.cpp, not here.
#
# WHY BOTH TARGETS
# ----------------
# Firmware and browser must feel the same. Native-vs-WASM here is a BEHAVIOURAL
# comparison, which parity-check.sh's 1e-5 bit-equivalence does not give you:
# parity proves two builds of the SAME commit agree, and says nothing about
# whether a mapping is playable or whether a gesture does anything.
#
# Usage:
#   scripts/bench-ml.sh                              # native + wasm
#   scripts/bench-ml.sh --native-only
#   scripts/bench-ml.sh --smoke                      # fast, proves it runs
#   scripts/bench-ml.sh --shape 2,16,16,16,8         # any net shape
#   scripts/bench-ml.sh --sweep-shape                # the architecture sweep
#   scripts/bench-ml.sh --scenario A4_negative_once
#   scripts/bench-ml.sh --compare old.json
#   scripts/bench-ml.sh --out bench-ml-2026-07-25.json
#
# Env:
#   NISPS_BUILD_DIR   default nisps/build
#   EMCC              emcc path (same convention as build-wasm.sh)
#
# Exit codes: 0 on a completed run, 2 on bad args/missing artifacts, 3 on build
# failure.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${NISPS_BUILD_DIR:-$ROOT/nisps/build}"
BENCH_DIR="$BUILD_DIR/bench-ml"
NATIVE_BIN="$BUILD_DIR/nisps_ml_bench"
SRC="$ROOT/tests/cpp/ml_bench.cpp"
REPORT="$ROOT/tests/cpp/ml_bench_report.mjs"
EMCC="${EMCC:-emcc}"

NATIVE_ONLY=0
SMOKE=""
SHAPE=""
SCENARIO=""
COMPARE=""
OUT=""
SWEEP_SHAPE=0
SEED=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --native-only) NATIVE_ONLY=1; shift ;;
        --smoke)       SMOKE="--smoke"; shift ;;
        --shape)       SHAPE="$2"; shift 2 ;;
        --seed)        SEED="$2"; shift 2 ;;
        --scenario)    SCENARIO="$2"; shift 2 ;;
        --compare)     COMPARE="$2"; shift 2 ;;
        --out)         OUT="$2"; shift 2 ;;
        --sweep-shape) SWEEP_SHAPE=1; shift ;;
        -h|--help)     sed -n '2,40p' "$0"; exit 0 ;;
        *) echo "bench-ml: unknown arg '$1'" >&2; exit 2 ;;
    esac
done

mkdir -p "$BENCH_DIR"

bench_args() {
    local a=()
    [[ -n "$SMOKE"    ]] && a+=("$SMOKE")
    [[ -n "$SHAPE"    ]] && a+=(--shape "$SHAPE")
    [[ -n "$SEED"     ]] && a+=(--seed "$SEED")
    [[ -n "$SCENARIO" ]] && a+=(--scenario "$SCENARIO")
    printf '%s\n' "${a[@]:-}"
}

# ---------------------------------------------------------------------------
# native
# ---------------------------------------------------------------------------
echo "==> building native ml_bench" >&2
if ! cmake -S "$ROOT/nisps" -B "$BUILD_DIR" -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null 2>&1; then
    echo "bench-ml: cmake configure failed" >&2; exit 3
fi
if ! cmake --build "$BUILD_DIR" --target nisps_ml_bench >/dev/null 2>&1; then
    echo "bench-ml: native build failed" >&2; exit 3
fi

mapfile -t ARGS < <(bench_args)
NATIVE_JSON="$BENCH_DIR/native.json"
if [[ ${#ARGS[@]} -gt 0 && -n "${ARGS[0]}" ]]; then
    "$NATIVE_BIN" "${ARGS[@]}" > "$NATIVE_JSON"
else
    "$NATIVE_BIN" > "$NATIVE_JSON"
fi
echo "==> native report: $NATIVE_JSON" >&2

# ---------------------------------------------------------------------------
# wasm — one source, second compiler. Same flags build-wasm.sh uses for the
# shipped module, so the comparison is against what actually ships.
# ---------------------------------------------------------------------------
WASM_JSON=""
if [[ $NATIVE_ONLY -eq 0 ]]; then
    if ! command -v "$EMCC" >/dev/null 2>&1; then
        echo "bench-ml: emcc not found; skipping wasm (use --native-only to silence)" >&2
    else
        echo "==> building wasm ml_bench" >&2
        WASM_JS="$BENCH_DIR/ml_bench.mjs"
        if ! "$EMCC" "$SRC" -o "$WASM_JS" \
             -std=gnu++20 -O3 \
             -s ENVIRONMENT=node -s EXIT_RUNTIME=1 -s ALLOW_MEMORY_GROWTH=1 \
             -s SINGLE_FILE=1 >/dev/null 2>&1; then
            echo "bench-ml: wasm build failed" >&2; exit 3
        fi
        WASM_JSON="$BENCH_DIR/wasm.json"
        if [[ ${#ARGS[@]} -gt 0 && -n "${ARGS[0]}" ]]; then
            node "$WASM_JS" "${ARGS[@]}" > "$WASM_JSON"
        else
            node "$WASM_JS" > "$WASM_JSON"
        fi
        echo "==> wasm report: $WASM_JSON" >&2
    fi
fi

# ---------------------------------------------------------------------------
# architecture sweep — the "how does net shape change the UX" instrument.
# Runs the corpus at a ladder of shapes and emits one combined report.
# ---------------------------------------------------------------------------
if [[ $SWEEP_SHAPE -eq 1 ]]; then
    SWEEP_JSON="$BENCH_DIR/sweep-shape.json"
    echo "==> shape sweep" >&2
    {
        echo "["
        first=1
        for s in \
            "2,4,4,4,8"     \
            "2,8,8,8,8"     \
            "2,16,16,16,8"  \
            "2,32,32,32,8"  \
            "2,64,64,64,8"  \
            "1,16,16,16,8"  \
            "4,16,16,16,8"  \
            "8,16,16,16,8"  \
            "32,16,16,16,8" \
            "2,16,16,16,1"  \
            "2,16,16,16,4"  \
            "2,16,16,16,16" \
            "2,16,16,16,33"
        do
            [[ $first -eq 0 ]] && echo ","
            first=0
            "$NATIVE_BIN" --shape "$s" ${SMOKE:+$SMOKE}
        done
        echo "]"
    } > "$SWEEP_JSON"
    echo "==> sweep report: $SWEEP_JSON" >&2
fi

# ---------------------------------------------------------------------------
# format + diff
# ---------------------------------------------------------------------------
if [[ -f "$REPORT" ]] && command -v node >/dev/null 2>&1; then
    if [[ -n "$COMPARE" ]]; then
        node "$REPORT" "$NATIVE_JSON" ${WASM_JSON:+"$WASM_JSON"} --compare "$COMPARE"
    else
        node "$REPORT" "$NATIVE_JSON" ${WASM_JSON:+"$WASM_JSON"}
    fi
else
    echo "(no formatter; raw JSON is in $BENCH_DIR)" >&2
fi

if [[ -n "$OUT" ]]; then
    command cp -f "$NATIVE_JSON" "$OUT"
    echo "==> saved $OUT" >&2
fi
