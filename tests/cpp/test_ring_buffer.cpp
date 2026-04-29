// tests/cpp/test_ring_buffer.cpp — single-threaded SPSC behavior. We don't
// stress the memory ordering in unit tests (that would need a multi-thread
// fuzz harness); we just confirm the FIFO invariants and the capacity guard.

#include "test_helpers.hpp"
#include "../../nisps/core/ring_buffer.hpp"

NISPS_TEST(ring_buffer_empty_pop_fails) {
    nisps::RingBuffer<int, 4> r;
    int v = -1;
    NISPS_EXPECT(!r.try_pop(v));
    NISPS_EXPECT(r.empty_approx());
}

NISPS_TEST(ring_buffer_fifo_order) {
    nisps::RingBuffer<int, 4> r;
    NISPS_EXPECT(r.try_push(1));
    NISPS_EXPECT(r.try_push(2));
    NISPS_EXPECT(r.try_push(3));
    int v = 0;
    NISPS_EXPECT(r.try_pop(v)); NISPS_EXPECT(v == 1);
    NISPS_EXPECT(r.try_pop(v)); NISPS_EXPECT(v == 2);
    NISPS_EXPECT(r.try_pop(v)); NISPS_EXPECT(v == 3);
    NISPS_EXPECT(!r.try_pop(v));
}

NISPS_TEST(ring_buffer_full_push_fails) {
    nisps::RingBuffer<int, 4> r;
    NISPS_EXPECT(r.try_push(1));
    NISPS_EXPECT(r.try_push(2));
    NISPS_EXPECT(r.try_push(3));
    NISPS_EXPECT(r.try_push(4));
    NISPS_EXPECT(!r.try_push(5));            // full
    NISPS_EXPECT(r.size_approx() == 4u);
}

NISPS_TEST(ring_buffer_wraparound) {
    nisps::RingBuffer<int, 4> r;
    int v = 0;
    // Fill, drain, fill again — exercises index wrap.
    for (int i = 0; i < 100; ++i) {
        NISPS_EXPECT(r.try_push(i));
        NISPS_EXPECT(r.try_pop(v));
        NISPS_EXPECT(v == i);
    }
    NISPS_EXPECT(r.empty_approx());
}

NISPS_TEST(ring_buffer_partial_fill_drain) {
    nisps::RingBuffer<int, 8> r;
    for (int i = 0; i < 6; ++i) NISPS_EXPECT(r.try_push(i * 10));
    NISPS_EXPECT(r.size_approx() == 6u);
    int v = 0;
    NISPS_EXPECT(r.try_pop(v)); NISPS_EXPECT(v == 0);
    NISPS_EXPECT(r.try_pop(v)); NISPS_EXPECT(v == 10);
    NISPS_EXPECT(r.try_push(60));
    NISPS_EXPECT(r.try_push(70));
    NISPS_EXPECT(r.size_approx() == 6u);
    int expect[] = {20, 30, 40, 50, 60, 70};
    for (int e : expect) {
        NISPS_EXPECT(r.try_pop(v));
        NISPS_EXPECT(v == e);
    }
}
