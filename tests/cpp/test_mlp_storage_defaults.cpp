// tests/cpp/test_mlp_storage_defaults.cpp — regression test for S35 (dual
// example-store cap mismatch), docs/specs/recon/simplification-audit-2026-07.md.
//
// THE BUG (confirmed by trace, not just the audit's description): Manifold's
// WasmIML kept a JS `Dataset` mirror hardcoded to `maxSize = 100`
// (manifold/src/engine/dataset.ts / wasm-iml.ts) while pushing every example
// into the SAME C++ FIFO ring (`MLPCore<DynamicStorage>`, the browser MLP —
// nisps/wasm/bindings.cpp `BrowserMLP`) whose cap defaulted to 128
// (nisps/ml/dynamic_storage.hpp). Past 100 examples the two stores held
// DIFFERENT data: `train()` reads the C++ ring (up to 128 examples) while
// `trainAsync()` reads the JS Dataset (capped at 100) — silently diverging.
// The same mismatch produced a latent OOB read: `nisps_ml_train`
// (bindings.cpp) builds `std::span<const float>(sample_weights,
// mlp.example_count())` — sized to the C++ side's count (up to 128) — over a
// buffer the JS side allocated at its own (<=100) example count.
//
// THE FIX: name the shared capacity ONCE — `nisps::ml::kDefaultMaxExamples`
// (nisps/ml/storage.hpp) — used as FixedStorage's default template argument
// AND DynamicStorage's default constructor argument (nisps/ml/dynamic_storage.hpp),
// and exposed through `nisps_ml_describe`'s extended (7-int) dims descriptor
// so the TS side reads it instead of hardcoding a second, divergent literal.
//
// This test lives entirely on the C++ side (the WASM bindings link against
// emscripten headers and aren't part of the native ctest build), so it
// cannot exercise the TS Dataset mirror directly. What it CAN and DOES pin:
//   1. FixedStorage's and DynamicStorage's DEFAULT capacities are the same
//      named constant, not two independently-hardcoded literals that could
//      silently drift apart (the exact bug shape, reproduced within reach
//      of a native test).
//   2. The actual runtime ring — constructed exactly as
//      nisps/wasm/bindings.cpp's MLHandle constructs the browser MLP (no
//      max_examples argument passed) — saturates AT that constant, not at
//      the old wrong TS-side literal (100) and not unbounded.

#include <cstddef>
#include <span>

#include "../../nisps/ml/dynamic_storage.hpp"
#include "../../nisps/ml/mlp.hpp"
#include "test_helpers.hpp"

namespace {

constexpr std::size_t kIn  = 3u;
constexpr std::size_t kH1  = 4u;
constexpr std::size_t kH2  = 5u;
constexpr std::size_t kH3  = 6u;
constexpr std::size_t kOut = 2u;
constexpr std::uint64_t kSeed = 0xC0FFEEu;

}  // namespace

// The two storage policies' DEFAULT example-store capacity must be the SAME
// named constant. If a future edit hardcodes a new literal in one place
// without updating the other, this fails immediately — no examples need to
// be pushed to catch it.
NISPS_TEST(storage_defaults_share_one_named_capacity) {
    // FixedStorage's own default template argument (storage.hpp).
    using DefaultFixedStorage =
        nisps::ml::FixedStorage<kIn, kH1, kH2, kH3, kOut>;  // NMaxExamples defaulted
    NISPS_EXPECT(DefaultFixedStorage::kMaxExamples == nisps::ml::kDefaultMaxExamples);

    // DynamicStorage's own default constructor argument — this is the exact
    // path nisps/wasm/bindings.cpp's MLHandle uses for the browser MLP (no
    // max_examples argument passed to the MLPCore ctor).
    const std::size_t hidden[3] = {kH1, kH2, kH3};
    nisps::ml::MLPCore<nisps::ml::DynamicStorage> dyn(
        kSeed, kIn, std::span<const std::size_t>(hidden), kOut);
    NISPS_ASSERT(dyn.valid());
    NISPS_EXPECT(dyn.max_examples() == nisps::ml::kDefaultMaxExamples);

    // Cross-policy: the two independently-defaulted storage models must
    // agree — this IS the invariant S35 violated across the C++/TS boundary.
    NISPS_EXPECT(DefaultFixedStorage::kMaxExamples == dyn.max_examples());

    // Pin the actual value: this is what nisps_ml_describe reports (out_dims[6])
    // and what every WASM caller must size its JS Dataset mirror to — 128, NOT
    // the 100 the TS side used to hardcode.
    NISPS_EXPECT(nisps::ml::kDefaultMaxExamples == 128u);
}

// Push more than the OLD (wrong) TS-side cap of 100 examples through a
// default-constructed DynamicStorage MLP (mirroring MLHandle's construction
// exactly — no max_examples argument). The ring must saturate at
// kDefaultMaxExamples (128), matching what describe() reports — not at 100,
// and not unbounded. Before the S35 fix, Manifold's JS Dataset mirror capped
// at a hardcoded 100 while this ring kept growing past it: past 100
// examples the two stores held different data (train() vs trainAsync()),
// and a sample-weight buffer sized to the JS side's (<=100) count would read
// out of bounds against this ring's (up to 128) example_count().
NISPS_TEST(storage_defaults_ring_caps_at_shared_constant_past_old_ts_cap) {
    const std::size_t hidden[3] = {kH1, kH2, kH3};
    nisps::ml::MLPCore<nisps::ml::DynamicStorage> dyn(
        kSeed, kIn, std::span<const std::size_t>(hidden), kOut);
    NISPS_ASSERT(dyn.valid());

    constexpr std::size_t kOldWrongTsCap = 100u;
    const std::size_t push_count = nisps::ml::kDefaultMaxExamples + 5u;  // 133 > 128 > 100
    NISPS_ASSERT(push_count > kOldWrongTsCap);

    float feat[kIn];
    float lab[kOut];
    for (std::size_t e = 0; e < push_count; ++e) {
        for (std::size_t i = 0; i < kIn; ++i)  feat[i] = 0.01f * static_cast<float>((e + i) % 17u);
        for (std::size_t i = 0; i < kOut; ++i) lab[i]  = 0.02f * static_cast<float>((e + i) % 11u);
        dyn.add_example(std::span<const float>(feat, kIn), std::span<const float>(lab, kOut));
    }

    NISPS_EXPECT(dyn.example_count() == nisps::ml::kDefaultMaxExamples);
    NISPS_EXPECT(dyn.example_count() != kOldWrongTsCap);
}
