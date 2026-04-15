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

FIRMWARE_VARIANTS=()
ACTIVE_FIRMWARE_VARIANT=""

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

load_firmware_variants() {
  mapfile -t FIRMWARE_VARIANTS < <(
    grep -E '^[[:space:]]*(//[[:space:]]*)?#define[[:space:]]+MEMLNAUT_MODE_TYPE[[:space:]]+MEMLNautMode[A-Za-z0-9_]+' "$SKETCH_PATH" \
      | sed -E 's/^[[:space:]]*(\/\/[[:space:]]*)?#define[[:space:]]+MEMLNAUT_MODE_TYPE[[:space:]]+//'
  )

  if [[ ${#FIRMWARE_VARIANTS[@]} -eq 0 ]]; then
    echo "error: could not find any MEMLNaut mode variants in $SKETCH_PATH" >&2
    exit 1
  fi

  ACTIVE_FIRMWARE_VARIANT="$(
    grep -E '^[[:space:]]*#define[[:space:]]+MEMLNAUT_MODE_TYPE[[:space:]]+MEMLNautMode[A-Za-z0-9_]+' "$SKETCH_PATH" \
      | sed -E 's/^[[:space:]]*#define[[:space:]]+MEMLNAUT_MODE_TYPE[[:space:]]+//' \
      | head -n 1
  )"
}

variant_display_name() {
  local variant="$1"
  printf '%s\n' "${variant#MEMLNautMode}"
}

variant_alias() {
  variant_display_name "$1" | tr '[:upper:]' '[:lower:]'
}

resolve_firmware_variant() {
  local requested="$1"
  local requested_lower
  local variant

  requested_lower="$(printf '%s' "$requested" | tr '[:upper:]' '[:lower:]')"
  for variant in "${FIRMWARE_VARIANTS[@]}"; do
    if [[ "$requested" == "$variant" || "$requested_lower" == "$(printf '%s' "$variant" | tr '[:upper:]' '[:lower:]')" || "$requested_lower" == "$(variant_alias "$variant")" ]]; then
      printf '%s\n' "$variant"
      return 0
    fi
  done

  return 1
}

choose_firmware_variant() {
  local requested="${1:-}"
  local resolved=""
  local variant
  local choice
  local tty_fd=""

  load_firmware_variants

  if [[ -n "$requested" ]]; then
    if resolved="$(resolve_firmware_variant "$requested")"; then
      printf '%s\n' "$resolved"
      return 0
    fi

    echo "error: unknown firmware variant: $requested" >&2
    echo "available variants:" >&2
    for variant in "${FIRMWARE_VARIANTS[@]}"; do
      echo "  - $(variant_display_name "$variant") ($variant)" >&2
    done
    exit 1
  fi

  if exec {tty_fd}<>/dev/tty 2>/dev/null; then
    printf 'Select a firmware variant to build:\n' >&"$tty_fd"
    local idx=1
    for variant in "${FIRMWARE_VARIANTS[@]}"; do
      if [[ "$variant" == "$ACTIVE_FIRMWARE_VARIANT" ]]; then
        printf '  %d) %s (%s, current)\n' "$idx" "$(variant_display_name "$variant")" "$variant" >&"$tty_fd"
      else
        printf '  %d) %s (%s)\n' "$idx" "$(variant_display_name "$variant")" "$variant" >&"$tty_fd"
      fi
      idx=$((idx + 1))
    done

    while true; do
      printf 'Variant number or name: ' >&"$tty_fd"
      IFS= read -r -u "$tty_fd" choice
      if [[ "$choice" =~ ^[0-9]+$ ]]; then
        if (( choice >= 1 && choice <= ${#FIRMWARE_VARIANTS[@]} )); then
          exec {tty_fd}>&-
          printf '%s\n' "${FIRMWARE_VARIANTS[choice-1]}"
          return 0
        fi
      elif resolved="$(resolve_firmware_variant "$choice" 2>/dev/null)"; then
        exec {tty_fd}>&-
        printf '%s\n' "$resolved"
        return 0
      fi
      printf 'Invalid selection. Enter a number from the list or a variant name.\n' >&"$tty_fd"
    done
  fi

  if [[ -n "$ACTIVE_FIRMWARE_VARIANT" ]]; then
    echo "No variant specified and no interactive terminal available; using current variant: $(variant_display_name "$ACTIVE_FIRMWARE_VARIANT")" >&2
    printf '%s\n' "$ACTIVE_FIRMWARE_VARIANT"
    return 0
  fi

  echo "error: no variant specified and no active variant found in $SKETCH_PATH" >&2
  exit 1
}

set_firmware_variant() {
  local requested="$1"
  local selected

  selected="$(choose_firmware_variant "$requested")"
  python - "$SKETCH_PATH" "$selected" <<'PY'
from pathlib import Path
import re
import sys

sketch_path = Path(sys.argv[1])
selected = sys.argv[2]

pattern = re.compile(r'^(\s*)(//\s*)?#define(\s+MEMLNAUT_MODE_TYPE\s+)(MEMLNautMode[A-Za-z0-9_]+)(\s*)$')
lines = sketch_path.read_text().splitlines()
updated = []
found_selected = False

for line in lines:
    match = pattern.match(line)
    if not match:
        updated.append(line)
        continue

    indent, _, middle, variant, trailing = match.groups()
    if variant == selected:
        updated.append(f"{indent}#define{middle}{variant}{trailing}")
        found_selected = True
    else:
        updated.append(f"{indent}// #define{middle}{variant}{trailing}")

if not found_selected:
    raise SystemExit(f"selected variant not found in sketch: {selected}")

sketch_path.write_text("\n".join(updated) + "\n")
PY

  ACTIVE_FIRMWARE_VARIANT="$selected"
  echo "Selected firmware variant: $(variant_display_name "$selected") ($selected)"
}
