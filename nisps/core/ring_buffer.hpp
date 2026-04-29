// nisps/core/ring_buffer.hpp — single-producer single-consumer lock-free FIFO.
//
// Replaces pico/util/queue across the platform-agnostic core. On firmware,
// the inter-core hand-off can wrap this OR use queue_t directly — that
// decision lives in stream 6 (firmware glue). Within `nisps/`, this is the
// canonical channel.
//
// Design notes
// - Capacity N must be a power of two. We mask the head/tail indices instead
//   of taking modulus; this lets the indices wrap naturally at size_t and we
//   compare them with subtraction (i.e. `head - tail == N` ⇒ full).
// - T must be trivially copyable. We do not run T's destructor on pop —
//   callers want POD-shaped messages here, not RAII handles.
// - Memory orders follow Vyukov's classic SPSC pattern:
//     producer: relaxed load(tail), [write slot], release store(head)
//     consumer: relaxed load(head), acquire load(head), [read slot], release store(tail)

#pragma once

#include <atomic>
#include <cstddef>
#include <type_traits>

namespace nisps {

template <typename T, std::size_t N>
class RingBuffer {
    static_assert(N > 0u, "RingBuffer capacity must be > 0");
    static_assert((N & (N - 1u)) == 0u, "RingBuffer capacity must be power of two");
    static_assert(std::is_trivially_copyable_v<T>,
                  "RingBuffer element type must be trivially copyable");

   public:
    static constexpr std::size_t capacity() noexcept { return N; }

    RingBuffer() noexcept : head_(0u), tail_(0u) {}

    // No copy / no move — atomics aren't trivially movable and there's no
    // good story for "transfer half-full ring under contention".
    RingBuffer(const RingBuffer&)            = delete;
    RingBuffer& operator=(const RingBuffer&) = delete;

    bool try_push(const T& v) noexcept {
        const auto head = head_.load(std::memory_order_relaxed);
        const auto tail = tail_.load(std::memory_order_acquire);
        if (head - tail >= N) return false;          // full
        buf_[head & kMask] = v;
        head_.store(head + 1u, std::memory_order_release);
        return true;
    }

    bool try_pop(T& out) noexcept {
        const auto tail = tail_.load(std::memory_order_relaxed);
        const auto head = head_.load(std::memory_order_acquire);
        if (head == tail) return false;              // empty
        out = buf_[tail & kMask];
        tail_.store(tail + 1u, std::memory_order_release);
        return true;
    }

    // Approximate; relies on head/tail being read in arbitrary order. Use
    // for diagnostics, not for synchronization.
    std::size_t size_approx() const noexcept {
        const auto h = head_.load(std::memory_order_relaxed);
        const auto t = tail_.load(std::memory_order_relaxed);
        return h - t;
    }
    bool empty_approx() const noexcept { return size_approx() == 0u; }
    bool full_approx()  const noexcept { return size_approx() >= N; }

   private:
    static constexpr std::size_t kMask = N - 1u;

    // Head/tail use std::size_t and rely on natural unsigned wrap.
    std::atomic<std::size_t> head_;
    std::atomic<std::size_t> tail_;
    T buf_[N]{};
};

}  // namespace nisps
