// uSEQ-CV wire protocol v2 — single source of truth (C/C++ side).
//
// Mirrored byte-for-byte by manifold/src/backends/useq-protocol.ts. Any change
// here MUST be reflected there (a unit test asserts the frame sizes match).
//
// Topology (fixed): 3 CV + 3 gate on the uSEQ main module, 8 CV on the expander
//   = 11 CV (CV1..CV11) + 3 gate (GATE1..GATE3).
//   CV1..CV3   → main module PWM       (a1,a2,a3)
//   CV4..CV11  → expander module PWM   (e1..e8, forwarded over I2C)
//   GATE1..3   → main module digital   (d1,d2,d3)
//
// Host-agnostic: the sender may be the browser (Web Serial) or the MEMLNaut
// RP2350 firmware (USB/UART) — identical bytes either way.
//
// Transport: USB CDC / UART @ 115200, little-endian, XOR checksum, fixed-length
// frames keyed by a sync byte + type so a stream parser can resync after a drop.
#pragma once
#include <stdint.h>

// ─── Sync bytes ──────────────────────────────────────────────────────────────
static const uint8_t USEQ_SYNC_HOST          = 0xAA;  // host → uSEQ
static const uint8_t USEQ_SYNC_DEV           = 0xBB;  // uSEQ → host
static const uint8_t USEQ_SYNC_I2C           = 0xCC;  // main → expander
static const uint8_t USEQ_SYNC_I2C_IDENTIFY  = 0xDD;  // main → expander, identify

// ─── Message types ───────────────────────────────────────────────────────────
static const uint8_t USEQ_MSG_OUTPUT   = 0x01;  // host → uSEQ : CV + gate values
static const uint8_t USEQ_MSG_IDENTIFY = 0x03;  // host → uSEQ : flash LEDs, ack
static const uint8_t USEQ_MSG_INPUT    = 0x01;  // uSEQ → host : i1,i2,ai1,ai2
// (0x02 reserved — the old CONFIG frame; topology is fixed in v2, so unused.)

// ─── Topology ────────────────────────────────────────────────────────────────
static const uint8_t  USEQ_NUM_CV       = 11;  // CV1..CV11
static const uint8_t  USEQ_NUM_GATE     = 3;   // GATE1..GATE3
static const uint8_t  USEQ_NUM_MAIN_CV  = 3;   // CV1..CV3 live on the main board
static const uint8_t  USEQ_NUM_EXP_CV   = 8;   // CV4..CV11 live on the expander
static const uint8_t  USEQ_I2C_ADDR     = 0x10;// expander I2C slave address

// ─── Value ranges ────────────────────────────────────────────────────────────
static const uint16_t USEQ_CV_MAX  = 4095;  // 12-bit canonical wire value
static const uint16_t USEQ_PWM_MAX = 2047;  // 11-bit hardware PWM (RP2040 analogWrite)

// ─── Frame sizes ─────────────────────────────────────────────────────────────
// OUTPUT: sync(1) + type(1) + 11×u16 CV(22) + gate-bits(1) + xor(1)
static const uint8_t USEQ_FRAME_OUTPUT_LEN   = 2 + USEQ_NUM_CV * 2 + 1 + 1;  // 26
static const uint8_t USEQ_FRAME_IDENTIFY_LEN = 3;   // sync + type + xor
static const uint8_t USEQ_FRAME_ACK_LEN      = 4;   // sync + type + status + xor
static const uint8_t USEQ_FRAME_INPUT_LEN    = 11;  // sync + type + 4×u16 + xor
// I2C (main → expander): sync(1) + 8×u16(16) + xor(1)
static const uint8_t USEQ_FRAME_I2C_LEN      = 1 + USEQ_NUM_EXP_CV * 2 + 1;  // 18

// ─── Byte offsets (OUTPUT frame) ─────────────────────────────────────────────
static const uint8_t USEQ_OFF_CV0   = 2;                       // first CV u16
static const uint8_t USEQ_OFF_GATES = 2 + USEQ_NUM_CV * 2;     // 24
static const uint8_t USEQ_OFF_OXSUM = USEQ_FRAME_OUTPUT_LEN - 1; // 25

// ─── Helpers ─────────────────────────────────────────────────────────────────
static inline uint8_t useq_xor(const uint8_t* buf, uint8_t start, uint8_t end) {
  uint8_t cs = 0;
  for (uint8_t i = start; i <= end; i++) cs ^= buf[i];
  return cs;
}
static inline uint16_t useq_read_u16le(const uint8_t* p) {
  return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}
static inline void useq_write_u16le(uint8_t* p, uint16_t v) {
  p[0] = (uint8_t)(v & 0xFF);
  p[1] = (uint8_t)((v >> 8) & 0xFF);
}
// Scale a 12-bit wire CV (0..USEQ_CV_MAX) down to 11-bit hardware PWM.
static inline uint16_t useq_cv_to_pwm(uint16_t cv) {
  return (cv > USEQ_CV_MAX ? USEQ_CV_MAX : cv) >> 1;
}
