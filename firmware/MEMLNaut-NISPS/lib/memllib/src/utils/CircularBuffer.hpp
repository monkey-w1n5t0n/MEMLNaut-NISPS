#ifndef MEMLLIB_UTILS_CIRCULAR_BUFFER_HPP
#define MEMLLIB_UTILS_CIRCULAR_BUFFER_HPP



template<typename T, size_t N>
class CircularBuffer {
private:
    static_assert((N & (N - 1)) == 0, "Buffer size must be a power of 2");
    T buffer[N];
    size_t head = 0;

public:
    // Initialize buffer with zeros
    CircularBuffer() : buffer() {
        // Zero-initialize all elements
        for (size_t i = 0; i < N; i++) {
            buffer[i] = T();
        }
    }

    // O(1) push operation - always overwrites oldest value
    inline void __attribute__((always_inline)) push(T value) {
        buffer[head] = value;
        head = (head + 1) & (N - 1);
    }

    // Copy contents to external array - no allocations
    inline void __attribute__((always_inline)) copyTo(T dest[]) const {
        for (size_t i = 0; i < N; i++) {
            dest[i] = buffer[(head + i) & (N - 1)];
        }
    }

    // Direct array-like access
    inline T& __attribute__((always_inline)) operator[](size_t index) {
        return buffer[(head + index) & (N - 1)];
    }

    inline const __attribute__((always_inline)) T& operator[](size_t index) const {
        return buffer[(head + index) & (N - 1)];
    }

    // Always returns N since buffer is always full
    inline constexpr size_t __attribute__((always_inline)) size() const {
        return N;
    }
};

#endif // MEMLLIB_UTILS_CIRCULAR_BUFFER_HPP
