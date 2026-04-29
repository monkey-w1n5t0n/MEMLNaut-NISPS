// tests/cpp/test_mode_paf_synth.cpp — exercise the PAFSynthMode end-to-end:
// setup → set_input → tick_control (ML inference + voice space mapping) →
// process audio → verify output is bounded and non-trivial after note_on.

#include <array>
#include <cmath>

#include "test_helpers.hpp"
#include "../../nisps/modes/paf_synth.hpp"

using nisps::modes::PAFSynthMode;

NISPS_TEST(paf_synth_mode_setup_and_idle_process) {
    PAFSynthMode m;
    m.setup(48000.f);

    // After setup the engine should already have its default params set;
    // process() is safe to call and must produce finite samples.
    for (int n = 0; n < 256; ++n) {
        const auto y = m.process({0.f, 0.f});
        NISPS_EXPECT(std::isfinite(y.L));
        NISPS_EXPECT(std::isfinite(y.R));
    }
}

NISPS_TEST(paf_synth_mode_tick_control_changes_outputs) {
    PAFSynthMode m;
    m.setup(48000.f);

    // Capture an outputs snapshot, then change inputs and tick again.
    std::array<float, 33> before{};
    {
        const auto outs = m.ml().outputs();
        for (std::size_t i = 0u; i < outs.size(); ++i) before[i] = outs[i];
    }

    m.set_input(0, 0.0f);
    m.set_input(1, 1.0f);
    m.set_input(2, 0.25f);
    m.set_input(3, 0.75f);
    m.tick_control();

    bool any_changed = false;
    {
        const auto outs = m.ml().outputs();
        for (std::size_t i = 0u; i < outs.size(); ++i) {
            if (std::fabs(outs[i] - before[i]) > 1e-6f) { any_changed = true; break; }
        }
    }
    NISPS_EXPECT(any_changed);

    // All outputs of the sigmoid layer remain in [0, 1].
    for (float v : m.ml().outputs()) {
        NISPS_EXPECT(v >= 0.f && v <= 1.f);
    }
}

NISPS_TEST(paf_synth_mode_note_produces_audio) {
    PAFSynthMode m;
    m.setup(48000.f);
    m.set_input(0, 0.5f);
    m.set_input(1, 0.5f);
    m.tick_control();

    m.note_on(60u, 100u);

    float energy = 0.f;
    for (int n = 0; n < 4800; ++n) {
        const auto y = m.process({0.f, 0.f});
        NISPS_EXPECT(std::isfinite(y.L));
        // Tanh saturation guarantees |y| < 2.
        NISPS_EXPECT(std::fabs(y.L) < 2.f);
        energy += y.L * y.L;
    }
    NISPS_EXPECT(energy > 0.f);

    m.note_off(60u);
}

NISPS_TEST(paf_synth_mode_input_clamping) {
    PAFSynthMode m;
    m.setup(48000.f);
    m.set_input(0, -10.f);
    m.set_input(1,  10.f);
    NISPS_EXPECT(m.input_channels()[0] == 0.f);
    NISPS_EXPECT(m.input_channels()[1] == 1.f);
    // Out-of-range index is silently dropped.
    m.set_input(99u, 0.5f);
}

NISPS_TEST(paf_synth_mode_engine_and_ml_accessors) {
    PAFSynthMode m;
    m.setup(48000.f);
    auto& e = m.engine();
    auto& ml = m.ml();
    NISPS_EXPECT(e.engine_id() == "paf_synth");
    // MLP::process() must be callable directly via the accessor.
    ml.set_input(0u, 0.3f);
    ml.process();
    NISPS_EXPECT(ml.outputs().size() == 33u);
}
