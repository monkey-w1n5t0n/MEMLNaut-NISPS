#!/usr/bin/env bash
# Serve the NISPS playground, finding an open port if needed.

PORT="${1:-8000}"
MAX_ATTEMPTS=20
DIR="$(cd "$(dirname "$0")" && pwd)"

for ((i = 0; i < MAX_ATTEMPTS; i++)); do
  candidate=$((PORT + i))
  if ! ss -tlnp 2>/dev/null | grep -q ":${candidate} "; then
    echo "Serving playground at http://localhost:${candidate}"
    exec python3 -m http.server "$candidate" -d "$DIR"
  fi
  echo "Port ${candidate} in use, trying next..."
done

echo "No open port found in range ${PORT}–$((PORT + MAX_ATTEMPTS - 1))" >&2
exit 1
