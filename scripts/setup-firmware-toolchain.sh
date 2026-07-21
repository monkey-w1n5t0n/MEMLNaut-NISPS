#!/usr/bin/env bash
#
# setup-firmware-toolchain.sh — bring-up check for the MEMLNaut firmware
# PlatformIO build. Idempotent: safe to re-run.
#
# There is very little left to "set up": memllib is vendored into
# firmware/MEMLNaut-NISPS/lib/memllib (no submodule to init), and PlatformIO
# bootstraps its own platform + toolchain + libraries (TFT_eSPI, TFT_eWidget,
# MIDI Library, all version-pinned in platformio.ini) into ~/.platformio on
# first build — no global Arduino library-directory mutation, no manual
# TFT_eSPI User_Setup.h copy (that config is now `-D` build flags in
# platformio.ini).
#
# This script just:
#   1. Checks `pio` (PlatformIO Core) is reachable.
#   2. Optionally compiles the `selftest` variant to verify the whole chain
#      (downloads ~1-2 GB of platform/toolchain packages on first run).
#
# Usage:
#   scripts/setup-firmware-toolchain.sh            # verify via a SelfTest build
#   scripts/setup-firmware-toolchain.sh --no-build # just check `pio` is reachable
#
# This machine uses nix. If `pio` isn't already on PATH, run this script (and
# the other firmware scripts) through:
#   nix-shell -p platformio-core --run 'scripts/setup-firmware-toolchain.sh'
# NOT `nix-shell -p platformio` — that package wraps the CLI in a bubblewrap
# FHS sandbox that fails under containerised/sandboxed shells (no working user
# namespace). `platformio-core` is the same CLI, unwrapped.

set -euo pipefail

DO_BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./firmware-common.sh
source "$SCRIPT_DIR/firmware-common.sh"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31merror: %s\033[0m\n' "$*" >&2; exit 1; }

log "Checking for PlatformIO Core (pio)"
ensure_pio
log "pio found: $(command -v pio) ($(pio --version 2>&1 | head -1))"

if [[ "$DO_BUILD" -eq 1 ]]; then
  log "Verifying: compiling the SelfTest firmware (first run downloads the RP2350 platform/toolchain into ~/.platformio — hundreds of MB, be patient)"
  if "$SCRIPT_DIR/build-firmware.sh" selftest; then
    log "SelfTest firmware built successfully"
    echo
    echo "Next: flash it with"
    echo "    scripts/flash-firmware.sh selftest"
    echo "or build a normal mode, e.g.  scripts/build-firmware.sh pafsynth"
    echo "or build every variant:       scripts/build-firmware.sh --all"
  else
    die "SelfTest build failed — see the pio output above. This is a compile error to debug, not a missing-toolchain problem (pio bootstraps its own toolchain)."
  fi
else
  log "Setup check complete (build skipped). Verify with:"
  echo "    scripts/build-firmware.sh selftest"
fi
