// useq-celium-main.ino — USB Serial to CV/Gate converter for uSEQ USEQHARDWARE_1_0
// Target: Raspberry Pi Pico (RP2040) with Arduino-Pico core (Earle Philhower)
// No dependencies beyond Arduino + Wire

#include <Wire.h>

// ─── Pin definitions ─────────────────────────────────────────────────────────

// CV outputs (PWM)
constexpr uint8_t PIN_A1 = 21;
constexpr uint8_t PIN_A2 = 20;
constexpr uint8_t PIN_A3 = 19;

// Gate outputs (digital)
constexpr uint8_t PIN_D1 = 18;
constexpr uint8_t PIN_D2 = 17;
constexpr uint8_t PIN_D3 = 16;

// LED feedback
constexpr uint8_t PIN_A1_LED = 3;
constexpr uint8_t PIN_A2_LED = 2;
constexpr uint8_t PIN_A3_LED = 11;
constexpr uint8_t PIN_D1_LED = 12;
constexpr uint8_t PIN_D2_LED = 13;
constexpr uint8_t PIN_D3_LED = 22;

// Digital inputs
constexpr uint8_t PIN_I1 = 8;
constexpr uint8_t PIN_I2 = 9;

// Analog inputs
constexpr uint8_t PIN_AI1 = 26;
constexpr uint8_t PIN_AI2 = 27;

// I2C (to expander)
constexpr uint8_t PIN_SDA = 0;
constexpr uint8_t PIN_SCL = 1;

// Output pin arrays (indexed 0-5: a1,a2,a3,d1,d2,d3)
constexpr uint8_t OUTPUT_PINS[]     = { PIN_A1, PIN_A2, PIN_A3, PIN_D1, PIN_D2, PIN_D3 };
constexpr uint8_t OUTPUT_LED_PINS[] = { PIN_A1_LED, PIN_A2_LED, PIN_A3_LED, PIN_D1_LED, PIN_D2_LED, PIN_D3_LED };
constexpr bool    PIN_IS_PWM[]      = { true, true, true, false, false, false };

// ─── Protocol constants ──────────────────────────────────────────────────────

constexpr uint8_t  SYNC_RX        = 0xAA;
constexpr uint8_t  SYNC_TX        = 0xBB;
constexpr uint8_t  SYNC_I2C       = 0xCC;
constexpr uint8_t  MSG_OUTPUT_VAL = 0x01;
constexpr uint8_t  MSG_CONFIG     = 0x02;
constexpr uint8_t  MSG_IDENTIFY   = 0x03;
constexpr uint8_t  SYNC_I2C_IDENTIFY = 0xDD;
constexpr uint8_t  MSG_INPUT_READ = 0x01;
constexpr uint8_t  I2C_EXPANDER   = 0x10;  // default expander address
constexpr uint16_t PWM_MAX        = 2047;

// Frame sizes
constexpr uint8_t FRAME_OUTPUT_LEN = 31;  // sync(1) + type(1) + 14×u16(28) + crc(1)
constexpr uint8_t FRAME_CONFIG_LEN = 5;   // sync(1) + type(1) + u16(2) + crc(1)
constexpr uint8_t FRAME_IDENTIFY_LEN = 3; // sync(1) + type(1) + crc(1)

// ─── State ───────────────────────────────────────────────────────────────────

uint16_t outputValues[14] = {};  // a1,a2,a3, d1,d2,d3, e1..e8
// Mode bitmask: bit=0 → CV, bit=1 → gate. Default: d1-d3 are gates (bits 3,4,5)
uint16_t modeBitmask = 0b0000000000111000;

uint8_t  rxBuf[FRAME_OUTPUT_LEN];
uint8_t  rxIdx = 0;
bool     synced = false;

uint32_t lastInputSendMs  = 0;
uint32_t lastI2CSendMs    = 0;
uint32_t lastI2CScanMs    = 0;

uint8_t  expanderAddr = I2C_EXPANDER;
bool     expanderFound = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

static uint8_t xorChecksum(const uint8_t* buf, uint8_t start, uint8_t end) {
  uint8_t cs = 0;
  for (uint8_t i = start; i <= end; i++) cs ^= buf[i];
  return cs;
}

static inline uint16_t readU16LE(const uint8_t* p) {
  return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static inline void writeU16LE(uint8_t* p, uint16_t v) {
  p[0] = v & 0xFF;
  p[1] = (v >> 8) & 0xFF;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

void setupPins() {
  for (int i = 0; i < 6; i++) {
    pinMode(OUTPUT_PINS[i], OUTPUT);
    pinMode(OUTPUT_LED_PINS[i], OUTPUT);
  }
  pinMode(PIN_I1, INPUT);
  pinMode(PIN_I2, INPUT);
  // AI1, AI2 are analog — no pinMode needed
}

void setupPWM() {
  analogWriteFreq(100000);
  analogWriteRange(PWM_MAX);
}

void setupI2C() {
  Wire.setSDA(PIN_SDA);
  Wire.setSCL(PIN_SCL);
  Wire.begin();
  Wire.setClock(400000);
  Wire.setTimeout(5);

  probeExpander();
}

// Probe the fixed expander address. Called at boot and periodically if not found.
void probeExpander() {
  Wire.beginTransmission(I2C_EXPANDER);
  if (Wire.endTransmission() == 0) {
    expanderAddr = I2C_EXPANDER;
    expanderFound = true;
    Serial.print("[I2C] Expander found at 0x");
    Serial.println(I2C_EXPANDER, HEX);
  } else {
    expanderFound = false;
    Serial.print("[I2C] No expander at 0x");
    Serial.println(I2C_EXPANDER, HEX);
  }
}

// Retry expander discovery every 2s if not yet found (handles late boot)
void retryExpanderScan() {
  if (expanderFound) return;
  uint32_t now = millis();
  if (now - lastI2CScanMs < 2000) return;
  lastI2CScanMs = now;
  probeExpander();
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  setupPins();
  setupPWM();
  setupI2C();
}

// ─── Serial RX (non-blocking) ───────────────────────────────────────────────

void processOutputFrame() {
  // Verify checksum: XOR of bytes 1..29
  if (xorChecksum(rxBuf, 1, 29) != rxBuf[30]) return;

  for (int i = 0; i < 14; i++) {
    outputValues[i] = min(readU16LE(&rxBuf[2 + i * 2]), PWM_MAX);
  }
}

void processConfigFrame() {
  // Verify checksum: XOR of bytes 1..3
  if (xorChecksum(rxBuf, 1, 3) != rxBuf[4]) return;

  modeBitmask = readU16LE(&rxBuf[2]);
}

void processIdentifyFrame() {
  // Validate checksum: XOR of byte 1 only
  if (rxBuf[1] != rxBuf[2]) return;

  // Forward identify to expander
  if (expanderFound) {
    Wire.beginTransmission(expanderAddr);
    Wire.write(SYNC_I2C_IDENTIFY);
    Wire.endTransmission();
  }

  // Sweep the 6 main LEDs on
  for (int i = 0; i < 6; i++) {
    analogWrite(OUTPUT_LED_PINS[i], PWM_MAX);
    delay(40);
  }
  delay(80);
  // Sweep the 6 main LEDs off (reverse)
  for (int i = 5; i >= 0; i--) {
    analogWrite(OUTPUT_LED_PINS[i], 0);
    delay(40);
  }

  // Send ack frame: SYNC_TX + MSG_IDENTIFY + status(1) + checksum
  uint8_t ack[4];
  ack[0] = SYNC_TX;
  ack[1] = MSG_IDENTIFY;
  ack[2] = 0x01;
  ack[3] = ack[1] ^ ack[2];
  Serial.write(ack, 4);
}

void readSerial() {
  while (Serial.available()) {
    uint8_t b = Serial.read();

    if (!synced) {
      if (b == SYNC_RX) {
        rxBuf[0] = b;
        rxIdx = 1;
        synced = true;
      }
      continue;
    }

    rxBuf[rxIdx++] = b;

    // After receiving msg type byte, determine expected length
    if (rxIdx == 2) {
      if (rxBuf[1] != MSG_OUTPUT_VAL && rxBuf[1] != MSG_CONFIG && rxBuf[1] != MSG_IDENTIFY) {
        synced = false;  // unknown msg type, resync
        continue;
      }
    }

    uint8_t expectedLen;
    if (rxBuf[1] == MSG_OUTPUT_VAL) expectedLen = FRAME_OUTPUT_LEN;
    else if (rxBuf[1] == MSG_CONFIG) expectedLen = FRAME_CONFIG_LEN;
    else expectedLen = FRAME_IDENTIFY_LEN;

    if (rxIdx >= expectedLen) {
      if (rxBuf[1] == MSG_OUTPUT_VAL) processOutputFrame();
      else if (rxBuf[1] == MSG_CONFIG) processConfigFrame();
      else if (rxBuf[1] == MSG_IDENTIFY) processIdentifyFrame();
      synced = false;
    }
  }
}

// ─── Output writing ─────────────────────────────────────────────────────────

void writeOutputs() {
  for (int i = 0; i < 6; i++) {
    bool isGate = (modeBitmask >> i) & 1;
    uint16_t val = outputValues[i];

    if (PIN_IS_PWM[i]) {
      if (isGate) {
        // PWM-capable pin in gate mode: velocity gate (write value as PWM)
        analogWrite(OUTPUT_PINS[i], val);
      } else {
        // CV mode: direct PWM
        analogWrite(OUTPUT_PINS[i], val);
      }
    } else {
      // Digital-only pin (d1-d3)
      if (isGate) {
        digitalWrite(OUTPUT_PINS[i], val > 1023 ? HIGH : LOW);
      } else {
        // CV mode on digital pin: threshold
        digitalWrite(OUTPUT_PINS[i], val > 1023 ? HIGH : LOW);
      }
    }
  }
}

// ─── I2C to expander ────────────────────────────────────────────────────────

void forwardToExpander() {
  if (!expanderFound) return;

  uint32_t now = millis();
  if (now - lastI2CSendMs < 10) return;  // throttle to ~100Hz
  lastI2CSendMs = now;

  uint8_t frame[18];
  frame[0] = SYNC_I2C;
  for (int i = 0; i < 8; i++) {
    writeU16LE(&frame[1 + i * 2], outputValues[6 + i]);
  }
  frame[17] = xorChecksum(frame, 0, 16);

  Wire.beginTransmission(expanderAddr);
  Wire.write(frame, 18);
  Wire.endTransmission();
}

// ─── Input readings TX (20Hz) ───────────────────────────────────────────────

void sendInputs() {
  uint32_t now = millis();
  if (now - lastInputSendMs < 50) return;
  lastInputSendMs = now;

  uint16_t i1  = digitalRead(PIN_I1);
  uint16_t i2  = digitalRead(PIN_I2);
  uint16_t ai1 = analogRead(PIN_AI1);
  uint16_t ai2 = analogRead(PIN_AI2);

  uint8_t frame[11];
  frame[0] = SYNC_TX;
  frame[1] = MSG_INPUT_READ;
  writeU16LE(&frame[2], i1);
  writeU16LE(&frame[4], i2);
  writeU16LE(&frame[6], ai1);
  writeU16LE(&frame[8], ai2);
  frame[10] = xorChecksum(frame, 1, 9);

  Serial.write(frame, 11);
}

// ─── LED feedback ───────────────────────────────────────────────────────────

void updateLEDs() {
  for (int i = 0; i < 6; i++) {
    uint16_t val = outputValues[i];
    bool isGate = (modeBitmask >> i) & 1;

    if (isGate && !PIN_IS_PWM[i]) {
      // Digital gate: LED on/off
      digitalWrite(OUTPUT_LED_PINS[i], val > 1023 ? HIGH : LOW);
    } else {
      // Exponential curve for visual feedback
      uint16_t brightness = (uint32_t)(val * val) >> 11;
      analogWrite(OUTPUT_LED_PINS[i], brightness);
    }
  }
}

// ─── Main loop ──────────────────────────────────────────────────────────────

void loop() {
  readSerial();
  writeOutputs();
  retryExpanderScan();
  forwardToExpander();
  sendInputs();
  updateLEDs();
}
