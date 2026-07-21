#ifndef __XYPADVIEW_VIEW_HPP__
#define __XYPADVIEW_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"


class XYPadView : public ViewBase {
public:
    using OnTouchCallback = std::function<void(float, float)>;
    using OnTouchReleaseCallback = std::function<void(float, float)>;

    XYPadView(String name, int colour = TFT_GREEN)
        : ViewBase(name), colour(colour) 
    {

    }
    void SetOnTouchCallback(OnTouchCallback _cb_) {
        cb = _cb_;
    }
    void SetOnTouchReleaseCallback(OnTouchCallback _cb_) {
        cbRelease = _cb_;
    }


    void OnSetup() override {
    }  

    void OnDisplay() override {
    };

    
    void OnDraw() override {
        if (touchReleaseFlag) {
            touchReleaseFlag = false;
            if (y > area.y) {
                scr->fillRect(x, y, 10,10, TFT_BLACK);
            }
        }else if (touchDownFlag) {
            if (y > area.y) {
                scr->fillRect(x, y, 10,10, colour);
            }
            touchDownFlag = false;
        }
        Serial.printf("XYPadView OnDraw at: %d, %d\n", x, y);
    }  

    void OnTouchDown(size_t x, size_t y) override {
        // Update position based on touch coordinates
        this->x = x;
        this->y = y;
        touching = true;
        touchDownFlag = true;
        if(cb) {
            cb(x / (float)area.w, 1-(y / (float)(area.h - area.y)));
        }
        redraw();
    };  

    void OnTouchUp(size_t x, size_t y) override {
        touching = false;
        touchReleaseFlag = true;
        if(cbRelease) {
            cbRelease(x / (float)area.w, 1-(y / (float)(area.h - area.y)));
        }
        redraw();
    };



private:
    size_t x,y;
    bool touching;
    int colour = TFT_GREEN;
    bool touchReleaseFlag = false;
    bool touchDownFlag = false;
    OnTouchCallback cb = nullptr;
    OnTouchReleaseCallback cbRelease = nullptr;

};

#endif 
