#ifndef __SINGLESELECT_VIEW_HPP__
#define __SINGLESELECT_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"
#include "../common.hpp"
#include "RotarySelectView.hpp"


class SingleSelectView : public ViewBase {
public:

    using NewSelectionCallback = std::function<void(size_t)>;


    SingleSelectView(String name)
        : ViewBase(name)
    {}

    void OnSetup() override {
        selector = std::make_shared<RotarySelectView>("Selector", TFT_WHITE);
        AddSubView(selector, { area.x + 20, area.y + 20, 280, 140 });

    }  

    void setNewVoiceCallback(NewSelectionCallback cb) {
        selector->setNewSelectionCallback(
            [cb](size_t idx) {
                cb(idx);
            }
        );
    }


    void OnDisplay() override {
    };

    
    void OnDraw() override {
    }  

    bool acceptsFocus() override {
        return true;
    }

    bool setFocus() override {
        selector->setFocus();
        redraw();
        return ViewBase::setFocus();
    }

    void removeFocus() override{
        hasFocus = false;   
    }

    void HandleRotaryEncChange(int inc) override {
        selector->HandleRotaryEncChange(inc);
    }

    virtual void HandleRotaryEncSwitch() override{
        if (isFocused()) {
            selector->removeFocus();
            removeFocus();
        }
    }

    void setOptions(std::span<String> newOptions) {
        selector->setOptions(newOptions);
    }



private:
    std::shared_ptr<RotarySelectView> selector;

};

#endif 
