#!/usr/bin/env python3
"""Send StateSnapshot packets to a uSEQ-Celium main module over USB CDC.

Exercises the protocol without the browser in the loop. Useful for bringing
up the firmware, scoping CV/Gate outputs, and verifying I2C forwarding to
the expander.

Usage:
    ./send_state.py --port /dev/ttyACM0 --rate 500 --pattern ramp

KEEP IN SYNC WITH include/protocol.h — constants mirrored by eye.
"""

from __future__ import annotations

import argparse
import math
import signal
import struct
import sys
import time
from typing import Iterable

try:
    import serial  # pyserial
except ImportError:
    print("pyserial not installed. Try: pip install pyserial", file=sys.stderr)
    sys.exit(1)


# --- Protocol constants (mirror of include/protocol.h) ----------------------
UC_SYNC_1 = 0xA7
UC_SYNC_2 = 0x5E
UC_TYPE_STATE_SNAPSHOT = 0x01
UC_NUM_HARD_GATES = 3
UC_NUM_MAIN_CV = 3
UC_NUM_EXP_CV = 8
UC_STATE_SNAPSHOT_LEN = 28


def crc8(data: bytes) -> int:
    """CRC8 poly 0x07, init 0x00, no reflection. KEEP IN SYNC with uc_crc8."""
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x80:
                crc = ((crc << 1) ^ 0x07) & 0xFF
            else:
                crc = (crc << 1) & 0xFF
    return crc


def build_snapshot(seq: int, gates: int, cv_main: Iterable[int], cv_exp: Iterable[int]) -> bytes:
    """Pack a StateSnapshot (28 bytes, little-endian)."""
    cv_main = list(cv_main)
    cv_exp = list(cv_exp)
    assert len(cv_main) == UC_NUM_MAIN_CV
    assert len(cv_exp) == UC_NUM_EXP_CV

    # Body: [type, seq, gates, cv_main x3 (u16 LE), cv_exp x8 (u16 LE)] = 25 bytes
    body = struct.pack(
        "<BBB" + "H" * UC_NUM_MAIN_CV + "H" * UC_NUM_EXP_CV,
        UC_TYPE_STATE_SNAPSHOT,
        seq & 0xFF,
        gates & 0xFF,
        *cv_main,
        *cv_exp,
    )
    assert len(body) == UC_STATE_SNAPSHOT_LEN - 3, "body length mismatch"
    return bytes([UC_SYNC_1, UC_SYNC_2]) + body + bytes([crc8(body)])


# --- Patterns ---------------------------------------------------------------

def pattern_ramp(t: float) -> tuple[int, list[int], list[int]]:
    """Slow sawtooth on every CV, all gates high."""
    # period = 4 s
    phase = (t % 4.0) / 4.0
    v = int(phase * 65535)
    return 0b111, [v] * UC_NUM_MAIN_CV, [v] * UC_NUM_EXP_CV


def pattern_sine(t: float) -> tuple[int, list[int], list[int]]:
    """Sine waves with small per-channel phase offsets. Gates alternate."""
    def s(offset: float, period: float = 2.0) -> int:
        x = math.sin(2 * math.pi * ((t / period) + offset))
        return int(32768 + 32767 * x)

    cv_main = [s(i * 0.15) for i in range(UC_NUM_MAIN_CV)]
    cv_exp = [s(0.3 + i * 0.1, period=3.0) for i in range(UC_NUM_EXP_CV)]
    gates = 0b111 if (int(t * 2) % 2) == 0 else 0b000
    return gates, cv_main, cv_exp


def pattern_gate_blink(t: float) -> tuple[int, list[int], list[int]]:
    """CVs held at midpoint; gates blink at 4 Hz in a walking pattern."""
    cv = [0x8000] * UC_NUM_MAIN_CV
    ev = [0x8000] * UC_NUM_EXP_CV
    step = int(t * 4) % UC_NUM_HARD_GATES
    return (1 << step), cv, ev


def pattern_zero(_t: float) -> tuple[int, list[int], list[int]]:
    return 0, [0] * UC_NUM_MAIN_CV, [0] * UC_NUM_EXP_CV


PATTERNS = {
    "ramp": pattern_ramp,
    "sine": pattern_sine,
    "gate-blink": pattern_gate_blink,
    "zero": pattern_zero,
}


# --- Main -------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--port", required=True, help="e.g. /dev/ttyACM0")
    p.add_argument("--rate", type=float, default=500.0, help="packets/second (default 500)")
    p.add_argument("--pattern", choices=sorted(PATTERNS), default="ramp")
    args = p.parse_args()

    gen = PATTERNS[args.pattern]
    period = 1.0 / args.rate if args.rate > 0 else 0.0
    stop = {"flag": False}

    def on_sigint(_s, _f):
        stop["flag"] = True

    signal.signal(signal.SIGINT, on_sigint)

    with serial.Serial(args.port, 115200, timeout=0, write_timeout=0.5) as ser:
        print(f"Sending {args.pattern} at {args.rate} Hz to {args.port}. Ctrl-C to stop.",
              file=sys.stderr)
        seq = 0
        t0 = time.monotonic()
        next_tick = t0
        while not stop["flag"]:
            t = time.monotonic() - t0
            gates, cv_main, cv_exp = gen(t)
            pkt = build_snapshot(seq, gates, cv_main, cv_exp)
            try:
                ser.write(pkt)
            except serial.SerialTimeoutException:
                print("write timeout", file=sys.stderr)
            seq = (seq + 1) & 0xFF

            next_tick += period
            sleep = next_tick - time.monotonic()
            if sleep > 0:
                time.sleep(sleep)
            else:
                # We've fallen behind; resync the schedule to now.
                next_tick = time.monotonic()
    print("stopped.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
