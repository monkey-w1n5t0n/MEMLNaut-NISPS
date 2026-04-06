#!/usr/bin/env bash
# Run all shapeseq tests using Node's built-in test runner.
# Usage: bash playground/js/shapeseq/tests/run.sh

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

node --test "$DIR"/*.test.js
