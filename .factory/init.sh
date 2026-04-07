#!/usr/bin/env bash
# Idempotent environment setup for SolidJS migration
set -e

REPO_ROOT="/home/w1n5t0n/src/MEMLNaut-NISPS-SOLIDJS"
cd "$REPO_ROOT"

# Install root npm dependencies if needed
if [ ! -d "node_modules" ]; then
  npm install
fi

# Ensure Playwright browsers are available
if ! npx playwright install --dry-run chromium 2>/dev/null; then
  npx playwright install chromium 2>/dev/null || true
fi

echo "Environment ready. Vite dev server: npx vite --port 5174"
