#!/usr/bin/env bash
# Serve the frontend dev server on $PORT. Meant to be run through devrun, which sets PORT:
#
#   devrun up --name web --port-env PORT -- bash frontend/scripts/dev.sh
#
# Binds to 127.0.0.1 by default. Set HOST=0.0.0.0 to reach it from other devices on the LAN.
set -euo pipefail

: "${PORT:?PORT is not set. Run this through: devrun up --name web --port-env PORT -- bash frontend/scripts/dev.sh}"

cd "$(dirname "$0")/.."

# The Angular CLI needs Node >= 24.15 (or 22.22+). If the default node is older, use nvm's newest v24.
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -lt 24 ]; then
  nvm_node="$(ls -d "$HOME"/.nvm/versions/node/v24.* 2>/dev/null | sort -V | tail -n 1)"
  if [ -z "$nvm_node" ]; then
    echo "dev.sh: need Node 24+ (found $(node -v 2>/dev/null || echo none)); run 'nvm install 24'" >&2
    exit 1
  fi
  export PATH="$nvm_node/bin:$PATH"
fi

# Fresh git worktrees have no node_modules.
if [ ! -d node_modules ]; then
  npm ci
fi

exec npx ng serve --port "$PORT" --host "${HOST:-127.0.0.1}"
