#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./firmware-common.sh
source "$SCRIPT_DIR/firmware-common.sh"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage:
  scripts/build-firmware.sh [variant]
  scripts/build-firmware.sh --variant VARIANT [extra arduino-cli compile args...]
  scripts/build-firmware.sh [variant] -- [extra arduino-cli compile args...]

Builds the MEMLNaut firmware with the repo's known-good RP2350 target and C++20 flag.
If no variant is provided and the script is run in a TTY, it prompts from the parsed
MEMLNaut mode list in MEMLNaut-NISPS.ino and rewrites the active mode before building.
EOF
  exit 0
fi

ensure_arduino_cli
ensure_submodules_ready

variant_arg="${MEMLNAUT_FIRMWARE_VARIANT:-}"
compile_extra=()

load_firmware_variants

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
    --)
      shift
      compile_extra+=("$@")
      break
      ;;
    *)
      if [[ -z "$variant_arg" ]] && resolve_firmware_variant "$1" >/dev/null 2>&1; then
        variant_arg="$1"
      else
        compile_extra+=("$1")
      fi
      shift
      ;;
  esac
done

set_firmware_variant "$variant_arg"
mkdir -p "$BUILD_DIR"

echo "Building firmware:"
echo "  sketch: $SKETCH_PATH"
echo "  fqbn:   $FQBN"
echo "  out:    $BUILD_DIR"
echo "  variant: $(variant_alias "$ACTIVE_FIRMWARE_VARIANT")"

compile_args=(
  compile
  --fqbn "$FQBN"
  --build-property "$CXX20_BUILD_PROPERTY"
  --output-dir "$BUILD_DIR"
  "$SKETCH_PATH"
)
compile_args+=("${compile_extra[@]}")

arduino-cli "${compile_args[@]}"

echo
echo "UF2 ready at:"
echo "  $UF2_PATH_DEFAULT"
