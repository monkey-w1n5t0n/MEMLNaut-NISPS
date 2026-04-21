// useq-celium-expander.ino — I2C CV expander for uSEQ USEQHARDWARE_EXPANDER_OUT_0_1
// Target: Raspberry Pi Pico (RP2040) with Arduino-Pico core (Earle Philhower)
// Receives 8 × 11-bit CV values over I2C from the main uSEQ board

#include <Wire.h>
#include <pico/unique_id.h>

// ─── Pin definitions ─────────────────────────────────────────────────────────

// CV outputs (PWM, 11-bit, 100kHz)
constexpr uint8_t PIN_E1 = 13;
constexpr uint8_t PIN_E2 = 14;
constexpr uint8_t PIN_E3 = 10;
constexpr uint8_t PIN_E4 = 11;
constexpr uint8_t PIN_E5 = 8;
constexpr uint8_t PIN_E6 = 7;
constexpr uint8_t PIN_E7 = 5;
constexpr uint8_t PIN_E8 = 3;

// LED feedback
constexpr uint8_t PIN_E1_LED = 15;
constexpr uint8_t PIN_E2_LED = 20;
constexpr uint8_t PIN_E3_LED = 17;
constexpr uint8_t PIN_E4_LED = 12;
constexpr uint8_t PIN_E5_LED = 9;
constexpr uint8_t PIN_E6_LED = 6;
constexpr uint8_t PIN_E7_LED = 2;
constexpr uint8_t PIN_E8_LED = 0;

// I2C (from main uSEQ)
constexpr uint8_t PIN_SDA = 4;
constexpr uint8_t PIN_SCL = 1;

// Output pin arrays
constexpr uint8_t OUTPUT_PINS[]     = { PIN_E1, PIN_E2, PIN_E3, PIN_E4, PIN_E5, PIN_E6, PIN_E7, PIN_E8 };
constexpr uint8_t OUTPUT_LED_PINS[] = { PIN_E1_LED, PIN_E2_LED, PIN_E3_LED, PIN_E4_LED, PIN_E5_LED, PIN_E6_LED, PIN_E7_LED, PIN_E8_LED };

// ─── Protocol constants ──────────────────────────────────────────────────────

constexpr uint8_t  SYNC_I2C      = 0xCC;
constexpr uint8_t  FRAME_LEN     = 18;   // sync(1) + 8×u16LE(16) + checksum(1)
constexpr uint16_t PWM_MAX       = 2047;
constexpr uint8_t  FALLBACK_ADDR = 0x10;

// ─── State ───────────────────────────────────────────────────────────────────

volatile uint16_t outputValues[8] = {};
volatile bool     newFrame = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

static uint8_t xorChecksum(const uint8_t* buf, uint8_t start, uint8_t end) {
  uint8_t cs = 0;
  for (uint8_t i = start; i <= end; i++) cs ^= buf[i];
  return cs;
}

static inline uint16_t readU16LE(const uint8_t* p) {
  return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static uint8_t deriveI2CAddress() {
  pico_unique_board_id_t id;
  pico_get_unique_board_id(&id);
  uint8_t addr = id.id[PICO_UNIQUE_BOARD_ID_SIZE_BYTES - 1];
  if (addr < 0x08 || addr > 0x77) addr = FALLBACK_ADDR;
  return addr;
}

// ─── I2C receive callback (ISR context) ──────────────────────────────────────

void onI2CReceive(int numBytes) {
  if (numBytes != FRAME_LEN) {
    // Drain unexpected bytes
    while (Wire.available()) Wire.read();
    return;
  }

  uint8_t buf[FRAME_LEN];
  for (uint8_t i = 0; i < FRAME_LEN; i++) buf[i] = Wire.read();

  // Validate sync byte
  if (buf[0] != SYNC_I2C) return;

  // Validate checksum (XOR of bytes 0-16)
  if (xorChecksum(buf, 0, 16) != buf[17]) return;

  // Store values
  for (int i = 0; i < 8; i++) {
    uint16_t val = readU16LE(&buf[1 + i * 2]);
    outputValues[i] = (val > PWM_MAX) ? PWM_MAX : val;
  }
  newFrame = true;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

void setupPins() {
  for (int i = 0; i < 8; i++) {
    pinMode(OUTPUT_PINS[i], OUTPUT);
    pinMode(OUTPUT_LED_PINS[i], OUTPUT);
  }
}

void setupPWM() {
  analogWriteFreq(100000);
  analogWriteRange(PWM_MAX);
}

void setupI2C() {
  uint8_t addr = deriveI2CAddress();
  Wire.setSDA(PIN_SDA);
  Wire.setSCL(PIN_SCL);
  Wire.begin(addr);
  Wire.onReceive(onI2CReceive);
}

void setup() {
  setupPins();
  setupPWM();
  setupI2C();
}

// ─── Output writing ─────────────────────────────────────────────────────────

void writeOutputs() {
  for (int i = 0; i < 8; i++) {
    analogWrite(OUTPUT_PINS[i], outputValues[i]);
  }
}

void updateLEDs() {
  for (int i = 0; i < 8; i++) {
    uint16_t val = outputValues[i];
    // Exponential brightness curve for visual feedback
    uint16_t brightness = (uint32_t)(val * val) >> 11;
    analogWrite(OUTPUT_LED_PINS[i], brightness);
  }
}

// ─── Main loop ──────────────────────────────────────────────────────────────

void loop() {
  if (newFrame) {
    newFrame = false;
    writeOutputs();
    updateLEDs();
  }
}
