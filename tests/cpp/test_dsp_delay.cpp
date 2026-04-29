// tests/cpp/test_dsp_delay.cpp — verify delay-line tap timing.

#include "test_helpers.hpp"
#include "../../nisps/dsp/delay.hpp"

NISPS_TEST(delay_outputs_zero_before_first_full_cycle) {
    nisps::Delay<128> dl;
    // First N samples (with size=64) should output zeros, since memory
    // starts at zero.
    for (int n = 0; n < 64; ++n) {
        const float y = dl.play(1.f, 64u, 0.f);
        NISPS_EXPECT(y == 0.f);
    }
}

NISPS_TEST(delay_recovers_input_after_size_samples) {
    nisps::Delay<128> dl;
    // Feed an impulse, then zeros. Read should produce the impulse 64
    // samples later.
    dl.play(1.f, 64u, 0.f);
    float impulse_seen_at = -1.f;
    for (int n = 1; n < 70; ++n) {
        const float y = dl.play(0.f, 64u, 0.f);
        if (y > 0.5f && impulse_seen_at < 0.f) {
            impulse_seen_at = static_cast<float>(n);
        }
    }
    // Should appear ~63 samples after the impulse was written.
    NISPS_EXPECT(impulse_seen_at >= 60.f && impulse_seen_at <= 67.f);
}

NISPS_TEST(dynamic_delay_smoothes_and_reads) {
    nisps::DynamicDelay<128> dd;
    dd.set_smooth_coeff(0.5f);
    for (int n = 0; n < 200; ++n) {
        dd.write(static_cast<float>(n));
        const float r = dd.read(50.f);
        NISPS_EXPECT(std::isfinite(r));
    }
}

NISPS_TEST(delay_clear_resets_buffer) {
    nisps::Delay<64> dl;
    for (int n = 0; n < 32; ++n) dl.play(0.5f, 32u, 0.f);
    dl.clear();
    for (int n = 0; n < 32; ++n) {
        const float y = dl.play(0.f, 32u, 0.f);
        NISPS_EXPECT(y == 0.f);
    }
}
