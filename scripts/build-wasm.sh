#!/usr/bin/env bash
# scripts/build-wasm.sh — compile nisps/wasm/bindings.cpp via Emscripten and
# write the result to playground/public/.
#
# Requires emcc. Defaults to /usr/lib/emscripten/emcc; override via the EMCC
# env var. Sample invocation:
#
#     EMCC=$(which emcc) scripts/build-wasm.sh
#
# Output:
#   playground/public/nisps.js     — Emscripten glue, MODULARIZE factory
#   playground/public/nisps.wasm   — the compiled module

set -euo pipefail

EMCC="${EMCC:-$(command -v emcc || echo /usr/lib/emscripten/emcc)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/playground/public"
SRC="$ROOT/nisps/wasm/bindings.cpp"

if [[ ! -x "$EMCC" && ! -f "$EMCC" ]]; then
  echo "[build-wasm] emcc not found at $EMCC" >&2
  echo "[build-wasm] set EMCC=/path/to/emcc and retry." >&2
  exit 2
fi

mkdir -p "$OUT"

# Exported C functions. Keep this list synchronised with the
# EMSCRIPTEN_KEEPALIVE annotations in bindings.cpp; the build will not
# fail if extras are listed but it WILL fail (or silently strip) if any
# function is missing.
EXPORTED_FUNCS='[
  "_malloc","_free",
  "_nisps_ml_create","_nisps_ml_destroy","_nisps_ml_reset",
  "_nisps_ml_set_input","_nisps_ml_process","_nisps_ml_outputs","_nisps_ml_infer_batch",
  "_nisps_ml_add_example","_nisps_ml_train","_nisps_ml_eval_loss",
  "_nisps_ml_clear_examples","_nisps_ml_example_count",
  "_nisps_ml_weight_count","_nisps_ml_get_weights","_nisps_ml_set_weights",
  "_nisps_ml_draw_weights","_nisps_ml_move_weights",
  "_nisps_ml_feedback_set_mode","_nisps_ml_feedback_get_mode",
  "_nisps_ml_feedback_exploring","_nisps_ml_feedback_learning_paused",
  "_nisps_ml_feedback_set_focus","_nisps_ml_feedback_down",
  "_nisps_ml_feedback_up","_nisps_ml_feedback_drag","_nisps_ml_feedback_static_output",
  "_nisps_ml_feedback_enter_explore","_nisps_ml_feedback_exit_explore",
  "_nisps_ml_feedback_reroll","_nisps_ml_feedback_nudge","_nisps_ml_feedback_undo",
  "_nisps_ml_feedback_like","_nisps_ml_feedback_commit_place","_nisps_ml_feedback_cancel_place",
  "_nisps_ml_feedback_placing","_nisps_ml_feedback_state","_nisps_ml_feedback_undo_depth",
  "_nisps_ml_feedback_placed_output",
  "_nisps_ml_get_layer_stats","_nisps_ml_describe",
  "_nisps_engine_create","_nisps_engine_destroy",
  "_nisps_engine_set_params","_nisps_engine_process_block"
]'

# Runtime helpers we want exposed on the JS module. HEAP* views are needed by
# wasm-iml.ts/wasm-worker.ts/nisps-processor.ts to copy buffers in and out.
EXPORTED_RUNTIME='[
  "HEAP8","HEAP16","HEAP32","HEAPU8","HEAPU16","HEAPU32","HEAPF32","HEAPF64",
  "ccall","cwrap"
]'

set -x
"$EMCC" "$SRC" \
  -std=c++20 -O3 \
  -I "$ROOT/nisps" \
  -fno-exceptions \
  -fno-rtti \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createNispsModule \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=8388608 \
  -s STACK_SIZE=1048576 \
  -s FILESYSTEM=0 \
  -s SINGLE_FILE=0 \
  -s ASSERTIONS=0 \
  -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCS" \
  -s EXPORTED_RUNTIME_METHODS="$EXPORTED_RUNTIME" \
  -o "$OUT/nisps.js"
{ set +x; } 2>/dev/null

echo "[build-wasm] wrote $OUT/nisps.js + $OUT/nisps.wasm"
ls -lh "$OUT/nisps.js" "$OUT/nisps.wasm"
