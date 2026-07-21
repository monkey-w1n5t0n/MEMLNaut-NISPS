// nisps/dsp/ratio_seq.hpp — ratio/Euclidean-style pulse-width sequencer gate.
//
// Given a bar-relative phasor and a small set of integer-ish ratios summing
// to `ratio_sum`, splits the bar into N unequal beats (proportional to each
// ratio) and returns whether the phasor currently sits within the first
// `pulse_width` fraction of its beat. Used by every ratio-sequencer engine
// to decide trigger (3 ratios) and accent/high-amp (2 ratios) gates.
//
// Extracted from the byte-for-byte-identical `ratio_seq<N>` template
// previously duplicated in nisps/engines/breakor.hpp and
// nisps/engines/memlcelium.hpp (2026-07 simplification audit, finding L8).
// NOTE: nisps/engines/elysiamorf.hpp does NOT use ratio_seq — it drives its
// tracks continuously via FM-pair oscillators (FMOp), not a ratio gate. The
// audit's finding text named breakor+elysiamorf as the ratio_seq duplicate;
// the actual duplicate pair is breakor+memlcelium (see MEMLCeliumEngine's
// private ratio_seq/ratio_seq_3/ratio_seq_2, out of this change's file
// ownership — a follow-up should point memlcelium.hpp at this header too).

#pragma once

#include <array>
#include <cstddef>

namespace nisps {

template <std::size_t N>
inline bool ratio_seq(float phasor, float ratio_sum,
                      const std::array<float, N>& ratios,
                      float pulse_width) noexcept {
    float offset_phase = phasor;
    if (offset_phase >= 1.f) offset_phase -= 1.f;
    const float phase_adj = ratio_sum * offset_phase;
    float accum = 0.f, last = 0.f;
    for (std::size_t i = 0u; i < N; ++i) {
        accum += ratios[i];
        if (phase_adj <= accum) {
            const float beat_phase = (phase_adj - last) / (accum - last);
            return beat_phase <= pulse_width;
        }
        last = accum;
    }
    return false;
}

}  // namespace nisps
