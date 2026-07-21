// nisps/core/event_queue.hpp — same-thread, batch-drain FIFO for engine
// output events (NoteOn/NoteOff/Clock/CC, ...).
//
// This is NOT a replacement for RingBuffer (nisps/core/ring_buffer.hpp).
// RingBuffer is an atomics-based SPSC channel for genuine cross-thread /
// cross-core hand-off (its own header: "the inter-core hand-off can wrap
// this OR use queue_t directly"). Sequencer engines push events from inside
// `process()` and the mode layer drains them via `pop_events()` right after
// — same call chain, same thread, never concurrent — so there is nothing to
// synchronize. Reusing RingBuffer here would add atomic load/store traffic
// to the audio-hot `process()` path for no correctness benefit, and would
// still need a wrapping loop to get the "drain up to N in one call" batch
// shape `pop_events()` callers rely on (RingBuffer::try_pop is one element
// at a time). EventQueue is deliberately the plain, non-atomic version of
// that shape.
//
// Extracted from the byte-for-byte-identical event-queue member blocks
// previously duplicated in nisps/engines/breakor.hpp and
// nisps/engines/elysiamorf.hpp (2026-07 simplification audit, finding L8).

#pragma once

#include <array>
#include <cstddef>
#include <span>
#include <type_traits>

#include "perf.hpp"

namespace nisps {

template <typename T, std::size_t N>
class EventQueue {
    static_assert(N > 0u, "EventQueue capacity must be > 0");
    static_assert(std::is_trivially_copyable_v<T>,
                  "EventQueue element type must be trivially copyable");

   public:
    static constexpr std::size_t capacity() noexcept { return N; }

    // Enqueues one event. Drops silently on overflow (matches the engines'
    // original push_event behaviour — a full event queue on a stalled
    // consumer should not stall or branch the audio-hot producer).
    NISPS_FORCE_INLINE void push(const T& e) noexcept {
        if (count_ >= N) return;
        buf_[write_] = e;
        write_ = (write_ + 1u) % N;
        ++count_;
    }

    // Drains up to `out.size()` queued events into `out`. Returns the number
    // actually copied.
    std::size_t pop(std::span<T> out) noexcept {
        std::size_t n = 0u;
        while (n < out.size() && count_ > 0u) {
            out[n++] = buf_[read_];
            read_ = (read_ + 1u) % N;
            --count_;
        }
        return n;
    }

    std::size_t size() const noexcept { return count_; }
    bool        empty() const noexcept { return count_ == 0u; }

   private:
    std::array<T, N> buf_{};
    std::size_t read_  = 0u;
    std::size_t write_ = 0u;
    std::size_t count_ = 0u;
};

}  // namespace nisps
