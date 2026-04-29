// firmware/glue/output_router.hpp — Drains mode events to hardware sinks.
//
// Two sinks today:
//   - MIDI (via midi_io.hpp's `drain_mode_events`)
//   - I2C (BreakOr's per-track CV outputs — TODO: integrate USeqI2C once
//     stream 12 lands the legacy USeqI2C cleanup)
//
// Called from loop1() at audio-rate-adjacent cadence (sub-millisecond is
// fine; MIDI bytes pace themselves through the UART DMA queue).

#pragma once

#include <memory>

#include "midi_io.hpp"

namespace nisps_firmware {

template <typename Mode>
inline void drain_outputs(std::shared_ptr<MIDIInOut> midi, Mode& mode) {
    // Sequencer modes run their event pump first, then we drain.
    if constexpr (requires { mode.pump_engine_events(); }) {
        mode.pump_engine_events();
    }
    drain_mode_events(midi, mode);
}

}  // namespace nisps_firmware
