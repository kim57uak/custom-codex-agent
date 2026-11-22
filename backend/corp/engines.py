"""corp.engines — 엔진 무관 실행 어댑터. subprocess 리스트 인자만(쉘 없음).

왜 이 파일인가: codex·gemini·opencode를 같은 구멍으로 부른다. 출력 스트립
(ANSI 제거)은 사용자 요구의 핵심 — 코딩 에이전트들의 색상·제어문자가 UI·DB를
오염시키지 못하게 한다. opencode 어댑터 신규. 승인 우회 플래그는 절대 안 붙인다.
"""
from __future__ import annotations

import re
import shutil
from dataclasses import dataclass

# 모델 지정 형식 화이트리스트 — 플래그 인젝션(--로 시작 등) 차단
_MODEL_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.\-/]+(?:#[A-Za-z0-9_.-]+)?$")


@dataclass(frozen=True)
class EngineSpec:
    name: str
    exe: str
    argv: tuple[str, ...]      # 프롬프트 전달 직전까지의 고정 인자
    prompt_as_arg: bool        # True면 프롬프트를 argv末尾에, False면 stdin으로
    model_flag: str | None     # 모델 지정 플래그 (없으면 모델 고정 엔진)


def _which(exe: str) -> str | None:
    return shutil.which(exe)


class EngineError(RuntimeError):
    pass


ENGINES: dict[str, EngineSpec] = {
    # codex exec: 비대화형 실행. stdin으로 프롬프트 가능하나 argv가 단순해 stdin 사용.
    "codex": EngineSpec("codex", "codex", ("exec",), prompt_as_arg=False, model_flag=None),
    # gemini: 비대화형. -p/--prompt 플래그 대신 stdin 사용(버전 drift 내성).
    "gemini": EngineSpec("gemini", "gemini", (), prompt_as_arg=False, model_flag=None),
    # opencode run: 비대화형 1회 실행. 메시지는 인자로 전달. --model 지원.
    "opencode": EngineSpec("opencode", "opencode", ("run",), prompt_as_arg=True,
                           model_flag="--model"),
}


def resolve(name: str) -> EngineSpec:
    spec = ENGINES.get(name or "")
    if spec is None:
        raise EngineError(f"unknown engine: {name} (codex|gemini|opencode)")
    if _which(spec.exe) is None:
        raise EngineError(f"engine executable not found on PATH: {spec.exe}")
    return spec


def build_command(spec: EngineSpec, prompt: str,
                  model: str | None = None) -> tuple[list[str], bytes | None]:
    """(argv 리스트, stdin bytes|None). 문자열 합성 없음 — 인젝션 불가 구조.
    model은 model_flag가 있는 엔진(opencode)에만 전달, 형식 provider/model."""
    argv: list[str] = [spec.exe, *spec.argv]
    if model:
        if not spec.model_flag:
            raise EngineError(f"engine {spec.name} does not accept a model override")
        if not _MODEL_RE.match(model):
            raise EngineError(f"bad model format (provider/model): {model!r}"[:80])
        argv += [spec.model_flag, model]
    if spec.prompt_as_arg:
        return [*argv, prompt], None
    return argv, (prompt + "\n").encode("utf-8")


def available() -> dict[str, bool]:
    return {name: _which(spec.exe) is not None for name, spec in ENGINES.items()}


_models_cache: tuple[float, list[str]] = (0.0, [])


def list_models(ttl: float = 300.0) -> list[str]:
    """opencode 모델 목록(TTL 캐시). 실패 시 빈 목록 — UI는 자유 입력으로 대체."""
    import time as _t
    now = _t.time()
    if now - _models_cache[0] < ttl and _models_cache[1]:
        return _models_cache[1]
    out: list[str] = []
    try:
        import subprocess as _sp
        exe = _which("opencode")
        if exe:
            r = _sp.run([exe, "models"], capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                out = [ln.strip() for ln in r.stdout.splitlines()
                       if "/" in ln and not ln.startswith((" ", "-"))]
    except Exception:
        out = []
    if out:
        globals()["_models_cache"] = (now, out)
    return out
