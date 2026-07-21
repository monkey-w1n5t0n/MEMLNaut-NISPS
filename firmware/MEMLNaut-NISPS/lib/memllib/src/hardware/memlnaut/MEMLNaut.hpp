#ifndef __MEMLNAUT_HPP__
#define __MEMLNAUT_HPP__

#include "Pins.hpp"
#include "../../utils/Debounce.hpp"
#include "../../utils/MedianFilter.h"
#include <functional>
#include <array>
#include "display/DisplayDriver.hpp"
#include "display/SystemView.hpp"
#include "SD.h"



class MEMLNaut {
public:
    using ButtonCallback = std::function<void(void)>;
    using ToggleCallback = std::function<void(bool)>;
    using AnalogCallback = std::function<void(float)>;
    using LoopCallback = std::function<void(void)>;
    using RotaryEncoderCallback = std::function<void(int)>;

private:
    static MEMLNaut* __not_in_flash("memlnaut") instance;
    static constexpr size_t NUM_ADCS = 8;
    static constexpr uint16_t DEFAULT_THRESHOLD = 40;
    static constexpr size_t FILTER_SIZE = 5;
    static constexpr float ADC_SCALE = 4128.7f;

    static constexpr size_t NUM_BUTTONS = 7;
    static constexpr size_t NUM_TOGGLES = 5;

    struct ADCState {
        float lastValue = 0.0f;
        uint16_t threshold = DEFAULT_THRESHOLD;
        AnalogCallback callback = nullptr;
    };

    std::array<ADCState, NUM_ADCS> adcStates;
    std::array<MedianFilter<uint16_t>, NUM_ADCS> adcFilters;

    std::array<ToggleDebounce, NUM_BUTTONS> debouncers;
    std::array<ToggleDebounce, NUM_TOGGLES> toggleDebouncers;

    // Callback storage
    ButtonCallback momA1Callback;
    ButtonCallback momA2Callback;
    ButtonCallback momB1Callback;
    ButtonCallback momB2Callback;
    ButtonCallback reSWCallback;
    RotaryEncoderCallback rotEncCallback;

    ToggleCallback togA1Callback;
    ToggleCallback togA2Callback;
    ToggleCallback togB1Callback;
    ToggleCallback togB2Callback;
    ToggleCallback joySWCallback;

    LoopCallback loopCallback;

    // Static interrupt handlers
    static void handleMomA1();
    static void handleMomA2();
    static void handleMomB1();
    static void handleMomB2();
    static void handleReSW();
    // static void handleReA();
    // static void handleReB();

    static void handleTogA1();
    static void handleTogA2();
    static void handleTogB1();
    static void handleTogB2();
    static void handleJoySW();
    //encoder
    static void encoder1_callback();




public:
    static inline __attribute__((always_inline)) MEMLNaut* Instance() {
        return instance;
    }

    static void Initialize(bool old_display = false) {
        if (!instance) {
            instance = new MEMLNaut(old_display);
        }
    }

    // Delete copy constructor and assignment operator
    MEMLNaut(const MEMLNaut&) = delete;
    MEMLNaut& operator=(const MEMLNaut&) = delete;

    MEMLNaut(bool old_display = false);

    void addSystemInfoView() {
        if (disp) {
            sysView = std::make_shared<SystemView>("System Info");
            disp->AddView(sysView);
        }
    }

    bool getMOMA1State() const {return digitalRead(Pins::MOM_A1) == LOW;}
    bool getMOMA2State() const {return digitalRead(Pins::MOM_A2) == LOW;}
    bool getMOMB1State() const {return digitalRead(Pins::MOM_B1) == LOW;}
    bool getMOMB2State() const {return digitalRead(Pins::MOM_B2) == LOW;}
    bool getMOMJOYSWState() const {return digitalRead(Pins::JOY_SW) == LOW;}


    // Set callbacks for momentary switches
    void setMomA1Callback(ButtonCallback cb);
    void setMomA2Callback(ButtonCallback cb);
    void setMomB1Callback(ButtonCallback cb);
    void setMomB2Callback(ButtonCallback cb);
    void setReSWCallback(ButtonCallback cb);

    // Set callbacks for toggle switches
    void setTogA1Callback(ToggleCallback cb);
    void setTogA2Callback(ToggleCallback cb);
    void setTogB1Callback(ToggleCallback cb);
    void setTogB2Callback(ToggleCallback cb);
    void setJoySWCallback(ToggleCallback cb);

    // ADC callback setters
    void setJoyXCallback(AnalogCallback cb, uint16_t threshold = DEFAULT_THRESHOLD);
    void setJoyYCallback(AnalogCallback cb, uint16_t threshold = DEFAULT_THRESHOLD);
    void setJoyZCallback(AnalogCallback cb, uint16_t threshold = DEFAULT_THRESHOLD);
    void setADC3Callback(AnalogCallback cb, uint16_t threshold = DEFAULT_THRESHOLD);
    void setRVGain1Callback(AnalogCallback cb, uint16_t threshold = DEFAULT_THRESHOLD);
    void setRVGain1Volume(uint16_t threshold = DEFAULT_THRESHOLD);
    void setRVZ1Callback(AnalogCallback cb, uint16_t threshold = DEFAULT_THRESHOLD);
    void setRVY1Callback(AnalogCallback cb, uint16_t threshold = DEFAULT_THRESHOLD);
    void setRVX1Callback(AnalogCallback cb, uint16_t threshold = DEFAULT_THRESHOLD);

    // Main loop callback setter
    void setLoopCallback(LoopCallback cb);

    void setRotaryEncoderCallback(RotaryEncoderCallback cb);



    /**
     * @brief Read all pots and switches at once. Synchronise with the
     * state of the hardware panel. Run once after all callbacks are
     * correctly created and all interfaces and references are set up.
     *
     */
    void SyncOnBoot();

    void loop();

    //display
    std::unique_ptr<DisplayDriver> disp;
    std::shared_ptr<SystemView> sysView;

    // SD
    bool startSD() {
        if (!SD.begin(Pins::SD_CS, SPI1)) {
            return false;
        }
        return true;
    }
    bool stopSD() {
        SD.end();
        Serial.println("SD card stopped");
        return true;
    }

};

#endif // __MEMLNAUT_HPP__
