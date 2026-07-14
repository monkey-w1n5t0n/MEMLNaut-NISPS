// nisps/ml/replay.hpp — reward-tagged replay memory algorithms for the
// geometric-dislike feedback mode (docs/adr/rl-feedback-design.md §4).
//
// Ported from upstream InterfaceRL (memllib @ 0a541cc "highlighting"):
//   * `_perform_dislike_action()` (InterfaceRL.cpp:42-66) — nearby-negative
//     deepening within Euclidean 0.05, else store reward=-1.
//   * `optimise()` k-NN positive centroid (InterfaceRL.cpp:602-627).
//   * proportional negative decay + eviction (InterfaceRL.cpp:664, :752-760).
//
// STORAGE: the buffers live in the feedback controller's storage policy
// (nisps/ml/feedback.hpp — fixed std::array on firmware, arena slice in the
// browser). `ReplayView` binds those spans plus the live item count and
// carries the algorithms — no ownership, no heap, deterministic.
//
// DETERMINISM (the classic float-sum parity traps, per the ADR):
//   * k-NN selection uses a fixed-size insertion into k slots with ties
//     broken by LOWER index (no std::sort, no heap).
//   * centroid accumulation runs in slot order (nearest first) — a fixed
//     summation order so native == WASM bitwise.
//   * eviction compacts in place preserving insertion order.

#pragma once

#include <cmath>
#include <cstddef>
#include <span>

#include "../core/perf.hpp"

namespace nisps::ml {

// Upstream constants (InterfaceRL.hpp:293-296, .cpp:42-66,664).
inline constexpr float       kReplayDedupRadius     = 0.05f;
inline constexpr float       kReplayDecayStep       = 0.0025f;
inline constexpr float       kReplayEvictThreshold  = -0.01f;
inline constexpr float       kMaxDislikeMagnitude   = 16.f;
inline constexpr std::size_t kCentroidK             = 4u;

// A non-owning view over the replay buffers (inputs: cap×n_in, actions:
// cap×n_out, rewards: cap) plus the live count. All methods deterministic,
// allocation-free.
class ReplayView {
   public:
    ReplayView(std::span<float> inputs, std::span<float> actions,
               std::span<float> rewards, std::size_t n_in, std::size_t n_out,
               std::size_t cap, std::size_t& count) noexcept
        : inputs_(inputs), actions_(actions), rewards_(rewards),
          n_in_(n_in), n_out_(n_out), cap_(cap), count_(count) {}

    std::size_t size() const noexcept { return count_; }
    std::size_t capacity() const noexcept { return cap_; }

    std::span<const float> input(std::size_t i) const noexcept {
        return inputs_.subspan(i * n_in_, n_in_);
    }
    std::span<const float> action(std::size_t i) const noexcept {
        return actions_.subspan(i * n_out_, n_out_);
    }
    float reward(std::size_t i) const noexcept { return rewards_[i]; }

    std::size_t positive_count() const noexcept {
        std::size_t n = 0u;
        for (std::size_t i = 0; i < count_; ++i) {
            if (rewards_[i] > 0.f) ++n;
        }
        return n;
    }
    std::size_t negative_count() const noexcept {
        std::size_t n = 0u;
        for (std::size_t i = 0; i < count_; ++i) {
            if (rewards_[i] <= 0.f) ++n;
        }
        return n;
    }
    // Mean reward across negatives (≤ 0); 0 when there are none. Fixed
    // accumulation order (insertion order).
    float avg_negative_reward() const noexcept {
        float sum = 0.f;
        std::size_t n = 0u;
        for (std::size_t i = 0; i < count_; ++i) {
            if (rewards_[i] <= 0.f) {
                sum += rewards_[i];
                ++n;
            }
        }
        return (n > 0u) ? (sum / static_cast<float>(n)) : 0.f;
    }

    // Store an item. When full, the OLDEST item is evicted (shift-down —
    // deterministic, preserves relative order).
    void store(float reward, std::span<const float> x, std::span<const float> a) noexcept {
        std::size_t slot;
        if (count_ < cap_) {
            slot = count_++;
        } else {
            evict_(0u);
            slot = count_++;
        }
        write_(slot, reward, x, a);
    }

    // Upstream `_perform_dislike_action` core: a negative within Euclidean
    // `radius` of x has its reward deepened (clamped at -kMaxDislikeMagnitude)
    // and its ACTION REFRESHED to the latest heard vector; otherwise a new
    // reward=-1 item is stored. Returns true when an existing item deepened.
    bool deepen_or_store_negative(std::span<const float> x, std::span<const float> a,
                                  float radius = kReplayDedupRadius) noexcept {
        for (std::size_t i = 0; i < count_; ++i) {
            if (rewards_[i] < 0.f && distance_(i, x) < radius) {
                float r = rewards_[i] - 1.f;
                if (r < -kMaxDislikeMagnitude) r = -kMaxDislikeMagnitude;
                rewards_[i] = r;
                auto act = actions_.subspan(i * n_out_, n_out_);
                const std::size_t n = (a.size() < n_out_) ? a.size() : n_out_;
                for (std::size_t j = 0; j < n; ++j) act[j] = a[j];
                return true;
            }
        }
        store(-1.f, x, a);
        return false;
    }

    // k-NN positive centroid (InterfaceRL.cpp:602-627): mean action of the k
    // positives nearest to x. Writes into `mean` (n_out floats) and returns
    // the number of positives used (0 ⇒ cold start; `mean` untouched).
    // Deterministic: fixed k-slot insertion, ties keep the LOWER index;
    // accumulation in slot order.
    std::size_t knn_positive_centroid(std::span<const float> x, std::size_t k,
                                      std::span<float> mean) const noexcept {
        constexpr std::size_t kMaxK = 8u;
        if (k > kMaxK) k = kMaxK;
        float       best_d[kMaxK];
        std::size_t best_i[kMaxK];
        std::size_t used = 0u;

        for (std::size_t i = 0; i < count_; ++i) {
            if (rewards_[i] <= 0.f) continue;
            const float d = distance_(i, x);
            // Insertion: strictly-less displaces, so equal distances keep the
            // earlier (lower-index) item.
            std::size_t pos = used;
            while (pos > 0u && d < best_d[pos - 1u]) --pos;
            if (pos >= k) continue;
            const std::size_t tail = (used < k) ? used : (k - 1u);
            for (std::size_t m = tail; m > pos; --m) {
                best_d[m] = best_d[m - 1u];
                best_i[m] = best_i[m - 1u];
            }
            best_d[pos] = d;
            best_i[pos] = i;
            if (used < k) ++used;
        }
        if (used == 0u) return 0u;

        for (std::size_t j = 0; j < n_out_; ++j) mean[j] = 0.f;
        for (std::size_t s = 0; s < used; ++s) {
            const auto act = action(best_i[s]);
            for (std::size_t j = 0; j < n_out_; ++j) mean[j] += act[j];
        }
        const float inv = 1.f / static_cast<float>(used);
        for (std::size_t j = 0; j < n_out_; ++j) mean[j] *= inv;
        return used;
    }

    // Proportional decay of every negative (`reward += 0.0025 * max(|r|, 1)`)
    // and in-place eviction of items decayed past -0.01. Returns the number
    // evicted (the caller halves its dislike multiplier per expiry, matching
    // upstream InterfaceRL.cpp:752-760).
    std::size_t decay_negatives() noexcept {
        std::size_t evicted = 0u;
        std::size_t i = 0u;
        while (i < count_) {
            if (rewards_[i] <= 0.f) {
                const float mag = (rewards_[i] < 0.f) ? -rewards_[i] : rewards_[i];
                rewards_[i] += kReplayDecayStep * ((mag > 1.f) ? mag : 1.f);
                if (rewards_[i] > kReplayEvictThreshold) {
                    evict_(i);
                    ++evicted;
                    continue;  // same index now holds the next item
                }
            }
            ++i;
        }
        return evicted;
    }

    void clear() noexcept { count_ = 0u; }

   private:
    float distance_(std::size_t i, std::span<const float> x) const noexcept {
        const auto in = input(i);
        const std::size_t n = (x.size() < n_in_) ? x.size() : n_in_;
        float acc = 0.f;
        for (std::size_t j = 0; j < n; ++j) {
            const float d = in[j] - x[j];
            acc += d * d;
        }
        return std::sqrt(acc);
    }

    void write_(std::size_t slot, float reward, std::span<const float> x,
                std::span<const float> a) noexcept {
        auto in  = inputs_.subspan(slot * n_in_, n_in_);
        auto act = actions_.subspan(slot * n_out_, n_out_);
        const std::size_t nx = (x.size() < n_in_) ? x.size() : n_in_;
        const std::size_t na = (a.size() < n_out_) ? a.size() : n_out_;
        for (std::size_t j = 0; j < n_in_; ++j) in[j] = (j < nx) ? x[j] : 0.f;
        for (std::size_t j = 0; j < n_out_; ++j) act[j] = (j < na) ? a[j] : 0.f;
        rewards_[slot] = reward;
    }

    // Remove item i, shifting everything after it down one slot.
    void evict_(std::size_t i) noexcept {
        for (std::size_t m = i + 1u; m < count_; ++m) {
            auto dst_in  = inputs_.subspan((m - 1u) * n_in_, n_in_);
            auto src_in  = inputs_.subspan(m * n_in_, n_in_);
            for (std::size_t j = 0; j < n_in_; ++j) dst_in[j] = src_in[j];
            auto dst_act = actions_.subspan((m - 1u) * n_out_, n_out_);
            auto src_act = actions_.subspan(m * n_out_, n_out_);
            for (std::size_t j = 0; j < n_out_; ++j) dst_act[j] = src_act[j];
            rewards_[m - 1u] = rewards_[m];
        }
        --count_;
    }

    std::span<float> inputs_;
    std::span<float> actions_;
    std::span<float> rewards_;
    std::size_t n_in_;
    std::size_t n_out_;
    std::size_t cap_;
    std::size_t& count_;
};

}  // namespace nisps::ml
