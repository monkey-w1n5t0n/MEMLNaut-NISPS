#ifndef __MEML_PICO_HPP__
#define __MEML_PICO_HPP__

#include "pico.h"
#include <memory>

#define AUDIO_FUNC(x)    __not_in_flash_func(x)  ///< Macro to make audio function load from mem
#define AUDIO_MEM    __not_in_flash("audio")  ///< Macro to make variable load from mem
//#define AUDIO_MEM_2  __not_in_flash("audio2")
#define APP_SRAM __not_in_flash("app")
#define ML_BUFFER_MEM    __attribute__((section(".scratch_x")))
#define AUDIO_BUFFER_MEM    __attribute__((section(".scratch_y")))

#define PERIODIC_DEBUG(COUNT, FUNC) \
        static size_t ct=0; \
        if (ct++ % COUNT == 0) { \
            FUNC         \
        }

// Add these macros near other globals
#define MEMORY_BARRIER() __sync_synchronize()
#define WRITE_VOLATILE(var, val) do { MEMORY_BARRIER(); (var) = (val); MEMORY_BARRIER(); } while (0)
#define READ_VOLATILE(var) ({ MEMORY_BARRIER(); typeof(var) __temp = (var); MEMORY_BARRIER(); __temp; })

template<typename T>
inline void write_volatile_struct(volatile T& dest, const T& src) {
    MEMORY_BARRIER();
    memcpy((void*)&dest, &src, sizeof(T));
    MEMORY_BARRIER();
}

#define WRITE_VOLATILE_STRUCT(var, val) write_volatile_struct((var), (val))

// Add this template function after write_volatile_struct:
template<typename T>
inline T read_volatile_struct(const volatile T& src) {
    MEMORY_BARRIER();
    T temp;
    memcpy(&temp, (const void*)&src, sizeof(T));
    MEMORY_BARRIER();
    return temp;
}

#define READ_VOLATILE_STRUCT(var) read_volatile_struct(var)

//#define ALLOW_DEBUG 

#ifdef ALLOW_DEBUG
#define DEBUG_PRINTF(...) Serial.printf(__VA_ARGS__); Serial.flush()
#define DEBUG_PRINT(...) Serial.print(__VA_ARGS__); Serial.flush()
#define DEBUG_PRINTLN(...) Serial.println(__VA_ARGS__); Serial.flush()
#else
#define DEBUG_PRINT(...)
#define DEBUG_PRINTLN(...)
#define DEBUG_PRINTF(...)
#endif

#define PERIODIC_RUN(code, freq_ms) \
{ \
    static size_t lastUpdate = 0; \
    size_t now = millis(); \
    if (now - lastUpdate > (freq_ms)) { \
        lastUpdate = now; \
        code; \
    } \
}  

#define PERIODIC_RUN_US(code, freq_us) \
{ \
    static size_t lastUpdate = 0; \
    size_t now = micros(); \
    if (now - lastUpdate > (freq_us)) { \
        lastUpdate = now; \
        code; \
    } \
}  

template<typename T>
std::shared_ptr<T> make_non_owning(T& obj) {
    return std::shared_ptr<T>(&obj, [](T*){});
}



#endif  // __MEML_PICO_HPP__
