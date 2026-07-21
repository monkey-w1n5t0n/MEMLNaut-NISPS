#!/usr/bin/env bash
#
# build-firmware-arch.sh — build the MEMLNaut RP2350 firmware on Arch Linux
# (incl. Omarchy). Checks + installs system deps via pacman/yay, brings up the
# arduino-cli toolchain + rp2040 core, and compiles a firmware variant.
#
# Idempotent: safe to re-run. This is a thin Arch-specific front-end around the
# cross-platform scripts/setup-firmware-toolchain.sh + scripts/build-firmware.sh.
#
# Usage:
#   scripts/build-firmware-arch.sh [VARIANT]      # default VARIANT=PAFSynth
#   scripts/build-firmware-arch.sh --setup-only   # toolchain only, no compile
#   scripts/build-firmware-arch.sh --list         # list firmware variants
#
# The rp2040 core download is large (hundreds of MB — it bundles arm-none-eabi
# GCC). Run on your laptop, on mains power, with a good connection.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VARIANT="PAFSynth"
SETUP_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --setup-only) SETUP_ONLY=1 ;;
    --list) grep -oE '"[A-Za-z0-9]+"' "$REPO_ROOT/scripts/build-firmware.sh" 2>/dev/null | head; exit 0 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) VARIANT="$arg" ;;
  esac
done

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mwarning: %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31merror: %s\033[0m\n' "$*" >&2; exit 1; }

# ---- 0. sanity: are we on Arch? ----------------------------------------
command -v pacman >/dev/null 2>&1 || die "pacman not found — this script is for Arch Linux / Omarchy. Use scripts/setup-firmware-toolchain.sh on other distros."

# ---- 1. system deps via pacman -----------------------------------------
# The rp2040 core ships its own arm-none-eabi GCC, so we only need the basics
# (git/curl/unzip) + python (some core post-install steps want it).
need_pkgs=()
for bin_pkg in "git:git" "curl:curl" "unzip:unzip" "python:python"; do
  bin="${bin_pkg%%:*}"; pkg="${bin_pkg##*:}"
  command -v "$bin" >/dev/null 2>&1 || need_pkgs+=("$pkg")
done
if (( ${#need_pkgs[@]} )); then
  log "Installing system deps via pacman: ${need_pkgs[*]}"
  sudo pacman -S --needed --noconfirm "${need_pkgs[@]}"
else
  log "System deps present (git, curl, unzip, python)"
fi

# ---- 2. arduino-cli -----------------------------------------------------
# Prefer the official binary (matches the cross-platform setup script's pin);
# fall back to AUR (yay) if the user already has arduino-cli from there.
if ! command -v arduino-cli >/dev/null 2>&1; then
  if command -v yay >/dev/null 2>&1; then
    log "Installing arduino-cli from the AUR (yay)"
    yay -S --needed --noconfirm arduino-cli || warn "yay install failed; the toolchain script will fetch the official binary into ~/.local/bin"
  else
    log "arduino-cli not found; the toolchain script will install it into ~/.local/bin"
  fi
fi

# ---- 3. submodule bring-up ----------------------------------------------
# memllib provides the audio/synth/hardware tree the sketch compiles against.
log "Checking the memllib submodule"
git -C "$REPO_ROOT" submodule update --init --recursive
if [[ ! -e "$REPO_ROOT/firmware/MEMLNaut-NISPS/src/memllib/hardware/memlnaut" ]]; then
  die "src/memllib looks empty after submodule init — check the submodule pin and remote."
fi

# ---- 4. toolchain bring-up (delegates the heavy lifting) ----------------
log "Bringing up the arduino-cli toolchain + rp2040 core + libraries"
if (( SETUP_ONLY )); then
  "$REPO_ROOT/scripts/setup-firmware-toolchain.sh" --no-build
  log "Setup complete (--setup-only). Run without --setup-only to compile."
  exit 0
fi
"$REPO_ROOT/scripts/setup-firmware-toolchain.sh" --no-build

# ---- 5. build the requested variant ------------------------------------
export PATH="$HOME/.local/bin:$PATH"
log "Building firmware variant: $VARIANT"
"$REPO_ROOT/scripts/build-firmware.sh" "$VARIANT"

log "Done. Flash with: scripts/flash-firmware.sh  (hold BOOTSEL while plugging in the RP2350)."
