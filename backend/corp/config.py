"""corp.config — Genius Corp OS 설정 단일 원본.

왜 이 파일인가: 경로·토큰·상한이 핸들러 곳곳에 하드코딩되면(구앱의 병) 보안 감사가
불가능해진다. 모든 한도는 여기서만 정의하고, 환경변수로만 덮어쓴다.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]          # custom-codex-agent/
DATA = BASE / "data" / "corp"
GENIUS_SKILLS = Path(os.environ.get(
    "GENIUS_SKILLS", "/Users/dolpaks/Downloads/project/genius-skills"))
SKILLS_DIR = Path(os.environ.get("SKILL_DIR", str(GENIUS_SKILLS / "skills")))


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


# 작업 공간 화이트리스트 — 실행 cwd는 반드시 이 중 하나 밑이어야 한다.
WORKSPACE_ALLOW = [
    Path(p) for p in os.environ.get(
        "CORP_WORKSPACES", f"{BASE},{GENIUS_SKILLS}").split(",") if p.strip()
]
WORKTREE_ROOT = BASE / "data" / "corp" / "iso"      # 격리실 루트
ENABLE_WORKTREE = os.environ.get("CORP_WORKTREE", "1") == "1"

CONCURRENCY = _int("CORP_CONCURRENCY", 3)           # 동시 실행 상한
RUN_TIMEOUT_S = _int("CORP_TIMEOUT", 1800)
PROMPT_MAX = _int("CORP_PROMPT_MAX", 12000)          # 프롬프트 길이 상한
OUTPUT_MAX = _int("CORP_OUTPUT_MAX", 200000)        # run 출력 저장 상한(문자)
JUDGE_DEFAULT = os.environ.get("CORP_JUDGE", "0") == "1"

# 일일 토큰 예산(추정 토큰, 문자÷4) — 초과 시 새 run 거부
DAILY_TOKEN_BUDGET = _int("CORP_DAILY_BUDGET", 2_000_000)

HOST = os.environ.get("CORP_HOST", "127.0.0.1")     # 외부 바인드 금지 기본
PORT = _int("CORP_PORT", 8000)

TOKEN_FILE = DATA / ".write_token"                  # 0600 저장


def write_token() -> str:
    """쓰기 토큰 — 없으면 생성(0600). GET은 로컬 읽기 전용, POST는 토큰 필수."""
    DATA.mkdir(parents=True, exist_ok=True)
    if TOKEN_FILE.is_file():
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    tok = secrets.token_hex(24)
    TOKEN_FILE.write_text(tok, encoding="utf-8")
    os.chmod(TOKEN_FILE, 0o600)
    return tok
