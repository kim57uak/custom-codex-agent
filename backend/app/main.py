from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import build_api_router
from app.config import SETTINGS
from app.services.config_reader import CodexConfigReader
from app.services.dashboard_service import DashboardService
from app.services.event_stream import EventBroker
from app.services.file_watcher import CodexFileWatcher
from app.services.run_orchestrator import RunOrchestrator
from app.services.run_store import RunStore
from app.services.workflow_orchestrator import WorkflowOrchestrator
from app.services.workflow_store import WorkflowStore


reader = CodexConfigReader(SETTINGS)
service = DashboardService(reader, SETTINGS)
broker = EventBroker()
try:
    run_store = RunStore(SETTINGS.run_db_path)
except sqlite3.OperationalError:
    run_store = RunStore(SETTINGS.fallback_run_db_path)
run_orchestrator = RunOrchestrator(SETTINGS, broker, run_store)
try:
    workflow_store = WorkflowStore(SETTINGS.run_db_path)
except sqlite3.OperationalError:
    workflow_store = WorkflowStore(SETTINGS.fallback_run_db_path)
workflow_orchestrator = WorkflowOrchestrator(SETTINGS, service, broker, run_orchestrator, workflow_store)
watcher: CodexFileWatcher | None = None

app = FastAPI(title="Custom Codex Agent API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(SETTINGS.allowed_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(
    build_api_router(
        service,
        broker,
        run_orchestrator,
        workflow_orchestrator,
        SETTINGS.write_api_token,
        SETTINGS,
    )
)


class NoCacheStaticFiles(StaticFiles):
    """
    Custom StaticFiles implementation that forces the browser to always fetch
    the latest version of static assets. This is critical for local development
    and single-user tools where front-end updates should be immediate without
    manual cache clearing.
    """
    def file_response(self, *args, **kwargs):  # type: ignore[override]
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


static_dir = Path(__file__).resolve().parent / "static"
app.mount("/static", NoCacheStaticFiles(directory=static_dir), name="static")


@app.on_event("startup")
async def startup_event() -> None:
    """
    summary: SSE 브로커와 파일 감시기를 초기화한다.
    purpose/context: 로컬 Codex 설정 변화가 프런트엔드에 자동 반영되게 한다.
    rationale: Codex CLI는 파일 기반 설정을 사용하므로, 외부 편집기에서 파일이 변경될 경우
               서버가 이를 실시간으로 감지하여 UI를 갱신할 수 있도록 워처를 가동한다.
    input: 애플리케이션 startup 생명주기에서 호출된다.
    output: watchdog observer 시작 및 초기 이벤트 발행.
    rules/constraints: 존재하는 Codex 경로만 감시한다.
    failure behavior: watcher 시작 실패 시에도 기본 조회 API는 계속 동작한다.
    """

    global watcher
    loop = asyncio.get_running_loop()
    watcher = CodexFileWatcher(
        loop=loop,
        broker=broker,
        roots=[SETTINGS.codex_home, SETTINGS.gemini_home],
    )
    try:
        watcher.start()
    except Exception:
        watcher = None
    await broker.publish("scan:completed", {"source": "startup"})


@app.on_event("shutdown")
async def shutdown_event() -> None:
    if watcher is not None:
        watcher.stop()


@app.get("/health")
def health() -> dict[str, str]:
    """
    summary: 서버 기본 생존 상태를 확인한다.
    purpose/context: 프런트엔드와 운영자가 API 기동 여부를 점검할 수 있게 한다.
    input: 없음.
    output: 단순 상태 문자열을 반환한다.
    rules/constraints: 민감한 내부 정보는 노출하지 않는다.
    failure behavior: 애플리케이션이 기동하지 못하면 FastAPI 레벨에서 5xx가 발생한다.
    """

    return {"status": "ok"}


@app.get("/", response_model=None)
def index() -> FileResponse | JSONResponse:
    """
    summary: 프런트 정적 빌드가 존재하면 메인 UI를 백엔드에서 직접 서빙한다.
    purpose/context: 개발 서버 없이도 로컬 운영형 실행 경로를 단일화한다.
    input: 없음.
    output: dist/index.html 또는 프런트 빌드 안내 JSON을 반환한다.
    rules/constraints: 정적 빌드가 없더라도 API 기능은 계속 유지한다.
    failure behavior: 빌드 누락 시 404 대신 안내 응답을 반환한다.
    """

    index_file = static_dir / "index.html"
    if index_file.exists():
        response = FileResponse(index_file)
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
    return JSONResponse(
        {
            "status": "frontend-static-missing",
            "message": "backend/app/static/index.html 파일이 없습니다.",
        }
    )
