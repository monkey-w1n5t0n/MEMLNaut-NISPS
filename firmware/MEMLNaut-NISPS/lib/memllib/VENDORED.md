# memllib — vendored, not a submodule

This directory is a **vendored copy** of the load-bearing subset of
[`MusicallyEmbodiedML/memllib`](https://github.com/MusicallyEmbodiedML/memllib), the
hardware-abstraction library for the MEMLNaut board (audio driver, TFT display, MIDI
I/O, peripherals). It replaced the `src/memllib` git submodule during the Phase 4
PlatformIO migration (2026-07-21).

## Provenance

- **Upstream repo**: `https://github.com/MusicallyEmbodiedML/memllib.git`
- **Vendored at commit**: `e291192d8e4f2fca7b79670c4df9c2ec8bdf03cd` (upstream `main`,
  "l r input swap")
- **License**: MPL-2.0 (`LICENSE` in this directory, copied verbatim from upstream)

## What was copied, what was dropped

Copied verbatim, directory structure unchanged, under `src/`: `audio/`, `hardware/`,
`interface/`, `synth/`, `utils/`, `PicoDefs.hpp`. `LICENSE` sits at this directory's
root (metadata, not source). These are exactly the subdirectories the firmware sketch
used to reach via its symlink forest (`firmware/MEMLNaut-NISPS/src/memllib` before this
migration) — only the wrapping `src/` folder and the `library.properties` manifest are
new, both required for PlatformIO to discover and recursively compile this tree (see
below).

Dropped: `examples/` (never compiled; the firmware never referenced it, and its content
that mattered was already ported into `nisps/ml/{jolt,ou_noise,feedback,geo_push}.hpp`
per the pre-Phase-4 submodule-bump decision) — **except** `InterfaceRL.{hpp,cpp,tpp}` and
`InterfaceRLFileFormat.hpp`, which were added back on 2026-07-25 under `reference/`.
Dropping them was correct for the build and wrong for the codebase: `InterfaceRL` is the
source of truth for the whole feedback subsystem we ported, and with it out of tree we
missed upstream's redesign of the geometric dislike for months. `reference/` sits outside
`src/`, so PlatformIO does not compile it; see `reference/README.md`. Also dropped:
`.git` (submodule gitlink),
`.gitignore` (build-artifact patterns, meaningless once vendored — this repo's own
`.gitignore` covers it), `README.md` (described the old Arduino-IDE TFT_eSPI
`User_Setup_Select.h` copy-paste workflow, which PlatformIO replaces with
`-D USER_SETUP_LOADED=1` + explicit build flags in `platformio.ini` — see there).

98 files, ~1.9 MB total — all of memllib bar `examples/`; there is no smaller subset to
lift (every one of the 24 `.cpp` translation units here is reached by at least one
compiled firmware variant).

## Internal include convention (do not break)

Files inside this tree include each other with paths relative to `src/` as the root
(e.g. `src/hardware/memlnaut/MEMLNaut.cpp` does `#include "../PicoDefs.hpp"`,
`src/hardware/memlnaut/display/View.cpp` does `#include "../../PicoDefs.hpp"`).

This directory is consumed as a PlatformIO Arduino-format library (`lib/memllib/`, with
`library.properties` + a `src/` subfolder — the standard 1.5 Arduino library layout).
PlatformIO's Library Dependency Finder therefore adds `lib/memllib/src` (not
`lib/memllib` itself) to the include search path and recursively compiles every source
file under `src/`.

**Do not vendor these five subdirectories directly under `lib/memllib/`** (i.e. without
the `src/` wrapper) — that was tried first and silently compiles nothing: PlatformIO's
`ArduinoLibBuilder`, when it finds no `src/` subfolder, falls back to a *non-recursive*
"files directly in the library root" scan (the historical Arduino 1.0 library format,
which only special-cases a `utility/` subfolder). Nested folders like `audio/` or
`hardware/` are silently invisible to the build under that fallback — it links, or
rather fails to link, with `undefined reference to MEMLNaut::...` for every symbol in
this library. The `src/` subfolder switches PlatformIO onto the recursive path.

Firmware code outside this tree (`../../src/main.cpp`, `../../glue/*.hpp`) includes
headers here relative to `src/` as the root, e.g. `#include "audio/AudioDriver.hpp"`,
`#include "hardware/memlnaut/MEMLNaut.hpp"` — no `memllib/` or `src/` prefix, because
`lib/memllib/src/` *is* the include root PlatformIO adds.

## Re-syncing with upstream

There is no submodule to bump anymore, so a re-sync is a manual, documented diff:

1. Clone upstream at the desired commit: `git clone
   https://github.com/MusicallyEmbodiedML/memllib.git /tmp/memllib-upstream`
2. Diff the five subdirs + `PicoDefs.hpp` against this directory's `src/`, e.g.:
   ```
   diff -ru /tmp/memllib-upstream/audio firmware/MEMLNaut-NISPS/lib/memllib/src/audio
   # ...repeat for hardware/ interface/ synth/ utils/ PicoDefs.hpp
   ```
3. Copy over the changed files (`cp -a`), re-run `diff -ru` both ways to confirm nothing
   outside the tracked subset leaked in and nothing was silently dropped.
4. Update the "Vendored at commit" line above to the new upstream SHA + its subject
   line.
5. Rebuild every `platformio.ini` env (`pio run`) and diff flash/RAM sizes against the
   previous vendored commit's numbers — a size jump with no corresponding upstream
   feature is a signal something unexpected changed.
6. Commit the vendored-file changes and this doc update together.

If upstream ever restructures these directories (renames, new cross-subdir relative
includes), the internal-include convention above may need re-verification — grep for
`#include "\.\./` inside this tree and confirm every relative path still resolves.
