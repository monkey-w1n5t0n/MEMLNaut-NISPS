#!/usr/bin/env python3
"""MIDI CC receiver — listens on all ALSA ports and prints CC messages."""
import mido
import sys

def main():
    ports = mido.get_input_names()
    print(f"Available MIDI inputs: {ports}")

    if not ports:
        print("No MIDI input ports found!")
        sys.exit(1)

    # Open the Midi Through port (Chrome sends to this)
    port_name = ports[0]
    for p in ports:
        if 'Through' in p:
            port_name = p
            break

    print(f"Listening on: {port_name}")
    print("Waiting for MIDI CC messages...\n")

    with mido.open_input(port_name) as inport:
        for msg in inport:
            if msg.type == 'control_change':
                print(f"  CC #{msg.control:3d}  val={msg.value:3d}  ch={msg.channel + 1:2d}")
            else:
                print(f"  {msg}")

if __name__ == '__main__':
    main()
