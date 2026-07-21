---
kind: spec
stability: stable
layer: cross-cutting
---

# Browser Engine Architecture — the EngineApi Seam and the Reactive Spine

*Supersession note (2026-07): this spec's original "One Engine, Two Skins" framing — a fresh
`playground2/` tree hosting a faithful a-immersive skin plus a Console skin — is superseded by
`plans/one-core-engine-refactor.md` (executed), which states: "the seam is built — Manifold is its
realisation; the axis of unification now runs vertically, core↔targets, not horizontally,
skin↔skin." The playground2 directory plan, reuse-vs-rebuild table, two-entry Vite/nginx serving
scheme, S0–S7 build sequence, and operator open questions were all consumed by the Manifold build
(`plans/BUILD-PLAN.md`, executed) and are deleted here; git history keeps them. What remains below
is the surviving contract: the headless `EngineApi` boundary and the reactive-spine invariant, as
realised in `manifold/src/engine/`.*

---

## 1. The seam: engine vs presentation

**The engine is separated from presentation by an explicit, headless boundary — `EngineApi` — and
the UI is a pure consumer of it.** The litmus test for every file: if it imports React, JSX, or
touches the DOM, it is presentation; otherwise it is the engine. The engine compiles and is
testable headlessly (the `window.__nisps` probe under `?debug=1`) with zero presentation.

```
            ┌──────────────────────────── ONE ENGINE ────────────────────────────┐
   gesture  │  input pipeline → ML (WASM) → output pipeline → backends            │  sound
  ────────► │      (the reactive spine: one derivation path + one side-effect)    │ ────────►
            │  exposes a headless EngineApi — NO JSX, NO DOM                      │
            └────────────────────────────────────────────────────────────────────┘
                                          ▲
                                          │ reads EngineApi
                               ┌──────────┴───────────┐
                               │  Manifold Console    │
                               │  (React, manifold/)  │
                               └──────────────────────┘
```

Realisation (see `MAP.md` §manifold for the per-file inventory):

- `manifold/src/engine/engine-api.ts` — the `EngineApi` class: the entire UI-facing surface
  (inputs, training, feedback wrappers over the `nisps_ml_feedback_*` C ABI, audio lifecycle).
- `manifold/src/engine/spine.ts` — the reactive spine (§2).
- `manifold/src/engine/EngineProvider.tsx` + `useEngine.ts` — the React binding via
  `useSyncExternalStore`. These two files are the only presentation-side entry to the engine.
- `manifold/src/debug/probe.ts` — `window.__nisps`, reads `EngineApi` only, gated by `?debug=1`.

The UI cannot create a second data path because it has no access to `WasmIML`, the backend, or the
spine's internals — only to `EngineApi`. That structural property, not vigilance, is what makes
the historic "MLP output stops updating when I move the joystick" bug class impossible.

---

## 2. The reactive spine

There is exactly one path from gesture to sound, every consumer reads it, and a desync is a
failing test rather than a recurring prod bug.

### 2.1 The derivation path (`manifold/src/engine/spine.ts`)

The spine is an external store living BELOW React (deliberately not on the render scheduler): the
`setInput` action derives processed → ml → routed **eagerly and synchronously** (the input
pipeline, inference, and output pipeline are all C++/WASM since one-core-engine P4) and fires the
single `backend.send` at the action's tail, off-render. Contract rules:

- **One side-effect.** `backend.send(routed)` at the tail of `setInput` is the only transport
  call in the derivation path.
- **No per-frame allocation.** Buffers are reused (`routedBuf` threaded through the output
  pipeline and handed to the backend).
- **Weights mutate only through engine actions** (train / feedback / reshape), each of which bumps
  the spine's version counter — there is no write path that can update audio without notifying
  the UI.
- **React subscribes via `useSyncExternalStore(subscribe, version)`** — the version counter, not
  the arrays; canvases read the live `Float32Array`s imperatively in rAF and never re-render per
  frame.

### 2.2 The live-feedback guarantee and its e2e assertion

**Guarantee:** any change to the input (gesture) or the weights (train / feedback) propagates — in
the same synchronous action — to the routed output, which the single effect sends to the backend
and which every UI consumer reads.

The invariant is asserted in CI by `manifold/tests/e2e/spine.spec.ts` via the synchronous
`window.__nisps` probe: set inputs, read outputs, expect change (plus probe-survives-mode-switch).
Because the probe reads `EngineApi` only, it exercises the exact path the UI uses.
