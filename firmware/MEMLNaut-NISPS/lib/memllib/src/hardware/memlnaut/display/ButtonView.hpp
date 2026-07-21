#ifndef __BUTTON_VIEW_HPP__
#define __BUTTON_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"


class ButtonView : public ViewBase {
public:

    using ButtonCallback = std::function<void(size_t)>;

    ButtonView(String name, size_t _id_, int _fillcolour_ = TFT_BLUE, int _fontcolour_ = TFT_WHITE, uint8_t fontNum_ = 4)
        : ViewBase(name), fillColour(_fillcolour_), fontColour(_fontcolour_),
        id(_id_), fontNum(fontNum_)
    {
    }

    void SetReleaseCallback(ButtonCallback __callback) {
        callback = __callback;
    }

    void OnSetup() override {
    }  

    void setFillColour(int newCol) {
        fillColour = newCol;
        redraw();
    }

    void setFontColour(int newCol) {
        fontColour = newCol;
        redraw();
    }

    void setBorderWidth(int w) {
        borderWidth = w;
        redraw();
    }

    void OnDraw() override {
        TFT_eSprite sprite(scr);
        sprite.createSprite(area.w, area.h);

        sprite.fillSprite(fillColour);
        int32_t bw = pressed ? 1 : borderWidth;
        int32_t col = pressed ? TFT_RED : TFT_WHITE;
        for (int32_t i = 0; i < bw; i++) {
            sprite.drawRect(i, i, area.w - 2*i, area.h - 2*i, col);
        }
        sprite.setTextColor(fontColour);
        sprite.setTextFont(fontNum);
        sprite.drawString(this->name_, 10, 10);
        sprite.pushSprite(area.x, area.y);
        // scr->drawString("1", area.x + 10, area.y + 10);
    }  


    void OnTouchDown(size_t x, size_t y) override {
        pressed = true;
        redraw();
        // Check if the touch is within the button area
    }

    void OnTouchUp(size_t x, size_t y) override {
        if (callback) {
            callback(id);
        }
        pressed = false;
        redraw();
    }


private:
    int fillColour;
    int fontColour;
    size_t id;

    ButtonCallback callback = nullptr;

    bool pressed = false;
    uint8_t fontNum = 4;
    int32_t borderWidth = 1;
};

#endif 
