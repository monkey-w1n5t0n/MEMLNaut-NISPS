#ifndef __RL_VIEW_HPP__
#define __RL_VIEW_HPP__

#include "View.hpp"
#include "BarGraphView.hpp"

class RLView : public ViewBase {
public:
    static constexpr int kStatusBarHeight = 20;

    RLView(String name, size_t nOutputs, int barwidth = 2, int colour = TFT_GREEN,
           float rangeLow = 0.f, float rangeHigh = 1.f)
        : ViewBase(name)
        , barGraph(std::make_shared<BarGraphView>(name, nOutputs, barwidth, colour, rangeLow, rangeHigh))
    {}

    void OnSetup() override {
        rect barArea = getBarGraphArea();
        AddSubView(barGraph, barArea);
        barGraph->setSpectrumColors(TFT_GREEN, TFT_BLUE);
    }

    // View re-shown (driver cleared the screen): repaint every field.
    void OnDisplay() override {
        lossDirty_ = countsDirty_ = actionDirty_ = true;
        needRedraw_ = true;
        for (auto& subview : subviews) subview->OnDisplay();
    }

    void OnDraw() override {
        // No field marked => this OnDraw was triggered by an external full repaint
        // (driver fillScreen + redraw()), so redraw all three fields. Otherwise only
        // the field whose value changed is repainted, avoiding whole-line flicker.
        if (!lossDirty_ && !countsDirty_ && !actionDirty_)
            lossDirty_ = countsDirty_ = actionDirty_ = true;

        const int barY = area.y + area.h - kStatusBarHeight;
        scr->setTextFont(1);
        scr->setTextColor(TFT_WHITE, TFT_BLACK);
        if (lossDirty_) {
            scr->fillRect(area.x, barY, 100, kStatusBarHeight, TFT_BLACK);
            scr->drawString(("L:" + String(loss_, 4)).c_str(), area.x + 2, barY + 4);
            lossDirty_ = false;
        }
        if (countsDirty_) {
            scr->fillRect(area.x + 100, barY, 100, kStatusBarHeight, TFT_BLACK);
            scr->drawString(("y:" + String(posCount_) + " n:" + String(negCount_)).c_str(), area.x + 100, barY + 4);
            countsDirty_ = false;
        }
        if (actionDirty_) {
            scr->fillRect(area.x + 200, barY, area.w - 200, kStatusBarHeight, TFT_BLACK);
            scr->drawString(lastAction_.c_str(), area.x + 200, barY + 4);
            actionDirty_ = false;
        }
    }

    void UpdateValues(const std::vector<float>& values, bool resetMinMax = false) {
        barGraph->UpdateValues(values, resetMinMax);
    }

    // Safe to call from ISR — only updates state and sets dirty/redraw flags, no direct SPI.
    // Each setter marks only its own field so OnDraw repaints just that part of the bar.
    void setLoss(float v) {
        if (v != loss_) { loss_ = v; lossDirty_ = true; needRedraw_ = true; }
    }
    void setMemoryCounts(size_t pos, size_t neg) {
        if (pos != posCount_ || neg != negCount_) {
            posCount_ = pos;
            negCount_ = neg;
            countsDirty_ = true;
            needRedraw_ = true;
        }
    }
    void setLastAction(const String& a) {
        if (a != lastAction_) { lastAction_ = a; actionDirty_ = true; needRedraw_ = true; }
    }
    void setNoiseActive(bool active) {
        if (active != noiseActive_) {
            noiseActive_ = active;
            if (active) {
                barGraph->setSpectrumColors(TFT_RED, TFT_YELLOW);
            } else {
                barGraph->setSpectrumColors(TFT_GREEN, TFT_BLUE);
            }
            barGraph->redraw();
        }
    }

protected:
    virtual rect getBarGraphArea() const {
        return {area.x, area.y, area.w, area.h - kStatusBarHeight};
    }

private:
    std::shared_ptr<BarGraphView> barGraph;
    float loss_{0.f};
    size_t posCount_{0};
    size_t negCount_{0};
    String lastAction_{""};
    bool noiseActive_{false};
    bool lossDirty_{true};
    bool countsDirty_{true};
    bool actionDirty_{true};
};

#endif // __RL_VIEW_HPP__
