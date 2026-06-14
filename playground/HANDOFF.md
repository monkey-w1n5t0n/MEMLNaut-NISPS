# uSEQ-Celium Session Handoff

## Worktree Location
`/home/w1n5t0n/src/MEMLNaut-NISPS-useq-celium-opus46/`
Branch: `feat/useq-celium-opus46`
Parent repo: `/home/w1n5t0n/src/MEMLNaut-NISPS/`

## Context Doc
Read `playground/USEQ-CELIUM.md` for full architecture, protocol spec, and design decisions.

## What exists and works

6 new files + modifications to 2 existing files:
- `playground/js/useq-celium/ratio-seq.js` — Euclidean rhythm engine
- `playground/js/useq-celium/webserial-driver.js` — binary serial TX/RX
- `playground/js/useq-celium/output-router.js` — dynamic CV/gate mapping
- `playground/js/useq-celium/useq-celium-mode.js` — dual-MLP orchestration
- `playground/firmware/main/src/useq-celium-main.ino` — main uSEQ firmware (compiles clean)
- `playground/firmware/expander/src/useq-celium-expander.ino` — expander firmware (compiles clean)
- `playground/a-immersive.html` — 5th "uSEQ" tab, dual joystick HTML/CSS, quick controls, dock routing
- `playground/js/a-app.js` — mode switching, visualizer wiring, dual joystick JS, feedback routing

Build firmware: `cd playground/firmware/main && pio run -t upload` (same for `expander/`)
Serve playground: `cd playground && python3 -m http.server`

## Fixed bugs

### 1. Tick timing too slow when tab is in focus — FIXED
Worker interval reduced from 10ms (100Hz) to 33ms (~30Hz). RatioSeq uses `performance.now()` deltas so tempo is unaffected; only gate timing resolution changes (still fine for musical gates). Main thread no longer flooded.

### 2. Expander LEDs not responding — FIXED
- Hardcoded I2C address `0x10` on both main and expander (removed dynamic chip-ID derivation)
- Added boot sweep LED animation on expander for visual boot confirmation
- Added `[I2C]` serial debug logging on main
- Main retries expander probe every 2s if not found at boot (handles late-boot expander)

### 3. Visualizer bar color bleed — FIXED (prior session)

## Other known gaps (not bugs, features to add)

1. **No gamepad button bindings**: RB/LB/A/X/B not wired to RL feedback in useq-celium mode
2. **No state persistence**: Routing, BPM, MLP weights lost on refresh
3. **Control surface (Boldness/Memory/Precision) not wired** to useq-celium MLPs
4. **Double phaseOffset** in RatioSeq — faithful to C++ source, not a regression

## Key files to read (in order)

1. `playground/USEQ-CELIUM.md` — architecture overview
2. `playground/js/useq-celium/useq-celium-mode.js` — the orchestrator (most important)
3. `playground/js/a-app.js` — search for "useq-celium" to find all integration points (~15 locations)
4. `playground/a-immersive.html` — search for "useq" for HTML/CSS additions
5. `playground/js/useq-celium/output-router.js` — routing logic + paramMeta generation
6. `playground/js/useq-celium/ratio-seq.js` — rhythm algorithm
7. `playground/js/useq-celium/webserial-driver.js` — serial protocol
8. `playground/firmware/main/src/useq-celium-main.ino` — main firmware
9. `playground/firmware/expander/src/useq-celium-expander.ino` — expander firmware

## Dependencies to understand

- `playground/js/nisps/nisps-wasm.js` — WasmIML class (the ML engine wrapper)
- `playground/js/ui/gamepad.js` — GamepadInput class
- `modes/AudioApps/RatioSeq.hpp` — original C++ rhythm algorithm (for reference)

## Beads issues

Use `bd list 2>&1 | grep opus46` from `/home/w1n5t0n/src/MEMLNaut-NISPS/` (the main repo, not the worktree — beads shares the DB).
