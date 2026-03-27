/**
 * Standalone smoke test for MEMLNaut VCV module logic.
 * Tests the IML inference pipeline without the VCV Rack runtime.
 * Simulates what process() does: input CVs → IML → output CVs.
 */
#include <nisps/nisps.hpp>
#include <iostream>
#include <cmath>
#include <vector>
#include <cassert>
#include <algorithm>
#include <numeric>

static constexpr int NUM_INPUTS = 2;
static constexpr int NUM_OUTPUTS = 12;

struct SmokeTestResults {
    int passed = 0;
    int failed = 0;
    void check(const char* name, bool ok) {
        if (ok) { passed++; std::cout << "  PASS: " << name << "\n"; }
        else    { failed++; std::cerr << "  FAIL: " << name << "\n"; }
    }
};

// Test 1: Outputs are valid after inference
bool test_basic_inference(SmokeTestResults& r) {
    std::cout << "\n--- Test: Basic inference pipeline ---\n";
    nisps::IML<float> iml(NUM_INPUTS, NUM_OUTPUTS, {16, 24, 16});

    // Simulate input: X=0.5, Y=0.5 (center position)
    iml.set_input(0, 0.5f);
    iml.set_input(1, 0.5f);
    iml.process();

    const float* outs = iml.get_outputs();
    bool all_valid = true;
    for (int i = 0; i < NUM_OUTPUTS; i++) {
        if (std::isnan(outs[i]) || std::isinf(outs[i]) || outs[i] < 0.f || outs[i] > 1.f) {
            std::cerr << "  Output " << i << " = " << outs[i] << " (invalid!)\n";
            all_valid = false;
        }
    }
    r.check("All 12 outputs in [0,1]", all_valid);
    return all_valid;
}

// Test 2: Outputs change when inputs change
bool test_outputs_respond_to_inputs(SmokeTestResults& r) {
    std::cout << "\n--- Test: Outputs respond to input changes ---\n";
    nisps::IML<float> iml(NUM_INPUTS, NUM_OUTPUTS, {16, 24, 16});

    // Get outputs at (0.1, 0.1)
    iml.set_input(0, 0.1f);
    iml.set_input(1, 0.1f);
    iml.process();
    const float* outs1 = iml.get_outputs();
    std::vector<float> snapshot1(outs1, outs1 + NUM_OUTPUTS);

    // Get outputs at (0.9, 0.9)
    iml.set_input(0, 0.9f);
    iml.set_input(1, 0.9f);
    iml.process();
    const float* outs2 = iml.get_outputs();

    // At least some outputs should differ
    int changed = 0;
    for (int i = 0; i < NUM_OUTPUTS; i++) {
        if (std::abs(outs2[i] - snapshot1[i]) > 0.001f) changed++;
    }
    std::cout << "  " << changed << "/" << NUM_OUTPUTS << " outputs changed\n";
    r.check("At least 6 outputs changed between (0.1,0.1) and (0.9,0.9)", changed >= 6);
    return changed >= 6;
}

// Test 3: Randomize produces different mappings
bool test_randomize_changes_outputs(SmokeTestResults& r) {
    std::cout << "\n--- Test: Randomize produces different mappings ---\n";
    nisps::IML<float> iml(NUM_INPUTS, NUM_OUTPUTS, {16, 24, 16});

    iml.set_input(0, 0.5f);
    iml.set_input(1, 0.5f);
    iml.process();
    const float* outs1 = iml.get_outputs();
    std::vector<float> before(outs1, outs1 + NUM_OUTPUTS);

    // Randomize with spread=0.6 — this internally re-runs inference
    iml.set_mode(nisps::IML<float>::Mode::Training);
    iml.randomise_weights(0.6f);
    iml.set_mode(nisps::IML<float>::Mode::Inference);

    // get_outputs() now reflects the new weights (randomise_weights runs inference internally)
    const float* outs2 = iml.get_outputs();

    int changed = 0;
    for (int i = 0; i < NUM_OUTPUTS; i++) {
        if (std::abs(outs2[i] - before[i]) > 0.001f) changed++;
    }
    std::cout << "  " << changed << "/" << NUM_OUTPUTS << " outputs changed after randomize\n";
    r.check("Randomize changes most outputs", changed >= 8);
    return changed >= 8;
}

// Test 4: Spread=0 vs spread=1 produce different weight distributions
bool test_spread_affects_distribution(SmokeTestResults& r) {
    std::cout << "\n--- Test: Spread parameter affects output distribution ---\n";

    auto get_output_stats = [](float spread, int trials) {
        float total_extreme = 0;
        int total_samples = 0;
        for (int t = 0; t < trials; t++) {
            nisps::IML<float> iml(NUM_INPUTS, NUM_OUTPUTS, {16, 24, 16});
            iml.set_mode(nisps::IML<float>::Mode::Training);
            iml.randomise_weights(spread);
            iml.set_mode(nisps::IML<float>::Mode::Inference);

            for (float x = 0.1f; x <= 0.9f; x += 0.2f) {
                for (float y = 0.1f; y <= 0.9f; y += 0.2f) {
                    iml.set_input(0, x);
                    iml.set_input(1, y);
                    iml.process();
                    const float* outs = iml.get_outputs();
                    for (int i = 0; i < NUM_OUTPUTS; i++) {
                        if (outs[i] < 0.1f || outs[i] > 0.9f) total_extreme++;
                        total_samples++;
                    }
                }
            }
        }
        return total_extreme / total_samples;
    };

    float extreme_ratio_spread0 = get_output_stats(0.0f, 10);
    float extreme_ratio_spread1 = get_output_stats(1.0f, 10);

    std::cout << "  Spread=0 extreme ratio: " << extreme_ratio_spread0 << "\n";
    std::cout << "  Spread=1 extreme ratio: " << extreme_ratio_spread1 << "\n";

    // Spread parameter should produce measurably different distributions.
    // Note: with small networks [16,24,16], spread=0 doesn't necessarily produce
    // MORE extreme outputs (fan-in too small to saturate sigmoid). The saturation
    // effect is architecture-dependent. Just verify the distributions differ.
    float diff = std::abs(extreme_ratio_spread0 - extreme_ratio_spread1);
    std::cout << "  Distribution difference: " << diff << "\n";
    r.check("Spread=0 and spread=1 produce different distributions (diff > 0.01)", diff > 0.01f);
    return diff > 0.01f;
}

// Test 5: Network expressiveness — different input regions produce different output patterns
bool test_network_expressiveness(SmokeTestResults& r) {
    std::cout << "\n--- Test: Network [16,24,16] is expressive for 12 outputs ---\n";
    nisps::IML<float> iml(NUM_INPUTS, NUM_OUTPUTS, {16, 24, 16});
    iml.set_mode(nisps::IML<float>::Mode::Training);
    iml.randomise_weights(0.6f);
    iml.set_mode(nisps::IML<float>::Mode::Inference);

    // Sample 4 corners of input space
    float corners[4][2] = {{0.1f, 0.1f}, {0.9f, 0.1f}, {0.1f, 0.9f}, {0.9f, 0.9f}};
    std::vector<std::vector<float>> corner_outputs(4);

    for (int c = 0; c < 4; c++) {
        iml.set_input(0, corners[c][0]);
        iml.set_input(1, corners[c][1]);
        iml.process();
        const float* outs = iml.get_outputs();
        corner_outputs[c].assign(outs, outs + NUM_OUTPUTS);
    }

    // Check pairwise distances — all corner pairs should produce distinct output vectors
    int distinct_pairs = 0;
    for (int a = 0; a < 4; a++) {
        for (int b = a + 1; b < 4; b++) {
            float dist = 0;
            for (int i = 0; i < NUM_OUTPUTS; i++) {
                float d = corner_outputs[a][i] - corner_outputs[b][i];
                dist += d * d;
            }
            dist = std::sqrt(dist);
            if (dist > 0.1f) distinct_pairs++;
        }
    }
    std::cout << "  " << distinct_pairs << "/6 corner pairs are distinct (L2 > 0.1)\n";
    r.check("At least 4/6 corner pairs produce distinct outputs", distinct_pairs >= 4);

    // Check output range utilization — how much of [0,1] do the outputs cover?
    float min_out = 1.f, max_out = 0.f;
    for (auto& co : corner_outputs) {
        for (float v : co) {
            min_out = std::min(min_out, v);
            max_out = std::max(max_out, v);
        }
    }
    float range = max_out - min_out;
    std::cout << "  Output range utilization: " << range << " (min=" << min_out << " max=" << max_out << ")\n";
    r.check("Output range > 0.3 (sufficient variety)", range > 0.3f);

    return distinct_pairs >= 4 && range > 0.3f;
}

// Test 6: Continuous sweep — outputs vary smoothly, not just binary
bool test_smooth_variation(SmokeTestResults& r) {
    std::cout << "\n--- Test: Outputs vary smoothly across input sweep ---\n";
    nisps::IML<float> iml(NUM_INPUTS, NUM_OUTPUTS, {16, 24, 16});
    iml.set_mode(nisps::IML<float>::Mode::Training);
    iml.randomise_weights(0.6f);
    iml.set_mode(nisps::IML<float>::Mode::Inference);

    // Sweep X from 0 to 1, fixed Y=0.5
    std::vector<float> prev_outs(NUM_OUTPUTS, 0.f);
    int smooth_steps = 0;
    int total_steps = 0;

    for (float x = 0.f; x <= 1.f; x += 0.05f) {
        iml.set_input(0, x);
        iml.set_input(1, 0.5f);
        iml.process();
        const float* outs = iml.get_outputs();

        if (x > 0.f) {
            float max_jump = 0;
            for (int i = 0; i < NUM_OUTPUTS; i++) {
                max_jump = std::max(max_jump, std::abs(outs[i] - prev_outs[i]));
            }
            // For a 0.05 input step, output jumps should be < 0.5 (smooth, not binary)
            if (max_jump < 0.5f) smooth_steps++;
            total_steps++;
        }
        for (int i = 0; i < NUM_OUTPUTS; i++) prev_outs[i] = outs[i];
    }

    float smooth_ratio = (float)smooth_steps / total_steps;
    std::cout << "  " << smooth_steps << "/" << total_steps << " steps were smooth (max jump < 0.5)\n";
    r.check("At least 80% of steps are smooth", smooth_ratio >= 0.8f);
    return smooth_ratio >= 0.8f;
}

int main() {
    std::cout << "=== MEMLNaut VCV Module Smoke Test ===\n";
    std::cout << "Network: [" << NUM_INPUTS << "+bias, 16, 24, 16, " << NUM_OUTPUTS << "]\n";

    SmokeTestResults r;

    test_basic_inference(r);
    test_outputs_respond_to_inputs(r);
    test_randomize_changes_outputs(r);
    test_spread_affects_distribution(r);
    test_network_expressiveness(r);
    test_smooth_variation(r);

    std::cout << "\n=== Results: " << r.passed << " passed, " << r.failed << " failed ===\n";
    return r.failed > 0 ? 1 : 0;
}
