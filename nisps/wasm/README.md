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

## Architecture limit (read this)

The MLP class template is parametrised on `(input_size, hidden1, hidden2,
hidden3, output_size)`. WASM cannot recompile templates at runtime, so
this build instantiates exactly ONE configuration:

    nisps::ml::MLP<32, 10, 14, 18, 126>

That serves the browser use case (up to 32 input axes → up to 126 synth
parameters). `nisps_ml_create()` accepts caller-supplied dimensions for
forward compatibility but currently ignores them — see comment at the top
of `bindings.cpp`. The schemas in `schemas/modes/*.json` use up to
`output_size=126`; modes whose output_size is < 126 simply ignore the
trailing entries.

To support additional architectures, either:

1. Compile multiple wasm modules (`nisps_small.wasm`,
   `nisps_default.wasm`, …) and let the playground load the right one
   based on the active mode.
2. Add a runtime-shape MLP variant to `nisps/ml` (heap allocation only at
   `create()`; no impact on hot paths).

Both options are deferred to a future stream.

## C API surface

See `bindings.cpp` for the full list. Summary:

| Group     | Functions                                                                    |
|-----------|------------------------------------------------------------------------------|
| ML life   | `nisps_ml_create`, `nisps_ml_destroy`, `nisps_ml_reset`                      |
| ML I/O    | `nisps_ml_set_input`, `nisps_ml_process`, `nisps_ml_outputs`, `nisps_ml_infer_batch` |
| Training  | `nisps_ml_add_example`, `nisps_ml_train`, `nisps_ml_eval_loss`, `nisps_ml_clear_examples`, `nisps_ml_example_count` |
| Weights   | `nisps_ml_weight_count`, `nisps_ml_get_weights`, `nisps_ml_set_weights`, `nisps_ml_draw_weights`, `nisps_ml_move_weights` |
| Diag      | `nisps_ml_get_layer_stats`, `nisps_ml_describe`                              |
| Engines   | `nisps_engine_create`, `nisps_engine_destroy`, `nisps_engine_set_params`, `nisps_engine_process_block` |

Engine-id strings follow the C++ `engine_id()` constexpr accessors:
`thru`, `paf_synth`, `channel_strip`, `xiasri`, `verb_fx`, `memlcelium`,
`breakor`, `elysiamorf`, `analysis`. Unknown ids fall back to `thru`
(silent passthrough).
