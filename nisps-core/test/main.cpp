#include <nisps/nisps.hpp>
#include <iostream>
#include <cmath>
#include <cassert>

void log_callback(const char* msg) {
    std::cout << "  [nisps] " << msg << "\n";
}

bool test_construction_and_inference() {
    std::cout << "--- Test: Construction and inference ---\n";

    nisps::IML<float> iml(2, 1, {4, 4}, 1000, 1.0f, 0.0001f);
    iml.set_logger(log_callback);

    iml.set_input(0, 0.5f);
    iml.set_input(1, 0.5f);
    iml.process();

    const float* out = iml.get_outputs();
    // Output should be a valid float in [0, 1] (sigmoid output layer)
    if (std::isnan(out[0]) || std::isinf(out[0])) {
        std::cerr << "FAIL: Output is NaN or Inf\n";
        return false;
    }
    if (out[0] < 0.0f || out[0] > 1.0f) {
        std::cerr << "FAIL: Output " << out[0] << " outside [0, 1]\n";
        return false;
    }

    std::cout << "  Output: " << out[0] << " (valid)\n";
    std::cout << "PASS\n\n";
    return true;
}

bool test_set_output_api() {
    std::cout << "--- Test: set_output / set_outputs API ---\n";

    nisps::IML<float> iml(2, 3);
    iml.set_logger(log_callback);

    iml.set_output(0, 0.25f);
    iml.set_output(1, 0.75f);
    iml.set_output(2, 0.5f);

    const float* out = iml.get_outputs();
    if (std::abs(out[0] - 0.25f) > 1e-6f ||
        std::abs(out[1] - 0.75f) > 1e-6f ||
        std::abs(out[2] - 0.5f) > 1e-6f) {
        std::cerr << "FAIL: set_output values not stored correctly\n";
        return false;
    }

    // Test clamping
    iml.set_output(0, -1.0f);
    iml.set_output(1, 2.0f);
    if (std::abs(iml.get_outputs()[0]) > 1e-6f ||
        std::abs(iml.get_outputs()[1] - 1.0f) > 1e-6f) {
        std::cerr << "FAIL: set_output clamping not working\n";
        return false;
    }

    // Test out-of-bounds index (should not crash)
    iml.set_output(999, 0.5f);

    // Test set_outputs bulk
    float vals[] = {0.1f, 0.2f, 0.3f};
    iml.set_outputs(vals, 3);
    if (std::abs(iml.get_outputs()[0] - 0.1f) > 1e-6f ||
        std::abs(iml.get_outputs()[1] - 0.2f) > 1e-6f ||
        std::abs(iml.get_outputs()[2] - 0.3f) > 1e-6f) {
        std::cerr << "FAIL: set_outputs bulk not working\n";
        return false;
    }

    std::cout << "PASS\n\n";
    return true;
}

bool test_add_example_api() {
    std::cout << "--- Test: add_example API ---\n";

    nisps::IML<float> iml(2, 1, {4}, 500, 1.0f, 0.001f);
    iml.set_logger(log_callback);
    iml.set_mode(nisps::IML<float>::Mode::Training);

    // Add a single example programmatically
    float in[] = {0.0f, 0.0f};
    float out[] = {0.0f};
    iml.add_example(in, 2, out, 1);

    // Switch to inference (triggers training)
    iml.set_mode(nisps::IML<float>::Mode::Inference);

    // Should not crash, training on 1 example
    iml.set_input(0, 0.0f);
    iml.set_input(1, 0.0f);
    iml.process();

    const float* result = iml.get_outputs();
    if (std::isnan(result[0]) || std::isinf(result[0])) {
        std::cerr << "FAIL: Output is NaN/Inf after training\n";
        return false;
    }

    std::cout << "  Output after training on 1 example: " << result[0] << "\n";
    std::cout << "PASS\n\n";
    return true;
}

bool test_training_convergence() {
    std::cout << "--- Test: Training convergence (identity mapping) ---\n";

    // Train a network to learn: input -> same output
    // This is simpler than XOR and should converge reliably
    nisps::IML<float> iml(1, 1, {8, 8}, 3000, 1.0f, 0.00001f);
    iml.set_logger(log_callback);
    iml.set_mode(nisps::IML<float>::Mode::Training);

    // Add training data: output should match input
    struct Example { float in; float out; };
    Example examples[] = {
        {0.1f, 0.1f},
        {0.3f, 0.3f},
        {0.5f, 0.5f},
        {0.7f, 0.7f},
        {0.9f, 0.9f},
    };

    for (const auto& ex : examples) {
        iml.add_example(&ex.in, 1, &ex.out, 1);
    }

    // Switch to inference (triggers training)
    iml.set_mode(nisps::IML<float>::Mode::Inference);

    // Now test: outputs should approximate inputs
    float max_error = 0.0f;
    bool passed = true;

    for (const auto& ex : examples) {
        iml.set_input(0, ex.in);
        iml.process();
        float result = iml.get_outputs()[0];
        float error = std::abs(result - ex.out);
        max_error = std::max(max_error, error);

        std::cout << "  Input: " << ex.in << " -> Output: " << result
                  << " (expected: " << ex.out << ", error: " << error << ")\n";

        if (error > 0.15f) {
            std::cerr << "  ERROR: Error too large for input " << ex.in << "\n";
            passed = false;
        }
    }

    // Also test interpolation at a value we didn't train on
    iml.set_input(0, 0.4f);
    iml.process();
    float interp = iml.get_outputs()[0];
    float interp_error = std::abs(interp - 0.4f);
    std::cout << "  Interpolation: 0.4 -> " << interp
              << " (error: " << interp_error << ")\n";

    std::cout << "  Max training error: " << max_error << "\n";
    if (passed) {
        std::cout << "PASS\n\n";
    } else {
        std::cerr << "FAIL: Network did not converge\n\n";
    }
    return passed;
}

bool test_multi_output_training() {
    std::cout << "--- Test: Multi-output training ---\n";

    // 2 inputs -> 2 outputs
    // Learn: (low, low) -> (0, 0), (high, high) -> (1, 1)
    nisps::IML<float> iml(2, 2, {8, 8}, 3000, 1.0f, 0.00001f);
    iml.set_logger(log_callback);
    iml.set_mode(nisps::IML<float>::Mode::Training);

    float in1[] = {0.1f, 0.1f}; float out1[] = {0.1f, 0.9f};
    float in2[] = {0.9f, 0.9f}; float out2[] = {0.9f, 0.1f};
    float in3[] = {0.1f, 0.9f}; float out3[] = {0.5f, 0.5f};
    float in4[] = {0.9f, 0.1f}; float out4[] = {0.5f, 0.5f};

    iml.add_example(in1, 2, out1, 2);
    iml.add_example(in2, 2, out2, 2);
    iml.add_example(in3, 2, out3, 2);
    iml.add_example(in4, 2, out4, 2);

    iml.set_mode(nisps::IML<float>::Mode::Inference);

    // Test that the network learned distinct mappings
    iml.set_input(0, 0.1f); iml.set_input(1, 0.1f);
    iml.process();
    float r1_0 = iml.get_outputs()[0];
    float r1_1 = iml.get_outputs()[1];

    iml.set_input(0, 0.9f); iml.set_input(1, 0.9f);
    iml.process();
    float r2_0 = iml.get_outputs()[0];
    float r2_1 = iml.get_outputs()[1];

    std::cout << "  (0.1, 0.1) -> (" << r1_0 << ", " << r1_1 << ") expected ~(0.1, 0.9)\n";
    std::cout << "  (0.9, 0.9) -> (" << r2_0 << ", " << r2_1 << ") expected ~(0.9, 0.1)\n";

    // The outputs for different inputs should be meaningfully different
    bool different = (std::abs(r1_0 - r2_0) > 0.1f) || (std::abs(r1_1 - r2_1) > 0.1f);
    if (!different) {
        std::cerr << "FAIL: Network outputs are too similar for different inputs\n\n";
        return false;
    }

    std::cout << "PASS\n\n";
    return true;
}

int main() {
    std::cout << "\n=== NISPS Core Test Suite ===\n\n";

    int passed = 0;
    int failed = 0;

    auto run = [&](bool result) { result ? passed++ : failed++; };

    run(test_construction_and_inference());
    run(test_set_output_api());
    run(test_add_example_api());
    run(test_training_convergence());
    run(test_multi_output_training());

    std::cout << "=== Results: " << passed << " passed, " << failed << " failed ===\n\n";

    return failed > 0 ? 1 : 0;
}
