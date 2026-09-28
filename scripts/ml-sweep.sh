#!/usr/bin/env bash
# scripts/ml-sweep.sh — run an ML lab sweep (docs/specs/plans/ml-lab-spec.md).
#
# Builds the native behavioural bench (nisps_ml_bench, Release) and hands every
# argument to lab/ml/sweep.mjs, which expands the sweep into configs x seeds,
# runs them in parallel, resumes, and aggregates. Native only: the lab does not
# need firmware/browser parity (spec §1.4).
#
# Usage:
#   scripts/ml-sweep.sh run lab/ml/sweeps/smoke-check.json
#   scripts/ml-sweep.sh run lab/ml/sweeps/train-dose.json --dry-run
#   scripts/ml-sweep.sh run lab/ml/sweeps/train-dose.json --jobs 8
#   scripts/ml-sweep.sh aggregate nisps/build/ml-lab/train-dose
#
# Do not run full-size sweeps on the production VPS (spec §5.3).
#
# Env: NISPS_BUILD_DIR (default nisps/build).
# Exit codes: 2 bad args, 3 build failure, else the driver's.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${NISPS_BUILD_DIR:-$ROOT/nisps/build}"

if [[ $# -eq 0 || "$1" == "-h" || "$1" == "--help" ]]; then sed -n '2,19p' "$0"; exit 0; fi

if [[ "$1" == "run" ]]; then
    echo "==> building native ml_bench" >&2
    if ! cmake -S "$ROOT/nisps" -B "$BUILD_DIR" -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null 2>&1; then
        echo "ml-sweep: cmake configure failed" >&2; exit 3
    fi
    if ! cmake --build "$BUILD_DIR" --target nisps_ml_bench >/dev/null 2>&1; then
        echo "ml-sweep: native build failed" >&2; exit 3
    fi
fi

exec node "$ROOT/lab/ml/sweep.mjs" "$@" --bin "$BUILD_DIR/nisps_ml_bench"
