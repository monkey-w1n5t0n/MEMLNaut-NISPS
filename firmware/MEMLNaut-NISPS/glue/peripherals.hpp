// firmware/glue/peripherals.hpp — Joystick, buttons, toggles → mode input
// channels.
//
// The MEMLNaut hardware exposes:
//   - 3 analog joystick axes (X, Y, Z) via `setJoyXCallback` / `Y` / `Z`,
//     each delivering a float in [0, 1].
//   - Up to 5 rotary pots (RVGain1, RVZ1, RVY1, RVX1, ADC3) — same callback
//     shape.
//   - 4 momentary buttons (MomA1/2, MomB1/2) and 5 toggles (TogA1/2, TogB1/2,
//     JoySW). Buttons fire `void()` on press; toggles fire `void(bool)` on
//     edge.
//
// The `Mode` concept's input channels are abstract floats in [0, 1]. Each
// concrete mode's schema names its channels (e.g. paf_synth: joy_x, joy_y,
// joy_z, joy_w). The glue maps the *first N* analog inputs onto channels
// `[0, N)` — that's the trivial mapping that matches every concrete mode's
// schema today (joystick first, optional 4D extra pot for joy_w).
//
// Buttons drive the InteractiveML primitives directly:
//   MomA1 (TA up)    : randomise / draw weights
//   MomA2 (TA down)  : clear examples (reset dataset)
//   MomB1 (MA up)    : randomise (synonym, deliberate)
//   MomB2 (MA down)  : jolt / move_weights
//   TogB1            : add example (latched: when high, capture current
//                       inputs+outputs as a training pair)
//   TogB2            : train (rising-edge → call ml.train())
//
// This is a sparse subset of the legacy InterfaceRL — full RL UX comes back
// in stream 9 (browser) and stream 12 (firmware UI). Goal here: hardware
// can express the *abstract* RL primitives so the mode keeps moving.

#pragma once

#include <Arduino.h>

#include <array>
#include <cstddef>
#include <cstdint>

#include "../src/nisps/core/perf.hpp"
#include "../src/memllib/hardware/memlnaut/MEMLNaut.hpp"

namespace nisps_firmware {

// Number of analog input channels we forward to the mode. Modes with fewer
// inputs ignore the surplus (set_input(idx, ...) silently rejects out-of-
// range idx in ModeBase).
inline constexpr std::size_t kAnalogInputCount = 4u;  // X, Y, Z, plus one pot

// A small POD that the .ino owns. Captured by lambda below.
template <typename Mode>
struct PeripheralBindings {
    Mode* mode = nullptr;
};

// Wire all hardware → mode bindings. Must be called *after*
// MEMLNaut::Initialize() (so MEMLNaut::Instance() is valid). The Mode
// reference must outlive the program (it's a static in the .ino).
template <typename Mode>
inline void bind_peripherals(Mode& mode) {
    auto* meml = MEMLNaut::Instance();
    if (!meml) return;

    // ---- Analog inputs → mode input channels ----
    meml->setJoyXCallback([&mode](float v) { mode.set_input(0u, v); });
    meml->setJoyYCallback([&mode](float v) { mode.set_input(1u, v); });
    meml->setJoyZCallback([&mode](float v) { mode.set_input(2u, v); });
    // Fourth analog input: use ADC3 (the spare). Modes that don't expose a
    // joy_w channel just don't see it (set_input drops out-of-range idx).
    meml->setADC3Callback([&mode](float v) { mode.set_input(3u, v); });

    // ---- Rotary pots ----
    // Reuse RVGain1 as a "tempo" knob for sequencer modes. The mode is free
    // to ignore via the same channel-bounds drop. RVGain1 is also used by
    // InterfaceRL legacy as an audio output volume knob — for now we hand
    // it to the ML interface for non-sequencer modes by setting the output
    // master volume directly via AudioDriver.
    meml->setRVGain1Callback([](float v) {
        AudioDriver::SetMasterVolume(v);
    });

    // ---- Buttons / toggles → ML primitives ----
    // Button presses are momentary (rising edge only). Toggles fire on
    // both edges with the new state.

    // Randomise weights (large draw)
    meml->setMomA1Callback([&mode]() {
        mode.ml().draw_weights(mode.param_schema().default_spread);
    });

    // Clear training dataset (best-effort: if the MLP exposes reset()
    // we use it; otherwise we draw new weights as a degraded fallback).
    meml->setMomA2Callback([&mode]() {
        mode.ml().reset();
    });

    // Jolt / move_weights (positive direction)
    meml->setMomB1Callback([&mode]() {
        mode.ml().move_weights(0.5f, mode.param_schema().default_spread);
    });

    // Move weights (negative-feedback jolt — same call, different speed sign
    // would flip exploration direction; the MLP API takes magnitude).
    meml->setMomB2Callback([&mode]() {
        mode.ml().move_weights(0.25f, mode.param_schema().default_spread);
    });

    // Toggle B2: rising edge → train.
    meml->setTogB2Callback([&mode](bool state) {
        if (state) {
            (void)mode.ml().train();
        }
    });
}

}  // namespace nisps_firmware
