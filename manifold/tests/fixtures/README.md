# Pipeline golden fixtures

**Captured 2026-07-13** from the current **TypeScript** engine implementations,
**before** the P4 "one core engine" migration
(`docs/specs/plans/one-core-engine-refactor.md` §P4) replaces the TS
curve/input/output code with calls into the C++/WASM core.

P4's own gate reads: *"recorded-gesture regression: same pointer trace → same
routed output pre/post migration (capture fixture before starting)."* These
files are that capture.

## What is here

| File | What it pins | Source under test |
|---|---|---|
| `gesture-trace.json` | One canonical synthetic pointer trace (288 events, fixed 120 Hz dt) over the input pipeline's native `[0,1]²` domain: h/v sweeps, diagonal, spiral, figure-eight, dwell + abrupt corner jumps. Pure formula — no `Math.random`, no `Date.now`. | (input to the input pipeline) |
| `curves-golden.json` | `applyCurve(name, x)` for every curve id in `curves.ts`, 129 samples of `x ∈ [0,1]` inclusive, at each curve's default `param`. | `src/engine/curves.ts` |
| `input-pipeline-golden.json` | The gesture trace run through `processInput` under 14 representative configs (default, deadzone, zoom, sticky anchor, per-axis, curves, smoothing, invert, momentum gentle/strong, frozen axis, fully frozen, combined). Records `{x, y, frozen}` per event. Configs embedded. | `src/engine/input-pipeline.ts` |
| `output-pipeline-golden.json` | A deterministic raw-output sequence (120 vectors × 8 channels of offset sines, quantised to f32) run through `processOutput` under 8 configs (default, curves, smoothing, slew limiting, global-freeze toggled mid-sequence, per-output freeze mask, combined). Records the processed vector per step. Configs embedded. | `src/engine/output-pipeline.ts` |

## The drift guard

`../pipeline-golden.test.ts` (`bun test`) re-runs the **current** TS
implementations against these fixtures and asserts equality within **1e-9**. It
reads the trace, raw sequence, and configs **from the JSON** — the fixtures are
authoritative, so editing `pipeline-golden-lib.ts` config lists cannot mask a
regression. Any change to `curves.ts` / `input-pipeline.ts` / `output-pipeline.ts`
that alters numeric behaviour breaks this test until the goldens are
deliberately re-captured.

To re-capture (only when intended): `cd manifold && bun tests/fixtures/_generate.ts`.

## Contracts you must reproduce to consume these

### State contract (both pipelines are stateful)
- **Input:** EMA-smoothed x/y, a velocity ring, and a momentum-zoom multiplier.
- **Output:** `prev` + `smoothed` buffers driving slew/freeze.

Each config **run resets state** (`defaultInputState()` / `defaultOutputState()`)
at step 0. Runs are independent; do not carry state between them.

### Clock contract (input pipeline only)
`input-pipeline.ts`'s momentum-zoom path reads `performance.now()` (wall clock)
for its 150 ms velocity window. To make the momentum configs reproducible, the
capture pins `performance.now()` to each event's `t_ms` before processing it, so
the velocity window slides over the gesture's own timescale. `dt` passed to
`processInput` is the per-event `t_ms` delta in seconds (fixed `1000/120` ms).
A future consumer that ports this to C++ must feed the same per-event timestamps
(the trace's `t_ms`) into whatever owns the velocity ring, or the momentum runs
will not match. The output pipeline uses no wall clock; its `dtMs` is a fixed
`1000/60`.

### JSON encodings
- `slewRate: null` in an output spec means `Infinity` (JSON has no `Infinity`).
- Output raw values are pre-quantised with `Math.fround` so they equal exactly
  what a `Float32Array` holds.

## How P4 should consume these

After the input/output/curve logic moves into the C++/WASM core, flip
`pipeline-golden.test.ts` to drive the **WASM** implementations (via the
main-thread `nisps` instance) instead of the TS `run*` helpers, keeping the same
fixtures as the expected values. That proves *same pointer trace → same routed
output* across the migration.

**Tolerance:** these goldens were produced in TS **f64**. The WASM core computes
in **f32** for many paths, so exact 1e-9 equality will not hold post-migration —
relax the comparison to about **1e-5** (and expect the sigmoid/exp/log curve tails
and long smoothing/slew accumulations to be the widest-drifting points). If any
value drifts materially beyond that, it is a real behavioural divergence, not
float noise, and must be reconciled in the core rather than by widening tolerance.
