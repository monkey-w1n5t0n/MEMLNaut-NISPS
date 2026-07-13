---
kind: finding
date: 2026-06-27
immutable: true
---

# Work log — MIDI + Game Controller inputs, N-D engine foundation

*Scope: what was actually built on the `feat/midi-inputs` branch. This is a
description of the work, not a spec. The design intent lives in
`docs/specs/inputs-spec.md`; where this branch diverges from or only partially
realises that spec, it is called out below.*

## Summary

This branch wires the modular input layer (which already existed as adapters in
`manifold/src/inputs/`) into the Console, adds the missing gamepad→verdict and
MIDI-device plumbing, and reshapes the browser ML engine so input axes are
genuine independent dimensions instead of being blended into two. It landed in
two passes:

1. **Input methods** — a working Inputs dock with three sources (Internal XY
   pad, Game Controller, MIDI), gamepad buttons bound to verdicts, and a batch
   "MIDI Learn".
2. **Engine foundation for mixing** — the WASM net was widened from 2 inputs to
   a 32-input maximum so each active axis gets its own dimension (no blending).

The Inputs dock currently presents the three sources as an **exclusive** picker.
The engine groundwork for *mixing* sources (independent dimensions, no idle-bias)
is in place, but the dock toggles, the reshape-confirm modal, and the
>2-dimension slider visualisation described in `inputs-spec.md` are **not yet
wired** — see "Not done yet" below.

## What changed

### Input sources (`manifold/src/inputs/`)
- `gamepad-source.ts` — buttons now emit both press and release edges (with
  standard-mapping labels A/B/X/Y/LB/RB/…), enabling hold-and-move gestures.
  Single/double-stick (2/4 axes) was already present.
- `midi-input-source.ts` — added single-device selection (`selectDevice`, the
  dock device picker; default still listens to all ports) and changed MIDI-Learn
  from one-binding-per-arm to a **batch** capture: while armed, every distinct CC
  that moves is appended as an axis; notes stay discrete actions and are not
  auto-bound. Learned CCs are exposed as bindings for the dock.
- `types.ts` — `InputAction` gained an optional `phase` ('press' | 'release');
  added an `InputMode` ('internal' | 'gamepad' | 'midi') type.
- `input-layer.ts` — added `onReducedInput` so the on-screen manifold can track a
  gamepad/MIDI-driven position. **`compose()` no longer mean-blends**: it
  forwards each active axis 1:1 to its own engine input slot (the engine
  zero-pads the rest; a zero input is inert, `0 × weight = 0`).
- `useInputLayer.ts` — the React binding; exposes the active mode, per-source
  status, gamepad stick mode, MIDI device list/selection, batch-learn arm, and
  learned bindings. (Currently exclusive — one mode at a time.)

### Console wiring (`manifold/src/console/`)
- `ConsoleApp.tsx` — subscribes to gamepad actions and binds them to existing
  verdict handlers: RB = thumbs-up, LB = thumbs-down, X = randomise, Y = nudge,
  B = undo, A-hold = reposition (hold, move stick, release to place an example
  at the stick position). Mirrors the composed input position onto the manifold
  when a non-pad source is active (deduped to avoid per-frame re-renders).
- `Drawers.tsx` — rebuilt the Inputs drawer: a source picker, a gamepad stick
  toggle + button legend, a MIDI device picker, the batch MIDI-Learn flow with
  its "move every control, then Done" message, and learned controls rendered as
  read-only meters styled distinctly from the output sliders.

### Engine (`manifold/src/engine/`, `nisps/wasm/`)
- `nisps/wasm/bindings.cpp` — `DefaultMLP` widened `MLP<2,…>` → `MLP<32,…>`
  (32 = `MAX_AXES`). Each active axis maps to a dedicated input slot; unused
  slots are held at 0. Rebuilt `nisps.wasm` and synced to both
  `playground/public/` and `manifold/public/` (the C ABI / `nisps.js` glue is
  unchanged).
- `spine.ts` / `engine-api.ts` — `setInputs(arr)` now writes the full
  N-dimensional vector (it previously dropped everything past `arr[1]`); the
  primary pair still runs through the 2-D input pipeline so the pad keeps its
  feel, axes 2+ are written raw, and `process()` re-ticks the whole vector after
  weight changes via the new `spine.reprocess()`.

### Tests / build
- `tests/cpp/parity_check.cpp` + `tests/cpp/parity_wasm.mjs` — `ParityMLP`
  bumped to 32 inputs and the example/feature buffers widened to match the net's
  arity (`add_example` requires `features.size() >= NIn`).
- `nisps/CMakeLists.txt` — the parity binary now builds with `-ffp-contract=off`.
  Widening the input layer exposed a native↔WASM divergence: native clang/gcc
  fuse multiply-adds (FMA) the WASM build has no instruction for, and the
  training loop amplified the rounding difference past the 1e-5 parity tolerance.
  Disabling FP contraction on the native parity build alone restores bit-equality
  (max delta ~2.4e-7).

## Verification
- C++ suites (4/4) pass; native↔WASM parity passes at 1e-5.
- `manifold` typechecks and builds; the Playwright smoke test (engine loads,
  input→output propagates) passes.

## Not done yet (vs `inputs-spec.md`)
- The Inputs dock is an **exclusive** picker; mixing several sources at once
  (independent toggles) is not wired, though the engine and `compose()` now
  support it.
- No reshape-confirm modal + net reset when the active input set changes.
- No swap to a slider visualisation when more than two input dimensions are
  active (the 2-D manifold is always shown).
- The input pipeline (deadzone/zoom/curve) is applied only to the primary pair;
  per-source conditioning for axes 2+ is left raw.
