// tests/cpp/test_mode_breakor_events.cpp — verify the sequencer modes pump
// engine-side events through ModeBase's ControlEvent ring buffer.

#include <array>

#include "test_helpers.hpp"
#include "../../nisps/modes/breakor.hpp"
#include "../../nisps/modes/elysiamorf.hpp"
#include "../../nisps/modes/sound_analysis_midi.hpp"

using nisps::ControlEvent;

NISPS_TEST(breakor_pump_emits_clock_events) {
    nisps::modes::BreakOrMode m;
    m.setup(48000.f);
    m.set_input(0, 0.4f);
    m.set_input(1, 0.6f);
    m.tick_control();
    m.set_playing(true);
    // Run enough samples for at least one MIDI clock tick (1/24th of a beat
    // at 90 BPM ≈ 27.8 ms ≈ 1334 samples at 48k).
    for (int n = 0; n < 2000; ++n) {
        m.process({0.f, 0.f});
    }
    m.pump_engine_events();

    std::array<ControlEvent, 32u> buf;
    const std::size_t got = m.pop_control_events(std::span<ControlEvent>(buf));
    NISPS_EXPECT(got > 0u);

    bool saw_clock = false;
    for (std::size_t i = 0u; i < got; ++i) {
        if (buf[i].kind == ControlEvent::Kind::Clock) saw_clock = true;
    }
    NISPS_EXPECT(saw_clock);
}

NISPS_TEST(breakor_set_playing_false_drains_notes) {
    nisps::modes::BreakOrMode m;
    m.setup(48000.f);
    m.tick_control();
    m.set_playing(true);
    for (int n = 0; n < 5000; ++n) m.process({0.f, 0.f});
    m.set_playing(false);
    m.pump_engine_events();
    // After stop, we should see at least one Clock or NoteOff (stop drains
    // any in-flight track NoteOffs). Just verify the ring isn't empty.
    std::array<ControlEvent, 64u> buf;
    const std::size_t got = m.pop_control_events(std::span<ControlEvent>(buf));
    NISPS_EXPECT(got > 0u);
}

NISPS_TEST(elysiamorf_pump_emits_cc_events) {
    nisps::modes::ElysiamorfMode m;
    m.setup(48000.f);
    m.set_input(0, 0.5f);
    m.tick_control();
    m.set_playing(true);
    for (int n = 0; n < 4000; ++n) m.process({0.f, 0.f});
    m.pump_engine_events();

    std::array<ControlEvent, 64u> buf;
    const std::size_t got = m.pop_control_events(std::span<ControlEvent>(buf));
    NISPS_EXPECT(got > 0u);

    bool saw_cc = false;
    for (std::size_t i = 0u; i < got; ++i) {
        if (buf[i].kind == ControlEvent::Kind::ControlChange) saw_cc = true;
    }
    NISPS_EXPECT(saw_cc);
}

NISPS_TEST(sound_analysis_midi_routes_outputs_to_cc_events) {
    nisps::modes::SoundAnalysisMIDIMode m;
    m.setup(48000.f);
    // Drive a noisy input to populate analyser features.
    for (int n = 0; n < 2000; ++n) {
        const float s = static_cast<float>((n * 37) % 257) / 257.f - 0.5f;
        m.analyse({s, s});
    }
    m.set_input(6u, 0.7f);
    m.set_input(7u, 0.2f);
    m.tick_control();

    std::array<ControlEvent, 16u> buf;
    const std::size_t got = m.pop_control_events(std::span<ControlEvent>(buf));
    NISPS_EXPECT(got == 8u);
    for (std::size_t i = 0u; i < got; ++i) {
        NISPS_EXPECT(buf[i].kind == ControlEvent::Kind::ControlChange);
        NISPS_EXPECT(buf[i].data1 < 8u);   // CC numbers 0..7
        NISPS_EXPECT(buf[i].data2 <= 127u);
    }

    // The mode's audio path is a NoOp (silence-out).
    const auto y = m.process({0.5f, -0.5f});
    NISPS_EXPECT(y.L == 0.f);
    NISPS_EXPECT(y.R == 0.f);
}

NISPS_TEST(control_event_ring_buffer_overflow_drops) {
    nisps::modes::SoundAnalysisMIDIMode m;
    m.setup(48000.f);
    // Push more events than the ring can hold (kModeEventBufferSize = 64).
    // Each tick_control produces 8 CCs → ≥ 9 ticks fills the ring.
    for (int t = 0; t < 12; ++t) {
        m.tick_control();
    }
    std::array<ControlEvent, 128u> buf;
    const std::size_t got = m.pop_control_events(std::span<ControlEvent>(buf));
    NISPS_EXPECT(got <= 64u);  // ring buffer caps total capacity
    NISPS_EXPECT(got > 0u);
}
