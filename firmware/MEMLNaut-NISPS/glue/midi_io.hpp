// firmware/glue/midi_io.hpp — Bridge MIDIInOut <-> Mode.
//
// Two directions:
//
// IN  (MIDI bytes from UART → Mode):
//     - Note on/off: dispatched to mode.note_on/note_off if the mode
//       provides them (PAFSynth, MEMLCelium). Otherwise dropped.
//     - BPM (tempo) update: dispatched to mode.update_bpm if available
//       (BreakOr, Elysiamorf).
//     - Transport (start/stop): dispatched to mode.set_playing if available.
//
// OUT (Mode ControlEvent ring → MIDI bytes):
//     - Drained on the firmware loop1() at audio-rate-adjacent cadence.
//     - NoteOn/NoteOff/CC/Clock are translated to MIDIInOut queue calls
//       and flushed once per drain cycle.
//
// All cross-thread comms uses memllib's existing pico queue (in-bound MIDI
// callbacks fire on core 1; mode events are pushed on the audio thread).
// The mode's RingBuffer is SPSC-safe; we don't need an extra queue here.

#pragma once

#include <Arduino.h>

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include "nisps/modes/base.hpp"
#include "interface/MIDIInOut.hpp"

namespace nisps_firmware {

// Bind incoming MIDI to the mode. Sets the note + bpm + transport callbacks
// on the MIDIInOut interface. Type-trait dispatch ensures we only attach
// callbacks the mode supports.
template <typename Mode>
inline void bind_midi_input(std::shared_ptr<MIDIInOut> midi, Mode& mode) {
    if (!midi) return;

    // Note callback — modes that handle notes expose `note_on(byte, byte)`
    // and `note_off(byte)`.
    midi->SetNoteCallback([&mode](bool note_on, uint8_t note, uint8_t vel) {
        if constexpr (requires { mode.note_on(note, vel); }) {
            if (note_on) mode.note_on(note, vel);
        }
        if constexpr (requires { mode.note_off(note); }) {
            if (!note_on) mode.note_off(note);
        }
    });

    // BPM updates from MIDI clock.
    if constexpr (requires { mode.update_bpm(120.f); }) {
        midi->SetBPMCallback([&mode](float bpm) {
            mode.update_bpm(bpm);
        });
    }

    // Transport (start/stop).
    if constexpr (requires { mode.set_playing(true); }) {
        midi->SetTransportCallback([&mode](bool playing) {
            mode.set_playing(playing);
        });
    }
}

// Drain the mode's ControlEvent ring and dispatch each event to MIDI out.
// Called at ~1 kHz from loop1(). Non-blocking; no allocations.
template <typename Mode>
inline void drain_mode_events(std::shared_ptr<MIDIInOut> midi, Mode& mode) {
    if (!midi) return;
    std::array<::nisps::ControlEvent, 32u> buf{};
    const std::size_t n = mode.pop_control_events(std::span<::nisps::ControlEvent>(buf));
    for (std::size_t i = 0u; i < n; ++i) {
        const auto& e = buf[i];
        switch (e.kind) {
            case ::nisps::ControlEvent::Kind::NoteOn:
                midi->queueNoteOn(e.data1, e.data2);
                break;
            case ::nisps::ControlEvent::Kind::NoteOff:
                midi->queueNoteOff(e.data1, e.data2);
                break;
            case ::nisps::ControlEvent::Kind::ControlChange:
                midi->queueCC(e.data1, e.data2);
                break;
            case ::nisps::ControlEvent::Kind::Clock:
                midi->queueClock();
                break;
            case ::nisps::ControlEvent::Kind::None:
            default:
                break;
        }
    }
    if (n > 0u) {
        (void)midi->flushQueue();
    }
}

}  // namespace nisps_firmware
