// tests/cpp/test_dsp_biquad.cpp — sanity-check Biquad responses.
//
// We avoid a full H(z) check (would need an FFT) and instead test:
//   - Lowpass at 100 Hz blocks 10 kHz: an impulse response decays.
//   - Highpass at 10 kHz blocks 100 Hz: feeding 100 Hz sine yields tiny RMS.
//   - Coefficients are stable (no NaN/Inf) at the edges.

#include <cmath>

#include "test_helpers.hpp"
#include "../../nisps/dsp/biquad.hpp"

NISPS_TEST(biquad_lowpass_blocks_high_freq) {
    nisps::Biquad bq(48000.f);
    bq.set(nisps::Biquad::Type::LowPass, 200.f, 0.707f, 0.f);
    // Drive a 10 kHz sine; output amplitude should be much smaller than input.
    const float freq = 10000.f;
    float in_rms = 0.f, out_rms = 0.f;
    for (int n = 0; n < 4800; ++n) {
        const float x = std::sin(2.f * 3.14159265f * freq * n / 48000.f);
        const float y = bq.play(x);
        in_rms  += x * x;
        out_rms += y * y;
    }
    NISPS_EXPECT(out_rms < in_rms * 0.05f);  // at least ~13 dB attenuation
}

NISPS_TEST(biquad_highpass_blocks_low_freq) {
    nisps::Biquad bq(48000.f);
    bq.set(nisps::Biquad::Type::HighPass, 5000.f, 0.707f, 0.f);
    const float freq = 100.f;
    float in_rms = 0.f, out_rms = 0.f;
    for (int n = 0; n < 4800; ++n) {
        const float x = std::sin(2.f * 3.14159265f * freq * n / 48000.f);
        const float y = bq.play(x);
        in_rms  += x * x;
        out_rms += y * y;
    }
    NISPS_EXPECT(out_rms < in_rms * 0.05f);
}

NISPS_TEST(biquad_peak_finite_output) {
    nisps::Biquad bq(48000.f);
    bq.set(nisps::Biquad::Type::Peak, 1000.f, 1.0f, 6.f);
    for (int n = 0; n < 1000; ++n) {
        const float y = bq.play(1.f);
        NISPS_EXPECT(std::isfinite(y));
    }
}

NISPS_TEST(biquad_lowshelf_finite) {
    nisps::Biquad bq(48000.f);
    bq.set(nisps::Biquad::Type::LowShelf, 100.f, 0.707f, 6.f);
    for (int n = 0; n < 1000; ++n) {
        const float y = bq.play(0.5f);
        NISPS_EXPECT(std::isfinite(y));
    }
}

NISPS_TEST(biquad_setup_then_set) {
    nisps::Biquad bq;
    bq.setup(48000.f);
    bq.set(nisps::Biquad::Type::HighShelf, 8000.f, 0.707f, -6.f);
    for (int n = 0; n < 100; ++n) {
        const float y = bq.play(1.f);
        NISPS_EXPECT(std::isfinite(y));
    }
}
