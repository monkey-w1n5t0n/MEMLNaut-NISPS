#ifndef __BLOCK_SELECT_VIEW_HPP__
#define __BLOCK_SELECT_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"
#include "ButtonView.hpp"


class BlockSelectView : public ViewBase {
public:
    using OnSelectCallback = std::function<void(size_t)>;

    BlockSelectView(String name, int _buttonColour_ = TFT_BLUE, size_t nButtons_=8, size_t buttonWidth_=60, size_t buttonHeight_=60, int fontColour_=TFT_WHITE, std::vector<String> buttonNames_ = {}, int buttonAltColour_=TFT_BLUE, uint8_t buttonFontNum_=4, int altFontColour_=TFT_MAROON, int32_t altBorderWidth_=3)
                : ViewBase(name), buttonColour(_buttonColour_), buttonAltColour(buttonAltColour_),
                nButtons(nButtons_), buttonWidth(buttonWidth_), buttonHeight(buttonHeight_), fontColour(fontColour_), altFontColour(altFontColour_), altBorderWidth(altBorderWidth_), buttonFontNum(buttonFontNum_)
    {
        rows = (nButtons > 4) ? 2 : 1;
        cols = (nButtons + 1) / rows;
        if (!buttonNames_.empty() && buttonNames_.size() == nButtons_) {
            buttonNames = buttonNames_;
        } else {
            for(size_t i = 1; i <= nButtons; i++) {
                buttonNames.push_back(String(i));
            }
        }
        altColour.resize(nButtons, false);
    }

    void SetOnSelectCallback(OnSelectCallback _cb_) {
        cb = _cb_;
    }

    void setAltColour(size_t index, bool on) {
        altColour[index] = on;
    }

    void toggleAlt(size_t index) {
        altColour[index] = !altColour[index];
        buttons[index]->setFillColour(altColour[index] ? buttonAltColour : buttonColour);
        buttons[index]->setFontColour(altColour[index] ? altFontColour : fontColour);
        buttons[index]->setBorderWidth(altColour[index] ? altBorderWidth : 1);
    }

    void setAltState(size_t index, bool on) {
        if (index >= buttons.size()) return;
        altColour[index] = on;
        buttons[index]->setFillColour(on ? buttonAltColour : buttonColour);
        buttons[index]->setFontColour(on ? altFontColour : fontColour);
        buttons[index]->setBorderWidth(on ? altBorderWidth : 1);
    }


    void OnSetup() override {
        int idx=1;
        for(int i=0; i < cols; i++) {
            for(int j=0; j < rows; j++) {
                if (idx <= nButtons) {
                    auto button = std::make_shared<ButtonView>(buttonNames[idx-1], idx, altColour[idx-1] ? buttonAltColour : buttonColour, fontColour, buttonFontNum);
                    rect bounds = { static_cast<int>(area.x + 10 + (i * (buttonWidth+10))), static_cast<int>(area.y + 10 + (j*(buttonHeight+10))), static_cast<int>(buttonWidth), static_cast<int>(buttonHeight) };
                    AddSubView(button, bounds);
                    button->SetReleaseCallback([this](size_t id) { 
                        if (cb) {
                            cb(id);
                        }
                    });
                    buttons.push_back(button);
                    idx++;
                }
            }
        }
    }  

    void OnDraw() override {
        TFT_eSprite textSprite(scr);
        textSprite.createSprite(320, 20);
        textSprite.setTextFont(2);
        scr->fillRect(area.x, area.y, area.w, area.h, TFT_BLACK);
        constexpr int32_t lineheight = 20;
        textSprite.setTextColor(TFT_WHITE, TFT_BLACK);
        textSprite.fillRect(0,0,320,20,TFT_BLACK);
        textSprite.drawString(msg, 3, 0);
        textSprite.pushSprite(area.x,area.y + area.h - 25);
    }  

    void updateButtonName(size_t idx, const String& newName) {
        if (idx < buttons.size()) {
            buttons[idx]->name_ = newName;
            buttons[idx]->redraw();
        }
    }

    void SetMessage(const String &__msg) {
        msg = __msg;
        redraw();
    }



private:
    std::vector<std::shared_ptr<ButtonView>> buttons;
    int buttonColour;
    int buttonAltColour;
    OnSelectCallback cb = nullptr;
    String msg;

    size_t nButtons;
    size_t rows;
    size_t cols;
    size_t buttonWidth = 50;
    size_t buttonHeight = 50;
    int fontColour = TFT_WHITE;
    int altFontColour = TFT_MAROON;
    int32_t altBorderWidth = 3;
    std::vector<String> buttonNames;
    std::vector<bool> altColour;
    uint8_t buttonFontNum = 4;
};

#endif 
