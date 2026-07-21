#include "UIElements.hpp"

Button::Button(const char* label, uint16_t color, bool is_toggle)
    : UIElementBase(label)
    , color_(color)
    , is_toggle_(is_toggle)
    , pressedCallback_()
    , pressed_(false)
    , toggleState_(false)
    , button_(nullptr)
    , current_x_(0)
    , current_y_(0)
    , current_w_(0)
    , current_h_(0)
{
    strncpy(labelBuffer_, label, sizeof(labelBuffer_) - 1);
    labelBuffer_[sizeof(labelBuffer_) - 1] = '\0';
}

void Button::Draw() {
    if (button_) {
        button_->drawSmoothButton(toggleState_, kBorder, TFT_BLACK);
    }
}

void Button::OnSetup() {
    current_x_ = grid_.widthStep * pos_x_;
    current_y_ = grid_.heightStep * pos_y_;
    current_w_ = grid_.widthStep;
    current_h_ = grid_.heightStep;

    button_ = std::make_unique<ButtonWidget>(scr);
    button_->initButtonUL(current_x_, current_y_, current_w_, current_h_,
                         TFT_WHITE, color_, TFT_BLACK, labelBuffer_, kTextSize);
    button_->drawSmoothButton(pressed_, kBorder, TFT_BLACK);
}

void Button::SetCallback(std::function<void(bool)> callback) {
    pressedCallback_ = callback;
}

void Button::Interact(size_t x, size_t y) {
    if (button_) {
        if (button_->contains(x, y)) {
            if (!pressed_) {
                pressed_ = true;
                if (is_toggle_) {
                    toggleState_ = !toggleState_;
                } else {
                    toggleState_ = true;
                }
                button_->drawSmoothButton(toggleState_, kBorder, TFT_BLACK);
                if (pressedCallback_) {
                    pressedCallback_(toggleState_);
                }
            }
        }
    }
}

void Button::Release() {
    if (button_) {
        pressed_ = false;
        if (!is_toggle_) {
            toggleState_ = false;
        }
        button_->drawSmoothButton(toggleState_, kBorder, TFT_BLACK);
    }
}
