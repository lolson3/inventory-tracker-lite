#!/usr/bin/env sh

set -eu

# Always run from the project directory, including under a scheduler.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed or is not available in PATH." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not installed or is not available in PATH." >&2
  exit 1
fi

if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ] || [ ! -f node_modules/typescript/bin/tsc ]; then
  echo "Installing inventory tracker dependencies..."
  npm ci --include=dev
fi

echo "Building Inventory Tracker Lite..."
npm run build

echo "Starting Inventory Tracker Lite..."
exec npm start
