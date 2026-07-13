---
kind: spec
stability: stable
layer: binding
---

# uSEQ-CV Wire Protocol v2

The protocol the Manifold **CV output backend** (`manifold/src/backends/cv-backend.ts`)
speaks over USB Web Serial to the uSEQ main module, which drives CV/gate jacks and
forwards to its CV expander over I2C. Defined once in
`firmware/useq-celium/shared/protocol.h` and mirrored by
`manifold/src/backends/useq-protocol.ts` (a unit test asserts the frame sizes match).

## Provenance

Restored + modernised from the April-2026 **uSEQ-Celium** output mode (commits
`cb1f16f`→`cd24d98`, refined `af4d4f5`; original chat
`233900ff-c5b4-438e-937f-e8df877dae6b`). v1 sent the 3 gate channels as full
`u16` values thresholded in firmware and a runtime CONFIG bitmask; v2 fixes the
topology, collapses gates to a 1-byte bitfield, and widens CV to 12-bit canonical
— leaner and host-agnostic so the MEMLNaut RP2350 firmware can emit identical
bytes.

## Design

- **Transport:** USB CDC / UART, **115200 baud**, streamed at **~100 Hz**.
- **Endianness:** little-endian. **Checksum:** XOR (drop frame + resync on mismatch).
- **Framing:** fixed-length per type, keyed by a sync byte + type byte → O(1)
  parse, self-healing resync after a dropped/garbled byte.
- **Topology (fixed):** 11 CV + 3 gate.
  - `CV1–CV3` → main module PWM (pins 21/20/19)
  - `CV4–CV11` → expander PWM (forwarded over I2C)
  - `GATE1–GATE3` → main module digital (pins 18/17/16)
- **CV value:** 12-bit canonical `0..4095` on the wire; firmware scales to its
  11-bit PWM (`cv >> 1`). Headroom for a future 12-bit DAC.

## Frames

### `OUTPUT` — host → uSEQ (26 bytes, type `0x01`)

| Bytes  | Field                                            |
|--------|--------------------------------------------------|
| 0      | sync `0xAA`                                      |
| 1      | type `0x01`                                      |
| 2–23   | 11 × CV, `u16` LE, `0..4095` (CV1…CV11)          |
| 24     | gate bits: bit0=GATE1, bit1=GATE2, bit2=GATE3    |
| 25     | XOR of bytes 1–24                                |

CV order: indices 0–2 = main CV1–CV3; indices 3–10 = expander CV4–CV11.

### `IDENTIFY` — host → uSEQ (3 bytes, type `0x03`)

`[0xAA, 0x03, 0x03]` (last byte = XOR of byte 1). Main board flashes its LEDs,
forwards `0xDD` to the expander (which flashes too), and replies with an ack.

### `IDENTIFY_ACK` — uSEQ → host (4 bytes)

`[0xBB, 0x03, 0x01, 0x02]` (status `0x01` = ok; last byte = XOR of bytes 1–2).

### `INPUT` — uSEQ → host (11 bytes, type `0x01`, optional)

`[0xBB, 0x01, i1:u16, i2:u16, ai1:u16, ai2:u16, xor(1..9)]` @ 20 Hz — the main
board's two digital + two analog inputs, for browser-side status/visualisation.

### I2C — main → expander (18 bytes)

`[0xCC, cv:8×u16 LE (0..2047), xor(0..16)]` @ ~100 Hz on I2C addr `0x10`,
400 kHz. A single `0xDD` byte = identify (LED sweep). The 8 values are the
already-scaled 11-bit CV4–CV11.

## Reserved

Type `0x02` (the old runtime CONFIG / mode bitmask) is reserved and unused — v2's
topology is fixed in firmware.
