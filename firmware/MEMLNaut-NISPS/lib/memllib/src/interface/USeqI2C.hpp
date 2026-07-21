/**
 * @file USeqI2C.hpp
 * @brief USeq I2C interface for sending CV data
 *
 * @copyright Copyright (c) 2024. This Source Code Form is subject to the terms
 * of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed
 * with this file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

#ifndef __USEQ_I2C_HPP__
#define __USEQ_I2C_HPP__

#include <Arduino.h>
#include <Wire.h>
#include <vector>
#include "../hardware/memlnaut/Pins.hpp"

/**
 * @brief USeq I2C interface class for sending CV data
 *
 * This class manages I2C communication using Wire1 interface to send
 * float arrays for CV output. Designed to work with euclidean rhythm
 * generators and other musical applications.
 */
class USeqI2C {
public:
    /**
     * @brief Default I2C slave address for USeq device
     */
    static constexpr uint8_t kDefaultSlaveAddress = 1;

    /**
     * @brief Maximum number of values that can be sent in one transmission
     */
    static constexpr size_t kMaxValues = 8;

    /**
     * @brief Constructor
     * @param slave_address I2C slave address (default: 1)
     */
    explicit USeqI2C(uint8_t slave_address = kDefaultSlaveAddress);

    /**
     * @brief Destructor
     */
    ~USeqI2C();

    /**
     * @brief Initialize the I2C interface
     * @param sda_pin SDA pin number (default: USEQ_SDA from Pins.hpp)
     * @param scl_pin SCL pin number (default: USEQ_SCL from Pins.hpp)
     * @param frequency I2C frequency in Hz (default: 100000)
     * @return true if initialization successful, false otherwise
     */
    bool begin(uint8_t sda_pin = Pins::USEQ_SDA, uint8_t scl_pin = Pins::USEQ_SCL, uint32_t frequency = 1000000);

    /**
     * @brief Send a vector of float values via I2C
     * @param values Vector of float values to send
     * @return true if transmission successful, false otherwise
     */
    bool sendValues(const std::vector<float>& values);

    /**
     * @brief Send an array of float values via I2C
     * @param values Pointer to float array
     * @param count Number of values to send
     * @return true if transmission successful, false otherwise
     */
    bool sendValues(const float* values, size_t count);

    /**
     * @brief Check if I2C interface is initialized
     * @return true if initialized, false otherwise
     */
    bool isInitialized() const { return initialized_; }

    /**
     * @brief Get the current slave address
     * @return Current I2C slave address
     */
    uint8_t getSlaveAddress() const { return slave_address_; }

    /**
     * @brief Set a new slave address
     * @param slave_address New I2C slave address
     */
    void setSlaveAddress(uint8_t slave_address) { slave_address_ = slave_address; }

private:
    uint8_t slave_address_;     ///< I2C slave address
    bool initialized_;          ///< Initialization status
    float send_buffer_[kMaxValues]; ///< Internal buffer for sending data
    float read_buffer_[kMaxValues]; ///< Internal buffer for sending data

    /**
     * @brief Internal function to perform I2C transmission
     * @param data Pointer to data to send
     * @param size Size of data in bytes
     * @return true if transmission successful, false otherwise
     */
    bool transmit_(const void* data, size_t size);
};

#endif // __USEQ_I2C_HPP__
