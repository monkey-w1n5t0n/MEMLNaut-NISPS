// tests/cpp/ml_golden_vectors.cpp — fixed-seed regression test for the MLP.
//
// Why this exists
// ---------------
// The MLP class is deterministic given a fixed RNG seed. If anyone refactors
// the forward pass, weight init, or RL noise injection, the *exact* output
// vector for a known sequence of operations will change — and we want CI to
// catch that loudly.
//
// What this captures
// ------------------
//   1. After construction with seed=42 (which calls draw_weights(1.0) inside
//      the constructor), we run inference at input (0.5, 0.5) and capture
//      every output.
//   2. We call draw_weights(0.5) to re-randomise with mid-spread, infer, and
//      capture again.
//   3. We add 4 simple input/label examples, train for 100 iterations at lr=0.5,
//      infer, and capture.
//   4. We call move_weights(0.1, 0.3) (RL noise burst), infer, and capture.
//
// Test architecture
// -----------------
// MLP<2, 10, 10, 14, 33> — matches the firmware default for the PAF synth
// mode (33 outputs). Exact dimensions don't matter much; we just need a
// non-trivial output vector that exercises all four layers.
//
// Refreshing the golden file
// --------------------------
// Set NISPS_REGEN_GOLDEN=1 in the environment when running this binary. It
// will print the current outputs in a copy-pasteable C-array literal to stdout
// AND exit 0. Paste them into kExpectedStage[N] below and re-run with the env
// var unset to verify.
//
// Tolerance
// ---------
// 1e-5 absolute. The MLP is float32 throughout; the only nondeterminism is
// floating-point rounding order across optimization levels. We compile -O3 in
// CMake and -O2 + AVX in Emscripten; the parity test catches drift between
// builds. This test catches drift between commits.

#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "test_helpers.hpp"
#include "../../nisps/ml/mlp.hpp"

namespace {

using TestMLP = nisps::ml::MLP<2u, 10u, 10u, 14u, 33u>;

constexpr std::uint64_t kSeed = 42u;
constexpr float         kInputX = 0.5f;
constexpr float         kInputY = 0.5f;
constexpr float         kTol = 1.0e-5f;

// Golden vectors captured 2026-04-29 from a clean build of the worktree.
// Stages 2 and 3 RE-CAPTURED 2026-07-25 when the optimiser changed from SGD
// to RMSProp (nisps/ml/training.hpp — the port of upstream memlp Layer.h
// @ ea777502). That is a deliberate behaviour change, not a regression: an
// upstream-tuned learning rate is a normalised step under RMSProp and a raw
// gradient multiplier under SGD, so every ported hyperparameter was landing
// in the wrong optimiser. Stages 0 and 1 are pre-training and did NOT move,
// which is the cross-check that only the update rule changed.
// To regenerate: NISPS_REGEN_GOLDEN=1 ./nisps_golden_tests
//
// The arrays below are the post-process() output vectors at each stage
// described above. Stage 4 in particular is sensitive to RL noise generator
// state — ANY change to xoshiro256+ or the gaussian sum-of-three formula in
// nisps/core/rng.hpp will invalidate it.
//
// Stage 0: post-construction (default Xavier draw with spread=1, called from
// the MLP constructor), before any user-driven draw_weights or training.
constexpr std::array<float, 33u> kExpectedStage0 = {
    0.49662992f, 0.49813405f, 0.50554955f, 0.49852926f, 0.49993742f,
    0.49980220f, 0.49747804f, 0.50358790f, 0.49999994f, 0.50455135f,
    0.49997640f, 0.50042748f, 0.49769798f, 0.50205874f, 0.50156462f,
    0.50106966f, 0.49768052f, 0.49796993f, 0.49776515f, 0.50192314f,
    0.50345314f, 0.50054342f, 0.50162661f, 0.50061351f, 0.50068146f,
    0.50237012f, 0.50153363f, 0.49846420f, 0.49672276f, 0.49584076f,
    0.49718165f, 0.49776685f, 0.49800035f,
};

// Stage 1: after explicit draw_weights(0.5) and re-inference.
constexpr std::array<float, 33u> kExpectedStage1 = {
    0.51337469f, 0.50231707f, 0.49654010f, 0.50725782f, 0.49775314f,
    0.50814718f, 0.50000459f, 0.50158256f, 0.51846194f, 0.51250720f,
    0.51246792f, 0.49345547f, 0.50064278f, 0.51497459f, 0.48988324f,
    0.50109828f, 0.49480906f, 0.51678216f, 0.50396103f, 0.48962030f,
    0.50470036f, 0.50095022f, 0.49689421f, 0.50183755f, 0.50324529f,
    0.48351043f, 0.50622481f, 0.50866264f, 0.50432122f, 0.50555164f,
    0.50692219f, 0.49826777f, 0.50941539f,
};

// Stage 2: after add_example x4 and train(lr=0.5, max_iter=100).
constexpr std::array<float, 33u> kExpectedStage2 = {
    0.66427404f, 0.62863928f, 0.63347638f, 0.68701935f, 0.62282497f,
    0.59066784f, 0.57926202f, 0.61092430f, 0.75877625f, 0.71219701f,
    0.76448023f, 0.64224732f, 0.67476881f, 0.75132567f, 0.60728127f,
    0.69433212f, 0.66885883f, 0.75783861f, 0.70804310f, 0.65609163f,
    0.69490194f, 0.71871793f, 0.70532608f, 0.78637725f, 0.78410172f,
    0.65154189f, 0.75753516f, 0.78313172f, 0.77768368f, 0.69148761f,
    0.74804193f, 0.76963025f, 0.77354264f,
};

// Stage 3: after move_weights(0.1, 0.3) and re-inference.
constexpr std::array<float, 33u> kExpectedStage3 = {
    0.66872150f, 0.58160317f, 0.61222225f, 0.60297203f, 0.64177775f,
    0.64809793f, 0.54033780f, 0.63073188f, 0.76591563f, 0.64906687f,
    0.69643915f, 0.63856536f, 0.67001587f, 0.76458490f, 0.63405144f,
    0.61661869f, 0.56021708f, 0.74601728f, 0.64519984f, 0.62616533f,
    0.64741832f, 0.68293601f, 0.62627184f, 0.74945569f, 0.75258166f,
    0.56667519f, 0.69179827f, 0.80808818f, 0.72934091f, 0.74348420f,
    0.75629526f, 0.67320448f, 0.75111967f,
};

// Inference helper: set both inputs, run process(), copy outputs into a
// fixed-size array we can compare against the golden tables.
std::array<float, 33u> capture_outputs(TestMLP& mlp) {
    mlp.set_input(0u, kInputX);
    mlp.set_input(1u, kInputY);
    mlp.process();
    const auto outs = mlp.outputs();
    std::array<float, 33u> result{};
    for (std::size_t i = 0; i < 33u; ++i) result[i] = outs[i];
    return result;
}

bool regen_mode() {
    const char* env = std::getenv("NISPS_REGEN_GOLDEN");
    return env && env[0] == '1';
}

void dump_array(const char* name, const std::array<float, 33u>& v) {
    std::printf("constexpr std::array<float, 33u> %s = {\n    ", name);
    for (std::size_t i = 0; i < v.size(); ++i) {
        std::printf("%.8ff%s", v[i], i + 1 == v.size() ? "" : ",");
        if ((i + 1) % 5 == 0 && i + 1 != v.size()) std::printf("\n    ");
        else if (i + 1 != v.size()) std::printf(" ");
    }
    std::printf(",\n};\n\n");
}

void compare_or_fail(const char* stage,
                     const std::array<float, 33u>& got,
                     const std::array<float, 33u>& want) {
    bool ok = true;
    for (std::size_t i = 0; i < got.size(); ++i) {
        if (std::fabs(got[i] - want[i]) > kTol) {
            std::fprintf(stderr,
                         "  golden mismatch at %s[%zu]: got %.8f, want %.8f, "
                         "delta=%.3e (tol=%.3e)\n",
                         stage, i, got[i], want[i],
                         std::fabs(got[i] - want[i]), kTol);
            ok = false;
        }
    }
    NISPS_EXPECT(ok);
}

}  // namespace

NISPS_TEST(ml_golden_vectors_stage0_construction) {
    TestMLP mlp(kSeed);
    const auto got = capture_outputs(mlp);

    if (regen_mode()) {
        std::printf("// Regenerated golden vectors (NISPS_REGEN_GOLDEN=1):\n");
        dump_array("kExpectedStage0", got);
        return;
    }
    compare_or_fail("stage0_construction", got, kExpectedStage0);
}

NISPS_TEST(ml_golden_vectors_stage1_draw_weights) {
    TestMLP mlp(kSeed);
    mlp.draw_weights(0.5f);
    const auto got = capture_outputs(mlp);

    if (regen_mode()) {
        dump_array("kExpectedStage1", got);
        return;
    }
    compare_or_fail("stage1_draw_weights", got, kExpectedStage1);
}

NISPS_TEST(ml_golden_vectors_stage2_train) {
    TestMLP mlp(kSeed);
    mlp.draw_weights(0.5f);

    // Four corners of the input space, each mapped to a distinctive constant
    // output vector. Tiny dataset → SGD converges to a smooth interpolant.
    constexpr std::array<std::array<float, 2u>, 4u> features = {{
        {{0.0f, 0.0f}}, {{1.0f, 0.0f}}, {{0.0f, 1.0f}}, {{1.0f, 1.0f}},
    }};
    auto make_label = [](std::size_t i) {
        std::array<float, 33u> out{};
        // Three output-space "moods" per corner — a bit of structure rather
        // than pure noise so the loss curve actually descends.
        const float a = static_cast<float>(i) * 0.25f + 0.1f;
        for (std::size_t j = 0; j < 33u; ++j) {
            out[j] = a + 0.01f * static_cast<float>(j);
        }
        return out;
    };

    for (std::size_t i = 0; i < features.size(); ++i) {
        const auto label = make_label(i);
        mlp.add_example(std::span<const float>(features[i].data(), 2u),
                        std::span<const float>(label.data(), 33u));
    }

    const float final_loss = mlp.train(0.5f, 100u, 0.0f /* never early-out */);
    NISPS_EXPECT(std::isfinite(final_loss));
    NISPS_EXPECT(final_loss >= 0.0f);

    const auto got = capture_outputs(mlp);
    if (regen_mode()) {
        dump_array("kExpectedStage2", got);
        return;
    }
    compare_or_fail("stage2_train", got, kExpectedStage2);
}

NISPS_TEST(ml_golden_vectors_stage3_move_weights) {
    TestMLP mlp(kSeed);
    mlp.draw_weights(0.5f);

    constexpr std::array<std::array<float, 2u>, 4u> features = {{
        {{0.0f, 0.0f}}, {{1.0f, 0.0f}}, {{0.0f, 1.0f}}, {{1.0f, 1.0f}},
    }};
    auto make_label = [](std::size_t i) {
        std::array<float, 33u> out{};
        const float a = static_cast<float>(i) * 0.25f + 0.1f;
        for (std::size_t j = 0; j < 33u; ++j) out[j] = a + 0.01f * static_cast<float>(j);
        return out;
    };

    for (std::size_t i = 0; i < features.size(); ++i) {
        const auto label = make_label(i);
        mlp.add_example(std::span<const float>(features[i].data(), 2u),
                        std::span<const float>(label.data(), 33u));
    }
    (void)mlp.train(0.5f, 100u, 0.0f);
    mlp.move_weights(0.1f, 0.3f);

    const auto got = capture_outputs(mlp);
    if (regen_mode()) {
        dump_array("kExpectedStage3", got);
        return;
    }
    compare_or_fail("stage3_move_weights", got, kExpectedStage3);
}

NISPS_TEST(ml_golden_vectors_seed_isolation) {
    // Re-seeding to the same value MUST produce the same draw_weights output.
    // This is the contract that makes the parity test possible.
    TestMLP a(kSeed);
    TestMLP b(kSeed);
    a.draw_weights(0.5f);
    b.draw_weights(0.5f);
    const auto out_a = capture_outputs(a);
    const auto out_b = capture_outputs(b);
    for (std::size_t i = 0; i < 33u; ++i) {
        NISPS_EXPECT_NEAR(out_a[i], out_b[i], 0.0f);  // exact bitwise
    }
}

NISPS_TEST(ml_golden_vectors_seed_changes_outputs) {
    // Different seed → different outputs. Sanity check that the seed is
    // actually being applied.
    TestMLP a(kSeed);
    TestMLP b(kSeed + 1ull);
    a.draw_weights(0.5f);
    b.draw_weights(0.5f);
    const auto out_a = capture_outputs(a);
    const auto out_b = capture_outputs(b);
    bool any_diff = false;
    for (std::size_t i = 0; i < 33u; ++i) {
        if (std::fabs(out_a[i] - out_b[i]) > 1.0e-3f) any_diff = true;
    }
    NISPS_EXPECT(any_diff);
}
