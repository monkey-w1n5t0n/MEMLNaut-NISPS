# nisps/wasm

Emscripten target that exposes `nisps/ml` (MLP) and `nisps/engines` (audio
engines) to the browser apps via a flat C ABI.

This directory is a leaf — it does not export headers for inclusion by
other C++ code. The only artifact is `bindings.cpp` plus the build script
that turns it into `manifold/public/nisps.{wasm,js}` (with a transitional
copy to `playground/public/` until P1 of
`docs/specs/plans/one-core-engine-refactor.md` retires the playground).

## Building

```bash
scripts/build-wasm.sh
```

Requires `emcc` (Emscripten). The script defaults to
`/usr/lib/emscripten/emcc` and respects an `EMCC` env var override.

Output:

- `manifold/public/nisps.wasm` — the compiled module.
- `manifold/public/nisps.js`  — Emscripten glue (factory function
  `createNispsModule`, MODULARIZE=1).

Both files are committed (so the browser apps work from a fresh clone
without a C++ toolchain). Re-run `build-wasm.sh` after changes to
`nisps/{core,ml,engines,wasm}`.

## Architecture (runtime-shaped since one-core-engine P2)

The browser MLP is `MLPCore<DynamicStorage>` (`nisps/ml/dynamic_storage.hpp`):
`nisps_ml_create(input, output, hidden[3], n, seed)` HONOURS its dimensions.
The 4-layer topology (ReLU×3 + Sigmoid) is fixed; only the dimensions are
runtime, capped at 4096 per dim. Non-positive/null arguments fall back to the
historical defaults:

    32 inputs → [10, 14, 18] hidden → 126 outputs

`nisps_ml_reshape(ml, in, out, hidden, n, spread)` constructs a new net at
the requested shape, warm-starts it by copying the overlapping weight region
(`nisps/ml/warm_start.hpp`), and swaps it in. The C-side dataset and the
feedback controller state RESET on reshape (front-end shows a confirm modal).
Heap is used only at create/reshape time, never per-call; the firmware target
never compiles the dynamic storage at all (`#error` under
`NISPS_TARGET_EMBEDDED`).

## C API surface

See `bindings.cpp` for the full list. Summary:

| Group     | Functions                                                                    |
|-----------|------------------------------------------------------------------------------|
| ML life   | `nisps_ml_create`, `nisps_ml_destroy`, `nisps_ml_reshape`                    |
| ML I/O    | `nisps_ml_set_input`, `nisps_ml_process`, `nisps_ml_outputs`, `nisps_ml_infer_batch` |
| Training  | `nisps_ml_add_example`, `nisps_ml_train`, `nisps_ml_eval_loss`, `nisps_ml_clear_examples` |
| Weights   | `nisps_ml_weight_count`, `nisps_ml_get_weights`, `nisps_ml_set_weights`, `nisps_ml_draw_weights` |
| Diag      | `nisps_ml_get_layer_stats`, `nisps_ml_describe`                              |
| Engines   | `nisps_engine_create`, `nisps_engine_destroy`, `nisps_engine_set_params`, `nisps_engine_process_block` |

Engine-id strings follow the C++ `engine_id()` constexpr accessors:
`thru`, `paf_synth`, `channel_strip`, `xiasri`, `verb_fx`, `memlcelium`,
`breakor`, `elysiamorf`, `analysis`. Unknown ids fall back to `thru`
(silent passthrough).
