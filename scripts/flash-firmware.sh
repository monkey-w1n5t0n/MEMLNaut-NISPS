#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./firmware-common.sh
source "$SCRIPT_DIR/firmware-common.sh"

usage() {
  cat <<'EOF'
Usage:
  scripts/flash-firmware.sh [variant]
  scripts/flash-firmware.sh --variant VARIANT

Builds (if stale) and flashes the given firmware variant via PlatformIO's
`picotool` upload protocol (platformio.ini `upload_protocol = picotool`).
picotool talks to the RP2040/2350 USB bootloader directly — no BOOTSEL-mode
mount-point detection or UF2-file-copy step required.

Put the board in bootloader mode (hold BOOTSEL while plugging in, or the
board's reset-to-bootloader combo) before running this.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ensure_pio

variant_arg="${MEMLNAUT_FIRMWARE_VARIANT:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --variant)
      if [[ $# -lt 2 ]]; then
        echo "error: --variant requires a value" >&2
        exit 1
      fi
      variant_arg="$2"
      shift 2
      ;;
    --variant=*)
      variant_arg="${1#*=}"
      shift
      ;;
    *)
      if [[ -z "$variant_arg" ]]; then
        variant_arg="$1"
        shift
      else
        usage >&2
        exit 1
      fi
      ;;
  esac
done

selected="$(choose_firmware_variant "$variant_arg")"

echo "Flashing firmware:"
echo "  project: $FIRMWARE_PROJECT_DIR"
echo "  variant: $selected"
echo "  (board must be in BOOTSEL/bootloader mode)"

run_pio run -e "$selected" -t upload
