# MAP.md — MEMLNaut-NISPS

Top-level map. For playground internals see [`playground/MAP.md`](playground/MAP.md).

## Three fronts

| Front | Entry | Role |
|-------|-------|------|
| Firmware | `MEMLNaut-NISPS.ino` | RP2350 hardware + audio I/O + mode selector |
| `nisps-core/` | header-only C++20 | Platform-agnostic MLP lib (v0.2.0). See [`nisps-core/README.md`](nisps-core/README.md). |
| `playground/` | `a-immersive.html` | WASM MLP + browser control UI. See [`playground/MAP.md`](playground/MAP.md). |

## Firmware (`/` + `modes/` + `voicespaces/` + `src/`)

| Path | Role |
|------|------|
| `MEMLNaut-NISPS.ino` | Entry — picks active mode via `#define MEMLNAUT_MODE_TYPE` |
| `IMLInterface.hpp` | Interactive ML shim wrapping the embedded MLP |
| `XiasriAnalysis.{cpp,hpp}` | Real-time audio feature extraction (pitch, aperiodicity, energy, brightness) |
| `PAFSynthAudioApp.hpp` | PAF (Phase Aligned Formant) synth audio app |
| `ChannelStripAudioApp.hpp` | Channel strip (EQ/comp/gain) audio app |
| `XIASRIAudioApp.hpp` | XIASRI audio-reactive audio app |
| `ThruAudioApp.hpp` | Pass-through audio app |
| `modes/MEMLNautMode.hpp` | `MEMLNautMode` concept shared by all mode controllers |
| `modes/MEMLNautMode*.hpp` | Mode controllers: ChannelStrip, PAFSynth, XIASRI, SoundAnalysisMIDI, BreakOr, Elysiamorfs, VerbFX |
| `modes/AudioApps/*.hpp` | Extra audio apps (BreakOr, Elysiamorf, VerbFX) + `RatioSeq.hpp` |
| `voicespaces/VoiceSpace*.hpp` | PAF-synth voice-space mappings (`VoiceSpaces.hpp` aggregator) |
| `voicespaces/ChannelStrip/basic.hpp` | Channel-strip presets (Neve, SSL emulations) |
| `src/memllib/` | Hardware + audio driver abstraction (git submodule) |
| `src/memlp/` | Embedded MLP — diverged sibling of nisps-core (git submodule) |
| `src/daisysp/` | DSP library — filters, drums, effects, synthesis (git submodule) |

## `nisps-core/`

Header-only platform-agnostic MLP extraction. Files in `nisps-core/include/nisps/`: `nisps.hpp` (umbrella), `iml.hpp` + `iml_impl.hpp`, `mlp.hpp` + `mlp_impl.hpp`, `dataset.hpp` + `dataset_impl.hpp`, `layer.hpp`, `node.hpp`, `loss.hpp`, `sample.hpp`, `utils.hpp`. Tests/examples under `nisps-core/test/` + `nisps-core/examples/`. CHANGELOG: `nisps-core/CHANGELOG.md`. Clean-slate rewrite tracked in bd epic `meml-cwpk`.

## `playground/`

Browser WASM demo + control surface. Four HTML variants (`index.html`, `a-immersive.html`, `b-workbench.html`, `c-journey.html`); `a-immersive` is the active one, others slated for consolidation (`meml-as9`, `meml-dj9`). WASM built against `nisps-core/` via `playground/wasm/nisps_bindings.cpp`. For internals see [`playground/MAP.md`](playground/MAP.md).

## Root-level planning docs

| File | Role |
|------|------|
| `CLAUDE.md` | Project instructions for Claude sessions (detailed architecture notes) |
| `README.md` | Short user-facing project intro |
| `AGENTS.md` | bd (beads) issue-tracker workflow + session-close protocol |
| `NISPS_CORE_EXTRACTION_PLAN.md` | Original plan for the nisps-core extraction (historical) |
| `NISPS_CORE_TASKS.md` | Task list attached to the extraction (historical) |
| `playwright.config.js` | e2e test runner config (headless Chromium, port 7331) |
| `tests/e2e/*.spec.js` | Playground Playwright tests |
| `docs/firmware-perf-patterns.md` | RP2350 performance rules (heap, flash, `.f` suffix) — **planned** |

## Conventions

- Submodule init required: `git submodule update --init --recursive`.
- Firmware build: Arduino IDE or `arduino-cli` with earlephilhower/pico board package (see `CLAUDE.md` §Build).
- Playground serve: `cd playground && python3 -m http.server`.
- WASM build: `cd playground/wasm && ./build.sh` (requires emcc).
- Issue tracking: `bd` (beads), prefix `meml-`. Use `bd ready` for work queue. See `AGENTS.md`.
- Git session-close: `git pull --rebase` → `bd vc commit` → `git push`; see root `CLAUDE.md`.

## Local gotchas

- `src/memlp/` (firmware MLP, git submodule) and `nisps-core/` (playground core) are **substantially diverged sibling libraries** — not the same code. Unifying tracked in epic `meml-cwpk`.
- Mode selection is compile-time via `#define MEMLNAUT_MODE_TYPE` in `MEMLNaut-NISPS.ino`.
- Core 0 runs UI + ML inference; Core 1 runs audio + MIDI. Inter-core sync via `MEMORY_BARRIER()` / `WRITE_VOLATILE()` / `READ_VOLATILE()` / `queue_t`.
- Memory placement: `AUDIO_MEM` / `AUDIO_FUNC` → SRAM; `APP_SRAM` / `__not_in_flash("app")` keeps data out of flash.
- `.local/notes-from-chris.md` — advisor notes on RP2350 performance discipline (no heap, avoid flash-read constants, `.f` suffix). Source for the planned `docs/firmware-perf-patterns.md`.
- a-immersive exposes `window.__nisps` debug probe when loaded with `?debug=1` (used by Playwright).

## Smells / strategic concerns

See `ALIGNMENT.md` (authored separately).
