#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
APP_DIR="$SCRIPT_DIR"
ENV_FILE="$APP_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

PORT="${1:-${BACKEND_PORT:-8000}}"

if ! command -v lsof >/dev/null 2>&1; then
  echo "[custom-codex-agent] error: lsof not found; cannot detect listener on :$PORT"
  exit 1
fi

pids_raw="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
if [[ -z "$pids_raw" ]]; then
  echo "[custom-codex-agent] no listener on :$PORT"
  exit 0
fi

echo "[custom-codex-agent] stopping listener on :$PORT"
for pid in ${(f)pids_raw}; do
  [[ -n "$pid" ]] || continue
  kill "$pid" 2>/dev/null || true
done

retries=20
while [[ "$retries" -gt 0 ]]; do
  if ! lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[custom-codex-agent] stopped :$PORT"
    exit 0
  fi
  sleep 0.2
  retries=$((retries - 1))
done

echo "[custom-codex-agent] force stopping listener on :$PORT"
pids_raw="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
for pid in ${(f)pids_raw}; do
  [[ -n "$pid" ]] || continue
  kill -9 "$pid" 2>/dev/null || true
done

if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[custom-codex-agent] failed to stop listener on :$PORT"
  exit 1
fi

echo "[custom-codex-agent] stopped :$PORT"
