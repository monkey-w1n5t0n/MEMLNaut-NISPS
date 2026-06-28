# Manim Explainers — Plan (workstream G)

3Blue1Brown-style educational explainers for Manifold's core ideas: how physical
controls map to numbers, how a single control fans out to many parameters, and how
the two feedback/training modes reshape a mapping. British spelling in all on-screen copy.

## Shared visual language

- Palette: Classic 3B1B on `#1C1C1C`. Primary `#58C4DD` (control side), Green
  `#83C167` (numbers/outputs), Yellow `#FFFF00` (accent / the moving value).
  Dislike/push = warm red `#FF6B6B`. Anchors (placed sounds) = green dots.
- Monospace font throughout (`MONO`), per the skill (Pango kerning).
- Opacity layering: primary 1.0, context 0.4, structure (axes/grid) 0.15.
- Breathing room: `self.wait()` after every reveal.

## The five scripts

| # | File | Scene(s) | Teaches |
|---|------|----------|---------|
| 1 | `s1_knob_mapping.py` | `KnobMapping` | A knob is a 1:1 readout of one number in [0,1]. Rotation ⇄ value in lockstep. |
| 2 | `s2_xy_pad.py` | `XYPad` | A 2-D pad projects to two *independent* numbers A and B, shown as sliders. |
| 3 | `s3_fanout.py` | `Fanout` | The same 2-D control drives 3→4→5 outputs (N sliders), across control types. |
| 4 | `s4_feedback.py` | `GeometricDislike`, `ExploreAndPlace`, `FeedbackContrast` | The two feedback modes on a loss/mapping surface: geometric push-away vs explore-and-place (the recommended default). |

Each scene is independently renderable; scripts are stitched with ffmpeg per piece.

## Narrative arcs

1. **Knob = 1:1.** Misconception corrected: a control isn't "magic", it's a number.
   Show the dial; bind a 0–1 readout; sweep both ways; they never disagree.
2. **XY → two numbers.** One gesture, two readings. Move the dot; A reads the
   horizontal, B reads the vertical; they move independently. The pad is just two
   knobs stacked at right angles.
3. **Fan-out.** The interesting bit: one control, many outputs. A small network
   sits between the control and N sliders. Grow N (3→4→5) and cycle the control
   type (knob, fader, touchpad, 2-D joystick, 3-D joystick) — the principle holds.
4. **Feedback.** The mapping is a landscape. Two ways to teach it:
   - *Geometric dislike*: you have a liked region; a thumbs-down carves the current
     point directionally **away** from the liked centroid (directed repulsion).
   - *Explore and place* (DEFAULT): randomise the net → audition → "I like that" →
     drop it in a corner → randomise again → place another → interpolate between
     placed anchors. Positive-only; you never reason about "away from what".
   End on a side-by-side contrast and the recommendation.
