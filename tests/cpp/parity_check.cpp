// tests/cpp/parity_check.cpp — produces a deterministic blob the WASM build
// must reproduce.
//
// Execution model
// ---------------
// This is a STANDALONE executable (not part of the gtest-style harness). It
// runs a fixed sequence of MLP and engine operations, dumps the results to
// `parity_native.bin`, and exits 0 if everything is finite. The companion
// Node.js script (`tests/cpp/parity_wasm.mjs`) loads the WASM build of
// nisps and runs the SAME sequence, dumping to `parity_wasm.bin`. The shell
// script `scripts/parity-check.sh` then runs both and float32-diffs the
// outputs with a 1e-5 tolerance.
//
// What we cover
// -------------
//   1. ML: seed=42, draw_weights(0.5), set_input(0.25, 0.75), process.
//      → 126 outputs + 12 weights sampled at known offsets.
//   2. ML training: 3 examples added, train(0.3, 50, 0), capture loss + outputs.
//   3. PAFSynth engine: seed-equivalent setup (params=0.5), 128-sample run on
//      silence, capture L+R averages.
//   4. ChannelStrip engine: identical methodology.
//
// We use the EXACT SAME compile-time MLP architecture as the WASM build:
//   MLP<32, 10, 14, 18, 126>   (32-input max for mix-and-match; see bindings.cpp)
//
// Output blob format
// ------------------
//   uint32 magic = 'NPRT' = 0x5450524E
//   uint32 version = 1
//   uint32 n_floats
//   float32[n_floats] payload
//
// Stable order of payload (concatenated):
//   * 126 floats: outputs after stage 1 (post-process at (0.25, 0.75))
//   * 12  floats: weights sampled at fixed indices (see kProbeIdx below)
//   * 126 floats: outputs after stage 2 (post-train, re-process)
//   * 1   float : final training loss
//   * 2   floats: PAFSynth L mean, R mean (over 128 samples)
//   * 2   floats: ChannelStrip L mean, R mean
//
// Why not bit-perfect
// -------------------
// We compare to 1e-5 absolute. Native and WASM compile with the same source
// and (mostly) the same flags, but FP order-of-summation can differ at -O3.
// Anything bigger than 1e-5 means a true semantic divergence.

#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <span>
#include <string>
#include <vector>

#include "../../nisps/core/math.hpp"
#include "../../nisps/engines/channel_strip.hpp"
#include "../../nisps/engines/paf_synth.hpp"
#include "../../nisps/ml/feedback.hpp"
#include "../../nisps/ml/mlp.hpp"
#include "../../nisps/pipeline/input_chain.hpp"
#include "../../nisps/pipeline/output_chain.hpp"

namespace {

using ParityMLP = nisps::ml::MLP<32u, 10u, 14u, 18u, 126u>;

// The WASM bindings (nisps/wasm/bindings.cpp) sign-extend the 32-bit JS
// seed via `s ^ (s << 32)`. To get bit-equal output between native and
// WASM, we apply the same transform here. Anyone changing the WASM
// transform must also change this constant.
constexpr std::uint32_t kSeed32 = 42u;
constexpr std::uint64_t kSeed   = static_cast<std::uint64_t>(kSeed32)
                                ^ (static_cast<std::uint64_t>(kSeed32) << 32);
constexpr float         kInputX = 0.25f;
constexpr float         kInputY = 0.75f;
constexpr float         kSampleRate = 48000.0f;
constexpr std::size_t   kSynthFrames = 128u;

// Twelve probe indices into the flat weight buffer (~3300 floats). Spread
// across all four layers to detect any layer-specific drift.
constexpr std::array<std::size_t, 12u> kProbeIdx = {
    0u, 5u, 19u, 31u, 73u, 137u, 251u, 491u, 999u, 1583u, 2401u, 3289u,
};

constexpr std::uint32_t kMagic   = 0x5450524Eu;  // 'NPRT'
constexpr std::uint32_t kVersion = 5u;  // v5 adds stage 7 (pipelines + curves)

// Must match the salt in nisps/wasm/bindings.cpp MLHandle so the controller's
// static-output RNG stream is identical native ↔ WASM.
constexpr std::uint64_t kFeedbackSalt = 0xFEEDBACC0DEull;

void push_floats(std::vector<float>& v, std::span<const float> add) {
    for (float f : add) v.push_back(f);
}

bool write_blob(const std::string& path, const std::vector<float>& payload) {
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    if (!f.good()) return false;
    auto write_u32 = [&](std::uint32_t v) { f.write(reinterpret_cast<const char*>(&v), 4); };
    write_u32(kMagic);
    write_u32(kVersion);
    write_u32(static_cast<std::uint32_t>(payload.size()));
    f.write(reinterpret_cast<const char*>(payload.data()),
            static_cast<std::streamsize>(payload.size() * sizeof(float)));
    return f.good();
}

}  // namespace

int main(int argc, char** argv) {
    const std::string out_path = (argc > 1) ? argv[1] : "parity_native.bin";

    std::vector<float> payload;
    payload.reserve(126u + 12u + 126u + 1u + 2u + 2u + 276u);

    // ---- Stage 1: ML inference at fixed input ----
    ParityMLP mlp(kSeed);
    mlp.draw_weights(0.5f);
    mlp.set_input(0u, kInputX);
    mlp.set_input(1u, kInputY);
    mlp.process();
    {
        const auto outs = mlp.outputs();
        push_floats(payload, std::span<const float>(outs.data(), 126u));
    }

    // ---- Stage 1 cont.: weight probe ----
    {
        const auto w = mlp.get_weights();
        for (std::size_t idx : kProbeIdx) {
            payload.push_back(idx < w.size() ? w[idx] : 0.f);
        }
    }

    // ---- Stage 2: training ----
    // Feature vectors are NIn(32)-wide: two real axes + zero-pad (the front-end
    // feeds the same shape — active axes in the low slots, unused slots at 0).
    // add_example requires features.size() >= NIn, so the pad is mandatory.
    constexpr std::size_t kNIn = ParityMLP::kInput;
    std::array<std::array<float, kNIn>, 3u> features = {};
    features[0][0] = 0.1f; features[0][1] = 0.9f;
    features[1][0] = 0.5f; features[1][1] = 0.5f;
    features[2][0] = 0.9f; features[2][1] = 0.1f;
    auto label_for = [](std::size_t i) {
        std::array<float, 126u> out{};
        const float a = static_cast<float>(i) * 0.3f + 0.05f;
        for (std::size_t j = 0; j < 126u; ++j) {
            out[j] = a + 0.005f * static_cast<float>(j);
        }
        return out;
    };
    for (std::size_t i = 0; i < features.size(); ++i) {
        const auto label = label_for(i);
        mlp.add_example(std::span<const float>(features[i].data(), kNIn),
                        std::span<const float>(label.data(), 126u));
    }
    const float final_loss = mlp.train(0.3f, 50u, 0.0f);

    mlp.set_input(0u, kInputX);
    mlp.set_input(1u, kInputY);
    mlp.process();
    {
        const auto outs = mlp.outputs();
        push_floats(payload, std::span<const float>(outs.data(), 126u));
    }
    payload.push_back(final_loss);

    // ---- Stage 3: PAFSynth ----
    {
        nisps::PAFSynthEngine e;
        e.setup(kSampleRate);
        std::array<float, nisps::PAFSynthEngine::param_count()> p{};
        for (auto& v : p) v = 0.5f;
        e.set_params(std::span<const float>(p.data(), p.size()));
        float l_acc = 0.f, r_acc = 0.f;
        for (std::size_t i = 0; i < kSynthFrames; ++i) {
            const auto y = e.process({0.f, 0.f});
            l_acc += y.L;
            r_acc += y.R;
        }
        payload.push_back(l_acc / static_cast<float>(kSynthFrames));
        payload.push_back(r_acc / static_cast<float>(kSynthFrames));
    }

    // ---- Stage 4: ChannelStrip ----
    {
        nisps::ChannelStripEngine e;
        e.setup(kSampleRate);
        std::array<float, nisps::ChannelStripEngine::param_count()> p{};
        for (auto& v : p) v = 0.5f;
        e.set_params(std::span<const float>(p.data(), p.size()));
        // Process 128 samples of a unit step at 0.25 amplitude.
        float l_acc = 0.f, r_acc = 0.f;
        for (std::size_t i = 0; i < kSynthFrames; ++i) {
            const auto y = e.process({0.25f, 0.25f});
            l_acc += y.L;
            r_acc += y.R;
        }
        payload.push_back(l_acc / static_cast<float>(kSynthFrames));
        payload.push_back(r_acc / static_cast<float>(kSynthFrames));
    }

    // ---- Stage 5: feedback ("Down Action": RandomiseOutputs + RandomiseMlp) ----
    // Seeded exactly as the WASM MLHandle (kSeed XOR kFeedbackSalt) so the
    // controller's static-output RNG stream is bit-reproducible native ↔ WASM.
    // RandomiseOutputs proves the controller's own RNG; RandomiseMlp proves the
    // weight snapshot/restore round-trips identically across platforms. `mlp` is
    // untouched by stages 3-4, so its RNG state here equals post-stage-2.
    {
        nisps::ml::FeedbackController<ParityMLP> fb(kSeed ^ kFeedbackSalt);
        std::array<float, 126u>             sbuf{};
        const std::span<const float>        no_out{};
        const std::span<const std::uint8_t> no_mask{};

        fb.set_mode(nisps::ml::FeedbackMode::RandomiseOutputs, mlp);
        fb.on_down(mlp, no_out, 0.1f, 0.5f, no_mask);  // enter
        fb.static_output(std::span<float>(sbuf));
        push_floats(payload, std::span<const float>(sbuf.data(), 126u));
        fb.on_down(mlp, no_out, 0.1f, 0.5f, no_mask);  // re-roll
        fb.static_output(std::span<float>(sbuf));
        push_floats(payload, std::span<const float>(sbuf.data(), 126u));
        fb.on_up(mlp);                                 // commit (no weight change)

        fb.set_mode(nisps::ml::FeedbackMode::RandomiseMlp, mlp);
        fb.on_down(mlp, no_out, 0.1f, 0.5f, no_mask);  // enter → randomise temp net
        {
            const auto w = mlp.get_weights();
            for (std::size_t idx : kProbeIdx) payload.push_back(idx < w.size() ? w[idx] : 0.f);
        }
        fb.on_up(mlp);                                 // commit → restore original net
        {
            const auto w = mlp.get_weights();
            for (std::size_t idx : kProbeIdx) payload.push_back(idx < w.size() ? w[idx] : 0.f);
        }

        // ---- Stage 5d: ExploreAndPlace lifecycle ----
        // Proves the shared explore→reroll→nudge→undo→place→commit core is bit-
        // reproducible native↔WASM: the scratchpad nudge uses the controller's
        // own per-instance Rng (no libc rand), and the snapshot/restore round-
        // trips identically. We REUSE the same `fb` controller (not a fresh
        // one) so its RNG state matches the WASM MLHandle.feedback, which by
        // this point has drained identical RandomiseOutputs draws on both
        // platforms (enter + reroll = 2*kNOut uniform draws each side).
        fb.set_mode(nisps::ml::FeedbackMode::ExploreAndPlace, mlp);
        fb.enter_explore(mlp, 0.5f);                   // snapshot + randomise scratchpad
        fb.reroll(mlp, 0.5f);                          // scratchpad op (undoable)
        fb.nudge(mlp, 0.05f);                          // controller-Rng perturb
        // Probe the scratchpad net (12 weights) — exercises the new RNG stream.
        {
            const auto w = mlp.get_weights();
            for (std::size_t idx : kProbeIdx) payload.push_back(idx < w.size() ? w[idx] : 0.f);
        }
        fb.undo(mlp);                                  // pop nudge
        // Audition + place at a fixed input; freeze the scratchpad output.
        mlp.set_input(0u, kInputX);
        mlp.set_input(1u, kInputY);
        mlp.process();
        fb.begin_place(mlp);
        // Push the frozen placed output (126 floats) — must match across plats.
        {
            const auto v = fb.placed_output();
            for (std::size_t i = 0; i < 126u; ++i) payload.push_back(i < v.size() ? v[i] : 0.f);
        }
        fb.commit_place(mlp);                          // restore real net
        // After restore, the probed weights must equal the pre-explore real net,
        // and the committed output is the +1 label the caller would store.
        {
            const auto w = mlp.get_weights();
            for (std::size_t idx : kProbeIdx) payload.push_back(idx < w.size() ? w[idx] : 0.f);
            const auto v = fb.committed_output();
            for (std::size_t i = 0; i < 126u; ++i) payload.push_back(i < v.size() ? v[i] : 0.f);
        }

        // ---- Stage 6: geometric dislike (one-core-engine P3) ----
        // Scripted feedback session — likes at two corners feed the replay
        // positives (via the Avoid+Geometric on_up path), then two dislikes at
        // a probed input: the first stores the negative and trains toward the
        // computed push-away target; the second deepens and pushes again. The
        // weight trajectory must match native↔WASM within 1e-5 (the useRandom
        // branch never fires here; the controller Rng is untouched).
        fb.set_mode(nisps::ml::FeedbackMode::Avoid, mlp);

        auto like_at = [&](float x, float y) {
            mlp.set_input(0u, x);
            mlp.set_input(1u, y);
            mlp.process();
            fb.on_up(mlp);  // Avoid+Geometric: store_positive + LikeStore
        };
        like_at(0.2f, 0.2f);
        like_at(0.8f, 0.8f);

        auto dislike_at = [&](float x, float y) {
            mlp.set_input(0u, x);
            mlp.set_input(1u, y);
            mlp.process();
            // The "heard" vector deliberately differs from the raw output
            // (the browser passes the post-pipeline vector) so the push
            // trains meaningfully. f32 arithmetic mirrored in parity_wasm.mjs
            // via Math.fround.
            std::array<float, 126u> heard{};
            const auto outs = mlp.outputs();
            for (std::size_t j = 0; j < 126u; ++j) {
                float v = outs[j] + (((j & 1u) != 0u) ? -0.15f : 0.15f);
                if (v < 0.f) v = 0.f;
                if (v > 1.f) v = 1.f;
                heard[j] = v;
            }
            fb.on_down(mlp, heard, 0.1f, 0.5f, no_mask);
        };
        dislike_at(0.25f, 0.75f);
        dislike_at(0.26f, 0.74f);  // within dedup radius → deepen + push

        payload.push_back(static_cast<float>(fb.positive_count()));
        payload.push_back(static_cast<float>(fb.negative_count()));

        mlp.set_input(0u, kInputX);
        mlp.set_input(1u, kInputY);
        mlp.process();
        {
            const auto outs = mlp.outputs();
            push_floats(payload, std::span<const float>(outs.data(), 126u));
            const auto w = mlp.get_weights();
            for (std::size_t idx : kProbeIdx) payload.push_back(idx < w.size() ? w[idx] : 0.f);
        }
    }

    // ---- Stage 7: pipelines + curves (one-core-engine P4) ----
    // Deterministic rational traces (no transcendentals crossing the JS/C++
    // boundary) through the input chain (2 configs), the output chain
    // (2 configs), and the curve catalog. parity_wasm.mjs drives the same
    // sequences through the C ABI.
    {
        // -- input chain: default config, then a loaded config --
        auto run_input = [&payload](const nisps::pipeline::InputChainConfig& cfg) {
            nisps::pipeline::InputChain ch;
            ch.set_config(cfg);
            const float dt = 1.f / 120.f;
            for (int i = 0; i < 120; ++i) {
                const float x = static_cast<float>((i * 37) % 97) / 96.f;
                const float y = static_cast<float>((i * 53 + 11) % 89) / 88.f;
                const auto r = ch.process(x, y, dt);
                if (i % 10 == 9) {
                    payload.push_back(r.x);
                    payload.push_back(r.y);
                }
            }
        };
        run_input(nisps::pipeline::InputChainConfig{});
        {
            nisps::pipeline::InputChainConfig c;
            c.zoom = 0.7f;
            c.deadzone = 0.1f;
            c.input_curve = 1.8f;
            c.smoothing = 0.6f;
            c.momentum_mode = nisps::pipeline::MomentumMode::Strong;
            c.invert_x = true;
            run_input(c);
        }

        // -- output chain: default, then loaded config with a freeze mask --
        auto run_output = [&payload](const nisps::pipeline::OutputChainConfig& cfg,
                                     bool with_mask) {
            nisps::pipeline::OutputChain<16u> ch;
            ch.set_config(cfg);
            if (with_mask) {
                std::uint8_t mask[16u];
                for (std::size_t j = 0; j < 16u; ++j) {
                    mask[j] = (j % 2u == 0u) ? 1u : 0u;
                }
                ch.set_freeze_mask(mask);
            }
            const float dt = 1.f / 60.f;
            float vec[16u];
            float out[16u];
            for (int i = 0; i < 60; ++i) {
                for (std::size_t j = 0; j < 16u; ++j) {
                    vec[j] = static_cast<float>((i * 13 + static_cast<int>(j) * 29) % 101) / 100.f;
                }
                ch.process(std::span<const float>(vec), std::span<float>(out), dt);
                if (i % 15 == 14) {
                    for (std::size_t j = 0; j < 16u; ++j) payload.push_back(out[j]);
                }
            }
        };
        run_output(nisps::pipeline::OutputChainConfig{}, false);
        {
            nisps::pipeline::OutputChainConfig c;
            c.global_curve = 2.2f;
            c.smoothing = 0.5f;
            c.slew_rate = 2.0f;
            run_output(c, true);
        }

        // -- curve catalog: ids 0..6 (enum) + centred power (param 1.7) --
        for (int id = 0; id <= 7; ++id) {
            for (int i = 0; i <= 16; ++i) {
                const float x = static_cast<float>(i) / 16.f;
                const float v = (id == 7)
                    ? nisps::centered_power(x, 1.7f)
                    : nisps::apply_curve(static_cast<nisps::Curve>(id), x);
                payload.push_back(v);
            }
        }
    }

    // ---- Sanity: every value finite ----
    for (std::size_t i = 0; i < payload.size(); ++i) {
        if (!std::isfinite(payload[i])) {
            std::fprintf(stderr,
                         "[parity_native] non-finite value at offset %zu: %f\n",
                         i, payload[i]);
            return 2;
        }
    }

    if (!write_blob(out_path, payload)) {
        std::fprintf(stderr, "[parity_native] failed to write %s\n", out_path.c_str());
        return 3;
    }
    std::printf("[parity_native] wrote %zu floats to %s\n", payload.size(), out_path.c_str());
    return 0;
}
