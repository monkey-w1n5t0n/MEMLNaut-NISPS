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

NISPS_TEST(paf_synth_mode_pinned_inputs_neutralized) {
    // Single-joystick mode pins the second 2D controller's channels (2,3).
    // A pinned channel must feed the neutral pin value (default 0.5) to the
    // MLP regardless of its live value, and pinning must not resize the model.
    PAFSynthMode m;
    m.setup(48000.f);
    NISPS_EXPECT(m.pin_value() == 0.5f);

    // Reference: channels 2,3 driven live to 0.5 (the neutral value).
    m.set_input(0, 0.2f);
    m.set_input(1, 0.8f);
    m.set_input(2, 0.5f);
    m.set_input(3, 0.5f);
    m.tick_control();
    std::array<float, 33> ref{};
    {
        const auto outs = m.ml().outputs();
        for (std::size_t i = 0u; i < outs.size(); ++i) ref[i] = outs[i];
    }

    // Pin channels 2,3, then drive them to arbitrary values. Output must match
    // the reference (they are neutralized to 0.5).
    m.set_input_pinned(2, true);
    m.set_input_pinned(3, true);
    NISPS_EXPECT(m.is_input_pinned(2));
    m.set_input(2, 0.0f);
    m.set_input(3, 1.0f);
    m.tick_control();
    for (std::size_t i = 0u; i < 33u; ++i) {
        NISPS_EXPECT(std::fabs(m.ml().outputs()[i] - ref[i]) < 1e-6f);
    }

    // The active controller (channels 0,1) still affects the output.
    m.set_input(0, 0.9f);
    m.tick_control();
    bool changed = false;
    for (std::size_t i = 0u; i < 33u; ++i) {
        if (std::fabs(m.ml().outputs()[i] - ref[i]) > 1e-6f) { changed = true; break; }
    }
    NISPS_EXPECT(changed);

    // Unpinning restores sensitivity on channels 2,3.
    m.set_input_pinned(2, false);
    m.set_input_pinned(3, false);
    m.set_input(0, 0.2f);  // restore active channels to the reference pose
    m.set_input(1, 0.8f);
    m.set_input(2, 0.0f);
    m.set_input(3, 1.0f);
    m.tick_control();
    bool differs = false;
    for (std::size_t i = 0u; i < 33u; ++i) {
        if (std::fabs(m.ml().outputs()[i] - ref[i]) > 1e-6f) { differs = true; break; }
    }
    NISPS_EXPECT(differs);
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
