/**
 * @file USeqI2C.cpp
 * @brief USeq I2C interface implementation
 *
 * @copyright Copyright (c) 2024. This Source Code Form is subject to the terms
 * of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed
 * with this file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

#include "USeqI2C.hpp"

USeqI2C::USeqI2C(uint8_t slave_address)
    : slave_address_(slave_address), initialized_(false) {
    // Initialize send buffer to zeros
    memset(send_buffer_, 0, sizeof(send_buffer_));
}

USeqI2C::~USeqI2C() {
    if (initialized_) {
        Wire1.end();
    }
}

bool USeqI2C::begin(uint8_t sda_pin, uint8_t scl_pin, uint32_t frequency) {
    if (initialized_) {
        Wire1.end();
    }

    // Initialize Wire1 with specified pins (matching reference pattern exactly)
    Wire1.setSDA(sda_pin);
    Wire1.setSCL(scl_pin);
    Wire1.begin();
    Wire1.setTimeout(2);  // 2 ms timeout to avoid blocking core 0 on unresponsive device
    delay(10);  // Match reference implementation delay

    // Only set clock if frequency is different from default
    // if (frequency != 100000) {
    Wire1.setClock(frequency);
    // }

    initialized_ = true;

    DEBUG_PRINT("USeqI2C initialized - SDA: ");
    DEBUG_PRINT(sda_pin);
    DEBUG_PRINT(", SCL: ");
    DEBUG_PRINT(scl_pin);
    DEBUG_PRINT(", Frequency: ");
    DEBUG_PRINT(frequency);
    DEBUG_PRINT(" Hz, Slave Address: ");
    DEBUG_PRINTLN(slave_address_);

    return true;
}

bool USeqI2C::sendValues(const std::vector<float>& values) {
    if (!initialized_) {
        return false;
    }

    if (values.empty()) {
        return false;
    }

    size_t count = values.size();
    if (count > kMaxValues) {
        count = kMaxValues;
    }

    // Copy values to internal buffer
    for (size_t i = 0; i < count; i++) {
        send_buffer_[i] = values[i];
    }

    return transmit_(send_buffer_, count * sizeof(float));
}

bool USeqI2C::sendValues(const float* values, size_t count) {
    if (!initialized_) {
        return false;
    }

    if (values == nullptr || count == 0) {
        return false;
    }

    if (count > kMaxValues) {
        count = kMaxValues;
    }

    // Copy values to internal buffer
    memcpy(send_buffer_, values, count * sizeof(float));

    return transmit_(send_buffer_, count * sizeof(float));
}

bool USeqI2C::transmit_(const void* data, size_t size) {
    // Serial.printf("Transmitting %d bytes to I2C slave 0x%02X\n", size, slave_address_);
    
    Wire1.beginTransmission(slave_address_);
    size_t written = Wire1.write(static_cast<const uint8_t*>(data), size);
    int result = Wire1.endTransmission(true);
    

    return (result == 0 && written == size);
}
