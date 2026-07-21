#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# PlatformIO project directory (contains platformio.ini). One [env:<alias>]
# per firmware variant defined there — that file IS the variant registry,
# there is no separate in-source list to keep in sync.
FIRMWARE_PROJECT_DIR="${MEMLNAUT_FIRMWARE_PROJECT_DIR:-$REPO_ROOT/firmware/MEMLNaut-NISPS}"
PLATFORMIO_INI="$FIRMWARE_PROJECT_DIR/platformio.ini"

FIRMWARE_VARIANTS=()
ACTIVE_FIRMWARE_VARIANT=""  # platformio.ini's [platformio] default_envs, if set

ensure_pio() {
  if command -v pio >/dev/null 2>&1; then
    return 0
  fi
  echo "error: pio (PlatformIO Core) is not installed or not on PATH" >&2
  echo "  This machine uses nix. Run commands through:" >&2
  echo "      nix-shell -p platformio-core --run '<command>'" >&2
  echo "  (NOT 'nix-shell -p platformio' — that package wraps the CLI in a" >&2
  echo "  bubblewrap FHS sandbox that needs a real user namespace and fails" >&2
  echo "  under containerised/sandboxed shells. platformio-core is the same" >&2
  echo "  CLI, unwrapped, and works everywhere.)" >&2
  exit 1
}

# Runs `pio` against the firmware project dir without requiring the caller's
# cwd to be there. Always goes through nix-shell so callers don't need pio
# pre-installed on PATH.
run_pio() {
  ensure_pio
  pio "$@" -d "$FIRMWARE_PROJECT_DIR"
}

load_firmware_variants() {
  if [[ ! -f "$PLATFORMIO_INI" ]]; then
    echo "error: platformio.ini not found: $PLATFORMIO_INI" >&2
    exit 1
  fi

  mapfile -t FIRMWARE_VARIANTS < <(
    grep -E '^\[env:[A-Za-z0-9_]+\]' "$PLATFORMIO_INI" | sed -E 's/^\[env:([A-Za-z0-9_]+)\]$/\1/'
  )
  if [[ ${#FIRMWARE_VARIANTS[@]} -eq 0 ]]; then
    echo "error: no [env:<variant>] sections found in $PLATFORMIO_INI" >&2
    exit 1
  fi

  ACTIVE_FIRMWARE_VARIANT="$(
    grep -E '^\s*default_envs\s*=' "$PLATFORMIO_INI" | head -n1 \
      | sed -E 's/^\s*default_envs\s*=\s*//' | tr -d '[:space:]'
  )"
}

resolve_firmware_variant() {
  local requested="$1"
  local requested_lower variant

  requested_lower="$(printf '%s' "$requested" | tr '[:upper:]' '[:lower:]')"
  for variant in "${FIRMWARE_VARIANTS[@]}"; do
    if [[ "$requested_lower" == "$(printf '%s' "$variant" | tr '[:upper:]' '[:lower:]')" ]]; then
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
    echo "available variants (from $PLATFORMIO_INI):" >&2
    for variant in "${FIRMWARE_VARIANTS[@]}"; do
      echo "  - $variant" >&2
    done
    exit 1
  fi

  if exec {tty_fd}<>/dev/tty 2>/dev/null; then
    printf 'Select a firmware variant to build:\n' >&"$tty_fd"
    local idx=1
    for variant in "${FIRMWARE_VARIANTS[@]}"; do
      if [[ "$variant" == "$ACTIVE_FIRMWARE_VARIANT" ]]; then
        printf '  %d) %s (default)\n' "$idx" "$variant" >&"$tty_fd"
      else
        printf '  %d) %s\n' "$idx" "$variant" >&"$tty_fd"
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
    echo "No variant specified and no interactive terminal available; using platformio.ini's default_envs: $ACTIVE_FIRMWARE_VARIANT" >&2
    printf '%s\n' "$ACTIVE_FIRMWARE_VARIANT"
    return 0
  fi

  echo "error: no variant specified, no interactive terminal, and no default_envs set in $PLATFORMIO_INI" >&2
  exit 1
}
