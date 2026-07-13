// tests/cpp/test_mlp_storage_parity.cpp — FixedStorage vs DynamicStorage
// bit-parity (one-core-engine-refactor P2 gate).
//
// For identical shapes and seeds, MLPCore over the two storage policies must
// produce BIT-IDENTICAL results across the full surface: init, inference,
// training, RL perturbation, diagnostics. Not 1e-5-near — memcmp-equal.

#include <cstdint>
#include <cstring>
#include <span>
#include <vector>

#include "../../nisps/ml/dynamic_storage.hpp"
#include "../../nisps/ml/mlp.hpp"
#include "test_helpers.hpp"

namespace {

constexpr std::size_t kIn  = 3u;
constexpr std::size_t kH1  = 10u;
constexpr std::size_t kH2  = 14u;
constexpr std::size_t kH3  = 18u;
constexpr std::size_t kOut = 7u;
constexpr std::size_t kMaxEx = 16u;
constexpr std::size_t kMaxIter = 64u;
constexpr std::uint64_t kSeed = 0xC0FFEEu;

using FixedMLP   = nisps::ml::MLP<kIn, kH1, kH2, kH3, kOut, kMaxEx, kMaxIter>;
using DynamicMLP = nisps::ml::MLPCore<nisps::ml::DynamicStorage>;

DynamicMLP make_dynamic(std::uint64_t seed) {
    const std::size_t hidden[3] = {kH1, kH2, kH3};
    return DynamicMLP(seed, kIn, std::span<const std::size_t>(hidden), kOut, kMaxEx, kMaxIter);
}

bool bit_equal(std::span<const float> a, std::span<const float> b) {
    if (a.size() != b.size()) return false;
    if (a.empty()) return true;
    return std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}

}  // namespace

// One scripted session driven through both storage models, checked
// bit-exactly after every phase.
NISPS_TEST(mlp_storage_parity_scripted_session) {
    FixedMLP   fixed(kSeed);
    DynamicMLP dyn = make_dynamic(kSeed);

    NISPS_ASSERT(dyn.valid());
    NISPS_ASSERT(fixed.weight_count() == dyn.weight_count());

    // Construction (draw_weights(1.f) from the same seed).
    NISPS_EXPECT(bit_equal(fixed.get_weights(), dyn.get_weights()));

    // Explicit draw at an interior spread.
    fixed.draw_weights(0.6f);
    dyn.draw_weights(0.6f);
    NISPS_EXPECT(bit_equal(fixed.get_weights(), dyn.get_weights()));

    // Inference.
    const float probe_in[kIn] = {0.25f, 0.75f, 0.5f};
    for (std::size_t i = 0; i < kIn; ++i) {
        fixed.set_input(i, probe_in[i]);
        dyn.set_input(i, probe_in[i]);
    }
    fixed.process();
    dyn.process();
    NISPS_EXPECT(bit_equal(fixed.outputs(), dyn.outputs()));

    // Dataset + training (enough examples to exercise the FIFO eviction).
    for (std::size_t e = 0; e < kMaxEx + 4u; ++e) {
        float feat[kIn];
        float lab[kOut];
        for (std::size_t i = 0; i < kIn; ++i) {
            feat[i] = 0.1f * static_cast<float>((e + i) % 10u);
        }
        for (std::size_t i = 0; i < kOut; ++i) {
            lab[i] = 0.05f * static_cast<float>((e * 3u + i) % 20u);
        }
        fixed.add_example(std::span<const float>(feat), std::span<const float>(lab));
        dyn.add_example(std::span<const float>(feat), std::span<const float>(lab));
    }
    NISPS_ASSERT(fixed.example_count() == dyn.example_count());

    const float loss_f = fixed.train(0.5f, 40u, 0.0f);
    const float loss_d = dyn.train(0.5f, 40u, 0.0f);
    NISPS_EXPECT(std::memcmp(&loss_f, &loss_d, sizeof(float)) == 0);
    NISPS_EXPECT(bit_equal(fixed.get_weights(), dyn.get_weights()));
    NISPS_EXPECT(bit_equal(fixed.loss_history(), dyn.loss_history()));

    // RL perturbation with a pin mask.
    std::uint8_t mask[kOut] = {};
    mask[2] = 1u;
    mask[5] = 1u;
    fixed.move_weights(0.3f, 0.4f, std::span<const std::uint8_t>(mask));
    dyn.move_weights(0.3f, 0.4f, std::span<const std::uint8_t>(mask));
    NISPS_EXPECT(bit_equal(fixed.get_weights(), dyn.get_weights()));

    // Diagnostics.
    const float el_f = fixed.eval_loss();
    const float el_d = dyn.eval_loss();
    NISPS_EXPECT(std::memcmp(&el_f, &el_d, sizeof(float)) == 0);
    for (std::size_t l = 0; l < 4u; ++l) {
        const auto sf = fixed.layer_stats(l);
        const auto sd = dyn.layer_stats(l);
        NISPS_EXPECT(std::memcmp(&sf, &sd, sizeof(sf)) == 0);
    }

    // set_weights round trip + infer_batch.
    {
        const auto wf = fixed.get_weights();
        std::vector<float> w(wf.begin(), wf.end());
        for (std::size_t i = 0; i < w.size(); i += 7u) w[i] += 0.125f;
        fixed.set_weights(w);
        dyn.set_weights(w);

        const float pts[kIn * 3u] = {0.f,  0.f,   0.f,
                                     0.5f, 0.25f, 1.f,
                                     1.f,  1.f,   0.75f};
        float out_f[kOut * 3u];
        float out_d[kOut * 3u];
        fixed.infer_batch(std::span<const float>(pts), std::span<float>(out_f));
        dyn.infer_batch(std::span<const float>(pts), std::span<float>(out_d));
        NISPS_EXPECT(std::memcmp(out_f, out_d, sizeof(out_f)) == 0);
    }

    // reset() re-draws from the (identically-advanced) RNG stream.
    fixed.reset();
    dyn.reset();
    NISPS_EXPECT(bit_equal(fixed.get_weights(), dyn.get_weights()));
}

// Invalid dynamic construction stays inert (no crash, no UB).
NISPS_TEST(mlp_dynamic_storage_invalid_dims_inert) {
    const std::size_t bad_hidden[2] = {4u, 4u};
    DynamicMLP bad(kSeed, kIn, std::span<const std::size_t>(bad_hidden), kOut);
    NISPS_ASSERT(!bad.valid());
    bad.process();
    bad.set_input(0u, 0.5f);
    NISPS_EXPECT(bad.train() == 0.f);
    NISPS_EXPECT(bad.get_weights().empty());
    NISPS_EXPECT(bad.eval_loss() == 0.f);
}

// Moved-from dynamic instances stay inert; moved-to keeps working.
NISPS_TEST(mlp_dynamic_storage_move_semantics) {
    DynamicMLP a = make_dynamic(kSeed);
    NISPS_ASSERT(a.valid());
    a.set_input(0u, 0.25f);
    a.process();

    FixedMLP ref(kSeed);
    ref.set_input(0u, 0.25f);
    ref.process();

    DynamicMLP b(static_cast<DynamicMLP&&>(a));
    NISPS_ASSERT(b.valid());
    b.process();
    NISPS_EXPECT(bit_equal(b.outputs(), ref.outputs()));
}
