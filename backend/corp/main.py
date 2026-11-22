"""corp.main — Genius Corp OS 진입점. 127.0.0.1 기본 바인드.

실행: cd custom-codex-agent && .venv/bin/python -m uvicorn corp.main:app \
         --host 127.0.0.1 --port 8000   (backend/ 디렉터리에서)
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .api import router

app = FastAPI(title="Genius Corp OS", version="2.0.0")
app.include_router(router)


class NoCacheStaticFiles(StaticFiles):
    """로컬 단일 사용자 도구 — 프론트 수정이 즉시 반영되게 캐시 금지."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

STATIC = __import__("pathlib").Path(__file__).resolve().parent / "static"
LEGACY = __import__("pathlib").Path(__file__).resolve().parent.parent / "app" / "static"


@app.get("/", include_in_schema=False)
def index() -> HTMLResponse:
    # 토큰 자동 주입 — 같은 출처 페이지에만 심는다(SOP가 타 출처 읽기를 막아
    # CSRF 방호는 유지). 복사·붙여넣기 마찰 제거. 값은 로그·응답에 노출 안 함.
    from .api import _token as _tok
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html.replace("<!--CORP_TOKEN-->", _tok, 1))


app.mount("/static", NoCacheStaticFiles(directory=str(STATIC)), name="corp-static")
if LEGACY.is_dir():
    # office3d.js/css 단일 원본 재사용 — 구앱 정적 자산을 읽기 전용으로 마운트
    app.mount("/legacy-static", NoCacheStaticFiles(directory=str(LEGACY)), name="legacy")
