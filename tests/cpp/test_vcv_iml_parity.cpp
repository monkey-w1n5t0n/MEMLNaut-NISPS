// tests/cpp/test_vcv_iml_parity.cpp — the VCV module's IML adapter is a THIN
// wrapper over the shared core (one-core-engine-refactor P6 gate; closes
// vcv-module.md delta #5).
//
// A seeded train/infer session driven through the adapter
// (`nisps::IML<float>`, vcv/src/iml.hpp) must be BIT-IDENTICAL to driving a
// bare `MLPCore<DynamicStorage>` of the same shape/seed with the same examples
// and ops. Not 1e-5-near — memcmp-equal. This is what proves the module now
// runs core-exact semantics rather than the retired vendored approximation.

#include <cstdint>
#include <cstring>
#include <span>
#include <vector>

#include "../../nisps/ml/dynamic_storage.hpp"
#include "../../nisps/ml/mlp.hpp"
#include "../../vcv/src/iml.hpp"
#include "test_helpers.hpp"

namespace {

// The module's real runtime shape: 8 inputs → [16, 24, 16] → 16 outputs.
constexpr std::size_t kIn = 8u;
constexpr std::size_t kH1 = 16u, kH2 = 24u, kH3 = 16u;
constexpr std::size_t kOut = 16u;
constexpr std::uint64_t kSeed = 0xC0FFEEu;

using DynamicMLP = nisps::ml::MLPCore<nisps::ml::DynamicStorage>;

bool bit_equal(std::span<const float> a, std::span<const float> b) {
    if (a.size() != b.size()) return false;
    if (a.empty()) return true;
    return std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}

}  // namespace

NISPS_TEST(vcv_iml_adapter_matches_core_bitexact) {
    nisps::IML<float> adapter(kIn, kOut, {kH1, kH2, kH3},
                              /*max_iterations=*/200u,
                              /*learning_rate=*/0.1f,
                              /*convergence_threshold=*/0.00001f,
                              kSeed);

    // The bare core the adapter is supposed to be a thin skin over: same seed,
    // same dims, same capacities (kMaxExamples / max_iter_train) the adapter
    // hands its own MLPCore at construction.
    const std::size_t hidden[3] = {kH1, kH2, kH3};
    DynamicMLP ref(kSeed, kIn, std::span<const std::size_t>(hidden), kOut,
                   nisps::IML<float>::kMaxExamples, adapter.train_max_iter());
    NISPS_ASSERT(ref.valid());

    // Construction alone (MLPCore ctor draws weights(1.f) from the seed).
    {
        auto aw = adapter.get_weights();
        auto rw = ref.get_weights();
        NISPS_ASSERT(aw.size() == rw.size());
        NISPS_EXPECT(bit_equal(std::span<const float>(aw.data(), aw.size()), rw));
    }

    // Draw at a fixed interior spread.
    adapter.randomise_weights(0.6f);
    ref.draw_weights(0.6f);
    {
        auto aw = adapter.get_weights();
        NISPS_EXPECT(bit_equal(std::span<const float>(aw.data(), aw.size()), ref.get_weights()));
    }

    // Add a fixed set of examples through both paths.
    for (std::size_t e = 0; e < 6u; ++e) {
        float feat[kIn];
        float lab[kOut];
        for (std::size_t i = 0; i < kIn; ++i)
            feat[i] = 0.1f * static_cast<float>((e + i) % 10u);
        for (std::size_t i = 0; i < kOut; ++i)
            lab[i] = 0.05f * static_cast<float>((e * 3u + i) % 20u);
        adapter.add_example(feat, kIn, lab, kOut);
        ref.add_example(std::span<const float>(feat), std::span<const float>(lab));
    }
    NISPS_ASSERT(adapter.get_example_count() == ref.example_count());

    // Train a fixed number of iterations. The adapter trains via the module's
    // real Training→Inference transition; the bare core uses the identical
    // (lr, max_iter, min_err) the adapter would.
    adapter.set_mode(nisps::IML<float>::Mode::Training);
    adapter.set_mode(nisps::IML<float>::Mode::Inference);
    ref.train(adapter.train_lr(), adapter.train_max_iter(), adapter.train_min_err());
    {
        auto aw = adapter.get_weights();
        NISPS_EXPECT(bit_equal(std::span<const float>(aw.data(), aw.size()), ref.get_weights()));
    }

    // Inference outputs at a fixed probe input.
    const float probe[kIn] = {0.1f, 0.9f, 0.25f, 0.75f, 0.5f, 0.33f, 0.66f, 0.42f};
    for (std::size_t i = 0; i < kIn; ++i) {
        adapter.set_input(i, probe[i]);
        ref.set_input(i, probe[i]);
    }
    adapter.process();
    ref.process();
    NISPS_EXPECT(bit_equal(std::span<const float>(adapter.get_outputs(), kOut), ref.outputs()));

    // RL move_weights with an output pin mask (thumbs-down perturbation path).
    std::uint8_t mask[kOut] = {};
    mask[2] = 1u;
    mask[5] = 1u;
    adapter.move_weights(0.3f, 0.4f, std::span<const std::uint8_t>(mask));
    ref.move_weights(0.3f, 0.4f, std::span<const std::uint8_t>(mask));
    {
        auto aw = adapter.get_weights();
        NISPS_EXPECT(bit_equal(std::span<const float>(aw.data(), aw.size()), ref.get_weights()));
    }

    // And outputs stay identical after the perturbation.
    for (std::size_t i = 0; i < kIn; ++i) {
        adapter.set_input(i, probe[i]);
        ref.set_input(i, probe[i]);
    }
    adapter.process();
    ref.process();
    NISPS_EXPECT(bit_equal(std::span<const float>(adapter.get_outputs(), kOut), ref.outputs()));
}
