---
kind: plan
status: executed
---

# NISPS Playground 2.0 — Clean-Room SolidJS Rewrite Plan

*Status: sign-off-ready. Author: lead architect, synthesizing four designer proposals (P1–P4) against three judge panels (mission-fit, feasibility, UX coherence). Date: 2026-06-17. Executed: largely implemented in the Manifold convertible app (June 2026) + playground SolidJS foundation.*

---

## TL;DR / recommendation

We rewrite the browser playground clean-room in SolidJS as **one fullscreen instrument** whose interaction model is **P3's "Console"** (full-bleed canvas + always-on Verdict cluster + a right-edge dock whose drawers have three depth states), driven internally by **P2's single-owned-reactive-spine architecture** (one pure `createMemo` chain from input → ML → output, read by every consumer; impure side-effects in one `createEffect`). The whole UI is **one schema-driven `<GenericMode>`** replacing today's 8–9 cloned mode files, so adding an engine is "a JSON schema + a C++ lambda + codegen, zero UI." We adopt **P4's concepts** — the snapshot DAG (unifying undo/A-B/trail/history) and the control-point `off/fixed/live` enum (collapsing the three overlapping mute/pin/expose systems) — but **explicitly reject P4's v1 commitment to a runtime-shaped MLP**: v1 ships an *honest fixed-2-input contract that fails the build on schema/arch mismatch*, deferring multi-input modes until the C++ core genuinely supports them behind a passing parity check.

Why this is more mature than today's app: (1) the live-feedback regression that has haunted every prior session ("MLP output stops updating when I move the joystick") becomes **structurally impossible and e2e-asserted**, because there is exactly one reactive path from input to output and every consumer reads it; (2) the 663-line `mode-runtime` god-hook and 8 near-identical mode files collapse into composable hooks + one data-driven component — the orthogonality principle finally reaches the UI layer; (3) two real research-validity bugs (fake single-point loss history, training on post-pipeline outputs) are fixed; (4) the feature inventory is treated as a **capability budget to make reachable**, not a screen budget to fill — most features live one drawer/keystroke/probe-call deep rather than cluttering the canvas.

---

## 1. Mission & design thesis

NISPS is **a research platform for interactive ML control of audio** — a *controller* for synths, not a synth. The north star for 2.0:

> **The network is the medium you shape; the gesture is the cursor; reactivity is the wire that must never break. You shape a mapping from embodied gesture to sound by listening and giving verdicts (👍/👎), and the screen reveals exactly as much machinery as you reach for.**

This serves the five-axis **orthogonality principle** (parameter sets · modes · ML architectures · audio engines · UI/UX must vary independently) by making each axis a different layer that can be edited without disturbing the others — and it serves the **crystallization pipeline** (browser is where research happens; firmware is where findings ossify) by keeping the browser identical to firmware *by default* and treating divergence (e.g. the `spread`/Xavier regime) as an opt-in lab toggle.

Three personas in priority order, all served: **Dimi-researcher** (wants diagnostics that answer "is it learning?"), **Dimi-performer** (embodied, eyes on the synth, thumb on the verdict), and **AI coding agents** (the synchronous debug probe + Playwright + parity scripts are first-class — new UX must remain headlessly drivable and observable).

The design discipline, taken from P1 and endorsed by the mission-fit judge: **a capability budget, not a screen budget.** The brief's enormous inventory is something to make *reachable* (one gesture/keystroke/probe-call deep), not something to render all at once. This is the direct antidote to cargo-cult feature parity.

---

## 2. Intended UX, locked

### 2.1 Stance: desktop-first, touch-correct primitives

Confirmed as decided (§7-H of the brief, pending Dimi's confirmation it still holds). Layout target **1280×800+ landscape**; the Console docks right, the manifold owns the rest. Every primitive that touches the manifold (joystick, zoom, trail, heatmap-scrub, verdict buttons) is built on **Pointer Events with `touch-action:none` + pointer-capture**, so the same code is finger-correct on a foldable without a separate mobile IA. Below ~720px wide, the Console degrades to a bottom-sheet variant of the *same* components (one responsive breakpoint). **Touch-correctness of joystick/zoom/trail is a v1 acceptance criterion**, not deferred. Pinch maps to the same zoom signal as wheel/momentum.

### 2.2 Information architecture: three persistent zones + the Console

There is **one screen** (`/`). The only other routes are the hidden `/dev/primitives` showcase and the `?debug=1`-gated probe.

```
┌─────────────────────────────────────────────────────────┐
│  ❶ READOUT STRIP  (top, interactive heatmap, auto-hides)  │
├──────────────────────────────────────────────┬──────────┤
│                                                │  ❹ THE   │
│              ❷ THE MANIFOLD                    │ CONSOLE  │
│   (fullscreen canvas: visualizer/seq grid +    │  (48px   │
│    joy-map + trail + noise rings + pins)       │  dock +  │
│                                                │  drawer) │
│         ❸ VERDICT CLUSTER (floating, bottom)   │          │
└──────────────────────────────────────────────┴──────────┘
        ◀ Drawer slides in here (left of dock, mutually exclusive)
```

- **❶ Readout strip** — the interactive output heatmap (§2.5). Auto-hides in pure-synth modes (the visualizer is the readout); pin glyph holds it open.
- **❷ The Manifold** — the always-on canvas: engine/visual/sequencer output, the zoom joy-map minimap (adaptive graph-paper grid), the clickable vanishing trail, noise rings, pinned-region overlays, the joystick dot. **The empty canvas is itself the primary input surface** (pointer-down drives the joystick in joy-map mode), with hit-test priority: trail points and pins capture before the joystick.
- **❸ Verdict cluster** — floating bottom-center, the most-used control in the app, never hidden on first session: **👎 perturb · ↺ undo · 👍 commit**, with A/B toggle to the right; Randomize demoted to long-press-👎 ("thumbs-down really hard", confirm-on-release). Rests at low opacity, full on hover/active.
- **❹ The Console** — right-edge dock (48px icon rail) + a single mutually-exclusive drawer sliding in to its left. **This resolves the dock-vs-floating-bar conflict in favor of the dock.**

All HUD anchors are **derived from a reactive layout context** (`useStageMetrics()`), never hardcoded pixels — killing the "tied to a removed 88px bottom sheet" bug class at the source. Chrome auto-dissolves after ~4s of inactivity (Design-C heritage) via a single `chromeOpacity` signal, restored on any pointer/key/`__nisps` activity — **but never fades on the first session**, and dock icons never fully vanish (a thin orange edge persists).

Visual language is **faithful to a-immersive, not the cyan drift**: accent orange `#ff6a00`, danger `#ff4466`, glass `rgba(13,13,13,0.65)` on dark, JetBrains Mono @13px, easing `cubic-bezier(0.22,1,0.36,1)`. A lint allowlist of CSS vars enforces it.

### 2.3 The Console drawers — split by mental mode, not by data

Five dock sections. The key UX call (from P3, endorsed by the UX-coherence judge as "the strongest anti-modal-confusion move in the set"): **separate the performer's control surface from the researcher's diagnostics** — never make someone playing share a panel with gradient-flow bars.

| Icon | Drawer | Mental mode | Contents |
|---|---|---|---|
| **Shape** | RL feel + examples + history | shaping | add example, train, clear, dataset count; RL feel controls; snapshot DAG browser at Full depth |
| **Feel** | compound axes + presets | playing | Boldness / Memory / Precision axes; trim-pot overrides; six control-preset chips |
| **Route** | input/output + control-point matrix | wiring | input source, output backend (Audio/MIDI/OSC/controller), per-param control-point rows, per-group curves; Emitters×Targets matrix at Full depth (dense/modular modes) |
| **Health** | diagnostics | debugging | weight-health detail, gradient-flow, layer-stats, loss plot, `spread`/`tame` lab controls |
| **Help** | overlay + keymap | — | keyboard map, first-run guidance |

`Mode/engine switching` lives in a compact switcher at the top of the dock (grouped by capability class — see §2.10), so it is always reachable without colonizing a drawer.

### 2.4 Progressive disclosure: drawer depth = one learnable gesture

Adopted from P3, backed by P4's data model. Each drawer has **three depth states**, and that *is* the disclosure mechanism — there is **no global "Advanced" toggle**:

| Depth | Width | Trigger | Contents |
|---|---|---|---|
| **Peek** | ~320px | click dock icon | summary chips (`Sources 8/48 · Targets 6/10 · live 4`) + the one primary control + read-only sparklines |
| **Expand** | ~520px | "⤢ More" / drag-resize | active controls only + collapsible rails + "show all" footer |
| **Full** | fullscreen modal | "⤢⤢ Open" | the dense surface: full matrix, per-cell editor, all overrides, exposure controls |

"What shows at each depth" is **data, not hand-wiring**: each schema param and each diagnostic declares a `tier: 0|1|2`, and the current depth reveals tiers ≤ depth. This makes Dimi's "some modes expert-only" wish (ALIGNMENT Q2) just a schema default for `tier`, and unifies the brief's five competing disclosure proposals (global toggle / per-mode expertise / three-tier / control-point / staged-unlock) into one mechanism. The **Feel drawer's Peek auto-opens** on first load and after mode-switch (so the compound axes are glanceable without a click — the "always-on bar" intent without permanently stealing canvas), and a **mini-axis ghost** persists on the Feel dock icon when collapsed.

The dense **staged-unlock** model (Dimi's near-decided intent) lives inside the Route drawer's Full tier: a mode starts with a small set of `live` control points; the user opts more in one-by-one or swaps them via the "show all / opt-in" footer.

### 2.5 The interactive heatmap (readout strip)

Output readout becomes a control surface. Two interactions per cell, with the **load-bearing tactile constants reproduced exactly**:

1. **Drag** (>3px motion threshold, pointer-capture, horizontal across a cell) → directly sets that param's normalized value to the x-position; output reroutes immediately.
2. **Click** (pointerup, no motion) → toggles a per-parameter **override popup** anchored to the cell: min slider, max slider, curve slider, **freeze toggle** (frozen → drag sets a fixed value, bypassing the model), with **300ms grace** dismissal so the pointer can travel cell→popup.

Hover shows `{name}: {value}` + a `▾` clickability hint, live during drag. Frozen cells dimmed. The strip is hidden in synth mode (the visualizer is the readout). These constants (3px / 300ms / pointer-capture) are non-negotiable craft.

### 2.6 The core interaction loop (explore → shape → train → evaluate → compare)

**Explore.** Drag the manifold (or joystick/sliders/mic). On every pointer-move (reactive, *not* rAF), the input pipeline runs `deadzone → zoom → curve → smoothing → momentum-as-zoom`; the result drives inference; outputs flow to the engine *and* repaint the readout strip + visualizer in the same propagation. The joy-map shows the zoom window (grid subdivides 4×4→32×32); a ~5s vanishing trail fades behind the dot; noise rings breathe at the current cap. Slow deliberate moves auto-zoom-in (momentum); zoom-to-zero = freeze input (a detent, no separate toggle). **Follow mode** (double-click the dot) releases the pointer for hands-free drift.

**Shape via RL (the default learning mode).** Hear something good → **👍**: `train()` on accumulated examples + decay noise (settle). Hear something wrong → **👎**: `moveWeights(noiseCap, spread, pinMask)` + grow noise (perturb). Feedback is **zoom-aware**: zoomed-in 👎 nudges, zoomed-out shakes. Went too far → **↺ undo** pops the snapshot DAG and flashes. Want chaos → long-press 👎 = full re-roll. Every destructive op auto-snapshots first. This is the resting state; the **fearless loop** (RL + consequence-free undo + A/B preview) is the path of least resistance.

**Shape via examples (IML, secondary).** Open Shape drawer. The "Add example" two-step toggle: 1st press freezes inference so you dial the target (on the heatmap strip or sliders), 2nd press stores `(effectiveInput → rawTargetOutputs)`. **Targets are raw model-space values, not post-pipeline outputs** (the §2.6 research-validity fix). Examples can be pinned (always-included, FIFO-exempt = region-pinning approach A).

**Train.** Implicit in 👍, or explicit in Shape; runs in a single pooled disposable Web Worker holding its own WASM instance, round-trips weights, and streams **real loss history** (new `nisps_ml_loss_history` C API) to a live sparkline.

**Evaluate.** Ambient weight-health glow at the screen edge answers "healthy?" at a glance; the Health drawer shows loss-history, gradient-flow bars, layer-stats, and the input-space heatmap (throttled to weight-change ~200ms, not per-frame). Mostly, evaluation *is listening* — diagnostics are there for when the ears raise a question.

**Compare.** A/B: tag the current state as **A** (weights + noise + zoom), keep exploring as **B**, toggle A↔B at the same input position, **press-and-hold to preview A** (preview-pedal), then Accept B or Revert to A. **Freeze Output** locks the audible result while inference keeps running — watch the readout shift to preview what *would* change before committing (distinct from Freeze Input).

**Protect.** Set a few control points to `fixed` (excluded from `moveWeights`, target held) and 👎 explores the rest; long-press the joy-map to region-pin. This zoom↔train↔pin refinement workflow is the whole reason the instrument is more than a randomizer.

### 2.7 Undo / history

Undo, snapshots, A/B, and the trail are **one model** (P4's snapshot DAG, §3 architecture): a content-addressed DAG of `NetworkState` nodes with a `current` pointer. Undo = `current ← parent`; destructive ops = append child + advance; A/B = pin/swap pointers; trail tap-to-return = jump to a node. The Verdict cluster's ↺ undo is the single-step face (20-step practical depth, ring-bounded, default 20/max 50); long-press = the tagged-node history list; the Shape-Full DAG browser renders the tree for branchable exploration. RL-undo against a stub is the **first build wave** (de-risks the whole history system; matches Dimi's own instinct).

### 2.8 Keyboard accelerators (layer, not primary door)

Verb keys (`1`–`5` for drawers, `\` for Full, `space`/`↑`/`↓` for verdict, `z` for undo) are an **accelerator layer on top of a fully pointer-operable Console** — never the only door. This keeps the performer/newcomer path pointer-discoverable while giving the researcher fast iteration.

---

## 3. Architecture

### 3.1 The reactive spine (the live-feedback guarantee, made structural)

The single highest-value structural fix. The brief's #1 recurring frustration — MLP output silently stops updating the UI when the joystick moves — is a reactivity-discipline failure, not a UI one. We make it impossible to regress by collapsing input → ML → output into **one pure `createMemo` chain that every consumer reads**, with the impure side-effects in a single `createEffect`:

```
inputRaw            // Float32Array signal, {equals:false}  (the ONLY input entry point)
  → processedInput  // createMemo: deadzone→zoom→curve→smoothing→momentum (pure, golden-tested)
  → mlOutput        // createMemo: WasmIML.infer(processedInput) into a REUSED buffer (pure read)
  → routedOutput    // createMemo: voice-space + output pipeline (global curve→smoothing→slew→freeze)
```

Then **one** `createEffect` reads `routedOutput` and performs the side-effects: `postMessage` to the worklet (with a *dedicated re-filled send-buffer*, because transferables neuter the source) + engine post. Every UI consumer — readout strip, visualizer, trail — **reads `mlOutput`/`routedOutput` directly**. There is no separate "push output to the UI" path that can rot.

This is the union the feasibility judge mandated: **P3's pull-based memo chain** (no rot-able push path) corrected for **memo purity** (no `postMessage` inside a memo — that lives in the effect), with **P2's rigor**: signal/store split by update cadence, `HeapVec` re-derive-on-access, pointer-event coalescing to display cadence via `batch()`+microtask (reactive, not a rAF poll, but rate-limited). **rAF touches only canvas drawing**, never inference. We **reject P1's `createComputed` approach** (wrong primitive; the feasibility judge called it a load-bearing foot-gun).

**E2E invariant, asserted on every mode in CI:** `__nisps.setInputs([x,y]); expect(getOutputs()).toChange() && expect(getEngineParams()).toChange()` in the same tick.

### 3.2 Stores — module singletons, split by update cadence

The split by *update cadence* is the correctness lever (P2):

| Store | Kind | Why |
|---|---|---|
| `input-store` | `createStore` (config) + `Float32Array` signal `{equals:false}` (raw axes) | per-frame hot path → never a deep proxy |
| `ml-store` | `createStore` (status/arch/dataset) + `outputs: Float32Array` `{equals:false}` + `weightsRevision: number` | outputs change every frame; revision is the cheap "weights changed" tripwire; owns `WasmIML` + training-worker lifecycle |
| `control-store` | `createStore` (axes) + **per-param `createMemo`** | compound-axis → param fanout is `createMemo(() => axisTable(axis) + offset)`, **replacing the `control-routing.ts` `JSON.stringify`-inside-untracked-effect anti-pattern** |
| `routing-store` | `createStore` | the Emitters×Targets matrix; one **control-point status** per target: `off / fixed / live` (collapses mute/pin/expose into one toggle/row) |
| `output-store` | `createStore` | global curve→smoothing→slew→freeze gate; uses the reuse buffer (no per-frame alloc) |
| `history-store` | `createStore` | the snapshot DAG (undo / A-B / trail / snapshots) |
| `session-store` | `createStore` | presets + persistence (versioned schema, base64 weights), URL params, mode switch (restore-or-fresh) |
| `bus.ts` | kept as-is | typed synchronous pub/sub for genuinely cross-cutting events (`mode.switched`, `pin.changed`, `snap.push`) — **not** hot-path data |

### 3.3 ML / audio hot paths

- **Inference (main thread):** the `mlOutput` memo calls `WasmIML.infer` into a **reused output buffer** (fixing today's per-frame `Float32Array` alloc). All WASM memory access goes through **one** place — a `HeapVec` wrapper that **re-derives the `HEAPF32` view on every access** (closes the stale-view silent-corruption bug class by construction; strictly better than today's cached-view-plus-manual-`rebind()`). `WasmIML` exposes only typed methods; no raw heap leaks out.
- **Audio (worklet):** the **two-WASM architecture is kept wholesale** — main-thread ML + AudioWorklet engine loading the *same* `nisps.wasm` bytes via `WebAssembly.compile` with hand-rolled auto-discovered imports (no Emscripten glue in `AudioWorkletGlobalScope`). **Worklet imported via `?worker&url`** (the recent, correct fix — plain `new URL(...,import.meta.url)` ships raw `.ts`). The send-effect owns a dedicated re-filled transferable buffer.
- **Training:** one pooled disposable Worker with its own WASM instance, torn down on unmount/mode-switch.

### 3.4 Decomposing the god-hook

`mode-runtime.ts` (663 lines) → small named composables, each independently testable and probe-mockable:

```
src/runtime/
  control-graph.ts     # the memo chain + the single send-effect (the spine, ~one tested file)
  use-input-adapters.ts# pointer/joystick/gamepad/mic → input-store.setRaw
  use-audio-lifecycle.ts # engine-host start/stop/teardown on mount/mode-switch
  use-snapshots.ts     # DAG ops
  use-heatmap-sampler.ts # input-space heatmap, throttled to weightsRevision
  use-trail.ts
  use-auto-explore.ts
```

### 3.5 Schema-driven mode system — one `<GenericMode>`

The 8 cloned `*Mode.tsx` + `C15Mode.tsx` collapse to **one `<GenericMode schema={schema} />`** (the orthogonality principle reaching the UI; universal across all four proposals and the baseline the judges mandate). It reads the generated `ModeSchema`:

- `ui.primary_input` → mounts the input adapter (`xy_pad`/`joystick`/`sliders`/`audio_in`/`midi_in`/`none`).
- `ui.show_synth_visualizer` → `SynthVisualizer` vs `VisualEngine` vs `SequencerLane`.
- `ui.show_voice_space_selector` → renders the selector or not.
- `params[].{group,curve,label,min,max}` → drives the readout strip, the Route per-param rows, and a cross-mode `<ParamGroupCurve>` primitive (per-group curve editing everywhere, per Dimi's explicit ask).
- `capability_class` (new field) → mode taxonomy (§2.10).
- `params[].tier` + diagnostics `tier` (new) → disclosure depth.

**Heterogeneous I/O is first-class via schema flags, not code branches:** `output_kind: event` (breakor/elysiamorf) → `SequencerLane` + MIDI/event backend, silent audio; `output_kind: controller` (`kRouteOutputsToEngine=false`) → raw output meters; `primary_input: audio_in` → mic analyser adapter; no `voice_spaces` → no selector.

### 3.6 Backends as output adapters

```ts
interface OutputBackend { send(engineParams: Float32Array): void; start(): Promise<void>; teardown(): void; }
```

Implementations: `WebAudioBackend` (worklet), `WebMidiBackend` (7-bit CC out), `OscBridgeBackend` (WS → salvaged Deno bridge), `SerialCvBackend` (stub behind a locked contract, "later"). The mode picks one+ via schema; the send-effect just calls `backend.send()`. Adding OSC never touches the loop (orthogonality + Dimi's v1-backends ask).

### 3.7 Adding a new mode/engine (the extensibility story)

1. Write the C++ engine in `nisps/engines/` satisfying the `AudioEngine` concept (+ voice-space lambdas).
2. Add `schemas/modes/<mode>.json` (params, groups, curves, `capability_class`, `ui`, voice-space names, tiers).
3. `bun run codegen/generate.ts` → C++ `constexpr` header + TS types (golden test enforces idempotent byte-identical regen).
4. Register the engine id in the worklet's engine switch + `modes/index.ts`.
5. **Zero new UI.** `<GenericMode>` renders it; it appears in the switcher under its class.

### 3.8 Persistence / session model

Replace today's bespoke per-store `Partial<>` merges, `Infinity↔null` slew encoding, and slow `Array.from()` weight JSON with **one `persist<T>(store, version, migrate)` helper**: versioned schema + base64 weight blobs, debounced 200ms. URL params (`tame`/`spread`/`preset`/`debug`) kept. Session presets are **composed layers** (control / synth / weights / mode independently saveable, soft-bundled on save) — see §8-I. Restore-or-fresh on mode switch.

### 3.9 The arch contract (v1, honest)

The schema declares `input_size` but WASM is hardcoded `MLP<2,10,14,18,126>`; today `WasmIML.init` warns-and-ignores caller sizes and `setInput` loops past the real arch, writing phantom channels 2–5 into OOB heap. **v1 resolution (P1's honest contract, mandated by the mission-fit judge):** codegen **fails the build** on schema/arch mismatch; `<GenericMode>` clamps `setInput` to the real arch; multi-input modes are explicitly out of v1 (see §8-D). The runtime-shaped MLP (P4's idea, Dimi's stated intent) is deferred behind a passing parity check — **never bundled into the UI rewrite**, because it rewrites the parity-tested (2.4e-7) zero-heap core that the crystallization mission and browser≡firmware contract both depend on.

---

## 4. Feature treatment table

Legend: **Keep** (port forward) · **Redesign** (changed home/shape) · **Drop/Defer** (out of v1). Every item from the brief's §6 inventory.

| Feature | Verdict | Rationale |
|---|---|---|
| Explore via abstract input channels | Keep | The loop; unify behind `input-store.setRaw` + adapters |
| RL thumbs (default) | Keep | Resting state; Verdict cluster; zoom-aware; auto-snapshot |
| Examples/IML two-step toggle | Keep + fix | Secondary path in Shape; **fix label source to raw outputs**; inline hint |
| Randomise | Redesign | Demote to long-press-👎 (declutter; "thumbs-down really hard") |
| Output pin mask | Keep | Folds into control-point `fixed` |
| Async training | Keep + fix | Pooled worker; **real loss history** via new C API |
| Auto-snapshot before destructive ops | Keep | Centralized as DAG append |
| Canvas-first immersive layout | Keep | The Stage; the thesis |
| Right dock + mutually-exclusive drawers | Keep/build | Resolves dock-vs-bottom-sheet → dock |
| Mode shell + switcher | Redesign | 8–9 clones → one `<GenericMode>`; switcher grouped by capability class |
| Auto-dissolving chrome | Keep | 4s timeout; never fade verdict on first session; dock edge persists |
| Floating status pill | Redesign | Becomes ambient health glow + Feel mini-axis ghost; layout-derived anchors |
| Help overlay | Keep | Behind `?` / Help dock |
| Visual language (orange/JetBrains/glass) | Keep + fix | **Fix the cyan drift**; lint a CSS-var allowlist |
| Boldness/Memory/Precision axes | Keep | Feel drawer; per-param `createMemo` fanout |
| Stability↔Fluidity (stretch axis) | Defer | Clutter; behind Feel-Expand later if demanded |
| Trim-pot offsets + double-tap re-link | Keep | Default (§8-F); add "offset active" dot for visibility |
| Six control presets | Keep | Cheap axis-triplets; encode playing-postures |
| Per-group curve editing | Keep | Cross-mode `<ParamGroupCurve>` primitive (Dimi explicit) |
| Heatmap readout strip | Keep | Top of stage |
| Drag-to-scrub cell (3px, pointer-capture) | Keep | Load-bearing tactile detail; reproduce exactly |
| Click → override popup (min/max/curve/freeze, 300ms grace) | Keep | Reproduce exactly |
| Frozen-cell dimming; hidden in synth mode | Keep | — |
| Per-param overrides (unified) | Redesign | Control-point `off/fixed/live`, one toggle/row |
| deadzone→zoom→curve→smoothing→momentum | Keep | Pure-fn memo; golden-tested |
| Zoom (log, anchor modes, zoom-at-zero=freeze) | Keep | Core navigation; freeze-detent elegant |
| Momentum-as-zoom | Keep | — |
| Joy-map minimap + adaptive grid | Keep | Navigation legibility |
| Vanishing trail + tap-to-return | Keep | DAG node jump |
| Noise ring(s) | Keep | — |
| Region pinning (example-pinning A) | Keep | — |
| Parameter pinning (pin mask ≠ mute) | Keep | Control-point `fixed` |
| Snapshot stack | Redesign | Unified into the snapshot DAG |
| RL undo (20-step) | Keep | Verdict cluster; **first build wave** |
| A/B compare + hold-to-preview | Keep | DAG pointer ops; preview-pedal |
| `spread` master regime | Redesign | **Opt-in lab toggle** in Health (firmware-init default); effect surfaced via Boldness axis (§8-E) |
| noise floor/cap/growth/decay, weight decay, distribution (incl. cauchy), layer-aware | Keep | Health/Feel, tier-2 |
| Zoom-aware feedback scaling | Keep | Default on |
| Pressure / hold-duration feedback | Keep | Touch-correct primitive |
| Auto-Explore + Follow mode | Keep | Shape drawer; emerald toggle + progress ring |
| global curve→smoothing→slew→freeze gate | Keep + fix | Reuse buffer (no per-frame alloc) |
| Freeze output (preview-before-commit) | Keep | Feel/Route |
| Tame | Redesign | Promote URL → Health panel; labelled "output limiter" (safety) |
| Input-space heatmap | Keep | Health; throttled to weight-change ~200ms |
| Weight-health indicator | Keep | Ambient screen-edge glow + Health detail |
| Gradient-flow bars | Keep | Health, tier-2 |
| Per-layer stats | Keep | Health-Full |
| Loss / loss-history plot | Keep + fix | **Real history** via new C API |
| Progressive disclosure | Redesign | Drawer depth (Peek/Expand/Full) backed by schema `tier`; no global Advanced toggle |
| Three-tier responsive surface | Keep | Is the drawer-depth mechanism |
| Control-point status (off/fixed/live) | Keep | Unified per-target model |
| Exposure-spectrum staged-unlock + swap + opt-in | Keep | Inside Route-Full for dense modes |
| Emitters × Targets matrix (MLP = emitter bank) | Keep (scope-gate) | Route-Full; built to host modular mode (§8-G) |
| Synth modes (incl. modular 3-osc/4op/additive) | Keep / scope-gate | Modular mega-mode v1.5 (§8-G), matrix built to host it |
| Controller-only | Keep | `output_kind: controller` |
| Sequencer (breakor/elysiamorf, ShapeSeq freeze/delta) | Keep | `SequencerLane`; freeze/delta is a killer feature |
| Visual | Keep | `VisualEngine`; genesis use case |
| C15 | Defer | Placeholder, no schema/engine — don't scaffold UI for vapor (§8-G) |
| Mic modes (XIASRI / sound_analysis_midi) | Defer (honest) | Out of v1 until runtime-shaped MLP (§8-D); v1 shows "single-input in browser" badge |
| Web Audio backend | Keep | — |
| WebMIDI out | Keep | v1 adapter |
| OSC via bridge | Keep | v1 adapter; salvage Deno bridge |
| CV/gate serial | Defer | Stub behind locked contract |
| Session presets | Keep | Composed layers (§8-I) |
| bypass vs mute per param | Keep | Folds into control-point semantics |
| restore-or-fresh on mode switch | Keep | — |
| Debounced localStorage + URL params | Keep + fix | Versioned schema + base64 weights |
| Debug probe (`window.__nisps`) | Keep + fix | **Gate behind `?debug=1`** (honor the doc); on by default in dev builds |
| Two-WASM arch + custom worklet loader | Keep | Correct, load-bearing |
| Pure-fn pipelines + curve catalog | Keep + fix | **Unify the two diverging curve enums** (one source, golden-tested vs `math.hpp`) |
| Typed signal bus | Keep | Cross-cutting events only |
| Live-feedback guarantee | Keep (structural centerpiece) | One reactive path; e2e-asserted every mode |

---

## 5. What 2.0 gains vs today, and what we deliberately drop

**Gains**
- **Live feedback can't silently regress.** UI, audio, and visuals derive from the *same* memo chain; a desync is a failing e2e test, not a recurring prod bug. Directly kills Dimi's #1 frustration by construction.
- **8–9 mode files → 1 `<GenericMode>`; 663-line god-hook → composable hooks.** Adding an engine is schema + C++ + codegen, zero UI. Orthogonality is enforced, not aspirational.
- **One history model** (snapshot DAG) instead of three (snapshots/undo/A-B) — less code, branchable exploration.
- **One disclosure mechanism** (drawer depth backed by schema `tier`) instead of five competing proposals — one learnable gesture.
- **Performer and researcher are separated** (Feel vs Health drawers) — no gradient bars in the player's face, no hunting for diagnostics.
- **Honest, correct core contract:** no phantom inputs, real loss history, training on raw outputs (a research-validity fix), heap safety by construction, no per-frame allocation on the audio-param path.
- **Backends are adapters** — MIDI/OSC/CV slot in without touching the loop.
- **Faithful visual language** restored (orange, not cyan).

**Deliberately dropped from v1**
- **Multi-input mic modes** (XIASRI / sound_analysis_midi as ML inputs) — until the runtime-shaped MLP lands behind a passing parity check. v1 ships 2-input-correct, not 10-input-broken.
- **Runtime-shaped MLP itself** — deferred; it touches the sacred parity-tested core and must never ride the UI-rewrite wave.
- **C15** — pure placeholder; no UI scaffolding for vapor.
- **Stability↔Fluidity 4th axis**, **bundled all-in-one session presets**, **CV/gate serial**, **modular mega-mode** — deferred as parity clutter, not v1 mission work (modular is v1.5; the matrix is built to host it).
- **Backwards compatibility** — none; clean rewrite, per operator preference.

---

## 6. Build roadmap

Each phase is shippable and testable (Playwright + `__nisps` probe). Parity checkpoints called out. Effort is rough (ideal-engineer-days for one focused agent/operator pair).

**Phase 0 — Scaffold & contract (≈2–3d).** Vite + SolidJS + TS skeleton; theme tokens (orange, lint allowlist); codegen wired with the **build-fails-on-arch-mismatch** rule; `ModeSchema` extended with `capability_class` + `tier`; `bus.ts` ported; `persist<T>` helper. *Test:* codegen golden test; typecheck green.

**Phase 1 — The reactive spine against a stub (≈3–4d, de-risk wave).** `control-graph.ts` memo chain + single send-effect with a **stubbed `mlOutput`**; `input-store` + `output-store` (pure-fn pipelines ported, golden-tested; curve enums unified). *Test:* e2e asserts `setInputs → getOutputs` changes; no per-frame alloc (heap-snapshot fuzz).

**Phase 2 — Console shell + Verdict cluster + RL-undo against the stub (≈4–5d, de-risk wave).** Dock + three-depth drawers; Verdict cluster; snapshot DAG + undo + A/B all against the stub. **User-test the three drawer depths with Dimi before wiring engines** (P3's mandate, Dimi's instinct). *Test:* e2e drives undo/A-B via probe.

**Phase 3 — WASM ML bridge (≈4–5d).** `HeapVec` re-derive-on-access; `WasmIML` typed wrapper; pooled training worker; **`nisps_ml_loss_history` C API + real loss plumbing**; train on raw outputs. **Parity checkpoint:** main-thread inference matches native within 1e-5. *Test:* probe `train`/`infer`/`getLayerStats`; loss plot draws a real curve.

**Phase 4 — Audio worklet + first real mode (≈4–5d).** Two-WASM worklet (`?worker&url`, hand-rolled imports, dedicated send-buffer); `WebAudioBackend`; `<GenericMode>` rendering PAFSynth (synth class). **Parity checkpoint:** `parity-check.sh` green; browser audio equivalent to firmware for PAFSynth. *Test:* per-mode live-feedback e2e (audio params change on input move).

**Phase 5 — Schema-driven mode coverage (≈4–6d).** All in-scope engines via `<GenericMode>` (synth + sequencer + controller + visual classes; `SequencerLane`, `VisualEngine`, controller meters); capability-class switcher; heterogeneous I/O flags. *Test:* every mode passes the live-feedback e2e in CI; parity per mode.

**Phase 6 — Control surface + navigation + pinning (≈4–5d).** Compound axes (memo fanout) + presets + trim-pot; full input pipeline (zoom/anchor/momentum); joy-map + trail + noise rings; region + param pinning (control-point `fixed`); interactive heatmap (3px/300ms craft). *Test:* probe-driven axis/pin/zoom; tactile-constant e2e.

**Phase 7 — Diagnostics + Route matrix + exposure (≈4–5d).** Health drawer (weight-health glow, gradient-flow, layer-stats, input-space heatmap throttled, `spread`/`tame` lab); Route Full matrix + control-point rows + staged-unlock; per-group curves. *Test:* diagnostics render from real stats; probe `getLayerStats`.

**Phase 8 — Backends + persistence + polish (≈3–4d).** `WebMidiBackend` + `OscBridgeBackend`; versioned persistence + base64 weights; session preset layers; auto-dissolve chrome; keyboard accelerators; Help. *Test:* full `run-all-tests.sh` (cmake + ctest + WASM + parity + lint + Playwright) green = **Verification chokepoint E**.

**Post-v1 (gated):** runtime-shaped MLP behind parity → unlocks multi-input mic modes; modular mega-mode + Emitters×Targets population; C15; Stability axis.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Live-feedback regression recurs | One reactive path + per-mode e2e invariant in CI; no leaked write path (weights only mutate via `ml-store` actions that bump `weightsRevision`) |
| Memo purity violated (side-effect creeps into a memo) | Single documented send-`createEffect`; lint/review rule; memos must be pure |
| High pointer-event rate over-fires inference | Coalesce to display cadence via `batch()`+microtask; still reactive, rate-limited |
| Transferable buffer neutering | Dedicated re-filled send-buffer owned by the effect, separate from signal buffers |
| Stale `HEAPF32` view corruption | `HeapVec` re-derives the view on every access; sole WASM-memory access point; fuzz-tested |
| Drawer-depth model novel/undiscoverable | Prototype Console against `/dev/primitives`; user-test depths with Dimi (Phase 2); clear "⤢" affordances |
| Auto-dissolving chrome hides the loop | Never fade Verdict on first session; dock edge always visible; `?` help |
| Canvas-as-input vs clicking trail/pins | Hit-test priority: trail points + pins capture before joystick |
| 3px/300ms constants fragile cross-device | Port exact constants; e2e-test them |
| Snapshot DAG memory (large weight blobs) | Ring-bound (20/50); base64-compress; GC by tag priority (pinned/A nodes survive) |
| Parity drift on any core touch | Every core-touching phase gated on `parity-check.sh` green before UI lands |
| Probe ships to prod | Gate behind `?debug=1`; on by default in dev builds only |

---

## 8. Open questions for Dimi (decide BEFORE building)

Each is a real fork. I give options + my recommendation; I need your call.

**A. Canonical tree / identity.** Is 2.0 the laptop `~/src/manifold` (`manifold::`, fresh repo — possibly already partly executed) or this VPS `MEMLNaut-NISPS` tree (`nisps::`)? **Recommendation:** target this VPS tree + `nisps::` (it's the live tree the recon ran against); the architecture is identity-agnostic and a rename is trivial. **But this blocks namespace/repo/codegen identity — I need your answer first.**

**B. Mode taxonomy.** Four capability classes (Synth / Controller / Sequencer / Visual) vs the 8 engines + C15. **Recommendation (adopted):** add a `capability_class` schema field; the 8 engines are instances under Synth/Sequencer; Controller = `kRouteOutputsToEngine=false`; Visual = an output target. Switcher groups by class. Confirm this hierarchy vs an engine-flat switcher.

**C. Progressive-disclosure model.** **Recommendation (adopted):** per-section drawer depth (Peek/Expand/Full), backed by schema-declared per-param/diagnostic `tier`; no global Advanced toggle. This unifies all five corpus proposals. Confirm it's canonical.

**D. Runtime-shaped MLP vs fixed arch (the one I most want you to rule on).** **Recommendation (strong):** v1 ships the **honest fixed-2-input contract** (build fails on schema/arch mismatch); the runtime-shaped `Mlp` (your stated intent) is **deferred to post-v1 behind a passing parity check**, never bundled into the UI rewrite. Consequence: XIASRI / sound_analysis_midi multi-input modes are **firmware-only in v1** and show a "single-input in browser" badge. This is a materially different product surface than "all modes work in browser" — confirm you accept the v1 contraction. (The mission-fit and feasibility judges both flagged bundling the core rewrite into v1 as the project's biggest scoping hazard.)

**E. `spread` prominence.** **Recommendation (adopted):** opt-in **lab toggle** in Health (firmware-init is the browser default, per the crystallization philosophy), with its *effect* surfaced through the **Boldness** axis so the primary affordance is musical. Confirm `spread` doesn't deserve its own primary slider regardless.

**F. Trim-pot vs detach for axis overrides.** **Recommendation (adopted):** trim-pot offset stays default ("most musical"), with an "offset active" dot for visibility. Confirm, or whether detach should be a per-axis/per-user choice.

**G. v1 scope of heavy features.** **Recommendation:** defer C15, the modular mega-mode (3-osc/4op/additive + shared mod pool + Emitters×Targets), and firmware-equivalent mic analysis to post-v1; v1 ships the pragmatic 4-feature analyser (read-only, not as ML input — see D) and keeps the matrix *built to host* the modular mode. Sequencer ShapeSeq freeze/delta **is** in v1. Confirm the line.

**H. Desktop-first confirmation.** **Recommendation:** treat "desktop-first, touch-correct core" as decided, with touch-correctness of joystick/zoom/trail as a v1 acceptance criterion. Confirm the chat decision still holds over ALIGNMENT Q4's "defer until user data."

**I. Session / bundled presets.** **Recommendation (adopted):** keep control-presets and synth-presets orthogonal; session presets are **composed layers** (weights / control / synth / mode independently saveable, soft-bundled on save), not a hard bundle. Confirm.

---

## Appendix: provenance

**P1 — research-instrument-minimalist ("The Listening Loop").** Mission-fit judge's top pick (9): its "capability budget, not screen budget" framing and its **honest fixed-2-input §7-D resolution** (build fails on mismatch; defer multi-input) are the correct posture for a research instrument and the only arch story that respects the crystallization + parity contracts — both grafted into this plan as load-bearing. UX-coherence ranked it second (7.5) — strong restraint, but it bets fast-path ergonomics on keyboard muscle-memory (least discoverable). Feasibility ranked it last (5) with a near-fatal flaw: it builds its "structurally unbreakable" claim on `createComputed`, the wrong reactive primitive — **rejected** in favor of P2/P3's memo chain. Net contribution: the minimalist philosophy + the honest arch fork.

**P2 — realtime-frontend-architect.** Feasibility judge's clear winner (9): store-split-by-update-cadence, the `HeapVec` re-derive-on-access wrapper, transferable-buffer and pointer-coalescing rigor, and the OutputBackend adapter are the ship-grade backbone — all adopted. Mission-fit (8) credited its **live-feedback-as-one-owned-effect** as the single highest-value structural fix (Dimi's #1 frustration) plus the **train-on-raw-not-processed-outputs** research-validity fix. UX-coherence ranked it last (5) for its cardinal sin: it kept **both** a floating control bar and the dock, reproducing the exact two-homes conflict the brief said to resolve — **rejected** (we use the dock). Net contribution: the architecture spine + two correctness fixes + backends.

**P3 — interaction-ux-designer ("The Console").** UX-coherence judge's winner (9): the dock-with-three-depth-states as the single disclosure gesture, the **Feel-vs-Health drawer split** (performer vs researcher mental modes), the floating-bar resolution (auto-open Peek + mini-axis ghost), the interaction-hazard handling (hit-test priority, randomize-as-long-press, never-fade-on-first-session), and the de-risk sequence (Console + RL-undo against a stub, user-tested first) — all adopted as the interaction spine. Mission-fit (8) credited the fearless-RL psychology. Feasibility (8) flagged one easily-corrected impurity: it described `postMessage` inside a memo — **corrected** here (side-effects live in one `createEffect`). Its gap: it left §7-D unresolved — **filled** with P1's honest contract. Net contribution: the entire UX/IA spine.

**P4 — systems-information-architect ("altitude").** Lowest mission-fit (6) and mid feasibility (6)/UX (6.5) — not for bad ideas but for one **fatal v1-scoping flaw**: it committed the runtime-shaped MLP as a wave-1 deliverable, coupling the frontend rewrite to a cross-language rewrite of the sacred parity-tested core. All three judges said: adopt the **concepts, defer the core change**. So we take P4's **snapshot DAG** (unifying undo/A-B/trail/history) and its **control-point `off/fixed/live` enum** (collapsing the three overlapping ML-control systems) and its **`capability_class` schema field** — while explicitly gating runtime-shaped MLP behind a passing parity check, post-v1. Net contribution: the data-model concepts (history DAG, control-point enum, capability classes), minus the scoping trap.
