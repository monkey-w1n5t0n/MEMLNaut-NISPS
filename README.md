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
- `build-firmware.sh` accepts an optional variant name such as `MEMLCelium` or `BreakOr`. Matching remains case-insensitive, so `memlcelium` still works. If you omit it in an interactive shell, the script parses `MEMLNaut-NISPS.ino`, prompts for a variant, and rewrites the active `MEMLNAUT_MODE_TYPE` before building.
- `flash-firmware.sh` accepts an optional mountpoint argument, or auto-detects common UF2 bootloader mounts such as `/run/media/$USER/RP2350` and `/run/media/$USER/RPI-RP2`.

## Manifold (browser app)

Try NISPS in your browser — no hardware required. Manifold is the React front-end
running the same C++ engines + ML as the firmware, compiled to WASM:

```bash
cd manifold
bun install
bun run dev
```

Staging deployment: https://meml.lnfinitemonkeys.org/next/

Train a neural network to map input gestures to synth parameters through interactive
machine learning: place examples, or use verdict-based feedback (explore-and-place,
geometric dislike).

(The former SolidJS playground was retired in July 2026 — archived on branch
`archive/playground-solidjs`, tag `playground-solidjs-final`.)
