// uSEQ-Celium wire protocol — shared by main firmware, expander firmware, and
// (mirrored by eye into) playground/js/useq-celium/protocol.js.
//
// See docs/useq-celium/protocol.md for the authoritative spec.

#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// --- Framing constants --------------------------------------------------

#define UC_SYNC_1 0xA7
#define UC_SYNC_2 0x5E

#define UC_TYPE_STATE_SNAPSHOT 0x01
#define UC_TYPE_FW_HELLO       0x02
#define UC_TYPE_ACK            0x03
#define UC_TYPE_RESET          0x7F

// --- Expander (I2C / Wire1) ---------------------------------------------

#define UC_EXP_I2C_ADDR        0x42
#define UC_EXP_TYPE_CV_UPDATE  0xE1

// --- Channel counts -----------------------------------------------------

#define UC_NUM_HARD_GATES 3u
#define UC_NUM_MAIN_CV    3u
#define UC_NUM_EXP_CV     8u

// --- Packet sizes -------------------------------------------------------

#define UC_STATE_SNAPSHOT_LEN 28u
#define UC_EXPANDER_FRAME_LEN 19u

// --- Packed packet layouts ---------------------------------------------
//
// Using #pragma pack to guarantee no padding. All u16 values are LITTLE-ENDIAN
// on the wire. RP2040 is little-endian so native reads are fine; if the code
// is ever ported to a BE target, swap before reading.

#pragma pack(push, 1)

typedef struct {
    uint8_t  sync1;                  // 0xA7
    uint8_t  sync2;                  // 0x5E
    uint8_t  type;                   // UC_TYPE_STATE_SNAPSHOT
    uint8_t  seq;                    // rolling counter
    uint8_t  gates;                  // bits 0..2 = hard gate state
    uint16_t cv_main[UC_NUM_MAIN_CV]; // 0..65535, FW >>= 5 for 11-bit PWM
    uint16_t cv_exp[UC_NUM_EXP_CV];
    uint8_t  crc8;                   // over bytes [type..last cv byte], i.e. offset 2..26
} uc_state_snapshot_t;

typedef struct {
    uint8_t  type;                   // UC_EXP_TYPE_CV_UPDATE
    uint8_t  seq;
    uint16_t cv[UC_NUM_EXP_CV];      // 0..65535
    uint8_t  crc8;                   // over bytes [0..17]
} uc_expander_frame_t;

#pragma pack(pop)

// Compile-time size checks — catch accidental padding regressions.
#ifdef __cplusplus
static_assert(sizeof(uc_state_snapshot_t) == UC_STATE_SNAPSHOT_LEN,
              "uc_state_snapshot_t must be 28 bytes (check #pragma pack)");
static_assert(sizeof(uc_expander_frame_t) == UC_EXPANDER_FRAME_LEN,
              "uc_expander_frame_t must be 19 bytes (check #pragma pack)");
#endif

// --- CRC8 ---------------------------------------------------------------
// Polynomial 0x07, init 0x00, no reflection. Small enough to inline.

static inline uint8_t uc_crc8(const uint8_t* data, size_t len) {
    uint8_t crc = 0x00;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (uint8_t b = 0; b < 8; b++) {
            crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x07)
                               : (uint8_t)(crc << 1);
        }
    }
    return crc;
}

#ifdef __cplusplus
} // extern "C"
#endif
