// tests/cpp/test_mlp_jolt.cpp — Jolt (held continuous weight morph) behavior.
//
//   - default state is inert: inactive, step() is a no-op, lr_scale()==1.
//   - press() activates and pauses learning (lr_scale()==0).
//   - step() morphs selected weights toward bounded targets, staying within
//     the [target_min, target_max] envelope.
//   - release() freezes and re-arms the LR ramp (0 → 1 via tick_lr_ramp).
//   - same seed ⇒ identical morph (determinism / parity).

#include <array>
#include <cmath>
#include <cstdint>
#include <span>

#include "test_helpers.hpp"

#include "../../nisps/ml/jolt.hpp"

namespace {

using nisps::ml::Jolt;
using nisps::ml::JoltParams;

NISPS_TEST(jolt_inert_by_default) {
    Jolt j(0ull);
    NISPS_EXPECT(!j.active());
    NISPS_EXPECT(j.lr_scale() == 1.f);
    std::array<float, 32> w{};
    w.fill(0.5f);
    j.step(std::span<float>(w));  // no-op while inactive
    for (float v : w) NISPS_EXPECT(v == 0.5f);
}

NISPS_TEST(jolt_press_activates_and_pauses_learning) {
    Jolt j(1ull);
    j.press(100u);
    NISPS_EXPECT(j.active());
    NISPS_EXPECT(j.lr_scale() == 0.f);
}

NISPS_TEST(jolt_step_morphs_weights_within_envelope) {
    Jolt j(7ull);
    JoltParams p;
    p.num_weights = 16u;
    j.set_params(p);

    std::array<float, 64> w{};
    w.fill(0.f);
    j.press(w.size());
    for (int i = 0; i < 300; ++i) j.step(std::span<float>(w));

    int changed = 0;
    for (float v : w) {
        if (std::fabs(v) > 1e-4f) ++changed;
        // Targets are bounded to [target_min, target_max] = [-1.2, 0.9];
        // EMA interpolation keeps weights inside that envelope.
        NISPS_EXPECT(v >= p.target_min - 0.01f);
        NISPS_EXPECT(v <= p.target_max + 0.01f);
    }
    NISPS_EXPECT(changed > 0);
    NISPS_EXPECT(changed <= 16);  // at most num_weights distinct indices
}

NISPS_TEST(jolt_release_ramps_lr_back_to_full) {
    Jolt j(3ull);
    j.press(50u);
    NISPS_EXPECT(j.lr_scale() == 0.f);

    j.release();
    NISPS_EXPECT(!j.active());
    NISPS_EXPECT(j.lr_scale() == 0.f);  // ramp re-armed at 0

    for (int i = 0; i < 10; ++i) j.tick_lr_ramp();
    NISPS_EXPECT(j.lr_scale() > 0.f && j.lr_scale() <= 1.f);

    for (int i = 0; i < 2000; ++i) j.tick_lr_ramp();  // default step 0.001
    NISPS_EXPECT_NEAR(j.lr_scale(), 1.f, 1e-6);
}

NISPS_TEST(jolt_deterministic_same_seed) {
    Jolt a(99ull), b(99ull);
    std::array<float, 48> wa{}, wb{};
    wa.fill(0.25f);
    wb.fill(0.25f);
    a.press(wa.size());
    b.press(wb.size());
    for (int i = 0; i < 150; ++i) {
        a.step(std::span<float>(wa));
        b.step(std::span<float>(wb));
    }
    for (std::size_t i = 0; i < wa.size(); ++i) NISPS_EXPECT(wa[i] == wb[i]);
}

}  // namespace
