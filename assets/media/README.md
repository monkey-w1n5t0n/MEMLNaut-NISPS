# Educational explainers (Manim)

3Blue1Brown-style animated explainers for Manifold's core ideas: how physical
controls become numbers, how one control fans out to many parameters, and how the
two feedback/training modes reshape a mapping. Rendered with Manim Community
Edition v0.19 (provided via `nix-shell -p manim`), 1920x1080 @ 60 fps.

British spelling throughout the on-screen copy (randomise, centre, behaviour).

## Index

| File | Duration | Shows | Interactive-demo candidate? | Where it slots in |
|------|----------|-------|------------------------------|-------------------|
| `01-knob-mapping.mp4` | ~21s | A knob rotates while a paired 0–1 number rises/falls in lockstep. The point: a control is just a readout of one number. | **Strong** — a live knob bound to a number is the simplest possible interactive widget. | Onboarding step 1 / the very first "what is a control" beat. Pairs with the `Slider`/`Knob` primitives. |
| `02-xy-pad.mp4` | ~20s | A 2-D pad projects to two independent 0–1 values A and B, each shown as a slider, as the dot moves. | **Strong** — a `JoyMap` driving two live readouts is already close to an in-app primitive demo. | Onboarding step 2. Directly mirrors the `JoyMap` primitive + two `Slider`s. |
| `03-fanout.mp4` | ~27s | The same 2-D control driving 3 → 4 → 5 outputs (N sliders one side, control the other), then the control type cycled across knob, fader, touchpad, 2-D joystick, 3-D joystick. | **Medium** — the N-slider fan-out is demoable live; the control-type carousel is better as video. | Onboarding step 3 — the "why a network in the middle" moment, just before the mode UI. Connects to the dimensionality story in the mode schemas. |
| `04-feedback.mp4` | ~53s | Training on the mapping surface (projected to 2-D) and how a verdict reshapes it. **Contrasts the two feedback modes:** geometric push-away (directed repulsion from the liked centroid) vs explore-and-place (randomise → audition → place → interpolate). Ends on a side-by-side and the recommendation. | **Medium/low** — concept-heavy; the explore-and-place loop could become a guided interactive walkthrough, but the contrast slide is best as video. | The learning-behaviour onboarding / the dock-panel `FEEDBACK_MODE` selector help. Coordinates with `docs/redesign/rl-feedback-design.md` (explore-and-place is the recommended default). |

`04-feedback.mp4` is `s4_feedback.py`'s three scenes (`GeometricDislike`,
`ExploreAndPlace`, `FeedbackContrast`) concatenated.

## Interactive-onboarding recommendation

Pieces 1 and 2 are the best candidates to become **interactive in-app onboarding
demos** rather than playback video — they map almost 1:1 onto existing playground
primitives (`Knob`/`Slider`, `JoyMap`). A first onboarding pass could embed live
versions of those two and keep 3 and 4 as explainer video, since 3's control
carousel and 4's mode contrast carry more narrative than a single widget can.

## Rebuilding

Sources live in `src/`. There is no system Manim; use Nix:

```bash
cd assets/media/src
nix-shell -p manim --run "manim -qh --disable_caching s1_knob_mapping.py KnobMapping"
nix-shell -p manim --run "manim -qh --disable_caching s2_xy_pad.py XYPad"
nix-shell -p manim --run "manim -qh --disable_caching s3_fanout.py Fanout"
nix-shell -p manim --run "manim -qh --disable_caching s4_feedback.py GeometricDislike ExploreAndPlace FeedbackContrast"
```

Then stitch the feedback piece and copy the finals up one level:

```bash
V=media/videos
printf "file '%s'\n" \
  "$PWD/$V/s4_feedback/1080p60/GeometricDislike.mp4" \
  "$PWD/$V/s4_feedback/1080p60/ExploreAndPlace.mp4" \
  "$PWD/$V/s4_feedback/1080p60/FeedbackContrast.mp4" > concat_feedback.txt
ffmpeg -y -f concat -safe 0 -i concat_feedback.txt -c copy "$V/s4_feedback/1080p60/Feedback.mp4"

cp $V/s1_knob_mapping/1080p60/KnobMapping.mp4 ../01-knob-mapping.mp4
cp $V/s2_xy_pad/1080p60/XYPad.mp4            ../02-xy-pad.mp4
cp $V/s3_fanout/1080p60/Fanout.mp4          ../03-fanout.mp4
cp $V/s4_feedback/1080p60/Feedback.mp4     ../04-feedback.mp4
```

The `src/media/` render tree is gitignored (regenerable). Only the four committed
`.mp4`s and the sources are tracked. Use `-ql` for fast draft iteration.
