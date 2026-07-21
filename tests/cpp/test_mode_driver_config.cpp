// tests/cpp/test_mode_driver_config.cpp — the mic/line wiring, minus the
// hardware.
//
// Two halves, both of which are the parts that can actually be wrong:
//
//   1. SELECTION — what `Mode::driver_config()` resolves to per mode. This is
//      the logic the firmware reads at mode start (src/main.cpp →
//      glue/audio_driver.hpp). The interesting case is SoundAnalysisMIDIMode,
//      whose audio ENGINE is a silent NoOp while its AnalysisEngine is what
//      actually consumes the microphone; taking the engine's config there
//      would silently leave the codec on line input and defeat the mode.
//
//   2. CLAMPING — `glue/codec_config.hpp`, the only firmware-side logic in the
//      chain. Included directly (it is deliberately Arduino-free) so the
//      sample-rate resolution, which can `panic()` the device if it hands
//      `AudioDriver::GetSysClockSpeed()` a rate it has no divider for, is
//      pinned on the host.
//
// What is NOT proven here: that the SGTL5000 actually switches its input mux.
// That needs hardware.

#include "test_helpers.hpp"

#include "../../nisps/modes/breakor.hpp"
#include "../../nisps/modes/channel_strip.hpp"
#include "../../nisps/modes/elysiamorf.hpp"
#include "../../nisps/modes/external_synth_midi.hpp"
#include "../../nisps/modes/memlcelium.hpp"
#include "../../nisps/modes/paf_synth.hpp"
#include "../../nisps/modes/slp_workshop.hpp"
#include "../../nisps/modes/sound_analysis_midi.hpp"
#include "../../nisps/modes/verb_fx.hpp"
#include "../../nisps/modes/xiasri.hpp"

#include "../../firmware/MEMLNaut-NISPS/glue/codec_config.hpp"

using namespace nisps;

// ---------------------------------------------------------------------------
// 1. Per-mode selection
// ---------------------------------------------------------------------------

// The mode that exists to listen: mic input, with the analyser's pre-amp gain.
NISPS_TEST(driver_config_sound_analysis_midi_selects_mic) {
    const modes::SoundAnalysisMIDIMode mode{};
    const DriverConfig c = mode.driver_config();
    NISPS_EXPECT(c.mic_input == true);
    NISPS_EXPECT(c.mic_gain_db == 20u);
    // ...and it must NOT be the (NoOp) engine's config, which is line input.
    NISPS_EXPECT(mode.engine().driver_config().mic_input == false);
    // Same object the mode delegates to.
    NISPS_EXPECT(c.mic_input == mode.analysis().driver_config().mic_input);
    NISPS_EXPECT(c.mic_gain_db == mode.analysis().driver_config().mic_gain_db);
}

// The two input-processing modes: line input, at the level their engines ask
// for (louder than the default step, i.e. a real instrument/line source).
NISPS_TEST(driver_config_channel_strip_selects_line) {
    const modes::ChannelStripMode mode{};
    const DriverConfig c = mode.driver_config();
    NISPS_EXPECT(c.mic_input == false);
    NISPS_EXPECT(c.line_level == 6u);
    NISPS_EXPECT_NEAR(c.output_volume, 0.9f, 1e-6f);
}

NISPS_TEST(driver_config_verb_fx_selects_line) {
    const modes::VerbFXMode mode{};
    const DriverConfig c = mode.driver_config();
    NISPS_EXPECT(c.mic_input == false);
    NISPS_EXPECT(c.line_level == 6u);
    NISPS_EXPECT_NEAR(c.output_volume, 0.9f, 1e-6f);
}

NISPS_TEST(driver_config_xiasri_selects_line) {
    const DriverConfig c = modes::XIASRIMode{}.driver_config();
    NISPS_EXPECT(c.mic_input == false);
    NISPS_EXPECT(c.line_level == 6u);
}

// Synth modes: no input opinion beyond the default, own output level.
NISPS_TEST(driver_config_synth_modes_default_line) {
    for (const DriverConfig c : {modes::PAFSynthMode{}.driver_config(),
                                 modes::MEMLCeliumMode{}.driver_config(),
                                 modes::SLPWorkshopMode{}.driver_config()}) {
        NISPS_EXPECT(c.mic_input == false);
        NISPS_EXPECT(c.line_level == DriverConfig{}.line_level);
        NISPS_EXPECT_NEAR(c.output_volume, 0.9f, 1e-6f);
    }
}

// Modes that say nothing get exactly the struct defaults — which are, by
// construction, the codec setup the firmware used before any of this was
// wired. Wiring them up is a no-op, not a silent behaviour change.
NISPS_TEST(driver_config_silent_modes_get_defaults) {
    const DriverConfig def{};
    const modes::BreakOrMode breakor{};
    const modes::ElysiamorfMode elysiamorf{};
    const modes::ExternalSynthMIDIMode<midi::generated::kMoogSub37, 8u> ext{};
    for (const DriverConfig c : {breakor.driver_config(),
                                 elysiamorf.driver_config(),
                                 ext.driver_config()}) {
        NISPS_EXPECT(c.mic_input == def.mic_input);
        NISPS_EXPECT(c.line_level == def.line_level);
        NISPS_EXPECT(c.mic_gain_db == def.mic_gain_db);
        NISPS_EXPECT_NEAR(c.output_volume, def.output_volume, 1e-6f);
        NISPS_EXPECT_NEAR(c.sample_rate, 0.f, 1e-6f);
    }
}

// The defaults are load-bearing (see above): pin them to memllib's historical
// `AudioDriver::Setup()` values so a future edit has to be deliberate.
NISPS_TEST(driver_config_defaults_match_legacy_firmware_setup) {
    const DriverConfig def{};
    NISPS_EXPECT(def.mic_input == false);
    NISPS_EXPECT(def.line_level == 3u);
    NISPS_EXPECT(def.mic_gain_db == 0u);
    NISPS_EXPECT_NEAR(def.output_volume, 0.8f, 1e-6f);
    NISPS_EXPECT_NEAR(def.sample_rate, 0.f, 1e-6f);
}

// No mode may request a rate the driver cannot clock (that would panic() at
// boot). Every mode currently says "don't care"; this holds the line.
NISPS_TEST(driver_config_every_mode_requests_a_clockable_rate) {
    const float rates[] = {
        modes::PAFSynthMode{}.driver_config().sample_rate,
        modes::ChannelStripMode{}.driver_config().sample_rate,
        modes::XIASRIMode{}.driver_config().sample_rate,
        modes::VerbFXMode{}.driver_config().sample_rate,
        modes::MEMLCeliumMode{}.driver_config().sample_rate,
        modes::SLPWorkshopMode{}.driver_config().sample_rate,
        modes::BreakOrMode{}.driver_config().sample_rate,
        modes::ElysiamorfMode{}.driver_config().sample_rate,
        modes::SoundAnalysisMIDIMode{}.driver_config().sample_rate,
    };
    for (const float r : rates) {
        const std::uint32_t resolved = nisps_firmware::select_sample_rate(r);
        NISPS_EXPECT(r <= 0.f || resolved == static_cast<std::uint32_t>(r + 0.5f));
    }
}

// ---------------------------------------------------------------------------
// 2. Firmware-side clamping (glue/codec_config.hpp)
// ---------------------------------------------------------------------------

NISPS_TEST(codec_config_clamp_passes_through_valid_values) {
    DriverConfig in{};
    in.mic_input     = true;
    in.mic_gain_db   = 20u;
    in.line_level    = 6u;
    in.output_volume = 0.9f;
    const DriverConfig c = nisps_firmware::clamp_driver_config(in);
    NISPS_EXPECT(c.mic_input == true);
    NISPS_EXPECT(c.mic_gain_db == 20u);
    NISPS_EXPECT(c.line_level == 6u);
    NISPS_EXPECT_NEAR(c.output_volume, 0.9f, 1e-6f);
}

NISPS_TEST(codec_config_clamp_bounds_out_of_range_values) {
    DriverConfig hi{};
    hi.mic_gain_db   = 200u;
    hi.line_level    = 99u;
    hi.output_volume = 4.f;
    const DriverConfig c = nisps_firmware::clamp_driver_config(hi);
    NISPS_EXPECT(c.mic_gain_db == nisps_firmware::kMaxMicGainDb);
    NISPS_EXPECT(c.line_level == nisps_firmware::kMaxLineLevel);
    NISPS_EXPECT_NEAR(c.output_volume, nisps_firmware::kMaxOutputVolume, 1e-6f);

    DriverConfig lo{};
    lo.output_volume = -1.f;
    NISPS_EXPECT_NEAR(nisps_firmware::clamp_driver_config(lo).output_volume, 0.f, 1e-6f);
}

NISPS_TEST(codec_config_sample_rate_dont_care_is_48k) {
    NISPS_EXPECT(nisps_firmware::select_sample_rate(0.f) == 48000u);
    NISPS_EXPECT(nisps_firmware::select_sample_rate(-1.f) == 48000u);
}

NISPS_TEST(codec_config_sample_rate_supported_rates_pass_through) {
    NISPS_EXPECT(nisps_firmware::select_sample_rate(24000.f) == 24000u);
    NISPS_EXPECT(nisps_firmware::select_sample_rate(32000.f) == 32000u);
    NISPS_EXPECT(nisps_firmware::select_sample_rate(44100.f) == 44100u);
    NISPS_EXPECT(nisps_firmware::select_sample_rate(48000.f) == 48000u);
}

// The one that keeps the device bootable: GetSysClockSpeed() panics on these.
NISPS_TEST(codec_config_sample_rate_unsupported_falls_back_to_48k) {
    NISPS_EXPECT(nisps_firmware::select_sample_rate(96000.f) == 48000u);
    NISPS_EXPECT(nisps_firmware::select_sample_rate(22050.f) == 48000u);
    NISPS_EXPECT(nisps_firmware::select_sample_rate(1.f) == 48000u);
    NISPS_EXPECT(nisps_firmware::select_sample_rate(48001.f) == 48000u);
}
