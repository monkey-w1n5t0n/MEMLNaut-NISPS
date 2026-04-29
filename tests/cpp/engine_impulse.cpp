// tests/cpp/engine_impulse.cpp — impulse-response baselines for every audio
// engine.
//
// What we're checking
// -------------------
// For each engine in the build, drive it with a SHORT, FIXED stimulus
// (single-sample impulse at index 0) and capture a SHORT, FIXED response
// length (256 samples). Compare the L+R energy curve and a handful of sample-
// position checks against a baseline captured on a known-good build.
//
// We DON'T assert bit-perfect match — DSP code is bit-fragile under different
// compilers and optimisation levels. We assert:
//   1. Output is finite (no NaN/Inf).
//   2. Output is bounded — engines don't blow up to >10 amplitude on a unit
//      impulse.
//   3. Energy in a fixed window matches the baseline within a generous
//      tolerance (1e-3 absolute for energy, 1e-4 sample-wise).
//
// The baseline is captured ONCE, written next to this file as
// `engine_impulse_baseline.bin`, then read back in subsequent runs. Set
// NISPS_REGEN_BASELINE=1 to overwrite. Set NISPS_BASELINE_PATH=/some/path
// to override the file location (useful for CI artifact upload).
//
// Per-engine setup
// ----------------
// Engines satisfying nisps::AudioEngine are:
//   PAFSynth, ChannelStrip, XIASRI, VerbFX, MEMLCelium, BreakOr, Elysiamorf,
//   Analysis, NoOp.
//
// PAFSynth is a generator (ignores input) — we still drive it with the
// impulse stimulus and trust it to produce its idle output. BreakOr and
// Elysiamorf are sequencers that emit on their own clock; we just care that
// they don't crash. The impulse test is a smoke test, not a frequency-domain
// validation.

#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

#include "test_helpers.hpp"

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

constexpr std::size_t kFrames     = 256u;
constexpr float       kSampleRate = 48000.0f;
constexpr float       kImpulseAmp = 0.5f;
constexpr float       kSampleTol  = 1.0e-4f;
constexpr float       kEnergyTol  = 1.0e-3f;
constexpr float       kBoundAbs   = 10.0f;  // any engine exceeding this is broken

struct ImpulseResult {
    std::array<float, kFrames> left{};
    std::array<float, kFrames> right{};
    float energy = 0.f;
};

// Drive engine with an impulse at sample 0 (kImpulseAmp on both channels) and
// silence after. Returns kFrames samples on each channel plus total energy.
template <typename E>
ImpulseResult run_impulse(E& e) {
    e.setup(kSampleRate);
    // Default params at midpoint — engines often have a tame default at 0.5.
    if constexpr (E::param_count() > 0u) {
        std::array<float, E::param_count()> p{};
        for (auto& v : p) v = 0.5f;
        e.set_params(std::span<const float>(p.data(), p.size()));
    }

    ImpulseResult out;
    for (std::size_t i = 0; i < kFrames; ++i) {
        nisps::stereosample_t in{0.f, 0.f};
        if (i == 0) { in.L = kImpulseAmp; in.R = kImpulseAmp; }
        const auto y = e.process(in);
        out.left[i]  = y.L;
        out.right[i] = y.R;
        out.energy += y.L * y.L + y.R * y.R;
    }
    return out;
}

// Guard rails common to every engine.
void assert_finite_and_bounded(const ImpulseResult& r, const char* engine) {
    bool finite = true;
    bool bounded = true;
    for (std::size_t i = 0; i < kFrames; ++i) {
        if (!std::isfinite(r.left[i]) || !std::isfinite(r.right[i])) finite = false;
        if (std::fabs(r.left[i])  > kBoundAbs) bounded = false;
        if (std::fabs(r.right[i]) > kBoundAbs) bounded = false;
    }
    if (!finite) std::fprintf(stderr, "  engine %s produced non-finite samples\n", engine);
    if (!bounded) std::fprintf(stderr, "  engine %s produced samples outside ±%.1f\n",
                               engine, kBoundAbs);
    NISPS_EXPECT(finite);
    NISPS_EXPECT(bounded);
}

// -----------------------------------------------------------------
// Baseline file format
// -----------------------------------------------------------------
//
//   uint32  magic = 'NIPB'         // Nisps Impulse Baseline
//   uint32  version = 1
//   uint32  n_engines
//   for each engine:
//     uint32  name_len
//     char[]  name (no NUL)
//     uint32  frames               // = kFrames
//     float   energy
//     float[] left  (frames)
//     float[] right (frames)

constexpr std::uint32_t kMagic   = 0x4250494eu;  // 'NIPB' little-endian = N I P B
constexpr std::uint32_t kVersion = 1u;

struct BaselineEntry {
    std::string  name;
    ImpulseResult result;
};

bool regen_baseline_mode() {
    const char* env = std::getenv("NISPS_REGEN_BASELINE");
    return env && env[0] == '1';
}

std::string baseline_path() {
    const char* env = std::getenv("NISPS_BASELINE_PATH");
    if (env && env[0]) return env;
    // Default: next to this source file. CMake puts the binary in nisps/build,
    // so we look up to two levels for tests/cpp/.
    return "tests/cpp/engine_impulse_baseline.bin";
}

bool write_baseline(const std::string& path,
                    const std::vector<BaselineEntry>& entries) {
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    if (!f.good()) return false;
    auto write_u32 = [&](std::uint32_t v) { f.write(reinterpret_cast<const char*>(&v), 4); };
    auto write_f32 = [&](float v)         { f.write(reinterpret_cast<const char*>(&v), 4); };
    write_u32(kMagic);
    write_u32(kVersion);
    write_u32(static_cast<std::uint32_t>(entries.size()));
    for (const auto& e : entries) {
        write_u32(static_cast<std::uint32_t>(e.name.size()));
        f.write(e.name.data(), static_cast<std::streamsize>(e.name.size()));
        write_u32(static_cast<std::uint32_t>(kFrames));
        write_f32(e.result.energy);
        for (float v : e.result.left)  write_f32(v);
        for (float v : e.result.right) write_f32(v);
    }
    return f.good();
}

bool read_baseline(const std::string& path, std::vector<BaselineEntry>& out) {
    std::ifstream f(path, std::ios::binary);
    if (!f.good()) return false;
    auto read_u32 = [&]() -> std::uint32_t {
        std::uint32_t v = 0u;
        f.read(reinterpret_cast<char*>(&v), 4);
        return v;
    };
    auto read_f32 = [&]() -> float {
        float v = 0.f;
        f.read(reinterpret_cast<char*>(&v), 4);
        return v;
    };
    if (read_u32() != kMagic) return false;
    if (read_u32() != kVersion) return false;
    const std::uint32_t n = read_u32();
    out.clear();
    out.reserve(n);
    for (std::uint32_t i = 0; i < n; ++i) {
        BaselineEntry entry;
        const std::uint32_t name_len = read_u32();
        entry.name.resize(name_len);
        f.read(entry.name.data(), name_len);
        const std::uint32_t frames = read_u32();
        if (frames != kFrames) return false;
        entry.result.energy = read_f32();
        for (auto& v : entry.result.left)  v = read_f32();
        for (auto& v : entry.result.right) v = read_f32();
        out.push_back(std::move(entry));
    }
    return f.good() || f.eof();
}

void compare_against_baseline(const char* engine,
                              const ImpulseResult& got,
                              const std::vector<BaselineEntry>& baseline) {
    for (const auto& e : baseline) {
        if (e.name != engine) continue;
        bool ok = true;
        const float energy_delta = std::fabs(got.energy - e.result.energy);
        if (energy_delta > kEnergyTol) {
            std::fprintf(stderr,
                         "  %s: energy drift %.6f vs baseline %.6f (delta=%.3e tol=%.3e)\n",
                         engine, got.energy, e.result.energy, energy_delta, kEnergyTol);
            ok = false;
        }
        std::size_t bad_samples = 0;
        for (std::size_t i = 0; i < kFrames; ++i) {
            if (std::fabs(got.left[i]  - e.result.left[i])  > kSampleTol ||
                std::fabs(got.right[i] - e.result.right[i]) > kSampleTol) {
                ++bad_samples;
            }
        }
        if (bad_samples > 0u) {
            std::fprintf(stderr,
                         "  %s: %zu/%zu samples differ by >%.3e\n",
                         engine, bad_samples, kFrames, kSampleTol);
            ok = false;
        }
        NISPS_EXPECT(ok);
        return;
    }
    std::fprintf(stderr,
                 "  %s: not in baseline file (run with NISPS_REGEN_BASELINE=1)\n",
                 engine);
    NISPS_EXPECT(false);
}

// We accumulate every engine's result here so we can write the whole baseline
// file at the end of the run. Yes, a singleton — but it's test-local and
// test_main.cpp is the only consumer.
std::vector<BaselineEntry>& collected() {
    static std::vector<BaselineEntry> v;
    return v;
}

std::vector<BaselineEntry>& cached_baseline() {
    static std::vector<BaselineEntry> v;
    static bool loaded = false;
    if (!loaded) {
        (void)read_baseline(baseline_path(), v);
        loaded = true;
    }
    return v;
}

// Run + verify common path. Stages:
//   1. Run impulse, capture result.
//   2. Always check finite + bounded.
//   3. If regen mode: append to collected() to be written later.
//      Else: compare against cached_baseline().
template <typename E>
void run_and_check(const char* engine_name) {
    E e;
    auto got = run_impulse(e);
    assert_finite_and_bounded(got, engine_name);

    if (regen_baseline_mode()) {
        collected().push_back({engine_name, got});
        return;
    }

    const auto& baseline = cached_baseline();
    if (baseline.empty()) {
        std::fprintf(stderr,
                     "  %s: no baseline available at %s — run with NISPS_REGEN_BASELINE=1 to create.\n",
                     engine_name, baseline_path().c_str());
        // Don't fail outright — record the result so the test binary can be
        // used to bootstrap the baseline.
        collected().push_back({engine_name, got});
        return;
    }

    compare_against_baseline(engine_name, got, baseline);
}

}  // namespace

NISPS_TEST(engine_impulse_no_op) {
    run_and_check<nisps::NoOpEngine>("thru");
}
NISPS_TEST(engine_impulse_paf_synth) {
    run_and_check<nisps::PAFSynthEngine>("paf_synth");
}
NISPS_TEST(engine_impulse_channel_strip) {
    run_and_check<nisps::ChannelStripEngine>("channel_strip");
}
NISPS_TEST(engine_impulse_xiasri) {
    run_and_check<nisps::XIASRIEngine>("xiasri");
}
NISPS_TEST(engine_impulse_verb_fx) {
    run_and_check<nisps::VerbFXEngine>("verb_fx");
}
NISPS_TEST(engine_impulse_memlcelium) {
    run_and_check<nisps::MEMLCeliumEngine>("memlcelium");
}
NISPS_TEST(engine_impulse_breakor) {
    run_and_check<nisps::BreakOrEngine>("breakor");
}
NISPS_TEST(engine_impulse_elysiamorf) {
    run_and_check<nisps::ElysiamorfEngine>("elysiamorf");
}
NISPS_TEST(engine_impulse_analysis) {
    run_and_check<nisps::AnalysisEngine>("analysis");
}

// Final test: if we're in regen mode (or had no baseline to start), persist
// the collected results so the user can `mv` them into the canonical path.
NISPS_TEST(engine_impulse_baseline_writeback) {
    if (collected().empty()) return;  // pure-pass run, no need to write
    if (!regen_baseline_mode()) {
        // No baseline existed; leave a hint file but DON'T write the canonical
        // path automatically. We don't want a missing baseline to silently
        // self-heal.
        const std::string hint = baseline_path() + ".pending";
        if (write_baseline(hint, collected())) {
            std::printf("  [info] wrote pending baseline to %s — review and rename to %s\n",
                        hint.c_str(), baseline_path().c_str());
        }
        return;
    }
    if (!write_baseline(baseline_path(), collected())) {
        std::fprintf(stderr, "  failed to write baseline to %s\n", baseline_path().c_str());
        NISPS_EXPECT(false);
    } else {
        std::printf("  [regen] wrote %zu engines to %s\n",
                    collected().size(), baseline_path().c_str());
    }
}
