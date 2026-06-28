// tests/cpp/test_mode_learning.cpp — ModeBase adaptive-learning wiring,
// exercised through SLPWorkshopMode.
//
//   - inert parity: with Jolt inactive and OU disabled (the defaults),
//     SLPWorkshopMode is bit-identical to MEMLCeliumMode (same engine, same
//     MLP shape, same seed) — proving the new gestures don't perturb the
//     baseline mapping.
//   - Jolt: pressing it morphs the network weights over successive control
//     ticks and gates the LR (0 while held, ramps back after release).
//   - OU explore: intensity round-trips, toggles enabled state, and keeps
//     audio finite.

#include <array>
#include <cmath>
#include <cstdint>

#include "test_helpers.hpp"

#include "../../nisps/core/types.hpp"
#include "../../nisps/modes/memlcelium.hpp"
#include "../../nisps/modes/slp_workshop.hpp"

using namespace nisps;

NISPS_TEST(slp_workshop_inert_equals_memlcelium) {
    modes::MEMLCeliumMode a(123ull);
    modes::SLPWorkshopMode b(123ull);
    a.setup(48000.f);
    b.setup(48000.f);

    for (int t = 0; t < 8; ++t) {
        const float x = 0.3f + 0.05f * static_cast<float>(t);
        a.set_input(0, x);
        a.set_input(1, 0.6f);
        b.set_input(0, x);
        b.set_input(1, 0.6f);
        a.tick_control();
        b.tick_control();
        for (int s = 0; s < 32; ++s) {
            const stereosample_t za{0.f, 0.f};
            const stereosample_t zb{0.f, 0.f};
            const auto oa = a.process(za);
            const auto ob = b.process(zb);
            NISPS_EXPECT(oa.L == ob.L);
            NISPS_EXPECT(oa.R == ob.R);
        }
    }
}

NISPS_TEST(slp_workshop_jolt_morphs_weights_and_gates_lr) {
    using ML = modes::SLPWorkshopMode::ML;
    modes::SLPWorkshopMode m(5ull);
    m.setup(48000.f);

    std::array<float, ML::weight_count()> before{};
    {
        auto w = m.ml().get_weights();
        for (std::size_t i = 0; i < w.size(); ++i) before[i] = w[i];
    }

    NISPS_EXPECT(!m.jolt_active());
    NISPS_EXPECT(m.jolt_lr_scale() == 1.f);

    m.jolt_press();
    NISPS_EXPECT(m.jolt_active());
    NISPS_EXPECT(m.jolt_lr_scale() == 0.f);

    for (int t = 0; t < 100; ++t) m.tick_control();

    int changed = 0;
    {
        auto w = m.ml().get_weights();
        for (std::size_t i = 0; i < w.size(); ++i) {
            if (before[i] != w[i]) ++changed;
        }
    }
    NISPS_EXPECT(changed > 0);

    m.jolt_release();
    NISPS_EXPECT(!m.jolt_active());
    for (int t = 0; t < 2000; ++t) m.tick_control();  // ramps LR back to full
    NISPS_EXPECT_NEAR(m.jolt_lr_scale(), 1.f, 1e-6);
}

NISPS_TEST(slp_workshop_explore_intensity_roundtrip_finite) {
    modes::SLPWorkshopMode m(9ull);
    m.setup(48000.f);

    NISPS_EXPECT(!m.ou_noise().enabled());
    m.set_explore_intensity(0.5f);
    NISPS_EXPECT(m.ou_noise().enabled());
    NISPS_EXPECT_NEAR(m.explore_intensity(), 0.5f, 1e-6);

    for (int t = 0; t < 8; ++t) {
        m.tick_control();
        for (int s = 0; s < 16; ++s) {
            const auto o = m.process(stereosample_t{0.f, 0.f});
            NISPS_EXPECT(std::isfinite(o.L) && std::isfinite(o.R));
        }
    }

    m.set_explore_intensity(0.f);
    NISPS_EXPECT(!m.ou_noise().enabled());
}
