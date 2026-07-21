/**
 * @file Pins.hpp
 * @brief Pin definitions and initialization for the FM Synth RL project
 *
 * @copyright Copyright (c) 2024. This Source Code Form is subject to the terms
 * of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed
 * with this file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

#ifndef __PINS_HPP__
#define __PINS_HPP__
#include <Arduino.h>
#include "../../PicoDefs.hpp"

/**
 * @brief Class containing all pin definitions and initialization functions
 */
class Pins {
public:
    /**
     * @name Momentary Switches
     * Digital inputs with internal pull-up resistors
     * @{
     */
    static constexpr uint8_t MOM_A1 = 24;  ///< Momentary switch A1
    static constexpr uint8_t MOM_A2 = 25;  ///< Momentary switch A2
    static constexpr uint8_t MOM_B1 = 28;  ///< Momentary switch B1
    static constexpr uint8_t MOM_B2 = 29;  ///< Momentary switch B2
    static constexpr uint8_t RE_SW = 23;   ///< Rotary encoder switch
    static constexpr uint8_t RE_B = 17;    ///< Rotary encoder B signal
    static constexpr uint8_t RE_A = 11;    ///< Rotary encoder A signal
    static constexpr uint8_t JOY_SW = 32;  ///< Joystick switch
    /** @} */

    /**
     * @name Toggle Switches
     * Digital inputs with internal pull-up resistors
     * @{
     */
    static constexpr uint8_t TOG_A1 = 26;  ///< Toggle switch A1
    static constexpr uint8_t TOG_A2 = 27;  ///< Toggle switch A2
    static constexpr uint8_t TOG_B1 = 30;  ///< Toggle switch B1
    static constexpr uint8_t TOG_B2 = 31;  ///< Toggle switch B2
    /** @} */

    /**
     * @name ADC Inputs
     * 12-bit resolution analog inputs
     * @{
     */
    static constexpr uint8_t JOY_X = 40;    ///< Joystick X-axis (ADC0)
    static constexpr uint8_t JOY_Y = 41;    ///< Joystick Y-axis (ADC1)
    static constexpr uint8_t JOY_Z = 42;    ///< Joystick Z-axis (ADC2)
    static constexpr uint8_t ADC3 = 43;    ///< Joystick Z-axis (ADC3)
    static constexpr uint8_t RV_GAIN1 = 47; ///< Gain potentiometer (ADC7)
    static constexpr uint8_t RV_Z1 = 46;    ///< Z1 potentiometer (ADC6)
    static constexpr uint8_t RV_Y1 = 45;    ///< Y1 potentiometer (ADC5)
    static constexpr uint8_t RV_X1 = 44;    ///< X1 potentiometer (ADC4)
    /** @} */

    /**
     * @name LED Pins
     * Digital output pins for LEDs
     * @{
     */
    static constexpr uint8_t LED = 33;       ///< Status LED
    static constexpr uint8_t LED_TIMING = 43; ///< Timing LED
    /** @} */

    /**
     * @name UART Pins
     * Digital pins used for UART communication
     * @{
     */
    static constexpr uint8_t DAISY_TX = 36; ///< One-way TX to Daisy (PIO software serial)
    static constexpr uint8_t SENSOR_TX = 34; ///< Sensor UART TX (Serial1)
    static constexpr uint8_t SENSOR_RX = 35; ///< Sensor UART RX (Serial1)
    static constexpr uint8_t MIDI_TX = 4;   ///< MIDI UART TX (Serial2)
    static constexpr uint8_t MIDI_RX = 5;   ///< MIDI UART RX (Serial2)
    /** @} */

    /**
     * @name SPI Pins
     * Digital pins used for SPI communication with SD card
     * @{
     */
    static constexpr uint8_t SD_CS = 13;    ///< SD card chip select
    static constexpr uint8_t SD_SCK = 14;   ///< SD card clock
    static constexpr uint8_t SD_MISO = 12;  ///< SD card MISO
    static constexpr uint8_t SD_MOSI = 15;  ///< SD card MOSI
    /** @} */

    /**
     * @name I2C Pins
     * Digital pins used for I2C communication
     * @{
     */
    static constexpr uint8_t USEQ_SDA = 38; ///< USeq I2C SDA (CV output)
    static constexpr uint8_t USEQ_SCL = 39; ///< USeq I2C SCL (CV output)
    /** @} */




    /**
     * @brief Initialize all pins with their respective modes
     */
    static void initializePins() {
        // Initialize momentary switches
        pinMode(MOM_A1, INPUT_PULLUP);
        pinMode(MOM_A2, INPUT_PULLUP);
        pinMode(MOM_B1, INPUT_PULLUP);
        pinMode(MOM_B2, INPUT_PULLUP);
        pinMode(RE_SW, INPUT_PULLUP);
        pinMode(RE_B, INPUT_PULLUP);
        pinMode(RE_A, INPUT_PULLUP);
        pinMode(JOY_SW, INPUT_PULLUP);

        // Initialize toggle switches
        pinMode(TOG_A1, INPUT_PULLUP);
        pinMode(TOG_A2, INPUT_PULLUP);
        pinMode(TOG_B1, INPUT_PULLUP);
        pinMode(TOG_B2, INPUT_PULLUP);

        // Initialize ADC pins
        pinMode(JOY_X, INPUT);
        pinMode(JOY_Y, INPUT);
        pinMode(JOY_Z, INPUT);
        pinMode(RV_GAIN1, INPUT);
        pinMode(RV_Z1, INPUT);
        pinMode(RV_Y1, INPUT);
        pinMode(RV_X1, INPUT);

        // Initialize LED pins
        pinMode(LED, OUTPUT);
        pinMode(LED_TIMING, OUTPUT);

        // Initialize UART pins (just as digital IO)
        pinMode(DAISY_TX, OUTPUT);
        pinMode(SENSOR_TX, OUTPUT);
        pinMode(SENSOR_RX, INPUT);
        pinMode(MIDI_TX, OUTPUT);
        pinMode(MIDI_RX, INPUT);

        // Initialize I2C pins (just as digital IO)
        pinMode(USEQ_SDA, OUTPUT);
        pinMode(USEQ_SCL, OUTPUT);

        // Set ADC resolution to 12 bits
        analogReadResolution(12);


        DEBUG_PRINTLN("Pins initialized.");
    }
};

#endif // __PINS_HPP__
