// tests/cpp/test_pipeline.cpp — nisps/pipeline input+output chains
// (one-core-engine P4). Unit semantics; the fixture regression against the
// pre-migration TS goldens runs browser-side (manifold pipeline-golden test
// flipped onto the WASM build), and native↔WASM agreement is parity stage 7.

#include <array>
#include <cmath>
#include <cstdint>
#include <span>

#include "../../nisps/core/math.hpp"
#include "../../nisps/pipeline/input_chain.hpp"
#include "../../nisps/pipeline/output_chain.hpp"
#include "test_helpers.hpp"

namespace {

using nisps::pipeline::AnchorMode;
using nisps::pipeline::InputChain;
using nisps::pipeline::InputChainConfig;
using nisps::pipeline::MomentumMode;
using nisps::pipeline::OutputChain;
using nisps::pipeline::OutputChainConfig;

constexpr float kDt = 1.f / 120.f;

}  // namespace

// -- input chain ----------------------------------------------------------------

NISPS_TEST(input_chain_identity_default) {
    InputChain ch;
    const auto r = ch.process(0.3f, 0.8f, kDt);
    NISPS_EXPECT(!r.frozen);
    NISPS_EXPECT_NEAR(r.x, 0.3f, 1e-6);
    NISPS_EXPECT_NEAR(r.y, 0.8f, 1e-6);
}

NISPS_TEST(input_chain_deadzone_remap) {
    InputChain ch;
    InputChainConfig c;
    c.deadzone = 0.2f;  // half-dz 0.1 around 0.5
    ch.set_config(c);
    // Inside the deadzone → pinned to centre.
    NISPS_EXPECT_NEAR(ch.process(0.55f, 0.5f, kDt).x, 0.5f, 1e-6);
    // Live-zone endpoints preserved.
    NISPS_EXPECT_NEAR(ch.process(1.f, 0.5f, kDt).x, 1.f, 1e-6);
    NISPS_EXPECT_NEAR(ch.process(0.f, 0.5f, kDt).x, 0.f, 1e-6);
    // Just outside the deadzone remaps continuously from centre.
    const float just = ch.process(0.6f + 1e-3f, 0.5f, kDt).x;
    NISPS_EXPECT(just > 0.5f && just < 0.52f);
}

NISPS_TEST(input_chain_circular_clamp) {
    InputChain ch;
    // A corner (1,1) is outside the unit disk around (0.5,0.5) → clamped to
    // the rim, direction preserved.
    const auto r = ch.process(1.f, 1.f, kDt);
    const float cx = r.x - 0.5f;
    const float cy = r.y - 0.5f;
    NISPS_EXPECT_NEAR(std::sqrt(cx * cx + cy * cy), 0.5f, 1e-5);
    NISPS_EXPECT_NEAR(cx, cy, 1e-6);
}

NISPS_TEST(input_chain_zoom_and_freeze) {
    InputChain ch;
    InputChainConfig c;
    c.zoom = 0.5f;  // half window around the centre anchor
    ch.set_config(c);
    NISPS_EXPECT_NEAR(ch.process(1.f, 0.5f, kDt).x, 0.75f, 1e-6);
    NISPS_EXPECT_NEAR(ch.process(0.f, 0.5f, kDt).x, 0.25f, 1e-6);

    // Zoom at the freeze threshold: holds the last smoothed value.
    ch.process(0.75f, 0.25f, kDt);  // establish state (0.625, 0.375)
    c.zoom = 0.01f;
    ch.set_config(c);
    const auto frozen = ch.process(0.f, 1.f, kDt);
    NISPS_EXPECT(frozen.frozen);
    NISPS_EXPECT_NEAR(frozen.x, 0.625f, 1e-5);
    NISPS_EXPECT_NEAR(frozen.y, 0.375f, 1e-5);
}

NISPS_TEST(input_chain_sticky_anchor) {
    InputChain ch;
    InputChainConfig c;
    c.zoom = 0.2f;
    c.anchor_mode = AnchorMode::Sticky;
    c.anchor_x = 0.8f;
    c.anchor_y = 0.2f;
    ch.set_config(c);
    const auto r = ch.process(0.5f, 0.5f, kDt);  // centred stick → exactly the anchor
    NISPS_EXPECT_NEAR(r.x, 0.8f, 1e-6);
    NISPS_EXPECT_NEAR(r.y, 0.2f, 1e-6);
}

NISPS_TEST(input_chain_ema_frame_rate_independent) {
    // Same wall-time travel at different tick rates converges to ~the same
    // place (the alpha_eff dt-compensation).
    auto run = [](float dt, int steps) {
        InputChain ch;
        InputChainConfig c;
        c.smoothing = 0.8f;
        ch.set_config(c);
        float x = 0.f;
        for (int i = 0; i < steps; ++i) x = ch.process(1.f, 0.5f, dt).x;
        return x;
    };
    const float at60  = run(1.f / 60.f, 60);    // 1 s
    const float at240 = run(1.f / 240.f, 240);  // 1 s
    NISPS_EXPECT_NEAR(at60, at240, 5e-3);
    NISPS_EXPECT(at60 > 0.9f);
}

NISPS_TEST(input_chain_momentum_zooms_out_on_speed) {
    InputChain ch;
    InputChainConfig c;
    c.momentum_mode = MomentumMode::Strong;
    ch.set_config(c);
    // Sweep fast across the full range: multiplier should drop below 1.
    float x = 0.f;
    for (int i = 0; i <= 24; ++i) {
        x = static_cast<float>(i) / 24.f;
        ch.process(x, 0.5f, kDt);
    }
    NISPS_EXPECT(ch.momentum_multiplier() < 0.9f);
    // Dwell: multiplier recovers toward 1.
    for (int i = 0; i < 240; ++i) ch.process(1.f, 0.5f, kDt);
    NISPS_EXPECT(ch.momentum_multiplier() > 0.95f);
}

NISPS_TEST(input_chain_state_round_trip) {
    InputChain a;
    InputChainConfig c;
    c.smoothing = 0.5f;
    a.set_config(c);
    for (int i = 0; i < 10; ++i) a.process(0.9f, 0.1f, kDt);

    std::array<float, InputChain::state_size()> blob{};
    a.save_state(blob);

    InputChain b;
    b.set_config(c);
    b.load_state(blob);
    const auto ra = a.process(0.9f, 0.1f, kDt);
    const auto rb = b.process(0.9f, 0.1f, kDt);
    NISPS_EXPECT(ra.x == rb.x);
    NISPS_EXPECT(ra.y == rb.y);
}

// -- output chain ---------------------------------------------------------------

NISPS_TEST(output_chain_identity_default) {
    OutputChain<8u> ch;
    const float raw[4] = {0.1f, 0.5f, 0.9f, 1.2f};
    float out[4];
    ch.process(std::span<const float>(raw), std::span<float>(out), kDt);
    NISPS_EXPECT_NEAR(out[0], 0.1f, 1e-6);
    NISPS_EXPECT_NEAR(out[3], 1.0f, 1e-6);  // clamped
}

NISPS_TEST(output_chain_global_curve) {
    OutputChain<8u> ch;
    OutputChainConfig c;
    c.global_curve = 2.0f;
    ch.set_config(c);
    const float raw[2] = {0.5f, 0.9f};
    float out[2];
    ch.process(std::span<const float>(raw), std::span<float>(out), kDt);
    NISPS_EXPECT_NEAR(out[0], 0.25f, 1e-6);
    NISPS_EXPECT_NEAR(out[1], 0.81f, 1e-5);
}

NISPS_TEST(output_chain_slew_limits_change) {
    OutputChain<4u> ch;
    OutputChainConfig c;
    c.slew_rate = 1.0f;  // one full unit per second
    ch.set_config(c);
    const float step0[1] = {0.f};
    const float step1[1] = {1.f};
    float out[1];
    ch.process(std::span<const float>(step0), std::span<float>(out), kDt);  // seed at 0
    ch.process(std::span<const float>(step1), std::span<float>(out), kDt);
    NISPS_EXPECT_NEAR(out[0], kDt, 1e-6);  // limited to slew*dt
    ch.process(std::span<const float>(step1), std::span<float>(out), kDt);
    NISPS_EXPECT_NEAR(out[0], 2.f * kDt, 1e-6);
}

NISPS_TEST(output_chain_freeze_gate_and_mask) {
    OutputChain<4u> ch;
    const float a[2] = {0.2f, 0.8f};
    float out[2];
    ch.process(std::span<const float>(a), std::span<float>(out), kDt);

    // Global freeze holds prior values.
    OutputChainConfig c;
    c.freeze_output = true;
    ch.set_config(c);
    const float b[2] = {0.9f, 0.1f};
    ch.process(std::span<const float>(b), std::span<float>(out), kDt);
    NISPS_EXPECT_NEAR(out[0], 0.2f, 1e-6);
    NISPS_EXPECT_NEAR(out[1], 0.8f, 1e-6);

    // Per-output mask freezes only masked dims.
    c.freeze_output = false;
    ch.set_config(c);
    const std::uint8_t mask[2] = {1u, 0u};
    ch.set_freeze_mask(mask);
    ch.process(std::span<const float>(b), std::span<float>(out), kDt);
    NISPS_EXPECT_NEAR(out[0], 0.2f, 1e-6);  // frozen
    NISPS_EXPECT_NEAR(out[1], 0.1f, 1e-6);  // live
}

NISPS_TEST(output_chain_reseed_on_length_change) {
    OutputChain<8u> ch;
    const float a4[4] = {0.1f, 0.2f, 0.3f, 0.4f};
    float out4[4];
    ch.process(std::span<const float>(a4), std::span<float>(out4), kDt);
    // Shorter vector reseeds rather than reusing stale state.
    OutputChainConfig c;
    c.slew_rate = 0.001f;  // would clamp hard if prev were stale
    ch.set_config(c);
    const float a2[2] = {0.9f, 0.9f};
    float out2[2];
    ch.process(std::span<const float>(a2), std::span<float>(out2), kDt);
    NISPS_EXPECT_NEAR(out2[0], 0.9f, 1e-6);  // seeded fresh from raw
}

// -- curve catalog --------------------------------------------------------------

NISPS_TEST(centered_power_pivots_at_half) {
    NISPS_EXPECT_NEAR(nisps::centered_power(0.5f, 3.f), 0.5f, 1e-7);
    NISPS_EXPECT_NEAR(nisps::centered_power(0.f, 1.f), 0.f, 1e-7);
    NISPS_EXPECT_NEAR(nisps::centered_power(1.f, 2.f), 1.f, 1e-6);
    // exponent > 1 pulls toward the centre.
    NISPS_EXPECT(nisps::centered_power(0.75f, 2.f) < 0.75f);
    // exponent < 1 pushes toward the extremes.
    NISPS_EXPECT(nisps::centered_power(0.75f, 0.5f) > 0.75f);
}
