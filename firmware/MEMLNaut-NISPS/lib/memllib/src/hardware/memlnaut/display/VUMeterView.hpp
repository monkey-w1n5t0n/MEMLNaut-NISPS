#ifndef __VUMETER_VIEW_HPP__
#define __VUMETER_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"
#include <vector>
#include <functional>
#include <cmath>

// Vertical VU meters fed from an external published level buffer (filled on the audio core).
// The view arms/disarms that measurement via onActive() as it comes on/off screen, and
// self-refreshes (~25 fps) only while it is the current view — so it costs nothing when hidden.
class VUMeterView : public ViewBase {
public:
    using OnActiveCallback = std::function<void(bool)>;

    VUMeterView(String name, std::vector<String> labels,
                const volatile float* levels, OnActiveCallback onActive)
        : ViewBase(name), labels_(std::move(labels)), levels_(levels),
          onActive_(std::move(onActive)) {}

    void OnSetup() override {
        nBars_    = labels_.size();
        slotW_    = nBars_ ? area.w / (int)nBars_ : area.w;
        barW_     = 10;
        meterTop_ = area.y + topPad_;
        meterH_   = area.h - topPad_ - labelH_;
    }

    void OnDisplay() override {
        ViewBase::OnDisplay();
        if (onActive_) onActive_(true);
        drawLabels_ = true;
        redraw();
    }

    void OnHide() override {
        if (onActive_) onActive_(false);
    }

    void OnDraw() override {
        const int bottom = meterTop_ + meterH_;
        const float gThr = 0.6f, yThr = 0.85f;  // green / yellow / red zone boundaries

        for (size_t i = 0; i < nBars_; ++i) {
            const int slotX = area.x + (int)i * slotW_;
            const int x = slotX + (slotW_ - barW_) / 2;

            float lvl = levels_ ? levels_[i] : 0.f;
            if (lvl < 0.f) lvl = 0.f; else if (lvl > 1.f) lvl = 1.f;

            // Erase the full column, then paint the lit zones from the bottom up.
            scr->fillRect(x, meterTop_, barW_, meterH_, TFT_BLACK);

            const int gPx = (int)(fminf(lvl, gThr) * meterH_);
            const int yPx = (int)(fmaxf(0.f, fminf(lvl, yThr) - gThr) * meterH_);
            const int rPx = (int)(fmaxf(0.f, lvl - yThr) * meterH_);

            if (gPx > 0) scr->fillRect(x, bottom - gPx,             barW_, gPx, TFT_GREEN);
            if (yPx > 0) scr->fillRect(x, bottom - gPx - yPx,       barW_, yPx, TFT_YELLOW);
            if (rPx > 0) scr->fillRect(x, bottom - gPx - yPx - rPx, barW_, rPx, TFT_RED);

            if (drawLabels_) {
                scr->setTextFont(2);
                scr->setTextDatum(TC_DATUM);
                scr->setTextColor(TFT_SILVER, TFT_BLACK);
                scr->drawString(labels_[i].c_str(), slotX + slotW_ / 2, bottom + 3);
            }
        }
        drawLabels_ = false;
        redraw();  // keep refreshing while we are the active view
    }

private:
    std::vector<String> labels_;
    const volatile float* levels_;
    OnActiveCallback onActive_;

    size_t nBars_ = 0;
    int slotW_ = 0, barW_ = 0;
    int meterTop_ = 0, meterH_ = 0;
    const int topPad_ = 6;
    const int labelH_ = 20;
    bool drawLabels_ = true;
};

#endif
