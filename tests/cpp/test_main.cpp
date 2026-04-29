// tests/cpp/test_main.cpp — entry point that runs every test registered
// across the translation units linked into nisps_core_tests.

#include "test_helpers.hpp"

int main() {
    return nisps::test::run_all();
}
