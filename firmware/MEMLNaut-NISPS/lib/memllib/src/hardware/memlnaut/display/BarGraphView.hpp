#ifndef __BARGRAPH_VIEW_HPP__
#define __BARGRAPH_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"


class BarGraphView : public ViewBase {
public:
    BarGraphView(String name, size_t nOutputs, int barwidth = 2, int colour = TFT_GREEN, float rangeLow=0.f, float rangeHigh=1.f)
        : ViewBase(name), colour(colour), barwidth(barwidth), oldValues(nOutputs, 0.0f), newValues(nOutputs, 0.0f),
          rangeLow(rangeLow), rangeHigh(rangeHigh), runningMax(nOutputs,0), runningMin(nOutputs,0)  
    {

    }

    void OnSetup() override {
        offsetX = 5;
        offsetY = 5;
        barSectionWidth = (area.w - (2 * offsetX)) / static_cast<float>(newValues.size());
        barSectionHeight = area.h - (2 * offsetY);
        rangeTotal = rangeHigh - rangeLow;
        rangeTotalInv = 1.f / rangeTotal;
    }  

    void OnDisplay() override {
    };

    void setSpectrumColors(uint16_t low, uint16_t high) {
        spectrumLow_ = low;
        spectrumHigh_ = high;
        useSpectrum_ = true;
    }

    void setNumDisplayBars(size_t n) {
        if (n == 0 || n == newValues.size()) return;
        newValues.assign(n, 0.f);
        oldValues.assign(n, 0.f);
        runningMax.assign(n, 0.f);
        runningMin.assign(n, 0.f);
        if (area.w > 0) {
            barSectionWidth = (area.w - (2 * offsetX)) / static_cast<float>(n);
            if (scr) scr->fillRect(area.x, area.y, area.w, area.h, TFT_BLACK);
        }
        redraw();
    }

    void UpdateValues(const std::vector<float>& values, bool resetMinMax=false) {
        size_t n = std::min(values.size(), newValues.size());
        for(size_t i=0; i < n; i++) {
            newValues[i] = values[i];
        }
        if (resetMinMax) {
            runningMax = values;
            runningMin = values;
        }
        redraw();
    }

    
    void OnDraw() override {
        for(size_t i=0; i < newValues.size(); i++) {
            float newVal = newValues[i];
            // if (newVal < rangeLow) {
            //     newVal = rangeLow;
            // } else if (newVal > rangeHigh) {
            //     newVal = rangeHigh;
            // }
            float normalizedNewValue = (newVal - rangeLow) * rangeTotalInv;
            int newBarHeight = static_cast<int>(normalizedNewValue * barSectionHeight);

            float oldVal = oldValues[i];
            // if (newVal < rangeLow) {
            //     newVal = rangeLow;
            // } else if (newVal > rangeHigh) {
            //     newVal = rangeHigh;
            // }
            float normalizedOldValue = (oldVal - rangeLow) * rangeTotalInv;
            int oldBarHeight = static_cast<int>(normalizedOldValue * barSectionHeight);

            int x = area.x + offsetX + static_cast<int>(i * barSectionWidth);
            
            int newy = area.y + area.h - offsetY - newBarHeight;
            int oldy = area.y + area.h - offsetY - oldBarHeight;

            // if (newy < oldy) {
            //     scr->fillRect(x,oldy,barwidth,oldy-newy,TFT_BLACK); 
            // }else{
            //     scr->fillRect(x,newy,barwidth,newy-oldy,colour); 
            // }
            // scr->drawLine(x,oldy, x+barwidth, oldy, TFT_BLACK);
            // scr->drawLine(x,newy, x+barwidth, newy, colour);
            uint16_t barColour = useSpectrum_
                ? lerpRGB565(spectrumLow_, spectrumHigh_, normalizedNewValue)
                : static_cast<uint16_t>(colour);
            scr->fillRect(x, oldy, barwidth, 4, TFT_BLACK);
            scr->fillRect(x, newy, barwidth, 4, barColour);

            // Update running max/min
            //TODO: what happens after reset?

            // if (newValues[i] > runningMax[i]) {

            //     float normalizedOldMaxValue = (runningMax[i] - rangeLow) * rangeTotalInv;
            //     int oldMaxBarHeight = static_cast<int>(normalizedOldMaxValue * barSectionHeight);
            //     int oldmaxy = area.y + area.h - offsetY - oldMaxBarHeight;
            //     scr->drawLine(x,oldmaxy, x+barwidth, oldmaxy, TFT_BLACK);

            //     runningMax[i] = newValues[i];

            //     normalizedOldMaxValue = (runningMax[i] - rangeLow) * rangeTotalInv;
            //     oldMaxBarHeight = static_cast<int>(normalizedOldMaxValue * barSectionHeight);
            //     oldmaxy = area.y + area.h - offsetY - oldMaxBarHeight;
            //     scr->drawLine(x,oldmaxy, x+barwidth, oldmaxy, TFT_PINK);
            // }
            // if (newValues[i] < runningMin[i]) {

            //     float normalizedOldMinValue = (runningMin[i] - rangeLow) * rangeTotalInv;
            //     int oldMinBarHeight = static_cast<int>(normalizedOldMinValue * barSectionHeight);
            //     int oldminy = area.y + area.h - offsetY - oldMinBarHeight;
            //     scr->drawLine(x,oldminy, x+barwidth, oldminy, TFT_BLACK);

            //     runningMin[i] = newValues[i];

            //     normalizedOldMinValue = (runningMin[i] - rangeLow) * rangeTotalInv;
            //     oldMinBarHeight = static_cast<int>(normalizedOldMinValue * barSectionHeight);
            //     oldminy = area.y + area.h - offsetY - oldMinBarHeight;
            //     scr->drawLine(x,oldminy, x+barwidth, oldminy, TFT_PINK);
            // }
        }
        oldValues = newValues;  // Update old values after drawing
        drawnValues = true;
    }  



private:
    static uint16_t lerpRGB565(uint16_t c1, uint16_t c2, float t) {
        int r = ((c1 >> 11) & 0x1F) + static_cast<int>((static_cast<int>((c2 >> 11) & 0x1F) - static_cast<int>((c1 >> 11) & 0x1F)) * t);
        int g = ((c1 >>  5) & 0x3F) + static_cast<int>((static_cast<int>((c2 >>  5) & 0x3F) - static_cast<int>((c1 >>  5) & 0x3F)) * t);
        int b = ( c1        & 0x1F) + static_cast<int>((static_cast<int>( c2        & 0x1F) - static_cast<int>( c1        & 0x1F)) * t);
        return (static_cast<uint16_t>(r) << 11) | (static_cast<uint16_t>(g) << 5) | static_cast<uint16_t>(b);
    }

    std::vector<float> newValues, oldValues;
    int colour = TFT_GREEN;
    int barwidth = 2;
    bool useSpectrum_{false};
    uint16_t spectrumLow_{TFT_GREEN};
    uint16_t spectrumHigh_{TFT_BLUE};
    float rangeLow = 0.0f;
    float rangeHigh = 1.0f;
    float rangeTotal=1.f;
    float rangeTotalInv=1.f;

    int offsetX, offsetY;
    float barSectionWidth, barSectionHeight;
    bool drawnValues = false;

    std::vector<float> runningMax, runningMin;

};

#endif 
