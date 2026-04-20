#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
APP_DIR="$SCRIPT_DIR"
BACKEND_DIR="$APP_DIR/backend"
VENV_DIR="$APP_DIR/.venv"
ACTIVATE_SCRIPT="$VENV_DIR/bin/activate"
ENV_FILE="$APP_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi
if [[ -f "$ACTIVATE_SCRIPT" ]]; then
  # Ensure all subprocesses run with the project's virtualenv.
  source "$ACTIVATE_SCRIPT"
  PYTHON_BIN="python"
else
  echo "[custom-codex-agent] warning: .venv not found, fallback to system python3"
  PYTHON_BIN="$(command -v python3)"
fi
BACKEND_PORT="${BACKEND_PORT:-8000}"
MODE="${1:-prod}"
# 실행 콘솔의 Codex 권한/샌드박스 정책 기본값을 완화 모드로 고정한다.
: "${CUSTOM_CODEX_AGENT_CODEX_CLI_SUBCOMMAND:=exec,--sandbox,danger-full-access}"
export CUSTOM_CODEX_AGENT_CODEX_CLI_SUBCOMMAND

echo "[custom-codex-agent] mode=$MODE"
echo "[custom-codex-agent] codex_cli_subcommand=$CUSTOM_CODEX_AGENT_CODEX_CLI_SUBCOMMAND"

ensure_backend_port_free() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    echo "[custom-codex-agent] warning: lsof not found; skip port pre-cleanup for :$port"
    return
  fi

  local pids_raw
  pids_raw="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [[ -z "$pids_raw" ]]; then
    return
  fi

  echo "[custom-codex-agent] found existing listener on :$port -> terminating"
  local pid
  for pid in ${(f)pids_raw}; do
    [[ -n "$pid" ]] || continue
    kill "$pid" 2>/dev/null || true
  done

  local retries=20
  while [[ "$retries" -gt 0 ]]; do
    if ! lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "[custom-codex-agent] port :$port is free"
      return
    fi
    sleep 0.2
    retries=$((retries - 1))
  done

  echo "[custom-codex-agent] listener still alive on :$port -> force kill"
  pids_raw="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  for pid in ${(f)pids_raw}; do
    [[ -n "$pid" ]] || continue
    kill -9 "$pid" 2>/dev/null || true
  done
}

ensure_backend_port_free "$BACKEND_PORT"

if [[ "$MODE" == "prod" ]]; then
  echo "[custom-codex-agent] starting backend on :$BACKEND_PORT"
  cd "$BACKEND_DIR"
  "$PYTHON_BIN" -m uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT"
elif [[ "$MODE" == "dev" ]]; then
  echo "[custom-codex-agent] starting backend (reload) on :$BACKEND_PORT"
  cd "$BACKEND_DIR"
  "$PYTHON_BIN" -m uvicorn app.main:app --reload --host 127.0.0.1 --port "$BACKEND_PORT"
else
  echo "usage: ./run_all.sh [prod|dev]"
  exit 1
fi
