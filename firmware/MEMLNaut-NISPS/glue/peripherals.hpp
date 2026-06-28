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
// Buttons/toggles drive the SHARED ExploreAndPlace lifecycle. The authoritative
// per-control mapping is documented at the binding site below; in summary:
//   MomA1 (TA up)    : enter / exit explore (toggle)
//   MomA2 (TA down)  : like — freeze current scratchpad output (begin place)
//   MomB1 (MA up)    : Exploring → reroll scratchpad; Idle → grab (reposition)
//   MomB2 (MA down)  : Exploring → nudge scratchpad; Repositioning → drop+train
//   TogB1            : Jolt — held continuous weight morph (up=morph, down=freeze)
//   TogB2            : commit place (rising-edge) — store +1 example + train
//   RVX1             : exploration amount (Ornstein-Uhlenbeck output walk)
//
// The button block below wires the SHARED ExploreAndPlace lifecycle
// (nisps/ml/feedback.hpp, the same core the browser drives via WASM) to the
// hardware buttons. See the per-button mapping at the binding site.
//
// FOLLOW-UP (needs a firmware build to verify — no arduino-cli here): while the
// controller is PLACING, the audition should hold feedback.static_output()
// (the frozen vector) instead of running fresh inference. That requires a hook
// in the control path (tick_control / audio_driver) to consult
// feedback.static_output() before ml().process() — not yet wired here because
// the controller lives in this translation unit. Wiring the buttons is the
// deliverable; the audition-hold is a small follow-up.

#pragma once

#include <Arduino.h>

#include <array>
#include <cstddef>
#include <cstdint>

#include "../src/nisps/core/perf.hpp"
#include "../src/nisps/ml/feedback.hpp"
#include "../src/memllib/hardware/memlnaut/MEMLNaut.hpp"

namespace nisps_firmware {

// Salt matching nisps/wasm/bindings.cpp so the firmware FeedbackController's
// per-instance Rng stream is independent of (and reproducible against) the
// MLP's inference/move RNG — same discipline as the browser.
inline constexpr std::uint64_t kFeedbackSalt = 0xFEEDBACC0DEull;

// Firmware undo-ring depth for ExploreAndPlace (rl-feedback-design §2.2: WASM
// D=4, firmware D=2 — SRAM budget).
inline constexpr std::size_t kFirmwareUndoDepth = 2u;

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

    // RVX1 → exploration amount. Drives the Ornstein-Uhlenbeck random walk
    // added to the mode's output vector (nisps/ml/ou_noise.hpp, ported from
    // upstream InterfaceRL). 0 = off (inert); turning it up makes the sound
    // slowly roam so likes/dislikes can steer the net. Available on every
    // mode via ModeBase::set_explore_intensity.
    meml->setRVX1Callback([&mode](float v) {
        mode.set_explore_intensity(v);
    });

    // ---- Buttons / toggles → ExploreAndPlace lifecycle (SHARED C++ core) ----
    //
    // The same nisps::ml::FeedbackController that runs in the browser (via
    // WASM) drives the Idle → Exploring → Placing → Idle state machine here.
    // The HARDWARE button mapping differs from the browser's on_down/on_up
    // default policy — firmware maps its buttons to the GRANULAR core methods:
    //
    //   MomA1 (TA up)   : down  — enter explore (Idle→Exploring) /
    //                             exit explore (Exploring→Idle) TOGGLE
    //   MomB1 (MA up)   : STATE-GATED — Exploring: reroll the scratchpad;
    //                             Idle: GRAB (begin reposition — freeze the
    //                             current trained-net output to carry it).
    //   MomB2 (MA down) : STATE-GATED — Exploring: nudge (small perturbation);
    //                             Repositioning: DROP (commit the carried output
    //                             at the current joystick input + train).
    //   MomA2 (TA down) : like — begin place (Exploring→Placing, freeze output)
    //   TogB2 (rising)  : up   — commit place (Placing→Idle) at the CURRENT
    //                            joystick input, then store the +1 example and
    //                            train (caller owns training). Outside Placing,
    //                            a plain train().
    //
    // The controller is a function-local static so it lives for the whole
    // program (like the mode). It is seeded off the same salt as the browser.
    using FB = nisps::ml::FeedbackController<typename Mode::ML, kFirmwareUndoDepth>;
    static FB feedback(static_cast<std::uint64_t>(0xC0FFEEu) ^ kFeedbackSalt);
    feedback.set_mode(nisps::ml::FeedbackMode::ExploreAndPlace, mode.ml());

    const float spread = mode.param_schema().default_spread;

    // MomA1: enter/exit explore toggle.
    meml->setMomA1Callback([&mode]() {
        if (feedback.explore_state() == nisps::ml::ExploreState::Idle) {
            feedback.enter_explore(mode.ml(), mode.param_schema().default_spread);
        } else {
            feedback.exit_explore(mode.ml());
        }
    });

    // MomB1: STATE-GATED.
    //   Exploring → reroll the scratchpad (a fresh random sound).
    //   Idle      → GRAB: begin a reposition. Freezes the output currently heard
    //               from the trained net so the user can carry it to a new input
    //               location (the 4D variant has no joystick button, so the
    //               grab/drop gesture lives on this momentary toggle). The real
    //               net is NOT set aside — only the heard output is frozen.
    meml->setMomB1Callback([&mode]() {
        switch (feedback.explore_state()) {
            case nisps::ml::ExploreState::Exploring:
                feedback.reroll(mode.ml(), mode.param_schema().default_spread);
                break;
            case nisps::ml::ExploreState::Idle:
                feedback.begin_reposition(mode.ml());  // process + capture + hold
                break;
            case nisps::ml::ExploreState::Placing:
                break;  // already holding — ignore
        }
    });

    // MomB2: STATE-GATED.
    //   Exploring     → nudge the scratchpad (small bounded perturbation).
    //   Repositioning → DROP: commit the carried output at the CURRENT joystick
    //                   input, store the +1 example (new input → carried output)
    //                   and warm-start train. This is the "move an existing
    //                   positive example to a new position" gesture.
    meml->setMomB2Callback([&mode]() {
        if (feedback.explore_state() == nisps::ml::ExploreState::Exploring) {
            feedback.nudge(mode.ml(), 0.05f);
            return;
        }
        if (feedback.repositioning()) {
            // Capture the current joystick input — the DESTINATION position.
            const auto in = mode.input_channels();
            std::array<float, Mode::ML::kInput> features{};
            for (std::size_t i = 0; i < Mode::ML::kInput; ++i) {
                features[i] = (i < in.size()) ? in[i] : 0.f;
            }
            feedback.commit_reposition();  // no weight restore (net never set aside)
            const auto label = feedback.committed_output();  // the carried output
            if (!label.empty()) {
                mode.ml().add_example(
                    std::span<const float>(features.data(), Mode::ML::kInput), label);
                (void)mode.ml().train();
            }
        }
    });

    // MomA2: like → begin place. Freezes the current scratchpad output so the
    // user can move the joystick to choose WHERE to place it.
    meml->setMomA2Callback([&mode]() {
        feedback.begin_place(mode.ml());
    });

    // TogB1: Jolt — held continuous weight morph (nisps/ml/jolt.hpp, ported
    // from upstream InterfaceRL). Flip up to start morphing a scatter of
    // weights live; flip down to freeze them (the change is permanent) and
    // let the learning rate ramp gently back in. A toggle (not a momentary)
    // because Jolt is a HELD gesture and momentary buttons only fire on
    // press. Available on every mode via ModeBase::jolt_press/jolt_release.
    meml->setTogB1Callback([&mode](bool state) {
        if (state) mode.jolt_press();
        else       mode.jolt_release();
    });

    // TogB2 (rising): up → commit place at the current joystick input, then
    // store the +1 example (input → placed output) and train. Outside Placing,
    // just train (legacy behaviour).
    meml->setTogB2Callback([&mode](bool state) {
        if (!state) return;
        if (feedback.placing()) {
            // Capture the current joystick input BEFORE the restore.
            const auto in = mode.input_channels();
            std::array<float, Mode::ML::kInput> features{};
            for (std::size_t i = 0; i < Mode::ML::kInput; ++i) {
                features[i] = (i < in.size()) ? in[i] : 0.f;
            }
            feedback.commit_place(mode.ml());  // restores the real net
            // CALLER owns training: add the +1 example then warm-start train.
            const auto label = feedback.committed_output();  // valid post-commit
            if (!label.empty()) {
                mode.ml().add_example(
                    std::span<const float>(features.data(), Mode::ML::kInput), label);
                (void)mode.ml().train();
            }
        } else {
            (void)mode.ml().train();
        }
    });
}

}  // namespace nisps_firmware
