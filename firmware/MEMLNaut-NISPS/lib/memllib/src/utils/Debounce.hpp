#ifndef __DEBOUNCE_HPP__
#define __DEBOUNCE_HPP__

#include <Arduino.h>

class ButtonDebounce {
private:
    static constexpr unsigned long kHaltTime_ms = 50;
    unsigned long lastPressTime_ms = 0;

public:
    bool debounce() {
        unsigned long currentTime = millis();
        if (currentTime - lastPressTime_ms >= kHaltTime_ms) {
            lastPressTime_ms = currentTime;
            return true;
        }
        return false;
    }
    void setState(bool pressed) {
        if (pressed) {
            lastPressTime_ms = millis() - kHaltTime_ms;
        } else {
            lastPressTime_ms = millis();
        }
    }
};

class ToggleDebounce {
private:
    static constexpr unsigned long kHaltTime_ms = 50;
    unsigned long lastChangeTime_ms = 0;
    bool lastState = false;
    bool lastState_internal_ = false;
    bool stateChanged = false;

public:
    bool debounce(bool currentState) {
        unsigned long currentTime = millis();
        bool shouldUpdate = false;

        //Serial.println(String("Pin state: ") + (currentState ? "1" : "0"));
        //Serial.println(String("Last state: ") + (lastState_internal_ ? "1" : "0"));
        //Serial.println(String("Time since last change: ") + (currentTime - lastChangeTime_ms) + " ms");

        if (currentState != lastState_internal_ &&
            currentTime - lastChangeTime_ms >= kHaltTime_ms) {
            lastChangeTime_ms = currentTime;
            lastState = currentState;
            shouldUpdate = true;
            //Serial.println(String("State updated to ") + (lastState ? "1" : "0"));
        }
        lastState_internal_ = currentState;
        return shouldUpdate;
    }

    bool getState() const {
        return lastState;
    }
    void setState(bool state) {
        lastState = state;
        lastChangeTime_ms = millis() - kHaltTime_ms;
    }
};

#endif // __DEBOUNCE_HPP__
