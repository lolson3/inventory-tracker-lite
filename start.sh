#!/usr/bin/env sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Install Node.js 24.15 or newer within the 24.x release line." >&2
  exit 1
fi
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major !== 24 || minor < 15) { console.error("ERROR: Node.js 24.15+ (24.x) is required."); process.exit(1); }'
if [ ! -f dist/src/server.js ] || [ ! -f dist/client/app.js ]; then
  echo "ERROR: Build the application first: npm ci && npm run build" >&2
  exit 1
fi
exec node dist/src/server.js
