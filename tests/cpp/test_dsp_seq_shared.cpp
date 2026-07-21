// tests/cpp/test_dsp_seq_shared.cpp — direct coverage for the sequencer
// machinery extracted out of BreakOrEngine/ElysiamorfEngine (2026-07
// simplification audit, finding L8): nisps::ratio_seq, nisps::SeqClock, and
// nisps::EventQueue. The engines already exercise these indirectly via
// test_engine_breakor.cpp / test_engine_elysiamorf.cpp / engine_impulse.cpp;
// this file pins the shared pieces' own behavior so a future edit to any one
// consumer doesn't silently change what the others depend on.

#include <array>
#include <cstdint>

#include "test_helpers.hpp"
#include "../../nisps/core/event_queue.hpp"
#include "../../nisps/dsp/ratio_seq.hpp"
#include "../../nisps/dsp/seq_clock.hpp"

// ---------------------------------------------------------------------------
// ratio_seq<N>
// ---------------------------------------------------------------------------

NISPS_TEST(ratio_seq_gate_high_at_start_of_beat) {
    // 3 equal ratios (1,1,1), sum=3 → beats at [0, 1/3, 2/3). pulse_width=0.5
    // means the gate is high for the first half of each beat, low near the
    // end of it.
    const std::array<float, 3> ratios{1.f, 1.f, 1.f};
    NISPS_EXPECT(nisps::ratio_seq<3>(0.f,  3.f, ratios, 0.5f));   // start of beat 0 -> high
    NISPS_EXPECT(!nisps::ratio_seq<3>(0.32f, 3.f, ratios, 0.5f)); // near end of beat 0 -> low
}

NISPS_TEST(ratio_seq_gate_matches_pulse_width) {
    const std::array<float, 2> ratios{1.f, 1.f};
    // Beat 0 spans phasor [0, 0.5). Halfway through beat 0 (phasor 0.25) is
    // the midpoint of that beat -> beat_phase = 0.5, right at the pulse-width
    // boundary (inclusive).
    NISPS_EXPECT(nisps::ratio_seq<2>(0.25f, 2.f, ratios, 0.5f));
    // Just past the midpoint should drop low.
    NISPS_EXPECT(!nisps::ratio_seq<2>(0.26f, 2.f, ratios, 0.5f));
}

NISPS_TEST(ratio_seq_unequal_ratios_split_proportionally) {
    // ratios (1,3): beat 0 spans phasor [0, 0.25) (1/4 of the bar since sum=4),
    // beat 1 spans [0.25, 1.0).
    const std::array<float, 2> ratios{1.f, 3.f};
    NISPS_EXPECT(nisps::ratio_seq<2>(0.f, 4.f, ratios, 1.f));    // inside beat 0, full pulse width
    NISPS_EXPECT(nisps::ratio_seq<2>(0.3f, 4.f, ratios, 1.f));   // inside beat 1, full pulse width
    NISPS_EXPECT(!nisps::ratio_seq<2>(0.3f, 4.f, ratios, 0.01f)); // beat 1, narrow pulse -> past it
}

// ---------------------------------------------------------------------------
// SeqClock
// ---------------------------------------------------------------------------

NISPS_TEST(seq_clock_tick_bar_fires_every_seq_sample_div_samples) {
    nisps::SeqClock clock(4u);  // control-rate tick every 4 samples
    clock.update_bpm(120.f, 48000.f);
    int fired = 0;
    for (int i = 0; i < 12; ++i) {
        if (clock.tick_bar()) ++fired;
    }
    NISPS_EXPECT(fired == 3);  // samples 0, 4, 8
}

NISPS_TEST(seq_clock_bar_phasor_advances_only_on_fired_ticks) {
    nisps::SeqClock clock(4u);
    clock.update_bpm(120.f, 48000.f);
    const float p0 = clock.bar_phasor();
    NISPS_EXPECT(p0 == 0.f);
    NISPS_EXPECT(clock.tick_bar());   // sample 0 -> fires, advances
    const float p1 = clock.bar_phasor();
    NISPS_EXPECT(p1 > p0);
    NISPS_EXPECT(!clock.tick_bar());  // sample 1 -> no fire
    NISPS_EXPECT(!clock.tick_bar());  // sample 2 -> no fire
    NISPS_EXPECT(!clock.tick_bar());  // sample 3 -> no fire
    NISPS_EXPECT(clock.bar_phasor() == p1);  // unchanged while not firing
}

NISPS_TEST(seq_clock_midi_clock_wraps_and_reports_true_on_wrap) {
    nisps::SeqClock clock(400u);
    // 120 bpm -> beat = 0.5s, 24 PPQN clock tick every 0.5/24 s ≈ 20.83ms.
    // At 48kHz that's ~1000 samples/tick; drive enough samples to see at
    // least one wrap without asserting an exact count (that's the engines'
    // job in engine_impulse.cpp / test_engine_breakor.cpp).
    clock.update_bpm(120.f, 48000.f);
    int wraps = 0;
    for (int i = 0; i < 2000; ++i) {
        if (clock.tick_midi_clock()) ++wraps;
    }
    NISPS_EXPECT(wraps >= 1);
}

NISPS_TEST(seq_clock_reset_zeroes_phase_and_counter) {
    nisps::SeqClock clock(4u);
    clock.update_bpm(120.f, 48000.f);
    for (int i = 0; i < 10; ++i) clock.tick_bar();
    for (int i = 0; i < 10; ++i) clock.tick_midi_clock();
    clock.reset();
    NISPS_EXPECT(clock.bar_phasor() == 0.f);
    // After reset, the very next tick_bar() should fire again (counter==0).
    NISPS_EXPECT(clock.tick_bar());
}

// ---------------------------------------------------------------------------
// EventQueue
// ---------------------------------------------------------------------------

NISPS_TEST(event_queue_fifo_and_batch_pop) {
    nisps::EventQueue<int, 8> q;
    NISPS_EXPECT(q.empty());
    q.push(1);
    q.push(2);
    q.push(3);
    NISPS_EXPECT(q.size() == 3u);
    std::array<int, 8> buf{};
    const std::size_t n = q.pop(std::span<int>(buf));
    NISPS_EXPECT(n == 3u);
    NISPS_EXPECT(buf[0] == 1);
    NISPS_EXPECT(buf[1] == 2);
    NISPS_EXPECT(buf[2] == 3);
    NISPS_EXPECT(q.empty());
}

NISPS_TEST(event_queue_drops_on_overflow) {
    nisps::EventQueue<int, 4> q;
    for (int i = 0; i < 4; ++i) q.push(i);
    q.push(99);  // dropped — already at capacity
    NISPS_EXPECT(q.size() == 4u);
    std::array<int, 8> buf{};
    const std::size_t n = q.pop(std::span<int>(buf));
    NISPS_EXPECT(n == 4u);
    NISPS_EXPECT(buf[3] == 3);  // the dropped 99 never made it in
}

NISPS_TEST(event_queue_partial_pop_leaves_remainder) {
    nisps::EventQueue<int, 8> q;
    for (int i = 0; i < 5; ++i) q.push(i * 10);
    std::array<int, 2> small{};
    const std::size_t n = q.pop(std::span<int>(small));
    NISPS_EXPECT(n == 2u);
    NISPS_EXPECT(small[0] == 0);
    NISPS_EXPECT(small[1] == 10);
    NISPS_EXPECT(q.size() == 3u);
}

NISPS_TEST(event_queue_wraparound) {
    nisps::EventQueue<int, 4> q;
    int v = 0;
    std::array<int, 1> one{};
    for (int i = 0; i < 100; ++i) {
        q.push(i);
        NISPS_EXPECT(q.pop(std::span<int>(one)) == 1u);
        v = one[0];
        NISPS_EXPECT(v == i);
    }
    NISPS_EXPECT(q.empty());
}
