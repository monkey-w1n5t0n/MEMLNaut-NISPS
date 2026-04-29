// tests/cpp/test_helpers.hpp — minimal assertion-based test harness.
//
// Why roll our own: zero external dependencies, builds in <1s, integrates
// trivially with CMake. Catch2/doctest would add a fetch step (≈ 10 MB and
// 30s of compile time) for what is currently a handful of asserts. If the
// suite grows beyond a few hundred lines we can revisit.
//
// API:
//   NISPS_TEST(name)        — declare a test
//   NISPS_EXPECT(cond)      — non-fatal check (records, keeps running)
//   NISPS_ASSERT(cond)      — fatal check (aborts the test)
//   NISPS_EXPECT_NEAR(a, b, eps)
//
// Usage:
//   NISPS_TEST(my_test) {
//       NISPS_EXPECT(1 + 1 == 2);
//   }
//   int main() { return nisps::test::run_all(); }

#pragma once

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace nisps::test {

struct TestFailure { const char* msg; };

struct TestCase {
    const char* name;
    void (*fn)();
};

inline std::vector<TestCase>& registry() {
    static std::vector<TestCase> r;
    return r;
}

struct Registrar {
    Registrar(const char* name, void (*fn)()) {
        registry().push_back({name, fn});
    }
};

inline int run_all() {
    int passed = 0, failed = 0;
    for (const auto& tc : registry()) {
        std::printf("[ RUN      ] %s\n", tc.name);
        try {
            tc.fn();
            std::printf("[       OK ] %s\n", tc.name);
            ++passed;
        } catch (const TestFailure& f) {
            std::printf("[  FAILED  ] %s — %s\n", tc.name, f.msg);
            ++failed;
        }
    }
    std::printf("\n[==========] %d passed, %d failed\n", passed, failed);
    return failed == 0 ? 0 : 1;
}

}  // namespace nisps::test

#define NISPS_TEST_CONCAT_(a, b) a##b
#define NISPS_TEST_CONCAT(a, b)  NISPS_TEST_CONCAT_(a, b)

#define NISPS_TEST(name)                                                      \
    static void NISPS_TEST_CONCAT(nisps_test_, name)();                       \
    static ::nisps::test::Registrar NISPS_TEST_CONCAT(nisps_test_reg_, name)( \
        #name, &NISPS_TEST_CONCAT(nisps_test_, name));                        \
    static void NISPS_TEST_CONCAT(nisps_test_, name)()

#define NISPS_EXPECT(cond)                                                    \
    do {                                                                      \
        if (!(cond)) {                                                        \
            std::fprintf(stderr,                                              \
                         "  EXPECT failed at %s:%d: %s\n",                    \
                         __FILE__, __LINE__, #cond);                          \
            throw ::nisps::test::TestFailure{#cond};                          \
        }                                                                     \
    } while (0)

#define NISPS_ASSERT(cond) NISPS_EXPECT(cond)

#define NISPS_EXPECT_NEAR(a, b, eps)                                          \
    do {                                                                      \
        const double da = static_cast<double>(a);                             \
        const double db = static_cast<double>(b);                             \
        if (std::fabs(da - db) > static_cast<double>(eps)) {                  \
            std::fprintf(stderr,                                              \
                         "  EXPECT_NEAR failed at %s:%d: %s ≈ %s "            \
                         "(|%g - %g| = %g > %g)\n",                           \
                         __FILE__, __LINE__, #a, #b, da, db,                  \
                         std::fabs(da - db), static_cast<double>(eps));       \
            throw ::nisps::test::TestFailure{#a " ≈ " #b};                    \
        }                                                                     \
    } while (0)
