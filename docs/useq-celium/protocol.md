# uSEQ-Celium wire protocol

Two hops, both compact binary, fixed-size packets.

```
   [browser]  ==USB CDC serial==>  [uSEQ main FW]  ==I2C (Wire1)==>  [expander FW]
               StateSnapshot                       ExpanderFrame
```

All integers are **little-endian**. CRC8 is polynomial `0x07`, init `0x00`, no reflection (the classic "SMBus/CCITT-8" variant).

---

## Hop 1 — Browser → uSEQ main (USB CDC, 115200 baud)

Framed streaming. Browser emits a full channel-state snapshot every ~2 ms (target 500 Hz). Firmware applies the latest valid packet and ignores stale/corrupt ones.

### StateSnapshot (28 bytes, `TYPE = 0x01`)

| offset | size | field         | notes                                                     |
|-------:|-----:|---------------|-----------------------------------------------------------|
|      0 |    1 | `SYNC_1`      | `0xA7`                                                    |
|      1 |    1 | `SYNC_2`      | `0x5E`                                                    |
|      2 |    1 | `TYPE`        | `0x01`                                                    |
|      3 |    1 | `SEQ`         | rolling counter mod 256 — for drop detection              |
|      4 |    1 | `GATES`       | bits 0–2 = hard gates 0–2 (1=high), bits 3–7 reserved (0) |
|      5 |    6 | `CV_MAIN[3]`  | 3 × `u16` — main module CV channels 0..2 (0..65535)       |
|     11 |   16 | `CV_EXP[8]`   | 8 × `u16` — expander CV channels 0..7 (0..65535)          |
|     27 |    1 | `CRC8`        | CRC over bytes `[2..26]` (type..last CV byte)             |

- **CV value domain**: `u16` 0..65535. Firmware right-shifts by 5 to produce the 11-bit PIO-PWM range 0..2047. Keeping u16 gives headroom if the hardware gains a 12/16-bit DAC later without a protocol bump.
- **Hard gates**: binary only on the main module (GPIO). Dynamic-gate behaviour (variable-height gates) is expressed on CV channels — the browser computes the velocity-shaped CV value and places it in `CV_MAIN` / `CV_EXP`. The firmware is dumb about "mode".
- **SYNC sequence** `0xA7 0x5E`: low collision probability; CRC mismatch drops the frame and resync resumes from next `0xA7`.
- **SEQ**: if browser observes an unexpected jump on the return path (future ACK packet), it can log drops. Firmware itself doesn't need to act on SEQ.

### Framing rules (firmware side)

1. Read bytes until `0xA7` seen.
2. If next byte is `0x5E`, read 26 more bytes.
3. Compute CRC8 over bytes `[TYPE..last CV byte]`. If mismatch → discard, go to 1.
4. If match → apply to hardware outputs.

Re-sync cost on corruption: at 500 Hz, one packet ≈ 2 ms. Acceptable.

### Other packet types (reserved, not implemented in v1)

| TYPE | direction             | name         | purpose                                |
|-----:|-----------------------|--------------|----------------------------------------|
| 0x01 | browser → uSEQ        | StateSnapshot | channel state (implemented)            |
| 0x02 | uSEQ → browser        | FwHello       | firmware version + HW variant announce |
| 0x03 | uSEQ → browser        | Ack           | seq echo, drop counter                 |
| 0x7F | either                | Reset         | safety: all outputs → 0                |

---

## Hop 2 — uSEQ main → expander (I2C, Wire1, 400 kHz)

Expander listens at I2C address **`0x42`**. Main firmware writes one fixed-size frame per state update (rate-limited to ≤ 1 kHz to avoid saturating the bus).

### ExpanderFrame (19 bytes)

| offset | size | field   | notes                                  |
|-------:|-----:|---------|----------------------------------------|
|      0 |    1 | `TYPE`  | `0xE1` (EXP_CV_UPDATE)                 |
|      1 |    1 | `SEQ`   | rolling counter                        |
|      2 |   16 | `CV[8]` | 8 × `u16` — expander channel values    |
|     18 |    1 | `CRC8`  | CRC over bytes `[0..17]`               |

I2C START/STOP handles framing; no SYNC bytes needed. On CRC mismatch the expander drops the frame (the next one arrives within ~1 ms).

### Expander PWM scaling

Matches main-module CV: `u16 >> 5` → 11-bit PWM `0..2047`. Expander firmware applies the same shift.

---

## Constants (mirrored between C header and JS)

The canonical header is `firmware/useq-celium/include/protocol.h`. Browser-side constants in `playground/js/useq-celium/protocol.js` must stay in sync with it by eye (these are few and change rarely — a one-line comment reminder is enough).

| name                     | value  | where                                  |
|--------------------------|-------:|----------------------------------------|
| `UC_SYNC_1`              | `0xA7` | browser→uSEQ framing                   |
| `UC_SYNC_2`              | `0x5E` | browser→uSEQ framing                   |
| `UC_TYPE_STATE_SNAPSHOT` | `0x01` | StateSnapshot packet type              |
| `UC_TYPE_FW_HELLO`       | `0x02` | reserved                               |
| `UC_TYPE_ACK`            | `0x03` | reserved                               |
| `UC_TYPE_RESET`          | `0x7F` | reserved                               |
| `UC_EXP_I2C_ADDR`        | `0x42` | I2C address of expander                |
| `UC_EXP_TYPE_CV_UPDATE`  | `0xE1` | ExpanderFrame packet type              |
| `UC_NUM_HARD_GATES`      | `3`    | GPIO gates on main (v1.0 pins 18/17/16)|
| `UC_NUM_MAIN_CV`         | `3`    | PIO-PWM CVs on main (v1.0 pins 21/20/19)|
| `UC_NUM_EXP_CV`          | `8`    | expander PWM CVs                       |
| `UC_STATE_SNAPSHOT_LEN`  | `28`   | total bytes                            |
| `UC_EXPANDER_FRAME_LEN`  | `19`   | total bytes                            |

---

## CRC8 reference implementation

```c
uint8_t crc8(const uint8_t* data, size_t len) {
    uint8_t crc = 0x00;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (uint8_t b = 0; b < 8; b++) {
            crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x07) : (uint8_t)(crc << 1);
        }
    }
    return crc;
}
```

JS port:

```js
export function crc8(bytes, start = 0, end = bytes.length) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}
```

---

## Design notes

- **Why polled state, not events?** Decided in design: gate edges fire at browser clock; sending a full snapshot every 2 ms is robust against USB CDC dropouts (one missed packet = 2 ms old values, not a missed edge). Sits well within USB bandwidth (≈ 14 KB/s).
- **Why `u16` for CV?** PWM is currently 11-bit, but forcing the protocol to 11-bit locks future hardware. `u16 >> 5` is trivial and future-proof.
- **Why dumb firmware?** Keeps the main FW a pure translator (serial in → hardware out + I2C forward). All rhythm/CV shaping is in the browser, where it belongs architecturally for this mode.
