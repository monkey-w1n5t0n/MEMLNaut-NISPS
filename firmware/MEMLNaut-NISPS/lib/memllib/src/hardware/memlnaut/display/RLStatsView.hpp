#ifndef __RLSTATSVIEW_VIEW_HPP__
#define __RLSTATSVIEW_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"
#include "GraphView.hpp"


class RLStatsView : public ViewBase {
public:

    static constexpr size_t NPOINTS = 50;
    RLStatsView(String name)
        : ViewBase(name)
    {

    }

    void OnSetup() override {
        // rect bounds = { area.x + 10 + (i * 60), area.y + 10 + (j*60), 50, 50 };
        graphActorGNorm = std::make_shared<GraphView<NPOINTS>>("Loss", TFT_BLUE);
        // graphCriticLoss = std::make_shared<GraphView<NPOINTS>>("Critic Loss", TFT_RED);
        AddSubView(graphActorGNorm, { area.x + 10, area.y + 10, 300, 90 });
        // AddSubView(graphCriticLoss, { area.x + 10, area.y + 10+100, 300, 90 });

    }  

    void OnDisplay() override {

    };
    
    void OnDraw() override {
        // TFT_eSprite textSprite(scr);
        // textSprite.createSprite(120, 20);
        // textSprite.setTextFont(2);
        // auto drawText = [&textSprite, this](size_t x, size_t y, const String& item, const int colour) {
        //     scr->fillRect(area.x + x,area.y+y,120,20,TFT_BLACK);
        //     textSprite.fillSprite(TFT_BLACK);
        //     textSprite.setTextColor(colour, TFT_BLACK);
        //     textSprite.drawString(item.c_str(), 0, 0);
        //     textSprite.pushSprite(area.x + x,area.y + y);
        // };
        // constexpr int32_t lineheight = 20;
        // drawText(10, 1 * lineheight, "Actor gnorm:", itemColour);
        // drawText(150, 1 * lineheight,  String(actorGradNorm).c_str(), valueColour);

        // drawText(10, 2 * lineheight, "Critic Loss:", itemColour);

        // drawText(150, 2 * lineheight,  String(criticLoss).c_str(), valueColour);
    }  

    void setLoss(float v) {
        // actorGradNorm = v;
        graphActorGNorm->addDataPoint(v);
        redraw();
    }

    void setCriticLoss(float loss) {
        // criticLoss = loss;
        graphCriticLoss->addDataPoint(loss);
        redraw();
    }

private:
    const int itemColour = TFT_WHITE;
    const int valueColour = TFT_YELLOW;
    float actorGradNorm = 0.f;
    float criticLoss = 0.f;
    // #define GRAPHSIZE 100
    // std::array<float, GRAPHSIZE> histGnorm, histCriticLoss;
    // size_t indexGnorm=0, indexCriticLoss=0;
    std::shared_ptr<GraphView<NPOINTS>> graphActorGNorm, graphCriticLoss;

    
};

#endif 
