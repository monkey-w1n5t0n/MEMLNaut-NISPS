// tests/cpp/test_mode_concepts.cpp — compile-time check that every
// concrete mode in nisps/modes/ satisfies the `nisps::Mode` concept.
//
// Failure here = compilation failure; if this TU compiles, the assertions
// have already passed. The runtime test bodies just sanity-check schema
// metadata (mode_id, input_channel_count, schema sizes match expectations).

#include "test_helpers.hpp"

#include "../../nisps/modes/breakor.hpp"
#include "../../nisps/modes/channel_strip.hpp"
#include "../../nisps/modes/elysiamorf.hpp"
#include "../../nisps/modes/memlcelium.hpp"
#include "../../nisps/modes/paf_synth.hpp"
#include "../../nisps/modes/slp_workshop.hpp"
#include "../../nisps/modes/sound_analysis_midi.hpp"
#include "../../nisps/modes/verb_fx.hpp"
#include "../../nisps/modes/xiasri.hpp"

using namespace nisps;

// ---- Static concept checks (redundant with header-side static_asserts but
// makes the test surface explicit) ----
static_assert(Mode<modes::PAFSynthMode>);
static_assert(Mode<modes::ChannelStripMode>);
static_assert(Mode<modes::XIASRIMode>);
static_assert(Mode<modes::VerbFXMode>);
static_assert(Mode<modes::MEMLCeliumMode>);
static_assert(Mode<modes::SLPWorkshopMode>);
static_assert(Mode<modes::BreakOrMode>);
static_assert(Mode<modes::ElysiamorfMode>);
static_assert(Mode<modes::SoundAnalysisMIDIMode>);

// ---- Per-mode metadata ----
NISPS_TEST(mode_paf_synth_metadata) {
    const auto& s = modes::PAFSynthMode::param_schema();
    NISPS_EXPECT(modes::PAFSynthMode::mode_id() == "paf_synth");
    NISPS_EXPECT(modes::PAFSynthMode::input_channel_count() == 4u);
    NISPS_EXPECT(s.input_size  == 4u);
    NISPS_EXPECT(s.output_size == 33u);
    NISPS_EXPECT(s.engine_id   == "paf_synth");
    NISPS_EXPECT(s.params.size() == 33u);
    NISPS_EXPECT(s.voice_spaces.size() == 7u);
}

NISPS_TEST(mode_channel_strip_metadata) {
    const auto& s = modes::ChannelStripMode::param_schema();
    NISPS_EXPECT(modes::ChannelStripMode::mode_id() == "channel_strip");
    NISPS_EXPECT(modes::ChannelStripMode::input_channel_count() == 4u);
    NISPS_EXPECT(s.output_size == 24u);
    NISPS_EXPECT(s.voice_spaces.size() == 6u);
}

NISPS_TEST(mode_xiasri_metadata) {
    const auto& s = modes::XIASRIMode::param_schema();
    NISPS_EXPECT(modes::XIASRIMode::mode_id() == "xiasri");
    NISPS_EXPECT(s.output_size == 24u);
    NISPS_EXPECT(s.voice_spaces.size() == 1u);
}

NISPS_TEST(mode_verb_fx_metadata) {
    const auto& s = modes::VerbFXMode::param_schema();
    NISPS_EXPECT(modes::VerbFXMode::mode_id() == "verb_fx");
    NISPS_EXPECT(s.output_size == 47u);
    NISPS_EXPECT(s.voice_spaces.size() == 12u);
}

NISPS_TEST(mode_memlcelium_metadata) {
    const auto& s = modes::MEMLCeliumMode::param_schema();
    NISPS_EXPECT(modes::MEMLCeliumMode::mode_id() == "memlcelium");
    NISPS_EXPECT(s.output_size == 56u);
    NISPS_EXPECT(s.engine_id == "memlcelium");
}

NISPS_TEST(mode_slp_workshop_metadata) {
    const auto& s = modes::SLPWorkshopMode::param_schema();
    NISPS_EXPECT(modes::SLPWorkshopMode::mode_id() == "slp_workshop");
    NISPS_EXPECT(modes::SLPWorkshopMode::input_channel_count() == 4u);
    NISPS_EXPECT(s.output_size == 56u);
    // Reuses the MEMLCelium engine verbatim.
    NISPS_EXPECT(s.engine_id == "memlcelium");
    NISPS_EXPECT(s.voice_spaces.size() == 1u);
}

NISPS_TEST(mode_breakor_metadata) {
    const auto& s = modes::BreakOrMode::param_schema();
    NISPS_EXPECT(modes::BreakOrMode::mode_id() == "breakor");
    NISPS_EXPECT(s.output_size == 56u);
    NISPS_EXPECT(s.engine_id == "breakor");
}

NISPS_TEST(mode_elysiamorf_metadata) {
    const auto& s = modes::ElysiamorfMode::param_schema();
    NISPS_EXPECT(modes::ElysiamorfMode::mode_id() == "elysiamorf");
    NISPS_EXPECT(s.output_size == 40u);
    NISPS_EXPECT(s.engine_id == "elysiamorf");
}

NISPS_TEST(mode_sound_analysis_midi_metadata) {
    const auto& s = modes::SoundAnalysisMIDIMode::param_schema();
    NISPS_EXPECT(modes::SoundAnalysisMIDIMode::mode_id() == "sound_analysis_midi");
    NISPS_EXPECT(modes::SoundAnalysisMIDIMode::input_channel_count() == 10u);
    NISPS_EXPECT(s.input_size  == 10u);
    NISPS_EXPECT(s.output_size == 8u);
    NISPS_EXPECT(s.engine_id   == "thru");
}
