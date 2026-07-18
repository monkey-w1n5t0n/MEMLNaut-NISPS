// nisps/pipeline/input_chain.hpp — the 2-axis input-processing chain
// (one-core-engine-refactor P4). Faithful C++ port of the retired
// manifold/src/engine/input-pipeline.ts (itself a bit-for-bit port of the
// legacy js/ui/input-pipeline.js), which is the behaviour contract pinned by
// manifold/tests/fixtures/input-pipeline-golden.json.
//
// Stages (in order), each axis in [0,1]:
//   0. Invert (per-axis flip)
//   1. Deadzone (suppress jitter near centre, remap live zone to [0,1])
//   2. Circular clamp (constrain to unit disk centred at 0.5,0.5)
//   3. Zoom (narrow window around anchor, modulated by momentum)
//   4. Centred power curve (per-axis exponent)
//   5. EMA smoothing (frame-rate-independent)
//   6. Momentum-as-zoom update (consumed next frame)
//
// TIME MODEL: the caller passes dt in SECONDS per call; the chain accumulates
// its own clock for the momentum velocity window (the TS original read
// performance.now() — the fixtures pin the equivalent clock contract). No
// wall clock in core: fully deterministic.
//
// PERF CONTRACT: no heap, no virtual dispatch, `.f` literals, fixed-capacity
// velocity ring. Control-rate (per pointer event / per control tick), not the
// audio ISR.

#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

#include "../core/math.hpp"
#include "../core/perf.hpp"

namespace nisps::pipeline {

inline constexpr float kZoomMin         = 0.01f;
inline constexpr float kZoomMax         = 1.0f;
inline constexpr float kFreezeThreshold = kZoomMin;
inline constexpr float kReferenceDt     = 1.f / 60.f;
inline constexpr float kVelocityWindowDefaultS = 0.150f;

// Sentinel for "null" per-axis overrides (valid zooms are [0.01, 1], valid
// curves [0.2, 5] — zero is outside both ranges).
inline constexpr float kUnsetOverride = 0.f;

enum class AnchorMode : std::uint8_t { Auto = 0, Sticky = 1, Center = 2 };
enum class MomentumMode : std::uint8_t { Off = 0, Gentle = 1, Strong = 2 };

struct InputChainConfig {
    float        zoom          = 1.0f;             // [0.01, 1]
    float        zoom_x        = kUnsetOverride;   // 0 ⇒ use zoom
    float        zoom_y        = kUnsetOverride;
    float        anchor_x      = 0.5f;
    float        anchor_y      = 0.5f;
    AnchorMode   anchor_mode   = AnchorMode::Center;
    float        deadzone      = 0.f;              // [0, 0.4]
    float        input_curve   = 1.0f;             // [0.2, 5]
    float        curve_x       = kUnsetOverride;   // 0 ⇒ use input_curve
    float        curve_y       = kUnsetOverride;
    float        smoothing     = 0.f;              // [0, 0.95]
    MomentumMode momentum_mode = MomentumMode::Off;
    float        velocity_window_s = kVelocityWindowDefaultS;
    bool         invert_x      = false;
    bool         invert_y      = false;
};

struct InputChainResult {
    float x;
    float y;
    bool  frozen;
};

class InputChain {
   public:
    // Velocity-history capacity. The TS original kept an unbounded window-
    // trimmed list; at real pointer rates (≤240 Hz) a 150 ms window holds
    // ≤36 entries. When full, the oldest entry is dropped (it would be the
    // first trimmed anyway).
    static constexpr std::size_t kHistoryCap = 64u;

    InputChain() noexcept = default;

    void set_config(const InputChainConfig& c) noexcept { cfg_ = c; }
    const InputChainConfig& config() const noexcept { return cfg_; }

    void reset() noexcept {
        smoothed_x_ = 0.5f;
        smoothed_y_ = 0.5f;
        momentum_multiplier_ = 1.f;
        frozen_ = false;
        now_s_ = 0.f;
        hist_count_ = 0u;
        hist_head_ = 0u;
    }

    // Serialisable per-instance state (persistence): [smoothed_x, smoothed_y,
    // momentum_multiplier]. The velocity history is transient by design.
    static constexpr std::size_t state_size() noexcept { return 3u; }
    void save_state(std::span<float> out) const noexcept {
        if (out.size() < state_size()) return;
        out[0] = smoothed_x_;
        out[1] = smoothed_y_;
        out[2] = momentum_multiplier_;
    }
    void load_state(std::span<const float> in) noexcept {
        if (in.size() < state_size()) return;
        smoothed_x_ = in[0];
        smoothed_y_ = in[1];
        momentum_multiplier_ = in[2];
        hist_count_ = 0u;
        hist_head_ = 0u;
    }

    // Process one raw 2D sample. `dt_s` = seconds since the previous call
    // (clamped at 0; 0 falls back to the 1/60 reference inside smoothing).
    InputChainResult process(float raw_x, float raw_y, float dt_s) noexcept {
        const float safe_dt = (dt_s > 0.f) ? dt_s : 0.f;
        now_s_ += safe_dt;

        const float base_zoom_x = (cfg_.zoom_x != kUnsetOverride) ? cfg_.zoom_x : cfg_.zoom;
        const float base_zoom_y = (cfg_.zoom_y != kUnsetOverride) ? cfg_.zoom_y : cfg_.zoom;

        const bool frozen_x = base_zoom_x <= kFreezeThreshold;
        const bool frozen_y = base_zoom_y <= kFreezeThreshold;
        if (frozen_x && frozen_y) {
            frozen_ = true;
            return {smoothed_x_, smoothed_y_, true};
        }

        // 0. Invert
        float x = cfg_.invert_x ? (1.f - raw_x) : raw_x;
        float y = cfg_.invert_y ? (1.f - raw_y) : raw_y;

        // 1. Deadzone
        x = apply_deadzone_(x, cfg_.deadzone);
        y = apply_deadzone_(y, cfg_.deadzone);

        // 2. Circular clamp to the unit disk centred at (0.5, 0.5)
        {
            const float cx = x - 0.5f;
            const float cy = y - 0.5f;
            const float dist = std::sqrt(cx * cx + cy * cy);
            if (dist > 0.5f && dist > 1e-12f) {
                const float scale = 0.5f / dist;
                x = 0.5f + cx * scale;
                y = 0.5f + cy * scale;
            }
        }

        // 3. Zoom around the anchor (with momentum modulation)
        const float anchor_x = (cfg_.anchor_mode == AnchorMode::Center) ? 0.5f : cfg_.anchor_x;
        const float anchor_y = (cfg_.anchor_mode == AnchorMode::Center) ? 0.5f : cfg_.anchor_y;
        const float eff_zoom_x = frozen_x
            ? kFreezeThreshold
            : nisps::clamp(base_zoom_x * momentum_multiplier_, kZoomMin, kZoomMax);
        const float eff_zoom_y = frozen_y
            ? kFreezeThreshold
            : nisps::clamp(base_zoom_y * momentum_multiplier_, kZoomMin, kZoomMax);
        x = frozen_x ? smoothed_x_ : apply_zoom_(x, anchor_x, eff_zoom_x);
        y = frozen_y ? smoothed_y_ : apply_zoom_(y, anchor_y, eff_zoom_y);

        // 4. Centred power curve
        const float curve_x = (cfg_.curve_x != kUnsetOverride) ? cfg_.curve_x : cfg_.input_curve;
        const float curve_y = (cfg_.curve_y != kUnsetOverride) ? cfg_.curve_y : cfg_.input_curve;
        if (!frozen_x) x = nisps::centered_power(x, curve_x);
        if (!frozen_y) y = nisps::centered_power(y, curve_y);

        // 5. EMA smoothing
        if (!frozen_x) smoothed_x_ = ema_smooth_(smoothed_x_, x, cfg_.smoothing, safe_dt);
        if (!frozen_y) smoothed_y_ = ema_smooth_(smoothed_y_, y, cfg_.smoothing, safe_dt);

        // 6. Update momentum-zoom for the next frame (uses the RAW sample,
        // pre-pipeline, like the TS original).
        update_momentum_(raw_x, raw_y, safe_dt);

        frozen_ = false;
        return {smoothed_x_, smoothed_y_, false};
    }

    bool  frozen() const noexcept { return frozen_; }
    float momentum_multiplier() const noexcept { return momentum_multiplier_; }

   private:
    static float apply_deadzone_(float input, float deadzone) noexcept {
        if (deadzone <= 0.f) return input;
        const float offset  = input - 0.5f;
        const float abs_off = std::fabs(offset);
        const float half_dz = deadzone * 0.5f;
        if (abs_off <= half_dz) return 0.5f;
        const float sign     = (offset < 0.f) ? -1.f : 1.f;
        const float remapped = ((abs_off - half_dz) / (0.5f - half_dz)) * 0.5f;
        return 0.5f + sign * remapped;
    }

    static float apply_zoom_(float input, float anchor, float zoom_level) noexcept {
        return nisps::clamp(anchor + (input - 0.5f) * zoom_level, 0.f, 1.f);
    }

    static float ema_smooth_(float prev, float raw, float smoothing, float dt) noexcept {
        if (smoothing <= 0.f) return raw;
        const float effective_dt = (dt > 0.f) ? dt : kReferenceDt;
        const float alpha     = 1.f - smoothing;
        const float alpha_eff = 1.f - std::pow(1.f - alpha, effective_dt / kReferenceDt);
        return prev + alpha_eff * (raw - prev);
    }

    void update_momentum_(float raw_x, float raw_y, float dt) noexcept {
        float factor, min_mul, max_mul;
        switch (cfg_.momentum_mode) {
            case MomentumMode::Gentle: factor = 0.6f; min_mul = 0.3f;  max_mul = 1.0f; break;
            case MomentumMode::Strong: factor = 1.5f; min_mul = 0.15f; max_mul = 1.0f; break;
            case MomentumMode::Off:
            default:
                momentum_multiplier_ = 1.f;
                hist_count_ = 0u;
                hist_head_ = 0u;
                return;
        }

        // Trim entries older than the window, then append (bounded ring).
        const float window = cfg_.velocity_window_s;
        while (hist_count_ > 0u) {
            const HistEntry& oldest = hist_[hist_head_];
            if (now_s_ - oldest.t <= window) break;
            hist_head_ = (hist_head_ + 1u) % kHistoryCap;
            --hist_count_;
        }
        if (hist_count_ == kHistoryCap) {
            hist_head_ = (hist_head_ + 1u) % kHistoryCap;
            --hist_count_;
        }
        hist_[(hist_head_ + hist_count_) % kHistoryCap] = {raw_x, raw_y, now_s_};
        ++hist_count_;

        if (hist_count_ < 2u) {
            momentum_multiplier_ = 1.f;
            return;
        }
        const HistEntry& a = hist_[hist_head_];
        const HistEntry& b = hist_[(hist_head_ + hist_count_ - 1u) % kHistoryCap];
        const float dt_hist = b.t - a.t;
        if (dt_hist <= 0.f) return;  // keep the previous multiplier
        const float dx = b.x - a.x;
        const float dy = b.y - a.y;
        const float dist  = std::sqrt(dx * dx + dy * dy);
        const float speed = dist / dt_hist;  // [0,1]-space units per second
        const float norm_speed = nisps::clamp(speed * factor, 0.f, 1.f);
        // Higher speed → smaller multiplier (zoom out faster movements).
        const float target = max_mul - (max_mul - min_mul) * norm_speed;
        // Smooth toward the target so the zoom doesn't jitter.
        const float smooth_coeff = nisps::clamp(dt * 6.f, 0.f, 1.f);
        momentum_multiplier_ += smooth_coeff * (target - momentum_multiplier_);
    }

    struct HistEntry {
        float x;
        float y;
        float t;
    };

    InputChainConfig cfg_{};
    float smoothed_x_ = 0.5f;
    float smoothed_y_ = 0.5f;
    float momentum_multiplier_ = 1.f;
    bool  frozen_ = false;
    float now_s_ = 0.f;
    HistEntry   hist_[kHistoryCap]{};
    std::size_t hist_head_  = 0u;
    std::size_t hist_count_ = 0u;
};

}  // namespace nisps::pipeline
