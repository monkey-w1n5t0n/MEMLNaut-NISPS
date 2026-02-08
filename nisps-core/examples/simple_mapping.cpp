/**
 * @file simple_mapping.cpp
 * @brief Example of using NISPS Core for parameter mapping
 *
 * Demonstrates creating a network, adding training examples
 * programmatically, training, and using inference.
 *
 * Compile: g++ -std=c++20 -I../include simple_mapping.cpp -o simple_mapping
 */

#include <nisps/nisps.hpp>
#include <iostream>
#include <iomanip>

void demo_inference() {
    std::cout << "=== Demo 1: Untrained Inference ===\n\n";

    // Create IML: 2 inputs (x, y) -> 4 outputs (filter, resonance, attack, release)
    nisps::IML<float> iml(2, 4, {8, 8}, 2000, 0.5f, 0.0001f);

    std::cout << "Created IML with " << iml.num_inputs() << " inputs, "
              << iml.num_outputs() << " outputs\n\n";

    // Untrained network produces random-ish outputs
    struct TestPoint { float x, y; const char* label; };
    TestPoint points[] = {
        {0.0f, 0.0f, "Bottom-left"},
        {1.0f, 1.0f, "Top-right"},
        {0.5f, 0.5f, "Center"},
    };

    std::cout << std::fixed << std::setprecision(3);
    for (const auto& p : points) {
        iml.set_input(0, p.x);
        iml.set_input(1, p.y);
        iml.process();
        const float* out = iml.get_outputs();
        std::cout << "  " << p.label << " (" << p.x << ", " << p.y << ") -> ["
                  << out[0] << ", " << out[1] << ", " << out[2] << ", " << out[3] << "]\n";
    }
    std::cout << "\n";
}

void demo_training() {
    std::cout << "=== Demo 2: Training a Mapping ===\n\n";

    // 2 inputs -> 2 outputs, small network
    nisps::IML<float> iml(2, 2, {8, 8}, 3000, 1.0f, 0.00001f);
    iml.set_logger([](const char* msg) {
        std::cout << "  [nisps] " << msg << "\n";
    });

    // Goal: teach the network a cross-mapping
    //   (low,  low)  -> (low output1,  high output2)
    //   (high, high) -> (high output1, low output2)
    std::cout << "Teaching cross-mapping:\n";
    std::cout << "  (low, low)   -> (low,  high)\n";
    std::cout << "  (high, high) -> (high, low)\n\n";

    iml.set_mode(nisps::IML<float>::Mode::Training);

    // Add examples using the programmatic API
    float in1[] = {0.1f, 0.1f}; float out1[] = {0.1f, 0.9f};
    float in2[] = {0.9f, 0.9f}; float out2[] = {0.9f, 0.1f};
    float in3[] = {0.5f, 0.5f}; float out3[] = {0.5f, 0.5f};
    float in4[] = {0.1f, 0.9f}; float out4[] = {0.3f, 0.7f};
    float in5[] = {0.9f, 0.1f}; float out5[] = {0.7f, 0.3f};

    iml.add_example(in1, 2, out1, 2);
    iml.add_example(in2, 2, out2, 2);
    iml.add_example(in3, 2, out3, 2);
    iml.add_example(in4, 2, out4, 2);
    iml.add_example(in5, 2, out5, 2);

    std::cout << "Added 5 training examples.\n";

    // Switching to inference triggers training
    std::cout << "Training...\n";
    iml.set_mode(nisps::IML<float>::Mode::Inference);

    // Now test: the network should have learned the mapping
    std::cout << "\nResults after training:\n";
    std::cout << std::fixed << std::setprecision(3);

    struct TestCase { float in[2]; float expected[2]; const char* label; };
    TestCase tests[] = {
        {{0.1f, 0.1f}, {0.1f, 0.9f}, "Trained point"},
        {{0.9f, 0.9f}, {0.9f, 0.1f}, "Trained point"},
        {{0.5f, 0.5f}, {0.5f, 0.5f}, "Trained point"},
        {{0.3f, 0.3f}, {0.0f, 0.0f}, "Interpolated"},  // Not trained on this
    };

    for (const auto& t : tests) {
        iml.set_input(0, t.in[0]);
        iml.set_input(1, t.in[1]);
        iml.process();
        const float* out = iml.get_outputs();
        std::cout << "  (" << t.in[0] << ", " << t.in[1] << ") -> ("
                  << out[0] << ", " << out[1] << ")";
        if (t.expected[0] > 0.0f) {
            std::cout << "  expected ~(" << t.expected[0] << ", " << t.expected[1] << ")";
        }
        std::cout << "  [" << t.label << "]\n";
    }
    std::cout << "\n";
}

void demo_interactive_workflow() {
    std::cout << "=== Demo 3: Interactive Workflow (simulated) ===\n\n";

    // This demonstrates the two-step save_example() workflow
    // used in the original MEMLNaut hardware
    nisps::IML<float> iml(1, 1, {4}, 2000, 1.0f, 0.001f);
    iml.set_logger([](const char* msg) {
        std::cout << "  [nisps] " << msg << "\n";
    });

    iml.set_mode(nisps::IML<float>::Mode::Training);

    // Simulate the interactive workflow:
    // 1. Set input position
    // 2. save_example() -> stops inference
    // 3. set_output() -> user positions the desired output
    // 4. save_example() -> stores the mapping

    struct Demo { float in; float out; };
    Demo demos[] = {{0.2f, 0.2f}, {0.5f, 0.5f}, {0.8f, 0.8f}};

    for (const auto& d : demos) {
        iml.set_input(0, d.in);
        iml.save_example();        // Step 1: stop inference
        iml.set_output(0, d.out);  // Step 2: user sets desired output
        iml.save_example();        // Step 3: store the mapping
        std::cout << "  Saved: " << d.in << " -> " << d.out << "\n";
    }

    std::cout << "\nSwitching to inference (triggers training)...\n";
    iml.set_mode(nisps::IML<float>::Mode::Inference);

    std::cout << std::fixed << std::setprecision(3);
    for (float x = 0.0f; x <= 1.0f; x += 0.25f) {
        iml.set_input(0, x);
        iml.process();
        std::cout << "  " << x << " -> " << iml.get_outputs()[0] << "\n";
    }
    std::cout << "\n";
}

int main() {
    std::cout << "\nNISPS Core - Parameter Mapping Examples\n";
    std::cout << std::string(45, '=') << "\n\n";

    demo_inference();
    demo_training();
    demo_interactive_workflow();

    return 0;
}
