// nisps/core/perf.hpp — RP2040/RP2350 memory section + inlining attributes.
//
// On firmware builds the macros expand to GCC/Pico-specific section attributes
// so hot code/data lives in SRAM instead of XIP flash. On every other build
// (host tests, Emscripten/WASM) they are inert — the discipline of marking
// audio-critical declarations is preserved syntactically without affecting
// codegen.
//
// See architecture.md §3.4.

#pragma once

#if defined(ARDUINO_ARCH_RP2040) || defined(ARDUINO_ARCH_RP2350)
  // Pico SDK provides __not_in_flash and __not_in_flash_func.
  // __not_in_flash takes a section name string; __not_in_flash_func wraps the
  // declaration directly.
  #define NISPS_AUDIO_MEM     __not_in_flash("audio")
  #define NISPS_AUDIO_FUNC    __not_in_flash_func
  #define NISPS_APP_SRAM      __not_in_flash("app")
  #define NISPS_FORCE_INLINE  __attribute__((always_inline)) inline
  #define NISPS_HOT           __attribute__((hot))
#else
  #define NISPS_AUDIO_MEM
  #define NISPS_AUDIO_FUNC(decl) decl
  #define NISPS_APP_SRAM
  #define NISPS_FORCE_INLINE  inline
  #define NISPS_HOT
#endif
