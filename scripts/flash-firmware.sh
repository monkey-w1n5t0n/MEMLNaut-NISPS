#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./firmware-common.sh
source "$SCRIPT_DIR/firmware-common.sh"

usage() {
  cat <<'EOF'
Usage:
  scripts/flash-firmware.sh
  scripts/flash-firmware.sh [mountpoint]
  scripts/flash-firmware.sh [uf2-path] [mountpoint]

Defaults:
  uf2-path   -> /tmp/memlnaut-firmware-build/MEMLNaut-NISPS.ino.uf2
  mountpoint -> auto-detect from standard UF2 bootloader locations
EOF
}

uf2_path="$UF2_PATH_DEFAULT"
mountpoint=""

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

case $# in
  0)
    ;;
  1)
    if [[ -f "$1" || "$1" == *.uf2 ]]; then
      uf2_path="$1"
    else
      mountpoint="$1"
    fi
    ;;
  2)
    uf2_path="$1"
    mountpoint="$2"
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

uf2_path="$(resolve_path "$uf2_path")"
if [[ ! -f "$uf2_path" ]]; then
  echo "error: UF2 file not found: $uf2_path" >&2
  echo "run scripts/build-firmware.sh first, or pass an explicit UF2 path" >&2
  exit 1
fi

if [[ -z "$mountpoint" ]]; then
  mountpoint="$(find_boot_mount || true)"
fi

if [[ -z "$mountpoint" ]]; then
  echo "error: could not find a mounted UF2 bootloader volume" >&2
  echo "put the board in bootloader mode or pass the mountpoint explicitly" >&2
  exit 1
fi

mountpoint="$(resolve_path "$mountpoint")"
assert_boot_mount "$mountpoint"

echo "Flashing firmware:"
echo "  uf2:       $uf2_path"
echo "  mountpoint: $mountpoint"

cp "$uf2_path" "$mountpoint/"
sync

echo
echo "Flash copy completed."
