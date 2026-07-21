#ifndef __SYSTEM_VIEW_HPP__
#define __SYSTEM_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"
#include <deque>
#include "../common.hpp"


class SystemView : public ViewBase {
public:
    SystemView(String name)
        : ViewBase(name)
    {}

    void OnSetup() override {
    }  

    void OnDisplay() override {
        freeHeap = rp2040.getFreeHeap();
        totalHeap = rp2040.getTotalHeap();
        usedHeap = totalHeap - freeHeap;
        sys_clk = clock_get_hz(clk_sys);        
    };

    
    void OnDraw() override {
        TFT_eSprite textSprite(scr);
        textSprite.createSprite(320, 20);
        textSprite.setTextFont(2);
        scr->fillRect(area.x, area.y, area.w, area.h, TFT_BLACK);
        constexpr int32_t lineheight = 20;
        textSprite.setTextColor(TFT_WHITE, TFT_BLACK);
        std::deque<String> lines;
        lines.push_back(String("MEMLNaut ") + String(MEMLLIB_VERSION));
        lines.push_back("");
        lines.push_back("Info: https://musicallyembodiedml.github.io");
        lines.push_back("");
        lines.push_back("Build: " + String(__DATE__) + " " + String(__TIME__));
        lines.push_back("System Clock: " + String(sys_clk/1000000.f) + " MHz");
        lines.push_back("Heap: " + String(freeHeap/1024) + "k free, " +
                       String(totalHeap/1024) + "k total, " +
                       String(usedHeap/1024) + "k used");
        lines.push_back("");
        lines.push_back("Made by Chris Kiefer and Andrea Martelloni");
        lines.push_back("Emute Lab, University of Sussex, UK");

        for(size_t i=0; i < lines.size(); i++) {
            textSprite.fillRect(0,0,320,20,TFT_BLACK);
            textSprite.drawString(lines[i].c_str(), 0, 0);
            textSprite.pushSprite(area.x + 10,area.y + (i*lineheight));
        }

    }  



private:
    uint32_t freeHeap = 0;
    uint32_t totalHeap = 0;
    uint32_t usedHeap = 0;
    uint32_t sys_clk=0;

};

#endif 
