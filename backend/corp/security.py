"""corp.security — 실행 보안 게이트. 규칙: shell 금지·원문 비밀 비저장·jail 강제.

왜 이 파일인가: 코딩 실행 서버의 위협은 셋이다. ① 셸 인젝션 ② 작업공간 탈출
③ 비밀 유출. 셋 다 여기서 막는다. subprocess는 리스트 인자만(쉘 없음),
cwd는 화이트리스트 jail, 출력은 ANSI·제어문자 스트립 후 상한 절단.
API 키는 주입하지 않는다 — 각 엔진이 자기 로그인을 쓴다(opencode/codex/gemini).
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from . import config

_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB0]")
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# 비밀 의심 패턴 — 프롬프트·출력에 있으면 저장·중계 거부(값은 절대 출력 안 함)
_SECRET_RES = [
    re.compile(r"(?i)(api[_-]?key|secret|passwd|password|token)\s*[:=]\s*\S{6,}"),
    re.compile(r"sk-(live|test)-[A-Za-z0-9]{8,}"),
    re.compile(r"xox[bap]-[A-Za-z0-9-]{8,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
]


def strip_output(text: str, limit: int | None = None) -> str:
    """ANSI·제어문자 제거 + 상한 절단. UI·DB에 들어가는 모든 출력은 이것을 거친다."""
    clean = _CTRL_RE.sub("", _ANSI_RE.sub("", text or ""))
    cap = config.OUTPUT_MAX if limit is None else limit
    if len(clean) > cap:
        clean = clean[:cap] + f"\n…(truncated {len(clean) - cap} chars)"
    return clean


def looks_secret(text: str) -> bool:
    return any(rx.search(text or "") for rx in _SECRET_RES)


def check_prompt(prompt: str) -> str:
    """프롬프트 정제. 위반 시 ValueError(이유만, 값 비포함)."""
    p = (prompt or "").strip()
    if not p:
        raise ValueError("prompt must not be empty")
    if len(p) > config.PROMPT_MAX:
        raise ValueError(f"prompt length exceeds max: {config.PROMPT_MAX}")
    if looks_secret(p):
        raise ValueError("prompt appears to contain a credential — remove it")
    return p


def jail(cwd: str | None) -> Path:
    """작업 공간 감옥. 화이트리스트 밖이면 PermissionError."""
    target = Path(cwd or "").expanduser() if cwd else config.WORKSPACE_ALLOW[0]
    real = target.resolve()
    for base in config.WORKSPACE_ALLOW:
        try:
            real.relative_to(base.resolve())
            return real
        except ValueError:
            continue
    raise PermissionError(f"workspace outside allowlist: {real}")


def child_env() -> dict:
    """자식 프로세스 환경 — 최소 상속. API 키·시크릿은 물려주지 않는다."""
    keep = ("PATH", "HOME", "USER", "LANG", "LC_ALL", "TZ")
    env = {k: v for k, v in os.environ.items() if k in keep}
    env["TERM"] = "dumb"          # ANSI 색상 출력 억제 1차
    env["NO_COLOR"] = "1"
    env["PATH"] = ":".join(["/opt/homebrew/bin", "/usr/local/bin",
                            str(Path.home() / ".local" / "bin"),
                            env.get("PATH", "")])
    return env


def estimate_tokens(text: str) -> int:
    return max(1, len(text or "") // 4)
