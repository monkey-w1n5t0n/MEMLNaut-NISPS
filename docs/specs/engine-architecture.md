---
kind: spec
stability: evolving
layer: cross-cutting
---

# NISPS Foundation Architecture — One Engine, Two Skins

*Status: implementation-ready spec. Scope: the foundation only — the headless engine layer plus the two-skin shell. The detailed UX of each skin (Console drawers, interactive heatmap craft, etc.) is owned by `plans/playground-2.0-rewrite-plan.md` and not re-litigated here.*

*Constraint from the operator: "lay solid ground that's simple and doesn't paint us into a corner." Build BOTH skins on ONE engine; don't port the engine twice; don't inherit existing tech debt.*

---

## 0. The one decision that drives everything

**Separate the engine from the skin by an explicit, headless boundary — `EngineApi` — and let both skins be pure consumers of it.** Today there is no such boundary: `mode-runtime.ts` fuses WASM lifecycle, the reactive graph, input adapters, audio host, snapshots, heatmap sampling, and per-mode component wiring into one 663-line hook that each cloned `*Mode.tsx` calls. That fusion is *the* debt. The foundation's whole job is to draw the line the god-hook erased, on the correct side:

```
            ┌──────────────────────────── ONE ENGINE ────────────────────────────┐
   gesture  │  input pipeline → ML (WASM) → output pipeline → backends            │  sound
  ────────► │      (the reactive spine: one memo chain + one side-effect)         │ ────────►
            │  exposes a headless EngineApi { inputRaw, mlOutput, routedOutput,   │
            │     verdict actions, history, status } — NO JSX, NO DOM             │
            └────────────────────────────────────────────────────────────────────┘
                         ▲                                   ▲
                         │ reads EngineApi                   │ reads EngineApi
              ┌──────────┴───────────┐            ┌──────────┴───────────┐
              │  skin-a-immersive    │            │  skin-2.0 (Console)  │
              │  (faithful clone)    │            │  (right dock+drawers) │
              │  served at  /        │            │  served at  /2.0     │
              └──────────────────────┘            └──────────────────────┘
```

The litmus test for every file: **if it imports `solid-js/web`, JSX, or touches the DOM, it is a skin; otherwise it is the engine.** The engine compiles and is testable headlessly (Node/`__nisps` probe) with zero presentation. Two skins on one engine is then trivially true: a skin is just a tree of components that read `EngineApi` accessors and call `EngineApi` actions. Neither skin can break live-feedback, because neither skin owns the spine.

---

## 1. Module / directory structure

**Build in a fresh tree: `playground2/`** (justification in §3). Inside it, the engine and the two skins are siblings; presentation never reaches into engine internals except via `EngineApi`.

```
playground2/
├── index.html                      # skin-a-immersive entry (default, root)
├── 2.0.html                        # skin-2.0 entry (Console variant)
├── vite.config.ts                  # two inputs; base resolved per-build (§4)
├── package.json                    # solid-js, vite, vite-plugin-solid, @playwright/test
├── public/
│   ├── nisps.wasm  nisps.js        # copied from scripts/build-wasm.sh output
│   └── c15.wasm  c15.glue.js       # (only if/when C15 lands; deferred)
│
├── src/
│   ├── engine/                     # ───────── HEADLESS. No JSX. No DOM. ─────────
│   │   │
│   │   ├── index.ts                # createEngine(schema, opts): EngineApi  ← THE boundary
│   │   ├── types.ts                # EngineApi, EngineOptions, EngineStatus
│   │   │
│   │   ├── spine/
│   │   │   ├── control-graph.ts    # the memo chain + the single send-effect (§2). ~1 file.
│   │   │   └── coalesce.ts         # pointer-rate → display-cadence batch()+microtask gate
│   │   │
│   │   ├── ml/                     # LIFTED from playground/ (parity-tested), de-storified
│   │   │   ├── wasm-iml.ts         # WasmIML class — adapt: HeapVec, reused out-buffer, no store writes
│   │   │   ├── heap-vec.ts         # NEW: re-derive HEAPF32 view on every access (replaces rebind())
│   │   │   ├── wasm-worker.ts      # LIFT as-is: disposable training worker (own WASM instance)
│   │   │   └── dataset.ts          # LIFT as-is
│   │   │
│   │   ├── audio/                  # LIFTED from playground/ — already correct
│   │   │   ├── engine-host.ts      # LIFT ~as-is: ?worker&url, fetch+post bytes, transferables
│   │   │   └── worklet/
│   │   │       ├── nisps-processor.ts          # LIFT as-is: 2nd WASM, hand-rolled imports
│   │   │       └── audioworklet-globals.d.ts   # LIFT as-is
│   │   │
│   │   ├── pipelines/              # LIFTED — pure fns, golden-tested
│   │   │   ├── input.ts            # deadzone→zoom→curve→smoothing→momentum  (was input/pipeline.ts)
│   │   │   ├── output.ts           # global curve→smoothing→slew→freeze       (was output/pipeline.ts)
│   │   │   └── curves.ts           # ONE curve catalog, golden-tested vs nisps/core/math.hpp (§3)
│   │   │
│   │   ├── backends/               # OutputBackend adapters (plan §3.6)
│   │   │   ├── backend.ts          # interface OutputBackend { send, start, teardown }
│   │   │   ├── web-audio.ts        # wraps engine-host (v1)
│   │   │   ├── web-midi.ts         # 7-bit CC out (v1 adapter; stub-OK at foundation)
│   │   │   └── osc-bridge.ts       # WS bridge (deferred; behind locked contract)
│   │   │
│   │   ├── stores/                 # module singletons, split by update cadence (plan §3.2)
│   │   │   ├── ml-store.ts         # status/arch/dataset + outputs F32 signal + weightsRevision
│   │   │   ├── input-store.ts      # config store + raw-axes F32 signal {equals:false}
│   │   │   ├── output-store.ts     # global gate config + reuse buffer
│   │   │   ├── control-store.ts    # compound axes + per-param createMemo fanout
│   │   │   ├── routing-store.ts    # control-point off/fixed/live matrix
│   │   │   ├── history-store.ts    # snapshot DAG (undo/A-B/trail/snapshots)
│   │   │   ├── session-store.ts    # presets, persistence, URL params, mode switch
│   │   │   └── bus.ts              # LIFT as-is: typed sync pub/sub, cross-cutting events only
│   │   │
│   │   ├── runtime/                # the decomposed god-hook (plan §3.4) — engine-side hooks
│   │   │   ├── use-input-adapters.ts   # pointer/joystick/gamepad/mic → input-store.setRaw
│   │   │   ├── use-audio-lifecycle.ts  # backend start/stop/teardown on mount/mode-switch
│   │   │   ├── use-snapshots.ts        # DAG ops (→ history-store)
│   │   │   ├── use-heatmap-sampler.ts  # input-space heatmap, throttled to weightsRevision
│   │   │   ├── use-trail.ts
│   │   │   └── use-auto-explore.ts
│   │   │
│   │   ├── feedback/
│   │   │   └── controller.ts       # the 3-mode FeedbackController: thumbsUp/thumbsDown/randomize
│   │   │                           #   + undo, wrapping moveWeights/drawWeights/train + auto-snapshot
│   │   │
│   │   ├── persist.ts              # persist<T>(store, version, migrate): versioned + base64 weights
│   │   └── probe.ts                # window.__nisps — reads EngineApi only; ?debug=1-gated
│   │
│   ├── shared/                     # ───── presentation shared by BOTH skins ─────
│   │   ├── primitives/             # LIFTED: Slider, JoyMap, Heatmap, XYPad, LossPlot,
│   │   │                           #   GradientFlow, WeightHealth, ProgressRing, ... (+ .demo.tsx)
│   │   ├── theme/
│   │   │   └── tokens.css          # orange #ff6a00, danger #ff4466, glass, JetBrains Mono;
│   │   │                           #   lint allowlist enforced
│   │   ├── EngineProvider.tsx      # createContext(EngineApi); both skins wrap their tree
│   │   └── GenericMode.tsx         # ONE schema-driven mode component (plan §3.5)
│   │
│   ├── skin-a-immersive/           # ───── DEFAULT skin (faithful a-immersive) ─────
│   │   ├── main.tsx                # mounts <EngineProvider><AImmersiveApp/></EngineProvider>
│   │   ├── AImmersiveApp.tsx
│   │   └── components/             # bottom-sheet-faithful chrome, floating RL buttons, top strip
│   │
│   ├── skin-2.0/                   # ───── Console skin (Playground 2.0) ─────
│   │   ├── main.tsx                # mounts <EngineProvider><ConsoleApp/></EngineProvider>
│   │   ├── ConsoleApp.tsx          # the Manifold + dock + drawers + Verdict cluster
│   │   └── components/             # Dock, Drawer (3-depth), VerdictCluster, ReadoutStrip, ...
│   │
│   └── dev/
│       └── PrimitivesShowcase.tsx  # /dev/primitives (shared, skin-agnostic)
│
└── tests/e2e/                      # Playwright: spine invariant, both skins, parity hooks
```

### Why this shape is "simple and doesn't paint us into a corner"

- **One axis of variation per directory.** Adding an *engine* touches `nisps/` + `schemas/` + `public/*.wasm`; zero skin files. Adding a *backend* touches `engine/backends/`; zero spine, zero skin. Adding/altering a *skin* touches one `skin-*/` tree; zero engine. This is the orthogonality principle made physical.
- **`EngineApi` is the only seam.** Skins import `useEngine()` (the context) and nothing from `engine/` internals. A lint rule (`no-restricted-imports`: skins may not import `engine/**` except `engine/index.ts`/`engine/types.ts`) keeps it honest. You could delete a whole skin and the engine + tests still pass.
- **`GenericMode` lives in `shared/`, not in a skin** — both skins render the same mode bodies; they differ only in *chrome* (how drawers/strips/clusters frame the canvas), not in *what a mode is*. This is what makes "two skins, one engine" cheap rather than a fork.

---

## 2. The reactive spine, concretely

This is the load-bearing structural fix and the literal definition of "doesn't paint us into a corner": there is exactly one path from gesture to sound, every consumer reads it, and a desync is a failing test rather than a recurring prod bug.

### 2.1 The chain (in `engine/spine/control-graph.ts`)

```ts
// One input entry point. {equals:false} so identical-reference writes still notify.
const inputRaw: Accessor<Float32Array>         // input-store's raw-axes signal

// ── pure memos ──────────────────────────────────────────────────────────────
const processedInput = createMemo(() =>        // deadzone→zoom→curve→smoothing→momentum
  runInputPipeline(inputRaw(), inputStore.config, inputState));   // pure, golden-tested

const mlOutput = createMemo(() => {            // WasmIML.infer INTO a reused buffer
  const inp = processedInput();                // (no per-frame Float32Array alloc)
  iml.setInputsClamped(inp);                   // clamps to REAL arch (no phantom channels — §6/D)
  return iml.inferInto(mlOutBuf);              // returns the reused buffer; pure *read* of weights
}, mlOutBuf, { equals: false });

const routedOutput = createMemo(() =>          // voice-space + global gate
  runOutputPipeline(mlOutput(), routingStore, outputStore.config, outputState));

// ── the ONE side-effect ──────────────────────────────────────────────────────
createEffect(() => {
  const out = routedOutput();                  // single dependency
  backend.send(fillSendBuffer(out));           // dedicated re-filled transferable (neutering-safe)
});                                             // ← the ONLY postMessage / engine post in the app
```

Rules made structural, not aspirational:
- **Memos are pure.** No `postMessage`, no `backend.send`, no store writes inside a memo. (Lint/review rule; the plan explicitly rejects P3's "postMessage in a memo" and P1's `createComputed`.)
- **Weights mutate only through `ml-store` actions** that bump `weightsRevision`. `mlOutput`'s memo reads weights; because RL/train actions bump the revision and the memo's input or revision is a dependency, output re-derives. There is no leaked write path that can update audio without updating the UI.
- **`mlOutput` writes into `mlOutBuf` and returns it** with `{equals:false}` — fixes today's per-frame `new Float32Array(...)` alloc in `WasmIML.process()` (line 302) and the god-hook's `recomputeOutputs`.
- **Pointer-rate is coalesced to display cadence** in `coalesce.ts` via `batch()` + a microtask, *reactively* (not a rAF poll). rAF touches **canvas drawing only**, never inference.
- **The send buffer is dedicated and owned by the effect**, separate from any signal buffer, because transferring neuters the source (today's `EngineHost.setParams` transfers `params.buffer`).

### 2.2 How BOTH skins consume it identically

Every consumer **reads accessors**; nobody is *pushed to*. There is no "push outputs to the UI" path that can rot — the bug class is deleted, not patched.

```ts
// shared/EngineProvider.tsx
const EngineContext = createContext<EngineApi>();
export const useEngine = () => useContext(EngineContext)!;

// EngineApi (engine/types.ts) — the entire skin-facing surface
interface EngineApi {
  // live reactive reads (the spine)
  inputRaw:      Accessor<Float32Array>;
  processedInput:Accessor<Float32Array>;
  mlOutput:      Accessor<Float32Array>;       // raw model space (heatmap, diagnostics)
  routedOutput:  Accessor<Float32Array>;       // post-pipeline (engine, readout strip, visualizer)
  status:        EngineStatus;                  // ready, audioStarted, training, examples, ... (store proxy)
  weightsRevision: Accessor<number>;
  layerStats:    () => Float32Array;            // diagnostics pull (throttled by caller)
  lossHistory:   Accessor<ReadonlyArray<number>>;
  // actions
  setInput:      (x: number, y: number) => void;     // the ONLY input door
  feedback:      FeedbackController;                  // thumbsUp/thumbsDown/randomize/undo/canUndo
  train:         () => void;
  history:       HistoryApi;                          // DAG: A/B pin/swap, jump-to-node
  audio:         { start(): Promise<void>; stop(): Promise<void>; setMuted(b): void };
  schema:        ModeSchema;
}
```

- **skin-a-immersive**: a floating RL button reads `engine.feedback.thumbsUp`; the top strip reads `engine.routedOutput()`; the XY pad calls `engine.setInput(x,y)`.
- **skin-2.0**: the Verdict cluster's 👍 reads the *same* `engine.feedback.thumbsUp`; the ReadoutStrip reads the *same* `engine.routedOutput()`; the Manifold's pointer-down calls the *same* `engine.setInput(x,y)`.

Identical bindings, different chrome. A skin cannot create a second reactive path because it has no access to `WasmIML`, `backend`, or the stores' internal setters — only to `EngineApi`.

### 2.3 Live-feedback guarantee + the e2e assertion

**Guarantee:** any change to `inputRaw` (gesture) *or* `weightsRevision` (RL/train) propagates — in the same synchronous tick — to `routedOutput`, which the single effect sends to the backend and which every UI consumer reads. There is no code path that updates audio without updating the readout, or vice versa.

**The e2e invariant, asserted on every mode, in both skins, in CI** (the centerpiece; mirrors plan §3.1):

```ts
// tests/e2e/spine.spec.ts — runs for each {mode} × {skin: '/', '/2.0'}
const before = await page.evaluate(() => window.__nisps.getOutputs());
await page.evaluate(() => window.__nisps.setInputs([0.9, 0.1]));   // synchronous probe
const after  = await page.evaluate(() => window.__nisps.getOutputs());
expect(after).not.toEqual(before);                                 // ML output changed
const eng = await page.evaluate(() => window.__nisps.getEngineParams());
expect(eng).toChange();                                            // engine params changed, same input
```

`window.__nisps` (in `engine/probe.ts`) is exposed synchronously, bypasses Solid reactivity with `untrack`/`batch`, and **reads `EngineApi` only** — so the probe exercises the exact path both skins use. Because the probe lives in the engine layer (not a skin), the *same* spec file runs unchanged against both `index.html` and `2.0.html`; if either skin ever fails to read the spine, that skin's row goes red.

A complementary **no-per-frame-alloc** check (heap-snapshot fuzz around a `setInputs` storm) guards the reused-buffer discipline.

---

## 3. Reuse-vs-rebuild

**Recommendation: build the foundation in a FRESH directory `playground2/`, lifting the parity-tested engine modules wholesale and discarding the skin/runtime layer.** This is strictly simpler than refactoring `playground/` in place and carries the least debt, *because the debt and the value are cleanly separable in the existing tree* — the value is the headless engine modules (already DOM-free), the debt is the god-hook + cloned modes + toy `App.tsx`.

### Reuse table

| Existing `playground/` module | Verdict | Action / why |
|---|---|---|
| `audio/engine-host.ts` | **Lift ~as-is** | Already correct: `?worker&url`, fetch-on-main + post bytes, transferables, lazy AudioContext. Best code in the repo. Minor: wrap behind `WebAudioBackend`. |
| `audio/worklet/nisps-processor.ts` | **Lift as-is** | Two-WASM, hand-rolled auto-discovered imports, 128-sample shuttle. Load-bearing and correct. |
| `audio/worklet/audioworklet-globals.d.ts` | **Lift as-is** | — |
| `ml/wasm-iml.ts` | **Lift + adapt** | Keep the C-API surface and lifecycle. **Adapt:** (1) replace `HeapBuffer.rebind()` (manual, error-prone via `Object.defineProperty`) with `HeapVec` re-derive-on-access; (2) `inferInto(buf)` instead of `process()` allocating; (3) **remove `mlStore.__set*` writes from the class** — the class becomes a pure WASM wrapper, the store observes it. (4) Plumb real `nisps_ml_loss_history` (replaces the `lossHistory=[loss]` fake at line 419). |
| `ml/wasm-worker.ts` | **Lift as-is** | Disposable training worker w/ own WASM instance. |
| `ml/dataset.ts` | **Lift as-is** | JS mirror of the C++ ring. |
| `input/pipeline.ts` | **Lift as-is** → `engine/pipelines/input.ts` | Pure, golden-tested, bit-equivalent to legacy. Becomes the `processedInput` memo body. |
| `output/pipeline.ts` | **Lift as-is** → `engine/pipelines/output.ts` | Pure; becomes `routedOutput` body. **Fix:** use reuse buffer. |
| `output/curves.ts` | **Lift + fix** | **Unify with the diverging `Curve` enum** in `generated/types.ts` (`exp/log/square/sqrt/sigmoid/cubic`) into ONE catalog, golden-tested against `nisps/core/math.hpp`. (Plan §4 "Pure-fn pipelines" Keep+fix.) |
| `stores/bus.ts` | **Lift as-is** | Typed sync pub/sub; cross-cutting events only. |
| `stores/ml-store.ts` | **Adapt** | Keep the signal/store split (it's already right: `outputs` F32 `{equals:false}`, store for status). **Add** `weightsRevision`. **Invert ownership:** store observes `WasmIML`, class stops writing the store. |
| `stores/input-store.ts`, `output-store.ts` | **Adapt** | Keep config-store + raw F32 signal pattern; align to spine (input-store's raw signal becomes `inputRaw`). |
| `stores/control-store.ts` | **Adapt** | Keep axis tables/presets/`interpolateAxis`. **Replace** the routing mechanism with **per-param `createMemo` fanout** (kills the `control-routing.ts` `JSON.stringify`-in-untracked-effect anti-pattern). |
| `stores/session-store.ts`, `mode-store.ts`, `exploration-store.ts` | **Salvage values, re-cut along plan §3.2** | Re-partition into `routing-store` (control-point `off/fixed/live`), `history-store` (DAG), `session-store` (persist+presets+URL+mode). Lift constants/preset data; rebuild the store shapes. |
| `stores/persistence.ts` | **Rebuild small** → `engine/persist.ts` | Replace bespoke per-store `Partial<>` merges + `Infinity↔null` slew encoding + slow `Array.from()` weight JSON with one `persist<T>(store, version, migrate)`; base64 weights. |
| `features/snapshots.ts`, `overrides.ts`, `trail.ts`, `heatmap-sampler.ts`, `weight-health.ts`, `mic-input.ts` | **Salvage logic into `engine/runtime/` hooks** | The *algorithms* are fine; the *wiring* (god-hook calling them imperatively) is the debt. Re-home as `use-snapshots`/`use-trail`/`use-heatmap-sampler` reading stores, not as side-effects of `setInput`. Snapshots fold into the DAG. |
| `features/control-routing.ts` | **Discard** | The `JSON.stringify`-inside-`untrack` effect anti-pattern; replaced by control-store memo fanout. |
| `features/session-preset.ts` | **Rebuild** | Composed-layers model (control/synth/weights/mode), per plan §3.8. |
| `primitives/*` (16 + demos) | **Lift as-is** → `shared/primitives/` | Genuinely good, skin-agnostic, already have `.demo.tsx`. The reusable presentation layer. |
| `dev/PrimitivesShowcase.tsx`, `debug/probe.ts` | **Lift + adapt** | Showcase as-is. Probe re-pointed at `EngineApi` (it currently pokes stores directly); `?debug=1`-gate it. |
| **`modes/mode-runtime.ts` (663 lines)** | **DISCARD** | The god-hook. Its responsibilities are split across `engine/spine/`, `engine/runtime/`, `engine/feedback/`. **Do not inherit.** |
| **`modes/*Mode.tsx` (9 cloned files, ~5.6k lines)** | **DISCARD** | Replaced by one `shared/GenericMode.tsx` driven by schema. The clones *are* the debt. |
| `modes/ModeShell.tsx`, `ModeSwitcher.tsx`, `SettingsDrawer.tsx`, `mode-helpers.ts` | **Discard / re-design per skin** | Chrome belongs to skins now; a capability-class switcher is rebuilt minimally. |
| `App.tsx`, `main.tsx` | **Discard** | Toy hash-router with a "home page." Replaced by two skin entries + `EngineProvider`. |
| `modes/generated/*` | **Regenerate, don't lift** | Codegen output; add `capability_class` + `tier` fields (plan §3.5/§3.9) and emit into `playground2/`. |

**Verdict in one line:** lift the entire `engine/` + `shared/primitives/` (≈ the `ml/`, `audio/`, `input/`, `output/`, `primitives/`, `bus.ts` value — the parity-tested core) and rebuild only the ≈6.5k lines of god-hook + cloned modes + toy app that *are* the debt.

### Fresh dir vs refactor-in-place — justification

| | **Fresh `playground2/` (recommended)** | Refactor `playground/` in place |
|---|---|---|
| Debt inheritance | Zero — debt files never copied; engine lifted file-by-file on purpose | High — easy to leave a god-hook tendril; "delete later" rarely happens |
| "Simple ground" | Clean import graph from day 1; lint seam enforceable immediately | Mixed old/new imports during migration; seam blurry for weeks |
| Parity risk | None — engine files lifted verbatim, parity-check runs against the same `nisps.wasm` | None, but harder to prove which path a test exercised |
| Live deploy | Untouched. `playground/dist` keeps building; we wire `playground2/dist` only when ready | Risk of breaking the live (if pointed) build mid-refactor |
| Rollback | `rm -rf playground2/` | `git revert` across an entangled history |
| Cost | One-time copy of ~10 good files | Ongoing vigilance against re-entanglement |

A fresh dir is the cheaper path to *less debt while reusing the parity-tested core* — exactly the operator's brief. `playground/` stays as the working reference (and keeps deploying) until `playground2/` reaches parity, then `playground/` is deleted and `playground2/`→`playground/` (a rename, by which point the engine seam is proven).

> **Note for the operator (open question A in the plan):** if 2.0 is actually destined for the laptop `~/src/manifold` tree, this whole `playground2/` lands there instead — the architecture is identity-agnostic and the dir name is the only thing that changes. This blocks namespace/repo identity; see §6.

---

## 4. Two-skins mechanism (build + serve)

**Decision: two Vite entries, one build, one `dist/` — NOT a runtime route.** Two HTML entry points compiled in a single `vite build` produce `dist/index.html` (skin A) and `dist/2.0.html` (skin B), sharing all common chunks (engine, primitives, wasm). Rationale against "simple, no corners":

- **A runtime route** (`/2.0` as a client route inside one bundle) would force both skins into one app shell, one router, and — crucially — risk a *shared mutable* engine instance and shared chrome assumptions, reintroducing exactly the cross-skin coupling we're eliminating. It also makes "delete a skin" hard.
- **Two entries** keep the skins genuinely independent (each owns its `main.tsx` + `EngineProvider` mount) while Vite's `manualChunks`/automatic splitting means the engine + primitives are **one shared chunk loaded by both** — zero engine duplication on disk or over the wire. This is the cleanest expression of "one engine, two skins."

### Vite config

```ts
// playground2/vite.config.ts
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { resolve } from 'node:path';

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig(({ command }) => ({
  // Skin A is served at site root; skin B at /2.0/. We build ONCE with base '/2.0/'-aware
  // asset URLs? No — simpler: build relative, let nginx alias map. See note below.
  base: './',                       // relative asset URLs → same dist works at / and at /2.0/
  plugins: [solid()],
  server:  { port: 5173, headers: isolation },   // dev: COOP/COEP for SharedArrayBuffer + worklet
  preview: { port: 4173, headers: isolation },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),   // → dist/index.html      (skin A, default)
        v2:   resolve(__dirname, '2.0.html'),      // → dist/2.0.html        (skin B, Console)
      },
    },
  },
}));
```

**Why `base: './'` (relative) rather than a fixed `/2.0/` base.** The two skins share `dist/assets/*`. If skin B used absolute `base:'/2.0/'`, skin A (at `/`) would request the wrong asset prefix. Relative `base` makes **the same `dist/` mount correctly at both `/` and `/2.0/`** with no second build. The one caveat is the **AudioWorklet URL** and the **`?worker&url` chunk**: Vite emits these as module URLs resolved relative to the importing chunk, which works under a sub-path *as long as the chunk itself is loaded relatively* — relative `base` satisfies this. The worklet's WASM is fetched by absolute `/nisps.wasm`; under a sub-path we make that **origin-relative and configurable** (engine reads `import.meta.env.BASE_URL` or a runtime `<base>`), so `/2.0/` resolves `…/nisps.wasm` correctly. (Today `wasm-iml.ts`/`engine-host.ts` hardcode `/nisps.wasm` against `window.location.origin` — fine at root, must become base-aware for the sub-path. This is the single concrete code change the two-skins serving imposes.)

Two `package.json` scripts make dev ergonomic:
```jsonc
"dev":     "vite",                          // serves both index.html and 2.0.html
"dev:2.0": "vite --open /2.0.html",
"build":   "tsc --noEmit && vite build",    // emits dist/index.html + dist/2.0.html
```

### nginx (keeping the legacy a-immersive root untouched)

The current root is `meml-aimmersive` serving the **legacy vanilla** `a-immersive.html`. The new SolidJS app builds to `…/meml.lnfinitemonkeys.org/playground/dist` (currently unserved). The cleanest, no-corner serving plan: **add location blocks for the new app under explicit sub-paths, leave `/` on the legacy root for now**, and flip `/` to the new skin A only when the operator signs off.

```nginx
# inside the existing 443 server { } for meml.lnfinitemonkeys.org
# (COOP/COEP already set at server scope → inherited by all locations below)

set $pg2 /home/w1n5t0n/deployments/meml.lnfinitemonkeys.org/playground2/dist;

# ── Skin B: Console at /2.0 ────────────────────────────────────────────────
location = /2.0 { return 301 /2.0/; }
location /2.0/ {
    alias $pg2/;
    index 2.0.html;
    try_files $uri $uri/ /2.0/2.0.html;     # SPA fallback to skin B's entry
}

# ── Skin A: faithful clone, staged at /next while it's proven ──────────────
location = /next { return 301 /next/; }
location /next/ {
    alias $pg2/;
    index index.html;
    try_files $uri $uri/ /next/index.html;  # SPA fallback to skin A's entry
}

# ── Shared assets (one chunk set for both skins) ──────────────────────────
location /assets/ { alias $pg2/assets/; }   # relative-base requests resolve here
location = /nisps.wasm { alias $pg2/nisps.wasm; }
location = /nisps.js   { alias $pg2/nisps.js; }

# legacy root stays:
#   root /home/w1n5t0n/deployments/meml-aimmersive;  index a-immersive.html;  (UNCHANGED)
```

**Cutover (one-line change, when signed off):** point `/` at skin A by setting the server `root $pg2;` + `index index.html;` and a top-level `try_files $uri /index.html;`. Until then `/` serves the legacy artifact untouched, `/next/` is the new faithful skin, `/2.0/` is the Console. The auto-deploy script gains one line: after `playground/`'s `npm run build`, also `cd playground2 && npm install && npm run build` (or replace once `playground/` is retired). COOP/COEP is **server-scoped already**, so every sub-path inherits cross-origin isolation — no per-location header duplication needed (the one real correctness requirement for SharedArrayBuffer + the worklet under a sub-path is satisfied for free).

---

## 5. Build sequence (small, shippable, Playwright-testable)

Each step ends green and observable. Parity checkpoints (verification chokepoints C/E) called out. This mirrors the plan's Phase 0–4 but with the **two-skin seam established early** so neither skin can diverge.

| Step | Deliverable | Test gate | Parity |
|---|---|---|---|
| **S0 — Scaffold + seam** | `playground2/` Vite skeleton; two HTML entries; `tokens.css` + CSS-var lint allowlist; `EngineApi`/`EngineProvider` stubs; codegen re-emitting into `playground2/` with `capability_class`+`tier` and **build-fails-on-arch-mismatch**; `persist<T>` helper; `bus.ts` lifted. Two trivial skins each render "hello from skin A/B" reading a stub `EngineApi`. | `bun run typecheck` green; codegen golden test; Playwright loads `/` and `/2.0.html`, both mount. | Codegen idempotent (byte-identical regen). |
| **S1 — Spine against a stub** | `control-graph.ts` memo chain + single send-effect with a **stubbed `mlOutput`** (deterministic fn of input); `input-store` + `output-store` with lifted pure pipelines (curve enums unified, golden-tested); `coalesce.ts`. `EngineApi.setInput`/`routedOutput` real. | **Spine invariant e2e** (`setInputs→getOutputs changes`) passes against the stub, **on both skins**; no-per-frame-alloc heap fuzz. | Pipeline golden vs legacy bit-equivalence. |
| **S2 — WASM ML bridge** | Lift `wasm-iml.ts` + `wasm-worker.ts` + `dataset.ts`; add `HeapVec` re-derive; `inferInto(buf)`; `ml-store` observes the class (no class→store writes); `weightsRevision`; real `nisps_ml_loss_history` plumbed. `mlOutput` memo now calls real `WasmIML`. | Probe `infer`/`train`/`getLayerStats`; loss plot draws a *real* curve; spine invariant still green on both skins. | **Checkpoint:** main-thread inference matches native within 1e-5 (`parity-check.sh`). |
| **S3 — Audio + first real mode via GenericMode** | Lift `engine-host.ts` + worklet behind `WebAudioBackend`; base-aware WASM URL; `GenericMode.tsx` rendering **PAFSynth** (synth class). Mount `GenericMode` inside *both* skin shells (minimal chrome each). | Per-mode live-feedback e2e (engine params change on input move) on both skins; "Start audio" gesture works. | **Checkpoint:** `parity-check.sh` green; browser PAFSynth audio equivalent to firmware (chokepoint C). |
| **S4 — Skin A default, faithful** | Build out `skin-a-immersive/` to faithfully reproduce a-immersive chrome (bottom-sheet, floating RL buttons, top strip) over `GenericMode` + `EngineApi`. Feedback controller (`thumbsUp/Down/randomize/undo`) wired; snapshot DAG (`history-store`) behind undo. Serve at `/next/`. | Playwright drives the faithful loop via probe + via real DOM on `/next/`; visual-faithfulness check (key anchors, orange tokens); a-immersive feature-parity subset (chokepoint D start). | — |
| **S5 — Skin B Console at /2.0** | Build out `skin-2.0/`: Manifold + right dock + 3-depth drawers + Verdict cluster + interactive ReadoutStrip, all reading the *same* `EngineApi`. RL-undo + A/B against the DAG. Serve at `/2.0/`. | The **same** spine + feedback e2e specs run against `/2.0/` unchanged and pass; Console-specific drawer/depth e2e. | — |
| **S6 — Mode coverage + backends + persistence** | All in-scope engines via `GenericMode` (synth/sequencer/controller/visual classes; `SequencerLane`, `VisualEngine`, controller meters); capability-class switcher in both skins; `WebMidiBackend` + (stubbed) `OscBridgeBackend`; versioned persistence + base64 weights; control surface (axis memo fanout, presets, pinning). | Every mode passes live-feedback e2e in CI on both skins; tactile-constant e2e (3px/300ms) on the Console strip. | **Checkpoint:** parity per mode; full `run-all-tests.sh` green = chokepoint E. |
| **S7 — Cutover** | Point nginx `/` at skin A; delete legacy `meml-aimmersive` serving (archive the artifact); retire `playground/`, rename `playground2/`→`playground/`; update deploy script. | Post-cutover smoke e2e against `/` and `/2.0/`. | — |

The deliberate ordering choice vs the plan: **establish `EngineApi` + both skin mounts at S0** (not after the Console is built), so from the very first stub the "two skins read one engine" property is *tested*, and no skin can quietly grow its own data path. The Console UX detail (drawers, depths) is still de-risked against `/dev/primitives` and user-tested with Dimi before S5, per the plan.

---

## 6. Risks & open questions for the operator

**Open questions that block or shape the build (need a call before S0/S2):**

1. **Canonical tree / identity (plan §8-A).** Is the foundation `playground2/` *in this VPS `MEMLNaut-NISPS` tree* (`nisps::`), or does it belong in the laptop `~/src/manifold` tree (`manifold::`)? This blocks the dir name, namespace, repo, and codegen identity. *Recommendation:* build here (the live tree the recon ran against; rename is trivial), but confirm.

2. **Fixed-2-input contract (plan §8-D) — the big one.** The foundation hard-codes the honest fixed `MLP<2,10,14,18,126>` contract: codegen **fails the build** on schema/arch mismatch and `GenericMode` clamps `setInput` to the real arch (killing today's phantom-channel OOB writes in `mode-runtime.ts` lines 224-230 and `wasm-iml` warn-and-ignore at lines 198-203). Consequence: **multi-input mic modes (XIASRI / sound_analysis_midi) are firmware-only in v1** and show a "single-input in browser" badge; the runtime-shaped MLP is deferred *behind a passing parity check, never bundled into this rewrite*. Confirm you accept this v1 contraction — it's a materially smaller browser surface than "all modes work in browser."

3. **Two entries vs runtime route — confirm.** I've chosen two Vite entries / one `dist` (cleanest "one engine, two skins"). If you'd rather a single bundle with a `/2.0` client route (e.g. to share an app shell), say so now — it changes the skin-mount and engine-instance model.

4. **Serving cutover policy.** I propose: legacy a-immersive stays at `/` untouched; new skins live at `/next/` (faithful) and `/2.0/` (Console) until you sign off, then `/`→skin A. Confirm you want the new default *staged* rather than replacing `/` immediately. (Also: do you want skin A to eventually *replace* the legacy vanilla a-immersive, or coexist?)

5. **`capability_class` + `tier` schema fields (plan §8-B/§8-C).** The foundation's `GenericMode` and switcher depend on these new schema fields. Confirm the four classes (Synth/Controller/Sequencer/Visual) and the per-param/diagnostic `tier: 0|1|2` disclosure model are canonical, since codegen and `EngineApi.schema` bake them in from S0.

**Risks carried into the build (mitigations baked into the architecture):**

| Risk | Mitigation |
|---|---|
| A skin quietly grows a second data path → live-feedback rot returns | `EngineApi` is the only seam; `no-restricted-imports` lint forbids skins importing `engine/**` internals; spine e2e runs on **both** skins in CI. |
| Memo purity violated (side-effect creeps into a memo) | Single documented send-`createEffect`; lint/review rule; the chain is one tested file (`control-graph.ts`). |
| WASM URL breaks under `/2.0/` sub-path | Base-aware asset resolution (`import.meta.env.BASE_URL`); the one concrete change the sub-path imposes; covered by a load-under-sub-path e2e. |
| Shared `dist` + relative base mis-resolves worklet/`?worker&url` chunk | `base:'./'` + nginx `alias`; explicit load-both-skins e2e at S0 catches it immediately. |
| Lifting `wasm-iml` re-imports its store-coupling debt | Adapt-on-lift: strip `mlStore.__set*` from the class; store observes the class. Enforced by the headless-engine lint (engine files may not import skin/JSX). |
| Two builds in the deploy pipeline slow/again-unserved | One `dist`, one `vite build` (two entries); deploy script gains one block; `/2.0/` + `/next/` wired in nginx from the start so it isn't "built but unserved" like today's `playground/dist`. |
| Parity drift on any core touch | Every engine-touching step (S2, S3, S6) gated on `parity-check.sh` green before the skin lands. |
| Probe ships to prod | `engine/probe.ts` gated behind `?debug=1`; reads `EngineApi` only. |

---

### Relevant file paths
- Authoritative UX/feature plan (owns the skins' detail): `/home/w1n5t0n/src/MEMLNaut-NISPS/docs/specs/plans/playground-2.0-rewrite-plan.md`
- Design-intent reference for skin-a-immersive: `/home/w1n5t0n/src/MEMLNaut-NISPS/docs/specs/recon/playground-2026.md`
- The god-hook to discard (the debt): `/home/w1n5t0n/src/MEMLNaut-NISPS/playground/src/modes/mode-runtime.ts`
- Engine modules to lift: `/home/w1n5t0n/src/MEMLNaut-NISPS/playground/src/audio/engine-host.ts`, `…/audio/worklet/nisps-processor.ts`, `…/ml/wasm-iml.ts`, `…/ml/wasm-worker.ts`, `…/ml/dataset.ts`, `…/input/pipeline.ts`, `…/output/pipeline.ts`, `…/output/curves.ts`, `…/stores/bus.ts`, `…/stores/ml-store.ts`, `…/primitives/*`
- Codegen TS types to extend (`capability_class`+`tier`): `/home/w1n5t0n/src/MEMLNaut-NISPS/playground/src/modes/generated/types.ts`
- Serving facts: nginx `/etc/nginx/sites-available/meml.lnfinitemonkeys.org` (server-scope COOP/COEP, root `meml-aimmersive`); deploy script `/home/w1n5t0n/.config/webhooks/meml-deploy.sh` (builds `…/meml.lnfinitemonkeys.org/playground/dist`, currently unserved); webhook def `/home/w1n5t0n/.config/webhooks/hooks.json`
- New foundation tree to create: `/home/w1n5t0n/src/MEMLNaut-NISPS/playground2/` (or the laptop `manifold` tree, pending open question 1)
