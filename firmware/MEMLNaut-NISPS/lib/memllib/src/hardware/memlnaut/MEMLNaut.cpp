#include "MEMLNaut.hpp"
#include "../../audio/AudioDriver.hpp"
#include "Arduino.h"
#include "pico/util/queue.h"

MEMLNaut* MEMLNaut::instance = nullptr;
queue_t queue_buttons_;

#define FAST_MEM __not_in_flash("memlnaut")

// struct repeating_timer FAST_MEM timerDisplay;
// inline bool __not_in_flash_func(displayUpdate)(__unused struct repeating_timer *t) {
//     MEMLNaut::Instance()->disp->Draw();
//     return true;
// }

// struct repeating_timer FAST_MEM timerTouch;
// inline bool __not_in_flash_func(touchUpdate)(__unused struct repeating_timer *t) {
//     // scr->update();
//     MEMLNaut::Instance()->disp->PollTouch();
//     return true;
// }


// Static interrupt handlers implementation
#define HANDLE_BUTTON_MACRO(handler_name, pin_name, callback_name, debouncer_index)    \
void __not_in_flash_func(MEMLNaut::handle##handler_name)() {    \
    if (instance) { \
        bool current_value = digitalRead(Pins::pin_name) == LOW; \
        /*Serial.println(String("Button ") + #pin_name + " interrupt, value: " + String(current_value));*/ \
        if (instance->debouncers[debouncer_index].debounce(current_value)) { \
            /*Serial.println("Valid input!");*/ \
            if (instance->debouncers[debouncer_index].getState()) { \
                /*Serial.println(String("Pin ") + #pin_name + " getState() = 1");*/ \
                if (instance->callback_name##Callback) { \
                    const size_t pin = Pins::pin_name; \
                    queue_add_blocking(&queue_buttons_, &pin); \
                    /*Serial.println(String("Pin ") + #pin_name + " callback!");*/ \
                    /*instance->callback_name##Callback();*/ \
                } \
            } else { \
                /*Serial.println(String("Pin ") + #pin_name + " getState() = 0");*/ \
            } \
        } \
        /*Serial.println("---");*/ \
    } \
}

HANDLE_BUTTON_MACRO(MomA1, MOM_A1, momA1, 0)
HANDLE_BUTTON_MACRO(MomA2, MOM_A2, momA2, 1)
HANDLE_BUTTON_MACRO(MomB1, MOM_B1, momB1, 2)
HANDLE_BUTTON_MACRO(MomB2, MOM_B2, momB2, 3)
HANDLE_BUTTON_MACRO(ReSW, RE_SW, reSW, 4)


void __not_in_flash_func(MEMLNaut::handleTogA1)() {
    if (instance) {
        bool should_update = instance->toggleDebouncers[0].debounce(digitalRead(Pins::TOG_A1) == LOW);
        if (should_update && instance->togA1Callback) {
            bool val = instance->toggleDebouncers[0].getState();
            instance->togA1Callback(val);
        }
    }
}
void __not_in_flash_func(MEMLNaut::handleTogA2)() {
    if (instance) {
        bool should_update = instance->toggleDebouncers[1].debounce(digitalRead(Pins::TOG_A2) == LOW);
        if (should_update && instance->togA2Callback) {
            bool val = instance->toggleDebouncers[1].getState();
            instance->togA2Callback(val);
        }
    }
}
void __not_in_flash_func(MEMLNaut::handleTogB1)() {
    if (instance) {
        bool should_update = instance->toggleDebouncers[2].debounce(digitalRead(Pins::TOG_B1) == LOW);
        if (should_update && instance->togB1Callback) {
            bool val = instance->toggleDebouncers[2].getState();
            instance->togB1Callback(val);
        }
    }
}
void __not_in_flash_func(MEMLNaut::handleTogB2)() {
    if (instance) {
        bool should_update = instance->toggleDebouncers[3].debounce(digitalRead(Pins::TOG_B2) == LOW);
        if (should_update && instance->togB2Callback) {
            bool val = instance->toggleDebouncers[3].getState();
            instance->togB2Callback(val);
        }
    }
}
void __not_in_flash_func(MEMLNaut::handleJoySW)() {
    if (instance) {
        bool should_update = instance->toggleDebouncers[4].debounce(digitalRead(Pins::JOY_SW) == LOW);
        if (should_update && instance->joySWCallback) {
            bool val = instance->toggleDebouncers[4].getState();
            instance->joySWCallback(val);
        }
    }
}

int8_t __not_in_flash_func(read_rotary)(uint8_t &prevNextCode, uint16_t &store, int a_pin, int b_pin) {
  static int8_t FAST_MEM rot_enc_table[] = { 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0 };

  prevNextCode <<= 2;
  if (digitalRead(b_pin)) prevNextCode |= 0x02;
  if (digitalRead(a_pin)) prevNextCode |= 0x01;
  prevNextCode &= 0x0f;
  // Serial.println(prevNextCode);

  // If valid then store as 16 bit data.
  if (rot_enc_table[prevNextCode]) {
    store <<= 4;
    store |= prevNextCode;
    if ((store & 0xff) == 0x2b) return -1;
    if ((store & 0xff) == 0x17) return 1;
  }
  return 0;
}

static uint8_t FAST_MEM enc1Code = 0;
static uint16_t FAST_MEM enc1Store = 0;

void __isr MEMLNaut::encoder1_callback() {
  int change = read_rotary(enc1Code, enc1Store, Pins::RE_A, Pins::RE_B);
  DEBUG_PRINTLN("Encoder1 change: " + String(change));
    if (instance && instance->rotEncCallback && change != 0) {
        instance->rotEncCallback(change);
    }

}



MEMLNaut::MEMLNaut(bool old_display) {
    instance = this;
    loopCallback = nullptr;
    // Initialize median filters
    for(auto& filter : adcFilters) {
        filter.init(FILTER_SIZE);
    }

    // Initialise all pins
    Pins::initializePins();

    // Attach momentary switch interrupts (FALLING edge)
    attachInterrupt(digitalPinToInterrupt(Pins::MOM_A1), handleMomA1, CHANGE);
    attachInterrupt(digitalPinToInterrupt(Pins::MOM_A2), handleMomA2, CHANGE);
    attachInterrupt(digitalPinToInterrupt(Pins::MOM_B1), handleMomB1, CHANGE);
    attachInterrupt(digitalPinToInterrupt(Pins::MOM_B2), handleMomB2, CHANGE);
    attachInterrupt(digitalPinToInterrupt(Pins::RE_SW), handleReSW, CHANGE);
    // attachInterrupt(digitalPinToInterrupt(Pins::RE_A), handleReA, FALLING);
    // attachInterrupt(digitalPinToInterrupt(Pins::RE_B), handleReB, FALLING);

    // Attach toggle switch interrupts (CHANGE)
    attachInterrupt(digitalPinToInterrupt(Pins::TOG_A1), handleTogA1, CHANGE);
    attachInterrupt(digitalPinToInterrupt(Pins::TOG_A2), handleTogA2, CHANGE);
    attachInterrupt(digitalPinToInterrupt(Pins::TOG_B1), handleTogB1, CHANGE);
    attachInterrupt(digitalPinToInterrupt(Pins::TOG_B2), handleTogB2, CHANGE);
    attachInterrupt(digitalPinToInterrupt(Pins::JOY_SW), handleJoySW, CHANGE);

    // Force RVGain to be master volume
    setRVGain1Volume(DEFAULT_THRESHOLD);

    //rotary encoder setup
    attachInterrupt(digitalPinToInterrupt(Pins::RE_A), encoder1_callback,
                        CHANGE);
    attachInterrupt(digitalPinToInterrupt(Pins::RE_B), encoder1_callback,
                        CHANGE);

    SPI1.setRX(Pins::SD_MISO);
    SPI1.setTX(Pins::SD_MOSI);
    SPI1.setSCK(Pins::SD_SCK);


    if (!old_display) {
        disp = std::make_unique<DisplayDriver>();
        disp->Setup();
    } else {
        disp = nullptr;
    }

    setRotaryEncoderCallback([this](int delta) {
        Serial.printf("Rotary encoder moved: %d\n", delta);
        if (disp)
            disp->RotaryIncEvent(delta);
    });

    setReSWCallback([this]() {
        if (disp)
            disp->RotarySwitchEvent();
    });
    queue_init(&queue_buttons_, sizeof(size_t), 1);
}


// Momentary switch callback setters
void MEMLNaut::setMomA1Callback(ButtonCallback cb) { momA1Callback = cb; }
void MEMLNaut::setMomA2Callback(ButtonCallback cb) { momA2Callback = cb; }
void MEMLNaut::setMomB1Callback(ButtonCallback cb) { momB1Callback = cb; }
void MEMLNaut::setMomB2Callback(ButtonCallback cb) { momB2Callback = cb; }
void MEMLNaut::setReSWCallback(ButtonCallback cb) { reSWCallback = cb; }

// Toggle switch callback setters
void MEMLNaut::setTogA1Callback(ToggleCallback cb) { togA1Callback = cb; }
void MEMLNaut::setTogA2Callback(ToggleCallback cb) { togA2Callback = cb; }
void MEMLNaut::setTogB1Callback(ToggleCallback cb) { togB1Callback = cb; }
void MEMLNaut::setTogB2Callback(ToggleCallback cb) { togB2Callback = cb; }
void MEMLNaut::setJoySWCallback(ToggleCallback cb) { joySWCallback = cb; }

// ADC callback setters
void MEMLNaut::setJoyXCallback(AnalogCallback cb, uint16_t threshold) {
    adcStates[0] = {analogRead(Pins::JOY_X) / ADC_SCALE, threshold, cb};
}
void MEMLNaut::setJoyYCallback(AnalogCallback cb, uint16_t threshold) {
    adcStates[1] = {analogRead(Pins::JOY_Y) / ADC_SCALE, threshold, cb};
}
void MEMLNaut::setJoyZCallback(AnalogCallback cb, uint16_t threshold) {
    adcStates[2] = {analogRead(Pins::JOY_Z) / ADC_SCALE, threshold, cb};
}
void MEMLNaut::setADC3Callback(AnalogCallback cb, uint16_t threshold) {
    adcStates[7] = {analogRead(Pins::ADC3) / ADC_SCALE, threshold, cb};
}
void MEMLNaut::setRVGain1Callback(AnalogCallback cb, uint16_t threshold) {
    //adcStates[3] = {analogRead(Pins::RV_GAIN1) / ADC_SCALE, threshold, cb};
    // DEBUG_PRINTLN("RVGain1 overridden - only controls audio volume");
    //this overrides the volume control
    adcStates[3] = {analogRead(Pins::RV_GAIN1) / ADC_SCALE, threshold, cb};
}

void MEMLNaut::setRVGain1Volume(uint16_t threshold) {
    adcStates[3] = {
        analogRead(Pins::RV_GAIN1) / ADC_SCALE,
        threshold,
        [] (float value) {
            AudioDriver::SetMasterVolume(value);
        }
    };
}
void MEMLNaut::setRVZ1Callback(AnalogCallback cb, uint16_t threshold) {
    adcStates[4] = {analogRead(Pins::RV_Z1) / ADC_SCALE, threshold, cb};
}
void MEMLNaut::setRVY1Callback(AnalogCallback cb, uint16_t threshold) {
    adcStates[5] = {analogRead(Pins::RV_Y1) / ADC_SCALE, threshold, cb};
}
void MEMLNaut::setRVX1Callback(AnalogCallback cb, uint16_t threshold) {
    adcStates[6] = {analogRead(Pins::RV_X1) / ADC_SCALE, threshold, cb};
}

void MEMLNaut::setRotaryEncoderCallback(RotaryEncoderCallback cb) {
    rotEncCallback = cb;
}


void MEMLNaut::setLoopCallback(LoopCallback cb) {
    loopCallback = cb;
}


size_t displayTS=0;

void MEMLNaut::loop() {

    static bool first_run = true;
    if (first_run) {
        first_run = false;
        SyncOnBoot();
    }

    // Process buttons
    size_t button_index;
    while (queue_try_remove(&queue_buttons_, &button_index)) {
        switch (button_index) {
            case Pins::MOM_A1:
                if (momA1Callback) momA1Callback();
                //Serial.println("+++ MOM_A1 asynchronous call!");
                break;
            case Pins::MOM_A2:
                if (momA2Callback) momA2Callback();
                //Serial.println("+++ MOM_A2 asynchronous call!");
                break;
            case Pins::MOM_B1:
                if (momB1Callback) momB1Callback();
                //Serial.println("+++ MOM_B1 asynchronous call!");
                break;
            case Pins::MOM_B2:
                if (momB2Callback) momB2Callback();
                //Serial.println("+++ MOM_B2 asynchronous call!");
                break;
            case Pins::RE_SW:
                if (reSWCallback) reSWCallback();
                //Serial.println("+++ RE_SW asynchronous call!");
                break;
            default:
                DEBUG_PRINTLN("MEMLNaut- Unknown button asynchronous call!");
                break;
        }
    }

    const uint8_t adcPins[NUM_ADCS] = {
        Pins::JOY_X, Pins::JOY_Y, Pins::JOY_Z,
        Pins::RV_GAIN1, Pins::RV_Z1, Pins::RV_Y1, Pins::RV_X1,
        Pins::ADC3
    };

    for (size_t i = 0; i < NUM_ADCS; i++) {
        uint16_t rawValue = analogRead(adcPins[i]);
        uint16_t filteredValue = adcFilters[i].process(rawValue);
        float currentValue = filteredValue / ADC_SCALE;
        auto& state = adcStates[i];

        if (state.callback && abs(static_cast<int>(filteredValue - (state.lastValue * ADC_SCALE))) > state.threshold) {
            state.callback(currentValue);
            state.lastValue = currentValue;
        }
    }

    if (loopCallback) {
        loopCallback();
    }


    if (disp) {
        PERIODIC_RUN(MEMLNaut::Instance()->disp->PollTouch();, 30);
        PERIODIC_RUN(MEMLNaut::Instance()->disp->Draw();, 39);
    }
}

void MEMLNaut::SyncOnBoot() {
    // Synchronize ADCs
    const uint8_t adcPins[NUM_ADCS] = {
        Pins::JOY_X, Pins::JOY_Y, Pins::JOY_Z,
        Pins::RV_GAIN1, Pins::RV_Z1, Pins::RV_Y1, Pins::RV_X1
    };
    for (size_t i = 0; i < NUM_ADCS; i++) {
        uint16_t rawValue = analogRead(adcPins[i]);
        adcFilters[i].reset(rawValue); // Reset filter to current value
        float currentValue = rawValue / ADC_SCALE;
        adcStates[i].lastValue = currentValue;
        if (adcStates[i].callback) {
            adcStates[i].callback(currentValue);
        }
    }

    // Synchronize toggle switches
    const uint8_t togglePins[NUM_TOGGLES] = {
        Pins::TOG_A1, Pins::TOG_A2, Pins::TOG_B1, Pins::TOG_B2, Pins::JOY_SW
    };
    ToggleCallback toggleCallbacks[NUM_TOGGLES] = {
        togA1Callback, togA2Callback, togB1Callback, togB2Callback, joySWCallback
    };
    for (size_t i = 0; i < NUM_TOGGLES; i++) {
        bool state = (digitalRead(togglePins[i]) == LOW);
        toggleDebouncers[i].setState(state);
        if (toggleCallbacks[i]) {
            toggleCallbacks[i](state);
        }
    }
}
