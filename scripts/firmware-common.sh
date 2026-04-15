#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SKETCH_PATH="${MEMLNAUT_FIRMWARE_SKETCH:-$REPO_ROOT/MEMLNaut-NISPS.ino}"
SKETCH_NAME="$(basename "$SKETCH_PATH")"
BUILD_DIR="${MEMLNAUT_FIRMWARE_BUILD_DIR:-/tmp/memlnaut-firmware-build}"
UF2_PATH_DEFAULT="${MEMLNAUT_FIRMWARE_UF2:-$BUILD_DIR/${SKETCH_NAME}.uf2}"

FQBN="${MEMLNAUT_FIRMWARE_FQBN:-rp2040:rp2040:solderparty_rp2350_stamp_xl:opt=Optimize3}"
CXX20_BUILD_PROPERTY="${MEMLNAUT_FIRMWARE_CXX20_PROPERTY:-compiler.cpp.extra_flags=-std=gnu++20}"

ensure_arduino_cli() {
  if ! command -v arduino-cli >/dev/null 2>&1; then
    echo "error: arduino-cli is not installed or not on PATH" >&2
    exit 1
  fi
}

ensure_git() {
  if ! command -v git >/dev/null 2>&1; then
    echo "error: git is not installed or not on PATH" >&2
    exit 1
  fi
}

ensure_submodules_ready() {
  ensure_git

  local status
  status="$(git -C "$REPO_ROOT" submodule status --recursive)"
  if grep -qE '^[+-]' <<<"$status"; then
    echo "error: submodules are not initialized or not at the recorded revision" >&2
    echo "run: git submodule update --init --recursive" >&2
    exit 1
  fi
}

resolve_path() {
  local path="$1"

  if [[ "$path" = /* ]]; then
    printf '%s\n' "$path"
  else
    printf '%s\n' "$(pwd)/$path"
  fi
}

find_boot_mount() {
  local candidates=(
    "/run/media/${USER}/RP2350"
    "/run/media/${USER}/RPI-RP2"
    "/media/${USER}/RP2350"
    "/media/${USER}/RPI-RP2"
    "/mnt/RP2350"
    "/mnt/RPI-RP2"
  )
  local candidate

  for candidate in "${candidates[@]}"; do
    if [[ -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  local base
  for base in "/run/media/${USER}" "/media/${USER}" "/mnt"; do
    [[ -d "$base" ]] || continue
    candidate="$(find "$base" -maxdepth 2 -type f -name INFO_UF2.TXT -printf '%h\n' 2>/dev/null | head -n 1 || true)"
    if [[ -n "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

assert_boot_mount() {
  local mountpoint="$1"

  if [[ ! -d "$mountpoint" ]]; then
    echo "error: bootloader mount does not exist: $mountpoint" >&2
    exit 1
  fi

  if [[ ! -f "$mountpoint/INFO_UF2.TXT" && ! -f "$mountpoint/INDEX.HTM" ]]; then
    echo "error: $mountpoint does not look like an RP2040/RP2350 UF2 boot volume" >&2
    exit 1
  fi
}
