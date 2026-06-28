"""Manifold explainer 2 — XY pad projects to two numbers.

A 2-D pad is two independent 0-1 readings. Moving the dot moves A (horizontal)
and B (vertical) independently, each shown as a slider.

Render:
    manim -qh s2_xy_pad.py XYPad
"""

from manim import *

BG = "#1C1C1C"
PRIMARY = "#58C4DD"   # pad / control
A_COL = "#FFFF00"     # A axis (horizontal)
B_COL = "#83C167"     # B axis (vertical)
DIM = 0.4
MONO = "Monospace"


def slider(value_tracker, length, colour, horizontal=True):
    """A track + a knob that tracks value in [0,1] along `length`."""
    if horizontal:
        track = Line(LEFT * length / 2, RIGHT * length / 2, color=colour,
                     stroke_width=5).set_opacity(DIM)
        knob = always_redraw(lambda: Dot(
            track.get_start() + RIGHT * value_tracker.get_value() * length,
            radius=0.13, color=colour))
        fill = always_redraw(lambda: Line(
            track.get_start(),
            track.get_start() + RIGHT * value_tracker.get_value() * length,
            color=colour, stroke_width=5))
    else:
        track = Line(DOWN * length / 2, UP * length / 2, color=colour,
                     stroke_width=5).set_opacity(DIM)
        knob = always_redraw(lambda: Dot(
            track.get_start() + UP * value_tracker.get_value() * length,
            radius=0.13, color=colour))
        fill = always_redraw(lambda: Line(
            track.get_start(),
            track.get_start() + UP * value_tracker.get_value() * length,
            color=colour, stroke_width=5))
    return VGroup(track), fill, knob


class XYPad(Scene):
    def construct(self):
        self.camera.background_color = BG

        title = Text("One pad, two numbers", font_size=44, color=PRIMARY,
                     weight=BOLD, font=MONO)
        self.play(Write(title), run_time=1.5)
        self.wait(1.0)
        self.play(title.animate.scale(0.62).to_edge(UP, buff=0.5), run_time=1.0)
        self.wait(0.3)

        # the pad
        side = 3.4
        ax = ValueTracker(0.5)
        bx = ValueTracker(0.5)

        pad = Square(side_length=side, color=PRIMARY, stroke_width=5)
        pad.set_fill(PRIMARY, opacity=0.05)
        pad.shift(LEFT * 3.0)
        bl = pad.get_corner(DL)

        grid = VGroup()
        for f in (0.25, 0.5, 0.75):
            grid.add(Line(bl + RIGHT * f * side, bl + RIGHT * f * side + UP * side,
                          color=PRIMARY, stroke_width=1).set_opacity(0.15))
            grid.add(Line(bl + UP * f * side, bl + UP * f * side + RIGHT * side,
                          color=PRIMARY, stroke_width=1).set_opacity(0.15))

        dot = always_redraw(lambda: Dot(
            bl + RIGHT * ax.get_value() * side + UP * bx.get_value() * side,
            radius=0.13, color=WHITE))

        # guide lines from the dot to each axis
        vline = always_redraw(lambda: DashedLine(
            bl + RIGHT * ax.get_value() * side,
            bl + RIGHT * ax.get_value() * side + UP * bx.get_value() * side,
            color=A_COL, stroke_width=2).set_opacity(DIM))
        hline = always_redraw(lambda: DashedLine(
            bl + UP * bx.get_value() * side,
            bl + RIGHT * ax.get_value() * side + UP * bx.get_value() * side,
            color=B_COL, stroke_width=2).set_opacity(DIM))

        self.play(Create(pad), Create(grid), run_time=1.2)
        self.add(dot)
        pad_label = Text("XY pad", font_size=24, color=PRIMARY, font=MONO)
        pad_label.next_to(pad, DOWN, buff=0.4)
        self.play(FadeIn(pad_label), run_time=0.6)
        self.wait(0.5)
        self.add(vline, hline)

        # A slider (horizontal) and B slider (vertical) on the right
        a_track, a_fill, a_knob = slider(ax, 3.0, A_COL, horizontal=True)
        a_group = VGroup(a_track, a_fill, a_knob)
        a_group.shift(RIGHT * 3.0 + UP * 1.4)
        a_lab = always_redraw(lambda: Text(
            f"A = {ax.get_value():.2f}", font_size=28, color=A_COL, font=MONO
        ).next_to(a_track, UP, buff=0.3))

        b_track, b_fill, b_knob = slider(bx, 3.0, B_COL, horizontal=False)
        b_group = VGroup(b_track, b_fill, b_knob)
        b_group.shift(RIGHT * 3.6 + DOWN * 1.4)
        b_lab = always_redraw(lambda: Text(
            f"B = {bx.get_value():.2f}", font_size=28, color=B_COL, font=MONO
        ).next_to(b_track, RIGHT, buff=0.4))

        self.play(Create(a_track), Create(b_track), run_time=1.0)
        self.add(a_fill, a_knob, a_lab, b_fill, b_knob, b_lab)
        self.wait(0.5)

        note = Text("A reads across, B reads up -- independently",
                    font_size=24, color=WHITE, font=MONO).to_edge(DOWN, buff=0.55)
        self.play(FadeIn(note), run_time=0.8)
        self.wait(1.0)

        # move horizontally only: A changes, B holds
        self.play(ax.animate.set_value(0.9), run_time=1.6, rate_func=smooth)
        self.wait(0.6)
        # move vertically only: B changes, A holds
        self.play(bx.animate.set_value(0.85), run_time=1.6, rate_func=smooth)
        self.wait(0.6)
        # a diagonal sweep: both change together
        self.play(ax.animate.set_value(0.15), bx.animate.set_value(0.2),
                  run_time=2.0, rate_func=smooth)
        self.wait(0.6)
        self.play(ax.animate.set_value(0.65), bx.animate.set_value(0.7),
                  run_time=1.6, rate_func=smooth)
        self.wait(1.5)

        self.play(FadeOut(Group(*self.mobjects)), run_time=0.6)
        self.wait(0.3)
