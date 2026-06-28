// LedRing.hpp — Custom LED-ring widget encircling each output jack.
//
// The arc fills clockwise from 12 o'clock in proportion to the output's value
// (0..1 → 0..2π) and is drawn on drawLayer() layer 1 (so it stays bright when
// room brightness is lowered, per the VCV custom-light convention). A dim track
// ring sits underneath. Colour comes from the frontend design tokens
// (palette.hpp) so the module matches the browser.
//
// Templated on the module type so it can read the per-output value without a
// hard include cycle; MEMLNaut.cpp instantiates LedRingWidget<MEMLNaut>.
#pragma once

#include <rack.hpp>
#include "palette.hpp"

using namespace rack;

template<typename TModule>
struct LedRingWidget : Widget {
    TModule* module = nullptr;
    int outIdx = 0;
    NVGcolor ringColor = memlnaut::palette::accent();
    float radius = 9.f; // px around a PJ301M jack

    LedRingWidget() {
        // Box large enough to host the ring around a ~22px jack.
        box.size = Vec(radius * 2.f + 6.f, radius * 2.f + 6.f);
    }

    float valueOf() const {
        if (!module) return 0.f;
        return clamp(module->ringValue(outIdx), 0.f, 1.f);
    }

    void drawLayer(const DrawArgs& args, int layer) override {
        if (layer != 1) {
            Widget::drawLayer(args, layer);
            return;
        }
        float v = valueOf();
        Vec c = box.size.div(2.f);
        const float start = -M_PI / 2.f;            // 12 o'clock
        const float end   = start + 2.f * M_PI;     // full circle

        // Dim track ring (full circle).
        nvgBeginPath(args.vg);
        nvgArc(args.vg, c.x, c.y, radius, start, end, NVG_CW);
        nvgStrokeColor(args.vg, nvgRGBA((unsigned char)(ringColor.r * 255),
                                        (unsigned char)(ringColor.g * 255),
                                        (unsigned char)(ringColor.b * 255), 40));
        nvgStrokeWidth(args.vg, 1.4f);
        nvgStroke(args.vg);

        // Proportional value arc.
        if (v > 0.001f) {
            nvgBeginPath(args.vg);
            nvgArc(args.vg, c.x, c.y, radius, start, start + v * 2.f * M_PI, NVG_CW);
            nvgStrokeColor(args.vg, ringColor);
            nvgStrokeWidth(args.vg, 1.9f);
            nvgLineCap(args.vg, NVG_ROUND);
            nvgStroke(args.vg);

            // Soft glow halo — the frontend "glow not shadow" signature.
            nvgGlobalCompositeOperation(args.vg, NVG_LIGHTER);
            nvgBeginPath(args.vg);
            nvgArc(args.vg, c.x, c.y, radius, start, start + v * 2.f * M_PI, NVG_CW);
            nvgStrokeColor(args.vg, nvgRGBAf(ringColor.r, ringColor.g, ringColor.b, 0.25f * v));
            nvgStrokeWidth(args.vg, 4.0f);
            nvgStroke(args.vg);
            nvgGlobalCompositeOperation(args.vg, NVG_SOURCE_OVER);
        }

        Widget::drawLayer(args, layer);
    }
};
