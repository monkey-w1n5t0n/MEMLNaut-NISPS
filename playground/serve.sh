#!/usr/bin/env bash
# Serve the NISPS playground with COOP/COEP headers (required for SharedArrayBuffer/synth mode).

PORT="${1:-8000}"
MAX_ATTEMPTS=20
DIR="$(cd "$(dirname "$0")" && pwd)"

for ((i = 0; i < MAX_ATTEMPTS; i++)); do
  candidate=$((PORT + i))
  if ! ss -tlnp 2>/dev/null | grep -q ":${candidate} "; then
    echo "Serving playground at http://localhost:${candidate} (COOP/COEP enabled)"
    exec python3 "$DIR/serve-coop.py" "$candidate"
  fi
  echo "Port ${candidate} in use, trying next..."
done

echo "No open port found in range ${PORT}–$((PORT + MAX_ATTEMPTS - 1))" >&2
exit 1
