# uSEQ-Celium Mode

## What it is

uSEQ-Celium is an output mode in the NISPS playground that turns a gamepad into a eurorack CV/gate controller. It uses two NISPS MLPs in the browser to generate control voltages and rhythmic gate patterns, then streams them over USB serial to uSEQ hardware modules which convert them to analog signals.

The name combines **uSEQ** (the target hardware) with **MEMLCelium** (the firmware mode whose rhythm algorithms it ports).

## Why it exists

The NISPS interactive ML engine maps a 2D input space to many outputs through a trainable neural network. In synth mode, those outputs control sound parameters. In uSEQ-Celium mode, those outputs instead control a modular synthesizer via hardware CV and gate signals — enabling the same gamepad-driven interactive ML workflow but for patching and sequencing rather than direct sound design.

The key insight: one MLP handles rhythm (when things happen), another handles timbre/modulation (how things sound). A performer shapes both simultaneously using a gamepad's two sticks.

## Architecture

```
Left stick ──→ Rhythm MLP [2 → 16 → 24 → N] ──→ RatioSeq (JS) ──→ gates + velocity
Right stick ──→ CV MLP [2 → 16 → 24 → 32 → M] ────────────────→ continuous CV
                                                                       ↓
                                                               Output Router
                                                                       ↓
                                                         Binary Serial @ 100Hz
                                                                       ↓
                                                 Main uSEQ ──I2C──→ Expander
                                                 3 CV + 3 gate       8 CV
```

### Dual MLPs

- **Rhythm MLP**: Left gamepad stick (axes 0,1) → pattern parameters for up to 4 Euclidean rhythm sequences. Each sequence has 8 params: 3 ratios, phasor multiplier, phase offset, pulse width, 2 amplitude ratios.
- **CV MLP**: Right gamepad stick (axes 2,3) → continuous values routed to CV-mode outputs.

Both share the same training controls (Boldness/Memory/Precision, examples, RL feedback). MLP hidden layer sizes are user-overridable; rebuilding on architecture change is acceptable.

### RatioSeq

Faithful JS port of the Euclidean rhythm generator from the MEMLCelium firmware (`modes/AudioApps/RatioSeq.hpp`). Uses a phasor-driven algorithm where a bar-length cycle is divided into segments proportional to integer ratios, with configurable pulse width per segment. An internal BPM clock drives the bar phasor. Parameter scaling matches the C++ firmware: ratios 1-4, phasor multiplier {1,2,4,8}, phase offset quantized to beat boundaries.

### Output routing

14 hardware outputs, dynamically assignable:

| Output | Hardware | Default | Modes |
|--------|----------|---------|-------|
| d1-d3 | Digital GPIO (binary) | Gate | Gate / Off |
| a1-a3 | PWM 11-bit (velocity-capable) | CV | CV / Gate |
| e1-e8 | Expander PWM 11-bit | CV | CV / Gate |

- Max 4 rhythm sequences total
- d1-d3 can be individually disabled (Off), freeing sequence slots for CV-capable outputs
- When a CV-capable output is set to gate mode, it outputs analog velocity (not binary on/off)
- This means all 4 sequences can run on velocity-capable outputs if d1-d3 are turned off
- Velocity comes from the rhythm MLP (amplitude ratios in RatioSeq)
- Routing changes cause MLP architecture rebuild (output count changes)

### Binary serial protocol

Browser → uSEQ at 100Hz:
- Output frame: `0xAA` + `0x01` + 14 × uint16 LE (0-2047) + XOR checksum = 31 bytes
- Config frame: `0xAA` + `0x02` + uint16 LE mode bitmask + XOR checksum = 5 bytes

uSEQ → Browser at 20Hz:
- Input frame: `0xBB` + `0x01` + 4 × uint16 LE (I1, I2, AI1, AI2) + XOR checksum = 11 bytes

Main → Expander over I2C:
- `0xCC` + 8 × uint16 LE + XOR checksum = 18 bytes

### Firmware

Two minimal Arduino sketches (Raspberry Pi Pico / RP2040, Arduino-Pico core):

- `firmware/main/` — USB serial → 3 CV (PWM pins 21,20,19) + 3 gate (digital pins 18,17,16) + I2C forwarding to expander + input reading TX
- `firmware/expander/` — I2C client → 8 CV (PWM pins 13,14,10,11,8,7,5,3)

Both use 11-bit PWM at 100kHz. Build with PlatformIO: `cd firmware/main && pio run -t upload`.

## File layout

```
playground/
  js/useq-celium/
    useq-celium-mode.js     — orchestration: dual MLPs, gamepad, tick loop
    ratio-seq.js            — JS port of Euclidean rhythm algorithm
    webserial-driver.js     — binary WebSerial TX/RX
    output-router.js        — dynamic CV/Gate mapping, MLP architecture computation
  firmware/
    main/
      src/useq-celium-main.ino
      platformio.ini
    expander/
      src/useq-celium-expander.ino
      platformio.ini
  USEQ-CELIUM.md            — this file
```

Modified files: `a-immersive.html` (tab + panels + CSS), `js/a-app.js` (mode switching, visualizer wiring).

## Known limitations

- **No virtual joystick input yet**: Requires a physical gamepad. The touch joystick only drives the main MLP, not the uSEQ-Celium MLPs.
- **No gamepad button bindings**: RB/LB for RL feedback and A/X/B for training aren't wired in uSEQ-Celium mode.
- **No state persistence**: Routing config, BPM, MLP weights lost on refresh.
- **Control surface not wired**: Boldness/Memory/Precision sliders don't affect the uSEQ-Celium MLPs.
- **Double phase offset**: The RatioSeq algorithm applies phaseOffset twice (once in the engine tick, once inside the ratioSeq function). This is faithful to the C++ source and produces the same behaviour as the MEMLCelium firmware.
- **I2C discovery**: Main firmware grabs the first I2C device found as the expander. Fine for uSEQ hardware but fragile if other I2C devices are on the bus.

## Design decisions

- **Rhythm in browser, not firmware**: The RatioSeq runs in JS and sends gate on/off over serial. This adds ~1-5ms USB jitter but avoids needing the full sequencer in the minimal firmware. The firmware is a dumb passthrough.
- **Binary protocol, not LISP**: The standard uSEQ firmware uses LISP strings over I2C. We use a compact binary protocol for both serial and I2C because the minimal firmware has no interpreter.
- **Separate expander firmware**: The standard expander runs the full uSEQ LISP engine. Our minimal expander only receives binary values. Both boards must be reflashed.
- **MLP sizes small by default**: Rhythm [2,16,24,N], CV [2,16,24,32,M]. Sub-millisecond inference. User can override via init().
