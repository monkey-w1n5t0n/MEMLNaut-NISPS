#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/build-and-flash-firmware.sh [variant]
  scripts/build-and-flash-firmware.sh --variant VARIANT

Builds then flashes (via PlatformIO's picotool upload protocol) the given
firmware variant. Put the board in bootloader mode first.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

# shellcheck source=./firmware-common.sh
source "$SCRIPT_DIR/firmware-common.sh"
ensure_pio
load_firmware_variants

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

"$SCRIPT_DIR/build-firmware.sh" --variant "$selected"
"$SCRIPT_DIR/flash-firmware.sh" --variant "$selected"
