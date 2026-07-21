#include "View.hpp"

void ViewBase::Setup(TFT_eSPI* tft, rect bounds) {
    scr = tft;
    needRedraw_ = true;
    area = bounds;
    OnSetup();
}

bool ViewBase::NeedRedraw() {
    bool ret = needRedraw_;
    needRedraw_ = false;
    return ret;
}
