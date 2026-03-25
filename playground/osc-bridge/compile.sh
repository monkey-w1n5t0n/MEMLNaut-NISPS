#!/usr/bin/env bash
set -euo pipefail

# Compile NISPS OSC Bridge for all platforms
# Requires: deno 2.x
# Outputs go to dist/
#
# Note: macOS cross-compilation from Linux has a known Deno bug.
# macOS binaries must be built on macOS (or via GitHub Actions CI).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST="$SCRIPT_DIR/dist"
SRC="$SCRIPT_DIR/bridge.ts"
NAME="nisps-osc-bridge"

mkdir -p "$DIST"

# Detect host OS for cross-compile compatibility
HOST_OS="$(uname -s)"

TARGETS=(
  "x86_64-unknown-linux-gnu:linux-x86_64"
  "aarch64-unknown-linux-gnu:linux-arm64"
  "x86_64-apple-darwin:macos-x86_64"
  "aarch64-apple-darwin:macos-arm64"
  "x86_64-pc-windows-msvc:windows-x86_64"
)

FAILED=()

for entry in "${TARGETS[@]}"; do
  target="${entry%%:*}"
  suffix="${entry##*:}"

  outname="$NAME-$suffix"
  if [[ "$target" == *windows* ]]; then
    outname="$outname.exe"
  fi

  echo "Compiling $outname ($target)..."
  if deno compile \
    --allow-net \
    --unstable-net \
    --target "$target" \
    --output "$DIST/$outname" \
    "$SRC" 2>&1; then
    echo "  OK"
  else
    echo "  FAILED (skipping — cross-compile to this target may not work on $HOST_OS)"
    FAILED+=("$outname")
  fi
  echo ""
done

echo "Binaries in $DIST/:"
ls -lh "$DIST/" 2>/dev/null || echo "  (none)"

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo ""
  echo "Failed targets: ${FAILED[*]}"
  echo "These may need to be built natively or via CI."
fi
