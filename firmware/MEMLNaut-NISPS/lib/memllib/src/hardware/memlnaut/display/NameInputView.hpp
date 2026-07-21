#ifndef __NAME_INPUT_VIEW_HPP__
#define __NAME_INPUT_VIEW_HPP__

#include "View.hpp"
#include "ButtonView.hpp"
#include <functional>

class NameInputView : public ViewBase {
public:
    using ConfirmCallback = std::function<void(const String&)>;
    using CancelCallback  = std::function<void()>;

    NameInputView(String name) : ViewBase(name) {}

    void setCallbacks(ConfirmCallback confirm, CancelCallback cancel) {
        onConfirm = confirm;
        onCancel  = cancel;
    }

    void reset(const String& initial = "") {
        currentName = initial.substring(0, 5);
        redraw();
    }

    void OnSetup() override {
        static const char kChars[20] = {
            'A','B','C','D','E',
            'F','G','H','I','J',
            '0','1','2','3','4',
            '5','6','7','8','9'
        };

        constexpr int kBtnW   = 60;
        constexpr int kBtnH   = 30;
        constexpr int kColGap = 4;
        constexpr int kRowGap = 3;
        constexpr int kRowTop = 37;   // below filename display

        for (int r = 0; r < 4; r++) {
            for (int c = 0; c < 5; c++) {
                int idx = r * 5 + c;
                String label = String(kChars[idx]);
                auto btn = std::make_shared<ButtonView>(label, static_cast<size_t>(idx + 1), TFT_DARKGREY, TFT_WHITE, 2);
                rect bounds = {
                    area.x + 2 + c * (kBtnW + kColGap),
                    area.y + kRowTop + r * (kBtnH + kRowGap),
                    kBtnW,
                    kBtnH
                };
                AddSubView(btn, bounds);
                btn->SetReleaseCallback([this, label](size_t) {
                    if (currentName.length() < 5) {
                        currentName += label;
                        redraw();
                    }
                });
            }
        }

        // Bottom control row
        constexpr int kCtrlY = 170;
        constexpr int kCtrlH = 26;

        auto delBtn = std::make_shared<ButtonView>("DEL", 21, TFT_ORANGE, TFT_WHITE, 2);
        AddSubView(delBtn, {area.x + 2, area.y + kCtrlY, 90, kCtrlH});
        delBtn->SetReleaseCallback([this](size_t) {
            if (currentName.length() > 0) {
                currentName.remove(currentName.length() - 1);
                redraw();
            }
        });

        auto cancelBtn = std::make_shared<ButtonView>("CANCEL", 22, TFT_RED, TFT_WHITE, 2);
        AddSubView(cancelBtn, {area.x + 115, area.y + kCtrlY, 90, kCtrlH});
        cancelBtn->SetReleaseCallback([this](size_t) {
            if (onCancel) onCancel();
        });

        auto okBtn = std::make_shared<ButtonView>("OK", 23, TFT_DARKGREEN, TFT_WHITE, 2);
        AddSubView(okBtn, {area.x + 228, area.y + kCtrlY, 90, kCtrlH});
        okBtn->SetReleaseCallback([this](size_t) {
            if (onConfirm) onConfirm(currentName);
        });
    }

    void OnDraw() override {
        scr->fillRect(area.x, area.y, area.w, area.h, TFT_BLACK);

        // Filename display: 5 boxes near the top
        constexpr int kBoxW = 40;
        constexpr int kBoxH = 30;
        constexpr int kBoxGap = 4;
        const int totalBoxW = 5 * kBoxW + 4 * kBoxGap;
        const int startX = area.x + (area.w - totalBoxW) / 2;
        const int startY = area.y + 3;

        for (int i = 0; i < 5; i++) {
            int bx = startX + i * (kBoxW + kBoxGap);
            scr->drawRect(bx, startY, kBoxW, kBoxH, TFT_WHITE);
            if (i < (int)currentName.length()) {
                scr->setTextColor(TFT_YELLOW, TFT_BLACK);
                scr->setTextFont(4);
                scr->drawChar(currentName[i], bx + 10, startY + 5);
            } else {
                scr->setTextColor(TFT_DARKGREY, TFT_BLACK);
                scr->setTextFont(2);
                scr->drawChar('_', bx + 14, startY + 9);
            }
        }
    }

private:
    String currentName;
    ConfirmCallback onConfirm;
    CancelCallback  onCancel;
};

#endif // __NAME_INPUT_VIEW_HPP__
