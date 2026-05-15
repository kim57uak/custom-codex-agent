#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_NAME="AgentOrchestrator"

echo "=== Killing stale $PROJECT_NAME processes before start ==="

# Kill electron-forge / npm run start processes from this project
pkill -f "electron-forge start" 2>/dev/null || true
pkill -f "electron-forge start" 2>/dev/null || true

# Kill Electron processes spawned from this project's node_modules
# (avoids killing Antigravity or other Electron-based apps)
ELECTRON_BIN="$SCRIPT_DIR/node_modules/electron/dist/Electron"
if [ -f "$ELECTRON_BIN" ]; then
  pkill -f "$ELECTRON_BIN" 2>/dev/null || true
fi

# Kill Vite dev servers on project ports (5173-5175)
for port in 5173 5174 5175; do
  pid=$(lsof -ti :$port 2>/dev/null || true)
  if [ -n "$pid" ]; then
    kill -9 "$pid" 2>/dev/null || true
  fi
done

sleep 1
echo "=== Starting $PROJECT_NAME ==="
cd "$SCRIPT_DIR"
npm run start