#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_NAME="AgentOrchestrator"

echo "=== Killing $PROJECT_NAME processes ==="

# Kill electron-forge / npm run start processes
pkill -f "electron-forge start" 2>/dev/null || true
pkill -f "electron-forge start" 2>/dev/null || true

# Kill Electron processes spawned from this project's node_modules
# (avoids killing Antigravity or other Electron-based apps)
ELECTRON_BIN="$SCRIPT_DIR/node_modules/electron/dist/Electron"
if [ -f "$ELECTRON_BIN" ]; then
  pids=$(pgrep -f "$ELECTRON_BIN" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Killing Electron PIDs: $pids"
    pkill -f "$ELECTRON_BIN" 2>/dev/null || true
  fi
fi

# Kill Electron Helper processes (child processes of our Electron)
pkill -f "node_modules/electron/dist/Electron Helper" 2>/dev/null || true

# Kill Vite dev servers on project ports (5173-5175)
for port in 5173 5174 5175; do
  pid=$(lsof -ti :$port 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "Killing process on port $port (PID: $pid)"
    kill -9 "$pid" 2>/dev/null || true
  fi
done

# Kill any remaining node processes from this project's .vite directory
pkill -f "$SCRIPT_DIR/.vite" 2>/dev/null || true

sleep 1

# Final verification
remaining=$(ps aux | grep "[E]lectron" | grep -v Helper | grep -v Antigravity | grep "$SCRIPT_DIR" || true)
if [ -n "$remaining" ]; then
  echo "WARNING: Some processes still running:"
  echo "$remaining"
else
  echo "=== All $PROJECT_NAME processes stopped ==="
fi