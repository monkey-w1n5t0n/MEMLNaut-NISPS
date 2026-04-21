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

## Open bugs to fix

### 1. Tick timing too slow when tab is in focus
**Symptom**: Rhythm sequences play 2-4x slower than expected BPM when the browser tab is active.
**Root cause**: The tick loop runs in a Web Worker (`_startTickWorker` in useq-celium-mode.js) posting messages at 10ms intervals. Each message triggers `tick()` on the main thread which does WASM MLP inference. At 100Hz, this floods the main thread event queue, competing with rAF drawing. Messages get delayed, causing effective tick rate to drop.
**Likely fix**: The serial driver already has its own 100Hz `setInterval` for sending frames. The mode's tick loop doesn't need to run that fast — reduce Worker interval to 16ms (~60Hz) or even 33ms (~30Hz). The RatioSeq uses real-time deltas (`performance.now()`) so reducing tick rate won't change tempo, only gate timing resolution.
**Alternative**: Move the entire tick loop (MLP inference + RatioSeq + output routing) into the Worker itself. This is a bigger refactor since WasmIML runs on the main thread.
**Files**: `playground/js/useq-celium/useq-celium-mode.js` lines 85-102, 377-393

### 2. Expander LEDs not responding
**Symptom**: Main uSEQ outputs work (LEDs change) but expander outputs don't change at all.
**Possible causes**:
- I2C address mismatch: main firmware scans addresses 0x08-0x77 and grabs the first responding device. Expander derives its address from RP2040 unique chip ID (`deriveI2CAddress()` in expander firmware). If these don't match, no communication.
- I2C wiring: SDA/SCL pins differ between main (SDA=0, SCL=1) and expander (SDA=4, SCL=1). Verify hardware connections.
- The scan runs once at boot. If the expander boots after the main board, it's missed.
**Debug approach**:
1. Add a startup LED blink pattern to the expander so you know it booted (e.g., sweep all 8 LEDs on/off)
2. Add serial output to the main firmware printing whether `expanderFound` is true and what `expanderAddr` it found
3. Hardcode the expander address on both sides to a known value (e.g., 0x10) instead of dynamic discovery
**Files**: 
- `playground/firmware/main/src/useq-celium-main.ino` lines 109-124 (setupI2C, scan), lines 213-230 (forwardToExpander)
- `playground/firmware/expander/src/useq-celium-expander.ino` lines 62-68 (deriveI2CAddress), lines 72-94 (onI2CReceive)

### 3. Visualizer bar color bleed (cosmetic)
**Symptom**: First bar of each section shows the previous section's color in its body.
**Root cause**: Despite pixel-snapping (`Math.round`) and removing bar gap (`barWidth - 0.5`), adjacent bars can still overlap by a subpixel. The `sec.color + 'cc'` (was removed, now opaque) or canvas antialiasing causes the previous bar's color to bleed into the next bar's area at section boundaries.
**Current state**: Transparency was removed (opaque bars now). If bleed persists, the issue is canvas subpixel rendering.
**Fix**: Clear a 1px strip before each section's first bar, or render sections in reverse order. Or accept it as a cosmetic artifact.
**File**: `playground/js/a-app.js` — `SynthVisualizer.draw()` around line 794

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
