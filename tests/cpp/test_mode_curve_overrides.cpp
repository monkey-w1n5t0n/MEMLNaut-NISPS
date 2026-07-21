// tests/cpp/test_mode_curve_overrides.cpp — the C++ side of the per-voice-space
// curve declaration.
//
// The authority on WHAT the table should contain is codegen/tests/
// curve_drift_test.ts, which derives it from nisps/engines/*.hpp source (the
// curve is not observable from engine output — see that file's header). This
// test covers what TypeScript cannot see: that the generated C++ table is
// well-formed, reachable through `nisps::ParamSchema`, and that
// `nisps::effective_curve()` resolves it correctly. A handful of spot checks
// pin the wiring so a mis-indexed span cannot pass as "all linear".

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

namespace {

// Every override must address a real (voice space, param) pair and must be a
// real deviation — a row restating the default is dead weight that would make
// the table's size a lie about how much the voice spaces actually differ.
void check_well_formed(const ParamSchema& s) {
    for (const auto& o : s.curve_overrides) {
        NISPS_EXPECT(o.voice_space < s.voice_spaces.size());
        NISPS_EXPECT(o.param < s.params.size());
        if (o.param < s.params.size()) {
            NISPS_EXPECT(o.curve != s.params[o.param].curve);
        }
    }
    // No duplicate (voice_space, param) rows: effective_curve() returns the
    // first match, so a duplicate would silently shadow.
    for (std::size_t i = 0u; i < s.curve_overrides.size(); ++i) {
        for (std::size_t j = i + 1u; j < s.curve_overrides.size(); ++j) {
            const bool same = s.curve_overrides[i].voice_space == s.curve_overrides[j].voice_space &&
                              s.curve_overrides[i].param == s.curve_overrides[j].param;
            NISPS_EXPECT(!same);
        }
    }
}

}  // namespace

NISPS_TEST(curve_overrides_well_formed) {
    check_well_formed(modes::PAFSynthMode::param_schema());
    check_well_formed(modes::ChannelStripMode::param_schema());
    check_well_formed(modes::VerbFXMode::param_schema());
    check_well_formed(modes::XIASRIMode::param_schema());
    check_well_formed(modes::MEMLCeliumMode::param_schema());
    check_well_formed(modes::SLPWorkshopMode::param_schema());
    check_well_formed(modes::BreakOrMode::param_schema());
    check_well_formed(modes::ElysiamorfMode::param_schema());
    check_well_formed(modes::SoundAnalysisMIDIMode::param_schema());
}

// Single-voice-space and voice-space-less modes deviate from nothing: their
// mode-wide `curve` already is the whole truth.
NISPS_TEST(curve_overrides_empty_where_one_voice_space) {
    NISPS_EXPECT(modes::XIASRIMode::param_schema().curve_overrides.empty());
    NISPS_EXPECT(modes::MEMLCeliumMode::param_schema().curve_overrides.empty());
    NISPS_EXPECT(modes::SLPWorkshopMode::param_schema().curve_overrides.empty());
    NISPS_EXPECT(modes::BreakOrMode::param_schema().curve_overrides.empty());
    NISPS_EXPECT(modes::ElysiamorfMode::param_schema().curve_overrides.empty());
    NISPS_EXPECT(modes::SoundAnalysisMIDIMode::param_schema().curve_overrides.empty());
}

// channel_strip: the mode-wide default IS WannabeNeve66 (voice space 0).
// SSL 4K/9K additionally square comp_ratio (slot 11); the vox strips do not
// square comp_release (13); Neve 80 quantises everything but the two gains.
NISPS_TEST(curve_overrides_channel_strip) {
    const auto& s = modes::ChannelStripMode::param_schema();
    NISPS_EXPECT(effective_curve(s, 0u, 11u) == Curve::linear);  // WannabeNeve66
    NISPS_EXPECT(effective_curve(s, 1u, 11u) == Curve::square);  // SSL 4K G-ist
    NISPS_EXPECT(effective_curve(s, 2u, 11u) == Curve::square);  // SSL 9K-inda
    NISPS_EXPECT(effective_curve(s, 0u, 13u) == Curve::square);  // comp_release
    NISPS_EXPECT(effective_curve(s, 3u, 13u) == Curve::linear);  // MaleVox
    NISPS_EXPECT(effective_curve(s, 4u, 13u) == Curve::linear);  // FemaleVox
    NISPS_EXPECT(effective_curve(s, 5u, 1u) == Curve::linear);   // Neve 80 stepped
    NISPS_EXPECT(effective_curve(s, 5u, 0u) == Curve::square);   // …but pre_gain
    NISPS_EXPECT(effective_curve(s, 5u, 23u) == Curve::square);  // …and post_gain
}

// paf_synth: the mode-wide default is Rowantares (voice space 1), NOT voice
// space 0 — the enum order is QuadDetune, VS1, VS2, Perc, Single1, QuadOct,
// QuadDist while the param NAMES came from VS1's mapping.
NISPS_TEST(curve_overrides_paf_synth) {
    const auto& s = modes::PAFSynthMode::param_schema();
    NISPS_EXPECT(effective_curve(s, 1u, 8u) == Curve::square);   // Rowantares == default
    NISPS_EXPECT(effective_curve(s, 0u, 8u) == Curve::linear);   // Ellipticacacia
    NISPS_EXPECT(effective_curve(s, 4u, 5u) == Curve::square);   // Magnetarch shape gain
    NISPS_EXPECT(effective_curve(s, 3u, 32u) == Curve::square);  // Aquillow env release
    NISPS_EXPECT(effective_curve(s, 6u, 19u) == Curve::linear);  // Ipeleiades vfr is linear
    NISPS_EXPECT(effective_curve(s, 5u, 19u) == Curve::square);  // …but Elderstar squares it
}

// verb_fx: the mode-wide default is Default (voice space 0), which is the ONLY
// all-linear voice space. Every other one deviates.
NISPS_TEST(curve_overrides_verb_fx) {
    const auto& s = modes::VerbFXMode::param_schema();
    NISPS_EXPECT(!s.curve_overrides.empty());
    for (std::size_t i = 0u; i < s.params.size(); ++i) {
        NISPS_EXPECT(effective_curve(s, 0u, i) == Curve::linear);
    }
    NISPS_EXPECT(effective_curve(s, 1u, 29u) == Curve::sqrt);    // Resonant fbank res
    NISPS_EXPECT(effective_curve(s, 2u, 1u) == Curve::square);   // Soft lp0_fb
    NISPS_EXPECT(effective_curve(s, 3u, 37u) == Curve::sqrt);    // Cathedral delay time
    NISPS_EXPECT(effective_curve(s, 5u, 39u) == Curve::square);  // Chamber delay1 time
    NISPS_EXPECT(effective_curve(s, 6u, 29u) == Curve::sqrt);    // Metallic alternates…
    NISPS_EXPECT(effective_curve(s, 6u, 30u) == Curve::square);  // …by index parity
    NISPS_EXPECT(effective_curve(s, 7u, 42u) == Curve::sqrt);    // Granular overrides Soft
    NISPS_EXPECT(effective_curve(s, 8u, 0u) == Curve::sqrt);     // Diffuse xfade
    NISPS_EXPECT(effective_curve(s, 9u, 21u) == Curve::square);  // Dark fbank freqs
    NISPS_EXPECT(effective_curve(s, 10u, 21u) == Curve::sqrt);   // Bright fbank freqs
}
