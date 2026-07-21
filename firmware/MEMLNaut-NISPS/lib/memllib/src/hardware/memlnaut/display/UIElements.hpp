#ifndef __UI_ELEMENTS_HPP__
#define __UI_ELEMENTS_HPP__

#include <TFT_eSPI.h>
#include <TFT_eWidget.h>
#include <functional>
#include <string>
#include "../../../utils/Format.hpp"


struct GridDef {
    size_t widthElements;
    size_t heightElements;
    size_t widthStep;
    size_t heightStep;
};

struct rect {
    int x,  y,  w,  h;
};

class UIElementBase {
public:
    UIElementBase() = delete; // Prevent instantiation of base class
    virtual ~UIElementBase() = default; // Virtual destructor
    void Setup(TFT_eSPI* tft) {  // Changed to non-virtual like ViewBase
        scr = tft;
        OnSetup();  // Call virtual setup hook
    }
    virtual void OnSetup() = 0;  // New virtual setup hook
    virtual void Draw() = 0; // No longer needs TFT parameter
    virtual void Interact(size_t x, size_t y) = 0; // Handle interaction events
    virtual void Release() = 0; // Handle release events
    void SetGrid(const GridDef &grid, size_t pos_x, size_t pos_y) {
        grid_ = grid;
        pos_x_ = pos_x;
        pos_y_ = pos_y;
    }
protected:
    explicit UIElementBase(const char* label) : label_(label), scr(nullptr) {}  // Changed to const char*
    GridDef grid_; // Grid definition for layout
    size_t pos_x_{0}; // Position in grid X
    size_t pos_y_{0}; // Position in grid Y
    const char* label_;  // Changed to const char*
    TFT_eSPI* scr;  // Added tft pointer
};


class Button : public UIElementBase {
public:
    static constexpr size_t kBorder = 3;
    static constexpr size_t kTextSize = 1;

    Button(const char* label, uint16_t color, bool is_toggle = false);
    ~Button() = default;

    void Draw() override;
    void OnSetup() override;
    void SetCallback(std::function<void(bool)> callback);
    void Interact(size_t x, size_t y) override;
    void Release() override;

protected:
    uint16_t color_;
    bool is_toggle_;
    std::function<void(bool)> pressedCallback_;
    bool pressed_;
    bool toggleState_{false};  // Track toggle state
    std::unique_ptr<ButtonWidget> button_;
    char labelBuffer_[32];  // Fixed buffer for button label
    uint16_t current_x_{0};
    uint16_t current_y_{0};
    uint16_t current_w_{0};
    uint16_t current_h_{0};
};


/**
 * @brief Class showing a value (name and value) on the display.
 * It can be incremented or decremented by a step value, e.g. by an
 * encoder or a button.
 *
 * @tparam T
 */
template <typename T>
class Value : public UIElementBase {
public:

    static constexpr size_t kTextSize = 1;
    static constexpr size_t kValueSize = 2;
    static constexpr size_t kSpacingTop = 16;
    static constexpr size_t kSpacingBottom = 5;

    Value(const char* label, T min, T max, T step)
        : UIElementBase(label)
        , value_(min)
        , min_(min)
        , max_(max)
        , step_(step)
    {
        snprintf(labelBuffer_, sizeof(labelBuffer_), "%s", label);
    }
    ~Value() = default;

    void Draw() override
    {
        if (scr == nullptr) {
            return;  // Ensure tft is initialized
        }

        // Calculate background color
        uint16_t bgColor = selected_ ? scr->color565(64, 80, 96) : TFT_BLACK;

        // Fill background
        scr->fillRect(current_x_, current_y_, current_w_, current_h_, bgColor);

        // Draw the label with consistent background
        scr->setTextSize(kTextSize);
        scr->setTextColor(TFT_WHITE, bgColor);
        scr->setTextDatum(TC_DATUM); // Center text
        scr->drawString(labelBuffer_, current_x_ + (current_w_ >> 1), current_y_ + kSpacingTop);
        scr->setTextSize(kValueSize);
        // Draw the value in the line below
        char valueBuffer[6];
        formatNumber(valueBuffer, value_);  // Format the value
        size_t y = current_y_ + kSpacingTop + kTextSize * 8 + kSpacingBottom;
        scr->drawString(valueBuffer, current_x_ + (current_w_ >> 1), y);
        scr->setTextSize(1);  // Reset text size
        scr->setTextDatum(TL_DATUM); // Reset text datum
    }
    void OnSetup() override
    {
        value_ = min_;  // Initialize value to min
        current_x_ = pos_x_ * grid_.widthStep;
        current_y_ = pos_y_ * grid_.heightStep;
        current_w_ = grid_.widthStep;
        current_h_ = grid_.heightStep;
        selected_ = false;  // Default not selected
    };
    void SetValue(T value)
    {
        if (value < min_) {
            value = min_;
        } else if (value > max_) {
            value = max_;
        }
        if (value == value_) {
            return;  // No change
        }
        value_ = value;
        // Trigger callback
        if (valueChangedCallback_) {
            valueChangedCallback_(value_);
        }
        Draw();
    }
    T GetValue() const { return value_; }
    void Increment(bool up = true)
    {
        if (!selected_) {
            return;  // Only increment if selected
        }
        if (up) {
            SetValue(value_ + step_);
        } else {
            // Check that decrementing does not go below min
            // (robust to unsigned types)
            if (value_ <= min_) {
                return;  // Do not decrement below min
            }
            SetValue(value_ - step_);
        }
    }
    void SetCallback(std::function<void(T)> callback)
    {
        valueChangedCallback_ = std::move(callback);
    }
    void Interact(size_t x, size_t y) override
    {
        bool wasSelected = selected_;  // Store previous selection state
        // Select the value element if within bounds
        if (x >= current_x_ && x < current_x_ + current_w_ &&
            y >= current_y_ && y < current_y_ + current_h_) {
            selected_ = true;  // Mark as selected
        } else {
            selected_ = false;  // Deselect if outside bounds
        }
        if (selected_ != wasSelected) {
            // Redraw if selection state changed
            Draw();
        }
    }
    void Release() override
    {
        // Nothing for now
    }

protected:

    T value_;
    T min_;
    T max_;
    T step_;
    bool selected_ = false;  // Moved initialization to declaration
    std::function<void(T)> valueChangedCallback_;  // Default constructor is fine
    char labelBuffer_[32];
    uint16_t current_x_{0};
    uint16_t current_y_{0};
    uint16_t current_w_{0};
    uint16_t current_h_{0};
};


#endif  // __UI_ELEMENTS_HPP__
