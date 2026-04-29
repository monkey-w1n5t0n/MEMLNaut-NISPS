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
