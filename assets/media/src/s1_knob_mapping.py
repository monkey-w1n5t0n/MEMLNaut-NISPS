"""Manifold explainer 1 — Knob = 1:1 mapping.

A knob rotates; a paired 0-1 number rises and falls in lockstep. The point: a
physical control is nothing more than a readout of one number.

Render:
    manim -qh s1_knob_mapping.py KnobMapping
"""

from manim import *

BG = "#1C1C1C"
PRIMARY = "#58C4DD"   # control side
NUMBER = "#83C167"    # the number / value side
ACCENT = "#FFFF00"    # the live value
DIM = 0.4
MONO = "Monospace"


def knob_group(value_tracker, radius=1.3):
    """A dial whose pointer angle tracks value in [0,1] over a 300 degree sweep."""
    start_ang = -150 * DEGREES   # bottom-left
    sweep = 300 * DEGREES

    face = Circle(radius=radius, color=PRIMARY, stroke_width=6)
    face.set_fill(PRIMARY, opacity=0.06)

    # the swept arc (the track the pointer travels along)
    track = Arc(radius=radius + 0.18, start_angle=start_ang, angle=sweep,
                color=PRIMARY, stroke_width=4).set_opacity(DIM)

    def make_pointer():
        ang = start_ang + value_tracker.get_value() * sweep
        tip = np.array([np.cos(ang), np.sin(ang), 0]) * (radius - 0.18)
        line = Line(ORIGIN, tip, color=ACCENT, stroke_width=8)
        return line

    pointer = always_redraw(make_pointer)
    hub = Dot(ORIGIN, radius=0.08, color=ACCENT)
    return VGroup(face, track), pointer, hub


class KnobMapping(Scene):
    def construct(self):
        self.camera.background_color = BG

        title = Text("A knob is just a number", font_size=44, color=PRIMARY,
                     weight=BOLD, font=MONO)
        self.play(Write(title), run_time=1.5)
        self.wait(1.0)
        self.play(title.animate.scale(0.62).to_edge(UP, buff=0.5), run_time=1.0)
        self.wait(0.3)

        val = ValueTracker(0.5)

        dial, pointer, hub = knob_group(val)
        dial.shift(LEFT * 3.2)
        pointer.shift(LEFT * 3.2)
        hub.shift(LEFT * 3.2)

        knob_label = Text("control", font_size=24, color=PRIMARY, font=MONO)
        knob_label.next_to(dial, DOWN, buff=0.4)

        self.play(Create(dial), FadeIn(hub), run_time=1.2)
        self.add(pointer)
        self.play(FadeIn(knob_label), run_time=0.8)
        self.wait(0.5)

        # the number side: a vertical 0-1 bar + live readout
        bar_h = 3.0
        bar = Rectangle(width=0.5, height=bar_h, color=NUMBER, stroke_width=4)
        bar.shift(RIGHT * 2.6)
        bar_bottom = bar.get_bottom()

        fill = always_redraw(lambda: Rectangle(
            width=0.5, height=max(1e-3, val.get_value() * bar_h),
            color=NUMBER, fill_color=NUMBER, fill_opacity=0.8, stroke_width=0,
        ).move_to(bar_bottom + UP * (val.get_value() * bar_h) / 2))

        tick0 = Text("0", font_size=20, color=NUMBER, font=MONO).next_to(bar, DL, buff=0.15)
        tick1 = Text("1", font_size=20, color=NUMBER, font=MONO).next_to(bar, UL, buff=0.15)

        readout = always_redraw(lambda: Text(
            f"{val.get_value():.2f}", font_size=40, color=ACCENT, font=MONO,
        ).next_to(bar, RIGHT, buff=0.5))

        num_label = Text("value", font_size=24, color=NUMBER, font=MONO)
        num_label.next_to(bar, DOWN, buff=0.55)

        # the binding arrow
        arrow = Arrow(dial.get_right() + RIGHT * 0.1, bar.get_left() + LEFT * 0.1,
                      color=WHITE, stroke_width=4, buff=0.2).set_opacity(DIM)

        self.play(Create(bar), FadeIn(tick0), FadeIn(tick1), run_time=1.0)
        self.add(fill, readout)
        self.play(GrowArrow(arrow), FadeIn(num_label), run_time=1.0)
        self.wait(1.0)

        bind = Text("they move in lockstep", font_size=26, color=WHITE, font=MONO)
        bind.to_edge(DOWN, buff=0.6)
        self.play(FadeIn(bind), run_time=0.8)
        self.wait(0.8)

        # sweep up, down, and to extremes -- pointer and number never disagree
        self.play(val.animate.set_value(1.0), run_time=2.0, rate_func=smooth)
        self.wait(0.8)
        self.play(val.animate.set_value(0.0), run_time=2.5, rate_func=smooth)
        self.wait(0.8)
        self.play(val.animate.set_value(0.73), run_time=1.5, rate_func=smooth)
        self.wait(1.5)

        self.play(FadeOut(Group(*self.mobjects)), run_time=0.6)
        self.wait(0.3)
