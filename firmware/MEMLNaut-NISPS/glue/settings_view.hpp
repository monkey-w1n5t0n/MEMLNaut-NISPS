// glue/settings_view.hpp — on-device settings menu views (TFT + rotary encoder).
//
// Adds entries to the MEMLNaut display carousel (the same DisplayDriver the
// SystemView and SelfTest use). Navigation: rotate to move between views;
// press to focus a view; rotate-while-focused to change its value; press
// again to unfocus. See lib/memllib/hardware/memlnaut/display/DisplayDriver.hpp.
//
// Currently provides:
//   * Joystick: Dual / Single — for the 4-input ("two 2-D joystick") modes,
//     toggles whether the SECOND joystick (input channels 2,3) feeds the ML
//     engine. "Single" pins those channels to the neutral value (0.5) via the
//     platform-agnostic ModeBase pin mechanism, so the network is never
//     rebuilt and trained state survives toggling. Default is Dual (the 4-D
//     variant naturally uses both joysticks).
//
// Only registered for modes whose input arity is exactly 4 (the two-joystick
// modes); other modes (e.g. SoundAnalysisMIDI, whose joystick channels are not
// 2,3) get no joystick toggle.

#pragma once

#include <array>
#include <cstddef>
#include <memory>
#include <span>

#include "hardware/memlnaut/MEMLNaut.hpp"
#include "hardware/memlnaut/display/SingleSelectView.hpp"

namespace nisps_firmware {

// The second 2-D joystick maps to ML input channels 2 and 3 (joy_z / joy_w).
inline constexpr std::size_t kSecondJoystickCh0 = 2u;
inline constexpr std::size_t kSecondJoystickCh1 = 3u;

// Add the settings views for `mode` to the display carousel. Must run AFTER
// MEMLNaut::Initialize() (so the display + TFT exist) and after
// addSystemInfoView(), on core 0.
template <typename ModeT>
inline void wire_settings(ModeT& mode) {
    if constexpr (ModeT::input_channel_count() == 4u) {
        MEMLNaut* meml = MEMLNaut::Instance();
        if (!meml || !meml->disp) return;

        // Kept alive for the program lifetime (the carousel holds a shared_ptr
        // too, but this guarantees ownership regardless of view churn).
        static std::shared_ptr<SingleSelectView> joystick_view;
        joystick_view = std::make_shared<SingleSelectView>("Joystick");
        meml->disp->AddView(joystick_view);  // calls Setup() → creates the selector

        // Index 0 = Dual (default, no pinning); index 1 = Single.
        std::array<String, 2u> options = { String("Dual"), String("Single") };
        joystick_view->setOptions(std::span<String>(options.data(), options.size()));
        joystick_view->setNewVoiceCallback([&mode](std::size_t idx) {
            const bool single = (idx == 1u);
            mode.set_input_pinned(kSecondJoystickCh0, single);
            mode.set_input_pinned(kSecondJoystickCh1, single);
        });
    } else {
        (void)mode;
    }
}

}  // namespace nisps_firmware
