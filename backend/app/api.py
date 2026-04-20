from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.models import (
    AgentInspectorFileModel,
    AgentInspectorResponse,
    DirectoryBrowseResponse,
    DirectoryItemModel,
    DashboardResponse,
    ExecutableAgentModel,
    ExecutableAgentsResponse,
    InventoryResponse,
    OrganizationChartResponse,
    OverviewModel,
    RouterGraphResponse,
    RunCreateRequest,
    RunConfigResponse,
    RunDetailModel,
    RunEventsResponse,
    RunEventModel,
    RunsResponse,
    RunSummaryModel,
)
from app.config import AppSettings
from app.services.dashboard_service import DashboardService
from app.services.event_stream import EventBroker
from app.services.run_orchestrator import RunOrchestrator


def _to_run_status(raw_status: str) -> str:
    allowed = {"queued", "running", "completed", "failed", "canceled"}
    return raw_status if raw_status in allowed else "failed"


def build_api_router(
    service: DashboardService,
    broker: EventBroker,
    run_orchestrator: RunOrchestrator,
    write_api_token: str,
    settings: AppSettings,
) -> APIRouter:
    """
    summary: 프런트엔드가 사용하는 읽기 전용 API 라우터를 생성한다.
    purpose/context: UI가 조직도와 대시보드 데이터를 안정된 계약으로 호출할 수 있게 한다.
    input: 대시보드 조회용 서비스와 실행 오케스트레이터를 받는다.
    output: FastAPI에 연결 가능한 APIRouter 인스턴스를 반환한다.
    rules/constraints: 쓰기 API는 X-API-Token 인증을 반드시 통과해야 한다.
    failure behavior: 실행 요청 검증 실패 시 4xx, 내부 실행 실패 시 run 상태 failed로 반환한다.
    """

    router = APIRouter(prefix="/api")

    def verify_write_token(x_api_token: str | None = Header(default=None, alias="X-API-Token")) -> None:
        if x_api_token != write_api_token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid write api token")

    @router.get("/overview", response_model=OverviewModel)
    def get_overview() -> OverviewModel:
        return service.build_overview()

    @router.get("/graph/router", response_model=RouterGraphResponse)
    def get_router_graph() -> RouterGraphResponse:
        return service.build_router_graph()

    @router.get("/graph/org", response_model=OrganizationChartResponse)
    def get_org_chart() -> OrganizationChartResponse:
        return service.build_org_chart()

    @router.get("/dashboard", response_model=DashboardResponse)
    def get_dashboard() -> DashboardResponse:
        return service.build_dashboard()

    @router.get("/inventory", response_model=InventoryResponse)
    def get_inventory() -> InventoryResponse:
        return service.build_inventory()

    @router.get("/agents/executable", response_model=ExecutableAgentsResponse)
    def get_executable_agents() -> ExecutableAgentsResponse:
        inventory = service.build_inventory()
        agents = [
            ExecutableAgentModel(
                name=agent.name,
                role_label_ko=agent.role_label_ko,
                department_label_ko=agent.department_label_ko,
                runnable=agent.status != "broken",
                reason=agent.reason,
                short_description=agent.short_description,
                one_click_prompt=agent.one_click_prompt,
            )
            for agent in inventory.agents
        ]
        agents.sort(key=lambda item: (0 if item.runnable else 1, item.department_label_ko, item.role_label_ko))
        return ExecutableAgentsResponse(agents=agents)

    def _safe_read_text(path: Path, max_chars: int = 160000) -> tuple[str, bool]:
        text = path.read_text(encoding="utf-8", errors="replace")
        if len(text) <= max_chars:
            return text, False
        return text[:max_chars], True

    def _is_within_codex_home(path: Path) -> bool:
        try:
            path.resolve().relative_to(settings.codex_home.resolve())
            return True
        except ValueError:
            return False

    def _to_file_model(path: Path, kind: str) -> AgentInspectorFileModel:
        content, truncated = _safe_read_text(path)
        mtime = None
        try:
            mtime = datetime.fromtimestamp(path.stat().st_mtime)
        except OSError:
            mtime = None
        return AgentInspectorFileModel(
            name=path.name,
            path=str(path),
            kind=kind,
            size_bytes=path.stat().st_size if path.exists() else 0,
            modified_at=mtime,
            content=content,
            truncated=truncated,
        )

    @router.get("/agents/{agent_name}/inspector", response_model=AgentInspectorResponse)
    def get_agent_inspector(agent_name: str) -> AgentInspectorResponse:
        inventory = service.build_inventory()
        target = next((agent for agent in inventory.agents if agent.name == agent_name), None)
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")

        agent_dir = settings.agents_root / agent_name
        agent_toml_path = agent_dir / "agent.toml"
        agent_json_path = agent_dir / "config.json"
        skill_path = Path(target.skill_path).expanduser() if target.skill_path else None
        skill_dir = skill_path.parent if skill_path else None

        skill_markdown = None
        if skill_path and skill_path.exists() and skill_path.is_file() and _is_within_codex_home(skill_path):
            skill_markdown = _to_file_model(skill_path, "skill-md")

        agent_toml = None
        if agent_toml_path.exists() and agent_toml_path.is_file() and _is_within_codex_home(agent_toml_path):
            agent_toml = _to_file_model(agent_toml_path, "agent-toml")

        agent_json = None
        if agent_json_path.exists() and agent_json_path.is_file() and _is_within_codex_home(agent_json_path):
            agent_json = _to_file_model(agent_json_path, "agent-json")

        references: list[AgentInspectorFileModel] = []
        scripts: list[AgentInspectorFileModel] = []
        if skill_dir and skill_dir.exists() and _is_within_codex_home(skill_dir):
            refs_dir = skill_dir / "references"
            if refs_dir.exists() and refs_dir.is_dir():
                for file_path in sorted(refs_dir.rglob("*")):
                    if file_path.is_file():
                        references.append(_to_file_model(file_path, "reference"))
            scripts_dir = skill_dir / "scripts"
            if scripts_dir.exists() and scripts_dir.is_dir():
                for file_path in sorted(scripts_dir.rglob("*")):
                    if file_path.is_file():
                        scripts.append(_to_file_model(file_path, "script"))

        return AgentInspectorResponse(
            agent_name=target.name,
            role_label_ko=target.role_label_ko,
            department_label_ko=target.department_label_ko,
            description=target.description,
            short_description=target.short_description,
            one_click_prompt=target.one_click_prompt,
            skill_name=target.skill_name,
            skill_path=target.skill_path,
            agent_toml_path=str(agent_toml_path) if agent_toml_path.exists() else None,
            agent_json_path=str(agent_json_path) if agent_json_path.exists() else None,
            skill_markdown=skill_markdown,
            agent_toml=agent_toml,
            agent_json=agent_json,
            references=references,
            scripts=scripts,
        )

    @router.get("/run-config", response_model=RunConfigResponse)
    def get_run_config() -> RunConfigResponse:
        return RunConfigResponse(default_workspace_root=str(run_orchestrator.default_workspace_root))

    @router.get("/fs/directories", response_model=DirectoryBrowseResponse)
    def list_directories(path: str | None = Query(default=None)) -> DirectoryBrowseResponse:
        target_path = (path or "").strip()
        base = run_orchestrator.default_workspace_root
        candidate = Path(target_path).expanduser() if target_path else base
        if not candidate.is_absolute():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="path must be an absolute path")
        try:
            resolved = candidate.resolve(strict=True)
        except (OSError, RuntimeError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="path is not accessible")
        if not resolved.is_dir():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="path must be a directory")

        try:
            items = sorted((entry for entry in resolved.iterdir() if entry.is_dir()), key=lambda item: item.name.lower())
        except OSError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="failed to read directory")

        directories = [DirectoryItemModel(name=item.name, path=str(item)) for item in items[:500]]
        parent_path = str(resolved.parent) if resolved.parent != resolved else None
        return DirectoryBrowseResponse(current_path=str(resolved), parent_path=parent_path, directories=directories)

    @router.post("/scan")
    async def trigger_scan(x_api_token: str | None = Header(default=None, alias="X-API-Token")) -> dict[str, str]:
        verify_write_token(x_api_token)
        await broker.publish("scan:completed", {"source": "manual"})
        await broker.publish("dashboard:updated", {"source": "manual"})
        return {"status": "ok"}

    @router.post("/activity/refresh")
    async def refresh_activity(x_api_token: str | None = Header(default=None, alias="X-API-Token")) -> dict[str, str]:
        verify_write_token(x_api_token)
        await broker.publish("activity:updated", {"source": "manual"})
        await broker.publish("dashboard:updated", {"source": "manual"})
        return {"status": "ok"}

    @router.get("/runs", response_model=RunsResponse)
    def list_runs(limit: int = Query(default=30, ge=1, le=200)) -> RunsResponse:
        runs = run_orchestrator.list_runs(limit=limit)
        return RunsResponse(
            runs=[
                RunSummaryModel(
                    run_id=run.run_id,
                    agent_name=run.agent_name,
                    workspace_root=run.workspace_root,
                    status=_to_run_status(run.status),
                    prompt_preview=run_orchestrator.to_prompt_preview(run.prompt),
                    created_at=run.created_at,
                    started_at=run.started_at,
                    completed_at=run.completed_at,
                    exit_code=run.exit_code,
                    error_message=run.error_message,
                )
                for run in runs
            ]
        )

    @router.get("/runs/{run_id}", response_model=RunDetailModel)
    def get_run(run_id: str) -> RunDetailModel:
        run = run_orchestrator.get_run(run_id)
        if run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        return RunDetailModel(
            run_id=run.run_id,
            agent_name=run.agent_name,
            workspace_root=run.workspace_root,
            prompt=run.prompt,
            status=_to_run_status(run.status),
            created_at=run.created_at,
            started_at=run.started_at,
            completed_at=run.completed_at,
            exit_code=run.exit_code,
            error_message=run.error_message,
        )

    @router.get("/runs/{run_id}/events", response_model=RunEventsResponse)
    def get_run_events(run_id: str, limit: int = Query(default=300, ge=1, le=2000)) -> RunEventsResponse:
        run = run_orchestrator.get_run(run_id)
        if run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        events = run_orchestrator.list_run_events(run_id=run_id, limit=limit)
        return RunEventsResponse(
            events=[
                RunEventModel(
                    event_id=event.event_id,
                    run_id=event.run_id,
                    event_type=event.event_type,
                    message=event.message,
                    created_at=event.created_at,
                )
                for event in events
            ]
        )

    @router.post("/runs", response_model=RunDetailModel)
    async def create_run(
        request: RunCreateRequest,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> RunDetailModel:
        verify_write_token(x_api_token)
        try:
            prompt = run_orchestrator.validate_prompt(request.prompt)
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        try:
            workspace_root = run_orchestrator.validate_workspace_root(request.workspace_root)
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        try:
            sandbox_mode = run_orchestrator.validate_sandbox_mode(request.sandbox_mode)
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        try:
            approval_policy = run_orchestrator.validate_approval_policy(request.approval_policy)
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        inventory = service.build_inventory()
        agent_map = {agent.name: agent for agent in inventory.agents}
        target_agent = agent_map.get(request.agent_name)
        if target_agent is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
        if target_agent.status == "broken":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="broken agent cannot be executed")

        created = await run_orchestrator.create_run(
            agent_name=request.agent_name,
            prompt=prompt,
            workspace_root=workspace_root,
            sandbox_mode=sandbox_mode,
            approval_policy=approval_policy,
        )
        record = created.record
        return RunDetailModel(
            run_id=record.run_id,
            agent_name=record.agent_name,
            workspace_root=record.workspace_root,
            prompt=record.prompt,
            status=_to_run_status(record.status),
            created_at=record.created_at,
            started_at=record.started_at,
            completed_at=record.completed_at,
            exit_code=record.exit_code,
            error_message=record.error_message,
        )

    @router.post("/runs/{run_id}/cancel", response_model=RunDetailModel)
    async def cancel_run(
        run_id: str,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> RunDetailModel:
        verify_write_token(x_api_token)
        updated = await run_orchestrator.cancel_run(run_id)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        return RunDetailModel(
            run_id=updated.run_id,
            agent_name=updated.agent_name,
            workspace_root=updated.workspace_root,
            prompt=updated.prompt,
            status=_to_run_status(updated.status),
            created_at=updated.created_at,
            started_at=updated.started_at,
            completed_at=updated.completed_at,
            exit_code=updated.exit_code,
            error_message=updated.error_message,
        )

    @router.post("/runs/{run_id}/retry", response_model=RunDetailModel)
    async def retry_run(
        run_id: str,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> RunDetailModel:
        verify_write_token(x_api_token)
        retried = await run_orchestrator.retry_run(run_id)
        if retried is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        record = retried.record
        return RunDetailModel(
            run_id=record.run_id,
            agent_name=record.agent_name,
            workspace_root=record.workspace_root,
            prompt=record.prompt,
            status=_to_run_status(record.status),
            created_at=record.created_at,
            started_at=record.started_at,
            completed_at=record.completed_at,
            exit_code=record.exit_code,
            error_message=record.error_message,
        )

    @router.get("/events")
    async def stream_events() -> StreamingResponse:
        queue = broker.subscribe()

        async def event_generator():
            try:
                while True:
                    try:
                        message = await asyncio.wait_for(queue.get(), timeout=15)
                        yield message.to_sse_chunk()
                    except asyncio.TimeoutError:
                        yield "data: {\"type\":\"heartbeat\",\"payload\":{},\"createdAt\":null}\n\n"
            finally:
                broker.unsubscribe(queue)

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    return router
