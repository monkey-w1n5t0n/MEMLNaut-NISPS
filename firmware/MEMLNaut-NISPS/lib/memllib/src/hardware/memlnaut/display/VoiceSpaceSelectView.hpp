#ifndef __VOICESPACESELECT_VIEW_HPP__
#define __VOICESPACESELECT_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"
#include "../common.hpp"
#include "RotarySelectView.hpp"


class VoiceSpaceSelectView : public ViewBase {
public:

    using NewVoiceCallback = std::function<void(size_t)>;


    VoiceSpaceSelectView(String name)
        : ViewBase(name)
    {}

    void OnSetup() override {
        voiceSpaceSelector = std::make_shared<RotarySelectView>("VoiceSpace", TFT_WHITE);
        AddSubView(voiceSpaceSelector, { area.x + 20, area.y + 20, 280, 140 });

    }  

    void setNewVoiceCallback(NewVoiceCallback cb) {
        voiceSpaceSelector->setNewSelectionCallback(
            [cb](size_t idx) {
                cb(idx);
            }
        );
    }


    void OnDisplay() override {
    };

    
    void OnDraw() override {
        TFT_eSprite textSprite(scr);
        textSprite.createSprite(area.w, 20);
        textSprite.fillSprite(TFT_BLACK);
        textSprite.setTextColor(TFT_WHITE, TFT_BLACK);
        textSprite.setTextFont(2);
        textSprite.drawString(isFocused() ? "Press to confirm" : "Press to select", 10, 0);
        textSprite.pushSprite(area.x, area.y + 165);
    }

    bool acceptsFocus() override {
        return true;
    }

    bool setFocus() override {
        // Serial.println("VoiceSpaceSelectView::setFocus called");
        voiceSpaceSelector->setFocus();
        redraw();
        return ViewBase::setFocus();
    }

    void removeFocus() override{
        hasFocus = false;
        redraw();
    }

    void HandleRotaryEncChange(int inc) override {
        voiceSpaceSelector->HandleRotaryEncChange(inc);
    }

    virtual void HandleRotaryEncSwitch() override{
        if (isFocused()) {
            voiceSpaceSelector->removeFocus();
            removeFocus();
        }
    }

    void setOptions(std::span<String> newOptions) {
        voiceSpaceSelector->setOptions(newOptions);
    }

    void setSelection(size_t idx) {
        voiceSpaceSelector->setSelection(idx);
        redraw();
    }



private:
    std::shared_ptr<RotarySelectView> voiceSpaceSelector;

};

#endif 
