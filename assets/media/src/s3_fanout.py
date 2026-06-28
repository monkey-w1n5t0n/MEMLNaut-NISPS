"""Manifold explainer 3 — Dimensionality fan-out.

The same low-dimensional control drives N outputs (3, then 4, then 5), with a
small network in between. Shown for several control types: knob, fader, touchpad,
2-D joystick, 3-D joystick. Control on one side, N sliders on the other.

Render:
    manim -qh s3_fanout.py Fanout
"""

from manim import *

BG = "#1C1C1C"
PRIMARY = "#58C4DD"   # control
NET = "#FF6B6B"       # the network in the middle
OUT = "#83C167"       # outputs
ACCENT = "#FFFF00"
DIM = 0.4
MONO = "Monospace"


def mini_control(kind):
    """Return a small VGroup glyph + label for a control type, plus how many
    numbers it emits (its dimensionality)."""
    if kind == "knob":
        face = Circle(radius=0.55, color=PRIMARY, stroke_width=5)
        ptr = Line(ORIGIN, UP * 0.45, color=ACCENT, stroke_width=6).rotate(
            -40 * DEGREES, about_point=ORIGIN)
        g = VGroup(face, ptr, Dot(ORIGIN, radius=0.05, color=ACCENT))
        return g, "knob", 1
    if kind == "fader":
        track = Line(DOWN * 0.6, UP * 0.6, color=PRIMARY, stroke_width=5)
        cap = Rectangle(width=0.4, height=0.18, color=ACCENT, fill_color=ACCENT,
                        fill_opacity=1).move_to(UP * 0.15)
        return VGroup(track, cap), "fader", 1
    if kind == "touchpad":
        sq = Square(side_length=1.1, color=PRIMARY, stroke_width=5)
        sq.set_fill(PRIMARY, opacity=0.06)
        d = Dot(sq.get_center() + RIGHT * 0.25 + UP * 0.18, radius=0.09, color=WHITE)
        return VGroup(sq, d), "touchpad", 2
    if kind == "joystick2d":
        ring = Circle(radius=0.6, color=PRIMARY, stroke_width=5)
        stick = Line(ORIGIN, RIGHT * 0.3 + UP * 0.35, color=ACCENT, stroke_width=7)
        knob = Dot(RIGHT * 0.3 + UP * 0.35, radius=0.1, color=ACCENT)
        return VGroup(ring, stick, knob), "2-D joystick", 2
    if kind == "joystick3d":
        ring = Circle(radius=0.6, color=PRIMARY, stroke_width=5)
        stick = Line(ORIGIN, RIGHT * 0.28 + UP * 0.32, color=ACCENT, stroke_width=7)
        knob = Dot(RIGHT * 0.28 + UP * 0.32, radius=0.1, color=ACCENT)
        # a small twist arc to suggest the 3rd (rotational) axis
        twist = Arc(radius=0.78, start_angle=20 * DEGREES, angle=120 * DEGREES,
                    color=ACCENT, stroke_width=3).set_opacity(0.7)
        twist_tip = Triangle(color=ACCENT, fill_opacity=1).scale(0.06).move_to(
            twist.get_end())
        return VGroup(ring, stick, knob, twist, twist_tip), "3-D joystick", 3
    raise ValueError(kind)


class Fanout(Scene):
    def construct(self):
        self.camera.background_color = BG

        title = Text("One control, many outputs", font_size=44, color=PRIMARY,
                     weight=BOLD, font=MONO)
        self.play(Write(title), run_time=1.5)
        self.wait(1.0)
        self.play(title.animate.scale(0.6).to_edge(UP, buff=0.4), run_time=1.0)
        self.wait(0.3)

        # --- Part A: grow N (3 -> 4 -> 5) with a fixed 2-D control ---
        ctrl, ctrl_name, ndim = mini_control("touchpad")
        ctrl.scale(1.3).shift(LEFT * 4.5)
        ctrl_lab = Text(f"{ctrl_name} ({ndim} numbers)", font_size=22,
                        color=PRIMARY, font=MONO).next_to(ctrl, DOWN, buff=0.4)

        net = RoundedRectangle(width=1.4, height=2.4, corner_radius=0.15,
                               color=NET, stroke_width=4)
        net.set_fill(NET, opacity=0.08).shift(LEFT * 0.6)
        net_lab = Text("network", font_size=20, color=NET, font=MONO).next_to(
            net, DOWN, buff=0.3)

        self.play(FadeIn(ctrl), FadeIn(ctrl_lab), run_time=1.0)
        self.play(Create(net), FadeIn(net_lab), run_time=1.0)
        in_arrow = Arrow(ctrl.get_right(), net.get_left(), color=WHITE,
                         stroke_width=4, buff=0.25).set_opacity(DIM)
        self.play(GrowArrow(in_arrow), run_time=0.6)
        self.wait(0.5)

        def make_sliders(n):
            grp = VGroup()
            top = 1.9
            gap = 3.8 / max(1, n - 1) if n > 1 else 0
            for i in range(n):
                y = top - i * gap if n > 1 else 0
                t = Line(ORIGIN, RIGHT * 2.0, color=OUT, stroke_width=4).set_opacity(DIM)
                t.move_to(RIGHT * 3.7 + UP * y)
                frac = 0.5 + 0.4 * np.sin(i * 1.3 + n)
                fill = Line(t.get_start(), t.get_start() + RIGHT * 2.0 * frac,
                            color=OUT, stroke_width=4)
                knob = Dot(t.get_start() + RIGHT * 2.0 * frac, radius=0.1, color=OUT)
                lab = Text(f"out {i+1}", font_size=16, color=OUT, font=MONO).next_to(
                    t, LEFT, buff=0.2)
                grp.add(VGroup(t, fill, knob, lab))
            return grp

        counter = Text("3 outputs", font_size=26, color=OUT, font=MONO).to_edge(
            DOWN, buff=0.55)

        sliders = make_sliders(3)
        fan = VGroup(*[Line(net.get_right(), s[0].get_left(), color=NET,
                            stroke_width=2).set_opacity(0.5) for s in sliders])
        self.play(Create(sliders), Create(fan), FadeIn(counter), run_time=1.2)
        self.wait(1.2)

        for n in (4, 5):
            new_sliders = make_sliders(n)
            new_fan = VGroup(*[Line(net.get_right(), s[0].get_left(), color=NET,
                              stroke_width=2).set_opacity(0.5) for s in new_sliders])
            new_counter = Text(f"{n} outputs", font_size=26, color=OUT,
                               font=MONO).to_edge(DOWN, buff=0.55)
            self.play(
                ReplacementTransform(sliders, new_sliders),
                ReplacementTransform(fan, new_fan),
                ReplacementTransform(counter, new_counter),
                run_time=1.3)
            sliders, fan, counter = new_sliders, new_fan, new_counter
            self.wait(1.0)

        self.wait(0.5)
        # clear the output side + counter, keep the network, swap the control type
        self.play(FadeOut(sliders), FadeOut(fan), FadeOut(counter),
                  FadeOut(ctrl), FadeOut(ctrl_lab), run_time=0.6)

        # --- Part B: cycle control types into the same network -> 5 outputs ---
        note = Text("...and any control feeds the same fan-out",
                    font_size=24, color=WHITE, font=MONO).to_edge(DOWN, buff=0.55)
        self.play(FadeIn(note), run_time=0.6)

        five = make_sliders(5)
        five_fan = VGroup(*[Line(net.get_right(), s[0].get_left(), color=NET,
                          stroke_width=2).set_opacity(0.5) for s in five])
        self.play(Create(five), Create(five_fan), run_time=0.8)

        prev_ctrl = None
        prev_lab = None
        for kind in ("knob", "fader", "touchpad", "joystick2d", "joystick3d"):
            g, name, nd = mini_control(kind)
            g.scale(1.3).shift(LEFT * 4.5)
            lab = Text(f"{name} ({nd} number{'s' if nd > 1 else ''})",
                       font_size=22, color=PRIMARY, font=MONO).next_to(
                g, DOWN, buff=0.4)
            if prev_ctrl is None:
                self.play(FadeIn(g), FadeIn(lab), run_time=0.7)
            else:
                self.play(ReplacementTransform(prev_ctrl, g),
                          ReplacementTransform(prev_lab, lab), run_time=0.9)
            prev_ctrl, prev_lab = g, lab
            self.wait(0.9)

        self.wait(1.2)
        self.play(FadeOut(Group(*self.mobjects)), run_time=0.6)
        self.wait(0.3)
