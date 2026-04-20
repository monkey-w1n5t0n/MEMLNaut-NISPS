# uSEQ-Celium firmware tools

Two helpers for exercising the wire protocol without the browser in the loop.

## `send_state.py` — real-hardware harness (Python)

Sends `StateSnapshot` packets to a connected uSEQ main module over USB CDC at
the configured rate. Useful for scoping CV/gate outputs and verifying I2C
forwarding to the expander.

Requires: `pyserial` (`pip install pyserial`).

```bash
./send_state.py --port /dev/ttyACM0 --pattern ramp --rate 500
```

Patterns: `zero`, `ramp`, `sine`, `gate-blink`. Ctrl-C to stop.

## `loopback_smoke.mjs` — no-hardware smoke test (Node)

End-to-end smoke test: runs the browser-side `encodeStateSnapshot` at 500 Hz
through a loopback transport into a Node port of the firmware parser state
machine (mirrors `src/main/main.cpp`). Checks framing, CRC, and sequence
continuity. Exits 0 on PASS, 1 on FAIL. Last line of stdout is always
`PASS` or `FAIL`.

```bash
node firmware/useq-celium/tools/loopback_smoke.mjs --pattern zero --duration 2
node firmware/useq-celium/tools/loopback_smoke.mjs --pattern ramp --duration 5
node firmware/useq-celium/tools/loopback_smoke.mjs --pattern sine --duration 5
node firmware/useq-celium/tools/loopback_smoke.mjs --tcp   # force TCP fallback
```

Transports:

- **Preferred**: socat PTY pair (`socat -d -d pty,raw,echo=0 pty,raw,echo=0`).
  Runs if socat is on `PATH`. On NixOS: `nix-shell -p socat --run '…'`.
- **Fallback**: TCP localhost pair. Enabled with `--tcp`, or automatically
  when socat is missing. For browser-side use with the TCP transport, a
  future extension could accept `?useq-serial-tcp=<port>` and bypass
  `navigator.serial` — not currently wired up.

Patterns mirror `send_state.py`: `zero`, `ramp`, `sine`, `gates`. Every 250th
packet (≈ twice per second at 500 Hz) is logged with its decoded content.

## Keep in sync

Both tools hard-code protocol constants. The canonical source is
`firmware/useq-celium/include/protocol.h`. The Node harness imports from
`playground/js/useq-celium/protocol.js` (which mirrors the C header by eye);
`send_state.py` mirrors both. If you bump the protocol, update all three.
