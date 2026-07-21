# `firmware/` — Arduino sketch + hardware glue

Thin shell around `nisps/`. The platform-agnostic ML / DSP / engines / modes live there; this directory contains:

- `MEMLNaut-NISPS.ino` — entry point. Picks one mode at compile time, hosts the dual-core lifecycle (Core 0: ML + UI, Core 1: audio + MIDI), and connects glue to mode.
- `glue/audio_driver.hpp` — bridges memllib's `AudioDriver` block callback to `Mode::process(stereosample_t)`. Templated trampoline so no virtual dispatch in audio path.
- `glue/peripherals.hpp` — wires MEMLNaut joystick / pots / buttons to `Mode::set_input(idx, value)` and the ML primitives (`draw_weights`, `move_weights`, `train`, `reset`).
- `glue/midi_io.hpp` — binds incoming MIDI to `mode.note_on/note_off/update_bpm/set_playing` (where supported); drains outgoing `ControlEvent`s from the mode's ring buffer to the MIDI UART.
- `glue/output_router.hpp` — drains engine events + mode events; called from `loop1()`.
- `glue/mode_select.hpp` — type aliases mapping `MEMLNautMode<Name>` identifiers to `nisps::modes::<Name>Mode` C++ types. Build script rewrites `MEMLNAUT_MODE_TYPE` between the alternatives.

## Building

```bash
scripts/build-firmware.sh                # interactive variant prompt
scripts/build-firmware.sh PAFSynth       # build a specific variant
scripts/build-and-flash-firmware.sh      # build + flash via UF2
```

Target: `rp2040:rp2040:solderparty_rp2350_stamp_xl:opt=Optimize3` with `compiler.cpp.extra_flags=-std=gnu++20`.

## Include paths

Arduino-CLI compiles every `*.cpp` / `*.hpp` reachable from the sketch directory and from any submodule under `src/`. Headers under `nisps/` are included via relative path (`#include "../../nisps/..."`). No `-I` flag injection needed.

`src/memllib` is the only git submodule; the `firmware-common.sh` wrapper rejects builds when it drifts from the recorded revision.

## Verification

You cannot test on hardware from a sandbox. We verify three things:

1. `arduino-cli compile` succeeds for at least three modes (PAFSynth, ChannelStrip, BreakOr).
2. Host C++ tests in `nisps/build` still pass — the firmware refactor must not perturb the platform-agnostic library.
3. `git grep` confirms no remaining references to deleted root-level files.

## Removed

- Root-level `MEMLNaut-NISPS.ino`, `IMLInterface.hpp`, `*AudioApp.hpp`, `XiasriAnalysis.{cpp,hpp}` — replaced by `nisps/engines/*` and `firmware/MEMLNaut-NISPS.ino`.
- Root-level `modes/MEMLNautMode*.hpp` and `modes/AudioApps/` — replaced by `nisps/modes/*` and the `mode_select.hpp` type aliases.
- Root-level `voicespaces/` — replaced by static voice space data inlined into engines (`nisps/engines/paf_synth.hpp` etc.).
- `src/memlp/` submodule — replaced by `nisps/ml/`.
