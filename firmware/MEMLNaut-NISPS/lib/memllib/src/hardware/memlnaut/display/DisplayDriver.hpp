#ifndef __DISPLAY_DRIVER_HPP__
#define __DISPLAY_DRIVER_HPP__

#include "View.hpp"
#include <vector>
#include <memory>
#include <algorithm>
#include <cstdint>
#include <cstddef>


#include <TFT_eSPI.h>
#include <TFT_eWidget.h>


class DisplayDriver {
public:
    DisplayDriver() {}

    void Setup();
    void Draw();
    inline void AddView(const std::shared_ptr<ViewBase> &view)
    {
        views_.push_back(view);
        view->SetGrid(grid_);
        if (tft_initialized_) {
            view->Setup(&tft_, mainArea);
        }
        redraw_internal_ = true;
    }
    inline void RegisterDialog(const std::shared_ptr<ViewBase>& view) {
        view->SetGrid(grid_);
        if (tft_initialized_) {
            view->Setup(&tft_, mainArea);
        }
    }
    inline void InsertViewAfter(const std::shared_ptr<ViewBase> &existingView, const std::shared_ptr<ViewBase> &newView)
    {
        auto it = std::find(views_.begin(), views_.end(), existingView);
        if (it != views_.end()) {
            views_.insert(it + 1, newView);
            newView->SetGrid(grid_);
            if (tft_initialized_) {
                newView->Setup(&tft_, mainArea);
            }
            redraw_internal_ = true;
        }
    }
    void PollTouch();
    unsigned long GetLastTouchTime() const { return lastTouchTime_; }
    unsigned long GetLastDrawTime() const { return lastDrawTime_; }

    void ChangeView(int delta);
    void NavigateToView(const std::shared_ptr<ViewBase>& target);
    void ShowDialog(const std::shared_ptr<ViewBase>& dialog);
    void DismissDialog();

    void RotaryIncEvent(int delta) {
        if (dialogView_) {
            dialogView_->HandleRotaryEncChange(delta);
            return;
        }
        if (currentViewIndex_ < views_.size()) {
            auto& currentView = views_[currentViewIndex_];
            if (currentView->isFocused()) {
                currentView->HandleRotaryEncChange(delta);
            }else{
                ChangeView(delta);
            }
        }
    }
    void RotarySwitchEvent() {
        if (dialogView_) {
            dialogView_->HandleRotaryEncSwitch();
            return;
        }
        if (currentViewIndex_ < views_.size()) {
            auto& currentView = views_[currentViewIndex_];
            if (currentView->isFocused()) {
                currentView->HandleRotaryEncSwitch();
            } else {
                if (currentView->setFocus()) {
                }
            }
        }
    }

private:
    // Internal TFT hardware instance
    TFT_eSPI tft_;
    

    // Views
    std::vector<std::shared_ptr<ViewBase>> views_;
    size_t currentViewIndex_;
    std::shared_ptr<ViewBase> dialogView_{nullptr};

    // Calibration
    uint16_t calData_[5] = { 421, 3470, 270, 3492, 7 };

    // Grid
    static constexpr size_t kGridWidthElements = 16;
    static constexpr size_t kGridHeightElements = 12;
    int screenWidth_;
    int screenHeight_;
    GridDef grid_;

    bool redraw_internal_{false};
    unsigned long lastTouchTime_{0};
    unsigned long lastDrawTime_{0};
    bool tft_initialized_{false};
    bool isTouchPressed_{false};

    //top bar (drawn directly to the TFT — no sprite buffers, saves ~14 KB RAM)
    rect mainArea;

    int lastTouchX, lastTouchY;

    const int topBarHeight = 30;

};


#endif // __DISPLAY_DRIVER_HPP__
