// nisps/wasm/bindings.cpp — flat C API exported to the Manifold browser app.
//
// Two consumers per build:
//   1. Main-thread WasmIML (manifold/src/engine/wasm-iml.ts)          — ML calls.
//   2. AudioWorklet processor (manifold/src/engine/worklet/...)       — engine
//      calls. (Each instance owns its own WASM module instance.)
//
// ARCHITECTURE (runtime-shaped since one-core-engine-refactor P2)
// ---------------------------------------------------------------------
// The browser MLP is `MLPCore<DynamicStorage>`: `nisps_ml_create()` HONOURS
// its caller-supplied input_size / output_size / hidden[3] arguments. The
// topology stays fixed at 4 layers (ReLU×3 + Sigmoid); only the dimensions
// are runtime. Non-positive / missing arguments fall back to the historical
// compiled defaults (32 → [10, 14, 18] → 126), which keeps every pre-P2
// caller — including the parity harness — bit-identical (FixedStorage and
// DynamicStorage are bit-parity-tested for equal shapes/seeds).
//
// Reshape = `nisps_ml_reshape()`: a NEW instance at the new dimensions,
// warm-started by copying the overlapping weight region from the old net
// (nisps/ml/warm_start.hpp); weights outside the overlap keep the fresh
// spread-initialised values. The feedback controller is re-created at the
// new dimensions (its exploration state resets — the front-end shows a
// reset-on-reshape modal).
//
// WIRE FORMAT FOR WEIGHTS
// -----------------------
// The flat layout matches `nisps::ml::MLP::get_weights()`:
//
//   [layer0_weights] [layer1_weights] [layer2_weights] [layer3_weights]
//   [layer0_biases]  [layer1_biases]  [layer2_biases]  [layer3_biases]
//
// Total count = `nisps_ml_weight_count()`. Both endianness and float layout
// match the host (Emscripten produces little-endian Float32Array-friendly
// memory).
//
// LAYER-STATS LAYOUT
// ------------------
// `nisps_ml_get_layer_stats()` writes 4 floats per layer into the caller
// buffer: [mean_abs, max_abs, dead_frac, saturating_frac]. Total = 16
// floats for 4 layers.

#include <emscripten.h>
#include <emscripten/emscripten.h>

#include <array>
#include <cstdint>
#include <cstring>
#include <span>
#include <string>
#include <string_view>
#include <vector>

// Engines.
#include "../engines/analysis.hpp"
#include "../engines/base.hpp"
#include "../engines/breakor.hpp"
#include "../engines/channel_strip.hpp"
#include "../engines/elysiamorf.hpp"
#include "../engines/memlcelium.hpp"
#include "../engines/paf_synth.hpp"
#include "../engines/verb_fx.hpp"
#include "../engines/xiasri.hpp"

// ML.
#include "../core/math.hpp"
#include "../core/types.hpp"
#include "../ml/dynamic_storage.hpp"
#include "../ml/feedback.hpp"
#include "../ml/jolt.hpp"
#include "../ml/mlp.hpp"
#include "../ml/ou_noise.hpp"
#include "../ml/stats.hpp"
#include "../ml/warm_start.hpp"

// Pipelines (one-core-engine P4).
#include "../pipeline/input_chain.hpp"
#include "../pipeline/output_chain.hpp"

namespace {

// ---------------------------------------------------------------------------
// ML side
// ---------------------------------------------------------------------------

// Historical compiled defaults. Non-positive / missing create() args fall
// back to these, keeping every pre-P2 caller bit-identical.
//   * 32 inputs           — MAX composed input axes the manifold front-end
//     feeds (matches MAX_AXES in manifold/src/inputs/input-layer.ts).
//   * [10, 14, 18] hidden — covers the largest schema layouts in
//     `schemas/modes/*.json`.
//   * 126 outputs         — enough for the C15 mode and any current schema.
constexpr std::size_t kDefaultInputs    = 32u;
constexpr std::size_t kDefaultHidden[3] = {10u, 14u, 18u};
constexpr std::size_t kDefaultOutputs   = 126u;
// Sanity ceiling per dimension — create/reshape reject anything larger.
constexpr std::size_t kMaxDim = 4096u;

constexpr std::uint64_t kFeedbackSalt = 0xFEEDBACC0DEull;
// Distinct salts keep the jolt/OU RNG streams independent of the MLP's and
// the feedback controller's (mirrors the firmware ModeBase seeding).
constexpr std::uint64_t kJoltSalt = 0xB01DFACEull;
constexpr std::uint64_t kOUSalt   = 0x0DDBA11ull;

using BrowserMLP = nisps::ml::MLPCore<nisps::ml::DynamicStorage>;
using BrowserFeedback =
    nisps::ml::FeedbackControllerCore<nisps::ml::DynamicFeedbackStorage>;

constexpr std::size_t kFeedbackUndoDepth = 4u;
// Browser replay capacity (rl-feedback-design §4: WASM 64, firmware 32).
constexpr std::size_t kFeedbackReplayCap = 64u;

struct MlDims {
    std::size_t n_in;
    std::size_t hidden[3];
    std::size_t n_out;
    bool        ok;
};

// Sanitise caller-supplied dims. Non-positive input/output and missing /
// non-3-entry hidden lists fall back to the defaults; out-of-range values
// make the request invalid.
MlDims sanitise_dims(int input_size, int output_size,
                     const int* hidden, int n_hidden) noexcept {
    MlDims d{kDefaultInputs,
             {kDefaultHidden[0], kDefaultHidden[1], kDefaultHidden[2]},
             kDefaultOutputs,
             true};
    if (input_size > 0) d.n_in = static_cast<std::size_t>(input_size);
    if (output_size > 0) d.n_out = static_cast<std::size_t>(output_size);
    if (hidden && n_hidden == 3) {
        for (std::size_t i = 0; i < 3u; ++i) {
            if (hidden[i] <= 0) { d.ok = false; return d; }
            d.hidden[i] = static_cast<std::size_t>(hidden[i]);
        }
    } else if (hidden && n_hidden != 0) {
        d.ok = false;  // the 4-layer topology needs exactly 3 hidden sizes
        return d;
    }
    if (d.n_in > kMaxDim || d.n_out > kMaxDim ||
        d.hidden[0] > kMaxDim || d.hidden[1] > kMaxDim || d.hidden[2] > kMaxDim) {
        d.ok = false;
    }
    return d;
}

// We allocate the MLP on the heap (one-off — not the audio path) and return
// the opaque pointer to JS.
struct MLHandle {
    std::uint64_t seed64;
    BrowserMLP mlp;
    // "Down Action" negative-feedback controller (Avoid/RandomiseOutputs/
    // RandomiseMlp/ExploreAndPlace). Seeded off the MLP seed XOR a salt so
    // its static-output RNG stream is independent of the MLP's RNG.
    BrowserFeedback feedback;
    // Buffers used to bridge JS → C++ (sized to the instance's dims):
    std::vector<float> output_scratch;
    // Stats buffer fed back to JS via get_layer_stats.
    std::array<float, BrowserMLP::kNumLayers * 4u> stats_scratch{};
    // Static-output buffer for the RandomiseOutputs bypass path.
    std::vector<float> feedback_static_scratch;
    // Jolt (held weight morph) + OU exploration noise — the P3 gesture
    // engines, same code the firmware ModeBase runs. Jolt operates on the
    // flat weight buffer via jolt_scratch; OU state is over-provisioned to
    // kMaxDim and applies to the first n_out entries.
    nisps::ml::Jolt jolt;
    nisps::ml::OUNoise<kMaxDim> ou;
    std::vector<float> jolt_scratch;
    // infer_batch cap; callers must split larger requests.
    static constexpr std::size_t kMaxBatch = 4096u;

    MLHandle(std::uint64_t seed, const MlDims& d) noexcept
        : seed64(seed),
          mlp(seed, d.n_in, std::span<const std::size_t>(d.hidden, 3u), d.n_out),
          feedback(seed ^ kFeedbackSalt, d.n_out, mlp.weight_count(), kFeedbackUndoDepth,
                   d.n_in, kFeedbackReplayCap),
          output_scratch(d.n_out, 0.f),
          feedback_static_scratch(d.n_out, 0.f),
          jolt(seed ^ kJoltSalt),
          ou(seed ^ kOUSalt),
          jolt_scratch(mlp.weight_count(), 0.f) {}

    bool valid() const noexcept { return mlp.valid() && feedback.valid(); }
    std::size_t n_in()  const noexcept { return mlp.n_in(); }
    std::size_t n_out() const noexcept { return mlp.n_out(); }
};

// ---------------------------------------------------------------------------
// Pipeline side (one-core-engine P4): the input/output processing chains,
// state C++-side per handle. The output chain is capacity-templated; the
// browser instantiates the kMaxDim cap.
// ---------------------------------------------------------------------------

struct PipelineHandle {
    nisps::pipeline::InputChain            input;
    nisps::pipeline::OutputChain<kMaxDim>  output;
};

// ---------------------------------------------------------------------------
// Engine side
// ---------------------------------------------------------------------------

// Variant-style dispatch. Each create call instantiates ONE engine kind
// stored on the heap; the type is recorded in `kind` so process_block can
// dispatch without RTTI.
//
// We DO NOT use std::variant — Emscripten supports it but the overhead is
// unwanted. A discriminated union of pointers is enough.
enum class EngineKind : std::uint8_t {
    NoOp,
    PAFSynth,
    ChannelStrip,
    XIASRI,
    VerbFX,
    MEMLCelium,
    BreakOr,
    Elysiamorf,
    Analysis,
};

struct EngineHandle {
    EngineKind kind = EngineKind::NoOp;
    void*      ptr  = nullptr;
};

template <typename EngineT>
inline EngineHandle make_handle(EngineKind kind, float sr) noexcept {
    auto* e = new EngineT();
    e->setup(sr);
    return EngineHandle{kind, static_cast<void*>(e)};
}

template <typename EngineT>
inline void destroy_typed(void* ptr) noexcept {
    delete static_cast<EngineT*>(ptr);
}

template <typename EngineT>
inline void set_params_typed(void* ptr, std::span<const float> params) noexcept {
    static_cast<EngineT*>(ptr)->set_params(params);
}

template <typename EngineT>
inline void process_typed(void* ptr,
                          const float* in_l, const float* in_r,
                          float* out_l, float* out_r,
                          int n_samples) noexcept {
    auto* e = static_cast<EngineT*>(ptr);
    for (int i = 0; i < n_samples; ++i) {
        nisps::stereosample_t s{in_l ? in_l[i] : 0.f, in_r ? in_r[i] : 0.f};
        const auto y = e->process(s);
        if (out_l) out_l[i] = y.L;
        if (out_r) out_r[i] = y.R;
    }
}

EngineHandle dispatch_create(std::string_view id, float sample_rate) noexcept {
    using nisps::NoOpEngine;
    using nisps::PAFSynthEngine;
    using nisps::ChannelStripEngine;
    using nisps::XIASRIEngine;
    using nisps::VerbFXEngine;
    using nisps::MEMLCeliumEngine;
    using nisps::BreakOrEngine;
    using nisps::ElysiamorfEngine;
    using nisps::AnalysisEngine;

    if (id == NoOpEngine::engine_id())            return make_handle<NoOpEngine>(EngineKind::NoOp, sample_rate);
    if (id == PAFSynthEngine::engine_id())        return make_handle<PAFSynthEngine>(EngineKind::PAFSynth, sample_rate);
    if (id == ChannelStripEngine::engine_id())    return make_handle<ChannelStripEngine>(EngineKind::ChannelStrip, sample_rate);
    if (id == XIASRIEngine::engine_id())          return make_handle<XIASRIEngine>(EngineKind::XIASRI, sample_rate);
    if (id == VerbFXEngine::engine_id())          return make_handle<VerbFXEngine>(EngineKind::VerbFX, sample_rate);
    if (id == MEMLCeliumEngine::engine_id())      return make_handle<MEMLCeliumEngine>(EngineKind::MEMLCelium, sample_rate);
    if (id == BreakOrEngine::engine_id())         return make_handle<BreakOrEngine>(EngineKind::BreakOr, sample_rate);
    if (id == ElysiamorfEngine::engine_id())      return make_handle<ElysiamorfEngine>(EngineKind::Elysiamorf, sample_rate);
    if (id == AnalysisEngine::engine_id())        return make_handle<AnalysisEngine>(EngineKind::Analysis, sample_rate);

    // Unknown id → fall back to NoOp so the worklet is at least silent
    // rather than UB.
    return make_handle<NoOpEngine>(EngineKind::NoOp, sample_rate);
}

void dispatch_destroy(EngineHandle& h) noexcept {
    using nisps::NoOpEngine;
    using nisps::PAFSynthEngine;
    using nisps::ChannelStripEngine;
    using nisps::XIASRIEngine;
    using nisps::VerbFXEngine;
    using nisps::MEMLCeliumEngine;
    using nisps::BreakOrEngine;
    using nisps::ElysiamorfEngine;
    using nisps::AnalysisEngine;

    if (!h.ptr) return;
    switch (h.kind) {
        case EngineKind::NoOp:         destroy_typed<NoOpEngine>(h.ptr); break;
        case EngineKind::PAFSynth:     destroy_typed<PAFSynthEngine>(h.ptr); break;
        case EngineKind::ChannelStrip: destroy_typed<ChannelStripEngine>(h.ptr); break;
        case EngineKind::XIASRI:       destroy_typed<XIASRIEngine>(h.ptr); break;
        case EngineKind::VerbFX:       destroy_typed<VerbFXEngine>(h.ptr); break;
        case EngineKind::MEMLCelium:   destroy_typed<MEMLCeliumEngine>(h.ptr); break;
        case EngineKind::BreakOr:      destroy_typed<BreakOrEngine>(h.ptr); break;
        case EngineKind::Elysiamorf:   destroy_typed<ElysiamorfEngine>(h.ptr); break;
        case EngineKind::Analysis:     destroy_typed<AnalysisEngine>(h.ptr); break;
    }
    h.ptr = nullptr;
}

void dispatch_set_params(EngineHandle& h, std::span<const float> params) noexcept {
    using nisps::NoOpEngine;
    using nisps::PAFSynthEngine;
    using nisps::ChannelStripEngine;
    using nisps::XIASRIEngine;
    using nisps::VerbFXEngine;
    using nisps::MEMLCeliumEngine;
    using nisps::BreakOrEngine;
    using nisps::ElysiamorfEngine;
    using nisps::AnalysisEngine;

    switch (h.kind) {
        case EngineKind::NoOp:         set_params_typed<NoOpEngine>(h.ptr, params); break;
        case EngineKind::PAFSynth:     set_params_typed<PAFSynthEngine>(h.ptr, params); break;
        case EngineKind::ChannelStrip: set_params_typed<ChannelStripEngine>(h.ptr, params); break;
        case EngineKind::XIASRI:       set_params_typed<XIASRIEngine>(h.ptr, params); break;
        case EngineKind::VerbFX:       set_params_typed<VerbFXEngine>(h.ptr, params); break;
        case EngineKind::MEMLCelium:   set_params_typed<MEMLCeliumEngine>(h.ptr, params); break;
        case EngineKind::BreakOr:      set_params_typed<BreakOrEngine>(h.ptr, params); break;
        case EngineKind::Elysiamorf:   set_params_typed<ElysiamorfEngine>(h.ptr, params); break;
        case EngineKind::Analysis:     set_params_typed<AnalysisEngine>(h.ptr, params); break;
    }
}

void dispatch_process_block(EngineHandle& h,
                            const float* in_l, const float* in_r,
                            float* out_l, float* out_r,
                            int n_samples) noexcept {
    using nisps::NoOpEngine;
    using nisps::PAFSynthEngine;
    using nisps::ChannelStripEngine;
    using nisps::XIASRIEngine;
    using nisps::VerbFXEngine;
    using nisps::MEMLCeliumEngine;
    using nisps::BreakOrEngine;
    using nisps::ElysiamorfEngine;
    using nisps::AnalysisEngine;

    switch (h.kind) {
        case EngineKind::NoOp:         process_typed<NoOpEngine>(h.ptr, in_l, in_r, out_l, out_r, n_samples); break;
        case EngineKind::PAFSynth:     process_typed<PAFSynthEngine>(h.ptr, in_l, in_r, out_l, out_r, n_samples); break;
        case EngineKind::ChannelStrip: process_typed<ChannelStripEngine>(h.ptr, in_l, in_r, out_l, out_r, n_samples); break;
        case EngineKind::XIASRI:       process_typed<XIASRIEngine>(h.ptr, in_l, in_r, out_l, out_r, n_samples); break;
        case EngineKind::VerbFX:       process_typed<VerbFXEngine>(h.ptr, in_l, in_r, out_l, out_r, n_samples); break;
        case EngineKind::MEMLCelium:   process_typed<MEMLCeliumEngine>(h.ptr, in_l, in_r, out_l, out_r, n_samples); break;
        case EngineKind::BreakOr:      process_typed<BreakOrEngine>(h.ptr, in_l, in_r, out_l, out_r, n_samples); break;
        case EngineKind::Elysiamorf:   process_typed<ElysiamorfEngine>(h.ptr, in_l, in_r, out_l, out_r, n_samples); break;
        case EngineKind::Analysis:     process_typed<AnalysisEngine>(h.ptr, in_l, in_r, out_l, out_r, n_samples); break;
    }
}

}  // anonymous namespace

extern "C" {

// ---------------------------------------------------------------------------
// ML lifecycle
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void* nisps_ml_create(int input_size, int output_size,
                     const int* hidden, int n_hidden,
                     uint32_t seed) {
    // Dimensions are HONOURED (runtime-shaped MLP); non-positive/missing args
    // fall back to the historical defaults. See file header.
    //
    // NOTE: the C++ Rng takes uint64_t; we sign-extend the 32-bit seed into
    // the high 32 bits via xor-shift so callers passing zero still get a
    // non-degenerate seed. Truly 64-bit seeds are not exposed to JS — the
    // front-end doesn't need them, and avoiding BigInt at the boundary
    // simplifies both wasm-iml.ts and wasm-worker.ts.
    const MlDims d = sanitise_dims(input_size, output_size, hidden, n_hidden);
    if (!d.ok) return nullptr;
    const std::uint64_t s64 = static_cast<std::uint64_t>(seed) ^
                              (static_cast<std::uint64_t>(seed) << 32);
    auto* h = new MLHandle(s64, d);
    if (!h->valid()) {
        delete h;
        return nullptr;
    }
    return static_cast<void*>(h);
}

// Reshape: construct a NEW net at the requested dimensions (same seed
// stream restart, fresh spread-init), warm-start it with the overlapping
// weights of the current net, then swap it in. The feedback controller is
// re-created at the new dims (exploration state resets). Returns 1 on
// success; 0 leaves the existing net untouched.
EMSCRIPTEN_KEEPALIVE
int nisps_ml_reshape(void* ml, int input_size, int output_size,
                     const int* hidden, int n_hidden, float spread) {
    if (!ml) return 0;
    auto* h = static_cast<MLHandle*>(ml);
    const MlDims d = sanitise_dims(input_size, output_size, hidden, n_hidden);
    if (!d.ok) return 0;

    BrowserMLP fresh(h->seed64, d.n_in, std::span<const std::size_t>(d.hidden, 3u), d.n_out);
    if (!fresh.valid()) return 0;
    fresh.draw_weights(spread);
    nisps::ml::warm_start_copy(fresh, h->mlp);

    BrowserFeedback fb(h->seed64 ^ kFeedbackSalt, d.n_out, fresh.weight_count(),
                       kFeedbackUndoDepth, d.n_in, kFeedbackReplayCap);
    if (!fb.valid()) return 0;

    h->mlp      = static_cast<BrowserMLP&&>(fresh);
    h->feedback = static_cast<BrowserFeedback&&>(fb);
    h->output_scratch.assign(d.n_out, 0.f);
    h->feedback_static_scratch.assign(d.n_out, 0.f);
    h->jolt.release();
    h->ou.reset();
    h->jolt_scratch.assign(h->mlp.weight_count(), 0.f);
    return 1;
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_destroy(void* ml) {
    if (!ml) return;
    delete static_cast<MLHandle*>(ml);
}

// ---------------------------------------------------------------------------
// ML inference
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void nisps_ml_set_input(void* ml, int idx, float v) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    if (idx < 0) return;
    if (static_cast<std::size_t>(idx) >= h->n_in()) return;
    h->mlp.set_input(static_cast<std::size_t>(idx), v);
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_process(void* ml) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->mlp.process();
    auto outs = h->mlp.outputs();
    const std::size_t n_out = h->n_out();
    for (std::size_t i = 0; i < n_out; ++i) h->output_scratch[i] = outs[i];
}

EMSCRIPTEN_KEEPALIVE
const float* nisps_ml_outputs(void* ml) {
    if (!ml) return nullptr;
    auto* h = static_cast<MLHandle*>(ml);
    return h->output_scratch.data();
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_infer_batch(void* ml, const float* points, int n_points, float* out) {
    if (!ml || !points || !out || n_points <= 0) return;
    auto* h = static_cast<MLHandle*>(ml);
    const std::size_t n_in  = h->n_in();
    const std::size_t n_out = h->n_out();
    const std::size_t n = static_cast<std::size_t>(n_points);
    if (n > MLHandle::kMaxBatch) {
        // Caller exceeded the batch cap. Process what we can.
        const std::size_t safe_n = MLHandle::kMaxBatch;
        h->mlp.infer_batch(
            std::span<const float>(points, safe_n * n_in),
            std::span<float>(out, safe_n * n_out));
        return;
    }
    h->mlp.infer_batch(
        std::span<const float>(points, n * n_in),
        std::span<float>(out, n * n_out));
}

// ---------------------------------------------------------------------------
// ML training
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void nisps_ml_add_example(void* ml, const float* features, const float* labels) {
    if (!ml || !features || !labels) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->mlp.add_example(
        std::span<const float>(features, h->n_in()),
        std::span<const float>(labels, h->n_out()));
}

EMSCRIPTEN_KEEPALIVE
float nisps_ml_train(void* ml, float lr, int max_iter, float min_err,
                    const float* sample_weights) {
    if (!ml) return 0.f;
    auto* h = static_cast<MLHandle*>(ml);
    if (max_iter <= 0) max_iter = 1;
    std::span<const float> weights;
    if (sample_weights) {
        weights = std::span<const float>(sample_weights, h->mlp.example_count());
    }
    return h->mlp.train(lr, static_cast<std::size_t>(max_iter), min_err, weights);
}

EMSCRIPTEN_KEEPALIVE
float nisps_ml_eval_loss(void* ml) {
    if (!ml) return 0.f;
    auto* h = static_cast<MLHandle*>(ml);
    return h->mlp.eval_loss();
}

// ---------------------------------------------------------------------------
// ML weights
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
int nisps_ml_weight_count(void* ml) {
    if (!ml) {
        // Handle-less callers get the default shape's count.
        const MlDims d = sanitise_dims(0, 0, nullptr, 0);
        return static_cast<int>(
            d.n_in * d.hidden[0] + d.hidden[0] * d.hidden[1] +
            d.hidden[1] * d.hidden[2] + d.hidden[2] * d.n_out +
            d.hidden[0] + d.hidden[1] + d.hidden[2] + d.n_out);
    }
    return static_cast<int>(static_cast<MLHandle*>(ml)->mlp.weight_count());
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_get_weights(void* ml, float* out) {
    if (!ml || !out) return;
    auto* h = static_cast<MLHandle*>(ml);
    auto w = h->mlp.get_weights();
    std::memcpy(out, w.data(), w.size() * sizeof(float));
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_set_weights(void* ml, const float* in) {
    if (!ml || !in) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->mlp.set_weights(std::span<const float>(in, h->mlp.weight_count()));
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_draw_weights(void* ml, float spread) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->mlp.draw_weights(spread);
}

// ---------------------------------------------------------------------------
// ML feedback — the "Down Action" state machine (Avoid / RandomiseOutputs /
// RandomiseMlp). The controller decides WHAT transition happened (returns a
// FeedbackAction int); JS performs the side effect (store example, grow noise,
// train). See nisps/ml/feedback.hpp. Mode ints: 0=Avoid 1=RandOut 2=RandMlp.
// Action ints mirror nisps::ml::FeedbackAction.
//
// CALLER CONTRACT (commit ordering — important):
//   On a "keep" (up) or drag-commit while exploring RandomiseMlp, the controller
//   RESTORES the original net before returning. The output the user is hearing
//   comes from the *temporary* (randomised) net, so you MUST capture the current
//   output (nisps_ml_outputs / nisps_ml_feedback_static_output) BEFORE calling
//   nisps_ml_feedback_up / _drag, then store THAT captured vector as the +1
//   example. Reading the output AFTER the call yields the restored (wrong) net.
//   nisps_ml_feedback_down with current_out should pass the full n_out
//   live vector (RandomiseOutputs freezes unfocused dims at those values).
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void nisps_ml_feedback_set_mode(void* ml, int mode) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    nisps::ml::FeedbackMode m = nisps::ml::FeedbackMode::Avoid;
    if (mode == 1) m = nisps::ml::FeedbackMode::RandomiseOutputs;
    else if (mode == 2) m = nisps::ml::FeedbackMode::RandomiseMlp;
    else if (mode == 3) m = nisps::ml::FeedbackMode::ExploreAndPlace;
    h->feedback.set_mode(m, h->mlp);
}

EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_get_mode(void* ml) {
    if (!ml) return 0;
    return static_cast<int>(static_cast<MLHandle*>(ml)->feedback.mode());
}

EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_exploring(void* ml) {
    if (!ml) return 0;
    return static_cast<MLHandle*>(ml)->feedback.exploring() ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_feedback_set_focus(void* ml, const uint8_t* mask, int n) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    if (!mask || n <= 0) {
        h->feedback.clear_focus_mask();
        return;
    }
    h->feedback.set_focus_mask(
        std::span<const std::uint8_t>(mask, static_cast<std::size_t>(n)));
}

// current_out = n_out floats the user is hearing (may be null).
// pin_mask may be null. Returns the FeedbackAction int.
EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_down(void* ml, const float* current_out,
                           float speed, float spread, const uint8_t* pin_mask) {
    if (!ml) return 0;
    auto* h = static_cast<MLHandle*>(ml);
    std::span<const float> out;
    if (current_out) out = std::span<const float>(current_out, h->n_out());
    std::span<const std::uint8_t> mask;
    if (pin_mask) mask = std::span<const std::uint8_t>(pin_mask, h->n_out());
    return static_cast<int>(h->feedback.on_down(h->mlp, out, speed, spread, mask));
}

EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_up(void* ml) {
    if (!ml) return 0;
    auto* h = static_cast<MLHandle*>(ml);
    return static_cast<int>(h->feedback.on_up(h->mlp));
}

// If returns 1, `out` (n_out floats) holds the static bypass vector
// and the caller should NOT call nisps_ml_process(); if 0, run process().
EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_static_output(void* ml, float* out) {
    if (!ml || !out) return 0;
    auto* h = static_cast<MLHandle*>(ml);
    const bool bypass = h->feedback.static_output(std::span<float>(
        h->feedback_static_scratch.data(), h->feedback_static_scratch.size()));
    if (bypass) {
        std::memcpy(out, h->feedback_static_scratch.data(),
                    h->n_out() * sizeof(float));
    }
    return bypass ? 1 : 0;
}

// ---------------------------------------------------------------------------
// ML feedback — ExploreAndPlace lifecycle (Idle → Exploring → Placing → Idle).
// Granular transitions so the SAME shared core drives both the browser (which
// also uses on_down/on_up via _down/_up) and firmware (which maps buttons to
// these directly). Set mode 3 (ExploreAndPlace) via nisps_ml_feedback_set_mode.
//
// CALLER CONTRACT (commit ordering): on _commit_place the controller restores
// the REAL net; the caller then reads nisps_ml_feedback_committed_output and
// adds it as the +1 example label at the chosen input, then trains.
// ---------------------------------------------------------------------------

// Idle→Exploring: snapshot the real net, randomise a scratchpad.
EMSCRIPTEN_KEEPALIVE
void nisps_ml_feedback_enter_explore(void* ml, float spread) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->feedback.enter_explore(h->mlp, spread);
}

// Exploring→Idle: restore the real net, discard scratchpad.
EMSCRIPTEN_KEEPALIVE
void nisps_ml_feedback_exit_explore(void* ml) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->feedback.exit_explore(h->mlp);
}

// Exploring scratchpad op: re-randomise.
EMSCRIPTEN_KEEPALIVE
void nisps_ml_feedback_reroll(void* ml, float spread) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->feedback.reroll(h->mlp, spread);
}

// Exploring scratchpad op: bounded nudge (amount = noise stddev, e.g. 0.05).
EMSCRIPTEN_KEEPALIVE
void nisps_ml_feedback_nudge(void* ml, float amount) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->feedback.nudge(h->mlp, amount);
}

// Exploring scratchpad op: undo last reroll/nudge.
EMSCRIPTEN_KEEPALIVE
void nisps_ml_feedback_undo(void* ml) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->feedback.undo(h->mlp);
}

// Exploring→Placing: freeze the scratchpad output at its CURRENT input.
EMSCRIPTEN_KEEPALIVE
void nisps_ml_feedback_like(void* ml) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->feedback.begin_place(h->mlp);
}

// Placing→Idle: restore the real net. Caller then reads committed_output and
// stores the +1 example at the chosen input.
EMSCRIPTEN_KEEPALIVE
void nisps_ml_feedback_commit_place(void* ml) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->feedback.commit_place(h->mlp);
}

// Placing→Exploring: back out of placing (no store).
EMSCRIPTEN_KEEPALIVE
void nisps_ml_feedback_cancel_place(void* ml) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->feedback.cancel_place();
}

// Scratchpad undo-ring depth currently available to pop.
EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_undo_depth(void* ml) {
    if (!ml) return 0;
    return static_cast<int>(static_cast<MLHandle*>(ml)->feedback.undo_depth());
}

// Writes the committed/placed output vector (n_out floats) into `out`.
// Returns 1 if a vector was written (placing OR a fresh commit), else 0. Reads
// committed_output() (valid post-commit) falling back to placed_output() (while
// placing) so the caller can grab the label either before or after commit.
EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_placed_output(void* ml, float* out) {
    if (!ml || !out) return 0;
    auto* h = static_cast<MLHandle*>(ml);
    std::span<const float> v = h->feedback.committed_output();
    if (v.empty()) v = h->feedback.placed_output();
    if (v.empty()) return 0;
    const std::size_t n = (v.size() < h->n_out()) ? v.size() : h->n_out();
    std::memcpy(out, v.data(), n * sizeof(float));
    return 1;
}

// ---------------------------------------------------------------------------
// ML feedback — geometric dislike (one-core-engine P3; rl-feedback-design
// §2.1). The Avoid mode's default realisation. current_out may be null (the
// MLP's live output is used — note the zero-derivative caveat: pass the
// HEARD post-pipeline vector for an audible push). lr <= 0 uses the
// controller default (1e-3, upstream).
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_dislike_geometric(void* ml, const float* current_out, float lr) {
    if (!ml) return 0;
    auto* h = static_cast<MLHandle*>(ml);
    std::span<const float> out;
    if (current_out) out = std::span<const float>(current_out, h->n_out());
    const float use_lr = (lr > 0.f) ? lr : h->feedback.geo_lr();
    return static_cast<int>(h->feedback.dislike_geometric(h->mlp, out, use_lr));
}

// Store a positive (like) into the replay memory so the k-NN centroid sees
// it. current_out may be null (live output used). The caller still runs its
// usual addExample + train.
EMSCRIPTEN_KEEPALIVE
void nisps_ml_feedback_store_positive(void* ml, const float* current_out) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    std::span<const float> out;
    if (current_out) out = std::span<const float>(current_out, h->n_out());
    h->feedback.store_positive(h->mlp, out);
}

EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_positive_count(void* ml) {
    if (!ml) return 0;
    return static_cast<int>(static_cast<MLHandle*>(ml)->feedback.positive_count());
}

EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_negative_count(void* ml) {
    if (!ml) return 0;
    return static_cast<int>(static_cast<MLHandle*>(ml)->feedback.negative_count());
}

// Avoid sub-mode: 0 = Geometric (default), 1 = Diffuse (legacy move_weights,
// kept for A/B comparison).
EMSCRIPTEN_KEEPALIVE
void nisps_ml_feedback_set_avoid_style(void* ml, int style) {
    if (!ml) return;
    static_cast<MLHandle*>(ml)->feedback.set_avoid_style(
        style == 1 ? nisps::ml::AvoidStyle::Diffuse : nisps::ml::AvoidStyle::Geometric);
}

// ---------------------------------------------------------------------------
// Jolt (held weight morph) + OU exploration noise (one-core-engine P3.2) —
// the same nisps/ml/{jolt,ou_noise}.hpp the firmware ModeBase runs.
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void nisps_ml_jolt_press(void* ml) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->jolt.press(h->mlp.weight_count());
}

// One ~200 Hz morph tick while held (no-op when inactive): reads the flat
// weights, glides the jolt-selected few, writes them back.
EMSCRIPTEN_KEEPALIVE
void nisps_ml_jolt_step(void* ml) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    if (!h->jolt.active()) return;
    auto w = h->mlp.get_weights();
    for (std::size_t i = 0; i < w.size(); ++i) h->jolt_scratch[i] = w[i];
    h->jolt.step(std::span<float>(h->jolt_scratch.data(), w.size()));
    h->mlp.set_weights(std::span<const float>(h->jolt_scratch.data(), w.size()));
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_jolt_release(void* ml) {
    if (!ml) return;
    static_cast<MLHandle*>(ml)->jolt.release();
}

EMSCRIPTEN_KEEPALIVE
int nisps_ml_jolt_active(void* ml) {
    if (!ml) return 0;
    return static_cast<MLHandle*>(ml)->jolt.active() ? 1 : 0;
}

// Exploration amount in [0,1]; 0 disables (inert — parity-safe).
EMSCRIPTEN_KEEPALIVE
void nisps_ml_explore_intensity(void* ml, float level) {
    if (!ml) return;
    static_cast<MLHandle*>(ml)->ou.set_intensity(level);
}

EMSCRIPTEN_KEEPALIVE
float nisps_ml_explore_get_intensity(void* ml) {
    if (!ml) return 0.f;
    return static_cast<MLHandle*>(ml)->ou.intensity();
}

// Advance the OU walk and add it (clamped to [0,1]) to `inout` (n floats,
// capped at the instance's n_out). No-op at intensity 0.
EMSCRIPTEN_KEEPALIVE
void nisps_ml_explore_apply(void* ml, float* inout, int n) {
    if (!ml || !inout || n <= 0) return;
    auto* h = static_cast<MLHandle*>(ml);
    std::size_t count = static_cast<std::size_t>(n);
    if (count > h->n_out()) count = h->n_out();
    h->ou.apply(std::span<float>(inout, count));
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_get_layer_stats(void* ml, float* out_stats) {
    if (!ml || !out_stats) return;
    auto* h = static_cast<MLHandle*>(ml);
    for (std::size_t i = 0; i < BrowserMLP::kNumLayers; ++i) {
        const auto s = h->mlp.layer_stats(i);
        out_stats[i * 4u + 0u] = s.mean_abs;
        out_stats[i * 4u + 1u] = s.max_abs;
        out_stats[i * 4u + 2u] = s.dead_frac;
        out_stats[i * 4u + 3u] = s.saturating_frac;
    }
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_clear_examples(void* ml) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->mlp.clear_examples();
}

// Architecture introspection — writes [in, h1, h2, h3, out, n_layers,
// max_examples] into a caller-supplied int buffer. Always 7 ints. With a
// null handle it reports the DEFAULT shape (what create() yields for
// non-positive args); with a handle it reports that instance's actual
// runtime shape. max_examples is the example-store (dataset) ring-buffer
// capacity (nisps::ml::kDefaultMaxExamples, nisps/ml/storage.hpp) — the
// single source of truth the TS Dataset mirror sizes itself to instead of
// hardcoding a second, potentially-divergent number (S35).
EMSCRIPTEN_KEEPALIVE
void nisps_ml_describe(void* ml, int* out_dims) {
    if (!out_dims) return;
    if (!ml) {
        out_dims[0] = static_cast<int>(kDefaultInputs);
        out_dims[1] = static_cast<int>(kDefaultHidden[0]);
        out_dims[2] = static_cast<int>(kDefaultHidden[1]);
        out_dims[3] = static_cast<int>(kDefaultHidden[2]);
        out_dims[4] = static_cast<int>(kDefaultOutputs);
        out_dims[5] = static_cast<int>(BrowserMLP::kNumLayers);
        out_dims[6] = static_cast<int>(nisps::ml::kDefaultMaxExamples);
        return;
    }
    auto* h = static_cast<MLHandle*>(ml);
    out_dims[0] = static_cast<int>(h->mlp.n_in());
    out_dims[1] = static_cast<int>(h->mlp.fan_out(0u));
    out_dims[2] = static_cast<int>(h->mlp.fan_out(1u));
    out_dims[3] = static_cast<int>(h->mlp.fan_out(2u));
    out_dims[4] = static_cast<int>(h->mlp.n_out());
    out_dims[5] = static_cast<int>(BrowserMLP::kNumLayers);
    out_dims[6] = static_cast<int>(h->mlp.max_examples());
}

// ---------------------------------------------------------------------------
// Pipelines (one-core-engine P4). Input chain: the 2-axis pad pipeline.
// Output chain: curve → EMA → slew → freeze over the routed vector. State
// lives C++-side per handle; the TS wrappers are thin.
//
// INPUT CONFIG WIRE LAYOUT (nisps_input_set_config, 15 floats — keep in
// lockstep with manifold/src/engine wrappers):
//   [0] zoom            [1] zoomX (0=null)   [2] zoomY (0=null)
//   [3] anchorX         [4] anchorY          [5] anchorMode (0 auto/1 sticky/2 centre)
//   [6] deadzone        [7] inputCurve       [8] curveX (0=null)
//   [9] curveY (0=null) [10] smoothing       [11] momentumMode (0 off/1 gentle/2 strong)
//   [12] velocityWindow (SECONDS)            [13] invertX (!=0)  [14] invertY (!=0)
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void* nisps_pipeline_create(void) {
    return static_cast<void*>(new PipelineHandle());
}

EMSCRIPTEN_KEEPALIVE
void nisps_pipeline_destroy(void* p) {
    if (!p) return;
    delete static_cast<PipelineHandle*>(p);
}

EMSCRIPTEN_KEEPALIVE
void nisps_input_set_config(void* p, const float* cfg, int n) {
    if (!p || !cfg || n < 15) return;
    auto* h = static_cast<PipelineHandle*>(p);
    nisps::pipeline::InputChainConfig c;
    c.zoom        = cfg[0];
    c.zoom_x      = cfg[1];
    c.zoom_y      = cfg[2];
    c.anchor_x    = cfg[3];
    c.anchor_y    = cfg[4];
    c.anchor_mode = static_cast<nisps::pipeline::AnchorMode>(
        static_cast<int>(cfg[5]) == 1 ? 1 : (static_cast<int>(cfg[5]) == 2 ? 2 : 0));
    c.deadzone    = cfg[6];
    c.input_curve = cfg[7];
    c.curve_x     = cfg[8];
    c.curve_y     = cfg[9];
    c.smoothing   = cfg[10];
    c.momentum_mode = static_cast<nisps::pipeline::MomentumMode>(
        static_cast<int>(cfg[11]) == 1 ? 1 : (static_cast<int>(cfg[11]) == 2 ? 2 : 0));
    c.velocity_window_s = cfg[12];
    c.invert_x    = cfg[13] != 0.f;
    c.invert_y    = cfg[14] != 0.f;
    h->input.set_config(c);
}

// Returns 1 when the chain is frozen (both axes at the freeze threshold).
EMSCRIPTEN_KEEPALIVE
int nisps_input_process(void* p, float x, float y, float dt_s, float* out_xy) {
    if (!p || !out_xy) return 0;
    auto* h = static_cast<PipelineHandle*>(p);
    const auto r = h->input.process(x, y, dt_s);
    out_xy[0] = r.x;
    out_xy[1] = r.y;
    return r.frozen ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void nisps_input_reset(void* p) {
    if (!p) return;
    static_cast<PipelineHandle*>(p)->input.reset();
}

EMSCRIPTEN_KEEPALIVE
void nisps_output_set_config(void* p, float global_curve, float smoothing,
                             float slew_rate, int freeze) {
    if (!p) return;
    auto* h = static_cast<PipelineHandle*>(p);
    nisps::pipeline::OutputChainConfig c;
    c.global_curve  = global_curve;
    c.smoothing     = smoothing;
    c.slew_rate     = slew_rate;  // <= 0 ⇒ unlimited (the TS Infinity default)
    c.freeze_output = freeze != 0;
    h->output.set_config(c);
}

EMSCRIPTEN_KEEPALIVE
void nisps_output_set_freeze_mask(void* p, const uint8_t* mask, int n) {
    if (!p) return;
    auto* h = static_cast<PipelineHandle*>(p);
    if (!mask || n <= 0) {
        h->output.clear_freeze_mask();
        return;
    }
    h->output.set_freeze_mask(
        std::span<const std::uint8_t>(mask, static_cast<std::size_t>(n)));
}

// In-place: processes the first n floats of `inout`.
EMSCRIPTEN_KEEPALIVE
void nisps_output_process(void* p, float* inout, int n, float dt_s) {
    if (!p || !inout || n <= 0) return;
    auto* h = static_cast<PipelineHandle*>(p);
    const std::size_t count = static_cast<std::size_t>(n);
    h->output.process(std::span<const float>(inout, count),
                      std::span<float>(inout, count), dt_s);
}

EMSCRIPTEN_KEEPALIVE
void nisps_output_reset(void* p) {
    if (!p) return;
    static_cast<PipelineHandle*>(p)->output.reset();
}

// ---------------------------------------------------------------------------
// Curve catalog (one-core-engine P4): nisps/core/math.hpp is the single
// source of truth; the browser samples it instead of mirroring the maths.
// ids 0..6 = nisps::Curve (param ignored); id 7 = centred power (param =
// exponent). UI curve previews render by sampling the batch call.
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
float nisps_curve_apply(int id, float x, float param) {
    if (id == 7) return nisps::centered_power(x, param);
    if (id < 0 || id > 6) return x;
    return nisps::apply_curve(static_cast<nisps::Curve>(id), nisps::clamp01(x));
}

EMSCRIPTEN_KEEPALIVE
void nisps_curve_apply_batch(int id, const float* xs, float* out, int n, float param) {
    if (!xs || !out || n <= 0) return;
    for (int i = 0; i < n; ++i) {
        out[i] = nisps_curve_apply(id, xs[i], param);
    }
}

// ---------------------------------------------------------------------------
// Engine lifecycle
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void* nisps_engine_create(const char* engine_id, float sample_rate) {
    if (!engine_id) return nullptr;
    auto* h = new EngineHandle(dispatch_create(engine_id, sample_rate));
    return static_cast<void*>(h);
}

EMSCRIPTEN_KEEPALIVE
void nisps_engine_destroy(void* engine) {
    if (!engine) return;
    auto* h = static_cast<EngineHandle*>(engine);
    dispatch_destroy(*h);
    delete h;
}

EMSCRIPTEN_KEEPALIVE
void nisps_engine_set_params(void* engine, const float* params, int n_params) {
    if (!engine || !params || n_params <= 0) return;
    auto* h = static_cast<EngineHandle*>(engine);
    dispatch_set_params(*h, std::span<const float>(params, static_cast<std::size_t>(n_params)));
}

EMSCRIPTEN_KEEPALIVE
void nisps_engine_process_block(void* engine,
                                const float* in_l, const float* in_r,
                                float* out_l, float* out_r,
                                int n_samples) {
    if (!engine || n_samples <= 0) return;
    auto* h = static_cast<EngineHandle*>(engine);
    dispatch_process_block(*h, in_l, in_r, out_l, out_r, n_samples);
}

}  // extern "C"
