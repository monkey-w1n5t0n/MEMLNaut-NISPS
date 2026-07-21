---
kind: finding
date: 2026-07-21
---

# memllib usage inventory — the prerequisite for the §7.5 ownership decision

_Prerequisite named by `../plans/simplification-plan.md` §5: "inventory which memllib surface
(AudioDriver, MEMLNaut board, display/menu, MIDI) is load-bearing" before choosing between a
fork-pin and vendoring. The operator's §7.5 decision is **vendor the parts we use** ("everything
should be self contained in this repo"). This document is the evidence that decision needs, plus one
consequence that was not visible when it was made._

## Method

Not grep. The firmware was built for real (`arduino-cli`, `rp2040:rp2040:solderparty_rp2350_stamp_xl`,
SLPWorkshop variant) and the **linker map** was read: `MEMLNaut-NISPS.ino.map` distinguishes
translation units that merely compiled from those contributing sections to the final image. This is
the same method that would have caught the daisysp finding (S8) mechanically instead of by reading.

## Result: the compile surface is 24 TUs, and all 24 are linked

| subdir | .cpp linked / present | headers | size |
|---|---|---|---|
| `audio/` | 4 / 4 | 12 | 132K |
| `hardware/` | 7 / 7 | 21 | 176K |
| `interface/` | 8 / 8 | 8 | 108K |
| `synth/` | 3 / 3 | 10 | 1.3M |
| `utils/` | 2 / 2 | 9 | 80K |
| **total** | **24 / 24** | **60** | **~1.8M** |

Every translation unit reachable through the sketch-tree symlinks contributes kept sections to the
image — **no discarded-only TU exists**. memllib is therefore *not* a daisysp situation (41 .cpp
compiled, zero consumers). It is genuinely load-bearing.

The library has 30 `.cpp` in total; the 6 not counted above live outside the five symlinked subdirs
(e.g. `examples/`) and are never compiled by the firmware build. Those are the only part safe to
drop outright.

Firmware's direct include surface is just six entry points — `audio/AudioDriver.hpp`,
`hardware/memlnaut/MEMLNaut.hpp`, `hardware/memlnaut/Pins.hpp`,
`hardware/memlnaut/display/{View,SingleSelectView}.hpp`, `interface/MIDIInOut.hpp`, `PicoDefs.hpp`,
`utils/perf.hpp` — but the transitive closure is the whole of those five subdirs.

**Consequence for vendoring: "the load-bearing subset" is ~1.8 MB / 84 files, i.e. essentially all
of memllib minus `examples/`.** There is no small subset to lift. `synth/` alone is 1.3 MB (mostly
`maximilian.cpp`) and all three of its TUs link.

## The consequence that was not visible when §7.5 was decided

`src/memllib` is not a third-party dependency. It is **the lab's shared library**
(`MusicallyEmbodiedML/memllib`), and our fork is:

- **3 commits ahead** — `bf9691c` (swap memlp includes for nisps/core, inline RL utilities),
  `32cc831` (newlib RNG fix), `b37fc53` (seed-helper rename). These are the NISPS-specific changes.
- **31 commits behind** — including `770a990 new staticmlp`, `9fcd459 jolts`, `d0d8a72 noise`,
  `616b8e7 cc select`, `a8bf255 verb`, `671abbe screen ordering`, `e291192 l r input swap`.
  Diffed against the five subdirs we link: **30 files changed, +2034 / −153**.

Vendoring freezes that gap permanently and converts "we are behind the lab" into "we have our own
divergent copy". That may be exactly what is wanted — self-containment is a real goal, and the lab's
`main` is not obviously a branch we track — but it is a fork of a colleague-shared library, not a
snapshot of a vendor drop, and the 31 commits contain work (`staticmlp`, `jolts`) that sounds
directly relevant to this project.

## Options, with what each costs

1. **Vendor as decided.** Copy the five subdirs into the repo, drop the submodule and the symlink
   forest, delete `examples/`. Repo grows ~1.8 MB. Self-contained, no submodule init, PlatformIO
   gets a plain `lib/` — this materially simplifies the §5 migration. Cost: the 31 upstream commits
   become a manual merge, forever.
2. **Vendor, but first rebase our 3 commits onto upstream `main`.** Same end state, except the
   snapshot is current rather than 31 commits stale. Costs one merge now (the three commits are
   small and mechanical), and it is the only moment when that merge is cheap.
3. **Fork-pin (status quo + Phase 0's fix).** Already works: the pin is reachable, CI is green,
   fresh clones build. Not self-contained, and keeps the submodule friction PlatformIO would rather
   not have.

**Recommendation: option 2.** The operator's goal (self-contained) is satisfied identically by 1 and
2, but 2 does not silently discard `staticmlp`/`jolts`/`verb`. Doing the rebase after vendoring
means doing it against a copy that no longer has upstream history — i.e. never.

This decision gates the PlatformIO migration (plan §5), which otherwise has to keep the submodule
and its symlink workaround.
