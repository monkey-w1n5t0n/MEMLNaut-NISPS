#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/build-and-flash-firmware.sh
  scripts/build-and-flash-firmware.sh [mountpoint]

If no mountpoint is provided, the flash step auto-detects a standard UF2
bootloader location such as /run/media/$USER/RP2350 or /run/media/$USER/RPI-RP2.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

case $# in
  0)
    ;;
  1)
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

"$SCRIPT_DIR/build-firmware.sh"

if [[ $# -eq 1 ]]; then
  "$SCRIPT_DIR/flash-firmware.sh" "$1"
else
  "$SCRIPT_DIR/flash-firmware.sh"
fi
