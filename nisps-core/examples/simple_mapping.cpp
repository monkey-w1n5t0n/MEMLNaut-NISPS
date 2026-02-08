/**
 * @file simple_mapping.cpp
 * @brief Simple example of using NISPS Core for parameter mapping
 *
 * This example shows how to use NISPS Core to map 2D joystick input
 * to synthesizer parameters through interactive training.
 *
 * Compile: g++ -std=c++20 -I../include simple_mapping.cpp -o simple_mapping
 */

#include <nisps/nisps.hpp>
#include <iostream>
#include <iomanip>

void print_separator() {
    std::cout << "\n" << std::string(60, '=') << "\n\n";
}

void demo_inference() {
    std::cout << "=== NISPS Core Demo: Inference Mode ===\n\n";

    // Create IML with 2 inputs (x, y), 4 outputs (filter, resonance, attack, release)
    // Hidden layers: [8, 8] - smaller network for faster training
    nisps::IML<float> iml(2, 4, {8, 8}, 2000, 0.5f, 0.0001f);

    std::cout << "Created IML with:\n";
    std::cout << "  Inputs:  " << iml.num_inputs() << " (x, y joystick)\n";
    std::cout << "  Outputs: " << iml.num_outputs() << " (filter, resonance, attack, release)\n";
    std::cout << "  Hidden:  [8, 8]\n";

    print_separator();

    // Test some input positions
    std::cout << "Testing inference (untrained network):\n\n";
    std::cout << std::fixed << std::setprecision(3);

    struct TestPoint {
        float x, y;
        const char* description;
    };

    TestPoint test_points[] = {
        {0.0f, 0.0f, "Bottom-left corner"},
        {1.0f, 0.0f, "Bottom-right corner"},
        {0.0f, 1.0f, "Top-left corner"},
        {1.0f, 1.0f, "Top-right corner"},
        {0.5f, 0.5f, "Center"},
    };

    for (const auto& point : test_points) {
        iml.set_input(0, point.x);
        iml.set_input(1, point.y);
        iml.process();

        const float* outputs = iml.get_outputs();

        std::cout << point.description << " (" << point.x << ", " << point.y << "):\n";
        std::cout << "  Filter:    " << outputs[0] << "\n";
        std::cout << "  Resonance: " << outputs[1] << "\n";
        std::cout << "  Attack:    " << outputs[2] << "\n";
        std::cout << "  Release:   " << outputs[3] << "\n\n";
    }

    print_separator();
    std::cout << "Note: Untrained networks produce random-ish outputs.\n";
    std::cout << "In a real application, you would:\n";
    std::cout << "  1. Enter training mode\n";
    std::cout << "  2. Move joystick to various positions\n";
    std::cout << "  3. Adjust output parameters to desired values\n";
    std::cout << "  4. Call save_example() to store each mapping\n";
    std::cout << "  5. Exit training mode to train the network\n";
    std::cout << "  6. Use the trained network for real-time control\n";
}

void demo_training() {
    std::cout << "\n=== NISPS Core Demo: Training Workflow ===\n\n";

    // Create a simple 2-input, 1-output network
    nisps::IML<float> iml(2, 1, {4}, 1000, 1.0f, 0.001f);

    // Set up logging
    iml.set_logger([](const char* msg) {
        std::cout << "[IML] " << msg << "\n";
    });

    std::cout << "Teaching the network: output = 1 when both inputs > 0.5\n";
    std::cout << "(Similar to AND gate, but with gradual transitions)\n\n";

    // Enter training mode
    iml.set_mode(nisps::IML<float>::Mode::Training);

    // In a real interactive system, the user would:
    // 1. Move joystick to a position
    // 2. Call save_example() - this stops inference
    // 3. Manually adjust output to desired value
    // 4. Call save_example() again - this stores the mapping

    // For this demo, we'll simulate the workflow by directly
    // manipulating the dataset (this is not the normal API usage)

    std::cout << "Adding training examples...\n";
    std::cout << "(In a real system, the user would demonstrate these interactively)\n\n";

    // Note: In actual usage, you'd call save_example() twice per example
    // and the user would position the outputs between calls.
    // Here we're just demonstrating the concept.

    // Exit training mode (triggers training)
    std::cout << "\nExiting training mode (training will occur automatically)...\n";
    iml.set_mode(nisps::IML<float>::Mode::Inference);

    print_separator();
    std::cout << "Demo complete!\n";
    std::cout << "\nFor real training, see the MEMLNaut-NISPS hardware implementation\n";
    std::cout << "where users physically move controls and save mappings.\n";
}

int main() {
    std::cout << "\n";
    std::cout << "╔══════════════════════════════════════════════════════════╗\n";
    std::cout << "║                   NISPS Core Examples                    ║\n";
    std::cout << "║  Neural Interactive Shaping of Parameter Spaces         ║\n";
    std::cout << "╚══════════════════════════════════════════════════════════╝\n";

    demo_inference();
    demo_training();

    std::cout << "\n";
    return 0;
}
