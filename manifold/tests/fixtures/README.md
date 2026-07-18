# Pipeline golden fixtures

Originally captured **2026-07-13** from the TypeScript engine implementations,
**before** the P4 "one core engine" migration
(`docs/specs/plans/one-core-engine-refactor.md` §P4). As of **2026-07-18** that
migration has landed: the curve / input-pipeline / output-pipeline maths now
live solely in the C++/WASM core (`nisps/pipeline/*`, `nisps/core/math.hpp`),
and the TS `curves.ts` / `input-pipeline.ts` / `output-pipeline.ts` are deleted.

These fixtures are the recorded-gesture pre/post-migration regression P4's gate
calls for: *"same pointer trace → same routed output pre/post migration."* The
test (`../pipeline-golden.test.ts`) now drives the WASM chains against them.

## What is here

| File | What it pins | Driven through (now) |
|---|---|---|
| `gesture-trace.json` | One canonical synthetic pointer trace (288 events, fixed 120 Hz dt) over the input pipeline's native `[0,1]²` domain: h/v sweeps, diagonal, spiral, figure-eight, dwell + abrupt corner jumps. Pure formula — no `Math.random`, no `Date.now`. | (input to the input chain) |
| `curves-golden.json` | The curve catalog, 129 samples of `x ∈ [0,1]` inclusive. **See "Curves re-baselined" below.** | `nisps_curve_apply` (WASM) |
| `input-pipeline-golden.json` | The gesture trace run through the input pipeline under 14 representative configs (default, deadzone, zoom, sticky anchor, per-axis, curves, smoothing, invert, momentum gentle/strong, frozen axis, fully frozen, combined). Records `{x, y, frozen}` per event. Configs embedded. **FROZEN** pre-migration capture. | `nisps_input_*` (WASM) |
| `output-pipeline-golden.json` | A deterministic raw-output sequence (120 vectors × 8 channels of offset sines, quantised to f32) run through the output pipeline under 8 configs (default, curves, smoothing, slew, global-freeze toggled mid-sequence, per-output freeze mask, combined). Records the processed vector per step. Configs embedded. **FROZEN** pre-migration capture. | `nisps_output_*` (WASM) |

## The regression guard

`../pipeline-golden.test.ts` (`bun test`) loads the built WASM
(`../../public/nisps.{js,wasm}`) via the indirect-eval shim (`../wasm-load.ts`,
same technique as `tests/cpp/parity_wasm.mjs`), creates a pipeline handle, and
re-runs the **committed fixtures** through the C++ chains. The fixtures are
authoritative: the trace, raw sequence, and per-run configs are read FROM the
JSON, so the config lists in `pipeline-golden-lib.ts` cannot mask a regression.

### Tolerances (f32 WASM vs f64-captured fixtures)

- **Input / output pipelines: `1e-5`.** Measured max non-momentum drift `<5e-7`.
- **Momentum configs (`momentum-gentle` / `momentum-strong` / `combined`):
  `1e-2`.** This is proven-inherent f32 drift, **not** a core bug. The velocity
  ring's window-membership test (`now − t ≤ window`) is a DISCRETE boundary that
  f32 rounding can flip during fast gestures, shifting which sample is the
  window's oldest by a whole frame (~8 ms) → a step change in the measured speed
  → integrated by the momentum-zoom IIR. A byte-faithful f32 port of the exact
  original TS algorithm reproduces the WASM to `<6e-8` while both diverge from
  the f64 capture by the same `~7–9e-3` (measured max `8.6e-3` on
  momentum-strong). Reconciling it would require f64 momentum maths, which would
  break firmware parity — so the momentum runs are guarded at `1e-2` (the core
  is still tightly pinned to the algorithm by the `<6e-8` faithful-f32 identity;
  a real behavioural regression would blow far past `1e-2`).

## Curves re-baselined (2026-07-18)

`curves-golden.json` is now a MIX, recorded in its `provenance` field:

- **`linear` / `square` / `sqrt` / `centered_power`** — the ORIGINAL 2026-07-13
  f64 TS captures, kept unchanged. The C++ core reproduces them within `1e-5`
  (measured `<3e-8`), proving **no behaviour change** for these curves.
- **`exp` / `log` / `sigmoid` / `cubic`** — **RE-BASELINED from the WASM.** The
  browser deliberately adopted the canonical firmware-exact maths: the old TS
  `curves.ts` used `k=4` exp/log, slope-8 sigmoid, and a smoothstep "cubic"; the
  canonical `nisps/core/math.hpp` catalog uses `k=1`-normalised exp/log, a
  slope-6 sigmoid, and a true cubic `x³`. The test asserts WASM stability
  against these regenerated values.

## Contracts you must reproduce to consume these

### State contract (both chains are stateful, C++-side per pipeline handle)
- **Input:** EMA-smoothed x/y, a velocity ring, and a momentum-zoom multiplier.
- **Output:** `prev` + `smoothed` buffers driving slew/freeze.

Each config **run resets state** (`nisps_input_reset` / `nisps_output_reset`)
at step 0. Runs are independent; do not carry state between them.

### Clock contract (input pipeline only)
The C++ input chain accumulates its own clock from the per-call `dt` (seconds)
for the momentum velocity window; it takes **no** wall clock. To reproduce the
capture, the test feeds each event's `dt` = the per-event `t_ms` delta in
seconds, with the **first event's `dt` = 0** (matching the original TS capture,
which pinned `performance.now()` to each event's `t_ms`). The output chain uses
a constant per-step `dt` of `1000/60` ms (→ seconds).

### JSON encodings
- `slewRate: null` in an output spec means `Infinity` (JSON has no `Infinity`);
  it maps to the wire's `slew_rate <= 0 ⇒ unlimited`.
- Output raw values are pre-quantised with `Math.fround` so they equal exactly
  what a `Float32Array` holds.

## Re-capture

`bun tests/fixtures/_generate.ts` regenerates `gesture-trace.json` (pure data)
and re-baselines the 4 changed curves in `curves-golden.json` from the WASM
(preserving the 4 unchanged f64 entries + provenance). It does **not** rewrite
the input/output pipeline goldens — those are the frozen pre-migration capture
the regression is measured against; there is no TS pipeline left to capture
from. `scripts/build-wasm.sh` must have run first.
