// firmware/glue/mode_select.hpp — Compile-time mode selection.
//
// The active firmware mode is chosen at compile time via `MEMLNAUT_MODE_TYPE`
// (the .ino's master macro). The macro expands to one of the canonical mode
// type aliases below; build scripts rewrite the active line.
//
// Each alias maps a short human-readable name (`MEMLNautModePAFSynth`) to a
// concrete `nisps::modes::*Mode` C++ type. The legacy
// `modes/MEMLNautMode*.hpp` wrappers are gone; the same identifier now refers
// to the new platform-agnostic mode type.
//
// This indirection (via using-aliases) lets the build script's mode-rewrite
// logic stay near-identical: it still sees lines of the form
//     #define MEMLNAUT_MODE_TYPE MEMLNautModePAFSynth
// and rewrites between alternatives.

#pragma once

// Arduino's Common.h defines `sq(x)`, `min(a,b)`, `max(a,b)`, `abs(x)`,
// `round(x)` etc. as preprocessor macros. nisps/ uses some of these as
// regular function/method names (e.g. nisps::AnalysisEngine::sq()). Undef
// the Arduino macros locally before pulling in nisps headers; downstream
// firmware code that wants Arduino's macro behaviour can re-include
// Arduino.h after this point.
#ifdef sq
#  undef sq
#endif
#ifdef min
#  undef min
#endif
#ifdef max
#  undef max
#endif
#ifdef abs
#  undef abs
#endif
#ifdef round
#  undef round
#endif

#include "../src/nisps/modes/breakor.hpp"
#include "../src/nisps/modes/channel_strip.hpp"
#include "../src/nisps/modes/elysiamorf.hpp"
#include "../src/nisps/modes/external_synth_midi.hpp"
#include "../src/nisps/modes/memlcelium.hpp"
#include "../src/nisps/modes/paf_synth.hpp"
#include "../src/nisps/modes/sound_analysis_midi.hpp"
#include "../src/nisps/modes/verb_fx.hpp"
#include "../src/nisps/modes/xiasri.hpp"

// ---- Public name → nisps type aliases ----
// Build script greps for `MEMLNautMode*` lines, so we keep the prefix.
using MEMLNautModePAFSynth          = ::nisps::modes::PAFSynthMode;
using MEMLNautModeChannelStrip      = ::nisps::modes::ChannelStripMode;
using MEMLNautModeXIASRI            = ::nisps::modes::XIASRIMode;
using MEMLNautModeSoundAnalysisMIDI = ::nisps::modes::SoundAnalysisMIDIMode;
using MEMLNautModeBreakOr           = ::nisps::modes::BreakOrMode;
using MEMLNautModeVerbFX            = ::nisps::modes::VerbFXMode;
using MEMLNautModeElysiamorfs       = ::nisps::modes::ElysiamorfMode;
using MEMLNautModeMEMLCelium        = ::nisps::modes::MEMLCeliumMode;

// ---- External-synth MIDI-CC variants (one flashable variant per device) ----
// Joystick -> MLP -> MIDI CC for the named external hardware synth. Device
// templates live in nisps/midi/generated/midi_devices.hpp (source of truth:
// schemas/midi_devices/). Each drives a curated 8-param subset (pick_cc_slots).
using MEMLNautModeExtSynthSub37      = ::nisps::modes::ExternalSynthMIDIMode<::nisps::midi::generated::kMoogSub37, 8u>;
using MEMLNautModeExtSynthSubPhatty  = ::nisps::modes::ExternalSynthMIDIMode<::nisps::midi::generated::kMoogSubPhatty, 8u>;
using MEMLNautModeExtSynthPro12      = ::nisps::modes::ExternalSynthMIDIMode<::nisps::midi::generated::kCreamwarePro12Asb, 8u>;
using MEMLNautModeExtSynthAnalogKeys = ::nisps::modes::ExternalSynthMIDIMode<::nisps::midi::generated::kElektronAnalogKeys, 8u>;
using MEMLNautModeExtSynthHydrasynth = ::nisps::modes::ExternalSynthMIDIMode<::nisps::midi::generated::kAsmHydrasynth, 8u>;
using MEMLNautModeExtSynthJD800      = ::nisps::modes::ExternalSynthMIDIMode<::nisps::midi::generated::kRolandJd800, 8u>;

// ---- SelfTest pseudo-variant ----
// A standalone guided hardware self-test (see glue/selftest.hpp). It is NOT a
// nisps Mode — it drives the display + raw peripherals directly. We expose a
// tiny tag type so the `MEMLNautModeSelfTest` alias type-checks and the build
// script's `MEMLNautMode*` grep discovers the variant; the .ino forks on
// `NISPS_SELFTEST` and never instantiates this tag.
namespace nisps_firmware { namespace selftest { struct SelfTestRig {}; } }
using MEMLNautModeSelfTest = ::nisps_firmware::selftest::SelfTestRig;

// Compile-time guard: NISPS_SELFTEST expands to 1 iff MEMLNAUT_MODE_TYPE is
// MEMLNautModeSelfTest, else 0. Computed in the .ino *after* the mode #define.
// Two-level CAT so MEMLNAUT_MODE_TYPE expands before the paste.
#define NISPS_ST_MEMLNautModePAFSynth          0
#define NISPS_ST_MEMLNautModeChannelStrip      0
#define NISPS_ST_MEMLNautModeXIASRI            0
#define NISPS_ST_MEMLNautModeSoundAnalysisMIDI 0
#define NISPS_ST_MEMLNautModeBreakOr           0
#define NISPS_ST_MEMLNautModeVerbFX            0
#define NISPS_ST_MEMLNautModeElysiamorfs       0
#define NISPS_ST_MEMLNautModeMEMLCelium        0
#define NISPS_ST_MEMLNautModeExtSynthSub37      0
#define NISPS_ST_MEMLNautModeExtSynthSubPhatty  0
#define NISPS_ST_MEMLNautModeExtSynthPro12      0
#define NISPS_ST_MEMLNautModeExtSynthAnalogKeys 0
#define NISPS_ST_MEMLNautModeExtSynthHydrasynth 0
#define NISPS_ST_MEMLNautModeExtSynthJD800      0
#define NISPS_ST_MEMLNautModeSelfTest          1
#define NISPS_ST_CAT_(x) NISPS_ST_##x
#define NISPS_ST_CAT(x)  NISPS_ST_CAT_(x)
