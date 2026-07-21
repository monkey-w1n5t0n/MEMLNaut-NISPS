#include "Maths.hpp"


int where(const std::vector<size_t>& integers, size_t integer) {
    const size_t size = integers.size();
    for (size_t i = 0; i < size; ++i) {
        if (integers[i] == integer) {
            return static_cast<int>(i);
        }
    }
    return -1;
}


namespace Tests {

// Tolerance for floating point comparisons
constexpr float EPSILON = 1e-6f;

// Helper to check if two float values are equal within a small epsilon
static bool floatEquals(float a, float b, float epsilon = EPSILON) {
    return fabsf(a - b) < epsilon;
}

// Unit tests for the median absolute deviation functions
bool testMedianAbsoluteDeviation() {
    bool allTestsPassed = true;
    const int TEST_SIZE = 32;  // Size for medianAbsoluteDeviationFast32

    // Test case 1: Normal distribution data
    {
        DEBUG_PRINTLN("Test case 1: Normal distribution data");
        float testData[TEST_SIZE] = {5.1f, 3.7f, 8.2f, 4.9f, 6.3f, 7.0f, 2.5f, 9.1f,
                                    5.4f, 6.8f, 7.2f, 4.3f, 3.6f, 8.9f, 5.5f, 6.0f,
                                    5.1f, 3.7f, 8.2f, 4.9f, 6.3f, 7.0f, 2.5f, 9.1f,
                                    5.4f, 6.8f, 7.2f, 4.3f, 3.6f, 8.9f, 5.5f, 6.0f};

        // Create copy for the regular MAD function
        std::vector<float> testVector(testData, testData + TEST_SIZE);

        // Calculate MAD using both methods
        float madRegular = medianAbsoluteDeviation(testVector);
        float madFast = medianAbsoluteDeviationFast32(testData);

        DEBUG_PRINTF("Regular MAD: %.6f, Fast MAD: %.6f\n", madRegular, madFast);

        if (!floatEquals(madRegular, madFast)) {
            DEBUG_PRINTLN("FAIL: MAD values don't match!");
            allTestsPassed = false;
        }
    }

    // Test case 2: Already sorted data
    {
        DEBUG_PRINTLN("Test case 2: Already sorted data");
        float testData[TEST_SIZE] = {1.0f, 2.0f, 3.0f, 4.0f, 5.0f, 6.0f, 7.0f, 8.0f,
                                    9.0f, 10.0f, 11.0f, 12.0f, 13.0f, 14.0f, 15.0f, 16.0f,
                                    17.0f, 18.0f, 19.0f, 20.0f, 21.0f, 22.0f, 23.0f, 24.0f,
                                    25.0f, 26.0f, 27.0f, 28.0f, 29.0f, 30.0f, 31.0f, 32.0f};

        std::vector<float> testVector(testData, testData + TEST_SIZE);
        float expectedMAD = 8.0f; // For 1-32, median is 16.5, MAD should be 8.0

        float madRegular = medianAbsoluteDeviation(testVector);
        float madFast = medianAbsoluteDeviationFast32(testData);

        DEBUG_PRINTF("Regular MAD: %.6f, Fast MAD: %.6f, Expected: %.6f\n", madRegular, madFast, expectedMAD);

        if (!floatEquals(madRegular, madFast) || !floatEquals(madRegular, expectedMAD)) {
            DEBUG_PRINTLN("FAIL: MAD values don't match expected value for sorted data!");
            allTestsPassed = false;
        }
    }

    // Test case 3: Reverse sorted data
    {
        DEBUG_PRINTLN("Test case 3: Reverse sorted data");
        float testData[TEST_SIZE] = {32.0f, 31.0f, 30.0f, 29.0f, 28.0f, 27.0f, 26.0f, 25.0f,
                                    24.0f, 23.0f, 22.0f, 21.0f, 20.0f, 19.0f, 18.0f, 17.0f,
                                    16.0f, 15.0f, 14.0f, 13.0f, 12.0f, 11.0f, 10.0f, 9.0f,
                                    8.0f, 7.0f, 6.0f, 5.0f, 4.0f, 3.0f, 2.0f, 1.0f};

        std::vector<float> testVector(testData, testData + TEST_SIZE);
        float expectedMAD = 8.0f; // Same as sorted case, just reversed

        float madRegular = medianAbsoluteDeviation(testVector);
        float madFast = medianAbsoluteDeviationFast32(testData);

        DEBUG_PRINTF("Regular MAD: %.6f, Fast MAD: %.6f, Expected: %.6f\n", madRegular, madFast, expectedMAD);

        if (!floatEquals(madRegular, madFast) || !floatEquals(madRegular, expectedMAD)) {
            DEBUG_PRINTLN("FAIL: MAD values don't match expected value for reverse sorted data!");
            allTestsPassed = false;
        }
    }

    // Test case 4: Constant data (all values the same)
    {
        DEBUG_PRINTLN("Test case 4: Constant data");
        float testData[TEST_SIZE];
        for (int i = 0; i < TEST_SIZE; i++) {
            testData[i] = 5.0f;
        }

        std::vector<float> testVector(testData, testData + TEST_SIZE);
        float expectedMAD = 0.0f; // All deviations are zero

        float madRegular = medianAbsoluteDeviation(testVector);
        float madFast = medianAbsoluteDeviationFast32(testData);

        DEBUG_PRINTF("Regular MAD: %.6f, Fast MAD: %.6f, Expected: %.6f\n", madRegular, madFast, expectedMAD);

        if (!floatEquals(madRegular, expectedMAD) || !floatEquals(madFast, expectedMAD)) {
            DEBUG_PRINTLN("FAIL: MAD for constant data should be 0!");
            allTestsPassed = false;
        }
    }

    // Test case 5: Extreme values
    {
        DEBUG_PRINTLN("Test case 5: Extreme values");
        float testData[TEST_SIZE] = {1e30f, -1e30f, 1e-30f, -1e-30f, 1e20f, -1e20f, 1e-20f, -1e-20f,
                                    1e10f, -1e10f, 1e-10f, -1e-10f, 1000.0f, -1000.0f, 0.001f, -0.001f,
                                    1e30f, -1e30f, 1e-30f, -1e-30f, 1e20f, -1e20f, 1e-20f, -1e-20f,
                                    1e10f, -1e10f, 1e-10f, -1e-10f, 1000.0f, -1000.0f, 0.001f, -0.001f};

        std::vector<float> testVector(testData, testData + TEST_SIZE);

        float madRegular = medianAbsoluteDeviation(testVector);
        float madFast = medianAbsoluteDeviationFast32(testData);

        DEBUG_PRINTF("Regular MAD: %.6g, Fast MAD: %.6g\n", madRegular, madFast);

        // Allow larger epsilon for extreme values due to potential numerical issues
        if (!floatEquals(madRegular, madFast, 1e-5f * fabsf(madRegular))) {
            DEBUG_PRINTLN("FAIL: MAD values don't match for extreme values!");
            allTestsPassed = false;
        }
    }

    // Test case 6: Negative values
    {
        DEBUG_PRINTLN("Test case 6: Negative values");
        float testData[TEST_SIZE] = {-5.1f, -3.7f, -8.2f, -4.9f, -6.3f, -7.0f, -2.5f, -9.1f,
                                    -5.4f, -6.8f, -7.2f, -4.3f, -3.6f, -8.9f, -5.5f, -6.0f,
                                    -5.1f, -3.7f, -8.2f, -4.9f, -6.3f, -7.0f, -2.5f, -9.1f,
                                    -5.4f, -6.8f, -7.2f, -4.3f, -3.6f, -8.9f, -5.5f, -6.0f};

        std::vector<float> testVector(testData, testData + TEST_SIZE);

        float madRegular = medianAbsoluteDeviation(testVector);
        float madFast = medianAbsoluteDeviationFast32(testData);

        DEBUG_PRINTF("Regular MAD: %.6f, Fast MAD: %.6f\n", madRegular, madFast);

        if (!floatEquals(madRegular, madFast)) {
            DEBUG_PRINTLN("FAIL: MAD values don't match for negative values!");
            allTestsPassed = false;
        }
    }

    // Test case 7: Alternating values
    {
        DEBUG_PRINTLN("Test case 7: Alternating values");
        float testData[TEST_SIZE];
        for (int i = 0; i < TEST_SIZE; i++) {
            testData[i] = (i % 2 == 0) ? 1.0f : 10.0f;
        }

        std::vector<float> testVector(testData, testData + TEST_SIZE);
        float expectedMAD = 4.5f; // Median is 5.5, deviations are 4.5 for all values

        float madRegular = medianAbsoluteDeviation(testVector);
        float madFast = medianAbsoluteDeviationFast32(testData);

        DEBUG_PRINTF("Regular MAD: %.6f, Fast MAD: %.6f, Expected: %.6f\n", madRegular, madFast, expectedMAD);

        if (!floatEquals(madRegular, madFast) || !floatEquals(madRegular, expectedMAD)) {
            DEBUG_PRINTLN("FAIL: MAD values don't match expected value for alternating values!");
            allTestsPassed = false;
        }
    }

    // Test case 8: Nearly identical values (precision test)
    {
        DEBUG_PRINTLN("Test case 8: Nearly identical values");
        float baseVal = 5.0f;
        float testData[TEST_SIZE];

        for (int i = 0; i < TEST_SIZE; i++) {
            testData[i] = baseVal + (i * 0.0001f); // Small increments
        }

        std::vector<float> testVector(testData, testData + TEST_SIZE);

        float madRegular = medianAbsoluteDeviation(testVector);
        float madFast = medianAbsoluteDeviationFast32(testData);

        DEBUG_PRINTF("Regular MAD: %.8f, Fast MAD: %.8f\n", madRegular, madFast);

        if (!floatEquals(madRegular, madFast, EPSILON)) {
            DEBUG_PRINTLN("FAIL: MAD values don't match for nearly identical values!");
            allTestsPassed = false;
        }
    }

    if (allTestsPassed) {
        DEBUG_PRINTLN("All median absolute deviation tests PASSED!");

        // Performance profiling
        DEBUG_PRINTLN("\n=== Performance Profiling ===");
        const int PROFILE_ITERATIONS = 1000;

        // Test data for profiling
        float profileData[TEST_SIZE] = {5.1f, 3.7f, 8.2f, 4.9f, 6.3f, 7.0f, 2.5f, 9.1f,
                                       5.4f, 6.8f, 7.2f, 4.3f, 3.6f, 8.9f, 5.5f, 6.0f,
                                       5.1f, 3.7f, 8.2f, 4.9f, 6.3f, 7.0f, 2.5f, 9.1f,
                                       5.4f, 6.8f, 7.2f, 4.3f, 3.6f, 8.9f, 5.5f, 6.0f};

        // Profile regular MAD function
        uint32_t startTime = time_us_32();
        for (int i = 0; i < PROFILE_ITERATIONS; i++) {
            std::vector<float> testVector(profileData, profileData + TEST_SIZE);
            volatile float result = medianAbsoluteDeviation(testVector);
            (void)result; // Prevent optimization
        }
        uint32_t regularTime = time_us_32() - startTime;

        // Profile fast MAD function
        startTime = time_us_32();
        for (int i = 0; i < PROFILE_ITERATIONS; i++) {
            volatile float result = medianAbsoluteDeviationFast32(profileData);
            (void)result; // Prevent optimization
        }
        uint32_t fastTime = time_us_32() - startTime;

        // Calculate averages and percentage difference
        float avgRegular = (float)regularTime / PROFILE_ITERATIONS;
        float avgFast = (float)fastTime / PROFILE_ITERATIONS;

        DEBUG_PRINTF("Regular MAD average time: %.2f µs\n", avgRegular);
        DEBUG_PRINTF("Fast MAD average time: %.2f µs\n", avgFast);

        if (avgFast < avgRegular) {
            float speedup = (avgRegular / avgFast - 1.0f) * 100.0f;
            DEBUG_PRINTF("Fast MAD is %.1f%% faster than regular MAD\n", speedup);
        } else {
            float slowdown = (avgFast / avgRegular - 1.0f) * 100.0f;
            DEBUG_PRINTF("Fast MAD is %.1f%% slower than regular MAD\n", slowdown);
        }
    } else {
        DEBUG_PRINTLN("Some median absolute deviation tests FAILED!");
    }

    return allTestsPassed;
}

// Unit tests for the mean absolute deviation function
bool testMeanAbsoluteDeviation() {
    bool allTestsPassed = true;
    const int TEST_SIZE = 32;  // Size for comparison with fast median

    DEBUG_PRINTLN("\n=== Mean Absolute Deviation Tests ===");

    // Test case 1: Normal distribution data
    {
        DEBUG_PRINTLN("Test case 1: Normal distribution data");
        float testData[TEST_SIZE] = {5.1f, 3.7f, 8.2f, 4.9f, 6.3f, 7.0f, 2.5f, 9.1f,
                                    5.4f, 6.8f, 7.2f, 4.3f, 3.6f, 8.9f, 5.5f, 6.0f,
                                    5.1f, 3.7f, 8.2f, 4.9f, 6.3f, 7.0f, 2.5f, 9.1f,
                                    5.4f, 6.8f, 7.2f, 4.3f, 3.6f, 8.9f, 5.5f, 6.0f};

        float meanAD = meanAbsoluteDeviation(testData, TEST_SIZE);
        DEBUG_PRINTF("Mean AD: %.6f\n", meanAD);

        // Basic sanity check - should be positive
        if (meanAD <= 0.0f) {
            DEBUG_PRINTLN("FAIL: Mean AD should be positive!");
            allTestsPassed = false;
        }
    }

    // Test case 2: Constant data (all values the same)
    {
        DEBUG_PRINTLN("Test case 2: Constant data");
        float testData[TEST_SIZE];
        for (int i = 0; i < TEST_SIZE; i++) {
            testData[i] = 5.0f;
        }

        float meanAD = meanAbsoluteDeviation(testData, TEST_SIZE);
        float expectedMAD = 0.0f; // All deviations are zero

        DEBUG_PRINTF("Mean AD: %.6f, Expected: %.6f\n", meanAD, expectedMAD);

        if (!floatEquals(meanAD, expectedMAD)) {
            DEBUG_PRINTLN("FAIL: Mean AD for constant data should be 0!");
            allTestsPassed = false;
        }
    }

    // Test case 3: Known values test
    {
        DEBUG_PRINTLN("Test case 3: Known values test");
        float testData[4] = {1.0f, 2.0f, 3.0f, 4.0f};
        // Mean = 2.5, deviations = {1.5, 0.5, 0.5, 1.5}, mean deviation = 1.0
        float expectedMAD = 1.0f;

        float meanAD = meanAbsoluteDeviation(testData, 4);

        DEBUG_PRINTF("Mean AD: %.6f, Expected: %.6f\n", meanAD, expectedMAD);

        if (!floatEquals(meanAD, expectedMAD)) {
            DEBUG_PRINTLN("FAIL: Mean AD doesn't match expected value!");
            allTestsPassed = false;
        }
    }

    // Test case 4: Negative values
    {
        DEBUG_PRINTLN("Test case 4: Negative values");
        float testData[TEST_SIZE] = {-5.1f, -3.7f, -8.2f, -4.9f, -6.3f, -7.0f, -2.5f, -9.1f,
                                    -5.4f, -6.8f, -7.2f, -4.3f, -3.6f, -8.9f, -5.5f, -6.0f,
                                    -5.1f, -3.7f, -8.2f, -4.9f, -6.3f, -7.0f, -2.5f, -9.1f,
                                    -5.4f, -6.8f, -7.2f, -4.3f, -3.6f, -8.9f, -5.5f, -6.0f};

        float meanAD = meanAbsoluteDeviation(testData, TEST_SIZE);

        DEBUG_PRINTF("Mean AD: %.6f\n", meanAD);

        if (meanAD <= 0.0f) {
            DEBUG_PRINTLN("FAIL: Mean AD should be positive for negative values!");
            allTestsPassed = false;
        }
    }

    // Test case 5: Single element
    {
        DEBUG_PRINTLN("Test case 5: Single element");
        float testData[1] = {42.0f};
        float expectedMAD = 0.0f; // Deviation from itself is zero

        float meanAD = meanAbsoluteDeviation(testData, 1);

        DEBUG_PRINTF("Mean AD: %.6f, Expected: %.6f\n", meanAD, expectedMAD);

        if (!floatEquals(meanAD, expectedMAD)) {
            DEBUG_PRINTLN("FAIL: Mean AD for single element should be 0!");
            allTestsPassed = false;
        }
    }

    // Test case 6: Two elements
    {
        DEBUG_PRINTLN("Test case 6: Two elements");
        float testData[2] = {1.0f, 3.0f};
        // Mean = 2.0, deviations = {1.0, 1.0}, mean deviation = 1.0
        float expectedMAD = 1.0f;

        float meanAD = meanAbsoluteDeviation(testData, 2);

        DEBUG_PRINTF("Mean AD: %.6f, Expected: %.6f\n", meanAD, expectedMAD);

        if (!floatEquals(meanAD, expectedMAD)) {
            DEBUG_PRINTLN("FAIL: Mean AD for two elements doesn't match expected!");
            allTestsPassed = false;
        }
    }

    // Performance comparison with median AD
    if (allTestsPassed) {
        DEBUG_PRINTLN("\n=== Performance Comparison: Mean AD vs Median AD ===");
        const int PROFILE_ITERATIONS = 1000;

        // Test data for profiling
        float profileData[TEST_SIZE] = {5.1f, 3.7f, 8.2f, 4.9f, 6.3f, 7.0f, 2.5f, 9.1f,
                                       5.4f, 6.8f, 7.2f, 4.3f, 3.6f, 8.9f, 5.5f, 6.0f,
                                       5.1f, 3.7f, 8.2f, 4.9f, 6.3f, 7.0f, 2.5f, 9.1f,
                                       5.4f, 6.8f, 7.2f, 4.3f, 3.6f, 8.9f, 5.5f, 6.0f};

        // Profile Mean AD function
        uint32_t startTime = time_us_32();
        for (int i = 0; i < PROFILE_ITERATIONS; i++) {
            volatile float result = meanAbsoluteDeviation(profileData, TEST_SIZE);
            (void)result; // Prevent optimization
        }
        uint32_t meanTime = time_us_32() - startTime;

        // Profile Median AD function
        startTime = time_us_32();
        for (int i = 0; i < PROFILE_ITERATIONS; i++) {
            volatile float result = medianAbsoluteDeviationFast32(profileData);
            (void)result; // Prevent optimization
        }
        uint32_t medianTime = time_us_32() - startTime;

        // Calculate averages and percentage difference
        float avgMean = (float)meanTime / PROFILE_ITERATIONS;
        float avgMedian = (float)medianTime / PROFILE_ITERATIONS;

        DEBUG_PRINTF("Mean AD average time: %.2f µs\n", avgMean);
        DEBUG_PRINTF("Median AD average time: %.2f µs\n", avgMedian);

        if (avgMean < avgMedian) {
            float speedup = (avgMedian / avgMean - 1.0f) * 100.0f;
            DEBUG_PRINTF("Mean AD is %.1f%% faster than Median AD\n", speedup);
        } else {
            float slowdown = (avgMean / avgMedian - 1.0f) * 100.0f;
            DEBUG_PRINTF("Mean AD is %.1f%% slower than Median AD\n", slowdown);
        }

        // Show actual computed values for comparison
        float meanResult = meanAbsoluteDeviation(profileData, TEST_SIZE);
        float medianResult = medianAbsoluteDeviationFast32(profileData);
        DEBUG_PRINTF("Mean AD result: %.6f, Median AD result: %.6f\n", meanResult, medianResult);
    }

    if (allTestsPassed) {
        DEBUG_PRINTLN("All mean absolute deviation tests PASSED!");
    } else {
        DEBUG_PRINTLN("Some mean absolute deviation tests FAILED!");
    }

    return allTestsPassed;
}

}