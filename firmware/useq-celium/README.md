# uSEQ-CV firmware

Turns a [uSEQ](https://www.emutelabinstruments.co.uk/useq/) module (+ its CV
expander) into a USB→CV/gate converter driven by the Manifold browser app's **CV
output backend** (or, in future, the MEMLNaut RP2350 firmware directly). This is
the restored + modernised descendant of the April-2026 "uSEQ-Celium" output mode
(provenance in `docs/useq-celium/protocol.md`).

Both boards are RP2040 (Raspberry Pi Pico / uSEQ hardware) flashed with the
Arduino-Pico (Earle Philhower) core. The wire protocol (v2) is defined once in
`shared/protocol.h` and mirrored by `manifold/src/backends/useq-protocol.ts`.

```
shared/protocol.h        uSEQ-CV v2 wire protocol (single source of truth)
main/                    uSEQ main module: USB serial → CV1..3 + GATE1..3, I2C → expander
expander/                uSEQ expander: I2C slave → CV4..11 (8× PWM)
```

## Topology

| Channel    | Board     | Pin(s)        | Type          |
|------------|-----------|---------------|---------------|
| CV1–CV3    | main      | 21, 20, 19    | PWM (11-bit)  |
| GATE1–GATE3| main      | 18, 17, 16    | digital       |
| CV4–CV11   | expander  | 13,14,10,11,8,7,5,3 | PWM (11-bit) |

The main board forwards CV4–CV11 to the expander over I2C (addr `0x10`, 400 kHz)
and rescans every 2 s until the expander is found (hot-attach friendly).

## Build / flash (PlatformIO)

```bash
# main board
cd firmware/useq-celium/main && pio run -e main -t upload
# expander board
cd firmware/useq-celium/expander && pio run -e expander -t upload
```

(Or open each `.cpp` in the Arduino IDE with the RP2040 "Earle Philhower" core and
add `firmware/useq-celium/shared` to the include path.)

## Protocol smoke

Hold the browser's **Identify** button (CV backend config) → both boards run an
LED sweep, confirming the USB + I2C links end-to-end. Full frame layout:
`docs/useq-celium/protocol.md`.
