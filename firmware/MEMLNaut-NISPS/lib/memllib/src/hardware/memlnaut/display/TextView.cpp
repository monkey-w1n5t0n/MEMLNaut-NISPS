#include "TextView.hpp"

TextView::TextView(String name, const char* content, uint16_t color)
    : ViewBase(name)
    , button("Press Me", 0x041f, false)
    , toggle("Toggle Me", 0x041f, true)
    , val("Value", 0, 100, 1)
    , fl("Float", 0.1f, 5.0f, 0.01f)
    , content_(content)
    , color_(color)
{}

void TextView::OnSetup() {
    // button.SetGrid(grid_, 0, 3);
    // button.Setup(tft_);
    // button.SetCallback([this](bool state) { OnButtonPressed_(state); });

    // toggle.SetGrid(grid_, 3, 3);
    // toggle.Setup(tft_);
    // toggle.SetCallback([this](bool state) { OnTogglePressed_(state); });

    // val.SetGrid(grid_, 2, 1);
    // val.Setup(tft_);
    // val.SetCallback([this](size_t value) {
    //     Serial.print("Value changed: ");
    //     Serial.println(value);
    // });

    // fl.SetGrid(grid_, 1, 1);
    // fl.Setup(tft_);
    // fl.SetCallback([this](float value) {
    //     Serial.print("Float changed: ");
    //     Serial.println(value);
    // });
}

void TextView::OnDraw() {
    scr->setTextColor(color_);
    // Draw the content at the third row, first column of the grid
    size_t gridX = 0;
    size_t gridY = 4; // Third row
    scr->drawString(content_, gridX * grid_.widthStep, gridY * grid_.heightStep, 2);
    needRedraw_ = false;
    // // Draw the button
    // button.Draw();
    // // Draw the toggle button
    // toggle.Draw();
    // // Draw the value element
    // val.Draw();
    // // Draw the float element
    // fl.Draw();
}

void TextView::OnTouchDown(size_t x, size_t y) {
    // Serial.print("TextView HandleTouch at: ");
    // Serial.print(x);
    // Serial.print(", ");
    // Serial.println(y);
    // Pass touch coordinates to the button for interaction
    button.Interact(x, y);
    toggle.Interact(x, y);
    val.Interact(x, y);
    fl.Interact(x, y);
}

void TextView::OnTouchUp(size_t x, size_t y) {
    // Serial.println("TextView HandleRelease");
    // Handle release events for the button
    //button_.Interact(0, 0); // Pass dummy coordinates since release doesn't need them
    button.Release();
    toggle.Release();
    val.Release();
    fl.Release();
}

void TextView::OnButtonPressed_(bool state) {
    Serial.print("Button pressed: ");
    Serial.println(state ? "TRUE" : "FALSE");
}
