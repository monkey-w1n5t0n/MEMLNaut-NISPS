#!/usr/bin/env bash
#
# setup-firmware-toolchain.sh — one-shot bring-up of the MEMLNaut firmware
# build environment. Idempotent: safe to re-run.
#
# It will:
#   1. Initialise the git submodule (memllib).
#   2. Install arduino-cli (to ~/.local/bin) if it is not already on PATH.
#   3. Install the earlephilhower rp2040 core (provides the
#      solderparty_rp2350_stamp_xl board + the ARM GCC toolchain).
#   4. Install the Arduino libraries the firmware needs
#      (TFT_eSPI, TFT_eWidget, MIDI Library).
#   5. Drop the MEMLNaut-specific TFT_eSPI config (ILI9341, 320x240, MEMLNaut
#      pins) into the installed TFT_eSPI library as User_Setup.h, backing up
#      the stock one first. memllib `#include <User_Setup.h>` directly, so this
#      is the load-bearing step that makes the display compile + work.
#   6. Optionally compile the SelfTest firmware to verify the whole chain.
#
# Usage:
#   scripts/setup-firmware-toolchain.sh            # full setup + verify build
#   scripts/setup-firmware-toolchain.sh --no-build # setup only, skip the build
#
# Run this on your firmware build machine (Linux or macOS), NOT inside a
# sandbox. The rp2040 core download is large (hundreds of MB: it bundles the
# arm-none-eabi GCC toolchain).

set -euo pipefail

# ---- config -------------------------------------------------------------
RP2040_INDEX_URL="https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json"
ARDUINO_LIBS=("TFT_eSPI" "TFT_eWidget" "MIDI Library")
DO_BUILD=1

for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TFT_SETUP_SRC="$REPO_ROOT/firmware/MEMLNaut-NISPS/src/memllib/hardware/memlnaut/Setup9999_MEMLNaut.h.renameme"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mwarning: %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31merror: %s\033[0m\n' "$*" >&2; exit 1; }

# ---- 1. submodules ------------------------------------------------------
log "Initialising git submodule (memllib)"
command -v git >/dev/null 2>&1 || die "git is not installed"
git -C "$REPO_ROOT" submodule update --init --recursive

[[ -f "$TFT_SETUP_SRC" ]] || die "TFT setup file missing after submodule init: $TFT_SETUP_SRC"

# ---- 2. arduino-cli -----------------------------------------------------
if ! command -v arduino-cli >/dev/null 2>&1; then
  log "Installing arduino-cli into ~/.local/bin"
  mkdir -p "$HOME/.local/bin"
  curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh \
    | BINDIR="$HOME/.local/bin" sh
  export PATH="$HOME/.local/bin:$PATH"
  command -v arduino-cli >/dev/null 2>&1 || die "arduino-cli install failed"
  warn "arduino-cli was installed to ~/.local/bin — add it to your shell PATH permanently:"
  warn "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc   # or ~/.zshrc"
else
  log "arduino-cli already present: $(command -v arduino-cli) ($(arduino-cli version | head -1))"
fi

# ---- 3. rp2040 core (earlephilhower) ------------------------------------
# Pass the board index via --additional-urls so we don't mutate the user's
# global arduino-cli config.
log "Installing rp2040:rp2040 core (this downloads the ARM toolchain — be patient)"
arduino-cli core update-index --additional-urls "$RP2040_INDEX_URL"
if arduino-cli core list 2>/dev/null | grep -q '^rp2040:rp2040'; then
  log "rp2040:rp2040 already installed — checking for upgrade"
  arduino-cli core upgrade rp2040:rp2040 --additional-urls "$RP2040_INDEX_URL" || true
else
  arduino-cli core install rp2040:rp2040 --additional-urls "$RP2040_INDEX_URL"
fi

# ---- 4. Arduino libraries ----------------------------------------------
log "Installing Arduino libraries: ${ARDUINO_LIBS[*]}"
arduino-cli lib update-index
for lib in "${ARDUINO_LIBS[@]}"; do
  arduino-cli lib install "$lib"
done

# ---- 5. MEMLNaut TFT_eSPI User_Setup ------------------------------------
log "Configuring TFT_eSPI for the MEMLNaut display"
USER_DIR="$(arduino-cli config get directories.user 2>/dev/null || true)"
[[ -n "$USER_DIR" ]] || USER_DIR="$HOME/Arduino"
TFT_DIR="$USER_DIR/libraries/TFT_eSPI"
[[ -d "$TFT_DIR" ]] || die "TFT_eSPI library dir not found at $TFT_DIR (did lib install fail?)"

TFT_SETUP_DST="$TFT_DIR/User_Setup.h"
if [[ -f "$TFT_SETUP_DST" && ! -f "$TFT_SETUP_DST.orig" ]]; then
  cp "$TFT_SETUP_DST" "$TFT_SETUP_DST.orig"
  log "Backed up stock User_Setup.h -> User_Setup.h.orig"
fi
cp "$TFT_SETUP_SRC" "$TFT_SETUP_DST"
log "Installed MEMLNaut User_Setup.h into $TFT_DIR"

# ---- 6. verify build ----------------------------------------------------
if [[ "$DO_BUILD" -eq 1 ]]; then
  log "Verifying: compiling the SelfTest firmware"
  if "$REPO_ROOT/scripts/build-firmware.sh" SelfTest; then
    log "SelfTest firmware built successfully ✔"
    echo
    echo "Next: flash it with"
    echo "    scripts/flash-firmware.sh"
    echo "or build a normal mode, e.g.  scripts/build-firmware.sh PAFSynth"
  else
    die "SelfTest build failed — see the arduino-cli output above. Toolchain/libs are installed; this is a compile error to debug."
  fi
else
  log "Setup complete (build skipped). Verify with:"
  echo "    scripts/build-firmware.sh SelfTest"
fi
