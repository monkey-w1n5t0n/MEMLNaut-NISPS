#ifndef __CC_SELECT_VIEW_HPP__
#define __CC_SELECT_VIEW_HPP__

#include "View.hpp"
#include "UIElements.hpp"
#include <vector>
#include <map>
#include <algorithm>
#include <functional>

struct CCOption {
    uint8_t num;
    String  name;
};

// Scrollable named-CC selector.
// Shows a list of CCOption entries; allows selecting up to maxActive_.
// Selection order is preserved — index in selectedCCs_ == NN output index.
// Navigate with rotary encoder (scroll) or touch (tap row). Press encoder to toggle.
class CCSelectView : public ViewBase {
public:
    using OnChangeCallback = std::function<void(const std::vector<uint8_t>&)>;
    using OnHomeChangeCallback = std::function<void()>;
    using OnSaveCallback = std::function<void()>;

    CCSelectView(size_t maxActive, String name = "MIDI CC Out")
        : ViewBase(name), maxActive_(maxActive) { lastLiveDrawn_.assign(maxActive_, -999); }

    void setOptions(std::vector<CCOption> opts) {
        options_ = std::move(opts);
    }

    void setOnChangeCallback(OnChangeCallback cb) { cb_ = cb; }
    void setOnHomeChangeCallback(OnHomeChangeCallback cb) { homeCb_ = cb; }
    // Fires when the user leaves the page or exits focus, and only if something changed.
    // Use this to persist to flash — avoids slow per-edit flash writes.
    void setOnSaveCallback(OnSaveCallback cb) { saveCb_ = cb; }

    // Clear the unsaved-changes flag (e.g. after programmatically applying a mapping, so
    // it isn't treated as a user edit needing save-on-exit).
    void resetDirty() { dirty_ = false; }

    // Opt-in: show + allow editing the per-CC home value column. Off by default so
    // modes that don't use home values render unchanged.
    void setShowHome(bool v) { showHome_ = v; }

    // Opt-in live-output column: point at an external array of the values actually being
    // sent (one per NN output slot, [0..1]). Enables the "out" column.
    void setLiveValues(const float* values) { liveValues_ = values; }

    // Repaint only the changed live-output cells. Drive this each loop from the mode;
    // it self-throttles and only redraws cells whose value changed (no flicker).
    void refreshLiveColumn() {
        if (!scr || liveValues_ == nullptr) return;
        if (!IsVisible()) { liveWasVisible_ = false; return; }
        unsigned long now = millis();
        if (liveWasVisible_ && (now - lastLiveRefreshMs_) < kLiveRefreshMs) return;
        lastLiveRefreshMs_ = now;
        if (!liveWasVisible_) {                       // force full repaint when re-shown
            std::fill(lastLiveDrawn_.begin(), lastLiveDrawn_.end(), -999);
            liveWasVisible_ = true;
        }
        for (int i = 0; i < kVisibleRows; i++) {
            size_t optIdx = scrollOffset_ + (size_t)i;
            if (optIdx >= options_.size()) break;
            int slot = slotOf(options_[optIdx].num);
            if (slot <= 0) continue;
            int val = (int)(clamp01(liveValues_[slot - 1]) * 127.f + 0.5f);
            if (slot - 1 < (int)lastLiveDrawn_.size() && val == lastLiveDrawn_[slot - 1]) continue;
            drawLiveCell(optIdx);
        }
    }

    size_t getMaxActive() const { return maxActive_; }
    const std::vector<uint8_t>& getSelectedCCs() const { return selectedCCs_; }

    void setSelectedCCs(const std::vector<uint8_t>& ccs) {
        selectedCCs_.clear();
        for (uint8_t cc : ccs) {
            if (selectedCCs_.size() >= maxActive_) break;
            selectedCCs_.push_back(cc);
        }
        std::sort(selectedCCs_.begin(), selectedCCs_.end());
        std::fill(lastLiveDrawn_.begin(), lastLiveDrawn_.end(), -999);
    }

    // Per-CC "home" values, in [0..1], keyed by CC number so they survive sorting.
    // getHomeValues() returns them aligned to getSelectedCCs() (== NN output order).
    std::vector<float> getHomeValues() const {
        std::vector<float> out;
        out.reserve(selectedCCs_.size());
        for (uint8_t cc : selectedCCs_) {
            auto it = homeByCC_.find(cc);
            out.push_back(it != homeByCC_.end() ? it->second : 0.f);
        }
        return out;
    }

    void setHomeValues(const std::vector<float>& homes) {
        for (size_t i = 0; i < selectedCCs_.size() && i < homes.size(); i++)
            homeByCC_[selectedCCs_[i]] = clamp01(homes[i]);
    }

    // Set the home of the CC currently under the cursor (if it's selected), using
    // soft pickup: when the cursor moves to a new CC the knob must first cross that
    // CC's stored home value before it takes control (avoids value jumps).
    // Returns true if a home value was actually changed.
    bool setHomeForCursor(float v) {
        if (cursorRow_ >= options_.size()) return false;   // Done row
        uint8_t cc = options_[cursorRow_].num;
        if (slotOf(cc) == 0) return false;                 // not a selected CC

        auto it = homeByCC_.find(cc);
        float target = (it != homeByCC_.end()) ? it->second : 0.f;

        if ((int)cursorRow_ != homePickupRow_) {           // arm pickup for this CC
            homePickupRow_    = (int)cursorRow_;
            homePickupCaught_ = false;
            lastHomeKnob_     = v;
        }
        if (!homePickupCaught_) {
            constexpr float eps = 0.5f / 127.f;
            bool crossed = ((v - target) <= 0.f) != ((lastHomeKnob_ - target) <= 0.f);
            float dist   = (v > target) ? (v - target) : (target - v);
            if (crossed || dist <= eps) homePickupCaught_ = true;
        }
        lastHomeKnob_ = v;
        if (!homePickupCaught_) return false;              // still seeking — don't move it

        homeByCC_[cc] = clamp01(v);
        dirty_ = true;
        drawHomeCell(cursorRow_);   // partial redraw — just the value, no full-screen flicker
        if (homeCb_) homeCb_();
        return true;
    }

    void OnSetup() override {
        // If no named options were provided, generate a generic numbered list (CC 1–127)
        if (options_.empty()) {
            for (uint8_t i = 1; i <= 127; i++)
                options_.push_back({i, "CC " + String(i)});
        }
    }

    void OnDraw() override {
        scr->fillRect(area.x, area.y, area.w, area.h, TFT_BLACK);

        // Header
        scr->setTextColor(TFT_WHITE, TFT_BLACK);
        scr->setTextFont(2);
        String hdr = String(selectedCCs_.size()) + "/" + String(maxActive_) + " assigned";
        scr->drawString(hdr, area.x + 4, area.y + 4);

        // Right-side column labels: set (home) | out (live) | cc
        scr->setTextFont(1);
        scr->setTextColor(TFT_SILVER, TFT_BLACK);
        if (showHome_)   scr->drawString("home", area.x + area.w - 116, area.y + 8);
        if (liveValues_) scr->drawString("out", area.x + area.w - 78,  area.y + 8);
        scr->drawString("cc", area.x + area.w - 40, area.y + 8);
        scr->setTextFont(2);

        // Rows (options + one trailing Done entry)
        size_t totalItems = options_.size() + 1;
        for (int i = 0; i < kVisibleRows; i++) {
            size_t optIdx = scrollOffset_ + (size_t)i;
            if (optIdx >= totalItems) break;

            int ry = area.y + kHeaderH + i * kRowH;
            bool isCursor = (optIdx == cursorRow_);
            bool isDone   = (optIdx == options_.size());

            if (isDone) {
                uint16_t bg = isCursor ? (uint16_t)TFT_DARKGREEN : (uint16_t)TFT_BLACK;
                scr->fillRect(area.x, ry, area.w, kRowH - 1, bg);
                scr->setTextFont(2);
                scr->setTextColor(TFT_WHITE, bg);
                scr->drawString("[ Done ]", area.x + 36, ry + 4);
                continue;
            }

            int slot = slotOf(options_[optIdx].num);
            bool isSel = slot > 0;

            uint16_t bg = (isSel && isCursor) ? (uint16_t)0x0660   // bright green: selected + cursor
                        : isSel               ? (uint16_t)0x0340   // dark green: selected
                        : isCursor            ? (uint16_t)TFT_NAVY // navy: cursor only
                                              : (uint16_t)TFT_BLACK;

            scr->fillRect(area.x, ry, area.w, kRowH - 1, bg);
            scr->setTextFont(2);

            if (isSel) {
                scr->setTextColor(TFT_YELLOW, bg);
                scr->drawString("[" + String(slot) + "]", area.x + 2, ry + 4);
            } else if (isCursor) {
                scr->setTextColor(TFT_YELLOW, bg);
                scr->drawString(" > ", area.x + 2, ry + 4);
            }

            scr->setTextColor(isSel ? TFT_WHITE : (isCursor ? TFT_YELLOW : TFT_SILVER), bg);
            scr->drawString(options_[optIdx].name, area.x + 36, ry + 4);

            // Home value column (0..127), shown for every CC when enabled.
            // Drawn via drawHomeCell so the partial-update path renders identically.
            if (showHome_) drawHomeCell(optIdx);

            // Live output value column (0..127), shown for selected CCs when enabled.
            if (liveValues_) drawLiveCell(optIdx);

            scr->setTextColor(0x7BEF, bg);
            scr->drawString("CC" + String(options_[optIdx].num), area.x + area.w - 40, ry + 4);
        }

        // Scroll indicator
        if (totalItems > (size_t)kVisibleRows) {
            int barH = area.h - kHeaderH;
            int indicatorH = std::max(8, (int)(barH * kVisibleRows / (int)totalItems));
            int indicatorY = area.y + kHeaderH +
                             (int)(scrollOffset_ * (barH - indicatorH) / (totalItems - kVisibleRows));
            scr->fillRect(area.x + area.w - 4, area.y + kHeaderH, 4, barH, TFT_DARKGREY);
            scr->fillRect(area.x + area.w - 4, indicatorY, 4, indicatorH, TFT_WHITE);
        }
    }

    bool acceptsFocus() override { return true; }

    bool setFocus() override {
        redraw();
        return ViewBase::setFocus();
    }

    void removeFocus() override {
        ViewBase::removeFocus();
        flushSave();   // exiting edit mode (e.g. "Done") — persist now
        redraw();
    }

    void OnHide() override {
        flushSave();   // navigated away from the page — persist now
    }

    void HandleRotaryEncChange(int inc) override {
        size_t totalItems = options_.size() + 1;
        if (inc > 0 && cursorRow_ + 1 < totalItems) {
            cursorRow_++;
            if (cursorRow_ >= scrollOffset_ + (size_t)kVisibleRows)
                scrollOffset_ = cursorRow_ - kVisibleRows + 1;
        } else if (inc < 0 && cursorRow_ > 0) {
            cursorRow_--;
            if (cursorRow_ < scrollOffset_)
                scrollOffset_ = cursorRow_;
        }
        resetHomePickup();  // moving the cursor re-arms soft pickup
        redraw();
    }

    void HandleRotaryEncSwitch() override {
        if (cursorRow_ == options_.size()) {
            removeFocus();
            redraw();
        } else {
            toggleAt(cursorRow_);
        }
    }

    void OnTouchUp(size_t tx, size_t ty) override {
        size_t totalItems = options_.size() + 1;
        for (int i = 0; i < kVisibleRows; i++) {
            int ry = area.y + kHeaderH + i * kRowH;
            if ((int)ty >= ry && (int)ty < ry + kRowH) {
                size_t optIdx = scrollOffset_ + (size_t)i;
                if (optIdx >= totalItems) return;
                cursorRow_ = optIdx;
                if (optIdx == options_.size()) {
                    removeFocus();
                    redraw();
                } else {
                    toggleAt(optIdx);
                }
                return;
            }
        }
    }

private:
    static constexpr int kRowH      = 28;
    static constexpr int kHeaderH   = 22;
    static constexpr int kVisibleRows = 6;

    size_t maxActive_;
    std::vector<CCOption> options_;
    std::vector<uint8_t> selectedCCs_;  // order = NN output index
    std::map<uint8_t, float> homeByCC_; // per-CC home value [0..1]
    bool showHome_ = false;             // render/edit the home column
    // Soft-pickup state for gain-knob home editing
    int   homePickupRow_    = -1;       // armed cursor row, -1 = not armed
    bool  homePickupCaught_ = false;    // knob has crossed the stored value
    float lastHomeKnob_     = -1.f;     // previous knob value (crossing detection)
    // Live-output column
    const float*       liveValues_  = nullptr;  // external [0..1] values per NN slot
    std::vector<int>   lastLiveDrawn_;          // last drawn 0..127 per slot (change tracking)
    bool               liveWasVisible_ = false;
    unsigned long      lastLiveRefreshMs_ = 0;
    static constexpr unsigned long kLiveRefreshMs = 50;  // ~20 Hz live readout
    size_t scrollOffset_ = 0;
    size_t cursorRow_    = 0;
    OnChangeCallback cb_;
    OnHomeChangeCallback homeCb_;
    OnSaveCallback saveCb_;
    bool dirty_ = false;   // unsaved selection/home changes

    static float clamp01(float v) { return v < 0.f ? 0.f : (v > 1.f ? 1.f : v); }

    // Draw only the home-value cell for one option row, without clearing the screen.
    // Used by OnDraw and as the partial-update path for live gain-knob edits (both run
    // in MEMLNaut::loop(), so direct drawing here doesn't race the periodic Draw()).
    void drawHomeCell(size_t optIdx) {
        if (!scr || !showHome_) return;
        if (optIdx >= options_.size()) return;
        if (optIdx < scrollOffset_ || optIdx >= scrollOffset_ + (size_t)kVisibleRows) return;
        uint8_t cc = options_[optIdx].num;
        int  slot     = slotOf(cc);
        bool isSel    = slot > 0;
        bool isCursor = (optIdx == cursorRow_);
        // Match the row background used in OnDraw so the cell blends seamlessly.
        uint16_t bg = (isSel && isCursor) ? (uint16_t)0x0660    // selected + cursor
                    : isSel               ? (uint16_t)0x0340    // selected
                    : isCursor            ? (uint16_t)TFT_NAVY  // cursor only
                                          : (uint16_t)TFT_BLACK;
        int ry = area.y + kHeaderH + (int)(optIdx - scrollOffset_) * kRowH;
        int hx = area.x + area.w - 116;
        auto it = homeByCC_.find(cc);
        float home = (it != homeByCC_.end()) ? it->second : 0.f;
        int homeInt = (int)(home * 127.f + 0.5f);
        // High-contrast on every background: white when set, red while the gain knob
        // is still seeking pickup, dim grey for unselected CCs.
        bool seeking = isSel && isCursor && !homePickupCaught_;
        uint16_t col = seeking ? (uint16_t)TFT_RED
                     : isSel   ? (uint16_t)TFT_WHITE
                               : (uint16_t)TFT_DARKGREY;
        scr->fillRect(hx, ry, 36, kRowH - 1, bg);
        scr->setTextFont(2);
        scr->setTextColor(col, bg);
        scr->drawString(String(homeInt), hx, ry + 4);
    }

    // Draw only the live-output cell for one option row (selected CCs only).
    // Shares the run-context rules of drawHomeCell (callable outside OnDraw).
    void drawLiveCell(size_t optIdx) {
        if (!scr || liveValues_ == nullptr) return;
        if (optIdx >= options_.size()) return;
        if (optIdx < scrollOffset_ || optIdx >= scrollOffset_ + (size_t)kVisibleRows) return;
        uint8_t cc = options_[optIdx].num;
        int slot = slotOf(cc);
        if (slot <= 0) return;  // only selected CCs have a live output value
        bool isCursor = (optIdx == cursorRow_);
        uint16_t bg = isCursor ? (uint16_t)0x0660 : (uint16_t)0x0340;  // selected row bg
        int ry = area.y + kHeaderH + (int)(optIdx - scrollOffset_) * kRowH;
        int lx = area.x + area.w - 78;
        int val = (int)(clamp01(liveValues_[slot - 1]) * 127.f + 0.5f);
        scr->fillRect(lx, ry, 36, kRowH - 1, bg);
        scr->setTextFont(2);
        scr->setTextColor(TFT_CYAN, bg);
        scr->drawString(String(val), lx, ry + 4);
        if (slot - 1 < (int)lastLiveDrawn_.size()) lastLiveDrawn_[slot - 1] = val;
    }

    // Returns 1-based slot number, 0 if not selected
    int slotOf(uint8_t cc) const {
        for (size_t i = 0; i < selectedCCs_.size(); i++)
            if (selectedCCs_[i] == cc) return (int)i + 1;
        return 0;
    }

    void toggleAt(size_t optIdx) {
        uint8_t ccNum = options_[optIdx].num;
        auto it = std::find(selectedCCs_.begin(), selectedCCs_.end(), ccNum);
        if (it != selectedCCs_.end()) {
            selectedCCs_.erase(it);
            homeByCC_.erase(ccNum);
        } else {
            if (selectedCCs_.size() < maxActive_) {
                selectedCCs_.push_back(ccNum);
                std::sort(selectedCCs_.begin(), selectedCCs_.end());
                homeByCC_[ccNum] = 0.f;  // default home
            }
        }
        resetHomePickup();  // selection changed — re-arm soft pickup
        std::fill(lastLiveDrawn_.begin(), lastLiveDrawn_.end(), -999);
        dirty_ = true;
        redraw();
        if (cb_) cb_(selectedCCs_);
    }

    void resetHomePickup() {
        homePickupRow_    = -1;
        homePickupCaught_ = false;
    }

    // Persist (via saveCb_) only if something changed since the last save.
    void flushSave() {
        if (dirty_ && saveCb_) saveCb_();
        dirty_ = false;
    }
};

#endif  // __CC_SELECT_VIEW_HPP__
