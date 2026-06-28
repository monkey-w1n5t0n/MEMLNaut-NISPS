"""Manifold explainer 4 — Feedback / training, two modes contrasted.

Training reshapes the mapping, seen as a landscape (the loss / mapping surface
projected to 2-D). Manifold offers two feedback modes:

  * GeometricDislike  -- you have a liked region; a thumbs-down carves the current
                         point directionally AWAY from the liked centroid.
  * ExploreAndPlace   -- (RECOMMENDED DEFAULT) randomise the net, audition, "I like
                         that", drop it in a corner, randomise again, place another,
                         then interpolate between the placed anchors. Positive-only.

Coordinated with docs/redesign/rl-feedback-design.md.

Render:
    manim -qh s4_feedback.py GeometricDislike ExploreAndPlace FeedbackContrast
"""

from manim import *

BG = "#1C1C1C"
PRIMARY = "#58C4DD"
LIKE = "#83C167"      # liked / positive
DISLIKE = "#FF6B6B"   # disliked / push-away
ACCENT = "#FFFF00"
ANCHOR = "#83C167"
MONO = "Monospace"


def control_pad(side=3.2, shift=ORIGIN, colour=PRIMARY):
    """A 2-D control space (the input plane the mapping lives over)."""
    pad = Square(side_length=side, color=colour, stroke_width=4)
    pad.set_fill(colour, opacity=0.05).move_to(shift)
    grid = VGroup()
    bl = pad.get_corner(DL)
    for f in (0.25, 0.5, 0.75):
        grid.add(Line(bl + RIGHT * f * side, bl + RIGHT * f * side + UP * side,
                      color=colour, stroke_width=1).set_opacity(0.15))
        grid.add(Line(bl + UP * f * side, bl + UP * f * side + RIGHT * side,
                      color=colour, stroke_width=1).set_opacity(0.15))
    return pad, grid


class GeometricDislike(Scene):
    def construct(self):
        self.camera.background_color = BG
        title = Text("Geometric dislike", font_size=42, color=DISLIKE,
                     weight=BOLD, font=MONO).to_edge(UP, buff=0.4)
        sub = Text("push the sound away from what you like", font_size=24,
                   color=WHITE, font=MONO).next_to(title, DOWN, buff=0.25)
        self.play(Write(title), run_time=1.2)
        self.play(FadeIn(sub), run_time=0.7)
        self.wait(0.8)

        pad, grid = control_pad(3.4, LEFT * 3.0 + DOWN * 0.3)
        self.play(Create(pad), Create(grid), run_time=1.0)

        # a few liked points + their centroid
        liked_pts = [LEFT * 3.8 + DOWN * 0.9, LEFT * 2.5 + UP * 0.3,
                     LEFT * 3.2 + UP * 0.6]
        likes = VGroup(*[Dot(p, radius=0.11, color=LIKE) for p in liked_pts])
        like_lab = Text("liked region", font_size=20, color=LIKE, font=MONO)
        like_lab.next_to(pad, DOWN, buff=0.3)
        self.play(LaggedStart(*[GrowFromCenter(d) for d in likes], lag_ratio=0.3),
                  FadeIn(like_lab), run_time=1.2)

        centroid_pos = np.mean(np.array(liked_pts), axis=0)
        centroid = Dot(centroid_pos, radius=0.09, color=LIKE).set_opacity(0.6)
        cring = Circle(radius=0.22, color=LIKE, stroke_width=2).move_to(
            centroid_pos).set_opacity(0.6)
        c_lab = Text("centre", font_size=16, color=LIKE, font=MONO).next_to(
            cring, UP, buff=0.1)
        self.play(FadeIn(centroid), Create(cring), FadeIn(c_lab), run_time=0.8)
        self.wait(0.8)

        # the current (heard) point + thumbs-down
        cur = Dot(LEFT * 1.9 + DOWN * 1.0, radius=0.13, color=ACCENT)
        cur_lab = Text("current sound", font_size=18, color=ACCENT, font=MONO).next_to(
            cur, RIGHT, buff=0.15)
        self.play(GrowFromCenter(cur), FadeIn(cur_lab), run_time=0.8)
        self.wait(0.5)

        down = Text("thumbs-down", font_size=26, color=DISLIKE, font=MONO).to_edge(
            DOWN, buff=0.5)
        self.play(FadeIn(down), Flash(cur, color=DISLIKE, line_length=0.3), run_time=0.9)
        self.wait(0.4)

        # the push vector: directed AWAY from the centroid (cur - centroid)
        direction = cur.get_center() - centroid_pos
        direction = direction / np.linalg.norm(direction)
        target = cur.get_center() + direction * 1.5
        push = Arrow(cur.get_center(), target, color=DISLIKE, stroke_width=6,
                     buff=0.0)
        self.play(GrowArrow(push), run_time=1.0)
        self.wait(0.4)
        self.play(cur.animate.move_to(target),
                  cur_lab.animate.next_to(target, RIGHT, buff=0.15),
                  run_time=1.4, rate_func=smooth)
        self.play(FadeOut(push), run_time=0.4)
        self.wait(0.5)

        note = Text("directed repulsion: away from the centre, not random",
                    font_size=22, color=WHITE, font=MONO).to_edge(DOWN, buff=0.5)
        self.play(ReplacementTransform(down, note), run_time=0.7)
        self.wait(1.8)
        self.play(FadeOut(Group(*self.mobjects)), run_time=0.6)
        self.wait(0.3)


class ExploreAndPlace(Scene):
    def construct(self):
        self.camera.background_color = BG
        title = Text("Explore and place", font_size=42, color=LIKE,
                     weight=BOLD, font=MONO).to_edge(UP, buff=0.4)
        tag = Text("recommended default", font_size=18, color=ACCENT,
                   font=MONO).next_to(title, RIGHT, buff=0.4)
        sub = Text("randomise -> audition -> place -> interpolate", font_size=24,
                   color=WHITE, font=MONO).next_to(title, DOWN, buff=0.25)
        self.play(Write(title), FadeIn(tag), run_time=1.2)
        self.play(FadeIn(sub), run_time=0.7)
        self.wait(0.8)

        pad, grid = control_pad(3.6, LEFT * 3.0 + DOWN * 0.3)
        self.play(Create(pad), Create(grid), run_time=1.0)

        # the scratchpad readout (audition meter) on the right
        meter_lab = Text("audition", font_size=22, color=PRIMARY, font=MONO)
        meter_lab.shift(RIGHT * 3.3 + UP * 2.0)
        bar_bg = Rectangle(width=2.4, height=0.5, color=PRIMARY, stroke_width=3)
        bar_bg.next_to(meter_lab, DOWN, buff=0.3)
        self.play(FadeIn(meter_lab), Create(bar_bg), run_time=0.8)

        def audition_bar(frac, colour=ACCENT):
            return Rectangle(width=2.4 * frac, height=0.5, color=colour,
                             fill_color=colour, fill_opacity=0.8,
                             stroke_width=0).align_to(bar_bg, LEFT).set_y(bar_bg.get_y())

        step = Text("", font_size=24, color=WHITE, font=MONO).to_edge(DOWN, buff=0.5)
        self.add(step)

        def set_step(txt, colour=WHITE):
            new = Text(txt, font_size=24, color=colour, font=MONO).to_edge(DOWN, buff=0.5)
            self.play(Transform(step, new), run_time=0.5)

        anchors = VGroup()
        corners = [LEFT * 4.1 + UP * 0.9, LEFT * 1.9 + DOWN * 1.4]
        timbres = [0.78, 0.32]

        for i, (corner, t) in enumerate(zip(corners, timbres)):
            # randomise: meter jitters
            set_step('"meh, randomise..."', PRIMARY)
            jit = audition_bar(0.5)
            self.add(jit)
            for f in (0.85, 0.2, 0.6, t):
                self.play(Transform(jit, audition_bar(f)), run_time=0.35)
            self.wait(0.4)
            set_step('"oh, I like that!"', LIKE)
            self.play(Transform(jit, audition_bar(t, LIKE)),
                      Flash(bar_bg, color=LIKE, line_length=0.2), run_time=0.6)
            self.wait(0.4)
            # place it into a corner
            set_step("place it in that corner", LIKE)
            placed = Dot(bar_bg.get_center(), radius=0.13, color=ANCHOR)
            self.add(placed)
            self.play(placed.animate.move_to(corner), run_time=1.2, rate_func=smooth)
            ring = Circle(radius=0.2, color=ANCHOR, stroke_width=2).move_to(corner)
            self.play(Create(ring), run_time=0.4)
            anchors.add(VGroup(placed, ring))
            self.remove(jit)
            self.wait(0.5)

        # interpolate between the two placed anchors
        set_step("interpolate between placed sounds", ACCENT)
        a0 = corners[0]
        a1 = corners[1]
        morph = Dot(a0, radius=0.12, color=ACCENT)
        line = DashedLine(a0, a1, color=ACCENT, stroke_width=2).set_opacity(0.4)
        self.play(Create(line), GrowFromCenter(morph), run_time=0.7)
        morph_bar = audition_bar(timbres[0], ACCENT)
        self.add(morph_bar)
        for f in (0.25, 0.5, 0.75, 1.0, 0.4):
            pos = a0 + (a1 - a0) * f
            val = timbres[0] + (timbres[1] - timbres[0]) * f
            self.play(morph.animate.move_to(pos),
                      Transform(morph_bar, audition_bar(val, ACCENT)),
                      run_time=0.7)
        self.wait(0.5)
        set_step("a smooth morph -- and no concept of 'dislike'", LIKE)
        self.wait(1.8)
        self.play(FadeOut(Group(*self.mobjects)), run_time=0.6)
        self.wait(0.3)


class FeedbackContrast(Scene):
    def construct(self):
        self.camera.background_color = BG
        title = Text("Two ways to teach a mapping", font_size=40, color=PRIMARY,
                     weight=BOLD, font=MONO).to_edge(UP, buff=0.4)
        self.play(Write(title), run_time=1.2)
        self.wait(0.6)

        divider = DashedLine(UP * 2.3, DOWN * 3.0, color=WHITE,
                             stroke_width=2).set_opacity(0.25)
        self.play(Create(divider), run_time=0.6)

        # left: geometric dislike
        l_head = Text("Geometric dislike", font_size=28, color=DISLIKE,
                      weight=BOLD, font=MONO).move_to(LEFT * 3.5 + UP * 1.7)
        l_lines = VGroup(
            Text("- you have a liked region", font_size=20, color=WHITE, font=MONO),
            Text("- thumbs-down pushes the", font_size=20, color=WHITE, font=MONO),
            Text("  sound AWAY from it", font_size=20, color=DISLIKE, font=MONO),
            Text("- directed, audible repulsion", font_size=20, color=WHITE, font=MONO),
            Text("- precision sculpting tool", font_size=20, color=WHITE, font=MONO),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.28).move_to(LEFT * 3.5 + DOWN * 0.3)

        # right: explore and place
        r_head = Text("Explore and place", font_size=28, color=LIKE,
                      weight=BOLD, font=MONO).move_to(RIGHT * 3.5 + UP * 1.7)
        r_tag = Text("DEFAULT", font_size=16, color=ACCENT, font=MONO).next_to(
            r_head, DOWN, buff=0.12)
        r_lines = VGroup(
            Text("- randomise, audition, place", font_size=20, color=WHITE, font=MONO),
            Text("- positive-only: collect", font_size=20, color=LIKE, font=MONO),
            Text("  sounds you like", font_size=20, color=LIKE, font=MONO),
            Text("- interpolate between anchors", font_size=20, color=WHITE, font=MONO),
            Text("- no 'away from what' to reason", font_size=20, color=WHITE, font=MONO),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.28).move_to(RIGHT * 3.5 + DOWN * 0.3)

        self.play(FadeIn(l_head), FadeIn(r_head), FadeIn(r_tag), run_time=0.8)
        self.play(LaggedStart(*[FadeIn(x) for x in l_lines], lag_ratio=0.25),
                  LaggedStart(*[FadeIn(x) for x in r_lines], lag_ratio=0.25),
                  run_time=2.0)
        self.wait(1.5)

        rec = Text("Default to explore-and-place; reach for dislike to sculpt.",
                   font_size=22, color=ACCENT, font=MONO).to_edge(DOWN, buff=0.45)
        box = SurroundingRectangle(rec, color=ACCENT, buff=0.2, stroke_width=2)
        self.play(FadeIn(rec), Create(box), run_time=1.0)
        self.wait(2.5)
        self.play(FadeOut(Group(*self.mobjects)), run_time=0.6)
        self.wait(0.3)
