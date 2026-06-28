// uSEQ-CV expander firmware (protocol v2).
//
// Target: uSEQ USEQHARDWARE_EXPANDER_OUT_0_1 — Raspberry Pi Pico (RP2040),
// Arduino-Pico core. I2C slave at USEQ_I2C_ADDR; receives 8 × 11-bit CV values
// from the main board and writes them to PWM. See ../../shared/protocol.h.
#include <Arduino.h>
#include <Wire.h>
#include "protocol.h"

// ─── Pin map (USEQHARDWARE_EXPANDER_OUT_0_1) ────────────────────────────────
constexpr uint8_t PIN_E[USEQ_NUM_EXP_CV]     = { 13, 14, 10, 11, 8, 7, 5, 3 };
constexpr uint8_t PIN_E_LED[USEQ_NUM_EXP_CV] = { 15, 20, 17, 12, 9, 6, 2, 0 };
constexpr uint8_t PIN_SDA = 4, PIN_SCL = 1;

volatile uint16_t cvValues[USEQ_NUM_EXP_CV] = {};
volatile bool newFrame = false;
volatile bool doSweep  = false;

void onI2CReceive(int numBytes) {
  if (numBytes == 1) {
    if (Wire.read() == USEQ_SYNC_I2C_IDENTIFY) doSweep = true;
    return;
  }
  if (numBytes != USEQ_FRAME_I2C_LEN) {
    while (Wire.available()) Wire.read();
    return;
  }
  uint8_t buf[USEQ_FRAME_I2C_LEN];
  for (uint8_t i = 0; i < USEQ_FRAME_I2C_LEN; i++) buf[i] = Wire.read();
  if (buf[0] != USEQ_SYNC_I2C) return;
  if (useq_xor(buf, 0, USEQ_FRAME_I2C_LEN - 2) != buf[USEQ_FRAME_I2C_LEN - 1]) return;
  for (uint8_t i = 0; i < USEQ_NUM_EXP_CV; i++) {
    uint16_t v = useq_read_u16le(&buf[1 + i * 2]);
    cvValues[i] = (v > USEQ_PWM_MAX) ? USEQ_PWM_MAX : v;
  }
  newFrame = true;
}

void ledSweep() {
  for (int i = 0; i < USEQ_NUM_EXP_CV; i++) { analogWrite(PIN_E_LED[i], USEQ_PWM_MAX); delay(40); }
  delay(80);
  for (int i = USEQ_NUM_EXP_CV - 1; i >= 0; i--) { analogWrite(PIN_E_LED[i], 0); delay(40); }
}

void setup() {
  for (uint8_t i = 0; i < USEQ_NUM_EXP_CV; i++) {
    pinMode(PIN_E[i], OUTPUT);
    pinMode(PIN_E_LED[i], OUTPUT);
  }
  analogWriteFreq(100000);
  analogWriteRange(USEQ_PWM_MAX);
  Wire.setSDA(PIN_SDA);
  Wire.setSCL(PIN_SCL);
  Wire.begin(USEQ_I2C_ADDR);
  Wire.onReceive(onI2CReceive);
}

void loop() {
  if (doSweep) { doSweep = false; ledSweep(); }
  if (newFrame) {
    newFrame = false;
    for (uint8_t i = 0; i < USEQ_NUM_EXP_CV; i++) {
      uint16_t v = cvValues[i];
      analogWrite(PIN_E[i], v);
      analogWrite(PIN_E_LED[i], (uint16_t)(((uint32_t)v * v) >> 11));
    }
  }
}
