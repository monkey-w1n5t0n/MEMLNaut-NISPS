#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>
#include <WString.h>

// FocusManager — selective parameter latching for the Focus system.
//
// Interaction model:
//   selectedMask == 0  →  all params live (default, no-op)
//   selectedMask != 0  →  a param is live if any of its groups is in selectedMask,
//                         otherwise it uses its latch buffer value.
//
// Latch snapshot: setFocus() only captures params transitioning live→latched,
// so the freeze point is the exact moment a group leaves the selection.
//
// Multi-group membership: assign (kGroupA | kGroupB) to a param — it stays
// live if either group is selected.

template<size_t NPARAMS, size_t NGROUPS>
class FocusManager {
public:
    std::array<String, NGROUPS>   groupNames     = {};
    std::array<uint32_t, NPARAMS> paramGroupMask = {};

    FocusManager() {
        latchBuffer.fill(0.f);
    }

    void setGroupName(size_t groupIdx, const String& name) {
        if (groupIdx < NGROUPS) groupNames[groupIdx] = name;
    }

    void setParamGroups(const std::array<uint32_t, NPARAMS>& masks) {
        paramGroupMask = masks;
    }

    // Change focus selection. Snapshots only params transitioning live→latched.
    void setFocus(uint32_t newMask, const std::vector<float>& live) {
        for (size_t i = 0; i < NPARAMS && i < live.size(); i++) {
            const bool wasLive = (selectedMask == 0) || ((paramGroupMask[i] & selectedMask) != 0);
            const bool willBeLive = (newMask == 0) || ((paramGroupMask[i] & newMask) != 0);
            if (wasLive && !willBeLive) {
                latchBuffer[i] = live[i];
            }
        }
        selectedMask = newMask;
    }

    // Apply focus filter in place. No-op when selectedMask == 0.
    void applyInPlace(std::vector<float>& params) const {
        if (selectedMask == 0) return;
        for (size_t i = 0; i < NPARAMS && i < params.size(); i++) {
            if ((paramGroupMask[i] & selectedMask) == 0) {
                params[i] = latchBuffer[i];
            }
        }
    }

    uint32_t getSelectedMask() const { return selectedMask; }

    bool isGroupSelected(size_t groupIdx) const {
        return (selectedMask & (1u << groupIdx)) != 0;
    }

private:
    std::array<float, NPARAMS> latchBuffer  = {};
    uint32_t                   selectedMask = 0;
};
