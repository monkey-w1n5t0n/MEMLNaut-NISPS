// nisps/pipeline/output_chain.hpp — the per-output processing chain
// (one-core-engine-refactor P4). Faithful C++ port of the retired
// manifold/src/engine/output-pipeline.ts, the behaviour contract pinned by
// manifold/tests/fixtures/output-pipeline-golden.json.
//
// Stages (in order) for each output:
//   1. Global power curve (raw^exponent, exponent in [0.2, 5.0])
//   2. Per-output EMA smoothing (frame-rate-independent)
//   3. Slew-rate limiting (max change per second per output)
//   4. Freeze gate (global) and per-output freeze mask
//
// PERF CONTRACT: no heap — capacity is a template parameter (browser
// bindings instantiate a large cap; firmware would pick its mode's NOut).
// Control-rate. `.f` literals, no virtual dispatch.

#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

#include "../core/math.hpp"
#include "../core/perf.hpp"

namespace nisps::pipeline {

inline constexpr float kOutputReferenceDt = 1.f / 60.f;
// Slew sentinel: any value <= 0 means "unlimited" (the TS Infinity default).
inline constexpr float kSlewUnlimited = 0.f;

struct OutputChainConfig {
    float global_curve  = 1.0f;           // [0.2, 5]; 1 = linear
    float smoothing     = 0.f;            // [0, 0.95]
    float slew_rate     = kSlewUnlimited; // change/sec; <= 0 ⇒ unlimited
    bool  freeze_output = false;          // global freeze gate
};

template <std::size_t NMax>
class OutputChain {
   public:
    static constexpr std::size_t kMaxOutputs = NMax;

    OutputChain() noexcept = default;

    void set_config(const OutputChainConfig& c) noexcept { cfg_ = c; }
    const OutputChainConfig& config() const noexcept { return cfg_; }

    // Per-output freeze mask (1 = frozen). Empty span clears the mask.
    void set_freeze_mask(std::span<const std::uint8_t> mask) noexcept {
        mask_count_ = (mask.size() < NMax) ? mask.size() : NMax;
        for (std::size_t i = 0; i < mask_count_; ++i) freeze_mask_[i] = mask[i];
    }
    void clear_freeze_mask() noexcept { mask_count_ = 0u; }

    void reset() noexcept {
        seeded_count_ = 0u;
    }

    // Serialisable state: [count, prev..., smoothed...].
    std::size_t state_size() const noexcept { return 1u + 2u * seeded_count_; }
    void save_state(std::span<float> out) const noexcept {
        if (out.size() < state_size()) return;
        out[0] = static_cast<float>(seeded_count_);
        for (std::size_t i = 0; i < seeded_count_; ++i) {
            out[1u + i] = prev_[i];
            out[1u + seeded_count_ + i] = smoothed_[i];
        }
    }
    void load_state(std::span<const float> in) noexcept {
        if (in.empty()) return;
        std::size_t n = static_cast<std::size_t>(in[0]);
        if (n > NMax) n = NMax;
        if (in.size() < 1u + 2u * n) return;
        seeded_count_ = n;
        for (std::size_t i = 0; i < n; ++i) {
            prev_[i] = in[1u + i];
            smoothed_[i] = in[1u + n + i];
        }
    }

    // Process `raw` (n ≤ NMax) into `out` (may alias `raw`). `dt_s` = seconds
    // since the previous call.
    void process(std::span<const float> raw, std::span<float> out, float dt_s) noexcept {
        std::size_t n = raw.size();
        if (n > NMax) n = NMax;
        if (out.size() < n) return;
        const float dt = (dt_s > 0.f) ? dt_s : 0.f;

        // (Re)seed prev/smoothed from raw on first call or length change —
        // matches the TS null/length-mismatch reseed.
        if (seeded_count_ != n) {
            for (std::size_t i = 0; i < n; ++i) {
                const float r = nisps::clamp01(raw[i]);
                prev_[i] = r;
                smoothed_[i] = r;
            }
            seeded_count_ = n;
        }

        if (cfg_.freeze_output) {
            // Output frozen: hold prior values.
            for (std::size_t i = 0; i < n; ++i) out[i] = prev_[i];
            return;
        }

        const float exp = cfg_.global_curve;
        const bool  slew_on = cfg_.slew_rate > 0.f;
        const float max_delta = slew_on ? cfg_.slew_rate * dt : 0.f;

        for (std::size_t i = 0; i < n; ++i) {
            const float r      = nisps::clamp01(raw[i]);
            const float curved = (exp == 1.0f) ? r : std::pow(r, exp);

            // Per-output freeze
            if (i < mask_count_ && freeze_mask_[i] != 0u) {
                out[i] = prev_[i];
                continue;
            }

            // Stage 2: EMA smoothing
            float value = ema_smooth_(smoothed_[i], curved, cfg_.smoothing, dt);
            smoothed_[i] = value;

            // Stage 3: slew-rate limit
            if (slew_on) {
                const float delta = value - prev_[i];
                if (std::fabs(delta) > max_delta) {
                    const float sign = (delta < 0.f) ? -1.f : 1.f;
                    value = prev_[i] + sign * max_delta;
                }
            }

            out[i] = nisps::clamp01(value);
        }

        // Update prev for the next call (frozen dims hold their prev).
        for (std::size_t i = 0; i < n; ++i) {
            if (i < mask_count_ && freeze_mask_[i] != 0u) continue;
            prev_[i] = out[i];
        }
    }

   private:
    static float ema_smooth_(float prev, float raw, float smoothing, float dt) noexcept {
        if (smoothing <= 0.f) return raw;
        const float effective_dt = (dt > 0.f) ? dt : kOutputReferenceDt;
        const float alpha     = 1.f - smoothing;
        const float alpha_eff =
            1.f - std::pow(1.f - alpha, effective_dt / kOutputReferenceDt);
        return prev + alpha_eff * (raw - prev);
    }

    OutputChainConfig cfg_{};
    std::uint8_t freeze_mask_[NMax]{};
    std::size_t  mask_count_ = 0u;
    float prev_[NMax]{};
    float smoothed_[NMax]{};
    std::size_t seeded_count_ = 0u;
};

}  // namespace nisps::pipeline
