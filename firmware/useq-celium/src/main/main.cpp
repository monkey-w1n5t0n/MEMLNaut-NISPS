// uSEQ-Celium main firmware — USB CDC serial in, CV/Gate out, I2C forward.
//
// Target: uSEQ v1.0 (RP2040) with DIGI_OUT_INVERTED. Reads StateSnapshot
// packets from USB serial (see docs/useq-celium/protocol.md), applies the
// 3 main-module CVs and 3 hard gates, and forwards the 8 expander CVs over
// Wire1 to the expander at UC_EXP_I2C_ADDR.

#include <Arduino.h>
#include <Wire.h>

#include "protocol.h"

// --- Endianness sanity check ------------------------------------------------
// RP2040 is little-endian. We struct-pun snapshot bytes, so this must hold.
static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__,
              "uSEQ-Celium assumes a little-endian target");

// --- Pin map (uSEQ v1.0, from uSEQ/src/uSEQ/pinmap.h) -----------------------
// useq_output_pins[]     = { 21, 20, 19, 18, 17, 16 }
//   indices 0..2 -> CV outs (PIO-PWM on uSEQ, here we use Arduino PWM)
//   indices 3..5 -> hard gates (binary GPIO). DIGI_OUT_INVERTED flips them.
// I2C on Wire1: SDA = GPIO 0, SCL = GPIO 1.
static const uint8_t CV_PINS[UC_NUM_MAIN_CV]      = { 21, 20, 19 };
static const uint8_t GATE_PINS[UC_NUM_HARD_GATES] = { 18, 17, 16 };
static const uint8_t I2C_SDA_PIN = 0;
static const uint8_t I2C_SCL_PIN = 1;

// --- PWM config -------------------------------------------------------------
// 11-bit range (0..2047) matches uSEQ's PIO-PWM. 100 kHz carrier keeps the
// analog-side RC slew comfortably below audio rates.
static const int      PWM_RANGE = 2047;
static const uint32_t PWM_FREQ  = 100000;

// --- I2C forward rate limit -------------------------------------------------
// Protocol spec caps expander writes at ~1 kHz. 1 ms between frames.
static const uint32_t I2C_MIN_INTERVAL_US = 1000;

// --- Packet reader state ----------------------------------------------------
enum RxState : uint8_t {
    WAIT_SYNC1 = 0,
    WAIT_SYNC2,
    READ_BODY,
};

static uint8_t      g_rx_buf[UC_STATE_SNAPSHOT_LEN];
static size_t       g_rx_len   = 0;
static RxState      g_rx_state = WAIT_SYNC1;
static uint32_t     g_last_i2c_us = 0;
static uint8_t      g_last_exp_seq = 0xFF; // force first send
static uint16_t     g_last_exp_cv[UC_NUM_EXP_CV] = {0};

// ---------------------------------------------------------------------------

static inline void apply_snapshot(const uc_state_snapshot_t* s) {
    // Gates: invert per DIGI_OUT_INVERTED (active-low hardware).
    for (uint8_t i = 0; i < UC_NUM_HARD_GATES; i++) {
        const bool bit = (s->gates >> i) & 0x01;
#ifdef DIGI_OUT_INVERTED
        digitalWrite(GATE_PINS[i], bit ? LOW : HIGH);
#else
        digitalWrite(GATE_PINS[i], bit ? HIGH : LOW);
#endif
    }
    // Main CVs: u16 -> 11-bit PWM.
    for (uint8_t i = 0; i < UC_NUM_MAIN_CV; i++) {
        analogWrite(CV_PINS[i], s->cv_main[i] >> 5);
    }
}

static inline bool exp_cv_changed(const uint16_t* cv) {
    for (uint8_t i = 0; i < UC_NUM_EXP_CV; i++) {
        if (cv[i] != g_last_exp_cv[i]) return true;
    }
    return false;
}

static inline void forward_to_expander(const uc_state_snapshot_t* s) {
    const uint32_t now = micros();
    if ((now - g_last_i2c_us) < I2C_MIN_INTERVAL_US) return;
    if (!exp_cv_changed(s->cv_exp) && s->seq == g_last_exp_seq) return;

    uc_expander_frame_t f;
    f.type = UC_EXP_TYPE_CV_UPDATE;
    f.seq  = s->seq;
    for (uint8_t i = 0; i < UC_NUM_EXP_CV; i++) f.cv[i] = s->cv_exp[i];
    f.crc8 = uc_crc8(reinterpret_cast<const uint8_t*>(&f),
                     UC_EXPANDER_FRAME_LEN - 1);

    Wire1.beginTransmission(UC_EXP_I2C_ADDR);
    Wire1.write(reinterpret_cast<const uint8_t*>(&f), UC_EXPANDER_FRAME_LEN);
    Wire1.endTransmission(); // blocking; ~190µs at 400 kHz for 19 bytes. Fine.

    g_last_i2c_us  = now;
    g_last_exp_seq = s->seq;
    for (uint8_t i = 0; i < UC_NUM_EXP_CV; i++) g_last_exp_cv[i] = s->cv_exp[i];
}

static inline void handle_full_packet() {
    // CRC is over bytes [2..26] (type..last cv byte), 25 bytes, compared
    // against the byte at offset 27.
    const uint8_t crc = uc_crc8(&g_rx_buf[2], UC_STATE_SNAPSHOT_LEN - 3);
    if (crc != g_rx_buf[UC_STATE_SNAPSHOT_LEN - 1]) return;

    const uc_state_snapshot_t* s =
        reinterpret_cast<const uc_state_snapshot_t*>(g_rx_buf);
    if (s->type != UC_TYPE_STATE_SNAPSHOT) return;

    apply_snapshot(s);
    forward_to_expander(s);
}

// Feed one byte through the state machine. On a valid packet, apply it.
// On any mismatch, resume the sync search (starting from this byte — if it
// happens to be 0xA7 we re-enter WAIT_SYNC2).
static inline void feed_byte(uint8_t b) {
    switch (g_rx_state) {
        case WAIT_SYNC1:
            if (b == UC_SYNC_1) {
                g_rx_buf[0] = b;
                g_rx_len    = 1;
                g_rx_state  = WAIT_SYNC2;
            }
            break;
        case WAIT_SYNC2:
            if (b == UC_SYNC_2) {
                g_rx_buf[1] = b;
                g_rx_len    = 2;
                g_rx_state  = READ_BODY;
            } else if (b == UC_SYNC_1) {
                // false start; keep our SYNC_1 and try again
                g_rx_len   = 1;
                g_rx_state = WAIT_SYNC2;
            } else {
                g_rx_state = WAIT_SYNC1;
            }
            break;
        case READ_BODY:
            g_rx_buf[g_rx_len++] = b;
            if (g_rx_len == UC_STATE_SNAPSHOT_LEN) {
                handle_full_packet();
                g_rx_len   = 0;
                g_rx_state = WAIT_SYNC1;
            }
            break;
    }
}

void setup() {
    Serial.begin(115200);

    analogWriteRange(PWM_RANGE);
    analogWriteFreq(PWM_FREQ);
    for (uint8_t i = 0; i < UC_NUM_MAIN_CV; i++) {
        pinMode(CV_PINS[i], OUTPUT);
        analogWrite(CV_PINS[i], 0);
    }
    for (uint8_t i = 0; i < UC_NUM_HARD_GATES; i++) {
        pinMode(GATE_PINS[i], OUTPUT);
#ifdef DIGI_OUT_INVERTED
        digitalWrite(GATE_PINS[i], HIGH); // inactive
#else
        digitalWrite(GATE_PINS[i], LOW);
#endif
    }

    Wire1.setSDA(I2C_SDA_PIN);
    Wire1.setSCL(I2C_SCL_PIN);
    Wire1.setClock(400000);
    Wire1.begin(); // master
}

void loop() {
    // Drain everything available each iteration — keeps latency low.
    while (Serial.available() > 0) {
        feed_byte(static_cast<uint8_t>(Serial.read()));
    }
}
