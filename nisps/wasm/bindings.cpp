// nisps/wasm/bindings.cpp — flat C API exported to the SolidJS playground.
//
// Two consumers per build:
//   1. Main-thread WasmIML (playground/src/ml/wasm-iml.ts)        — ML calls.
//   2. AudioWorklet processor (playground/src/audio/worklet/...)  — engine
//      calls. (Each instance owns its own WASM module instance.)
//
// ARCHITECTURE (input dim is OVER-PROVISIONED for mix-and-match inputs)
// ---------------------------------------------------------------------
// The C++ MLP class is templated on layer sizes (architecture.md §4.1, §6.2).
// We instantiate ONE concrete configuration here:
//
//     using DefaultMLP = nisps::ml::MLP<32, 10, 14, 18, 126>;
//
// The 32-input dimension is the MAX number of composed input axes the manifold
// front-end can feed (matches MAX_AXES in manifold/src/inputs/input-layer.ts).
// The mix-and-match input layer (Internal XY pad + Game Controller + MIDI) gives
// each active axis its OWN dedicated input slot — NO mean-blending — and feeds
// the remaining (unused) slots a constant 0. The "active input dimension count"
// is a front-end concept: a 2-axis pad uses slots 0–1, a 4-axis pad+stick uses
// 0–3, etc. Because slot assignment is stable and unused slots are held at 0,
// the net behaves as an N-input net where N = active axes; changing N is a
// reshape, after which the front-end resets the weights (recreate-from-scratch,
// behind a confirm modal). 126 outputs cover C15 + any current schema.
//
// `nisps_ml_create()` accepts caller-supplied input_size/output_size/hidden[]
// but only validates them against these compile-time defaults — extra
// inputs/outputs are clipped at the boundary and hidden overrides are ignored.
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
#include "../core/types.hpp"
#include "../ml/feedback.hpp"
#include "../ml/mlp.hpp"
#include "../ml/stats.hpp"

namespace {

// ---------------------------------------------------------------------------
// ML side
// ---------------------------------------------------------------------------

// Compile-time default architecture. See header comment.
//
// Choice rationale:
//   * 2 inputs            — playground virtual joystick (X, Y).
//   * [10, 14, 18] hidden — covers the largest schema layouts in
//     `schemas/modes/*.json` (channel_strip variants, verb_fx, breakor,
//     elysiamorf, memlcelium).
//   * 126 outputs         — enough for the C15 mode and any current schema.
//
// The MLP also has dataset slots, loss history etc. — see mlp.hpp.
using DefaultMLP = nisps::ml::MLP<32u, 10u, 14u, 18u, 126u>;

constexpr std::size_t kDefaultInputs  = DefaultMLP::kInput;
constexpr std::size_t kDefaultOutputs = DefaultMLP::kOutput;

// We allocate the MLP on the heap (one-off — not the audio path) and return
// the opaque pointer to JS.
struct MLHandle {
    DefaultMLP mlp;
    // "Down Action" negative-feedback controller (Avoid/RandomiseOutputs/
    // RandomiseMlp). Seeded off the MLP seed XOR a salt so its static-output
    // RNG stream is independent of the MLP's inference/move RNG.
    nisps::ml::FeedbackController<DefaultMLP> feedback;
    // Buffers used to bridge JS → C++:
    std::array<float, kDefaultInputs>  input_scratch{};
    std::array<float, kDefaultOutputs> output_scratch{};
    // Stats buffer fed back to JS via get_layer_stats.
    std::array<float, DefaultMLP::kNumLayers * 4u> stats_scratch{};
    // Static-output buffer for the RandomiseOutputs bypass path.
    std::array<float, kDefaultOutputs> feedback_static_scratch{};
    // Used by infer_batch with arbitrary N — must exceed any reasonable
    // request from the heatmap. 256x256 = 65536 max points → too many in
    // practice. We cap batch size at 4096 here; callers must split larger
    // requests.
    static constexpr std::size_t kMaxBatch = 4096u;
    std::array<float, kMaxBatch * kDefaultOutputs> batch_out_scratch{};

    explicit MLHandle(std::uint64_t seed) noexcept
        : mlp(seed), feedback(seed ^ 0xFEEDBACC0DEull) {}
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
                     const int* /*hidden*/, int /*n_hidden*/,
                     uint32_t seed) {
    // We accept and ignore caller-supplied dimensions if they don't match the
    // compile-time default. See file header.
    //
    // NOTE: the C++ Rng takes uint64_t; we sign-extend the 32-bit seed into
    // the high 32 bits via xor-shift so callers passing zero still get a
    // non-degenerate seed. Truly 64-bit seeds are not exposed to JS — the
    // playground doesn't need them, and avoiding BigInt at the boundary
    // simplifies both wasm-iml.ts and wasm-worker.ts.
    (void)input_size;
    (void)output_size;
    const std::uint64_t s64 = static_cast<std::uint64_t>(seed) ^
                              (static_cast<std::uint64_t>(seed) << 32);
    auto* h = new MLHandle(s64);
    return static_cast<void*>(h);
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
    if (static_cast<std::size_t>(idx) >= kDefaultInputs) return;
    h->mlp.set_input(static_cast<std::size_t>(idx), v);
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_process(void* ml) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->mlp.process();
    auto outs = h->mlp.outputs();
    for (std::size_t i = 0; i < kDefaultOutputs; ++i) h->output_scratch[i] = outs[i];
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
    const std::size_t n = static_cast<std::size_t>(n_points);
    if (n > MLHandle::kMaxBatch) {
        // Caller exceeded the scratch buffer. Process what we can.
        const std::size_t safe_n = MLHandle::kMaxBatch;
        h->mlp.infer_batch(
            std::span<const float>(points, safe_n * kDefaultInputs),
            std::span<float>(out, safe_n * kDefaultOutputs));
        return;
    }
    h->mlp.infer_batch(
        std::span<const float>(points, n * kDefaultInputs),
        std::span<float>(out, n * kDefaultOutputs));
}

// ---------------------------------------------------------------------------
// ML training
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void nisps_ml_add_example(void* ml, const float* features, const float* labels) {
    if (!ml || !features || !labels) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->mlp.add_example(
        std::span<const float>(features, kDefaultInputs),
        std::span<const float>(labels, kDefaultOutputs));
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
    (void)ml;
    return static_cast<int>(DefaultMLP::weight_count());
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
    h->mlp.set_weights(std::span<const float>(in, DefaultMLP::weight_count()));
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_draw_weights(void* ml, float spread) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->mlp.draw_weights(spread);
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_move_weights(void* ml, float speed, float spread,
                          const uint8_t* output_pin_mask) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    std::span<const std::uint8_t> mask;
    if (output_pin_mask) {
        mask = std::span<const std::uint8_t>(output_pin_mask, kDefaultOutputs);
    }
    h->mlp.move_weights(speed, spread, mask);
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
//   nisps_ml_feedback_down with current_out should pass the full kDefaultOutputs
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
int nisps_ml_feedback_learning_paused(void* ml) {
    if (!ml) return 0;
    return static_cast<MLHandle*>(ml)->feedback.learning_paused() ? 1 : 0;
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

// current_out = kDefaultOutputs floats the user is hearing (may be null).
// pin_mask may be null. Returns the FeedbackAction int.
EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_down(void* ml, const float* current_out,
                           float speed, float spread, const uint8_t* pin_mask) {
    if (!ml) return 0;
    auto* h = static_cast<MLHandle*>(ml);
    std::span<const float> out;
    if (current_out) out = std::span<const float>(current_out, kDefaultOutputs);
    std::span<const std::uint8_t> mask;
    if (pin_mask) mask = std::span<const std::uint8_t>(pin_mask, kDefaultOutputs);
    return static_cast<int>(h->feedback.on_down(h->mlp, out, speed, spread, mask));
}

EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_up(void* ml) {
    if (!ml) return 0;
    auto* h = static_cast<MLHandle*>(ml);
    return static_cast<int>(h->feedback.on_up(h->mlp));
}

EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_drag(void* ml) {
    if (!ml) return 0;
    auto* h = static_cast<MLHandle*>(ml);
    return static_cast<int>(h->feedback.on_drag(h->mlp));
}

// If returns 1, `out` (kDefaultOutputs floats) holds the static bypass vector
// and the caller should NOT call nisps_ml_process(); if 0, run process().
EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_static_output(void* ml, float* out) {
    if (!ml || !out) return 0;
    auto* h = static_cast<MLHandle*>(ml);
    const bool bypass =
        h->feedback.static_output(std::span<float>(h->feedback_static_scratch));
    if (bypass) {
        std::memcpy(out, h->feedback_static_scratch.data(),
                    kDefaultOutputs * sizeof(float));
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

// 1 if currently Placing (audition is the frozen vector), else 0.
EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_placing(void* ml) {
    if (!ml) return 0;
    return static_cast<MLHandle*>(ml)->feedback.placing() ? 1 : 0;
}

// ExploreState int: 0=Idle 1=Exploring 2=Placing.
EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_state(void* ml) {
    if (!ml) return 0;
    return static_cast<int>(static_cast<MLHandle*>(ml)->feedback.explore_state());
}

// Scratchpad undo-ring depth currently available to pop.
EMSCRIPTEN_KEEPALIVE
int nisps_ml_feedback_undo_depth(void* ml) {
    if (!ml) return 0;
    return static_cast<int>(static_cast<MLHandle*>(ml)->feedback.undo_depth());
}

// Writes the committed/placed output vector (kDefaultOutputs floats) into `out`.
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
    const std::size_t n = (v.size() < kDefaultOutputs) ? v.size() : kDefaultOutputs;
    std::memcpy(out, v.data(), n * sizeof(float));
    return 1;
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_get_layer_stats(void* ml, float* out_stats) {
    if (!ml || !out_stats) return;
    auto* h = static_cast<MLHandle*>(ml);
    for (std::size_t i = 0; i < DefaultMLP::kNumLayers; ++i) {
        const auto s = h->mlp.layer_stats(i);
        out_stats[i * 4u + 0u] = s.mean_abs;
        out_stats[i * 4u + 1u] = s.max_abs;
        out_stats[i * 4u + 2u] = s.dead_frac;
        out_stats[i * 4u + 3u] = s.saturating_frac;
    }
}

// Extra helper: lets JS query the example count without having to
// shadow-track it. Useful when restoring from snapshot.
EMSCRIPTEN_KEEPALIVE
int nisps_ml_example_count(void* ml) {
    if (!ml) return 0;
    auto* h = static_cast<MLHandle*>(ml);
    return static_cast<int>(h->mlp.example_count());
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_clear_examples(void* ml) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->mlp.clear_examples();
}

EMSCRIPTEN_KEEPALIVE
void nisps_ml_reset(void* ml) {
    if (!ml) return;
    auto* h = static_cast<MLHandle*>(ml);
    h->mlp.reset();
}

// Architecture introspection — returns 4-int packed [in, h1, h2, h3, out, n_layers].
// Kept simple: writes into a caller-supplied int buffer. Always 6 ints.
EMSCRIPTEN_KEEPALIVE
void nisps_ml_describe(int* out_dims) {
    if (!out_dims) return;
    out_dims[0] = static_cast<int>(DefaultMLP::kInput);
    out_dims[1] = static_cast<int>(DefaultMLP::kHidden1);
    out_dims[2] = static_cast<int>(DefaultMLP::kHidden2);
    out_dims[3] = static_cast<int>(DefaultMLP::kHidden3);
    out_dims[4] = static_cast<int>(DefaultMLP::kOutput);
    out_dims[5] = static_cast<int>(DefaultMLP::kNumLayers);
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
