#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
APP_DIR="$SCRIPT_DIR"
BACKEND_DIR="$APP_DIR/backend"
BACKEND_PORT="${BACKEND_PORT:-8000}"
ENV_FILE="$APP_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi
if [[ -x "$APP_DIR/.venv/bin/python" ]]; then
  PYTHON_BIN="$APP_DIR/.venv/bin/python"
else
  PYTHON_BIN="$(command -v python3)"
fi
# 실행 콘솔의 Codex 권한/샌드박스 정책 기본값을 완화 모드로 고정한다.
: "${CUSTOM_CODEX_AGENT_CODEX_CLI_SUBCOMMAND:=exec,--sandbox,danger-full-access}"
export CUSTOM_CODEX_AGENT_CODEX_CLI_SUBCOMMAND

cd "$BACKEND_DIR"
"$PYTHON_BIN" -m uvicorn app.main:app --reload --host 127.0.0.1 --port "$BACKEND_PORT"
