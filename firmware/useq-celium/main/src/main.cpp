// uSEQ-CV main board firmware (protocol v2).
//
// Target: uSEQ USEQHARDWARE_1_0 — Raspberry Pi Pico (RP2040), Arduino-Pico core
// (Earle Philhower). No dependencies beyond Arduino + Wire.
//
// Receives OUTPUT frames over USB serial (host = browser CV backend OR the
// MEMLNaut firmware), drives CV1..CV3 (PWM) + GATE1..GATE3 (digital) locally,
// and forwards CV4..CV11 to the expander over I2C. See ../../shared/protocol.h.
#include <Arduino.h>
#include <Wire.h>
#include "protocol.h"

// ─── Pin map (USEQHARDWARE_1_0) ──────────────────────────────────────────────
constexpr uint8_t PIN_CV[USEQ_NUM_MAIN_CV] = { 21, 20, 19 };  // a1,a2,a3 (PWM)
constexpr uint8_t PIN_GATE[USEQ_NUM_GATE]  = { 18, 17, 16 };  // d1,d2,d3 (digital)
constexpr uint8_t PIN_CV_LED[USEQ_NUM_MAIN_CV] = { 3, 2, 11 };
constexpr uint8_t PIN_GATE_LED[USEQ_NUM_GATE]  = { 12, 13, 22 };
constexpr uint8_t PIN_I1 = 8, PIN_I2 = 9;     // digital inputs
constexpr uint8_t PIN_AI1 = 26, PIN_AI2 = 27; // analog inputs
constexpr uint8_t PIN_SDA = 0, PIN_SCL = 1;   // I2C to expander

// ─── State ───────────────────────────────────────────────────────────────────
uint16_t cvValues[USEQ_NUM_CV] = {};   // 12-bit wire values, CV1..CV11
uint8_t  gateBits = 0;                  // bit0..2 = GATE1..3

uint8_t  rxBuf[USEQ_FRAME_OUTPUT_LEN];
uint8_t  rxIdx = 0;
bool     synced = false;

uint32_t lastInputMs = 0, lastI2CMs = 0, lastScanMs = 0;
bool     expanderFound = false;

// ─── Setup ───────────────────────────────────────────────────────────────────
void probeExpander() {
  Wire.beginTransmission(USEQ_I2C_ADDR);
  expanderFound = (Wire.endTransmission() == 0);
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  for (uint8_t i = 0; i < USEQ_NUM_MAIN_CV; i++) {
    pinMode(PIN_CV[i], OUTPUT);
    pinMode(PIN_CV_LED[i], OUTPUT);
  }
  for (uint8_t i = 0; i < USEQ_NUM_GATE; i++) {
    pinMode(PIN_GATE[i], OUTPUT);
    pinMode(PIN_GATE_LED[i], OUTPUT);
  }
  pinMode(PIN_I1, INPUT);
  pinMode(PIN_I2, INPUT);
  analogWriteFreq(100000);
  analogWriteRange(USEQ_PWM_MAX);
  Wire.setSDA(PIN_SDA);
  Wire.setSCL(PIN_SCL);
  Wire.begin();
  Wire.setClock(400000);
  Wire.setTimeout(5);
  probeExpander();
}

// ─── Frame handlers ──────────────────────────────────────────────────────────
void processOutputFrame() {
  if (useq_xor(rxBuf, 1, USEQ_OFF_OXSUM - 1) != rxBuf[USEQ_OFF_OXSUM]) return;
  for (uint8_t i = 0; i < USEQ_NUM_CV; i++) {
    uint16_t v = useq_read_u16le(&rxBuf[USEQ_OFF_CV0 + i * 2]);
    cvValues[i] = (v > USEQ_CV_MAX) ? USEQ_CV_MAX : v;
  }
  gateBits = rxBuf[USEQ_OFF_GATES];
}

void identifyLedSweep() {
  const uint8_t leds[6] = { PIN_CV_LED[0], PIN_CV_LED[1], PIN_CV_LED[2],
                            PIN_GATE_LED[0], PIN_GATE_LED[1], PIN_GATE_LED[2] };
  for (int i = 0; i < 6; i++) { analogWrite(leds[i], USEQ_PWM_MAX); delay(40); }
  delay(80);
  for (int i = 5; i >= 0; i--) { analogWrite(leds[i], 0); delay(40); }
}

void processIdentifyFrame() {
  if (rxBuf[1] != rxBuf[2]) return;  // xor of byte 1 only
  if (expanderFound) {
    Wire.beginTransmission(USEQ_I2C_ADDR);
    Wire.write(USEQ_SYNC_I2C_IDENTIFY);
    Wire.endTransmission();
  }
  identifyLedSweep();
  uint8_t ack[USEQ_FRAME_ACK_LEN] = { USEQ_SYNC_DEV, USEQ_MSG_IDENTIFY, 0x01, 0 };
  ack[3] = ack[1] ^ ack[2];
  Serial.write(ack, USEQ_FRAME_ACK_LEN);
}

void readSerial() {
  while (Serial.available()) {
    uint8_t b = Serial.read();
    if (!synced) {
      if (b == USEQ_SYNC_HOST) { rxBuf[0] = b; rxIdx = 1; synced = true; }
      continue;
    }
    rxBuf[rxIdx++] = b;
    if (rxIdx == 2 && rxBuf[1] != USEQ_MSG_OUTPUT && rxBuf[1] != USEQ_MSG_IDENTIFY) {
      synced = false;  // unknown type → resync
      continue;
    }
    uint8_t want = (rxBuf[1] == USEQ_MSG_OUTPUT) ? USEQ_FRAME_OUTPUT_LEN
                                                 : USEQ_FRAME_IDENTIFY_LEN;
    if (rxIdx >= want) {
      if (rxBuf[1] == USEQ_MSG_OUTPUT) processOutputFrame();
      else processIdentifyFrame();
      synced = false;
    }
  }
}

// ─── Outputs ─────────────────────────────────────────────────────────────────
void writeOutputs() {
  for (uint8_t i = 0; i < USEQ_NUM_MAIN_CV; i++)
    analogWrite(PIN_CV[i], useq_cv_to_pwm(cvValues[i]));
  for (uint8_t i = 0; i < USEQ_NUM_GATE; i++) {
    bool on = (gateBits >> i) & 1;
    digitalWrite(PIN_GATE[i], on ? HIGH : LOW);
    digitalWrite(PIN_GATE_LED[i], on ? HIGH : LOW);
  }
  for (uint8_t i = 0; i < USEQ_NUM_MAIN_CV; i++) {
    uint16_t pwm = useq_cv_to_pwm(cvValues[i]);
    analogWrite(PIN_CV_LED[i], (uint16_t)(((uint32_t)pwm * pwm) >> 11));
  }
}

void forwardToExpander() {
  if (!expanderFound) return;
  uint32_t now = millis();
  if (now - lastI2CMs < 10) return;  // throttle ~100 Hz
  lastI2CMs = now;
  uint8_t f[USEQ_FRAME_I2C_LEN];
  f[0] = USEQ_SYNC_I2C;
  for (uint8_t i = 0; i < USEQ_NUM_EXP_CV; i++)
    useq_write_u16le(&f[1 + i * 2], useq_cv_to_pwm(cvValues[USEQ_NUM_MAIN_CV + i]));
  f[USEQ_FRAME_I2C_LEN - 1] = useq_xor(f, 0, USEQ_FRAME_I2C_LEN - 2);
  Wire.beginTransmission(USEQ_I2C_ADDR);
  Wire.write(f, USEQ_FRAME_I2C_LEN);
  Wire.endTransmission();
}

void retryExpanderScan() {
  if (expanderFound) return;
  uint32_t now = millis();
  if (now - lastScanMs < 2000) return;
  lastScanMs = now;
  probeExpander();
}

void sendInputs() {
  uint32_t now = millis();
  if (now - lastInputMs < 50) return;  // 20 Hz
  lastInputMs = now;
  uint8_t f[USEQ_FRAME_INPUT_LEN];
  f[0] = USEQ_SYNC_DEV;
  f[1] = USEQ_MSG_INPUT;
  useq_write_u16le(&f[2], digitalRead(PIN_I1));
  useq_write_u16le(&f[4], digitalRead(PIN_I2));
  useq_write_u16le(&f[6], analogRead(PIN_AI1));
  useq_write_u16le(&f[8], analogRead(PIN_AI2));
  f[10] = useq_xor(f, 1, 9);
  Serial.write(f, USEQ_FRAME_INPUT_LEN);
}

void loop() {
  readSerial();
  writeOutputs();
  retryExpanderScan();
  forwardToExpander();
  sendInputs();
}
