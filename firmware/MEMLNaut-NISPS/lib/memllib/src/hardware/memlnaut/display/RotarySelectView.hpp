#ifndef __ROTARY_SELECT_VIEW_HPP__
#define __ROTARY_SELECT_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"


class RotarySelectView : public ViewBase {

public:
    TFT_eSprite *sprite = nullptr;
    TFT_eSprite *sprTitle = nullptr;
    TFT_eSprite *sprMax = nullptr;

    using NewSelectionCallback = std::function<void(size_t)>;


    RotarySelectView(String name, int _fillcolour_ = TFT_BLUE)
        : ViewBase(name), fillColour(_fillcolour_)
    {
    }

    void setNewSelectionCallback(NewSelectionCallback cb) {
        newSelCB = cb;
    }


    void OnSetup() override {
        if (options.empty()) {
            options.push_back("VoiceSpace 1");
            options.push_back("VoiceSpace 2");
            options.push_back("VoiceSpace 3");
            options.push_back("VoiceSpace 4");
            options.push_back("VoiceSpace 5");
            options.push_back("VoiceSpace 6");
            options.push_back("VoiceSpace 7");
            options.push_back("VoiceSpace 8");
        }
    }  

    void OnDraw() override {
        scr->drawLine(area.x, area.y, area.x, area.y + area.h, isFocused() ? TFT_GREEN : TFT_BLUE);
        
        TFT_eSprite textSprite(scr);
        constexpr int32_t lineheight = 25;
        textSprite.createSprite(area.w-50, lineheight);
        constexpr size_t sizes[] = {1,2,2,2,1};
        constexpr size_t heights[] = {15,25,25,25,15};
        constexpr size_t indents[] = {5,10,15,10,5};
        constexpr size_t colours[] = {TFT_SILVER, TFT_SILVER, TFT_WHITE, TFT_SILVER, TFT_SILVER};
        // Serial.printf("RotarySelectView::OnDraw called, hasFocus=%d\n", isFocused());
        int heightAccum = 0;
        for(int i=0; i < 5; i++) {
            int itemIndex = selectedIndex - 2 + i;
            textSprite.fillSprite(TFT_BLACK);
            if (itemIndex < 0 || itemIndex >= options.size()) {
                //
            }else{
                if (isFocused() && (itemIndex == selectedIndex)) {
                    textSprite.setTextColor(TFT_YELLOW, TFT_BLACK);

                } else {
                    textSprite.setTextColor(colours[i], TFT_BLACK);
                }
                textSprite.setTextFont(sizes[i]);
                textSprite.drawString(options[itemIndex].c_str(), indents[i], 0);
            }
            textSprite.pushSprite(area.x + 10,area.y + 20 + heightAccum);
            heightAccum += heights[i];
        }

    }  



    void OnTouchDown(size_t x, size_t y) override {
    }

    void OnTouchUp(size_t x, size_t y) override {
        constexpr size_t heights[] = {15, 25, 25, 25, 15};
        int heightAccum = (int)area.y + 20;
        for (int i = 0; i < 5; i++) {
            if ((int)y >= heightAccum && (int)y < heightAccum + (int)heights[i]) {
                int delta = i - 2;
                int dir = delta > 0 ? 1 : -1;
                for (int s = 0; s < abs(delta); s++) HandleRotaryEncChange(dir);
                break;
            }
            heightAccum += (int)heights[i];
        }
    }


    void OnDisplay() override {
        ViewBase::OnDisplay();
    };

    void setOptions(std::span<String> newOptions) {
        options.assign(newOptions.begin(), newOptions.end());
    }

    void setSelection(size_t idx) {
        if (idx < options.size()) selectedIndex = idx;
    }

    bool acceptsFocus() override {
        return true;
    }

    bool setFocus() override {
        // Serial.println("RotarySelectView::setFocus called");
        redraw();
        return ViewBase::setFocus();
    }

    void removeFocus() override{
        ViewBase::removeFocus();
        redraw();   
    }

    void HandleRotaryEncSwitch() override {
        removeFocus();
        redraw();
    }

    void HandleRotaryEncChange(int inc) override {
        // Serial.printf("RotarySelectView::HandleRotaryEncChange called with inc=%d\n", inc);
        if (inc > 0) {
            if (selectedIndex < options.size() - 1) {
                selectedIndex++;
                if (newSelCB) newSelCB(selectedIndex);
                redraw();
            }
        } else if (inc < 0) {
            if (selectedIndex > 0) {
                selectedIndex--;
                if (newSelCB) newSelCB(selectedIndex);
                redraw();
            }
        }
    }


private:
    int fillColour;
    std::vector<String> options;
    size_t selectedIndex = 0;
    NewSelectionCallback newSelCB;
    
};

#endif 
