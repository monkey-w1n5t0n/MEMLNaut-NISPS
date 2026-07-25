// tests/cpp/ml_bench.cpp — behavioural benchmark for the NISPS ML control
// mapping. Compiles TWICE from this one source, exactly like engine_bench.cpp:
//
//   native : CMake target `nisps_ml_bench` (Release/-O3, see nisps/CMakeLists.txt)
//   wasm   : emcc, driven by scripts/bench-ml.sh with the same flags
//            scripts/build-wasm.sh uses for the shipped module
//
// WHAT THIS IS FOR
// ----------------
// NISPS is a CONTROLLER, not a synth. It maps a small control vector (joystick,
// pad, gamepad, MIDI CC) onto an arbitrary-range output vector that downstream
// systems bind to synth or visual parameters. Nothing here makes sound, and
// nothing here should reason about sound. The object of study is the MAPPING —
// the shape of f: control-space -> parameter-space — and the way a musician's
// interaction journey deforms it.
//
// The musician's only teaching channel is positive feedback ("I like these
// outputs HERE"), occasional negative feedback ("not this, here"), and
// exploration gestures. There is no ground truth and no test set, so loss is
// nearly worthless as a description of behaviour: it measures fit to points the
// user already dictated, which is the one thing they never experience. What
// they experience is the mapping's geometry and how their gestures move it.
//
// So this benchmark REPORTS geometry and gesture-response, never loss alone.
//
// NOTHING HERE ASSERTS. Same call as engine_bench.cpp and the firmware size
// job: a behavioural threshold is either slack enough to be meaningless or
// tight enough to fail on an unrelated change. Regressions are noticed by
// running with --compare against a previous report. Invariants that genuinely
// MUST hold (undo restores exactly, capacity never corrupts, placement takes)
// live in tests/cpp/test_ml_behaviour.cpp as real ctest assertions.
//
// DETERMINISM
// -----------
// Every random draw in this file comes from a seeded nisps::Rng, and the net's
// own RNG is seeded per rig construction. Two runs of the same binary with the
// same --seed produce bit-identical reports. Branch points are implemented by
// REPLAYING THE PREFIX FROM SCRATCH rather than by snapshotting controller
// state — replay is exact under a deterministic RNG, needs no serialisation
// surface, and cannot drift from what the real code path does.
//
// SHAPE-AGNOSTIC BY CONSTRUCTION
// ------------------------------
// Everything takes its dimensions from the rig, so the same corpus runs at any
// (n_in, hidden[3], n_out). That is the point: it is how "does a wider/deeper
// net change the UX?" becomes a number instead of an opinion. Because a raster
// grid is exponential in n_in, the sample set is a deterministic Kronecker
// (golden-ratio additive-recurrence) low-discrepancy sequence, which is
// well-distributed at any dimension and identical across runs and targets.
//
// A NOTE ON `spread`
// ------------------
// `spread` is still a parameter of the core API (draw_weights/move_weights/
// enter_explore) and this harness therefore still passes it. It is pinned to
// kSpread below so it is a constant of the experiment rather than a free knob.
// When the spread knob is removed from the core, delete kSpread and the call
// sites follow. Note that removing the KNOB does not remove the arity coupling
// it exposes: spread=1 is Xavier, whose scale is 1/sqrt(fan_in), so
// perturbation size still tracks input arity. See MAP.md § `tests/cpp/`.

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <span>
#include <string>
#include <vector>

#include "../../nisps/core/rng.hpp"
#include "../../nisps/ml/dynamic_storage.hpp"
#include "../../nisps/ml/feedback.hpp"
#include "../../nisps/ml/geo_push.hpp"
#include "../../nisps/ml/mlp.hpp"

namespace {

using nisps::Rng;
using nisps::ml::AvoidStyle;
using nisps::ml::DynamicFeedbackStorage;
using nisps::ml::DynamicStorage;
using nisps::ml::FeedbackControllerCore;
using nisps::ml::FeedbackMode;
using nisps::ml::MLPCore;

using Mlp      = MLPCore<DynamicStorage>;
using Feedback = FeedbackControllerCore<DynamicFeedbackStorage>;

// Pinned constants of the experiment. These are deliberately NOT knobs: a
// benchmark whose every parameter floats cannot be compared across runs.
constexpr float       kMoveSpeed       = 0.1f;   // nominal perturbation "speed"

// EXCEPT these two, which are the live design questions and therefore have to
// be sweepable:
//
//   spread  — 1.0 is Xavier (scale 1/sqrt(fan_in)), 0.0 is plain uniform
//             [-1,1] with NO fan_in coupling. `--spread 0` is exactly the
//             behaviour the core would have once the spread knob and Xavier
//             are removed, so this flag measures that change BEFORE paying for
//             the refactor (which shifts every golden vector).
//   geo_lr  — feedback.hpp's default is 0.001, ported from upstream
//             InterfaceRL.hpp:312. Upstream applied it inside a multi-pass
//             optimise() loop; NISPS applies it ONCE per press. `--geo-lr`
//             makes the consequence measurable.
constexpr std::size_t kUndoDepth       = 4u;
constexpr std::size_t kReplayCap       = 64u;
constexpr std::size_t kProbePoints     = 2048u;  // sample set size for field metrics
constexpr float       kNearRadius[]    = {0.01f, 0.05f, 0.10f, 0.25f};
constexpr std::size_t kNearRings       = sizeof(kNearRadius) / sizeof(float);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
struct Config {
    std::size_t n_in      = 2u;   // operator default (2026-07-25)
    std::size_t hidden[3] = {16u, 16u, 16u};
    std::size_t n_out     = 8u;   // operator default (2026-07-25)
    std::uint64_t seed    = 0x5EEDu;
    std::size_t max_examples = 128u;
    std::string only;             // run one scenario by id, empty = all
    bool        smoke = false;    // reduced point counts, proves it still runs
    float       spread = 1.0f;    // 1 = Xavier, 0 = uniform (post-removal)
    float       geo_lr = 0.001f;  // feedback.hpp default
    std::size_t geo_iters = 1u;   // presses applied per dislike (1 = today)
};

std::size_t probe_points(const Config& c) { return c.smoke ? 128u : kProbePoints; }

// ---------------------------------------------------------------------------
// Deterministic low-discrepancy sampler over [0,1]^n, mapped to [-1,1]^n.
//
// Additive recurrence with the generalised golden ratio: x_k = frac(k * a_i),
// a_i = phi_d^-(i+1) where phi_d solves x^(d+1) = x + 1. Well-distributed at
// any dimension, needs no state beyond k, identical on every target.
// ---------------------------------------------------------------------------
class Kronecker {
   public:
    explicit Kronecker(std::size_t dim) : dim_(dim), alpha_(dim) {
        // Solve x^(d+1) = x + 1 by fixed-point iteration; converges fast.
        double phi = 2.0;
        for (int it = 0; it < 64; ++it) {
            phi = std::pow(1.0 + phi, 1.0 / static_cast<double>(dim + 1u));
        }
        double a = 1.0;
        for (std::size_t i = 0; i < dim; ++i) {
            a /= phi;
            alpha_[i] = a;
        }
    }

    // Write sample k into `out` (dim floats), mapped to [-1, 1].
    void point(std::size_t k, std::span<float> out) const {
        const double kk = static_cast<double>(k) + 0.5;
        for (std::size_t i = 0; i < dim_ && i < out.size(); ++i) {
            double v = kk * alpha_[i];
            v -= std::floor(v);
            out[i] = static_cast<float>(v * 2.0 - 1.0);
        }
    }

   private:
    std::size_t         dim_;
    std::vector<double> alpha_;
};

// ---------------------------------------------------------------------------
// Rig — an MLP + feedback controller at an arbitrary shape, plus the sample
// set the field metrics are computed over.
// ---------------------------------------------------------------------------
struct Rig {
    Config      cfg;
    Mlp         mlp;
    Feedback    fb;
    Rng         rng;                 // scenario-side RNG (never the net's)
    Kronecker   sampler;
    std::vector<float> probe_pts;    // n_pts * n_in
    std::vector<float> scratch_out;  // n_pts * n_out

    explicit Rig(const Config& c)
        : cfg(c),
          mlp(c.seed,
              c.n_in,
              std::span<const std::size_t>(c.hidden, 3u),
              c.n_out,
              c.max_examples,
              4096u),
          fb(c.seed ^ 0xF33DBACCull,
             c.n_out,
             mlp.weight_count(),
             kUndoDepth,
             c.n_in,
             kReplayCap),
          rng(c.seed ^ 0xA5A5A5A5ull),
          sampler(c.n_in) {
        const std::size_t n = probe_points(c);
        probe_pts.resize(n * c.n_in);
        scratch_out.resize(n * c.n_out);
        for (std::size_t k = 0; k < n; ++k) {
            sampler.point(k, std::span<float>(&probe_pts[k * c.n_in], c.n_in));
        }
        fb.set_geo_lr(c.geo_lr);
        // MLPCore's ctor draws at spread=1; re-draw when the experiment asks
        // for a different init regime. Same RNG stream either way.
        if (c.spread != 1.0f) mlp.draw_weights(c.spread);
    }

    // Every call site reads the regime off the rig rather than a constant, so
    // --spread reaches the RL perturbation path too, not just init.
    float spread() const { return cfg.spread; }

    std::size_t n_pts() const { return probe_pts.size() / cfg.n_in; }

    // Infer over the whole sample set into `dst` (n_pts * n_out).
    void field(std::vector<float>& dst) {
        dst.resize(n_pts() * cfg.n_out);
        mlp.infer_batch(probe_pts, dst);
    }

    // Infer at one point.
    void at(std::span<const float> x, std::vector<float>& out) {
        out.resize(cfg.n_out);
        for (std::size_t i = 0; i < cfg.n_in; ++i) mlp.set_input(i, x[i]);
        mlp.process();
        auto o = mlp.outputs();
        for (std::size_t j = 0; j < cfg.n_out; ++j) out[j] = o[j];
    }
};

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------
float l2(std::span<const float> a, std::span<const float> b) {
    float acc = 0.f;
    const std::size_t n = a.size() < b.size() ? a.size() : b.size();
    for (std::size_t i = 0; i < n; ++i) {
        const float d = a[i] - b[i];
        acc += d * d;
    }
    return std::sqrt(acc);
}

float percentile(std::vector<float> v, float p) {
    if (v.empty()) return 0.f;
    // Deterministic partial selection: full sort. n is a few thousand; the
    // cost is irrelevant next to the inference it summarises, and a full sort
    // has no tie-break ambiguity across targets.
    for (std::size_t i = 1; i < v.size(); ++i) {
        float key = v[i];
        std::size_t j = i;
        while (j > 0 && v[j - 1] > key) { v[j] = v[j - 1]; --j; }
        v[j] = key;
    }
    const float idx = p * static_cast<float>(v.size() - 1);
    const std::size_t lo = static_cast<std::size_t>(idx);
    const std::size_t hi = (lo + 1u < v.size()) ? lo + 1u : lo;
    const float frac = idx - static_cast<float>(lo);
    return v[lo] * (1.f - frac) + v[hi] * frac;
}

float mean(const std::vector<float>& v) {
    if (v.empty()) return 0.f;
    float s = 0.f;
    for (float x : v) s += x;
    return s / static_cast<float>(v.size());
}

// ---------------------------------------------------------------------------
// FIELD METRICS — the static geometry of the mapping.
// ---------------------------------------------------------------------------
struct FieldMetrics {
    float gain_p50      = 0.f;  // median ||J|| over the sample set
    float gain_p95      = 0.f;
    float cliff_index   = 0.f;  // p95 / p50 — coexisting cliffs and dead zones
    float dead_frac     = 0.f;  // share of points with gain < 10% of median
    float range_util    = 0.f;  // mean over outputs of (p99-p1), outputs in [0,1]
    float rail_frac     = 0.f;  // share of (point,out) within 1% of a rail
    float eff_dim       = 0.f;  // participation ratio of the output covariance
    float eff_dim_norm  = 0.f;  // eff_dim / n_out
};

// Frobenius norm of the Jacobian at x, by central differences.
float jacobian_norm(Rig& rig, std::span<const float> x, float h) {
    std::vector<float> xp(rig.cfg.n_in), xm(rig.cfg.n_in);
    std::vector<float> op, om;
    float acc = 0.f;
    for (std::size_t i = 0; i < rig.cfg.n_in; ++i) {
        for (std::size_t k = 0; k < rig.cfg.n_in; ++k) { xp[k] = x[k]; xm[k] = x[k]; }
        xp[i] += h;
        xm[i] -= h;
        rig.at(xp, op);
        rig.at(xm, om);
        for (std::size_t j = 0; j < rig.cfg.n_out; ++j) {
            const float d = (op[j] - om[j]) / (2.f * h);
            acc += d * d;
        }
    }
    return std::sqrt(acc);
}

FieldMetrics measure_field(Rig& rig) {
    FieldMetrics m;
    const std::size_t n   = rig.n_pts();
    const std::size_t nin = rig.cfg.n_in;
    const std::size_t nout = rig.cfg.n_out;

    std::vector<float> outs;
    rig.field(outs);

    // --- gain -------------------------------------------------------------
    // Sub-sample the Jacobian: it costs 2*n_in inferences per point, which at
    // 2048 points x 32 inputs would dominate the whole run for no extra
    // resolution. 256 points is plenty for a p50/p95 and is deterministic.
    const std::size_t n_jac = (n < 256u) ? n : 256u;
    const std::size_t stride = n / n_jac;
    std::vector<float> gains;
    gains.reserve(n_jac);
    for (std::size_t k = 0; k < n_jac; ++k) {
        const std::size_t idx = k * stride;
        gains.push_back(jacobian_norm(
            rig, std::span<const float>(&rig.probe_pts[idx * nin], nin), 1e-3f));
    }
    m.gain_p50 = percentile(gains, 0.50f);
    m.gain_p95 = percentile(gains, 0.95f);
    m.cliff_index = (m.gain_p50 > 1e-9f) ? (m.gain_p95 / m.gain_p50) : 0.f;

    const float dead_thresh = 0.1f * m.gain_p50;
    std::size_t dead = 0u;
    for (float g : gains) if (g < dead_thresh) ++dead;
    m.dead_frac = gains.empty() ? 0.f : static_cast<float>(dead) / static_cast<float>(gains.size());

    // --- range utilisation + rails ----------------------------------------
    // Network outputs are sigmoid, so [0,1] is the full nominal range. Range
    // mapping (min/max/curve) happens DOWNSTREAM of the net and is deliberately
    // not modelled here — this measures what the net itself offers.
    float util_acc = 0.f;
    std::size_t rails = 0u;
    for (std::size_t j = 0; j < nout; ++j) {
        std::vector<float> col;
        col.reserve(n);
        for (std::size_t k = 0; k < n; ++k) {
            const float v = outs[k * nout + j];
            col.push_back(v);
            if (v < 0.01f || v > 0.99f) ++rails;
        }
        util_acc += percentile(col, 0.99f) - percentile(col, 0.01f);
    }
    m.range_util = (nout > 0u) ? util_acc / static_cast<float>(nout) : 0.f;
    m.rail_frac  = (n * nout > 0u)
                 ? static_cast<float>(rails) / static_cast<float>(n * nout) : 0.f;

    // --- effective dimensionality ----------------------------------------
    // Participation ratio PR = (sum lambda)^2 / sum lambda^2. Because
    // sum lambda = trace(C) and sum lambda^2 = ||C||_F^2, this needs no
    // eigendecomposition — exact, cheap, and target-stable.
    std::vector<float> mu(nout, 0.f);
    for (std::size_t k = 0; k < n; ++k)
        for (std::size_t j = 0; j < nout; ++j) mu[j] += outs[k * nout + j];
    for (std::size_t j = 0; j < nout; ++j) mu[j] /= static_cast<float>(n);

    std::vector<float> cov(nout * nout, 0.f);
    for (std::size_t k = 0; k < n; ++k) {
        for (std::size_t a = 0; a < nout; ++a) {
            const float da = outs[k * nout + a] - mu[a];
            for (std::size_t b = 0; b < nout; ++b) {
                cov[a * nout + b] += da * (outs[k * nout + b] - mu[b]);
            }
        }
    }
    const float inv = 1.f / static_cast<float>(n);
    float trace = 0.f, fro2 = 0.f;
    for (std::size_t a = 0; a < nout; ++a) {
        for (std::size_t b = 0; b < nout; ++b) {
            cov[a * nout + b] *= inv;
            fro2 += cov[a * nout + b] * cov[a * nout + b];
        }
        trace += cov[a * nout + a];
    }
    m.eff_dim = (fro2 > 1e-20f) ? (trace * trace) / fro2 : 0.f;
    m.eff_dim_norm = (nout > 0u) ? m.eff_dim / static_cast<float>(nout) : 0.f;
    return m;
}

// ---------------------------------------------------------------------------
// DISPLACEMENT — how much a gesture moved the mapping, and WHERE.
//
// This is the core measurement for negative feedback. `before`/`after` are
// full fields over the sample set. We report displacement at the pressed
// point, in rings around it, at the stored positive examples, and globally.
// The ratio local/global is the "blast radius" — a good dislike is local.
// ---------------------------------------------------------------------------
struct Displacement {
    float at_point   = 0.f;
    float ring[kNearRings] = {0.f, 0.f, 0.f, 0.f};
    float global_p50 = 0.f;
    float global_p95 = 0.f;
    float blast_ratio = 0.f;   // at_point / global_p50; high = local, low = smeared
    float positives_mean = 0.f; // mean displacement at stored positive positions
    float positives_max  = 0.f;
};

Displacement measure_displacement(Rig& rig,
                                  const std::vector<float>& before,
                                  const std::vector<float>& after,
                                  std::span<const float> pressed,
                                  const std::vector<float>& positive_xs) {
    Displacement d;
    const std::size_t n = rig.n_pts();
    const std::size_t nin = rig.cfg.n_in;
    const std::size_t nout = rig.cfg.n_out;

    std::vector<float> per_pt;
    per_pt.reserve(n);
    for (std::size_t k = 0; k < n; ++k) {
        per_pt.push_back(l2(std::span<const float>(&before[k * nout], nout),
                            std::span<const float>(&after[k * nout], nout)));
    }
    d.global_p50 = percentile(per_pt, 0.50f);
    d.global_p95 = percentile(per_pt, 0.95f);

    // Nearest sample point to the pressed position stands in for "at_point";
    // the sample set is dense enough that this is a fair proxy and it keeps
    // before/after strictly comparable (same evaluation points).
    std::size_t best = 0u;
    float best_d = 1e30f;
    for (std::size_t k = 0; k < n; ++k) {
        const float dd = l2(std::span<const float>(&rig.probe_pts[k * nin], nin), pressed);
        if (dd < best_d) { best_d = dd; best = k; }
    }
    d.at_point = per_pt[best];
    d.blast_ratio = (d.global_p50 > 1e-9f) ? d.at_point / d.global_p50 : 0.f;

    // Rings: mean displacement among points whose distance to `pressed` falls
    // in [r_prev, r]. Empty rings report 0 (visible as such in the report).
    for (std::size_t r = 0; r < kNearRings; ++r) {
        const float lo = (r == 0u) ? 0.f : kNearRadius[r - 1u];
        const float hi = kNearRadius[r];
        float acc = 0.f;
        std::size_t cnt = 0u;
        for (std::size_t k = 0; k < n; ++k) {
            const float dd = l2(std::span<const float>(&rig.probe_pts[k * nin], nin), pressed);
            if (dd >= lo && dd < hi) { acc += per_pt[k]; ++cnt; }
        }
        d.ring[r] = cnt ? acc / static_cast<float>(cnt) : 0.f;
    }

    // Collateral damage at the stored positives.
    const std::size_t n_pos = positive_xs.size() / (nin ? nin : 1u);
    float acc = 0.f, mx = 0.f;
    for (std::size_t p = 0; p < n_pos; ++p) {
        std::span<const float> px(&positive_xs[p * nin], nin);
        std::size_t bi = 0u; float bd = 1e30f;
        for (std::size_t k = 0; k < n; ++k) {
            const float dd = l2(std::span<const float>(&rig.probe_pts[k * nin], nin), px);
            if (dd < bd) { bd = dd; bi = k; }
        }
        acc += per_pt[bi];
        if (per_pt[bi] > mx) mx = per_pt[bi];
    }
    d.positives_mean = n_pos ? acc / static_cast<float>(n_pos) : 0.f;
    d.positives_max  = mx;
    return d;
}

// ---------------------------------------------------------------------------
// EXAMPLE LAYOUTS — the "given these training examples" half of the question.
// Deterministic, shape-agnostic, and named so a report row is legible.
// ---------------------------------------------------------------------------
struct Dataset {
    std::vector<float> xs;   // n * n_in
    std::vector<float> ys;   // n * n_out
    std::size_t n = 0u;
};

Dataset make_dataset(const Config& cfg, const char* layout, std::size_t count, Rng& rng) {
    Dataset ds;
    ds.n = count;
    ds.xs.resize(count * cfg.n_in);
    ds.ys.resize(count * cfg.n_out);

    Kronecker k_in(cfg.n_in);
    Kronecker k_out(cfg.n_out);

    for (std::size_t i = 0; i < count; ++i) {
        std::span<float> x(&ds.xs[i * cfg.n_in], cfg.n_in);
        std::span<float> y(&ds.ys[i * cfg.n_out], cfg.n_out);

        if (std::strcmp(layout, "scattered") == 0) {
            k_in.point(i * 7u + 3u, x);
        } else if (std::strcmp(layout, "clustered") == 0) {
            // All examples inside a small ball — the "I only played in one
            // corner" case, which is what most real sessions look like.
            k_in.point(i * 7u + 3u, x);
            for (std::size_t j = 0; j < cfg.n_in; ++j) x[j] = 0.3f + 0.15f * x[j];
        } else if (std::strcmp(layout, "corners") == 0) {
            for (std::size_t j = 0; j < cfg.n_in; ++j) {
                x[j] = ((i >> (j % 8u)) & 1u) ? 1.f : -1.f;
            }
        } else if (std::strcmp(layout, "collinear") == 0) {
            // Degenerate: every example on one line through the space.
            const float t = (count > 1u)
                ? (2.f * static_cast<float>(i) / static_cast<float>(count - 1u) - 1.f) : 0.f;
            for (std::size_t j = 0; j < cfg.n_in; ++j) x[j] = t;
        } else if (std::strcmp(layout, "coincident") == 0) {
            // Pathological: every example at the SAME input position, with
            // different targets. Tests contradictory teaching.
            for (std::size_t j = 0; j < cfg.n_in; ++j) x[j] = 0.f;
        } else {  // "uniform"
            k_in.point(i, x);
        }

        // Targets: a deterministic spread of output vectors. `randomised`
        // draws from the scenario RNG so that the "randomise a patch then
        // place it" journey uses genuinely unstructured targets.
        if (std::strcmp(layout, "randomised") == 0) {
            for (std::size_t j = 0; j < cfg.n_out; ++j) {
                y[j] = 0.5f + 0.5f * rng.next_float_signed();
            }
        } else {
            k_out.point(i * 11u + 5u, y);
            for (std::size_t j = 0; j < cfg.n_out; ++j) y[j] = 0.5f + 0.5f * y[j];
        }
    }
    return ds;
}

// ---------------------------------------------------------------------------
// Report emission. Plain JSON on stdout — bench-ml.sh captures it and
// tests/cpp/ml_bench_report.mjs formats + diffs it, mirroring bench_report.mjs.
// ---------------------------------------------------------------------------
class Json {
   public:
    void begin_run(const Config& c) {
        printf("{\n");
        printf("  \"schema\": \"nisps-ml-bench/1\",\n");
        printf("  \"shape\": {\"n_in\": %zu, \"hidden\": [%zu, %zu, %zu], \"n_out\": %zu},\n",
               c.n_in, c.hidden[0], c.hidden[1], c.hidden[2], c.n_out);
        printf("  \"seed\": %llu,\n", static_cast<unsigned long long>(c.seed));
        printf("  \"max_examples\": %zu,\n", c.max_examples);
        printf("  \"spread\": %.6g, \"geo_lr\": %.6g, \"geo_iters\": %zu,\n",
               static_cast<double>(c.spread), static_cast<double>(c.geo_lr), c.geo_iters);
        printf("  \"target\": \"%s\",\n", target_name());
        printf("  \"scenarios\": [\n");
    }
    void end_run() { printf("\n  ]\n}\n"); }

    void begin_scenario(const char* id, const char* what) {
        if (!first_) printf(",\n");
        first_ = false;
        printf("    {\"id\": \"%s\", \"what\": \"%s\", \"metrics\": {", id, what);
        first_metric_ = true;
    }
    void end_scenario() { printf("}}"); }

    void kv(const char* k, float v) {
        if (!first_metric_) printf(", ");
        first_metric_ = false;
        // %.6g keeps the report diffable without pretending to more precision
        // than a float carries.
        printf("\"%s\": %.6g", k, static_cast<double>(v));
    }
    void kv(const char* k, std::size_t v) {
        if (!first_metric_) printf(", ");
        first_metric_ = false;
        printf("\"%s\": %zu", k, v);
    }

    void field(const char* prefix, const FieldMetrics& m) {
        char b[96];
        auto p = [&](const char* n) { snprintf(b, sizeof b, "%s%s", prefix, n); return b; };
        kv(p("gain_p50"), m.gain_p50);
        kv(p("gain_p95"), m.gain_p95);
        kv(p("cliff_index"), m.cliff_index);
        kv(p("dead_frac"), m.dead_frac);
        kv(p("range_util"), m.range_util);
        kv(p("rail_frac"), m.rail_frac);
        kv(p("eff_dim"), m.eff_dim);
        kv(p("eff_dim_norm"), m.eff_dim_norm);
    }

    void disp(const char* prefix, const Displacement& d) {
        char b[96];
        auto p = [&](const char* n) { snprintf(b, sizeof b, "%s%s", prefix, n); return b; };
        kv(p("at_point"), d.at_point);
        kv(p("ring_001"), d.ring[0]);
        kv(p("ring_005"), d.ring[1]);
        kv(p("ring_010"), d.ring[2]);
        kv(p("ring_025"), d.ring[3]);
        kv(p("global_p50"), d.global_p50);
        kv(p("global_p95"), d.global_p95);
        kv(p("blast_ratio"), d.blast_ratio);
        kv(p("positives_mean"), d.positives_mean);
        kv(p("positives_max"), d.positives_max);
    }

    static const char* target_name() {
#if defined(__EMSCRIPTEN__)
        return "wasm";
#else
        return "native";
#endif
    }

   private:
    bool first_ = true;
    bool first_metric_ = true;
};

// ---------------------------------------------------------------------------
// Scenario plumbing
// ---------------------------------------------------------------------------
bool selected(const Config& c, const char* id) {
    return c.only.empty() || c.only == id;
}

// Place ONE positive example the way the real product path does.
//
// This is load-bearing and easy to get wrong. A thumbs-up in firmware/browser
// does TWO things, not one:
//   1. mlp.add_example(x, y)      — the supervised dataset the net trains on
//   2. fb.store_positive(mlp, y)  — the feedback controller's REPLAY memory,
//                                   a separate buffer (feedback.hpp storage,
//                                   nisps/ml/replay.hpp algorithms)
// dislike_geometric reads (2), not (1): it k-NNs the replay positives to build
// a push-away target. A harness that only calls add_example leaves the replay
// buffer empty, so every dislike takes the documented cold-start branch
// (FeedbackAction::GeometricColdStart) and measures a path no real session
// reaches after its first like. store_positive records at the mlp's CURRENT
// input position, so the inputs must be set and processed first.
void place_positive(Rig& rig, std::span<const float> x, std::span<const float> y) {
    for (std::size_t j = 0; j < rig.cfg.n_in; ++j) rig.mlp.set_input(j, x[j]);
    rig.mlp.process();
    rig.mlp.add_example(x, y);
    rig.fb.store_positive(rig.mlp, y);
}

// The ExploreAndPlace accessor contract, in one place because getting it wrong
// fails SILENTLY. placed_output() is valid ONLY while state == Placing;
// commit_place()/commit_reposition() move state to Idle and hand the vector to
// committed_output() instead (feedback.hpp:583, :641). Reading placed_output()
// after commit yields an EMPTY span, and an empty span makes l2() return 0 —
// which reads as a perfect placement rather than a broken one. Returns false
// when nothing was committed, so callers can report that instead of scoring it.
bool take_committed(Rig& rig, std::vector<float>& out) {
    auto c = rig.fb.committed_output();
    if (c.size() < rig.cfg.n_out) { out.clear(); return false; }
    out.assign(c.begin(), c.end());
    return true;
}

// Train a rig on a dataset, returning the stored positive input positions
// (needed by the collateral-damage metric).
std::vector<float> teach(Rig& rig, const Dataset& ds) {
    for (std::size_t i = 0; i < ds.n; ++i) {
        place_positive(rig,
            std::span<const float>(&ds.xs[i * rig.cfg.n_in], rig.cfg.n_in),
            std::span<const float>(&ds.ys[i * rig.cfg.n_out], rig.cfg.n_out));
    }
    rig.mlp.train();
    return ds.xs;
}

// =========================================================================
// ATOMIC PROBES — "unit tests" of the mapping. One gesture, one measurement.
// =========================================================================

// A1 — at_example: infer exactly where an example was placed. How well does
// the placement hold after training? This is the floor: if this is bad, every
// downstream journey metric is meaningless.
void probe_at_example(const Config& cfg, Json& js) {
    if (!selected(cfg, "A1_at_example")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 12u, rig.rng);
    teach(rig, ds);

    std::vector<float> got, errs;
    for (std::size_t i = 0; i < ds.n; ++i) {
        rig.at(std::span<const float>(&ds.xs[i * cfg.n_in], cfg.n_in), got);
        errs.push_back(l2(got, std::span<const float>(&ds.ys[i * cfg.n_out], cfg.n_out)));
    }
    js.begin_scenario("A1_at_example", "infer exactly at each stored example");
    js.kv("n_examples", ds.n);
    js.kv("err_mean", mean(errs));
    js.kv("err_p95", percentile(errs, 0.95f));
    js.kv("err_max", percentile(errs, 1.0f));
    js.kv("final_loss", rig.mlp.eval_loss());
    js.end_scenario();
}

// A2 — around_example: infer on rings at increasing radius from an example.
// How fast does the taught value decay into the surrounding field? This is
// "how big is the region my thumbs-up actually controls".
void probe_around_example(const Config& cfg, Json& js) {
    if (!selected(cfg, "A2_around_example")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 12u, rig.rng);
    teach(rig, ds);

    std::span<const float> x0(&ds.xs[0], cfg.n_in);
    std::span<const float> y0(&ds.ys[0], cfg.n_out);
    std::vector<float> probe(cfg.n_in), got;

    js.begin_scenario("A2_around_example", "output drift on rings around one example");
    for (std::size_t r = 0; r < kNearRings; ++r) {
        // Deterministic ring: perturb along each axis in turn, average.
        float acc = 0.f;
        std::size_t cnt = 0u;
        for (std::size_t axis = 0; axis < cfg.n_in; ++axis) {
            for (int sign = -1; sign <= 1; sign += 2) {
                for (std::size_t j = 0; j < cfg.n_in; ++j) probe[j] = x0[j];
                probe[axis] += static_cast<float>(sign) * kNearRadius[r];
                rig.at(probe, got);
                acc += l2(got, y0);
                ++cnt;
            }
        }
        char key[32];
        snprintf(key, sizeof key, "drift_r%03d", static_cast<int>(kNearRadius[r] * 100.f));
        js.kv(key, cnt ? acc / static_cast<float>(cnt) : 0.f);
    }
    js.end_scenario();
}

// A3 — far_field: what does the mapping do where nothing was ever taught?
// Reported as distance from the nearest taught output, plus the field metrics
// restricted to the far region. An instrument that collapses to one value
// away from its examples is unplayable outside the taught spots.
void probe_far_field(const Config& cfg, Json& js) {
    if (!selected(cfg, "A3_far_field")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "clustered", 12u, rig.rng);
    teach(rig, ds);

    const std::size_t n = rig.n_pts();
    std::vector<float> outs;
    rig.field(outs);

    std::vector<float> far_dists, novelty;
    for (std::size_t k = 0; k < n; ++k) {
        std::span<const float> x(&rig.probe_pts[k * cfg.n_in], cfg.n_in);
        float nearest = 1e30f;
        std::size_t nearest_i = 0u;
        for (std::size_t i = 0; i < ds.n; ++i) {
            const float d = l2(x, std::span<const float>(&ds.xs[i * cfg.n_in], cfg.n_in));
            if (d < nearest) { nearest = d; nearest_i = i; }
        }
        if (nearest > 0.75f) {  // "far" = well outside the taught cluster
            far_dists.push_back(nearest);
            novelty.push_back(l2(std::span<const float>(&outs[k * cfg.n_out], cfg.n_out),
                                 std::span<const float>(&ds.ys[nearest_i * cfg.n_out], cfg.n_out)));
        }
    }
    js.begin_scenario("A3_far_field", "mapping behaviour far from every example");
    js.kv("far_points", far_dists.size());
    js.kv("novelty_mean", mean(novelty));
    js.kv("novelty_p95", percentile(novelty, 0.95f));
    FieldMetrics fm = measure_field(rig);
    js.field("field_", fm);
    js.end_scenario();
}

// A4 — negative_once: one dislike at a point, under BOTH candidate designs.
// Reports the displacement field for each so they can be compared directly.
// This is the measurement that adjudicates the negative-feedback design.
void probe_negative_once(const Config& cfg, Json& js) {
    if (!selected(cfg, "A4_negative_once")) return;

    struct Variant { const char* id; FeedbackMode mode; AvoidStyle style; };
    const Variant variants[] = {
        {"A4_negative_once_geometric", FeedbackMode::Avoid, AvoidStyle::Geometric},
        {"A4_negative_once_diffuse",   FeedbackMode::Avoid, AvoidStyle::Diffuse},
    };

    for (const Variant& v : variants) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "scattered", 12u, rig.rng);
        std::vector<float> pos_xs = teach(rig, ds);

        std::vector<float> before;
        rig.field(before);

        // Press at a point deliberately BETWEEN examples — the realistic case.
        std::vector<float> press(cfg.n_in);
        for (std::size_t j = 0; j < cfg.n_in; ++j) {
            press[j] = 0.5f * (ds.xs[j] + ds.xs[cfg.n_in + j]);
        }
        std::vector<float> heard;
        rig.at(press, heard);

        rig.fb.set_mode(v.mode, rig.mlp);
        rig.fb.set_avoid_style(v.style);
        for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, press[j]);
        rig.mlp.process();
        rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});

        std::vector<float> after;
        rig.field(after);
        Displacement d = measure_displacement(rig, before, after, press, pos_xs);

        js.begin_scenario(v.id, "one dislike between two examples");
        js.disp("", d);
        js.kv("positives_after", rig.fb.positive_count());
        js.kv("negatives_after", rig.fb.negative_count());
        js.end_scenario();
    }
}

// A5 — negative_twice_same: press dislike twice at the SAME point. Does the
// second press compound, saturate, or diverge? Replay memory deepens an
// existing negative within 0.05 rather than storing a new one
// (replay.hpp:106), so the two presses are NOT independent — this measures
// what that actually feels like.
void probe_negative_twice(const Config& cfg, Json& js) {
    if (!selected(cfg, "A5_negative_twice_same")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 12u, rig.rng);
    std::vector<float> pos_xs = teach(rig, ds);
    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);

    std::vector<float> press(cfg.n_in);
    for (std::size_t j = 0; j < cfg.n_in; ++j) press[j] = 0.5f * (ds.xs[j] + ds.xs[cfg.n_in + j]);

    std::vector<float> s0, s1, s2, heard;
    rig.field(s0);
    for (int press_i = 0; press_i < 2; ++press_i) {
        rig.at(press, heard);
        for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, press[j]);
        rig.mlp.process();
        rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});
        rig.field(press_i == 0 ? s1 : s2);
    }

    Displacement d1 = measure_displacement(rig, s0, s1, press, pos_xs);
    Displacement d2 = measure_displacement(rig, s1, s2, press, pos_xs);

    js.begin_scenario("A5_negative_twice_same", "two dislikes at the same point");
    js.disp("p1_", d1);
    js.disp("p2_", d2);
    // >1 means the second press did MORE than the first (compounding);
    // <1 means it did less (saturating). Either is a design fact worth knowing.
    js.kv("compounding", (d1.at_point > 1e-9f) ? d2.at_point / d1.at_point : 0.f);
    js.kv("negatives_after", rig.fb.negative_count());
    js.end_scenario();
}

// A6 — negative_adjacent_then_return: dislike at x, move slightly, dislike
// again, then go BACK to x and measure whether the first dislike survived.
// This is the operator's exact scenario, and it is the one most likely to
// expose replay dedup behaving unlike what a musician expects: the 0.05
// dedup radius means "a little to the left" may deepen the SAME negative
// rather than create a new one.
void probe_negative_adjacent(const Config& cfg, Json& js) {
    if (!selected(cfg, "A6_negative_adjacent")) return;

    // Two offsets: inside the dedup radius, and outside it.
    const float offsets[] = {0.02f, 0.20f};
    for (float off : offsets) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "scattered", 12u, rig.rng);
        std::vector<float> pos_xs = teach(rig, ds);
        rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
        rig.fb.set_avoid_style(AvoidStyle::Geometric);

        std::vector<float> a(cfg.n_in), b(cfg.n_in);
        for (std::size_t j = 0; j < cfg.n_in; ++j) {
            a[j] = 0.5f * (ds.xs[j] + ds.xs[cfg.n_in + j]);
            b[j] = a[j];
        }
        b[0] -= off;  // "a little to the left"

        std::vector<float> s0, s1, s2, heard;
        rig.field(s0);

        auto press_at = [&](std::span<const float> p) {
            rig.at(p, heard);
            for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, p[j]);
            rig.mlp.process();
            rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});
        };

        press_at(a);
        rig.field(s1);
        press_at(b);
        rig.field(s2);

        Displacement d_a  = measure_displacement(rig, s0, s1, a, pos_xs);
        Displacement d_b  = measure_displacement(rig, s1, s2, b, pos_xs);
        // Did pressing at b UNDO the effect at a? Compare the field at a
        // across s0 -> s2 against s0 -> s1.
        Displacement d_net = measure_displacement(rig, s0, s2, a, pos_xs);

        char id[64];
        snprintf(id, sizeof id, "A6_negative_adjacent_%03d", static_cast<int>(off * 100.f));
        js.begin_scenario(id, "dislike, shift left, dislike again, look back at the first");
        js.kv("offset", off);
        js.kv("dedup_radius", 0.05f);  // replay.hpp kReplayDedupRadius
        js.disp("first_", d_a);
        js.disp("second_", d_b);
        js.disp("net_", d_net);
        // <1 means the second press partly UNDID the first at a.
        js.kv("first_survives", (d_a.at_point > 1e-9f) ? d_net.at_point / d_a.at_point : 0.f);
        js.kv("negatives_after", rig.fb.negative_count());
        js.end_scenario();
    }
}

// A7 — negative_near_positive: the operator's stated design intent, made
// measurable. "I don't like this here, but DON'T disturb the positives I gave
// nearby." Places a positive example at a known distance, then dislikes next
// to it, and reports damage to that positive as a function of separation.
void probe_negative_near_positive(const Config& cfg, Json& js) {
    if (!selected(cfg, "A7_negative_near_positive")) return;
    const float seps[] = {0.05f, 0.15f, 0.40f};
    for (float sep : seps) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "scattered", 8u, rig.rng);
        std::vector<float> pos_xs = teach(rig, ds);
        rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
        rig.fb.set_avoid_style(AvoidStyle::Geometric);

        // The protected positive is example 0. Press `sep` away from it.
        std::vector<float> press(cfg.n_in);
        for (std::size_t j = 0; j < cfg.n_in; ++j) press[j] = ds.xs[j];
        press[0] += sep;

        std::vector<float> before, after, heard, at_pos_before, at_pos_after;
        rig.field(before);
        rig.at(std::span<const float>(&ds.xs[0], cfg.n_in), at_pos_before);

        rig.at(press, heard);
        for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, press[j]);
        rig.mlp.process();
        rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});

        rig.field(after);
        rig.at(std::span<const float>(&ds.xs[0], cfg.n_in), at_pos_after);

        Displacement d = measure_displacement(rig, before, after, press, pos_xs);

        char id[64];
        snprintf(id, sizeof id, "A7_negative_near_positive_%03d", static_cast<int>(sep * 100.f));
        js.begin_scenario(id, "dislike near a protected positive example");
        js.kv("separation", sep);
        js.disp("", d);
        // The headline number: how far the protected positive moved.
        js.kv("protected_drift", l2(at_pos_before, at_pos_after));
        // ...relative to what the dislike achieved where it was pressed.
        js.kv("damage_ratio",
              (d.at_point > 1e-9f) ? l2(at_pos_before, at_pos_after) / d.at_point : 0.f);
        js.end_scenario();
    }
}

// A8 — randomise_and_place: the operator's named journey. RandomiseOutputs
// rolls a whole patch WITHOUT touching weights, the user auditions it, then
// places it as a positive example at the current input position; the net then
// retrains with that example. Distinct from RandomiseMlp, which scrambles
// weights. Measures whether the placed patch takes, and what it costs.
void probe_randomise_and_place(const Config& cfg, Json& js) {
    if (!selected(cfg, "A8_randomise_and_place")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 8u, rig.rng);
    std::vector<float> pos_xs = teach(rig, ds);

    std::vector<float> before;
    rig.field(before);

    // Stand somewhere untaught.
    std::vector<float> where(cfg.n_in);
    Kronecker k(cfg.n_in);
    k.point(999u, where);

    std::vector<float> heard;
    rig.at(where, heard);

    rig.fb.set_mode(FeedbackMode::RandomiseOutputs, rig.mlp);
    for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, where[j]);
    rig.mlp.process();

    // Down = enter randomise; down again = re-roll. Audition three patches.
    rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});
    std::size_t rerolls = 0u;
    for (int i = 0; i < 2; ++i) { rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {}); ++rerolls; }

    // Take the held static vector and place it as a positive example.
    std::vector<float> patch(cfg.n_out, 0.f);
    const bool have_static = rig.fb.static_output(patch);
    place_positive(rig, where, patch);
    rig.mlp.train();

    std::vector<float> after, got;
    rig.field(after);
    rig.at(where, got);

    Displacement d = measure_displacement(rig, before, after, where, pos_xs);

    js.begin_scenario("A8_randomise_and_place", "roll a patch (outputs only), place it as a positive");
    js.kv("rerolls", rerolls);
    js.kv("have_static", static_cast<std::size_t>(have_static ? 1u : 0u));
    js.kv("placement_err", l2(got, patch));      // did the placed patch take?
    js.disp("", d);                              // what did placing it cost elsewhere?
    js.kv("examples", ds.n + 1u);
    js.end_scenario();
}

// =========================================================================
// JOURNEYS — composite, multi-gesture sessions. These are the "interaction
// tests". Each reports a trajectory, not a single number.
// =========================================================================

// J1 — positive_only: N likes at scattered positions, retraining after each.
// Reports the RETENTION CURVE: after example k, how far have examples 1..k-1
// drifted from what was taught? This is catastrophic forgetting, measured.
void journey_positive_only(const Config& cfg, Json& js) {
    if (!selected(cfg, "J1_positive_only")) return;
    Rig rig(cfg);
    const std::size_t N = cfg.smoke ? 6u : 20u;
    Dataset ds = make_dataset(cfg, "scattered", N, rig.rng);

    js.begin_scenario("J1_positive_only", "N likes, retention of every earlier like");
    std::vector<float> got;
    for (std::size_t k = 0; k < N; ++k) {
        place_positive(rig, std::span<const float>(&ds.xs[k * cfg.n_in], cfg.n_in),
                            std::span<const float>(&ds.ys[k * cfg.n_out], cfg.n_out));
        rig.mlp.train();
        float acc = 0.f;
        for (std::size_t i = 0; i <= k; ++i) {
            rig.at(std::span<const float>(&ds.xs[i * cfg.n_in], cfg.n_in), got);
            acc += l2(got, std::span<const float>(&ds.ys[i * cfg.n_out], cfg.n_out));
        }
        char key[32];
        snprintf(key, sizeof key, "retain_%02zu", k + 1u);
        js.kv(key, acc / static_cast<float>(k + 1u));
    }
    FieldMetrics fm = measure_field(rig);
    js.field("field_", fm);
    js.end_scenario();
}

// J2 — randomise_place_only: a whole session made ONLY of "roll a patch,
// place it". No dislikes, no weight randomisation. The operator named this
// as a distinct way of working and it deserves its own row.
void journey_randomise_place_only(const Config& cfg, Json& js) {
    if (!selected(cfg, "J2_randomise_place_only")) return;
    Rig rig(cfg);
    const std::size_t N = cfg.smoke ? 5u : 15u;
    Kronecker k_where(cfg.n_in);

    rig.fb.set_mode(FeedbackMode::RandomiseOutputs, rig.mlp);
    js.begin_scenario("J2_randomise_place_only", "session of roll-a-patch-and-place, no dislikes");

    std::vector<float> where(cfg.n_in), heard, patch(cfg.n_out), got;
    std::vector<float> placed_xs, placed_ys;
    for (std::size_t k = 0; k < N; ++k) {
        k_where.point(k * 13u + 1u, where);
        rig.at(where, heard);
        for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, where[j]);
        rig.mlp.process();
        rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});   // enter/roll
        rig.fb.static_output(patch);
        place_positive(rig, where, patch);
        rig.mlp.train();
        placed_xs.insert(placed_xs.end(), where.begin(), where.end());
        placed_ys.insert(placed_ys.end(), patch.begin(), patch.end());
    }
    // Retention across everything placed.
    const std::size_t placed_n = placed_xs.size() / cfg.n_in;
    float acc = 0.f, mx = 0.f;
    for (std::size_t i = 0; i < placed_n; ++i) {
        rig.at(std::span<const float>(&placed_xs[i * cfg.n_in], cfg.n_in), got);
        const float e = l2(got, std::span<const float>(&placed_ys[i * cfg.n_out], cfg.n_out));
        acc += e;
        if (e > mx) mx = e;
    }
    js.kv("placed", placed_n);
    js.kv("retain_mean", placed_n ? acc / static_cast<float>(placed_n) : -1.f);
    js.kv("retain_max", placed_n ? mx : -1.f);
    FieldMetrics fm = measure_field(rig);
    js.field("field_", fm);
    js.end_scenario();
}

// J3 — mixed_session: likes and dislikes interleaved, the realistic case.
// Reports the field metrics at checkpoints so drift over a session is visible.
void journey_mixed(const Config& cfg, Json& js) {
    if (!selected(cfg, "J3_mixed_session")) return;
    Rig rig(cfg);
    const std::size_t N = cfg.smoke ? 8u : 24u;
    Dataset ds = make_dataset(cfg, "scattered", N, rig.rng);
    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);

    js.begin_scenario("J3_mixed_session", "likes and dislikes interleaved");
    std::vector<float> heard, got;
    Kronecker k_dis(cfg.n_in);
    std::vector<float> dis(cfg.n_in);

    for (std::size_t k = 0; k < N; ++k) {
        place_positive(rig, std::span<const float>(&ds.xs[k * cfg.n_in], cfg.n_in),
                            std::span<const float>(&ds.ys[k * cfg.n_out], cfg.n_out));
        rig.mlp.train();
        if (k % 3u == 2u) {   // every third gesture is a dislike somewhere else
            k_dis.point(k * 17u + 7u, dis);
            rig.at(dis, heard);
            for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, dis[j]);
            rig.mlp.process();
            rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});
        }
        if ((k + 1u) % 8u == 0u) {
            FieldMetrics fm = measure_field(rig);
            char pre[32];
            snprintf(pre, sizeof pre, "ck%02zu_", k + 1u);
            js.field(pre, fm);
        }
    }
    // Retention of every like after the whole session.
    float acc = 0.f;
    for (std::size_t i = 0; i < N; ++i) {
        rig.at(std::span<const float>(&ds.xs[i * cfg.n_in], cfg.n_in), got);
        acc += l2(got, std::span<const float>(&ds.ys[i * cfg.n_out], cfg.n_out));
    }
    js.kv("retain_mean", acc / static_cast<float>(N));
    js.kv("positives", rig.fb.positive_count());
    js.kv("negatives", rig.fb.negative_count());
    js.end_scenario();
}

// J4 — branch: one shared prefix, three different continuations, compared
// against each other. Branching is implemented by replaying the prefix from
// scratch per branch, which is exact under the deterministic RNG.
//
// The question this answers: standing in the same place with the same history,
// how differently do "dislike", "roll-and-place" and "do nothing" leave the
// instrument? That comparison is what "which UX journey shapes the space how"
// actually means.
void journey_branch(const Config& cfg, Json& js) {
    if (!selected(cfg, "J4_branch")) return;

    const std::size_t PREFIX = cfg.smoke ? 5u : 10u;

    auto build_prefix = [&](Rig& rig, Dataset& ds, std::vector<float>& pos_xs) {
        ds = make_dataset(cfg, "scattered", PREFIX, rig.rng);
        pos_xs = teach(rig, ds);
    };

    // Common branch point: a spot between examples 0 and 1.
    auto branch_point = [&](const Dataset& ds, std::vector<float>& p) {
        p.resize(cfg.n_in);
        for (std::size_t j = 0; j < cfg.n_in; ++j)
            p[j] = 0.5f * (ds.xs[j] + ds.xs[cfg.n_in + j]);
    };

    struct Branch { const char* id; int kind; };  // 0=nothing 1=dislike 2=roll+place
    const Branch branches[] = {
        {"J4_branch_control",       0},
        {"J4_branch_dislike",       1},
        {"J4_branch_roll_place",    2},
    };

    // Reference field from the control branch, so the other two can be
    // reported as displacement FROM the untouched instrument.
    std::vector<float> control_field;

    for (const Branch& b : branches) {
        Rig rig(cfg);
        Dataset ds;
        std::vector<float> pos_xs;
        build_prefix(rig, ds, pos_xs);

        std::vector<float> before;
        rig.field(before);
        if (b.kind == 0) control_field = before;

        std::vector<float> p, heard, patch(cfg.n_out);
        branch_point(ds, p);
        rig.at(p, heard);
        for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, p[j]);
        rig.mlp.process();

        if (b.kind == 1) {
            rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
            rig.fb.set_avoid_style(AvoidStyle::Geometric);
            rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});
        } else if (b.kind == 2) {
            rig.fb.set_mode(FeedbackMode::RandomiseOutputs, rig.mlp);
            rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});
            rig.fb.static_output(patch);
            place_positive(rig, p, patch);
            rig.mlp.train();
        }

        std::vector<float> after;
        rig.field(after);
        Displacement d = measure_displacement(rig, before, after, p, pos_xs);

        js.begin_scenario(b.id, "shared prefix, one divergent gesture");
        js.kv("prefix_examples", PREFIX);
        js.disp("", d);
        FieldMetrics fm = measure_field(rig);
        js.field("field_", fm);
        js.end_scenario();
    }
}

// =========================================================================
// EDGE CASES — the degenerate corners. These REPORT; the ones that are true
// invariants are asserted in tests/cpp/test_ml_behaviour.cpp.
// =========================================================================
void edge_cases(const Config& cfg, Json& js) {
    // E1 — cold start: dislike with NO examples at all. feedback.hpp takes a
    // documented degenerate branch here (ALIGNMENT.md:91) with its own RNG
    // draw. Worth a row precisely because it is the first thing a new user does.
    if (selected(cfg, "E1_cold_start_dislike")) {
        Rig rig(cfg);
        std::vector<float> before, after, heard, p(cfg.n_in, 0.f);
        rig.field(before);
        rig.at(p, heard);
        rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
        rig.fb.set_avoid_style(AvoidStyle::Geometric);
        rig.mlp.process();
        rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});
        rig.field(after);
        Displacement d = measure_displacement(rig, before, after, p, {});
        js.begin_scenario("E1_cold_start_dislike", "dislike with zero examples stored");
        js.disp("", d);
        js.kv("negatives", rig.fb.negative_count());
        js.end_scenario();
    }

    // E2 — single example: the whole instrument taught by one point.
    if (selected(cfg, "E2_single_example")) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "scattered", 1u, rig.rng);
        teach(rig, ds);
        std::vector<float> got;
        rig.at(std::span<const float>(&ds.xs[0], cfg.n_in), got);
        js.begin_scenario("E2_single_example", "one example is the entire dataset");
        js.kv("placement_err", l2(got, std::span<const float>(&ds.ys[0], cfg.n_out)));
        FieldMetrics fm = measure_field(rig);
        js.field("field_", fm);
        js.end_scenario();
    }

    // E3 — contradictory examples: same input position, different targets.
    // The net cannot satisfy both; what it does instead is a design fact.
    if (selected(cfg, "E3_contradictory")) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "coincident", 6u, rig.rng);
        teach(rig, ds);
        std::vector<float> got;
        rig.at(std::span<const float>(&ds.xs[0], cfg.n_in), got);
        float spread_of_targets = 0.f;
        for (std::size_t i = 0; i < ds.n; ++i) {
            spread_of_targets += l2(got, std::span<const float>(&ds.ys[i * cfg.n_out], cfg.n_out));
        }
        js.begin_scenario("E3_contradictory", "N examples at ONE position with different targets");
        js.kv("n_examples", ds.n);
        js.kv("mean_err_to_all", spread_of_targets / static_cast<float>(ds.n));
        js.kv("final_loss", rig.mlp.eval_loss());
        js.end_scenario();
    }

    // E4 — collinear examples: every example on one line. Degenerate geometry
    // that a k-NN centroid handles differently from a scattered cloud.
    if (selected(cfg, "E4_collinear")) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "collinear", 8u, rig.rng);
        teach(rig, ds);
        js.begin_scenario("E4_collinear", "all examples on one line through the space");
        FieldMetrics fm = measure_field(rig);
        js.field("field_", fm);
        js.kv("final_loss", rig.mlp.eval_loss());
        js.end_scenario();
    }

    // E5 — corners: examples pinned at the domain bounds, where the input
    // pipeline's circular clamp and the sigmoid rails both bite.
    if (selected(cfg, "E5_corners")) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "corners", 8u, rig.rng);
        teach(rig, ds);
        js.begin_scenario("E5_corners", "examples pinned at the domain corners");
        FieldMetrics fm = measure_field(rig);
        js.field("field_", fm);
        js.end_scenario();
    }

    // E6 — capacity overflow: push past max_examples and see what the FIFO
    // silently dropped. The oldest liked sounds go first and nothing tells
    // the user (mlp.hpp add_example, ring eviction).
    if (selected(cfg, "E6_capacity_overflow")) {
        Config c2 = cfg;
        c2.max_examples = cfg.smoke ? 8u : 16u;   // small cap so the run is quick
        Rig rig(c2);
        const std::size_t N = c2.max_examples * 2u;
        Dataset ds = make_dataset(c2, "scattered", N, rig.rng);
        // Deliberately raw add_example: this probe is about the MLP dataset
        // ring, not the replay buffer, and mixing the two would confuse which
        // capacity is being overflowed.
        for (std::size_t i = 0; i < N; ++i) {
            rig.mlp.add_example(std::span<const float>(&ds.xs[i * c2.n_in], c2.n_in),
                                std::span<const float>(&ds.ys[i * c2.n_out], c2.n_out));
        }
        rig.mlp.train();
        std::vector<float> got;
        float early = 0.f, late = 0.f;
        for (std::size_t i = 0; i < c2.max_examples; ++i) {
            rig.at(std::span<const float>(&ds.xs[i * c2.n_in], c2.n_in), got);
            early += l2(got, std::span<const float>(&ds.ys[i * c2.n_out], c2.n_out));
        }
        for (std::size_t i = c2.max_examples; i < N; ++i) {
            rig.at(std::span<const float>(&ds.xs[i * c2.n_in], c2.n_in), got);
            late += l2(got, std::span<const float>(&ds.ys[i * c2.n_out], c2.n_out));
        }
        js.begin_scenario("E6_capacity_overflow", "twice the cap in examples; what survived");
        js.kv("cap", c2.max_examples);
        js.kv("submitted", N);
        js.kv("err_first_half", early / static_cast<float>(c2.max_examples));
        js.kv("err_second_half", late / static_cast<float>(N - c2.max_examples));
        js.end_scenario();
    }

    // E7 — undo depth exhaustion: more scratchpad ops than the undo ring
    // holds (kUndoDepth). Reports how far back the user can actually get.
    if (selected(cfg, "E7_undo_exhaustion")) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "scattered", 6u, rig.rng);
        teach(rig, ds);
        rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);

        std::vector<float> origin;
        rig.field(origin);
        rig.fb.enter_explore(rig.mlp, rig.spread());
        for (std::size_t i = 0; i < kUndoDepth + 3u; ++i) rig.fb.reroll(rig.mlp, rig.spread());
        const std::size_t depth_before = rig.fb.undo_depth();
        for (std::size_t i = 0; i < kUndoDepth + 3u; ++i) rig.fb.undo(rig.mlp);
        rig.fb.exit_explore(rig.mlp);

        std::vector<float> restored;
        rig.field(restored);
        js.begin_scenario("E7_undo_exhaustion", "more rerolls than the undo ring holds");
        js.kv("undo_cap", kUndoDepth);
        js.kv("ops", kUndoDepth + 3u);
        js.kv("depth_before_undo", depth_before);
        js.kv("residual", l2(origin, restored));   // 0 = fully recovered
        js.end_scenario();
    }

    // E8 — one output / one input: the narrowest legal shape.
    if (selected(cfg, "E8_minimal_shape")) {
        Config c2 = cfg;
        c2.n_in = 1u; c2.n_out = 1u;
        c2.hidden[0] = c2.hidden[1] = c2.hidden[2] = 4u;
        Rig rig(c2);
        Dataset ds = make_dataset(c2, "scattered", 6u, rig.rng);
        teach(rig, ds);
        js.begin_scenario("E8_minimal_shape", "1 input, 1 output, tiny hidden layers");
        FieldMetrics fm = measure_field(rig);
        js.field("field_", fm);
        js.kv("final_loss", rig.mlp.eval_loss());
        js.end_scenario();
    }
}


// =========================================================================
// DIAGNOSTIC — why does the geometric dislike do nothing?
//
// The machinery is not broken; the DOSE is. Per press, dislike_geometric:
//   1. computes push_step = clamp(|avg_neg_reward|, 0.25, 1) * 0.5   (=0.5 fresh)
//   2. builds a target displaced from the heard action by
//      push_step / (1 + ||heard - centroid||)                        (~0.2-0.5)
//   3. takes ONE gradient step toward it at geo_lr * geo_neg_lr_ratio
//      (= 0.001 * ~0.47 = ~4.7e-4)                                   (mlp.hpp
//      train_targets: one forward, one backprop, one apply_grad per layer)
//
// So it aims at a target ~0.3 away and then moves ~5e-5. Upstream InterfaceRL
// applied the same LR inside a multi-pass shuffled optimise() over the WHOLE
// replay buffer; P3 collapsed that to a single step on a single item and kept
// the LR (ALIGNMENT.md:91). The loop was dropped, the dose was not re-scaled.
//
// This row reports the arithmetic next to the measured displacement, and the
// presses/LR needed to actually reach the target. --geo-lr and --geo-iters
// let the fix be measured before it is committed to.
// =========================================================================
void diag_geo_anatomy(const Config& cfg, Json& js) {
    if (!selected(cfg, "D1_geo_anatomy")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 12u, rig.rng);
    std::vector<float> pos_xs = teach(rig, ds);
    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);

    std::vector<float> press(cfg.n_in);
    for (std::size_t j = 0; j < cfg.n_in; ++j)
        press[j] = 0.5f * (ds.xs[j] + ds.xs[cfg.n_in + j]);

    std::vector<float> heard0, got, before;
    rig.at(press, heard0);
    rig.field(before);

    // The analytic dose, from the same free functions feedback.hpp calls.
    const float push_step = nisps::ml::geo_push_step(-1.f);   // one fresh negative
    const float ratio     = nisps::ml::geo_neg_lr_ratio(1u, rig.fb.positive_count());
    const float eff_lr    = cfg.geo_lr * ratio;

    auto press_once = [&]() {
        std::vector<float> h;
        rig.at(press, h);
        for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, press[j]);
        rig.mlp.process();
        rig.fb.on_down(rig.mlp, h, kMoveSpeed, rig.spread(), {});
    };

    press_once();
    rig.at(press, got);
    const float after_1 = l2(got, heard0);

    for (int i = 1; i < 10; ++i) press_once();
    rig.at(press, got);
    const float after_10 = l2(got, heard0);

    for (int i = 10; i < 100; ++i) press_once();
    rig.at(press, got);
    const float after_100 = l2(got, heard0);

    for (int i = 100; i < 1000; ++i) press_once();
    rig.at(press, got);
    const float after_1000 = l2(got, heard0);

    std::vector<float> after;
    rig.field(after);
    Displacement d = measure_displacement(rig, before, after, press, pos_xs);

    js.begin_scenario("D1_geo_anatomy", "the geometric dislike dose, decomposed");
    js.kv("push_step", push_step);              // ~0.5 — the intended push
    js.kv("neg_lr_ratio", ratio);               // ~0.47
    js.kv("effective_lr", eff_lr);              // ~4.7e-4 — ONE step at this
    js.kv("train_lr_for_comparison", 1.0f);     // what a LIKE trains at
    js.kv("train_iters_for_comparison", std::size_t{1000});
    js.kv("moved_after_1", after_1);
    js.kv("moved_after_10", after_10);
    js.kv("moved_after_100", after_100);
    js.kv("moved_after_1000", after_1000);
    js.disp("cumulative_", d);
    js.kv("positives", rig.fb.positive_count());
    js.kv("negatives", rig.fb.negative_count());
    js.end_scenario();
}

// =========================================================================
// EXPLORE-AND-PLACE — the DEFAULT product mode. Everything above tested the
// Avoid path; this is the lifecycle a musician actually drives.
// =========================================================================

// A9 — the full lifecycle: enter explore, audition, place, commit. The
// controller owns the weight snapshot; the CALLER owns add_example + train
// (feedback.hpp:475 contract). Getting that split wrong is the classic bug:
// commit without add_example silently discards the placement.
void probe_explore_place(const Config& cfg, Json& js) {
    if (!selected(cfg, "A9_explore_and_place")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 8u, rig.rng);
    std::vector<float> pos_xs = teach(rig, ds);
    rig.mlp.train();

    std::vector<float> before;
    rig.field(before);

    std::vector<float> where(cfg.n_in);
    Kronecker k(cfg.n_in);
    k.point(555u, where);
    for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, where[j]);
    rig.mlp.process();

    rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);
    rig.fb.enter_explore(rig.mlp, rig.spread());
    for (int i = 0; i < 3; ++i) rig.fb.reroll(rig.mlp, rig.spread());
    rig.fb.nudge(rig.mlp, 0.2f);

    // Audition: what the scratchpad net says here is what gets placed.
    rig.mlp.process();
    std::vector<float> auditioned(cfg.n_out);
    { auto o = rig.mlp.outputs();
      for (std::size_t j = 0; j < cfg.n_out; ++j) auditioned[j] = o[j]; }

    rig.fb.begin_place(rig.mlp, auditioned);
    rig.fb.commit_place(rig.mlp);          // restores the REAL net
    std::vector<float> placed_v;
    const bool committed = take_committed(rig, placed_v);
    if (committed) {
        place_positive(rig, where, placed_v);  // the caller's half of the contract
        rig.mlp.train();
    }

    std::vector<float> after, got;
    rig.field(after);
    rig.at(where, got);
    Displacement d = measure_displacement(rig, before, after, where, pos_xs);

    js.begin_scenario("A9_explore_and_place", "default mode: explore, audition, place, commit");
    js.kv("committed", static_cast<std::size_t>(committed ? 1u : 0u));
    js.kv("placement_err", committed ? l2(got, placed_v) : -1.f);
    js.kv("audition_vs_placed", committed ? l2(auditioned, placed_v) : -1.f);  // must be ~0
    js.disp("", d);
    js.kv("examples", ds.n + 1u);
    js.end_scenario();
}

// A10 — explore then CANCEL. Auditioning must be free: the net must come back
// exactly, and the field must be untouched.
void probe_explore_cancel(const Config& cfg, Json& js) {
    if (!selected(cfg, "A10_explore_cancel")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 8u, rig.rng);
    teach(rig, ds);
    rig.mlp.train();

    std::vector<float> before, after;
    rig.field(before);

    rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);
    rig.fb.enter_explore(rig.mlp, rig.spread());
    for (int i = 0; i < 5; ++i) rig.fb.reroll(rig.mlp, rig.spread());
    rig.fb.cancel_place();
    rig.fb.exit_explore(rig.mlp);

    rig.field(after);
    js.begin_scenario("A10_explore_cancel", "audition then cancel — must cost nothing");
    js.kv("residual", l2(before, after));   // 0 = auditioning was free
    js.end_scenario();
}

// A11 — reposition: grab an existing example's outputs and re-place them at a
// NEW input position. The musician moving a sound they like to a comfier spot.
void probe_reposition(const Config& cfg, Json& js) {
    if (!selected(cfg, "A11_reposition")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 8u, rig.rng);
    std::vector<float> pos_xs = teach(rig, ds);
    rig.mlp.train();

    std::vector<float> before;
    rig.field(before);

    // Reposition is an ExploreAndPlace-mode gesture; begin_reposition is a
    // no-op in any other mode (feedback.hpp:616).
    rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);

    // Stand at example 0, grab it. During the hold, state IS Placing, so
    // placed_output() is the right accessor here.
    std::span<const float> src(&ds.xs[0], cfg.n_in);
    for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, src[j]);
    rig.mlp.process();
    rig.fb.begin_reposition(rig.mlp);
    auto grabbed = rig.fb.placed_output();
    const bool grabbed_ok = grabbed.size() >= cfg.n_out;
    std::vector<float> grabbed_v(grabbed.begin(), grabbed.end());

    // Move somewhere else and drop it.
    std::vector<float> dst(cfg.n_in);
    Kronecker k(cfg.n_in);
    k.point(321u, dst);
    for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, dst[j]);
    rig.mlp.process();
    rig.fb.commit_reposition();
    // After commit the carried vector lives in committed_output().
    std::vector<float> carried;
    const bool carried_ok = take_committed(rig, carried);
    if (carried_ok) {
        place_positive(rig, dst, carried);
        rig.mlp.train();
    }

    std::vector<float> after, at_dst, at_src;
    rig.field(after);
    rig.at(dst, at_dst);
    rig.at(src, at_src);
    Displacement d = measure_displacement(rig, before, after, dst, pos_xs);

    js.begin_scenario("A11_reposition", "grab an example's outputs, drop them elsewhere");
    js.kv("grabbed", static_cast<std::size_t>(grabbed_ok ? 1u : 0u));
    js.kv("carried", static_cast<std::size_t>(carried_ok ? 1u : 0u));
    js.kv("arrived", carried_ok ? l2(at_dst, carried) : -1.f);   // small = it landed
    js.kv("source_still_holds", carried_ok ? l2(at_src, carried) : -1.f);
    js.disp("", d);
    js.end_scenario();
}

// A12 — like then dislike at exactly the same spot. A direct contradiction:
// the user taught something and then rejected it in place. Which wins?
void probe_like_then_dislike(const Config& cfg, Json& js) {
    if (!selected(cfg, "A12_like_then_dislike")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 8u, rig.rng);
    std::vector<float> pos_xs = teach(rig, ds);
    rig.mlp.train();

    std::span<const float> x(&ds.xs[0], cfg.n_in);
    std::span<const float> y(&ds.ys[0], cfg.n_out);

    std::vector<float> before, after, got;
    rig.field(before);
    rig.at(x, got);
    const float held_before = l2(got, y);

    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);
    for (std::size_t i = 0; i < cfg.geo_iters; ++i) {
        std::vector<float> h;
        rig.at(x, h);
        for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, x[j]);
        rig.mlp.process();
        rig.fb.on_down(rig.mlp, h, kMoveSpeed, rig.spread(), {});
    }

    rig.field(after);
    rig.at(x, got);
    const float held_after = l2(got, y);
    Displacement d = measure_displacement(rig, before, after, x, pos_xs);

    js.begin_scenario("A12_like_then_dislike", "dislike exactly where a like was placed");
    js.kv("held_before", held_before);
    js.kv("held_after", held_after);
    js.kv("rejection_moved", held_after - held_before);  // >0 = the dislike won ground
    js.disp("", d);
    js.end_scenario();
}

// A13 — repair journey: dislike somewhere, then explore-and-place a
// replacement AT THE SAME SPOT. This is the operator's stated design intent
// for what a dislike should lead to, executed end to end.
void probe_dislike_then_repair(const Config& cfg, Json& js) {
    if (!selected(cfg, "A13_dislike_then_repair")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 8u, rig.rng);
    std::vector<float> pos_xs = teach(rig, ds);
    rig.mlp.train();

    std::vector<float> before;
    rig.field(before);

    std::vector<float> where(cfg.n_in);
    for (std::size_t j = 0; j < cfg.n_in; ++j)
        where[j] = 0.5f * (ds.xs[j] + ds.xs[cfg.n_in + j]);

    std::vector<float> disliked;
    rig.at(where, disliked);

    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);
    for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, where[j]);
    rig.mlp.process();
    rig.fb.on_down(rig.mlp, disliked, kMoveSpeed, rig.spread(), {});

    // Now repair: explore for something else and place it here.
    rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);
    rig.fb.enter_explore(rig.mlp, rig.spread());
    for (int i = 0; i < 2; ++i) rig.fb.reroll(rig.mlp, rig.spread());
    rig.mlp.process();
    std::vector<float> replacement(cfg.n_out);
    { auto o = rig.mlp.outputs();
      for (std::size_t j = 0; j < cfg.n_out; ++j) replacement[j] = o[j]; }
    rig.fb.begin_place(rig.mlp, replacement);
    rig.fb.commit_place(rig.mlp);
    place_positive(rig, where, replacement);
    rig.mlp.train();

    std::vector<float> after, got;
    rig.field(after);
    rig.at(where, got);
    Displacement d = measure_displacement(rig, before, after, where, pos_xs);

    js.begin_scenario("A13_dislike_then_repair", "dislike, then explore-and-place a replacement here");
    js.kv("repair_took", l2(got, replacement));       // small = the fix landed
    js.kv("moved_off_disliked", l2(got, disliked));   // large = it is genuinely different
    js.disp("", d);
    js.kv("positives", rig.fb.positive_count());
    js.kv("negatives", rig.fb.negative_count());
    js.end_scenario();
}

// A14 — focus/solo mask: dislike with only half the outputs active. The
// masked dims must not move at all; that is what "solo this parameter" means.
void probe_focus_mask(const Config& cfg, Json& js) {
    if (!selected(cfg, "A14_focus_mask")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 8u, rig.rng);
    teach(rig, ds);
    rig.mlp.train();

    std::vector<std::uint8_t> mask(cfg.n_out, 0u);
    for (std::size_t j = 0; j < cfg.n_out; j += 2u) mask[j] = 1u;   // evens active
    rig.fb.set_focus_mask(mask);
    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);

    std::vector<float> where(cfg.n_in);
    for (std::size_t j = 0; j < cfg.n_in; ++j)
        where[j] = 0.5f * (ds.xs[j] + ds.xs[cfg.n_in + j]);

    std::vector<float> b4, aft;
    rig.at(where, b4);
    for (std::size_t i = 0; i < (cfg.geo_iters > 50u ? cfg.geo_iters : 50u); ++i) {
        std::vector<float> h;
        rig.at(where, h);
        for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, where[j]);
        rig.mlp.process();
        rig.fb.on_down(rig.mlp, h, kMoveSpeed, rig.spread(), {});
    }
    rig.at(where, aft);

    float active_moved = 0.f, masked_moved = 0.f;
    for (std::size_t j = 0; j < cfg.n_out; ++j) {
        const float dj = std::fabs(aft[j] - b4[j]);
        if (mask[j]) active_moved += dj; else masked_moved += dj;
    }
    js.begin_scenario("A14_focus_mask", "dislike with half the outputs soloed out");
    js.kv("active_moved", active_moved);
    js.kv("masked_moved", masked_moved);   // should be ~0
    js.kv("leak_ratio", (active_moved > 1e-12f) ? masked_moved / active_moved : 0.f);
    js.end_scenario();
}

// =========================================================================
// MORE JOURNEYS
// =========================================================================

// J5 — a session made ONLY of explore-and-place, the default mode's natural
// way of working. Contrast with J2 (RandomiseOutputs) and J1 (direct likes).
void journey_explore_place_only(const Config& cfg, Json& js) {
    if (!selected(cfg, "J5_explore_place_only")) return;
    Rig rig(cfg);
    const std::size_t N = cfg.smoke ? 5u : 15u;
    Kronecker kw(cfg.n_in);
    rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);

    std::vector<float> where(cfg.n_in), placed_xs, placed_ys, got;
    for (std::size_t k = 0; k < N; ++k) {
        kw.point(k * 19u + 2u, where);
        for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, where[j]);
        rig.mlp.process();
        rig.fb.enter_explore(rig.mlp, rig.spread());
        for (int i = 0; i < 2; ++i) rig.fb.reroll(rig.mlp, rig.spread());
        rig.mlp.process();
        std::vector<float> patch(cfg.n_out);
        { auto o = rig.mlp.outputs();
          for (std::size_t j = 0; j < cfg.n_out; ++j) patch[j] = o[j]; }
        rig.fb.begin_place(rig.mlp, patch);
        rig.fb.commit_place(rig.mlp);
        std::vector<float> pv;
        if (!take_committed(rig, pv)) continue;   // nothing committed: skip, do not fake
        place_positive(rig, where, pv);
        rig.mlp.train();
        placed_xs.insert(placed_xs.end(), where.begin(), where.end());
        placed_ys.insert(placed_ys.end(), pv.begin(), pv.end());
    }
    // Iterate over what was ACTUALLY placed, never over the requested count.
    const std::size_t placed_n = placed_xs.size() / cfg.n_in;
    float acc = 0.f, mx = 0.f;
    for (std::size_t i = 0; i < placed_n; ++i) {
        rig.at(std::span<const float>(&placed_xs[i * cfg.n_in], cfg.n_in), got);
        const float e = l2(got, std::span<const float>(&placed_ys[i * cfg.n_out], cfg.n_out));
        acc += e; if (e > mx) mx = e;
    }
    js.begin_scenario("J5_explore_place_only", "session of explore-audition-place, no dislikes");
    js.kv("attempted", N);
    js.kv("placed", placed_n);
    js.kv("retain_mean", placed_n ? acc / static_cast<float>(placed_n) : -1.f);
    js.kv("retain_max", placed_n ? mx : -1.f);
    FieldMetrics fm = measure_field(rig);
    js.field("field_", fm);
    js.end_scenario();
}

// J6 — long session with drift checkpoints. Some failure modes (going numb,
// weight-norm growth, buffer exhaustion) only appear after tens of gestures.
void journey_long_session(const Config& cfg, Json& js) {
    if (!selected(cfg, "J6_long_session")) return;
    Rig rig(cfg);
    const std::size_t N = cfg.smoke ? 20u : 120u;
    Dataset ds = make_dataset(cfg, "scattered", N, rig.rng);
    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);
    Kronecker kd(cfg.n_in);
    std::vector<float> dis(cfg.n_in), heard;

    js.begin_scenario("J6_long_session", "120 gestures with periodic drift checkpoints");
    for (std::size_t k = 0; k < N; ++k) {
        place_positive(rig, std::span<const float>(&ds.xs[k * cfg.n_in], cfg.n_in),
                            std::span<const float>(&ds.ys[k * cfg.n_out], cfg.n_out));
        rig.mlp.train();
        if (k % 4u == 3u) {
            kd.point(k * 23u + 11u, dis);
            rig.at(dis, heard);
            for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, dis[j]);
            rig.mlp.process();
            rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});
        }
        const std::size_t every = cfg.smoke ? 10u : 40u;
        if ((k + 1u) % every == 0u) {
            FieldMetrics fm = measure_field(rig);
            char pre[32];
            snprintf(pre, sizeof pre, "ck%03zu_", k + 1u);
            js.field(pre, fm);
            // Weight-norm growth: unbounded growth ends in sigmoid saturation.
            auto w = rig.mlp.get_weights();
            float wn = 0.f;
            for (float v : w) wn += v * v;
            char key[32];
            snprintf(key, sizeof key, "ck%03zu_wnorm", k + 1u);
            js.kv(key, std::sqrt(wn));
        }
    }
    js.kv("positives", rig.fb.positive_count());
    js.kv("negatives", rig.fb.negative_count());
    js.kv("replay_size", rig.fb.replay_size());
    js.end_scenario();
}

// J7 — dislike storm: the "I hate this whole area" gesture. Many dislikes
// clustered in one region. Does the region become usable, or does the whole
// instrument degrade?
void journey_dislike_storm(const Config& cfg, Json& js) {
    if (!selected(cfg, "J7_dislike_storm")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 10u, rig.rng);
    std::vector<float> pos_xs = teach(rig, ds);
    rig.mlp.train();
    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);

    std::vector<float> before;
    rig.field(before);
    FieldMetrics fm_before = measure_field(rig);

    // 40 dislikes scattered inside a small ball.
    Kronecker kb(cfg.n_in);
    std::vector<float> p(cfg.n_in), heard;
    const std::size_t M = cfg.smoke ? 10u : 40u;
    for (std::size_t i = 0; i < M; ++i) {
        kb.point(i * 5u + 1u, p);
        for (std::size_t j = 0; j < cfg.n_in; ++j) p[j] = -0.4f + 0.2f * p[j];
        rig.at(p, heard);
        for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, p[j]);
        rig.mlp.process();
        rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});
    }

    std::vector<float> after;
    rig.field(after);
    FieldMetrics fm_after = measure_field(rig);
    std::vector<float> centre(cfg.n_in, -0.4f);
    Displacement d = measure_displacement(rig, before, after, centre, pos_xs);

    js.begin_scenario("J7_dislike_storm", "40 dislikes clustered in one region");
    js.kv("dislikes", M);
    js.disp("", d);
    js.kv("gain_p50_before", fm_before.gain_p50);
    js.kv("gain_p50_after", fm_after.gain_p50);
    js.kv("cliff_before", fm_before.cliff_index);
    js.kv("cliff_after", fm_after.cliff_index);
    js.kv("negatives", rig.fb.negative_count());
    js.end_scenario();
}

// J8 — revisit: teach a spot, wander far away and keep working, then come
// BACK and check it held. The operator asked this directly.
void journey_revisit(const Config& cfg, Json& js) {
    if (!selected(cfg, "J8_revisit")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", cfg.smoke ? 8u : 20u, rig.rng);

    // Teach the anchor FIRST, remember what it should be.
    std::span<const float> anchor_x(&ds.xs[0], cfg.n_in);
    std::span<const float> anchor_y(&ds.ys[0], cfg.n_out);
    place_positive(rig, anchor_x, anchor_y);
    rig.mlp.train();

    std::vector<float> got;
    rig.at(anchor_x, got);
    const float held_immediately = l2(got, anchor_y);

    js.begin_scenario("J8_revisit", "teach a spot, work elsewhere, come back to it");
    js.kv("held_immediately", held_immediately);

    // Now work everywhere else, checking the anchor periodically.
    for (std::size_t k = 1u; k < ds.n; ++k) {
        place_positive(rig, std::span<const float>(&ds.xs[k * cfg.n_in], cfg.n_in),
                            std::span<const float>(&ds.ys[k * cfg.n_out], cfg.n_out));
        rig.mlp.train();
        if (k % 4u == 0u) {
            rig.at(anchor_x, got);
            char key[32];
            snprintf(key, sizeof key, "held_after_%02zu", k);
            js.kv(key, l2(got, anchor_y));
        }
    }
    rig.at(anchor_x, got);
    js.kv("held_at_end", l2(got, anchor_y));
    js.end_scenario();
}

// J9 — two-region interference: likes in one half of the space, dislikes in
// the other. How much does work in region B damage region A? This is the
// cleanest test of "does my editing stay local".
void journey_two_region(const Config& cfg, Json& js) {
    if (!selected(cfg, "J9_two_region")) return;
    Rig rig(cfg);
    const std::size_t N = cfg.smoke ? 6u : 12u;
    Kronecker k(cfg.n_in), ko(cfg.n_out);

    std::vector<float> xa(cfg.n_in), ya(cfg.n_out), got;
    std::vector<float> region_a_xs, region_a_ys;
    for (std::size_t i = 0; i < N; ++i) {
        k.point(i * 7u + 1u, xa);
        for (std::size_t j = 0; j < cfg.n_in; ++j) xa[j] = 0.5f + 0.4f * xa[j];  // region A
        ko.point(i * 11u + 3u, ya);
        for (std::size_t j = 0; j < cfg.n_out; ++j) ya[j] = 0.5f + 0.4f * ya[j];
        place_positive(rig, xa, ya);
        region_a_xs.insert(region_a_xs.end(), xa.begin(), xa.end());
        region_a_ys.insert(region_a_ys.end(), ya.begin(), ya.end());
    }
    rig.mlp.train();

    float held_before = 0.f;
    for (std::size_t i = 0; i < N; ++i) {
        rig.at(std::span<const float>(&region_a_xs[i * cfg.n_in], cfg.n_in), got);
        held_before += l2(got, std::span<const float>(&region_a_ys[i * cfg.n_out], cfg.n_out));
    }
    held_before /= static_cast<float>(N);

    // Now hammer region B with dislikes.
    rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
    rig.fb.set_avoid_style(AvoidStyle::Geometric);
    std::vector<float> xb(cfg.n_in), heard;
    const std::size_t M = cfg.smoke ? 10u : 30u;
    for (std::size_t i = 0; i < M; ++i) {
        k.point(i * 13u + 5u, xb);
        for (std::size_t j = 0; j < cfg.n_in; ++j) xb[j] = -0.5f + 0.4f * xb[j];  // region B
        rig.at(xb, heard);
        for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, xb[j]);
        rig.mlp.process();
        rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});
    }

    float held_after = 0.f;
    for (std::size_t i = 0; i < N; ++i) {
        rig.at(std::span<const float>(&region_a_xs[i * cfg.n_in], cfg.n_in), got);
        held_after += l2(got, std::span<const float>(&region_a_ys[i * cfg.n_out], cfg.n_out));
    }
    held_after /= static_cast<float>(N);

    js.begin_scenario("J9_two_region", "likes in region A, dislikes in region B");
    js.kv("a_held_before", held_before);
    js.kv("a_held_after", held_after);
    js.kv("interference", held_after - held_before);  // >0 = B damaged A
    js.end_scenario();
}

// J10 — sweep-and-teach: move CONTINUOUSLY along a path, placing likes as you
// go. This is what performing actually looks like — not isolated pokes at
// scattered coordinates — and consecutive examples are highly correlated,
// which is a different regime for the optimiser.
void journey_sweep_teach(const Config& cfg, Json& js) {
    if (!selected(cfg, "J10_sweep_teach")) return;
    Rig rig(cfg);
    const std::size_t N = cfg.smoke ? 8u : 24u;
    Kronecker ko(cfg.n_out);
    std::vector<float> x(cfg.n_in), y(cfg.n_out), got;
    std::vector<float> xs, ys;

    for (std::size_t i = 0; i < N; ++i) {
        const float t = static_cast<float>(i) / static_cast<float>(N - 1u);
        // A smooth path through the space, not a scatter.
        for (std::size_t j = 0; j < cfg.n_in; ++j) {
            x[j] = std::sin(6.2831853f * t * (1.f + static_cast<float>(j)) * 0.5f) * 0.8f;
        }
        ko.point(i * 3u + 1u, y);
        for (std::size_t j = 0; j < cfg.n_out; ++j) y[j] = 0.5f + 0.4f * y[j];
        place_positive(rig, x, y);
        rig.mlp.train();
        xs.insert(xs.end(), x.begin(), x.end());
        ys.insert(ys.end(), y.begin(), y.end());
    }
    float acc = 0.f, mx = 0.f;
    for (std::size_t i = 0; i < N; ++i) {
        rig.at(std::span<const float>(&xs[i * cfg.n_in], cfg.n_in), got);
        const float e = l2(got, std::span<const float>(&ys[i * cfg.n_out], cfg.n_out));
        acc += e; if (e > mx) mx = e;
    }
    js.begin_scenario("J10_sweep_teach", "likes placed along a continuous path, not a scatter");
    js.kv("placed", N);
    js.kv("retain_mean", acc / static_cast<float>(N));
    js.kv("retain_max", mx);
    FieldMetrics fm = measure_field(rig);
    js.field("field_", fm);
    js.end_scenario();
}

// J11 — undo-heavy: dislike/undo alternation. The indecisive musician. Must
// not accumulate drift.
void journey_undo_heavy(const Config& cfg, Json& js) {
    if (!selected(cfg, "J11_undo_heavy")) return;
    Rig rig(cfg);
    Dataset ds = make_dataset(cfg, "scattered", 8u, rig.rng);
    teach(rig, ds);
    rig.mlp.train();

    std::vector<float> before, after;
    rig.field(before);

    rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);
    const std::size_t R = cfg.smoke ? 5u : 20u;
    for (std::size_t i = 0; i < R; ++i) {
        rig.fb.enter_explore(rig.mlp, rig.spread());
        rig.fb.reroll(rig.mlp, rig.spread());
        rig.fb.undo(rig.mlp);
        rig.fb.exit_explore(rig.mlp);
    }
    rig.field(after);

    js.begin_scenario("J11_undo_heavy", "explore/reroll/undo/exit, repeated");
    js.kv("cycles", R);
    js.kv("drift", l2(before, after));   // 0 = perfectly reversible
    js.end_scenario();
}

// =========================================================================
// MORE EDGE CASES
// =========================================================================
void edge_cases_2(const Config& cfg, Json& js) {
    // E9 — every example has the SAME target. The mapping should collapse to
    // a constant; effective dimensionality should approach 1.
    if (selected(cfg, "E9_identical_targets")) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "scattered", 10u, rig.rng);
        for (std::size_t i = 0; i < ds.n; ++i)
            for (std::size_t j = 0; j < cfg.n_out; ++j) ds.ys[i * cfg.n_out + j] = 0.42f;
        teach(rig, ds);
        rig.mlp.train();
        js.begin_scenario("E9_identical_targets", "every example teaches the same output");
        FieldMetrics fm = measure_field(rig);
        js.field("field_", fm);
        js.end_scenario();
    }

    // E10 — targets exactly on the sigmoid rails (0 and 1). Unreachable in
    // finite weights; the optimiser will push weights up forever chasing them.
    if (selected(cfg, "E10_rail_targets")) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "scattered", 8u, rig.rng);
        for (std::size_t i = 0; i < ds.n; ++i)
            for (std::size_t j = 0; j < cfg.n_out; ++j)
                ds.ys[i * cfg.n_out + j] = ((i + j) % 2u) ? 1.f : 0.f;
        teach(rig, ds);
        rig.mlp.train();
        auto w = rig.mlp.get_weights();
        float wn = 0.f, wmax = 0.f;
        for (float v : w) { wn += v * v; const float a = std::fabs(v); if (a > wmax) wmax = a; }
        js.begin_scenario("E10_rail_targets", "targets pinned at 0 and 1 (unreachable)");
        js.kv("weight_norm", std::sqrt(wn));
        js.kv("weight_max", wmax);
        js.kv("final_loss", rig.mlp.eval_loss());
        FieldMetrics fm = measure_field(rig);
        js.field("field_", fm);
        js.end_scenario();
    }

    // E11 — rapid like/dislike alternation at one spot. The user arguing with
    // themselves. Must not diverge.
    if (selected(cfg, "E11_rapid_alternation")) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "scattered", 6u, rig.rng);
        teach(rig, ds);
        rig.mlp.train();
        rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
        rig.fb.set_avoid_style(AvoidStyle::Geometric);

        std::span<const float> x(&ds.xs[0], cfg.n_in);
        std::span<const float> y(&ds.ys[0], cfg.n_out);
        std::vector<float> heard, got;
        const std::size_t R = cfg.smoke ? 5u : 25u;
        for (std::size_t i = 0; i < R; ++i) {
            place_positive(rig, x, y);
            rig.mlp.train();
            rig.at(x, heard);
            for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, x[j]);
            rig.mlp.process();
            rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});
        }
        rig.at(x, got);
        auto w = rig.mlp.get_weights();
        float wn = 0.f;
        for (float v : w) wn += v * v;
        js.begin_scenario("E11_rapid_alternation", "like/dislike alternating at one spot");
        js.kv("cycles", R);
        js.kv("final_err_to_liked", l2(got, y));
        js.kv("weight_norm", std::sqrt(wn));
        js.kv("final_loss", rig.mlp.eval_loss());
        js.end_scenario();
    }

    // E12 — switch feedback mode MID-EXPLORATION. set_mode is documented to
    // tear down cleanly (feedback.hpp:215) so the net is never stranded in a
    // randomised scratchpad state. A stranded net would be catastrophic live.
    if (selected(cfg, "E12_mode_switch_midflight")) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "scattered", 6u, rig.rng);
        teach(rig, ds);
        rig.mlp.train();

        std::vector<float> before, after;
        rig.field(before);

        rig.fb.set_mode(FeedbackMode::ExploreAndPlace, rig.mlp);
        rig.fb.enter_explore(rig.mlp, rig.spread());
        for (int i = 0; i < 3; ++i) rig.fb.reroll(rig.mlp, rig.spread());
        // Yank the mode out from under the exploration.
        rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
        rig.field(after);

        js.begin_scenario("E12_mode_switch_midflight", "change mode while exploring");
        js.kv("stranded_drift", l2(before, after));   // 0 = torn down cleanly
        js.kv("exploring", static_cast<std::size_t>(rig.fb.exploring() ? 1u : 0u));
        js.end_scenario();
    }

    // E13 — dislike with EVERY output masked out. Nothing may move.
    if (selected(cfg, "E13_all_outputs_masked")) {
        Rig rig(cfg);
        Dataset ds = make_dataset(cfg, "scattered", 6u, rig.rng);
        teach(rig, ds);
        rig.mlp.train();
        std::vector<std::uint8_t> mask(cfg.n_out, 0u);   // nothing active
        rig.fb.set_focus_mask(mask);
        rig.fb.set_mode(FeedbackMode::Avoid, rig.mlp);
        rig.fb.set_avoid_style(AvoidStyle::Geometric);

        std::vector<float> before, after, heard, p(cfg.n_in, 0.1f);
        rig.field(before);
        for (int i = 0; i < 20; ++i) {
            rig.at(p, heard);
            for (std::size_t j = 0; j < cfg.n_in; ++j) rig.mlp.set_input(j, p[j]);
            rig.mlp.process();
            rig.fb.on_down(rig.mlp, heard, kMoveSpeed, rig.spread(), {});
        }
        rig.field(after);
        js.begin_scenario("E13_all_outputs_masked", "dislike with every output masked off");
        js.kv("moved", l2(before, after));   // should be ~0
        js.end_scenario();
    }
}


// =========================================================================
// UPSTREAM COMPARISON — how the older memllib `interfaceRL` deals with OUTPUTS,
// measured against what NISPS does today.
//
// Source: `interfaceRL.hpp`, recoverable from this repo's own git history
// (blob 755ff8b). It is a DDPG actor-critic and differs from NISPS structurally:
//
//   * FOUR nets: actor, actorTarget, critic, criticTarget.
//   * The user HEARS actorTarget, not actor (interfaceRL.hpp:188
//     `actorTarget->GetOutput(...)` inside generateAction). actorTarget is
//     soft-updated toward the learner every optimise():
//         actorTarget = (1-alpha)*actorTarget + alpha*actor,  alpha = 0.005
//   * Negative feedback is a scalar reward feeding a critic; the actor is moved
//     by dQ/da (deterministic policy gradient), not by a geometric push.
//   * optimise() runs on a batch of 4 sampled from replay and only every
//     optimiseDivisor = 40 gestures (optimiseSometimes(), :200).
//   * learningRate = 0.005, discountFactor = 0.95.
//
// The critic half cannot be reproduced here: MLPCore exposes train_targets()
// but not the arbitrary per-layer gradient extraction (`CalcGradients` +
// `GetGrads` + `ApplyLoss`) that the policy-gradient step needs. That is a
// genuine port, not a benchmark.
//
// What IS reproducible with today's API — and is the part that shapes how the
// instrument FEELS — is the two output-path ideas:
//
//   U1  SOFT TARGET. Keep a second net; train the first; expose the second,
//       blended toward it by alpha each gesture. alpha = 1 is exactly NISPS
//       today (target == online), so it is a free control in the same sweep.
//       Hypothesis: this trades responsiveness for the mapping not lurching
//       under your hands when a like retrains the whole net.
//
//   U2  AMORTISED LEARNING. Train every Nth gesture instead of every one
//       (upstream's optimiseDivisor). Hypothesis: fewer, larger jumps.
//
// The metric that matters for both is LURCH: how far the mapping the musician
// is playing moves per single gesture, measured over the whole field. Retention
// is reported alongside, because the entire question is what lurch costs you.
// =========================================================================

// A second net of the same shape, used as the soft-updated target.
struct TargetNet {
    Mlp mlp;
    TargetNet(const Config& c)
        : mlp(c.seed, c.n_in, std::span<const std::size_t>(c.hidden, 3u), c.n_out,
              c.max_examples, 4096u) {}
};

// target <- (1-alpha)*target + alpha*online   (interfaceRL SmoothUpdateWeights)
void soft_update(Mlp& target, Mlp& online, float alpha) {
    auto ow = online.get_weights();
    std::vector<float> o(ow.begin(), ow.end());     // copy: shared scratch buffer
    auto tw = target.get_weights();
    std::vector<float> t(tw.begin(), tw.end());
    if (t.size() != o.size()) return;
    for (std::size_t i = 0; i < t.size(); ++i) t[i] = (1.f - alpha) * t[i] + alpha * o[i];
    target.set_weights(t);
}

void upstream_soft_target(const Config& cfg, Json& js) {
    if (!selected(cfg, "U1_soft_target")) return;

    // alpha = 1.0 is NISPS today (no target net at all). 0.005 is upstream.
    const float alphas[] = {1.0f, 0.5f, 0.1f, 0.005f};

    for (float alpha : alphas) {
        Rig rig(cfg);
        TargetNet tgt(cfg);
        // Start the target identical to the online net, or the first
        // measurement would report the gap between two random inits.
        { auto w = rig.mlp.get_weights();
          std::vector<float> v(w.begin(), w.end());
          tgt.mlp.set_weights(v); }

        const std::size_t N = cfg.smoke ? 8u : 20u;
        Dataset ds = make_dataset(cfg, "scattered", N, rig.rng);

        // Field as heard THROUGH the target net.
        auto heard_field = [&](std::vector<float>& dst) {
            dst.resize(rig.n_pts() * cfg.n_out);
            tgt.mlp.infer_batch(rig.probe_pts, dst);
        };

        std::vector<float> prev, cur;
        heard_field(prev);

        std::vector<float> lurches;
        for (std::size_t k = 0; k < N; ++k) {
            place_positive(rig, std::span<const float>(&ds.xs[k * cfg.n_in], cfg.n_in),
                                std::span<const float>(&ds.ys[k * cfg.n_out], cfg.n_out));
            rig.mlp.train();
            soft_update(tgt.mlp, rig.mlp, alpha);
            heard_field(cur);
            // Mean per-point displacement of the HEARD mapping, this gesture.
            float acc = 0.f;
            for (std::size_t i = 0; i < rig.n_pts(); ++i) {
                acc += l2(std::span<const float>(&prev[i * cfg.n_out], cfg.n_out),
                          std::span<const float>(&cur[i * cfg.n_out], cfg.n_out));
            }
            lurches.push_back(acc / static_cast<float>(rig.n_pts()));
            prev = cur;
        }

        // Retention, measured through the target — what the user can actually
        // reach, which is the only retention that counts.
        std::vector<float> got(cfg.n_out);
        float retain = 0.f;
        for (std::size_t i = 0; i < N; ++i) {
            std::span<const float> x(&ds.xs[i * cfg.n_in], cfg.n_in);
            for (std::size_t j = 0; j < cfg.n_in; ++j) tgt.mlp.set_input(j, x[j]);
            tgt.mlp.process();
            auto o = tgt.mlp.outputs();
            for (std::size_t j = 0; j < cfg.n_out; ++j) got[j] = o[j];
            retain += l2(got, std::span<const float>(&ds.ys[i * cfg.n_out], cfg.n_out));
        }

        char id[64];
        snprintf(id, sizeof id, "U1_soft_target_a%04d", static_cast<int>(alpha * 1000.f));
        js.begin_scenario(id, "outputs heard through a soft-updated target net");
        js.kv("alpha", alpha);
        js.kv("is_nisps_today", static_cast<std::size_t>(alpha >= 1.f ? 1u : 0u));
        js.kv("lurch_mean", mean(lurches));
        js.kv("lurch_p95", percentile(lurches, 0.95f));
        js.kv("lurch_max", percentile(lurches, 1.0f));
        js.kv("retain_mean", retain / static_cast<float>(N));
        js.end_scenario();
    }
}

// U2 — amortised learning: train every Nth gesture (upstream optimiseDivisor).
// Examples still accumulate every gesture; only the training is batched.
void upstream_amortised(const Config& cfg, Json& js) {
    if (!selected(cfg, "U2_amortised")) return;

    const std::size_t divisors[] = {1u, 4u, 10u, 40u};   // 1 = NISPS today, 40 = upstream

    for (std::size_t div : divisors) {
        Rig rig(cfg);
        const std::size_t N = cfg.smoke ? 16u : 80u;
        Dataset ds = make_dataset(cfg, "scattered", N, rig.rng);

        std::vector<float> prev, cur;
        rig.field(prev);
        std::vector<float> lurches;

        std::size_t trainings = 0u;
        for (std::size_t k = 0; k < N; ++k) {
            place_positive(rig, std::span<const float>(&ds.xs[k * cfg.n_in], cfg.n_in),
                                std::span<const float>(&ds.ys[k * cfg.n_out], cfg.n_out));
            if ((k + 1u) % div == 0u) { rig.mlp.train(); ++trainings; }
            rig.field(cur);
            float acc = 0.f;
            for (std::size_t i = 0; i < rig.n_pts(); ++i) {
                acc += l2(std::span<const float>(&prev[i * cfg.n_out], cfg.n_out),
                          std::span<const float>(&cur[i * cfg.n_out], cfg.n_out));
            }
            lurches.push_back(acc / static_cast<float>(rig.n_pts()));
            prev = cur;
        }
        rig.mlp.train();   // settle before measuring retention

        std::vector<float> got;
        float retain = 0.f;
        for (std::size_t i = 0; i < N; ++i) {
            rig.at(std::span<const float>(&ds.xs[i * cfg.n_in], cfg.n_in), got);
            retain += l2(got, std::span<const float>(&ds.ys[i * cfg.n_out], cfg.n_out));
        }

        char id[64];
        snprintf(id, sizeof id, "U2_amortised_div%02zu", div);
        js.begin_scenario(id, "train every Nth gesture (upstream optimiseDivisor)");
        js.kv("divisor", div);
        js.kv("is_nisps_today", static_cast<std::size_t>(div == 1u ? 1u : 0u));
        js.kv("gestures", N);
        // A divisor larger than the session length never fires, which would
        // otherwise report lurch=0 as if it were a result. Read this column
        // before believing the row.
        js.kv("trainings", trainings);
        js.kv("lurch_mean", mean(lurches));
        js.kv("lurch_p95", percentile(lurches, 0.95f));
        js.kv("lurch_max", percentile(lurches, 1.0f));
        js.kv("retain_mean", retain / static_cast<float>(N));
        FieldMetrics fm = measure_field(rig);
        js.field("field_", fm);
        js.end_scenario();
    }
}

// U3 — upstream's ACTOR SHAPE against the NISPS default. Upstream ran
// {n_in+1, 10, 10, n_out}: TWO hidden layers of 10. NISPS's dynamic storage
// fixes the topology at three hidden layers, so the closest reachable
// comparison is {10,10,X} against the default {16,16,16}. Reported so the
// architecture difference is not silently conflated with the output-path one.
void upstream_actor_shape(const Config& cfg, Json& js) {
    if (!selected(cfg, "U3_actor_shape")) return;
    struct S { const char* id; std::size_t h[3]; };
    const S shapes[] = {
        {"U3_actor_shape_nisps",    {16u, 16u, 16u}},
        {"U3_actor_shape_upstream", {10u, 10u,  1u}},  // 3rd layer minimal ~ 2 hidden
        {"U3_actor_shape_10_10_10", {10u, 10u, 10u}},
    };
    for (const S& sh : shapes) {
        Config c2 = cfg;
        c2.hidden[0] = sh.h[0]; c2.hidden[1] = sh.h[1]; c2.hidden[2] = sh.h[2];
        Rig rig(c2);
        const std::size_t N = c2.smoke ? 8u : 20u;
        Dataset ds = make_dataset(c2, "scattered", N, rig.rng);
        teach(rig, ds);
        rig.mlp.train();
        std::vector<float> got;
        float retain = 0.f;
        for (std::size_t i = 0; i < N; ++i) {
            rig.at(std::span<const float>(&ds.xs[i * c2.n_in], c2.n_in), got);
            retain += l2(got, std::span<const float>(&ds.ys[i * c2.n_out], c2.n_out));
        }
        js.begin_scenario(sh.id, "upstream actor shape vs the NISPS default");
        js.kv("h0", sh.h[0]); js.kv("h1", sh.h[1]); js.kv("h2", sh.h[2]);
        js.kv("weights", rig.mlp.weight_count());
        js.kv("retain_mean", retain / static_cast<float>(N));
        FieldMetrics fm = measure_field(rig);
        js.field("field_", fm);
        js.end_scenario();
    }
}


// U4 — BALANCED POSITIVES, the upstream way.
//
// Upstream e291192 optimise() trains likes with ONE epoch of TrainBatch over a
// random 8-sample from replay, at effLR * avgRewardPos where learningRate =
// 1e-3 (InterfaceRL.tpp:665, InterfaceRL.hpp:430,436). NISPS instead calls
// train() — the WHOLE dataset, lr 1.0, up to 1000 iterations, every gesture.
//
// That is the same root cause as the inert dislike, seen from the other side:
// upstream keeps likes and dislikes on ONE scale (~1e-3 batch steps), so a 'no'
// is comparable in force to a 'yes'. NISPS trains likes ~2e6x harder than
// dislikes, which simultaneously makes the dislike feel like nothing and makes
// every like heave the whole mapping.
//
// !!! READ BEFORE INTERPRETING THE upstream_* ROWS !!!
// Upstream's LR is an RMSPROP learning rate; ours is an SGD one. Upstream memlp
// (pinned ea777502) applies gradients with RMSProp everywhere — Layer.h:239
// "Apply gradients (RMSProp)", the m_sq_grad_avg running squared-gradient
// average at Layer.h:601, StaticMLP.h:268 "Mini-batch RMSProp training".
// nisps/ml/training.hpp ships SGD only (its own header says so). RMSProp divides
// each step by the running gradient magnitude, so lr=1e-3 there is a NORMALISED
// step; lr=1e-3 under SGD is literally 1e-3 x the raw gradient. The two numbers
// are not comparable, and the U4 upstream_* rows therefore do NOT show that
// upstream's dose fails to learn — they show that upstream's NUMBER means
// something else in our optimiser. Treat them as an SGD sensitivity sweep, and
// see ALIGNMENT.md defect 6.
//
// Reproduced here exactly: train(lr, iters, min_err) with iters=1 IS one epoch
// over the dataset. The comparison is lurch (how far the played mapping moves
// per gesture) against retention (whether it still learns anything).
void upstream_balanced_positives(const Config& cfg, Json& js) {
    if (!selected(cfg, "U4_balanced_positives")) return;

    // ticks = how many times the trainer runs per USER GESTURE. This is the
    // dimension I first got wrong, and it dominates the comparison.
    //
    // NISPS trains once per gesture, synchronously, on the press.
    // Upstream calls optimiseSometimes() from the loopCallback EVERY TICK with
    // optimiseDivisor=1 (InterfaceRL.tpp:229, InterfaceRL.hpp:380), and the loop
    // runs at 200 Hz (kJoltLRRampStep is documented as 1/(5s * 200Hz),
    // InterfaceRL.hpp:457). So between two gestures ~3 s apart upstream has run
    // ~600 optimise() calls. Giving its per-call dose only once per gesture
    // measures 1/600th of the real thing.
    struct V { const char* id; float lr; std::size_t iters; std::size_t ticks; };
    const V variants[] = {
        {"U4_pos_nisps_today",       1.0f,   1000u,   1u},  // train() defaults, on the press
        {"U4_pos_lr1_iter1",         1.0f,      1u,   1u},  // isolate: iterations alone
        {"U4_pos_upstream_1tick",    0.001f,    1u,   1u},  // upstream dose, 1/600th of its rate
        {"U4_pos_upstream_100tick",  0.001f,    1u, 100u},
        {"U4_pos_upstream_600tick",  0.001f,    1u, 600u},  // ~3 s between gestures @200 Hz
    };

    for (const V& v : variants) {
        Rig rig(cfg);
        const std::size_t N = cfg.smoke ? 10u : 40u;
        Dataset ds = make_dataset(cfg, "scattered", N, rig.rng);

        std::vector<float> prev, cur;
        rig.field(prev);
        std::vector<float> lurches;

        // Per-TICK lurch is what the musician feels: the mapping is live and they
        // hear every update, not a per-gesture summary. Sampling every tick at
        // 600 ticks/gesture would cost 600 field evaluations per gesture, so the
        // field is sampled on a stride and the stride is reported.
        const std::size_t stride = (v.ticks > 20u) ? (v.ticks / 20u) : 1u;
        std::size_t samples = 0u;
        for (std::size_t k = 0; k < N; ++k) {
            place_positive(rig, std::span<const float>(&ds.xs[k * cfg.n_in], cfg.n_in),
                                std::span<const float>(&ds.ys[k * cfg.n_out], cfg.n_out));
            for (std::size_t t = 0; t < v.ticks; ++t) {
                rig.mlp.train(v.lr, v.iters, 0.f);
                if ((t + 1u) % stride != 0u && t + 1u != v.ticks) continue;
                rig.field(cur);
                float acc = 0.f;
                for (std::size_t i = 0; i < rig.n_pts(); ++i) {
                    acc += l2(std::span<const float>(&prev[i * cfg.n_out], cfg.n_out),
                              std::span<const float>(&cur[i * cfg.n_out], cfg.n_out));
                }
                // Normalise to per-tick so the rows are comparable.
                lurches.push_back(acc / static_cast<float>(rig.n_pts())
                                      / static_cast<float>(stride));
                prev = cur;
                ++samples;
            }
        }
        (void)samples;

        std::vector<float> got;
        float retain = 0.f;
        for (std::size_t i = 0; i < N; ++i) {
            rig.at(std::span<const float>(&ds.xs[i * cfg.n_in], cfg.n_in), got);
            retain += l2(got, std::span<const float>(&ds.ys[i * cfg.n_out], cfg.n_out));
        }

        js.begin_scenario(v.id, "positive-path training dose: lurch vs retention");
        js.kv("lr", v.lr);
        js.kv("iters", v.iters);
        js.kv("ticks_per_gesture", v.ticks);
        js.kv("field_sample_stride", stride);
        js.kv("gestures", N);
        js.kv("lurch_mean", mean(lurches));
        js.kv("lurch_max", percentile(lurches, 1.0f));
        js.kv("retain_mean", retain / static_cast<float>(N));
        FieldMetrics fm = measure_field(rig);
        js.field("field_", fm);
        js.end_scenario();
    }
}

// ---------------------------------------------------------------------------
void run(const Config& cfg) {
    Json js;
    js.begin_run(cfg);
    probe_at_example(cfg, js);
    probe_around_example(cfg, js);
    probe_far_field(cfg, js);
    probe_negative_once(cfg, js);
    probe_negative_twice(cfg, js);
    probe_negative_adjacent(cfg, js);
    probe_negative_near_positive(cfg, js);
    probe_randomise_and_place(cfg, js);
    journey_positive_only(cfg, js);
    journey_randomise_place_only(cfg, js);
    journey_mixed(cfg, js);
    journey_branch(cfg, js);
    diag_geo_anatomy(cfg, js);
    probe_explore_place(cfg, js);
    probe_explore_cancel(cfg, js);
    probe_reposition(cfg, js);
    probe_like_then_dislike(cfg, js);
    probe_dislike_then_repair(cfg, js);
    probe_focus_mask(cfg, js);
    journey_explore_place_only(cfg, js);
    journey_long_session(cfg, js);
    journey_dislike_storm(cfg, js);
    journey_revisit(cfg, js);
    journey_two_region(cfg, js);
    journey_sweep_teach(cfg, js);
    journey_undo_heavy(cfg, js);
    upstream_soft_target(cfg, js);
    upstream_amortised(cfg, js);
    upstream_actor_shape(cfg, js);
    upstream_balanced_positives(cfg, js);
    edge_cases(cfg, js);
    edge_cases_2(cfg, js);
    js.end_run();
}

void usage() {
    fprintf(stderr,
        "ml_bench — behavioural benchmark for the NISPS control mapping\n"
        "\n"
        "  --shape N_IN,H1,H2,H3,N_OUT   default 2,16,16,16,8\n"
        "  --seed N                      default 0x5EED\n"
        "  --max-examples N              default 128\n"
        "  --scenario ID                 run one scenario\n"
        "  --spread F                    1=Xavier (default), 0=uniform/no fan_in\n"
        "  --geo-lr F                    geometric-dislike LR (default 0.001)\n"
        "  --geo-iters N                 gradient steps per dislike (default 1)\n"
        "  --smoke                       reduced point counts\n"
        "\n"
        "Emits JSON on stdout. Asserts nothing — see scripts/bench-ml.sh --compare.\n");
}

}  // namespace

int main(int argc, char** argv) {
    Config cfg;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&]() -> const char* { return (i + 1 < argc) ? argv[++i] : nullptr; };
        if (a == "--shape") {
            const char* v = next();
            if (!v) { usage(); return 2; }
            std::size_t d[5] = {0, 0, 0, 0, 0};
            int n = std::sscanf(v, "%zu,%zu,%zu,%zu,%zu", &d[0], &d[1], &d[2], &d[3], &d[4]);
            if (n != 5) { fprintf(stderr, "ml_bench: --shape needs 5 comma-separated dims\n"); return 2; }
            cfg.n_in = d[0]; cfg.hidden[0] = d[1]; cfg.hidden[1] = d[2];
            cfg.hidden[2] = d[3]; cfg.n_out = d[4];
        } else if (a == "--seed") {
            const char* v = next();
            if (!v) { usage(); return 2; }
            cfg.seed = std::strtoull(v, nullptr, 0);
        } else if (a == "--max-examples") {
            const char* v = next();
            if (!v) { usage(); return 2; }
            cfg.max_examples = std::strtoull(v, nullptr, 0);
        } else if (a == "--scenario") {
            const char* v = next();
            if (!v) { usage(); return 2; }
            cfg.only = v;
        } else if (a == "--spread") {
            const char* v = next();
            if (!v) { usage(); return 2; }
            cfg.spread = static_cast<float>(std::atof(v));
        } else if (a == "--geo-lr") {
            const char* v = next();
            if (!v) { usage(); return 2; }
            cfg.geo_lr = static_cast<float>(std::atof(v));
        } else if (a == "--geo-iters") {
            const char* v = next();
            if (!v) { usage(); return 2; }
            cfg.geo_iters = std::strtoull(v, nullptr, 0);
        } else if (a == "--smoke") {
            cfg.smoke = true;
        } else if (a == "--help" || a == "-h") {
            usage();
            return 0;
        } else {
            fprintf(stderr, "ml_bench: unknown arg '%s'\n", a.c_str());
            usage();
            return 2;
        }
    }
    if (cfg.n_in == 0u || cfg.n_out == 0u ||
        cfg.hidden[0] == 0u || cfg.hidden[1] == 0u || cfg.hidden[2] == 0u) {
        fprintf(stderr, "ml_bench: all dims must be >= 1\n");
        return 2;
    }
    run(cfg);
    return 0;
}
