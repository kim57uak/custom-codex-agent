from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import APIRouter, Body, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.config import SETTINGS
from app.models import (
    AgentInspectorFileModel,
    AgentInspectorFileSaveRequest,
    AgentInspectorFileSaveResponse,
    AgentInspectorResponse,
    DashboardResponse,
    DirectoryBrowseResponse,
    DirectoryItemModel,
    ExecutableAgentModel,
    ExecutableAgentsResponse,
    InventoryResponse,
    OrganizationChartResponse,
    OverviewModel,
    RouterGraphResponse,
    RunConfigResponse,
    RunCreateRequest,
    RunDetailModel,
    RunEventModel,
    RunEventsResponse,
    RunsResponse,
    RunSummaryModel,
    SkillAgentBackupResponse,
    SkillAgentRestoreResponse,
    UiOptionModel,
    WorkflowAgentIconModel,
    WorkflowEventModel,
    WorkflowEventsResponse,
    WorkflowRecommendRequest,
    WorkflowRecommendResponse,
    WorkflowRunCreateRequest,
    WorkflowRunDetailModel,
    WorkflowRunsResponse,
    WorkflowRunSummaryModel,
    WorkflowStepActionRequest,
    WorkflowStepRunModel,
    WorkflowUiConfigResponse,
)
from app.services.workflow_catalog import (
    WORKFLOW_APPROVAL_OPTIONS,
    WORKFLOW_ICON_RULES,
    WORKFLOW_SANDBOX_OPTIONS,
    WORKFLOW_STEP_STATUS_OPTIONS,
)

if TYPE_CHECKING:
    from app.config import AppSettings
    from app.services.dashboard_service import DashboardService
    from app.services.event_stream import EventBroker
    from app.services.run_orchestrator import RunOrchestrator
    from app.services.workflow_orchestrator import WorkflowOrchestrator
    from app.services.skill_agent_backup_service import SkillAgentBackupService
    from app.services.inspector_service import AgentInspectorService


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ApiContext:
    """
    Context object passed to route registration functions to provide access
    to shared services, configuration, and state. Using a context object
    simplifies dependency injection for FastAPI routes.
    """
    router: APIRouter
    service: DashboardService
    broker: EventBroker
    run_orchestrator: RunOrchestrator
    workflow_orchestrator: WorkflowOrchestrator
    write_api_token: str | None
    settings: AppSettings
    backup_service: SkillAgentBackupService
    inspector_service: AgentInspectorService


def _to_run_status(raw_status: str) -> str:
    allowed = {"queued", "running", "completed", "failed", "canceled"}
    return raw_status if raw_status in allowed else "failed"


def _verify_write_token(write_api_token: str | None, x_api_token: str | None) -> None:
    """
    Verifies if the provided API token matches the expected write token.
    This ensures that state-modifying endpoints (POST/PUT/DELETE) are protected
    from unauthorized access.
    """
    if not write_api_token:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="write api disabled")
    if x_api_token != write_api_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid write api token")


def _find_agent_or_404(ctx: ApiContext, agent_name: str, engine: str | None = None):
    # 엔진 선택에 따라 에이전트 목록이 달라질 수 있으므로 engine 파라미터를 명시적으로 전달함
    inventory = ctx.service.build_inventory(engine=engine)
    target = next((agent for agent in inventory.agents if agent.name == agent_name), None)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    return target


def _to_run_detail_model(record) -> RunDetailModel:
    return RunDetailModel(
        run_id=record.run_id,
        agent_name=record.agent_name,
        workspace_root=record.workspace_root,
        prompt=record.prompt,
        status=_to_run_status(record.status),
        engine=record.engine,
        created_at=record.created_at,
        started_at=record.started_at,
        completed_at=record.completed_at,
        exit_code=record.exit_code,
        error_message=record.error_message,
    )


def _get_workflow_run_detail_or_404(ctx: ApiContext, workflow_run_id: str) -> WorkflowRunDetailModel:
    run = ctx.workflow_orchestrator.get_workflow_run(workflow_run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
    steps = ctx.workflow_orchestrator.list_workflow_steps(workflow_run_id)
    return WorkflowRunDetailModel(
        workflow_run_id=run.workflow_run_id,
        goal_prompt=run.goal_prompt,
        workspace_root=run.workspace_root,
        sandbox_mode=run.sandbox_mode,
        approval_policy=run.approval_policy,
        status=run.status,
        current_step_index=run.current_step_index,
        total_steps=run.total_steps,
        steps=[
            WorkflowStepRunModel(
                step_index=step.step_index,
                agent_name=step.agent_name,
                skill_name=step.skill_name,
                icon_key=step.icon_key,
                title=step.title,
                prompt=step.prompt,
                status=step.status,
                run_id=step.run_id,
                reason=step.reason,
                summary=step.summary,
                last_event_message=step.last_event_message,
                started_at=step.started_at,
                completed_at=step.completed_at,
                exit_code=step.exit_code,
                error_message=step.error_message,
            )
            for step in steps
        ],
        created_at=run.created_at,
        started_at=run.started_at,
        completed_at=run.completed_at,
        error_message=run.error_message,
    )


def register_read_routes(ctx: ApiContext) -> None:
    @ctx.router.get("/overview", response_model=OverviewModel)
    def get_overview(engine: str | None = Query(default=None)) -> OverviewModel:
        # 선택된 엔진에 맞는 개요 데이터를 로드하도록 파라미터 추가
        return ctx.service.build_overview(engine=engine)

    @ctx.router.get("/graph/router", response_model=RouterGraphResponse)
    def get_router_graph(engine: str | None = Query(default=None)) -> RouterGraphResponse:
        # 엔진별 라우터 구성이 다를 수 있으므로 engine 파라미터 반영
        return ctx.service.build_router_graph(engine=engine)

    @ctx.router.get("/graph/org", response_model=OrganizationChartResponse)
    def get_org_chart(engine: str | None = Query(default=None)) -> OrganizationChartResponse:
        # 엔진별 에이전트 소속이 다를 수 있으므로 실시간 조직도 생성 시 engine 파라미터 사용
        return ctx.service.build_org_chart(engine=engine)

    @ctx.router.get("/dashboard", response_model=DashboardResponse)
    def get_dashboard(engine: str | None = Query(default=None)) -> DashboardResponse:
        return ctx.service.build_dashboard(engine=engine)

    @ctx.router.get("/inventory", response_model=InventoryResponse)
    def get_inventory(engine: str | None = Query(default=None)) -> InventoryResponse:
        # 인벤토리 조회 시에도 엔진 파라미터를 넘겨서 Gemini/Codex 전용 목록을 가져옴
        return ctx.service.build_inventory(engine=engine)

    @ctx.router.get("/agents/executable", response_model=ExecutableAgentsResponse)
    def get_executable_agents(engine: str | None = Query(default=None)) -> ExecutableAgentsResponse:
        inventory = ctx.service.build_inventory(engine=engine)
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


def register_inspector_routes(ctx: ApiContext) -> None:
    @ctx.router.get("/agents/{agent_name}/inspector", response_model=AgentInspectorResponse)
    def get_agent_inspector(agent_name: str, engine: str | None = Query(default=None)) -> AgentInspectorResponse:
        # 에이전트 인스펙터 진입 시에도 선택된 엔진의 홈 디렉토리에서 파일을 찾도록 engine 파라미터 추가
        target = _find_agent_or_404(ctx, agent_name, engine=engine)
        return ctx.inspector_service.build_inspector_response(target, engine=engine)

    @ctx.router.post("/agents/{agent_name}/inspector/files", response_model=AgentInspectorFileSaveResponse)
    def save_agent_inspector_file(
        agent_name: str,
        payload: AgentInspectorFileSaveRequest,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> AgentInspectorFileSaveResponse:
        _verify_write_token(ctx.write_api_token, x_api_token)
        if len(payload.content) > ctx.settings.safe_read_text_max_chars * 10:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="file content is too large")

        engine = payload.engine if hasattr(payload, "engine") else None
        
        # JSON 유효성 검사 (설정 파일인 경우)
        if payload.path.lower().endswith(".json"):
            try:
                json.loads(payload.content)
            except json.JSONDecodeError as err:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid json: {err.msg}") from err

        try:
            saved_path = ctx.inspector_service.save_file(
                agent_name=agent_name,
                file_path_str=payload.path,
                content=payload.content,
                engine=engine
            )
            # 성공 시 갱신된 파일 정보를 반환하기 위해 서비스 헬퍼 사용
            # kind는 저장 시점에 정확히 알기 어려우므로 general하게 처리하거나 서비스에서 반환받아야 함
            # 여기서는 간단히 저장된 경로만 반환하거나 서비스에서 모델을 생성하도록 유도
            return AgentInspectorFileSaveResponse(
                status="ok", 
                file=ctx.inspector_service.build_file_model(saved_path, kind="updated")
            )
        except (PermissionError, FileNotFoundError) as e:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"save failed: {e}")


def register_config_routes(ctx: ApiContext) -> None:
    @ctx.router.get("/run-config", response_model=RunConfigResponse)
    def get_run_config() -> RunConfigResponse:
        return RunConfigResponse(
            default_workspace_root=str(ctx.run_orchestrator.default_workspace_root),
            write_api_enabled=bool(ctx.write_api_token),
            default_write_api_token=ctx.write_api_token,
            available_engines=["gemini", "codex"],
            default_engine=ctx.settings.default_engine,
        )

    @ctx.router.get("/workflows/ui-config", response_model=WorkflowUiConfigResponse)
    def get_workflow_ui_config() -> WorkflowUiConfigResponse:
        return WorkflowUiConfigResponse(
            sandbox_modes=[UiOptionModel(value=value, label=label) for value, label in WORKFLOW_SANDBOX_OPTIONS],
            approval_policies=[UiOptionModel(value=value, label=label) for value, label in WORKFLOW_APPROVAL_OPTIONS],
            workflow_step_statuses=[
                UiOptionModel(value=value, label=label) for value, label in WORKFLOW_STEP_STATUS_OPTIONS
            ],
            agent_icons=[
                WorkflowAgentIconModel(key=rule.key, label=rule.label, keywords=list(rule.keywords))
                for rule in WORKFLOW_ICON_RULES
            ],
            recommendation_max_agents=ctx.settings.workflow_recommendation_max_agents,
        )

    @ctx.router.get("/fs/directories", response_model=DirectoryBrowseResponse)
    def list_directories(path: str | None = Query(default=None)) -> DirectoryBrowseResponse:
        target_path = (path or "").strip()
        base = ctx.run_orchestrator.default_workspace_root
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

        directories = [DirectoryItemModel(name=item.name, path=str(item)) for item in items[:ctx.settings.directory_list_limit]]
        parent_path = str(resolved.parent) if resolved.parent != resolved else None
        return DirectoryBrowseResponse(current_path=str(resolved), parent_path=parent_path, directories=directories)


def register_maintenance_routes(ctx: ApiContext) -> None:
    @ctx.router.post("/scan")
    async def trigger_scan(x_api_token: str | None = Header(default=None, alias="X-API-Token")) -> dict[str, str]:
        _verify_write_token(ctx.write_api_token, x_api_token)
        await ctx.broker.publish("scan:completed", {"source": "manual"})
        await ctx.broker.publish("dashboard:updated", {"source": "manual"})
        return {"status": "ok"}

    @ctx.router.post("/activity/refresh")
    async def refresh_activity(x_api_token: str | None = Header(default=None, alias="X-API-Token")) -> dict[str, str]:
        _verify_write_token(ctx.write_api_token, x_api_token)
        await ctx.broker.publish("activity:updated", {"source": "manual"})
        await ctx.broker.publish("dashboard:updated", {"source": "manual"})
        return {"status": "ok"}

    @ctx.router.post("/backups/skills-agents", response_model=SkillAgentBackupResponse)
    async def backup_skills_agents(
        engine: str | None = Query(default=None),
        purge_after_backup: bool = Query(default=False),
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> SkillAgentBackupResponse:
        _verify_write_token(ctx.write_api_token, x_api_token)
        try:
            backup_result = ctx.backup_service.backup(engine=engine, purge_after_backup=purge_after_backup)
        except FileNotFoundError as err:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err
        except OSError as err:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"backup failed: {err}") from err

        return SkillAgentBackupResponse(
            backup_path=str(backup_result.archive_path),
            backup_file_name=backup_result.archive_path.name,
            included_roots=backup_result.included_roots,
            deleted_entry_count=backup_result.deleted_entry_count,
            created_at=backup_result.created_at,
            size_bytes=backup_result.size_bytes,
        )

    @ctx.router.post("/backups/skills-agents/restore", response_model=SkillAgentRestoreResponse)
    async def restore_skills_agents(
        engine: str | None = Query(default=None),
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> SkillAgentRestoreResponse:
        _verify_write_token(ctx.write_api_token, x_api_token)
        try:
            restore_result = ctx.backup_service.restore_latest(engine=engine)
        except (FileNotFoundError, ValueError) as err:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err
        except OSError as err:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"restore failed: {err}") from err

        return SkillAgentRestoreResponse(
            restored_from_path=str(restore_result.archive_path),
            restored_roots=restore_result.restored_roots,
            restored_member_count=restore_result.restored_member_count,
            deleted_entry_count_before_restore=restore_result.deleted_entry_count,
            restored_at=restore_result.restored_at,
        )


def register_run_routes(ctx: ApiContext) -> None:
    @ctx.router.get("/runs", response_model=RunsResponse)
    def list_runs(
        limit: int = Query(default=ctx.settings.run_list_limit_default, ge=1, le=ctx.settings.run_list_limit_max),
        engine: str | None = Query(default=None),
    ) -> RunsResponse:
        # 콘솔 탭에서 현재 엔진에 해당하는 실행 이력만 볼 수 있도록 engine 파라미터 추가
        runs = ctx.run_orchestrator.list_runs(limit=limit, engine=engine)
        return RunsResponse(
            runs=[
                RunSummaryModel(
                    run_id=run.run_id,
                    agent_name=run.agent_name,
                    workspace_root=run.workspace_root,
                    status=_to_run_status(run.status),
                    prompt_preview=ctx.run_orchestrator.to_prompt_preview(run.prompt),
                    engine=run.engine,
                    created_at=run.created_at,
                    started_at=run.started_at,
                    completed_at=run.completed_at,
                    exit_code=run.exit_code,
                    error_message=run.error_message,
                )
                for run in runs
            ]
        )

    @ctx.router.get("/runs/{run_id}", response_model=RunDetailModel)
    def get_run(run_id: str) -> RunDetailModel:
        run = ctx.run_orchestrator.get_run(run_id)
        if run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        return _to_run_detail_model(run)


    @ctx.router.get("/runs/{run_id}/events", response_model=RunEventsResponse)
    def get_run_events(
        run_id: str,
        limit: int = Query(default=ctx.settings.run_event_list_limit_default, ge=1, le=ctx.settings.run_event_list_limit_max)
    ) -> RunEventsResponse:
        run = ctx.run_orchestrator.get_run(run_id)
        if run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        events = ctx.run_orchestrator.list_run_events(run_id=run_id, limit=limit)
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

    @ctx.router.post("/runs", response_model=RunDetailModel)
    async def create_run(
        request: RunCreateRequest,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> RunDetailModel:
        _verify_write_token(ctx.write_api_token, x_api_token)
        try:
            prompt = ctx.run_orchestrator.validate_prompt(request.prompt)
            workspace_root = ctx.run_orchestrator.validate_workspace_root(request.workspace_root)
            sandbox_mode = ctx.run_orchestrator.validate_sandbox_mode(request.sandbox_mode)
            approval_policy = ctx.run_orchestrator.validate_approval_policy(request.approval_policy)
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err

        inventory = ctx.service.build_inventory()
        agent_map = {agent.name: agent for agent in inventory.agents}
        target_agent = agent_map.get(request.agent_name)
        if target_agent is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
        if target_agent.status == "broken":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="broken agent cannot be executed")

        created = await ctx.run_orchestrator.create_run(
            agent_name=request.agent_name,
            prompt=prompt,
            workspace_root=workspace_root,
            sandbox_mode=sandbox_mode,
            approval_policy=approval_policy,
            engine=request.engine or ctx.settings.default_engine,
        )
        return _to_run_detail_model(created.record)

    @ctx.router.post("/runs/{run_id}/cancel", response_model=RunDetailModel)
    async def cancel_run(
        run_id: str,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> RunDetailModel:
        _verify_write_token(ctx.write_api_token, x_api_token)
        updated = await ctx.run_orchestrator.cancel_run(run_id)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        return _to_run_detail_model(updated)

    @ctx.router.post("/runs/{run_id}/retry", response_model=RunDetailModel)
    async def retry_run(
        run_id: str,
        engine: str | None = Body(None, embed=True),
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> RunDetailModel:
        _verify_write_token(ctx.write_api_token, x_api_token)
        retried = await ctx.run_orchestrator.retry_run(run_id, engine=engine)
        if retried is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        return _to_run_detail_model(retried.record)


def register_workflow_routes(ctx: ApiContext) -> None:
    @ctx.router.post("/workflows/recommend", response_model=WorkflowRecommendResponse)
    async def recommend_workflow_agents(
        payload: WorkflowRecommendRequest,
        engine: str | None = Query(default=None),
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRecommendResponse:
        _verify_write_token(ctx.write_api_token, x_api_token)
        # 워크플로 추천 시에도 현재 선택된 엔진에 등록된 에이전트 중에서 고르도록 engine 파라미터 반영
        try:
            recommendations = await ctx.workflow_orchestrator.recommend_agents(
                goal_prompt=payload.goal_prompt,
                max_agents=payload.max_agents,
                engine=engine,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        return WorkflowRecommendResponse(goal=payload.goal_prompt.strip(), recommended_agents=recommendations)

    @ctx.router.get("/workflow-runs", response_model=WorkflowRunsResponse)
    def list_workflow_runs(
        limit: int = Query(default=ctx.settings.run_list_limit_default, ge=1, le=ctx.settings.run_list_limit_max),
        engine: str | None = Query(default=None),
    ) -> WorkflowRunsResponse:
        # 워크플로 실행 이력 조회 시 현재 엔진에 해당하는 것만 필터링하도록 파라미터 추가
        runs = ctx.workflow_orchestrator.list_workflow_runs(limit=limit, engine=engine)
        return WorkflowRunsResponse(
            runs=[
                WorkflowRunSummaryModel(
                    workflow_run_id=run.workflow_run_id,
                    goal_prompt_preview=ctx.workflow_orchestrator.to_goal_preview(run.goal_prompt),
                    workspace_root=run.workspace_root,
                    status=run.status,
                    current_step_index=run.current_step_index,
                    total_steps=run.total_steps,
                    created_at=run.created_at,
                    started_at=run.started_at,
                    completed_at=run.completed_at,
                    error_message=run.error_message,
                )
                for run in runs
            ]
        )

    @ctx.router.get("/workflow-runs/{workflow_run_id}", response_model=WorkflowRunDetailModel)
    def get_workflow_run(workflow_run_id: str) -> WorkflowRunDetailModel:
        return _get_workflow_run_detail_or_404(ctx, workflow_run_id)

    @ctx.router.get("/workflow-runs/{workflow_run_id}/events", response_model=WorkflowEventsResponse)
    def get_workflow_events(
        workflow_run_id: str,
        limit: int = Query(default=ctx.settings.workflow_event_list_limit_default, ge=1, le=ctx.settings.workflow_event_list_limit_max),
    ) -> WorkflowEventsResponse:
        run = ctx.workflow_orchestrator.get_workflow_run(workflow_run_id)
        if run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        events = ctx.workflow_orchestrator.list_workflow_events(workflow_run_id, limit=limit)
        return WorkflowEventsResponse(
            events=[
                WorkflowEventModel(
                    event_id=event.event_id,
                    workflow_run_id=event.workflow_run_id,
                    step_index=event.step_index,
                    event_type=event.event_type,
                    message=event.message,
                    created_at=event.created_at,
                )
                for event in events
            ]
        )

    @ctx.router.post("/workflow-runs", response_model=WorkflowRunDetailModel)
    async def create_workflow_run(
        payload: WorkflowRunCreateRequest,
        engine: str | None = Query(default=None),
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        _verify_write_token(ctx.write_api_token, x_api_token)
        # 워크플로 생성 시에도 engine 파라미터를 넘겨서 올바른 설정으로 실행되도록 함
        try:
            created = await ctx.workflow_orchestrator.create_workflow_run(
                goal_prompt=payload.goal_prompt,
                steps=payload.steps,
                workspace_root=payload.workspace_root,
                sandbox_mode=payload.sandbox_mode,
                approval_policy=payload.approval_policy,
                engine=engine,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        return _get_workflow_run_detail_or_404(ctx, created.workflow_run_id)

    @ctx.router.post("/workflow-runs/{workflow_run_id}/cancel", response_model=WorkflowRunDetailModel)
    async def cancel_workflow_run(
        workflow_run_id: str,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        _verify_write_token(ctx.write_api_token, x_api_token)
        updated = await ctx.workflow_orchestrator.cancel_workflow_run(workflow_run_id)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return _get_workflow_run_detail_or_404(ctx, updated.workflow_run_id)

    @ctx.router.post("/workflow-runs/{workflow_run_id}/retry", response_model=WorkflowRunDetailModel)
    async def retry_workflow_run(
        workflow_run_id: str,
        engine: str | None = Body(None, embed=True),
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        _verify_write_token(ctx.write_api_token, x_api_token)
        retried = await ctx.workflow_orchestrator.retry_workflow_run(workflow_run_id, engine=engine)
        if retried is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return _get_workflow_run_detail_or_404(ctx, retried.workflow_run_id)

    @ctx.router.post("/workflow-runs/{workflow_run_id}/retry-from-step", response_model=WorkflowRunDetailModel)
    async def retry_workflow_run_from_step(
        workflow_run_id: str,
        request: WorkflowStepActionRequest = Body(None),
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        _verify_write_token(ctx.write_api_token, x_api_token)
        try:
            retried = await ctx.workflow_orchestrator.retry_workflow_run_from_step(
                workflow_run_id,
                step_index=request.step_index,
                follow_up_note=request.follow_up_note,
                engine=request.engine if hasattr(request, "engine") else None,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        if retried is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return _get_workflow_run_detail_or_404(ctx, retried.workflow_run_id)

    @ctx.router.post("/workflow-runs/{workflow_run_id}/skip-step", response_model=WorkflowRunDetailModel)
    async def skip_workflow_step(
        workflow_run_id: str,
        request: WorkflowStepActionRequest,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        _verify_write_token(ctx.write_api_token, x_api_token)
        try:
            created = await ctx.workflow_orchestrator.skip_workflow_step_and_continue(
                workflow_run_id,
                request.step_index,
                engine=request.engine if hasattr(request, "engine") else None,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        if created is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return _get_workflow_run_detail_or_404(ctx, created.workflow_run_id)


def register_event_routes(ctx: ApiContext) -> None:
    @ctx.router.get("/events")
    async def stream_events() -> StreamingResponse:
        queue = ctx.broker.subscribe()

        async def event_generator():
            try:
                while True:
                    try:
                        message = await asyncio.wait_for(queue.get(), timeout=15)
                        yield message.to_sse_chunk()
                    except asyncio.TimeoutError:
                        yield "data: {\"type\":\"heartbeat\",\"payload\":{},\"createdAt\":null}\n\n"
            finally:
                ctx.broker.unsubscribe(queue)

        return StreamingResponse(event_generator(), media_type="text/event-stream")
