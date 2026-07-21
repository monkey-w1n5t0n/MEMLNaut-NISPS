#ifndef __MATHS_HPP__
#define __MATHS_HPP__

#include <vector>
#include <algorithm>
#include <cmath>
#include <cstring>
#include "../PicoDefs.hpp"
#include <Arduino.h>


inline float medianAbsoluteDeviation(std::vector<float>& data) noexcept {
    const size_t N = data.size();

    // Find median
    const size_t mid = N >> 1;
    std::nth_element(data.begin(), data.begin() + mid, data.end());

    float median;
    if (!(N & 0x1)) {
        // Even size: need both middle elements
        std::nth_element(data.begin(), data.begin() + mid - 1, data.begin() + mid);
        median = (data[mid - 1] + data[mid]) * 0.5f;
    } else {
        // Odd size: just the middle element
        median = data[mid];
    }

    // Convert to absolute deviations in-place
    for (auto& val : data) {
        val = std::abs(val - median);
    }

    // Find median of absolute deviations
    std::nth_element(data.begin(), data.begin() + mid, data.end());

    if (!(N & 0x1)) {
        std::nth_element(data.begin(), data.begin() + mid - 1, data.begin() + mid);
        return (data[mid - 1] + data[mid]) * 0.5f;
    } else {
        return data[mid];
    }
}

inline int __attribute__((always_inline)) partition(float* arr, int left, int right) {
    float pivot = arr[right];
    int i = left;

    for (int j = left; j < right; j++) {
        if (arr[j] <= pivot) {
            float temp = arr[i];
            arr[i] = arr[j];
            arr[j] = temp;
            i++;
        }
    }

    float temp = arr[i];
    arr[i] = arr[right];
    arr[right] = temp;

    return i;
}

// Quick select median helper function - O(n) average time complexity
inline float __attribute__((always_inline)) quickSelectMedian(float* arr, int n) {
    if (n % 2 == 1) {
        // Odd size - find the middle element
        int k = n / 2;
        int left = 0;
        int right = n - 1;

        while (left < right) {
            int pivotIndex = partition(arr, left, right);
            if (pivotIndex == k) {
                break;
            } else if (pivotIndex < k) {
                left = pivotIndex + 1;
            } else {
                right = pivotIndex - 1;
            }
        }
        return arr[k];
    } else {
        // Even size - need to find two middle elements and average them
        int k1 = n / 2 - 1;
        int k2 = n / 2;

        // Find k1-th element (lower middle)
        int left = 0;
        int right = n - 1;
        while (left < right) {
            int pivotIndex = partition(arr, left, right);
            if (pivotIndex == k1) {
                break;
            } else if (pivotIndex < k1) {
                left = pivotIndex + 1;
            } else {
                right = pivotIndex - 1;
            }
        }
        float val1 = arr[k1];

        // Find k2-th element (upper middle) in the remaining array
        left = k1 + 1;
        right = n - 1;
        float val2 = arr[k2];
        for (int i = left; i <= right; i++) {
            if (arr[i] < val2) {
                val2 = arr[i];
            }
        }

        return (val1 + val2) * 0.5f;
    }
}

inline float __attribute__((always_inline)) __not_in_flash_func(medianAbsoluteDeviationFast32)(const float* data) {
    float __attribute__((aligned(16))) work[32];

    // Copy data to work buffer
    memcpy(work, data, 32 * sizeof(float));

    // Use median-of-medians approach for O(n) selection
    float median = quickSelectMedian(work, 32);

    // Calculate absolute deviations
    for (int i = 0; i < 32; i++) {
        work[i] = fabsf(data[i] - median);
    }

    // Find median of absolute deviations
    return quickSelectMedian(work, 32);
}

// Efficient Mean Absolute Deviation function - O(n) complexity
inline float __attribute__((always_inline)) __not_in_flash_func(meanAbsoluteDeviation)(const float* data, int size) {
    // Calculate mean in first pass
    float sum = 0.0f;

    // Unroll loop for better performance on RP2350
    int i = 0;
    for (; i < size - 3; i += 4) {
        sum += data[i] + data[i + 1] + data[i + 2] + data[i + 3];
    }

    // Handle remaining elements
    for (; i < size; i++) {
        sum += data[i];
    }

    float mean = sum / size;

    // Calculate mean of absolute deviations in second pass
    sum = 0.0f;
    i = 0;
    for (; i < size - 3; i += 4) {
        sum += fabsf(data[i] - mean) + fabsf(data[i + 1] - mean) +
               fabsf(data[i + 2] - mean) + fabsf(data[i + 3] - mean);
    }

    // Handle remaining elements
    for (; i < size; i++) {
        sum += fabsf(data[i] - mean);
    }

    return sum / size;
}

int where(const std::vector<size_t>& integers, size_t integer);


namespace Tests {

bool testMedianAbsoluteDeviation();
bool testMeanAbsoluteDeviation();

} // namespace Tests

#endif  // __MATHS_HPP__
