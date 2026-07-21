#ifndef SHAREDMEM_HPP
#define SHAREDMEM_HPP

#include "pico/multicore.h"

#include <vector>

#define OLD_LISTENING_MODE    0

// Add your shared memory related declarations and includes here

namespace sharedMem {
#if OLD_LISTENING_MODE
    extern volatile float f0;
    extern volatile float f1;
    extern volatile float f2;
    extern volatile float f3;
#endif
}

template <typename T, size_t bufferSize>
class SharedBuffer {
public:
    SharedBuffer() {
        mutex_init(&mutex_);
        for (size_t i = 0; i < bufferSize; ++i) {
            buffer_[i] = T(); // Initialize buffer with default values
        }
    }

    inline void writeNonBlocking(const std::vector<T> &data)
    {
        writeNonBlocking(data.data(), data.size());
    }

    inline void writeNonBlocking(const T* data, size_t size)
    {
        if (size > bufferSize) {
            return; // Prevent overflow
        }
        if (mutex_try_enter(&mutex_, nullptr)) {
            for (size_t i = 0; i < size; ++i) {
                buffer_[i] = data[i];
            }
            mutex_exit(&mutex_);
        }
    }

    inline void readNonBlocking(std::vector<T> &data)
    {
        readNonBlocking(data.data(), data.size());
    }

    inline void readNonBlocking(T* data, size_t size)
    {
        if (size > bufferSize) {
            return; // Prevent overflow
        }
        if (mutex_try_enter(&mutex_, nullptr)) {
            for (size_t i = 0; i < size; ++i) {
                data[i] = buffer_[i];
            }
            mutex_exit(&mutex_);
        }
    }

protected:
    mutex_t mutex_;
    volatile T buffer_[bufferSize];
};

#endif // SHAREDMEM_HPP