// uSEQ-Celium expander firmware — I2C slave, 8-channel PWM CV output.
//
// Listens on Wire1 at UC_EXP_I2C_ADDR for ExpanderFrame packets (19 bytes)
// written by the uSEQ main module. Validates CRC8 and mirrors the 8 u16
// CV values to 8 PWM pins (u16 >> 5 -> 11-bit PWM).

#include <Arduino.h>
#include <Wire.h>

#include "protocol.h"

static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__,
              "uSEQ-Celium expander assumes a little-endian target");

// --- Pin map (from uSEQ/src/uSEQ/pinmap.h, USEQHARDWARE_EXPANDER_OUT_0_1) ---
// useq_output_pins[] = { 13, 14, 10, 11, 8, 7, 5, 3 }
// Wire1 on this board: SDA = GPIO 4, SCL = GPIO 1.
static const uint8_t CV_PINS[UC_NUM_EXP_CV] = { 13, 14, 10, 11, 8, 7, 5, 3 };
static const uint8_t I2C_SDA_PIN = 4;
static const uint8_t I2C_SCL_PIN = 1;

static const int      PWM_RANGE = 2047;
static const uint32_t PWM_FREQ  = 100000;

// --- Shared state between I2C callback and loop ----------------------------
// onReceive fires from the I2C ISR context. Keep the critical section tiny:
// copy into a scratch buffer, validate, then publish u16 values into
// g_latest_cv behind g_cv_dirty. loop() does the actual analogWrite (which
// may take a few µs per channel and we don't want to do that in the ISR).
static volatile uint16_t g_latest_cv[UC_NUM_EXP_CV] = {0};
static volatile bool     g_cv_dirty = false;

static uint8_t g_rx_scratch[UC_EXPANDER_FRAME_LEN];

static void on_i2c_receive(int n_bytes) {
    if (n_bytes != (int)UC_EXPANDER_FRAME_LEN) {
        // Drain to clear the bus. Malformed frame.
        while (Wire1.available()) Wire1.read();
        return;
    }
    for (int i = 0; i < n_bytes; i++) {
        g_rx_scratch[i] = Wire1.read();
    }
    // CRC8 over bytes [0..17], compared to byte 18.
    const uint8_t crc = uc_crc8(g_rx_scratch, UC_EXPANDER_FRAME_LEN - 1);
    if (crc != g_rx_scratch[UC_EXPANDER_FRAME_LEN - 1]) return;

    const uc_expander_frame_t* f =
        reinterpret_cast<const uc_expander_frame_t*>(g_rx_scratch);
    if (f->type != UC_EXP_TYPE_CV_UPDATE) return;

    for (uint8_t i = 0; i < UC_NUM_EXP_CV; i++) g_latest_cv[i] = f->cv[i];
    g_cv_dirty = true;
}

void setup() {
    analogWriteRange(PWM_RANGE);
    analogWriteFreq(PWM_FREQ);
    for (uint8_t i = 0; i < UC_NUM_EXP_CV; i++) {
        pinMode(CV_PINS[i], OUTPUT);
        analogWrite(CV_PINS[i], 0);
    }

    Wire1.setSDA(I2C_SDA_PIN);
    Wire1.setSCL(I2C_SCL_PIN);
    Wire1.begin(UC_EXP_I2C_ADDR); // slave
    Wire1.onReceive(on_i2c_receive);
}

void loop() {
    if (g_cv_dirty) {
        // Snapshot then clear — if a new frame arrives while we're writing,
        // the flag is re-set and we'll re-apply on the next iteration.
        uint16_t cv_now[UC_NUM_EXP_CV];
        noInterrupts();
        g_cv_dirty = false;
        for (uint8_t i = 0; i < UC_NUM_EXP_CV; i++) cv_now[i] = g_latest_cv[i];
        interrupts();

        for (uint8_t i = 0; i < UC_NUM_EXP_CV; i++) {
            analogWrite(CV_PINS[i], cv_now[i] >> 5);
        }
    }
    delay(1); // ease USB power / let the core breathe
}
