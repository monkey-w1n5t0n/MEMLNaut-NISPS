// tests/cpp/engine_bench.cpp — host-side throughput benchmark for the audio
// engines' per-block hot path. Compiles TWICE from this one source:
//
//   native : CMake target `nisps_engine_bench` (Release/-O3, see nisps/CMakeLists.txt)
//   wasm   : emcc, driven by scripts/bench-engines.sh with the SAME flags
//            scripts/build-wasm.sh uses for the shipped module
//
// One source compiled two ways is the point: it makes the native and WASM
// numbers comparable without adding a single export to
// nisps/wasm/bindings.cpp. The production C API is untouched, and nothing in
// nisps/ changes — the hot path being measured is not perturbed by measuring it.
//
// WHAT IS MEASURED
// ----------------
// The inner loop is written to mirror `process_typed()` in
// nisps/wasm/bindings.cpp — the function `nisps_engine_process_block`
// dispatches to, and the one the AudioWorklet calls once per 128-sample
// render quantum. Per block: read interleaved-by-channel input arrays, call
// `engine.process(stereosample_t)` per sample, store to output arrays. The
// only deliberate difference is the missing `switch` on EngineKind (one
// branch per block, unmeasurable at this scale) because the benchmark knows
// the type statically.
//
// Engines are created with `setup(sample_rate)` and a parameter vector, and
// otherwise left in their DEFAULT configuration (default voice space, default
// enable flags) — exactly what `nisps_engine_create()` hands the browser.
//
// DRIVING ENGINES INTO A WORKING STATE
// ------------------------------------
// Benchmarking an idle engine measures nothing. Three problems, three fixes:
//
//   1. Sequencer engines (breakor, elysiamorf, memlcelium) do almost nothing
//      per sample and only spend real time on the sub-sampled sequencer tick
//      (every 400/500 samples) and on the events that tick emits. So they run
//      with `set_playing(true)` + `update_bpm(120)`, for long enough that
//      hundreds of ticks land inside the window, and their event queues are
//      drained once per block the way the mode layer drains them. Without the
//      drain the 64-slot queue saturates and `push` silently takes a cheaper
//      path than production.
//
//   2. paf_synth is envelope-gated: with no note its output is silence, and
//      silence through its delay line eventually decays into denormals, whose
//      cost is wildly unrepresentative. It gets a `note_on` every ~0.25 s.
//
//   3. Input-consuming engines (channel_strip, xiasri, verb_fx, analysis)
//      given silence measure filters and compressors that never work, and hit
//      the same denormal cliff. They are fed a deterministic pseudo-noise +
//      sine bed, generated once BEFORE the timed region.
//
// Every row carries its own WORKING-STATE EVIDENCE column so a number produced
// by an idle engine is visible rather than silently plausible. Which quantity
// is evidence depends on the engine's kind: output RMS for the audio engines,
// event count for breakor/elysiamorf, feature sum for analysis — the latter
// three emit silence BY DESIGN, so an RMS column would read as broken for
// half the table.
//
// ANTI-ELISION
// ------------
// The per-block sum-of-squares over the output buffers is what stops -O3 from
// deleting the whole benchmark. It is vectorizable and costs a fraction of a
// nanosecond per sample; the `thru` (NoOpEngine) row is the floor that shows
// how much of the number is harness rather than engine.
//
// REPORTING, NOT ASSERTING
// ------------------------
// There is no threshold and no failure mode. A time threshold on shared CI
// hardware is either slack enough to be meaningless or tight enough to fail on
// somebody else's noisy runner — the same reasoning that made the firmware
// flash/RAM CI job reporting-only (.github/workflows/ci.yml). Regressions get
// noticed by RUNNING it: `scripts/bench-engines.sh --compare <old.json>`
// prints per-engine deltas against a previous run.
//
// The `rel` column exists for the cross-machine case: each engine's ns/sample
// divided by a serial FP multiply-add latency chain measured in the same
// process. That cancels clock speed (not microarchitecture), so `rel` compares
// far better across machines than raw nanoseconds do.
//
// WHAT THIS DOES NOT MEASURE
// --------------------------
//   * The RP2350. These are HOST numbers on a host FPU/cache. A 200x realtime
//     factor here implies nothing about the MCU's per-block budget. On-device
//     timing is the open half of ALIGNMENT defect 5.
//   * Event TRANSPORT. breakor/elysiamorf look nearly free because their cost
//     is the tick, not the sample — but the MIDI/WebMIDI forwarding of the
//     events they emit lives in platform glue and is outside this loop.
//   * The ML path. `nisps_ml_process`/`train` are not benchmarked here; this
//     is the audio hot path only.
//
// USAGE
//   engine_bench [--json] [--engine ID] [--repeats N] [--target-ms MS]
//                [--block-size N] [--sample-rate HZ] [--seed N] [--smoke]
//                [--label NAME]
//
// Exit codes: 0 always on a completed run; 2 on bad arguments.

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "../../nisps/engines/analysis.hpp"
#include "../../nisps/engines/base.hpp"
#include "../../nisps/engines/breakor.hpp"
#include "../../nisps/engines/channel_strip.hpp"
#include "../../nisps/engines/elysiamorf.hpp"
#include "../../nisps/engines/memlcelium.hpp"
#include "../../nisps/engines/paf_synth.hpp"
#include "../../nisps/engines/verb_fx.hpp"
#include "../../nisps/engines/xiasri.hpp"

namespace {

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

struct BenchConfig {
    float       sample_rate  = 48000.f;
    std::size_t block_size   = 128u;   // WebAudio render quantum
    std::size_t repeats      = 3u;     // best-of; benchmark noise is additive
    double      target_ms    = 150.0;  // per timed run, auto-sized block count
    std::uint64_t seed       = 20260721u;
    std::string engine_filter;         // empty = all
    std::string label        = "native";
    bool        json         = false;
};

// ---------------------------------------------------------------------------
// Deterministic scalar helpers. Not nisps::Rng — that lives in the core and
// this file must stay a pure consumer of the engine headers.
// ---------------------------------------------------------------------------

class Lcg {
   public:
    explicit Lcg(std::uint64_t seed) noexcept : s_(seed * 6364136223846793005ull + 1442695040888963407ull) {}
    std::uint32_t next_u32() noexcept {
        s_ = s_ * 6364136223846793005ull + 1442695040888963407ull;
        return static_cast<std::uint32_t>(s_ >> 33);
    }
    // Uniform in [0,1).
    float next_unit() noexcept {
        return static_cast<float>(next_u32()) * (1.f / 4294967296.f);
    }

   private:
    std::uint64_t s_;
};

using Clock   = std::chrono::steady_clock;
using Seconds = std::chrono::duration<double>;

// ---------------------------------------------------------------------------
// Calibration kernel — a serially dependent FP multiply-add chain. Latency
// bound, so it does not vectorize and does not depend on SIMD width; it tracks
// clock speed and FP latency and little else. Used to normalise engine cost
// into the machine-independent-ish `rel` column.
// ---------------------------------------------------------------------------

double bench_ref_ns_per_op(std::size_t iters) noexcept {
    volatile float sink = 0.f;
    float x = 1.000001f;
    const auto t0 = Clock::now();
    for (std::size_t i = 0u; i < iters; ++i) {
        x = x * 0.9999999f + 1e-7f;
        x = x * 0.9999998f + 1e-7f;
        x = x * 0.9999997f + 1e-7f;
        x = x * 0.9999996f + 1e-7f;
    }
    const auto t1 = Clock::now();
    sink = x;
    (void)sink;
    const double elapsed = std::chrono::duration_cast<Seconds>(t1 - t0).count();
    return (elapsed * 1e9) / static_cast<double>(iters * 4u);
}

// ---------------------------------------------------------------------------
// Result record
// ---------------------------------------------------------------------------

struct Result {
    std::string   engine;
    std::size_t   param_count   = 0u;
    std::size_t   blocks        = 0u;
    double        ns_per_sample = 0.0;
    double        blocks_per_s  = 0.0;
    double        realtime_x    = 0.0;
    double        rel_ref       = 0.0;
    double        out_rms       = 0.0;
    long long     events        = -1;   // -1 = engine has no event surface
    double        feature_sum   = -1.0; // -1 = engine computes no features
    // Short human string proving the engine was actually working. WHICH
    // quantity proves that differs by engine kind: an audio engine that fell
    // silent is broken, but breakor/elysiamorf/analysis output silence BY
    // DESIGN and are evidenced by their event stream / feature vector instead.
    std::string   evidence;
};

// ---------------------------------------------------------------------------
// Input bed. Pseudo-noise + two sines: broadband enough to keep filters,
// followers and compressors doing real work, and far enough from zero that no
// feedback path decays into denormals. Generated once, outside every timed
// region, and cycled.
// ---------------------------------------------------------------------------

std::vector<float> make_input_bed(std::size_t n, std::uint64_t seed, float sample_rate) {
    std::vector<float> buf(n);
    Lcg rng(seed);
    const double two_pi = 6.283185307179586;
    for (std::size_t i = 0u; i < n; ++i) {
        const double t = static_cast<double>(i) / static_cast<double>(sample_rate);
        const double s = 0.30 * std::sin(two_pi * 220.0 * t)
                       + 0.15 * std::sin(two_pi * 1310.0 * t);
        const double noise = (static_cast<double>(rng.next_unit()) - 0.5) * 0.20;
        buf[i] = static_cast<float>(s + noise);
    }
    return buf;
}

std::vector<float> make_params(std::size_t n, std::uint64_t seed) {
    // Uniform in [0.05, 0.95]. These stand in for MLP outputs, which is what
    // the engines actually receive; the parity harness's all-0.5 vector is a
    // deliberately degenerate corner (every knob identical) and, at 128
    // frames, never reaches a sequencer tick at all.
    std::vector<float> p(n);
    Lcg rng(seed ^ 0x9e3779b97f4a7c15ull);
    for (std::size_t i = 0u; i < n; ++i) p[i] = 0.05f + rng.next_unit() * 0.90f;
    return p;
}

// ---------------------------------------------------------------------------
// The measured loop. `control` runs once per block INSIDE the timed region —
// it is the mode layer's per-block work (event drain, periodic note_on) and is
// deliberately included, being real cost. It is kept rare/cheap enough that it
// cannot dominate; the reported event counts say how often it did anything.
// ---------------------------------------------------------------------------

struct RunStats {
    double    seconds = 0.0;
    double    sumsq   = 0.0;
    long long events  = 0;
};

template <typename EngineT, typename ControlFn>
RunStats time_blocks(EngineT& engine,
                     std::size_t blocks,
                     std::size_t block_size,
                     const std::vector<float>& bed,
                     std::vector<float>& in_l,
                     std::vector<float>& in_r,
                     std::vector<float>& out_l,
                     std::vector<float>& out_r,
                     std::size_t& bed_pos,
                     ControlFn&& control) {
    RunStats st;
    const auto t0 = Clock::now();
    for (std::size_t b = 0u; b < blocks; ++b) {
        // Refill the block from the bed (cheap copy, part of what a real host
        // does when handing the worklet its input).
        for (std::size_t i = 0u; i < block_size; ++i) {
            const float v = bed[bed_pos];
            bed_pos = (bed_pos + 1u == bed.size()) ? 0u : bed_pos + 1u;
            in_l[i] = v;
            in_r[i] = v * 0.87f;
        }

        // Mirrors process_typed() in nisps/wasm/bindings.cpp.
        for (std::size_t i = 0u; i < block_size; ++i) {
            const nisps::stereosample_t s{in_l[i], in_r[i]};
            const auto y = engine.process(s);
            out_l[i] = y.L;
            out_r[i] = y.R;
        }

        st.events += control(engine, b);

        // Anti-elision + signal evidence. Vectorizable; see file header.
        double acc = 0.0;
        for (std::size_t i = 0u; i < block_size; ++i) {
            acc += static_cast<double>(out_l[i]) * out_l[i]
                 + static_cast<double>(out_r[i]) * out_r[i];
        }
        st.sumsq += acc;
    }
    const auto t1 = Clock::now();
    st.seconds = std::chrono::duration_cast<Seconds>(t1 - t0).count();
    return st;
}

// ---------------------------------------------------------------------------
// Per-engine harness: prepare → warm up → auto-size → best-of-N timed runs.
// ---------------------------------------------------------------------------

template <typename EngineT, typename PrepareFn, typename ControlFn>
Result run_engine(const char* id,
                  const BenchConfig& cfg,
                  double ref_ns_per_op,
                  PrepareFn prepare,
                  ControlFn control) {
    Result r;
    r.engine      = id;
    r.param_count = EngineT::param_count();

    const std::size_t bs  = cfg.block_size;
    const auto bed        = make_input_bed(bs * 64u, cfg.seed, cfg.sample_rate);
    const auto params     = make_params(EngineT::param_count(), cfg.seed);

    std::vector<float> in_l(bs), in_r(bs), out_l(bs), out_r(bs);

    // ONE instance across pilot + repeats: stateful DSP has no meaningful
    // "cold" measurement, and a long-running audio session is the state we
    // care about. Keeping it alive also lets the evidence probe below read
    // the engine after the timed runs.
    //
    // Heap, not stack: verb_fx/memlcelium carry multi-hundred-kB delay lines
    // and blow Emscripten's default stack. `make_handle()` in
    // nisps/wasm/bindings.cpp heap-allocates engines for the same reason, so
    // this also matches how the browser holds them.
    auto owned = std::make_unique<EngineT>();
    EngineT& engine = *owned;
    engine.setup(cfg.sample_rate);
    if (EngineT::param_count() > 0u) engine.set_params(std::span<const float>(params));
    prepare(engine);

    std::size_t pos = 0u;

    // ---- Pilot: settles engine state AND sizes the run so every engine gets
    // roughly target_ms of measurement regardless of its cost.
    std::size_t blocks = 32u;
    {
        const auto pilot = time_blocks(engine, blocks, bs, bed, in_l, in_r, out_l, out_r, pos, control);
        const double per_block = (pilot.seconds > 0.0)
                                     ? pilot.seconds / static_cast<double>(blocks)
                                     : 1e-9;
        const double want = (cfg.target_ms / 1000.0) / per_block;
        blocks = static_cast<std::size_t>(std::clamp(want, 8.0, 4.0e7));
    }

    double best_seconds = 0.0;
    double best_sumsq   = 0.0;
    long long best_events = 0;
    for (std::size_t rep = 0u; rep < cfg.repeats; ++rep) {
        const auto st = time_blocks(engine, blocks, bs, bed, in_l, in_r, out_l, out_r, pos, control);
        if (rep == 0u || st.seconds < best_seconds) {
            best_seconds = st.seconds;
            best_sumsq   = st.sumsq;
            best_events  = st.events;
        }
    }

    const double samples = static_cast<double>(blocks) * static_cast<double>(bs);
    r.blocks        = blocks;
    r.ns_per_sample = (best_seconds * 1e9) / samples;
    r.blocks_per_s  = (best_seconds > 0.0) ? static_cast<double>(blocks) / best_seconds : 0.0;
    r.realtime_x    = (best_seconds > 0.0)
                          ? samples / (best_seconds * static_cast<double>(cfg.sample_rate))
                          : 0.0;
    r.rel_ref       = (ref_ns_per_op > 0.0) ? r.ns_per_sample / ref_ns_per_op : 0.0;
    r.out_rms       = std::sqrt(best_sumsq / (samples * 2.0));
    r.events        = best_events;

    // ---- Evidence that the engine was actually doing work. Which quantity
    // proves that depends on the engine's kind, so pick per kind rather than
    // printing a column that is legitimately zero for half the table.
    char buf[32];
    if constexpr (requires(EngineT& e) { e.features(); }) {
        // Analysis engine: emits no audio; its output is the feature vector.
        const auto& f = engine.features();
        r.feature_sum = static_cast<double>(f.pitch + f.aperiodicity + f.energy
                                            + f.attack + f.brightness + f.energy_crude);
        std::snprintf(buf, sizeof(buf), "feat=%.3f", r.feature_sum);
    } else if constexpr (requires(EngineT& e) { e.pop_events(std::span<typename EngineT::Event>{}); }) {
        // Sequencer engine: emits no audio; its output is the event stream.
        std::snprintf(buf, sizeof(buf), "ev=%lld", r.events);
    } else {
        r.events = -1;
        std::snprintf(buf, sizeof(buf), "rms=%.4f", r.out_rms);
    }
    r.evidence = buf;
    return r;
}

// ---------------------------------------------------------------------------
// Control hooks — the per-block work the mode layer does around the engine.
// ---------------------------------------------------------------------------

struct NoControl {
    template <typename E>
    long long operator()(E&, std::size_t) const noexcept { return 0; }
};

// paf_synth: retrigger the envelope so the engine is never sitting in silence.
struct RetriggerNotes {
    std::size_t every_blocks;
    std::array<std::uint8_t, 4> notes{{48u, 55u, 60u, 67u}};
    long long operator()(nisps::PAFSynthEngine& e, std::size_t b) noexcept {
        if (b % every_blocks == 0u) {
            e.note_on(notes[(b / every_blocks) & 3u], 100u);
            return 1;
        }
        return 0;
    }
};

// Sequencer engines: drain the event queue the way the mode's control tick
// does. Skipping this saturates the 64-slot queue and pushes take a cheaper
// path than production ever would.
template <typename EngineT>
struct DrainEvents {
    std::array<typename EngineT::Event, 64> buf{};
    long long operator()(EngineT& e, std::size_t) noexcept {
        return static_cast<long long>(e.pop_events(std::span<typename EngineT::Event>(buf)));
    }
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

void print_table(const BenchConfig& cfg, double ref_ns, const std::vector<Result>& rs) {
    std::printf("nisps engine benchmark — target=%s\n", cfg.label.c_str());
    std::printf("  sample rate %.0f Hz   block %zu samples   params pseudo-random(seed=%llu)\n",
                static_cast<double>(cfg.sample_rate), cfg.block_size,
                static_cast<unsigned long long>(cfg.seed));
    std::printf("  best of %zu runs, each auto-sized to ~%.0f ms\n", cfg.repeats, cfg.target_ms);
    std::printf("  ref kernel %.3f ns/op (serial FP mul-add latency; `rel` is ns/sample ÷ this)\n\n",
                ref_ns);

    std::printf("%-14s %7s %11s %12s %11s %8s  %s\n",
                "engine", "params", "ns/sample", "blocks/s", "xRT", "rel", "working-state evidence");
    std::printf("%-14s %7s %11s %12s %11s %8s  %s\n",
                "--------------", "------", "---------", "----------", "---------",
                "------", "----------------------");
    for (const auto& r : rs) {
        std::printf("%-14s %7zu %11.2f %12.1f %11.1f %8.1f  %s\n",
                    r.engine.c_str(), r.param_count, r.ns_per_sample,
                    r.blocks_per_s, r.realtime_x, r.rel_ref, r.evidence.c_str());
    }
    std::printf("\n  xRT = seconds of audio per second of CPU (higher is faster).\n");
    std::printf("  evidence: rms = output RMS | ev = events emitted | feat = analysis feature sum.\n");
    std::printf("  A zero there means the engine was NOT driven and its timing means nothing.\n");
    std::printf("  `thru` is NoOpEngine: it measures the harness floor, not an engine (rms=0 expected).\n");
    std::printf("  Reported, never asserted — see scripts/bench-engines.sh --compare.\n");
}

void print_json(const BenchConfig& cfg, double ref_ns, const std::vector<Result>& rs) {
    std::printf("{\n");
    std::printf("  \"target\": \"%s\",\n", cfg.label.c_str());
    std::printf("  \"sample_rate\": %.0f,\n", static_cast<double>(cfg.sample_rate));
    std::printf("  \"block_size\": %zu,\n", cfg.block_size);
    std::printf("  \"repeats\": %zu,\n", cfg.repeats);
    std::printf("  \"target_ms\": %.1f,\n", cfg.target_ms);
    std::printf("  \"seed\": %llu,\n", static_cast<unsigned long long>(cfg.seed));
    std::printf("  \"ref_ns_per_op\": %.6f,\n", ref_ns);
    std::printf("  \"engines\": [\n");
    for (std::size_t i = 0u; i < rs.size(); ++i) {
        const auto& r = rs[i];
        std::printf("    {\"engine\": \"%s\", \"params\": %zu, \"blocks\": %zu, "
                    "\"ns_per_sample\": %.6f, \"blocks_per_s\": %.3f, \"realtime_x\": %.3f, "
                    "\"rel_ref\": %.4f, \"out_rms\": %.6f, \"events\": %lld, "
                    "\"feature_sum\": %.6f, \"evidence\": \"%s\"}%s\n",
                    r.engine.c_str(), r.param_count, r.blocks, r.ns_per_sample,
                    r.blocks_per_s, r.realtime_x, r.rel_ref, r.out_rms, r.events,
                    r.feature_sum, r.evidence.c_str(),
                    (i + 1u == rs.size()) ? "" : ",");
    }
    std::printf("  ]\n}\n");
}

bool wanted(const BenchConfig& cfg, std::string_view id) {
    return cfg.engine_filter.empty() || cfg.engine_filter == id;
}

}  // namespace

int main(int argc, char** argv) {
    BenchConfig cfg;

    for (int i = 1; i < argc; ++i) {
        const std::string_view a = argv[i];
        auto need = [&](const char* what) -> const char* {
            if (i + 1 >= argc) {
                std::fprintf(stderr, "[engine_bench] %s needs a value\n", what);
                std::exit(2);
            }
            return argv[++i];
        };
        if (a == "--json")             cfg.json = true;
        else if (a == "--engine")      cfg.engine_filter = need("--engine");
        else if (a == "--repeats")     cfg.repeats = static_cast<std::size_t>(std::atoi(need("--repeats")));
        else if (a == "--target-ms")   cfg.target_ms = std::atof(need("--target-ms"));
        else if (a == "--block-size")  cfg.block_size = static_cast<std::size_t>(std::atoi(need("--block-size")));
        else if (a == "--sample-rate") cfg.sample_rate = static_cast<float>(std::atof(need("--sample-rate")));
        else if (a == "--seed")        cfg.seed = static_cast<std::uint64_t>(std::strtoull(need("--seed"), nullptr, 10));
        else if (a == "--label")       cfg.label = need("--label");
        else if (a == "--smoke")     { cfg.repeats = 1u; cfg.target_ms = 8.0; }
        else if (a == "--help" || a == "-h") {
            std::printf("usage: engine_bench [--json] [--engine ID] [--repeats N] "
                        "[--target-ms MS] [--block-size N] [--sample-rate HZ] "
                        "[--seed N] [--label NAME] [--smoke]\n");
            return 0;
        } else {
            std::fprintf(stderr, "[engine_bench] unknown argument: %.*s\n",
                         static_cast<int>(a.size()), a.data());
            return 2;
        }
    }
    if (cfg.repeats == 0u)    cfg.repeats = 1u;
    if (cfg.block_size == 0u) cfg.block_size = 128u;

    // ~15 ms of calibration: stable enough, short enough not to matter.
    const double ref_ns = bench_ref_ns_per_op(2000000u);

    // Retrigger paf_synth roughly every 0.25 s of audio.
    const std::size_t retrigger_blocks =
        std::max<std::size_t>(1u, static_cast<std::size_t>(
            (static_cast<double>(cfg.sample_rate) * 0.25) / static_cast<double>(cfg.block_size)));

    // The sequencer engines need transport running; everything else is left in
    // the exact state nisps_engine_create() leaves it.
    auto start_transport = [](auto& e) { e.update_bpm(120.f); e.set_playing(true); };
    auto no_prepare      = [](auto&) {};

    std::vector<Result> rs;

    if (wanted(cfg, "thru"))
        rs.push_back(run_engine<nisps::NoOpEngine>("thru", cfg, ref_ns, no_prepare, NoControl{}));
    if (wanted(cfg, "paf_synth"))
        rs.push_back(run_engine<nisps::PAFSynthEngine>("paf_synth", cfg, ref_ns, no_prepare,
                                                       RetriggerNotes{retrigger_blocks}));
    if (wanted(cfg, "channel_strip"))
        rs.push_back(run_engine<nisps::ChannelStripEngine>("channel_strip", cfg, ref_ns, no_prepare, NoControl{}));
    if (wanted(cfg, "xiasri"))
        rs.push_back(run_engine<nisps::XIASRIEngine>("xiasri", cfg, ref_ns, no_prepare, NoControl{}));
    if (wanted(cfg, "verb_fx"))
        rs.push_back(run_engine<nisps::VerbFXEngine>("verb_fx", cfg, ref_ns, no_prepare, NoControl{}));
    if (wanted(cfg, "memlcelium"))
        rs.push_back(run_engine<nisps::MEMLCeliumEngine>("memlcelium", cfg, ref_ns, start_transport, NoControl{}));
    if (wanted(cfg, "breakor"))
        rs.push_back(run_engine<nisps::BreakOrEngine>("breakor", cfg, ref_ns, start_transport,
                                                      DrainEvents<nisps::BreakOrEngine>{}));
    if (wanted(cfg, "elysiamorf"))
        rs.push_back(run_engine<nisps::ElysiamorfEngine>("elysiamorf", cfg, ref_ns, start_transport,
                                                         DrainEvents<nisps::ElysiamorfEngine>{}));
    if (wanted(cfg, "analysis"))
        rs.push_back(run_engine<nisps::AnalysisEngine>("analysis", cfg, ref_ns, no_prepare, NoControl{}));

    if (rs.empty()) {
        std::fprintf(stderr, "[engine_bench] no engine matched --engine %s\n",
                     cfg.engine_filter.c_str());
        return 2;
    }

    if (cfg.json) print_json(cfg, ref_ns, rs);
    else          print_table(cfg, ref_ns, rs);
    return 0;
}
