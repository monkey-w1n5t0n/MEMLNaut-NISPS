#ifndef __GRAPH_VIEW_HPP__
#define __GRAPH_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"


template<size_t NPOINTS=128>
class GraphView : public ViewBase {

public:
    TFT_eSprite *sprite = nullptr;
    TFT_eSprite *sprTitle = nullptr;
    TFT_eSprite *sprMax = nullptr;

    GraphView(String name, int _fillcolour_ = TFT_BLUE)
        : ViewBase(name), fillColour(_fillcolour_)
    {
    }


    void OnSetup() override {
        graphHeight = area.h - 20;
        xstep = static_cast<float>(area.w) / static_cast<float>(NPOINTS - 1);

        sprite = new TFT_eSprite(scr);
        sprite->createSprite(area.w, graphHeight);

        sprTitle = new TFT_eSprite(scr);
        sprTitle->createSprite(100,20);

        sprMax = new TFT_eSprite(scr);
        sprMax->createSprite(100,15);

        sprTitle->fillSprite(TFT_BLACK);
        sprTitle->setTextColor(TFT_SILVER, TFT_BLACK);
        sprTitle->setTextFont(2);
        sprTitle->drawString(this->name_, 0, 0);




    }  

    void OnDraw() override {
        // scr->fillRect(area.x, area.y, area.w, area.h, TFT_BLUE);
        // if (pressed) {
        //     scr->drawRect(area.x, area.y, area.w, area.h, TFT_RED);
        // } else {
        //     scr->drawRect(area.x, area.y, area.w, area.h, TFT_WHITE);
        // }
        // scr->setTextColor(TFT_WHITE);
        // scr->setTextFont(4);
        // scr->drawString(this->name_, area.x + 10, area.y + 10);
        // scr->drawString("1", area.x + 10, area.y + 10);
        // for(size_t i = 0; i < NPOINTS-1; i++) {
        //     scr->drawLine(oldGraphPoints[i].x, oldGraphPoints[i].y, oldGraphPoints[i+1].x, oldGraphPoints[i+1].y, TFT_BLACK);
        // }
        sprite->fillSprite(TFT_BLACK);
        for(size_t i = 0; i < NPOINTS-1; i++) {
            sprite->drawLine(graphPoints[i].x, graphPoints[i].y, graphPoints[i+1].x, graphPoints[i+1].y, fillColour);
        }

        sprite->pushSprite(area.x, area.y+20);
        if (redrawMax) {
            sprMax->fillSprite(TFT_BLACK);
            sprMax->setTextColor(TFT_SILVER, TFT_BLACK);
            sprMax->setTextFont(1);
            sprMax->drawString((String("max: ") + String(ymax)).c_str(), 0, 0);
            sprMax->pushSprite(area.x+area.w-110, area.y);
            redrawMax = false;
        }
        if (redrawTitle) {
            sprTitle->pushSprite(area.x, area.y);
            redrawTitle = false;
        }
        sprTitle->pushSprite(area.x, area.y);

    }  



    void OnTouchDown(size_t x, size_t y) override {
    }

    void OnTouchUp(size_t x, size_t y) override {
    }

    void addDataPoint(float value) {
        if (IsVisible()) {

            dataPoints[dataPointIndex] = value;
            ymax = -std::numeric_limits<float>::infinity();
            ymin = std::numeric_limits<float>::infinity();
            for(size_t i = 0; i < NPOINTS; i++) {
                if (dataPoints[i] > ymax) {
                    ymax = dataPoints[i];
                }
                // if (dataPoints[i] < xmin) {
                    // xmin = dataPoints[i];
                // }
            }
            redrawMax = oldyMax != ymax;
            oldyMax = ymax;

            ymin = 0.f;
            yrange = ymax - ymin;
            if (yrange < 0.00001f) {
                yrange = 0.00001f;
            }
            yrangeInv = 1.f / yrange;
            for(size_t i = 0; i < NPOINTS; i++) {
                oldGraphPoints[i] = {graphPoints[i].x, graphPoints[i].y};
                size_t index = (dataPointIndex + i + 1) % NPOINTS;
                int graphX = static_cast<int>(static_cast<float>(i) * xstep);
                int graphY = graphHeight - static_cast<int>((dataPoints[index]-ymin) * yrangeInv * graphHeight);
                graphPoints[i] = { graphX, graphY };
            }
            dataPointIndex = (dataPointIndex + 1) % NPOINTS;
            // for(size_t i=0; i < 10; i++) {
            //     Serial.printf("(%d,%d),", oldGraphPoints[i].x, oldGraphPoints[i].y);
            // }
            // Serial.println(" ");
            // for(size_t i=0; i < 10; i++) {
            //     Serial.printf("(%d,%d),", graphPoints[i].x, graphPoints[i].y);
            // }
            // Serial.println("\n --------- ");
            redraw();
        }
    }

    void OnDisplay() override {
        ViewBase::OnDisplay();
        for(size_t i = 0; i < NPOINTS; i++) {
            graphPoints[i] = { static_cast<int>(i*xstep), 0 };
        }
        redrawMax = true;
        redrawTitle = true;
        redraw();
    };


private:
    struct Point {
        int x=0;
        int y=0;
    };

    int fillColour;
    std::array<float, NPOINTS> dataPoints{0.0f};
    std::array<Point, NPOINTS> graphPoints{}, oldGraphPoints{};
    size_t dataPointIndex = 0;
    float xstep=1;
    float ymax, ymin,yrange, yrangeInv;
    float graphHeight = 1;
    float oldyMax = 0.f;
    bool redrawMax=true;
    bool redrawTitle=true;
};

#endif 
