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

## The fork divergence — and the correction to this document's first version

`src/memllib` is not a third-party dependency. It is **the lab's shared library**
(`MusicallyEmbodiedML/memllib`), and our fork was 3 commits ahead / 31 behind.

**The first version of this document (commit `7a30da9`) drew the wrong conclusion from that, and
recommended a rebase-then-vendor on the strength of it. Two facts checked afterwards overturn it:**

1. **All three of our commits touch only `examples/`** — `bf9691c` (swap memlp includes for
   nisps/core, inline RL utilities), `32cc831` (newlib RNG fix), `b37fc53` (seed-helper rename).
   `examples/` is **not in the sketch symlink forest** (`firmware/MEMLNaut-NISPS/src/` symlinks
   exactly `audio hardware interface synth utils PicoDefs.hpp`), so it is never compiled. Those
   commits existed to let the RL code build against `nisps/core` **while it was being ported**, and
   that port is finished: `nisps/ml/{jolt,ou_noise,feedback,geo_push}.hpp` cite the upstream sources
   directly. So there is nothing of ours to carry forward, and **no rebase to perform** — vendoring
   the five linked subdirs drops `examples/` and our three commits with it.
2. **Two of the "31 commits of work we are missing" were already absorbed.** `nisps/ml/jolt.hpp:3`
   cites `9fcd459 "jolts"` and `nisps/ml/ou_noise.hpp:3` cites `d0d8a72 "noise"` as their sources.
   The alarm in the first version — "the 31 commits contain work that sounds directly relevant" —
   was therefore overstated for exactly the two commits it named.

So the real question was never "rebase or not" but **"which snapshot do we vendor: the pinned
`188496d` we build today, or current upstream?"**

## The staleness was already costing us

Upstream `main` **has `DisplayDriver::NavigateToView`** (`display/DisplayDriver.hpp:54`); the pinned
commit does not. The SelfTest firmware variant called it and had been failing to compile — fixed in
`b953681` by routing around the missing method. That variant was not written against broken code; it
was written against a **newer memllib than the pin**. The gap is not theoretical.

Upstream also carries `e291192 "l r input swap"`, a **hardware bug fix**: the physical L/R input
sockets are wired to the opposite codec ADC channels, so `AudioDriver.cpp` now swaps them at the
lowest level. Every mode on the pinned commit sees its stereo input backwards.

## Verified: current upstream builds, and costs almost nothing

Submodule moved to `e291192` (upstream `main`), all three variants built with `arduino-cli`:

| variant | flash | Δ vs pin | RAM | Δ |
|---|---|---|---|---|
| SLPWorkshop | 145348 | +320 | 87388 | +4 |
| PAFSynth | 145300 | +312 | 107060 | +4 |
| SelfTest | 141840 | +320 | 12028 | +4 |

Exactly **one** compile error had to be fixed: `MEMLNaut-NISPS.ino:169` used `kSampleRate` in a
`constexpr`, and upstream `1997699 "mode sample rate"` made it a runtime `extern size_t` so a mode
can choose its own rate. `constexpr` → `const`; it is a once-per-second diagnostic print.

The +316-byte uniform delta is the AudioDriver/DisplayDriver changes. The bulky new upstream code
(`GrainDelayI16`, `ReverbI16`, `ModFXI16`, `CCSelectView`, `NameInputView`, `RLView`, `VUMeterView`,
`PSRAMManager`) is header-only and unreferenced, so the linker drops all of it.

## Where this leaves the vendoring

Vendor **from current upstream**, not from the old pin. Take the five linked subdirs +
`PicoDefs.hpp`; drop `examples/` (~1.8 MB → the vendored surface). Record the exact upstream commit
so a future re-sync is a documented diff rather than an archaeology exercise.

The submodule now points at **upstream** rather than the fork: with the pin moved to an upstream
commit, the fork has nothing the firmware compiles. The fork's `feat/nisps-core-swap` branch remains
pushed, so nothing is destroyed.

This unblocks the PlatformIO migration (plan §5).
