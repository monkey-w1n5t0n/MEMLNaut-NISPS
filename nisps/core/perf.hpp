// nisps/core/perf.hpp — RP2040/RP2350 inlining/hotness attributes.
//
// On firmware builds NISPS_FORCE_INLINE/NISPS_HOT/NISPS_NOINLINE expand to
// GCC-specific attributes; on every other build (host tests, Emscripten/WASM)
// NISPS_FORCE_INLINE/NISPS_HOT are inert (NISPS_NOINLINE still applies under
// GCC/Clang host compilers). No SRAM-section placement macros are defined
// here today (the previous NISPS_AUDIO_MEM/NISPS_APP_SRAM/NISPS_AUDIO_FUNC
// regime had zero real call sites — 2026-07 simplification audit S21). If
// flash-vs-SRAM placement is ever measured to matter, add the macro(s) back
// alongside the actual hot declaration(s) that need them.

#pragma once

// NISPS_TARGET_EMBEDDED marks builds for the RP2350 hardware target. Code
// that is allowed heap allocation at construction time on host/WASM targets
// (e.g. nisps/ml/dynamic_storage.hpp) is compile-time excluded when this is
// defined — the zero-heap firmware contract is enforced structurally, not
// just by lint.
#if defined(ARDUINO_ARCH_RP2040) || defined(ARDUINO_ARCH_RP2350)
  #define NISPS_TARGET_EMBEDDED 1
#endif

#if defined(ARDUINO_ARCH_RP2040) || defined(ARDUINO_ARCH_RP2350)
  #define NISPS_FORCE_INLINE  __attribute__((always_inline)) inline
  #define NISPS_HOT           __attribute__((hot))
  #define NISPS_NOINLINE      __attribute__((noinline))
#else
  #define NISPS_FORCE_INLINE  inline
  #define NISPS_HOT
  #if defined(__GNUC__) || defined(__clang__)
    #define NISPS_NOINLINE    __attribute__((noinline))
  #else
    #define NISPS_NOINLINE
  #endif
#endif
