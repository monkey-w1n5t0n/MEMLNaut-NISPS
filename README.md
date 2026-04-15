# Neural Interactive Shaping of Parameter Spaces

https://musicallyembodiedml.github.io/memlnaut/approaches/nisps

## Firmware

The hardware firmware targets the MEMLNaut RP2350 build and uses repo-local helper
scripts for the known-good build configuration:

```bash
git submodule update --init --recursive

scripts/build-firmware.sh
scripts/flash-firmware.sh
scripts/build-and-flash-firmware.sh
```

Notes:
- The scripts build for `rp2040:rp2040:solderparty_rp2350_stamp_xl` with `Optimize3`.
- The build forces C++20 because the firmware uses `std::span` and concepts.
- `flash-firmware.sh` accepts an optional mountpoint argument, or auto-detects common UF2 bootloader mounts such as `/run/media/$USER/RP2350` and `/run/media/$USER/RPI-RP2`.

## Web Playground

Try NISPS in your browser — no hardware required:

```bash
cd playground
python3 -m http.server
# Open http://localhost:8000
```

Train a neural network to map joystick positions to generative visuals through interactive machine learning. Two learning modes: direct example mapping and reinforcement learning with thumbs up/down feedback.

The playground UI includes an **Expand** toggle on the visual surface so you can make the canvas nearly full-screen while compressing parameter/control panels into a minimal strip beneath it.
