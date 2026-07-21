#ifndef __TEXT_VIEW_HPP__
#define __TEXT_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"


class TextView : public ViewBase {
public:
    TextView(String name,      // Changed parameter type
             const char* content,    // Changed parameter type
             uint16_t color);

    void OnSetup() override;  // Changed from Setup to OnSetup
    void OnDraw() override;  // No longer takes TFT pointer
    void OnTouchDown(size_t x, size_t y) override;
    void OnTouchUp(size_t x, size_t y) override;

    Button button{"Press Me", 0x041F, false};  // Navy blue to deep blue, non-toggle
    Button toggle{"Toggle Me", 0x041F, true};  // Navy blue to deep blue, toggle
    Value<size_t> val{"Value", 0, 100, 1};  // Value element with range 0-100 and step 1
    Value<float> fl{"Float", 0.1, 5.0, 0.01};

private:
    void OnButtonPressed_(bool state);
    void OnTogglePressed_(bool state) {
        Serial.print("Toggle pressed: ");
        Serial.println(state ? "TRUE" : "FALSE");
    }
    const char* content_;    // 1st initialized
    uint16_t color_;        // 2nd initialized
};

#endif // __TEXT_VIEW_HPP__
