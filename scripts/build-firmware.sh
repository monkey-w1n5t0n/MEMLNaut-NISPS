#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./firmware-common.sh
source "$SCRIPT_DIR/firmware-common.sh"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage:
  scripts/build-firmware.sh [extra arduino-cli compile args...]

Builds the MEMLNaut firmware with the repo's known-good RP2350 target and C++20 flag.
EOF
  exit 0
fi

ensure_arduino_cli
ensure_submodules_ready

mkdir -p "$BUILD_DIR"

echo "Building firmware:"
echo "  sketch: $SKETCH_PATH"
echo "  fqbn:   $FQBN"
echo "  out:    $BUILD_DIR"

compile_args=(
  compile
  --fqbn "$FQBN"
  --build-property "$CXX20_BUILD_PROPERTY"
  --output-dir "$BUILD_DIR"
  "$SKETCH_PATH"
)
compile_args+=("$@")

arduino-cli "${compile_args[@]}"

echo
echo "UF2 ready at:"
echo "  $UF2_PATH_DEFAULT"
