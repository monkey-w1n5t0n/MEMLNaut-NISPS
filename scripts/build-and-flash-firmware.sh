#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/build-and-flash-firmware.sh
  scripts/build-and-flash-firmware.sh [variant]
  scripts/build-and-flash-firmware.sh --variant VARIANT [mountpoint]

If no mountpoint is provided, the flash step auto-detects a standard UF2
bootloader location such as /run/media/$USER/RP2350 or /run/media/$USER/RPI-RP2.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

source "$SCRIPT_DIR/firmware-common.sh"
load_firmware_variants

variant_arg="${MEMLNAUT_FIRMWARE_VARIANT:-}"
mountpoint=""

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
      if [[ -z "$variant_arg" ]] && resolve_firmware_variant "$1" >/dev/null 2>&1; then
        variant_arg="$1"
      elif [[ -z "$mountpoint" ]]; then
        mountpoint="$1"
      else
        usage >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -n "$variant_arg" ]]; then
  "$SCRIPT_DIR/build-firmware.sh" --variant "$variant_arg"
else
  "$SCRIPT_DIR/build-firmware.sh"
fi

if [[ -n "$mountpoint" ]]; then
  "$SCRIPT_DIR/flash-firmware.sh" "$mountpoint"
else
  "$SCRIPT_DIR/flash-firmware.sh"
fi
