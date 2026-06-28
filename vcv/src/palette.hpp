// palette.hpp — MEMLNaut ring colours, hand-synced from the frontend tokens.
//
// Source of truth: docs/redesign/manifold-export/tokens/colors.css. These are
// the exact hex values from that file, so the VCV module's LED rings read as the
// same instrument as the Manifold browser front-end. If a token changes there,
// update the matching constant here (small hand-sync; see SPEC delta #3).
//
// The 16 output rings are assigned across the design-token accents + group/pin
// colours as a clean orange→cyan-anchored ramp, so outputs in the same mode
// group glow the same colour as the browser heatmap/Console grouping.
#pragma once

#include <rack.hpp>

namespace memlnaut {
namespace palette {

// ── Design tokens (colors.css) ────────────────────────────────────────
inline NVGcolor accent()   { return nvgRGB(0xff, 0x6a, 0x00); } // --accent   warm primary
inline NVGcolor accent2()  { return nvgRGB(0x00, 0xcc, 0xff); } // --accent-2 cool secondary
inline NVGcolor accent3()  { return nvgRGB(0xff, 0xa8, 0x60); } // --accent-3 warm hover/tint
inline NVGcolor good()     { return nvgRGB(0x6b, 0xc2, 0x6b); } // --good
inline NVGcolor warn()     { return nvgRGB(0xf5, 0xc4, 0x5e); } // --warn
inline NVGcolor info()     { return nvgRGB(0x5b, 0x9e, 0xef); } // --info
inline NVGcolor pin3()     { return nvgRGB(0xb4, 0x64, 0xff); } // --pin-3 base (violet)
inline NVGcolor danger()   { return nvgRGB(0xff, 0x44, 0x66); } // --danger (bipolar / perturbed)
inline NVGcolor bgTrack()  { return nvgRGB(0x24, 0x24, 0x24); } // --bg-3 (ring track)

// ── 16-ring palette ───────────────────────────────────────────────────
// Groups cycle through the token accents/group colours. Outputs 0..15 read as a
// coherent orange→cyan family with the semantic accents woven in.
inline NVGcolor ring(int outIdx) {
    static const NVGcolor kRing[16] = {
        // group 0 — formant/primary (orange family)
        nvgRGB(0xff, 0x6a, 0x00), nvgRGB(0xff, 0x82, 0x2a), nvgRGB(0xff, 0xa8, 0x60), nvgRGB(0xff, 0xc4, 0x90),
        // group 1 — amp (green)
        nvgRGB(0x6b, 0xc2, 0x6b), nvgRGB(0x86, 0xcf, 0x86),
        // group 2 — filter (amber/warn)
        nvgRGB(0xf5, 0xc4, 0x5e), nvgRGB(0xf8, 0xd4, 0x84),
        // group 3 — mod (violet/pin-3)
        nvgRGB(0xb4, 0x64, 0xff), nvgRGB(0xc6, 0x86, 0xff),
        // group 4 — fx (blue/info)
        nvgRGB(0x5b, 0x9e, 0xef), nvgRGB(0x82, 0xb6, 0xf3),
        // group 5 — pitch/data (cyan family → accent-2)
        nvgRGB(0x3a, 0xd0, 0xf0), nvgRGB(0x1d, 0xce, 0xf7), nvgRGB(0x00, 0xcc, 0xff), nvgRGB(0x55, 0xdd, 0xff),
    };
    if (outIdx < 0) outIdx = 0;
    return kRing[outIdx % 16];
}

} // namespace palette
} // namespace memlnaut
