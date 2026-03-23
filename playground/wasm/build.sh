#!/bin/bash
# Build nisps-core WASM module for the playground
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NISPS_CORE="$SCRIPT_DIR/../../nisps-core/include"
OUT_DIR="$SCRIPT_DIR"

echo "Building nisps WASM module..."

emcc "$SCRIPT_DIR/nisps_bindings.cpp" \
    -I"$NISPS_CORE" \
    -std=c++20 \
    -O2 \
    -s EXPORTED_FUNCTIONS='[
        "_nisps_mlp_create",
        "_nisps_mlp_destroy",
        "_nisps_mlp_weight_count",
        "_nisps_mlp_get_weights",
        "_nisps_mlp_set_weights",
        "_nisps_mlp_inference",
        "_nisps_mlp_train",
        "_nisps_mlp_draw_weights_spread",
        "_nisps_mlp_move_weights_spread",
        "_nisps_alloc",
        "_nisps_free",
        "_nisps_alloc_int",
        "_nisps_free_int",
        "_malloc",
        "_free"
    ]' \
    -s EXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32","HEAP32"]' \
    -s MODULARIZE=1 \
    -s EXPORT_NAME=NispsModule \
    -s EXPORT_ES6=1 \
    -s ENVIRONMENT='web,worker' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=16777216 \
    -o "$OUT_DIR/nisps.js"

echo "Built: $OUT_DIR/nisps.js + $OUT_DIR/nisps.wasm"
echo "Size: $(du -h "$OUT_DIR/nisps.wasm" | cut -f1)"
