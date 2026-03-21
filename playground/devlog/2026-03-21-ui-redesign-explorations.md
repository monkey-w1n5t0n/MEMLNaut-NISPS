# Playground UI Redesign Explorations

**Date**: 2026-03-21 → 2026-03-22
**Status**: Three designs built and iterated through 4 rounds of feedback. Several refinements still open.

## Context

The existing playground UI (`index.html`) is a single-column mobile-first layout: header, canvas, 20 parameter bars, joystick + controls. It works but has several tensions:

- **Individual param bars dominate the screen** and are only interactive in Examples mode
- **Two orthogonal mode axes** (learning mode: examples/RL, output mode: visual/synth) live in different places with different UI patterns
- The synth side panel feels bolted on
- The "teach then perform" arc isn't surfaced — new users don't know what to do first
- Most importantly: **manually setting sliders contradicts the core thesis** — NISPS exists precisely because you *shouldn't* need to understand individual parameters

With the C15 synth mode now at **126 parameters**, the slider approach is impossible, making the ML mapping the only viable interface.

## Design Thesis

The three designs explore different answers to: **if users shouldn't set params directly, what DO they interact with?**

## Design A: "Immersive"

**File**: `a-immersive.html` | **Philosophy**: The canvas IS the app

The flow field fills the entire viewport. Everything else floats on top as translucent glassmorphism overlays:

- **Floating circular joystick** with integrated training-example minimap (merged into one control)
- **Heatmap strip** at top — horizontal fill bars (like a tiny equalizer) showing output values at a glance. Hidden in synth mode since the full-screen synth visualizer serves this purpose.
- **Bottom sheet** with chevron toggle (collapsed/expanded), mode toggles always visible in a sticky floating bar
- **RL mode is default** — floating thumbs up/down buttons with key hints (1/2) built in
- **Follow mode** for trackpad-friendly exploration without holding the mouse
- **Synth mode**: full-screen parameter landscape (126 vertical bars grouped by synthesis section), interactive/draggable in examples mode, with a quick play button + hover drawer next to the back button

**Strengths**: Feels like an instrument. Canvas gets maximum space. The synth visualizer conveys the full 126-param scale.
**Open issues**: See bd issue for remaining refinements (synth bar layout, slider interactivity, default mode).

## Design B: "Workbench"

**File**: `b-workbench.html` | **Philosophy**: Show the mapping, not the params

A CSS grid dashboard (2-column on desktop, single-column with collapsible sections on mobile):

- **Mapping heatmap** (the key innovation): a 2D canvas sampling a 20×20 grid through the network, showing the learned function as a color field. Training examples are visible dots. Click/drag anywhere to control position — the mapping IS the joystick (merged).
- **Parameter constellation**: dots in a circle, sized by value, with a count label ("20 parameters" / "126 synth parameters")
- **Semantic param groups**: collapsible cards with sparkline headers. 5 groups for visual mode, 17 groups for synth mode (covering all 126 params by synthesis section)
- **Synth mode**: replaces the flow field canvas with a parameter landscape visualization (126 grouped bars)
- **Softened heatmap colors** with grid overlay for readability

**Strengths**: The mapping heatmap makes the learned function tangible. Param groups reduce cognitive load.
**Open issues**: Visual pill toggle reliability, heatmap color tuning.

## Design C: "Journey"

**File**: `c-journey.html` | **Philosophy**: The UI teaches you, then disappears

Three phases that transition based on user actions:

1. **Explore** (start): fullscreen canvas + floating joystick + gentle prompts. Minimal chrome.
2. **Teach** (active training): canvas shrinks to ~40%. Teaching interface with mode tabs (Examples/RL). Preset snapshot grid. Minimap of examples. Collapsible raw sliders.
3. **Perform** (post-training): canvas expands back to fullscreen. Controls fade to near-invisible after 5s inactivity.

- **RL mode is default** teach mode with keyboard shortcuts (1/2) working in all phases
- **Heatmap strip** with horizontal fill bars, scales from 20 to 126 params
- **Synth mode**: parameter landscape visualization replacing the flow field
- **Follow mode** with double-click toggle and pill button

**Strengths**: Maps perfectly to the real user arc. Phase 3 auto-dissolve is genuinely novel.
**Open issues**: RL mode joystick visibility, fine-tune slider style consistency.

## Shared Architecture

All three designs share unchanged modules:
- `js/nisps/` — MLP, IML, Dataset, Layer, Node (the ML engine)
- `js/ui/visualizer.js` — FlowFieldVisualizer (Canvas2D particle system)
- `js/synth/` — C15Bridge (WASM synth), Arpeggiator, param-map (126 params)

Each design has its own HTML + CSS + app.js. The `designs.html` homepage links to all three with live iframe previews.

### Common features across all designs:
- **126-output MLP** with `[32, 48, 64]` hidden layers
- **Visual mode**: first 20 outputs → flow field particle system
- **Synth mode**: all 126 outputs → SynthVisualizer (grouped bar chart) + C15 WASM engine
- **`?tame=0.7`** URL parameter for safe-range constraining of synth params
- **RL as default** learning mode with keyboard shortcuts (1=negative, 2=positive)
- **Follow mode** for trackpad-friendly exploration
- **localStorage persistence** (random on first boot, restores on refresh)
- **Presets** padded from 20 to 126 outputs with 0.5 defaults

## Answered Questions

- **RL mode is now the default** across all designs — it's the purer expression of the NISPS thesis
- **Network architecture scaled** from `[10, 10, 14]` (20 outputs) to `[32, 48, 64]` (126 outputs)
- **Synth mode gets its own visualization** — parameter landscape with 126 grouped bars, not the particle system
- **Snapshot teaching + fine-grained sliders coexist** — presets for quick setup, expandable raw params for power users

## Iteration History

1. **Initial build** (2026-03-21): Three designs from PRD, all functional
2. **Round 1**: Added back buttons, follow mode, merged joystick+minimap (A), merged joystick+mapping (B), fixed RL functions (C)
3. **Round 2**: Restored localStorage, added keyboard hints, fixed slider responsiveness (B), fixed Visual pill toggle (B), horizontal heatmap bars (A)
4. **Round 3**: Upgraded to 126 outputs + `[32, 48, 64]` MLP, added SynthVisualizer to all designs, added randomize buttons, `?tame` URL param, back button SVGs
5. **Round 4**: Homepage with live previews, synth quick-play button (A), interactive synth bars (A), heatmap hidden in synth mode (A), tame param to B+C
