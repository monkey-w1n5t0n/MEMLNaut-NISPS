#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./firmware-common.sh
source "$SCRIPT_DIR/firmware-common.sh"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage:
  scripts/build-firmware.sh [variant]
  scripts/build-firmware.sh --all
  scripts/build-firmware.sh --variant VARIANT [extra `pio run` args...]
  scripts/build-firmware.sh [variant] -- [extra `pio run` args...]

Builds the MEMLNaut firmware via PlatformIO (firmware/MEMLNaut-NISPS/platformio.ini).
If no variant is provided and the script is run in a TTY, it prompts from the
[env:...] sections in platformio.ini. --all builds every variant in one
PlatformIO invocation.

Requires `pio` (PlatformIO Core) on PATH — see
scripts/setup-firmware-toolchain.sh, or run under:
  nix-shell -p platformio-core --run 'scripts/build-firmware.sh ...'
EOF
  exit 0
fi

ensure_pio

variant_arg="${MEMLNAUT_FIRMWARE_VARIANT:-}"
build_all=0
run_extra=()

load_firmware_variants

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      build_all=1
      shift
      ;;
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
      run_extra+=("$@")
      break
      ;;
    -*)
      # Looks like a passthrough flag for `pio run` (e.g. -v), not a variant.
      run_extra+=("$1")
      shift
      ;;
    *)
      # A bare word is an attempted variant name, not passthrough — resolve it
      # now so a typo fails loudly instead of turning into a confusing
      # "Got unexpected extra argument" error from `pio run` later.
      if [[ -n "$variant_arg" ]]; then
        echo "error: unexpected extra argument: $1 (variant already set to $variant_arg)" >&2
        exit 1
      fi
      variant_arg="$(resolve_firmware_variant "$1")" || {
        echo "error: unknown firmware variant: $1" >&2
        echo "available variants (from $PLATFORMIO_INI):" >&2
        for v in "${FIRMWARE_VARIANTS[@]}"; do
          echo "  - $v" >&2
        done
        exit 1
      }
      shift
      ;;
  esac
done

if [[ "$build_all" -eq 1 ]]; then
  echo "Building ALL firmware variants: ${FIRMWARE_VARIANTS[*]}"
  env_args=()
  for v in "${FIRMWARE_VARIANTS[@]}"; do
    env_args+=(-e "$v")
  done
  run_pio run "${env_args[@]}" "${run_extra[@]}"
  echo
  echo "UF2s ready under:"
  for v in "${FIRMWARE_VARIANTS[@]}"; do
    echo "  $FIRMWARE_PROJECT_DIR/.pio/build/$v/firmware.uf2"
  done
  exit 0
fi

selected="$(choose_firmware_variant "$variant_arg")"

echo "Building firmware:"
echo "  project: $FIRMWARE_PROJECT_DIR"
echo "  variant: $selected"

run_pio run -e "$selected" "${run_extra[@]}"

echo
echo "UF2 ready at:"
echo "  $FIRMWARE_PROJECT_DIR/.pio/build/$selected/firmware.uf2"
