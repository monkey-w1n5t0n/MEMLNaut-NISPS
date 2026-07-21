// firmware/glue/mode_select.hpp — Compile-time mode selection.
//
// The active firmware mode is chosen at compile time via `MEMLNAUT_MODE_TYPE`,
// defined per-variant as a PlatformIO build flag (one `[env:...]` per variant
// in platformio.ini, e.g. `-DMEMLNAUT_MODE_TYPE=MEMLNautModePAFSynth`) — there
// is no in-source registry and no build-time file rewriting.
//
// Each alias maps a short human-readable name (`MEMLNautModePAFSynth`) to a
// concrete `nisps::modes::*Mode` C++ type.

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

#include "nisps/modes/breakor.hpp"
#include "nisps/modes/channel_strip.hpp"
#include "nisps/modes/elysiamorf.hpp"
#include "nisps/modes/external_synth_midi.hpp"
#include "nisps/modes/memlcelium.hpp"
#include "nisps/modes/paf_synth.hpp"
#include "nisps/modes/slp_workshop.hpp"
#include "nisps/modes/sound_analysis_midi.hpp"
#include "nisps/modes/verb_fx.hpp"
#include "nisps/modes/xiasri.hpp"

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
// SLP-Workshop: the Synth Library Portland workshop build. Reuses the
// MEMLCelium engine; foregrounds the Jolt (TogB1) + OU-explore (RVX1)
// adaptive-learning gestures wired in peripherals.hpp.
using MEMLNautModeSLPWorkshop       = ::nisps::modes::SLPWorkshopMode;

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

// ---- SelfTest ----
// The guided hardware self-test (see glue/selftest.hpp) is NOT a nisps Mode —
// it drives the display + raw peripherals directly and is selected by its own
// `selftest` PlatformIO env, which defines `NISPS_SELFTEST=1` and leaves
// `MEMLNAUT_MODE_TYPE` undefined (src/main.cpp's `#if !NISPS_SELFTEST` fork
// never instantiates `ActiveMode` in that env, so no alias is needed here).
