# Manifold — Design System

> Train machine learning, on the fly, to play your instruments.

Manifold is an **open-source project and a family of commercial products** that train and run on-the-fly machine learning (small MLPs and related techniques) to **program, control, patch, and perform with electronic musical instruments** — synths, samplers, sequencers, Eurorack, and software plugins.

The shape of the system is always the same three stages:

```
   INPUTS              ENGINE                 OUTPUTS
 joystick   ┐                              ┌  MIDI
 XY pad     ├──▶  on-the-fly ML  ──▶  ├  CV / gate
 trackpad   ┘   (MLP / regression)      └  OSC → devices
   (hw + sw, every hardware input has a software visualisation)
```

A performer moves an **input** (a joystick, an XY pad, a trackpad — some hardware, some software, all with live software visualisations). The signal runs through the **engine**, a tiny neural net trained live by the player's own thumbs-up / thumbs-down feedback. The result is sent to the **world** as MIDI, CV, or OSC to control other devices.

The reference application is the **MEMLNaut playground** — a browser shell hosting nine "modes", each pairing an input surface with a synthesis/effects engine (PAF formant synth, channel strip, granular morph, reverb, drum/breakbeat, sound-analysis→MIDI, and more).

## Sources given

- **Codebase** `playground/` — the MEMLNaut playground, a Vite + **SolidJS** + TypeScript app. ML inference runs in-browser via a WASM module (`public/nisps.wasm`); audio synthesis runs in an AudioWorklet. Key paths:
  - `src/styles/tokens.css` — the original design tokens (dark canvas, mono, warm+cool accents). **This system is a faithful port + extension of that file.**
  - `src/primitives/` — the control + visualisation primitives: `XYPad`, `VirtualJoystick`, `Slider`, `PillToggle`, `ControlAxis`, `TrainingControls`, `LossPlot`, `Heatmap`, `JoyMap`, `OutputDisplay`, `GradientFlow`, `ProgressRing`, `SliderBank`, `WeightHealth`, `Drawer`, `ParamEditor`.
  - `src/modes/` — nine modes + `ModeShell` (the shared scaffold) + `ModeSwitcher`.
  - `src/output/curves.ts` — the named-curve catalog (`linear, exp, log, square, sqrt, sigmoid, cubic, centered_power`) — a core brand motif (straight lines & parabolic / polynomial / bézier curves).

There were no Figma links, slide decks, or logo binaries in the source — the brand wordmark in the app is the plain text **`MEMLNaut`** + dim `playground`. See ICONOGRAPHY for how the mark is treated and Caveats at the bottom.

---

## CONTENT FUNDAMENTALS

How Manifold writes. The voice is a **terminal operator's notebook**: lowercase, terse, technical, unfussy. It trusts the reader is a musician *and* a tinkerer.

- **Casing.** UI labels and routes are **lowercase** (`home`, `/modes`, `/dev/primitives`). Micro-labels above controls are **UPPERCASE with wide letter-spacing** (`EXAMPLES`, `LOSS`, `BOLDNESS`). Mode names are Title Case (`PAF Synth`, `Channel Strip`). Sentences in prose are sentence case.
- **Person.** Mostly **imperative, addressed to "you"** — *"pick a mode and start playing"*, *"Drag to sculpt formants"*, *"start it from inside any mode"*. Rarely first-person.
- **Tone.** Plain, confident, slightly hacker. States facts and constraints without apology: *"Audio cannot autoplay (browser policy)."*, *"ML inference runs on the main thread via WASM."* Comments in code carry a dry wit (*"Amnesia ↔ Elephant"*, *"Stream 9: nine modes, one shell."*).
- **Density.** Pack real values, not filler. Readouts are always shown with units and tabular numerals: `loss 4.2e-3`, `input (0.62, 0.41)`, `noise 0.018`, `33 in → 1 out`.
- **Verbs of the domain.** train, randomise (British -ise), explore, pin, snapshot, undo, freeze, converge, route. Feedback is **thumbs-up / thumbs-down** (rendered `+` / `−`).
- **Punctuation.** Middle dot `·` separates inline metadata (`engine: paf_synth · 33 in → 1 out`). Arrows `→` `↔` `▶` `⏹` `↶` carry meaning. Ellipsis `…` for in-progress states (`training…`).
- **Emoji.** Used **only as functional glyphs** in dense toolbars where an icon font is absent — `🎤` mic, `⚙` settings, `📚` history, `▶ ⏹` transport. Never decorative, never in prose. Prefer geometric Unicode/SVG over emoji where possible (see ICONOGRAPHY).
- **British spelling** (randomise, visualisation, colour-adjacent terms) — the project's origin.

Examples (verbatim from the product):

> *"Interactive ML control of audio. Stream 9: nine modes, one shell."*
> *"Drag to sculpt formants. Voice space: **Bright**"*
> *"pick a mode and start playing"*

---

## VISUAL FOUNDATIONS

The look is a **vintage-computer / instrument-panel terminal**: near-black canvas, monospace everywhere, hairline borders, and **glow** instead of drop-shadow to signal what's alive.

- **Palette.** A dark greyscale stack (`#0d0d0d → #141414 → #1c1c1c → #242424`) for canvas → panel → raised → track. Text steps down `#e8e8e8 → #9a9a9a → #5a5a5a`. **Two accents do all the work:** warm **orange `#ff6a00`** (the primary — actions, focus, the live control dot) and cool **cyan `#00ccff`** (data, plots, the secondary dot). Semantic green/amber/red/blue are reserved for training health (loss, gradient flow). Five translucent **pin** colors mark regions on the joy-map.
- **Type.** **JetBrains Mono** is the hero face — used for ~everything, including titles. A system sans is the quiet fallback for long prose only. Fixed px scale (`11 / 13 / 15 / 18 / 24`). Values use `font-variant-numeric: tabular-nums`. Micro-labels are 11px uppercase, `letter-spacing: 0.08em`, in `--fg-mute`.
- **Borders.** Everything is outlined with a **1px hairline** `#2a2a2a`. Stronger `#3a3a3a` for internal grid lines and dashed guides (the joystick boundary is a 1px **dashed** circle). Borders, not shadows, define cards.
- **Backgrounds.** Flat solids only — **no gradients, no images, no texture** on surfaces. The only "imagery" is generated: canvas-drawn plots, heatmaps, and the named math curves. The motif is **line + curve** (a loss trace, a parabola, a bézier), never photography or illustration.
- **Glow, not shadow.** Live, draggable elements carry a colored **box-shadow halo** in their accent (`0 0 8–12px rgba(accent, .45)`): the XY-pad dot (cyan), the joystick knob (orange), slider thumbs. Drop-shadows (`--shadow-1/2`) appear only on floating chrome (drawers, popovers). Depth is communicated by the bg-step ladder, not elevation.
- **Radius.** Tight and consistent: `4px` (buttons, inputs, chips), `8px` (panels, pads, cards), `14px` (drawers), `999px` (pills/segmented controls). XY pad = 8px square; joystick = full circle.
- **Cards / panels.** `--bg-1` fill + 1px `--line` border + 8px radius + ~12–16px padding. No shadow. A header row is separated by a 1px bottom border; uppercase micro-labels sit above their values.
- **Hover.** Surfaces lighten one bg step (`--bg-2 → --bg-3`) and the border goes `--line → --line-strong`. Text-only controls brighten `--fg-mute → --fg`. ~120ms.
- **Press / active.** The selected pill/tab fills **solid orange with `--bg` text**. Active nav gets an orange border + orange text. Slider thumbs scale `1.15` on hover. No bounce.
- **Focus.** Accent border + a **3px orange glow ring** (`0 0 0 3px rgba(255,106,0,.3)`) — visible and on-brand, replacing the browser outline.
- **Motion.** One house easing `cubic-bezier(.25,.8,.35,1)`; durations `120 / 220 / 360ms`. Transitions are **fades and slides** (drawers slide in from the side). No spring, no bounce, no infinite decorative loops — the only continuous motion is *data* (a loss plot advancing, a live readout updating).
- **Transparency / blur.** Used sparingly: translucent pin fills on the joy-map; faint white grid lines on plots (`rgba(255,255,255,0.05)`). No backdrop-blur glass.
- **Layout.** Dense grids. The mode shell is a 4-row grid: header / body (input + map) / controls (axes + training) / status line. Hit targets ≥ 44px; primary training buttons are 48px tall. Everything is left-aligned and grid-gapped, never centered-flowing.
- **Imagery vibe.** Cool and synthetic — black background, neon-on-dark plots, pixelated heatmaps. No warmth, grain, or photography.

---

## ICONOGRAPHY

Manifold's iconography is **geometric and minimal — drawn from the control surfaces themselves**, not from a packaged icon set.

- **No bundled icon font or SVG sprite** exists in the codebase. The product leans on three things, in order of preference:
  1. **Functional Unicode glyphs** rendered in the mono face — transport `▶ ⏹`, undo `↶`, arrows `→ ↔`, math `+ − ×`, middle-dot `·`. These match the terminal aesthetic and need no assets.
  2. **A few emoji as utility icons** in dense toolbars only — `🎤` mic, `⚙` settings/drawer, `📚` snapshot history. Treat these as placeholders for a future geometric set; never use emoji decoratively or in prose.
  3. **Canvas-drawn "live" iconography** — the real visual language is the *instrument itself*: the XY-pad crosshair + glowing dot, the joystick's dashed boundary + knob, the loss sparkline, the layer-norm bars, the heatmap. When you need to represent a Manifold concept, draw the control, don't reach for a metaphor icon.
- **Geometric system, if you must add icons.** Use a thin, single-weight, square-cornered line set. The closest CDN match is **[Lucide](https://lucide.dev)** (2px stroke, geometric, open) or **[Phosphor](https://phosphoricons.com)** (`regular` weight). This system **substitutes Lucide via CDN** for kit screens that need wayfinding icons (settings, close, chevrons) — flagged as a substitution; swap for a bespoke set when one exists. See `assets/icons/` for the curated subset and `assets/README.md`.
- **The logo / wordmark.** The only mark in the source is the text lockup **`MEMLNaut`** (bold, `--accent` orange) beside a dim lowercase `playground`, set in JetBrains Mono. There is no symbol/glyph logo. The brand name **Manifold** is set the same way: bold mono wordmark, optionally with the orange dot of a live control as the "o". See `assets/` for the recreated lockups.
- **Emoji policy:** functional-only, toolbar-only. Default to Unicode geometry or Lucide. Never emoji in headings, marketing, or body copy.

---

## Index / manifest

- `styles.css` — global entry (link this). `@import` manifest only.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `effects.css`, `fonts.css`, `base.css`.
- `assets/` — recreated wordmarks, curated Lucide icon subset, README. (See Caveats.)
- `guidelines/` — foundation specimen cards (Type / Colors / Spacing / Brand) shown on the Design System tab.
- `components/` — reusable React primitives (see list below) + per-group cards.
- `ui_kits/memlnaut/` — full-screen recreation of the MEMLNaut playground mode shell. Plus `ui_kits/memlnaut/console/` — the **Playground 2.0 Console** main view (full-bleed manifold + verdict cluster + right dock with depth drawers).
- `SKILL.md` — Agent-Skill front-matter for downloadable use.

**Components** (`window.ManifoldDesignSystem_490915.*`): Button, PillToggle, Slider, Panel, Badge, Switch, StatusLine · XYPad, VirtualJoystick, ControlAxis · CurvePlot, Sparkline.

**Caveats / open questions** — see the chat summary; the wordmark and icon set are recreations/substitutions pending real brand assets.
