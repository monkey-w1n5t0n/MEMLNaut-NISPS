// nisps/dsp/delay.hpp — static-buffer delay lines.
//
//  Delay<N>          — fixed-length feedback delay (maximilian's maxiDelayline)
//  DynamicDelay<N>   — power-of-two ring with fractional-tap read + smoothed
//                      delay-time (used by VerbFX's three delay lanes).
//
// Sample-rate is opaque to these primitives; delay sizes are in samples.
// Convert from milliseconds at the engine layer (`samples = ms * sr / 1000`).

#pragma once

#include <array>
#include <cstddef>
#include <cstring>

#include "../core/perf.hpp"

namespace nisps {

// Fixed-length feedback delay. `play()` reads the head, mixes feedback into the
// slot, and advances. Behavior matches maxiDelayline<N>::play().
template <std::size_t N>
class Delay {
   public:
    Delay() noexcept { clear(); }

    void clear() noexcept {
        std::memset(memory_.data(), 0, N * sizeof(float));
        phase_ = 0u;
    }

    NISPS_HOT NISPS_FORCE_INLINE float play(float input,
                                            std::size_t size,
                                            float feedback) noexcept {
        if (size >= N) [[unlikely]] return 0.f;
        if (phase_ >= size) [[unlikely]] phase_ = 0u;
        const float out = memory_[phase_];
        memory_[phase_] = (memory_[phase_] * feedback) + input;
        ++phase_;
        return out;
    }

    static constexpr std::size_t capacity() noexcept { return N; }

   private:
    alignas(16) std::array<float, N> memory_{};
    std::size_t phase_ = 0u;
};

// Power-of-two ring with fractional-tap read; smooths the read offset between
// frames so changes in `target_size` glitch-freely. Mirrors maximilian's
// `DynamicDelay<N>`.
template <std::size_t N>
class DynamicDelay {
    static_assert((N & (N - 1u)) == 0u, "DynamicDelay capacity must be power of two");
    static constexpr std::size_t kMask = N - 1u;

   public:
    DynamicDelay() noexcept : smoothed_size_(static_cast<float>(N)) {}

    void clear() noexcept {
        std::memset(line_.data(), 0, N * sizeof(float));
        write_index_  = 0u;
        smoothed_size_ = static_cast<float>(N);
    }

    void set_smooth_coeff(float c) noexcept { smooth_coeff_ = c; }

    NISPS_HOT NISPS_FORCE_INLINE float read(float target_size) noexcept {
        smoothed_size_ = smoothed_size_ * smooth_coeff_
                       + target_size * (1.f - smooth_coeff_);
        float read_pos = static_cast<float>(write_index_) - smoothed_size_;
        if (read_pos < 0.f) read_pos += static_cast<float>(N);
        const std::size_t i1 = static_cast<std::size_t>(read_pos);
        const float frac     = read_pos - static_cast<float>(i1);
        const std::size_t i2 = (i1 + 1u) & kMask;
        return line_[i1] + frac * (line_[i2] - line_[i1]);
    }

    NISPS_HOT NISPS_FORCE_INLINE void write(float input) noexcept {
        line_[write_index_] = input;
        write_index_ = (write_index_ + 1u) & kMask;
    }

    static constexpr std::size_t capacity() noexcept { return N; }

   private:
    std::array<float, N> line_{};
    std::size_t write_index_ = 0u;
    float       smoothed_size_;
    float       smooth_coeff_ = 0.997f;
};

}  // namespace nisps
