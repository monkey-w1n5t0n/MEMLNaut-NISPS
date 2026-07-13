---
kind: finding
date: 2026-04-12
immutable: true
---

# Playground Redesign — 2026 (Design Intent)

> **Purpose of this doc.** Captures design intent of an unfinished playground UI
> redesign that lived as uncommitted changes in a `MEMLNaut-NISPS_rewound`
> working copy. The implementation will not be merged into the current vanilla
> playground — the playground is being rewritten in SolidJS — but the *design*
> shouldn't be lost. Read this as a reference for the SolidJS rewrite, not as
> a description of current code.
>
> **Source snapshot.** `archive/playground-redesign-2026-snapshot` branch in
> this repo. Single commit `287e3a1` on top of `ddb6b77`. Three files:
> `playground/a-immersive.html`, `playground/css/a-immersive.css`,
> `playground/js/a-app.js`. ~1200 lines net of changes.
>
> **Status.** Reference-only, immutable. Do not merge into the vanilla playground — those
> files have moved on independently in `main` and a textual merge would be
> meaningless.

---

## Context

The pre-redesign playground UI was organised around a collapsible **bottom
sheet** containing a sticky **floating bar** (mode toggles, train/randomize
buttons, follow toggle, expand chevron). The sheet would expand upward to show
synth/visual controls. RL thumbs-up/down floating buttons sat just above the
collapsed sheet at `bottom: 92px`.

The redesign moves to a **right-side macOS-style dock + drawer system** and
makes the **top heatmap strip directly interactive**. It also adds **undo** for
RL actions and a **per-parameter override system** that unifies how visual-mode
and synth-mode parameters can be constrained.

There are five themes, summarised here in decreasing order of architectural
weight.

---

## Theme 1 — Right-side dock + drawer system

### What changed

Replaces the bottom-sheet pattern with a vertical dock pinned to the right edge
of the viewport, plus a stack of named drawers that open to the left of the
dock when their dock icon is activated.

- **Removed:** `<div class="bottom-sheet collapsed">`, `<div class="floating-bar">`,
  the sheet expand/collapse chevron, sheet-internal sticky mode bar, sheet
  status line.
- **Removed JS:** `wireBottomSheet()`, `$bottomSheet`, `$sheetContent`,
  `$floatingBar`, `$chevronBtn`, `sheetExpanded` state.
- **Added:** `<div class="dock" id="dock">` with five icon buttons:
  - `data-drawer="training"` — Training (Add Example, Train, Clear Ex, Clear
    All, Randomize, plus preset chips: Calm/Chaos, Rainbow, Vortex, Spiral,
    Embers; loss-canvas section)
  - `data-drawer="mode"` — Input/Output mode toggles (was the floating-bar
    pill toggles: Joystick/Hands and Visual/Synth)
  - `data-drawer="synth"` — Synth controls
  - `data-drawer="params"` — Engine parameters (see Theme 4)
  - `data-drawer="help"` — Help
- **Added:** `<div class="drawer-stack" id="drawer-stack">` containing one
  `<div class="drawer hidden" data-drawer="…">` per icon, each with a
  `drawer-header` (title + close ×) and `drawer-body`.
- **Added JS:** `wireDock()` to hook up icon clicks and drawer close buttons.

### Inferred intent

- Reclaim canvas real estate. The bottom-sheet ate vertical space whenever
  expanded; a side dock keeps controls flush to one edge and only one drawer
  opens at a time.
- Surface mode controls (Visual/Synth, Joystick/Hands) without forcing the
  user to expand the sheet. Each function lives behind one click on a labeled
  icon.
- macOS-dock visual idiom is a familiar metaphor — users intuit
  "click icon → panel appears."
- The action-row inside Training drawer (Add Example / Train / Clear Ex /
  Clear All / Randomize) is grouped by purpose rather than by toolbar real
  estate constraints, so destructive/dim variants (`.action-btn.dim`) read
  as secondary.

### Key UX flow

1. Canvas is fullscreen by default, no chrome over it except top heatmap, RL
   buttons, joystick, and the right dock.
2. User clicks dock icon → corresponding drawer slides in from the right
   (between dock and canvas), other drawers close.
3. User clicks ✕ on drawer header *or* the same dock icon again → drawer
   closes, canvas is unobstructed.
4. Mutually exclusive drawers (only one open at a time) keeps the visual
   hierarchy simple.

### Implementation notes for SolidJS rewrite

- This is the largest theme and pulls HTML, CSS, and JS together. In SolidJS
  it should naturally become a `<Dock>` component listing icon → drawer
  pairs, plus a single `<DrawerStack>` rendering whichever is active from a
  signal.
- CSS custom properties `--dock-width: 48px` and `--dock-gap: 8px` are
  introduced; layout (joystick, hand-pip, dev-panel) is offset by these.
- Old positioning constants — joystick & hand-pip at `bottom: 136px`, RL
  buttons at `bottom: 92px` — were tied to the collapsed bottom sheet's
  88px height. With no sheet, they shift down (joystick/hand-pip to 100px,
  RL buttons to 36px). The rewrite should drive these from layout, not
  hardcode.
- `dev-panel` shifts right edge from `right: 16px` to
  `right: calc(var(--dock-width) + 24px)` to clear the dock.

---

## Theme 2 — Interactive heatmap strip

### What changed

The top heatmap strip — previously read-only visualization of model outputs —
becomes the primary parameter input surface.

### Two interactions per cell

1. **Drag** (pointermove with motion threshold > 3px) horizontally across a
   cell → directly sets that parameter's value to the normalized x-position
   within the cell.
2. **Click** (pointerup with no motion) → toggles a per-parameter popup with
   override controls (min, max, curve, freeze).

### Tooltip

Existing tooltip extended:
- During hover (no drag): shows `{name}: {value}` with a `▾` indicator hinting
  the bar is clickable.
- During drag: stays visible and updates live as user scrubs.
- New CSS: `.heatmap-cell.dragging` with `cursor: ew-resize`,
  `.heatmap-cell-bar { pointer-events: none }` so child bar doesn't intercept
  parent pointer events.

### Popup contents

Per-parameter popup (`#param-popup` or similar) built on demand for the
clicked param:
- min slider (range 0–1)
- max slider (range 0–1)
- curve slider (range 0–1, see Theme 4)
- freeze toggle — when frozen, dragging the heatmap bar updates a *fixed
  value* directly rather than going through the model
- close button / clicks-outside dismissal
- show/hide handled with `popupHideTimer` (300ms grace period to let user
  move pointer from heatmap cell into the popup without dismiss-on-leave)

### New JS

- `setHeatmapValue(paramIndex, e, cell)` — converts pointer x to normalized
  value, applies override semantics (writes to `ov.fixedValue` if frozen),
  routes outputs, syncs UI.
- `showParamPopup(paramIndex, cell)` — positions popup near the cell.
- `hideParamPopup()` — clears active popup state.
- `wireParamPopup()` — wires popup controls to update underlying override.
- Tracking globals: `activePopupParam`, `popupHideTimer`.

### Inferred intent

- Make the heatmap a control surface, not just a readout. Saves a trip to
  the bottom-sheet/drawer for common adjustments.
- Per-parameter freeze enables hybrid workflow: freeze a few params at fixed
  values while letting the model drive the rest.
- Popup is in-context (anchored to the bar) rather than in a side panel,
  reducing eye travel.

### Key UX flow

- **Quick adjust:** point at heatmap bar → drag horizontally → value changes
  live, model output reroutes immediately.
- **Override setup:** click bar → popup opens → adjust min/max to constrain
  range, or freeze at fixed value, or shape curve (see Theme 4) → click
  outside or wait for cell pointer-leave to dismiss.

### Notes

- `.heatmap-cell-frozen` CSS class dims frozen cells visually so user knows
  what's manually overridden.
- Drag detection uses 3px motion threshold to disambiguate click-vs-drag.
- Pointer capture (`setPointerCapture`) ensures drag continues even if
  pointer leaves the cell.

---

## Theme 3 — Undo

### What changed

Adds an undo button below the RL thumbs-up/down buttons, with a 20-step
history of weight snapshots taken before each RL action.

### Implementation

- New HTML: `<button class="rl-undo-btn" id="btn-undo">` in the RL buttons
  cluster, with an SVG curl-arrow icon.
- New CSS: `.rl-undo-btn` (28px circle, dim-by-default at opacity 0.4,
  brightens to 0.8 on hover, 0.7 when undo is available),
  `.rl-undo-btn.has-undo` and `.rl-undo-btn.flash` states. Animation
  `rl-flash` (0.25s ease-out) for feedback after undo.
- Layout: `.rl-buttons` becomes `display: grid` with two columns and two
  rows; the undo button spans both columns in row 2 (`grid-column: 1 / -1`)
  and is centered.
- New JS:
  - `const undoStack = []` and `const MAX_UNDO = 20`
  - `pushUndoSnapshot()` — called before each RL action; clones current
    weights into the stack; pops oldest if over MAX_UNDO.
  - `onUndo()` — pops last snapshot, restores weights, flashes button.
  - `updateUndoButton()` — toggles `.has-undo` class based on
    `undoStack.length > 0`.

### Inferred intent

- RL actions in this playground are exploratory and easy to "go too far" —
  e.g. a thumbs-down sequence that drives the model into uninteresting
  territory. Without undo, user has to retrain or randomize, losing all
  history.
- Visual subtlety (low default opacity, only fully visible when there's
  something to undo) keeps it out of the way until needed.

### Key UX flow

User clicks 👎 → push snapshot, apply update. Result is bad. User clicks
↶ → restores previous weights. Button flashes briefly to confirm.

### Notes

- This is the cleanest standalone theme — minimal coupling to the rest of
  the redesign. Consider implementing first in the SolidJS rewrite to
  validate the snapshot model.

---

## Theme 4 — Per-parameter override generalization

### What changed

Generalizes the existing `groupOverrides` system (which let synth-mode params
be constrained per-group) to also work in visual mode, and unifies access
behind a single `getParamOverride(i)` accessor.

### New shapes

- `const visualOverrides = VISUAL_PARAM_NAMES.map(() => ({ min: 0, max: 1, curve: 0.5, frozen: false, fixedValue: 0.5 }))`
  — one override entry per visual parameter, parallel to the existing
  per-section/per-param structure on the synth side.
- `getParamOverride(paramIndex)` — given a heatmap index, returns an object
  with the same shape regardless of mode:
  - In `visual` mode: returns the corresponding `visualOverrides[i]` entry
    directly.
  - In `synth` mode: looks up `paramToSection[paramIndex]` and returns a
    proxy onto `groupOverrides[si].params[li]`, with `muted` mapped to
    `frozen` so the popup UI can be mode-agnostic.

### Renames (cosmetic but indicative)

- `buildRawParams()` → `buildEngineParams()`
- `$rawParams` → `$engineParams`
- HTML id `raw-params` → `engine-params`

### New JS helpers

- `syncEngineParams()` — pull current values into the drawer-rendered slider
  list.
- `formatEngineVal(v, step)` — display formatting for slider readouts.

### Other change

- `let rlExplorationDecay = 0.97` (was `const`) — runtime-tunable, presumably
  exposed via an Engine drawer slider.

### Inferred intent

- Visual mode previously had no way to clamp/freeze individual parameters.
  Synth mode did. The asymmetry forced the heatmap popup to behave
  differently per mode, which is poor UX.
- Unifying behind one accessor lets Theme 2's popup code be mode-agnostic.
- "Engine" terminology generalizes "raw params" to whichever output system
  is active.

### Notes

- This theme is **coupled to Theme 2** — the popup is what consumes the
  override accessor. They should ship together (or, in the SolidJS rewrite,
  be designed together as one feature: "per-parameter constraints + the UI
  to set them").

---

## Theme 5 — Polish (positioning, status line)

Small adjustments forced by the larger redesign or independent quality-of-life
fixes:

- **Status line** moves from inside the sheet (`<div class="sheet-status">`)
  to a free-floating pill anchored at `bottom: 8px`, centered, low-opacity
  (`#status-line`). Lives outside any drawer; visible always.
- **Joystick & hand-pip** move from `bottom: 136px` to `bottom: 100px`
  (sheet no longer takes up vertical space).
- **RL buttons** move from `bottom: 92px` to `bottom: 36px`, gap from 32px
  to 12px, layout from flex to 2-col grid (to accommodate the spanning undo
  button below).
- **`rlExplorationDecay`** changes from `const` to `let` (see Theme 4).
- **Heatmap tooltip** gets `▾` suffix to hint clickability and stays visible
  during drag.
- **Hand-pip video** loses `/* Hidden — only used as MediaPipe source */`
  comment on the position-absolute hidden video element. Behavior unchanged.

### Notes

- These are positioning constants tied to the shape of the surrounding
  layout. The SolidJS rewrite shouldn't carry them forward as literals —
  derive from layout / CSS variables.

---

## What this redesign does NOT change

For completeness — these survived the redesign untouched:

- Joystick container and joystick interaction logic (`wireJoystick`).
- Hand tracker / MediaPipe pipeline (`createDevPanel(() => handTracker)`).
- Synth visualizer canvas (`#synth-vis-canvas`, `SYNTH_SECTIONS`).
- Loss canvas drawing.
- Help overlay (`wireHelp`).
- Group overrides for synth mode (extended in Theme 4, but base mechanism
  unchanged).
- Gamepad input.
- Output mode routing logic (`routeOutputs`, `rawParamValues`).

---

## Summary table for the SolidJS rewrite

| Theme | Carry forward? | How it should land in SolidJS |
|---|---|---|
| 1. Dock + drawers | Yes | `<Dock>` + `<DrawerStack>` driven by signal for active drawer |
| 2. Interactive heatmap | Yes | Heatmap cells as components with pointer-event handlers; popup as a portal anchored to clicked cell |
| 3. Undo | Yes | Single store with `undo()` action + size cap; trivially reactive |
| 4. Param override generalization | Yes | One unified store keyed by param index; mode is just a derived accessor |
| 5. Polish | Re-derive | Don't carry positioning literals; recompute from layout |
