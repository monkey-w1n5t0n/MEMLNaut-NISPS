// tests/cpp/test_fixed_buffer.cpp — exercises FixedBuffer's cursor semantics
// and capacity guard.

#include "test_helpers.hpp"
#include "../../nisps/core/fixed_buffer.hpp"

NISPS_TEST(fixed_buffer_starts_empty) {
    nisps::FixedBuffer<int, 8> b;
    NISPS_EXPECT(b.size() == 0u);
    NISPS_EXPECT(b.empty());
    NISPS_EXPECT(!b.full());
    NISPS_EXPECT(b.capacity() == 8u);
}

NISPS_TEST(fixed_buffer_push_and_index) {
    nisps::FixedBuffer<int, 4> b;
    NISPS_EXPECT(b.push_back(10));
    NISPS_EXPECT(b.push_back(20));
    NISPS_EXPECT(b.push_back(30));
    NISPS_EXPECT(b.size() == 3u);
    NISPS_EXPECT(b[0] == 10);
    NISPS_EXPECT(b[1] == 20);
    NISPS_EXPECT(b[2] == 30);
    NISPS_EXPECT(b.front() == 10);
    NISPS_EXPECT(b.back() == 30);
}

NISPS_TEST(fixed_buffer_refuses_when_full) {
    nisps::FixedBuffer<int, 2> b;
    NISPS_EXPECT(b.push_back(1));
    NISPS_EXPECT(b.push_back(2));
    NISPS_EXPECT(b.full());
    NISPS_EXPECT(!b.push_back(3));   // refused
    NISPS_EXPECT(b.size() == 2u);    // unchanged
}

NISPS_TEST(fixed_buffer_clear_resets) {
    nisps::FixedBuffer<int, 4> b;
    b.push_back(1); b.push_back(2);
    b.clear();
    NISPS_EXPECT(b.empty());
    NISPS_EXPECT(b.push_back(99));
    NISPS_EXPECT(b[0] == 99);
}

NISPS_TEST(fixed_buffer_iteration) {
    nisps::FixedBuffer<int, 8> b;
    for (int i = 0; i < 5; ++i) b.push_back(i * 2);
    int sum = 0;
    for (int v : b) sum += v;
    NISPS_EXPECT(sum == 0 + 2 + 4 + 6 + 8);
}
