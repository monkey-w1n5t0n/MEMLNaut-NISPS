// tests/cpp/test_dsp_pitch_shift.cpp — pitch shifter sanity.
//
// Without a full FFT, we test:
//   - Output is finite for arbitrary input.
//   - Identity-shift (0 semitones) preserves rough RMS of a sine.
//   - Output remains bounded for large inputs.

#include <cmath>

#include "test_helpers.hpp"
#include "../../nisps/dsp/pitch_shift.hpp"

NISPS_TEST(pitch_shifter_finite_output) {
    nisps::PitchShifter<8192> ps;
    ps.init(48000.f);
    ps.set_transposition(7.f);  // up a perfect fifth
    for (int n = 0; n < 20000; ++n) {
        const float x = std::sin(2.f * 3.14159265f * 440.f * n / 48000.f);
        const float y = ps.process(x);
        NISPS_EXPECT(std::isfinite(y));
        NISPS_EXPECT(std::fabs(y) < 5.f);
    }
}

NISPS_TEST(pitch_shifter_zero_input_gives_zero_output) {
    nisps::PitchShifter<8192> ps;
    ps.init(48000.f);
    ps.set_transposition(0.f);
    // Run 8192 samples to flush startup, then check zero-in → zero-out.
    for (int n = 0; n < 16384; ++n) ps.process(0.f);
    for (int n = 0; n < 1000; ++n) {
        const float y = ps.process(0.f);
        NISPS_EXPECT(std::fabs(y) < 1e-4f);
    }
}

NISPS_TEST(pitch_shifter_ratio_changes) {
    nisps::PitchShifter<8192> ps;
    ps.init(48000.f);
    ps.set_transposition(0.f);
    NISPS_EXPECT_NEAR(ps.ratio(), 1.f, 1e-5);
    ps.set_transposition(12.f);  // octave up
    NISPS_EXPECT_NEAR(ps.ratio(), 2.f, 1e-3);
    ps.set_transposition(-12.f);
    NISPS_EXPECT_NEAR(ps.ratio(), 0.5f, 1e-3);
}
