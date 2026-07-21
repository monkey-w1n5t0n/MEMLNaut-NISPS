# `firmware/` — PlatformIO firmware + hardware glue

Thin shell around `nisps/`. The platform-agnostic ML / DSP / engines / modes live there; this directory contains:

- `MEMLNaut-NISPS/platformio.ini` — the build: one `[env:<alias>]` per firmware variant (the variant list here IS the registry). See the file itself for the full flag/library rationale.
- `MEMLNaut-NISPS/src/main.cpp` — entry point. Picks one mode at compile time via `MEMLNAUT_MODE_TYPE` (a per-env build flag, not an in-source registry), hosts the dual-core lifecycle (Core 0: ML + UI, Core 1: audio + MIDI), and connects glue to mode.
- `MEMLNaut-NISPS/glue/audio_driver.hpp` — bridges memllib's `AudioDriver` block callback to `Mode::process(stereosample_t)`. Templated trampoline so no virtual dispatch in audio path.
- `MEMLNaut-NISPS/glue/peripherals.hpp` — wires MEMLNaut joystick / pots / buttons to `Mode::set_input(idx, value)` and the ML primitives (`draw_weights`, `move_weights`, `train`, `reset`).
- `MEMLNaut-NISPS/glue/midi_io.hpp` — binds incoming MIDI to `mode.note_on/note_off/update_bpm/set_playing` (where supported); drains outgoing `ControlEvent`s from the mode's ring buffer to the MIDI UART.
- `MEMLNaut-NISPS/glue/output_router.hpp` — drains engine events + mode events; called from `loop1()`.
- `MEMLNaut-NISPS/glue/mode_select.hpp` — type aliases mapping `MEMLNautMode<Name>` identifiers to `nisps::modes::<Name>Mode` C++ types. The active alias is chosen per PlatformIO env (`-DMEMLNAUT_MODE_TYPE=...`), not by rewriting a source file.
- `MEMLNaut-NISPS/glue/selftest.hpp` — the guided hardware self-test rig (`selftest` env, `-DNISPS_SELFTEST=1`).
- `MEMLNaut-NISPS/lib/memllib/` — **vendored** hardware-abstraction library (audio driver, TFT display, MIDI I/O, peripherals). Not a submodule — see `lib/memllib/VENDORED.md` for provenance and the re-sync procedure.
- `useq-celium/` — standalone RP2040 firmware for the uSEQ-Celium USB→CV/gate converter (separate PlatformIO project; unrelated to the MEMLNaut-NISPS build described here).

## Building

```bash
scripts/build-firmware.sh                # interactive variant prompt
scripts/build-firmware.sh pafsynth        # build a specific variant
scripts/build-firmware.sh --all           # build every variant
scripts/build-and-flash-firmware.sh       # build + flash via picotool
```

These wrap `pio` (PlatformIO Core). If `pio` isn't on `PATH`, run through
`nix-shell -p platformio-core --run '...'` — **not** `nix-shell -p platformio`,
which wraps the CLI in a bubblewrap FHS sandbox that fails without a working
user namespace (containers/sandboxes). `platformio-core` is the same CLI,
unwrapped. First build downloads the RP2350 platform + toolchain + libraries
into `~/.platformio` (hundreds of MB) — be patient once, fast after.

Target board: `solderparty_rp2350_stamp_xl` (RP2350, Cortex-M33), `-O3`,
`-std=gnu++20`. See `platformio.ini` for the exact flag/version pins.

## Include paths

- `nisps/` (platform-neutral, shared with the WASM build) is reached via
  `-I${PROJECT_DIR}/../..` (repo root) — never copied or symlinked into
  `firmware/`. Includes look like `#include "nisps/core/perf.hpp"`.
- `lib/memllib/` is a PlatformIO private library (`library.properties` +
  `src/` — the standard Arduino 1.5 layout, required for PlatformIO to
  recursively compile its nested subdirectories; see `VENDORED.md`). Its
  `src/` becomes the include root: `#include "audio/AudioDriver.hpp"`, no
  `memllib/` or `src/` prefix.
- `glue/` is reached via `-I${PROJECT_DIR}`: `#include "glue/audio_driver.hpp"`.

There is no git submodule anywhere in this tree.

## Verification

You cannot test on hardware from a sandbox. We verify:

1. Every `[env:...]` in `platformio.ini` builds (`scripts/build-firmware.sh --all`).
2. Flash/RAM sizes are comparable to an arduino-cli build of the same source
   at the same commit — use `arm-none-eabi-size -A` (text+rodata vs.
   data+bss) rather than `pio run`'s own console "Flash: NN%" line, which
   double-counts `.data` for this board (see the note in `platformio.ini`).
3. Host C++ tests in `nisps/build` still pass — the firmware build system
   must not perturb the platform-agnostic library (`scripts/run-all-tests.sh`).
