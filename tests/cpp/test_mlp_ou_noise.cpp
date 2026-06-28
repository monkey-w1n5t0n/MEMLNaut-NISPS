// tests/cpp/test_mlp_ou_noise.cpp — Ornstein-Uhlenbeck exploration noise.
//
//   - default state is inert: intensity 0, disabled, apply() leaves the
//     output untouched (parity-safe).
//   - set_intensity enables it; apply() drifts the output but keeps it in
//     [0, 1].
//   - same seed ⇒ identical walk (determinism / parity).
//   - intensity back to 0 disables it again (inert).

#include <array>
#include <cmath>
#include <cstdint>
#include <span>

#include "test_helpers.hpp"

#include "../../nisps/ml/ou_noise.hpp"

namespace {

using nisps::ml::OUNoise;

NISPS_TEST(ou_inert_by_default) {
    OUNoise<8> ou(0ull);
    NISPS_EXPECT(!ou.enabled());
    NISPS_EXPECT(ou.intensity() == 0.f);
    std::array<float, 8> o{};
    o.fill(0.5f);
    ou.apply(std::span<float>(o));  // no-op while disabled
    for (float v : o) NISPS_EXPECT(v == 0.5f);
}

NISPS_TEST(ou_intensity_enables_and_perturbs_bounded) {
    OUNoise<8> ou(5ull);
    ou.set_intensity(0.6f);
    NISPS_EXPECT(ou.enabled());

    bool moved = false;
    for (int t = 0; t < 500; ++t) {
        std::array<float, 8> o{};
        o.fill(0.5f);
        ou.apply(std::span<float>(o));
        for (float v : o) {
            NISPS_EXPECT(v >= 0.f && v <= 1.f);  // clamped to param space
            if (std::fabs(v - 0.5f) > 1e-4f) moved = true;
        }
    }
    NISPS_EXPECT(moved);
}

NISPS_TEST(ou_deterministic_same_seed) {
    OUNoise<4> a(42ull), b(42ull);
    a.set_intensity(0.5f);
    b.set_intensity(0.5f);
    for (int t = 0; t < 100; ++t) {
        std::array<float, 4> oa{}, ob{};
        oa.fill(0.3f);
        ob.fill(0.3f);
        a.apply(std::span<float>(oa));
        b.apply(std::span<float>(ob));
        for (int i = 0; i < 4; ++i) NISPS_EXPECT(oa[i] == ob[i]);
    }
}

NISPS_TEST(ou_intensity_zero_disables_again) {
    OUNoise<4> ou(1ull);
    ou.set_intensity(0.5f);
    NISPS_EXPECT(ou.enabled());
    ou.set_intensity(0.f);
    NISPS_EXPECT(!ou.enabled());
    std::array<float, 4> o{};
    o.fill(0.2f);
    ou.apply(std::span<float>(o));
    for (float v : o) NISPS_EXPECT(v == 0.2f);
}

}  // namespace
