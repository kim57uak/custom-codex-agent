from __future__ import annotations
import logging
import asyncio
from typing import Annotated, TYPE_CHECKING
from fastapi import APIRouter, Body, Header, HTTPException, Query, status, Depends
from fastapi.responses import StreamingResponse

from app.dependencies import (
    get_dashboard_service,
    get_event_broker,
    get_run_orchestrator,
    get_workflow_orchestrator,
    get_backup_service,
    get_inspector_service,
    get_settings,
    verify_write_access,
)
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


def _find_agent_or_404(service: DashboardService, agent_name: str, engine: str | None = None):
    # 엔진 선택에 따라 에이전트 목록이 달라질 수 있으므로 engine 파라미터를 명시적으로 전달함
    inventory = service.build_inventory(engine=engine)
    target = next((agent for agent in inventory.agents if agent.name == agent_name), None)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    return target


def register_read_routes(router: APIRouter) -> None:
    @router.get("/overview", response_model=OverviewModel)
    def get_overview(
        engine: str | None = Query(default=None),
        service: DashboardService = Depends(get_dashboard_service),
    ) -> OverviewModel:
        return service.build_overview(engine=engine)

    @router.get("/graph/router", response_model=RouterGraphResponse)
    def get_router_graph(
        engine: str | None = Query(default=None),
        service: DashboardService = Depends(get_dashboard_service),
    ) -> RouterGraphResponse:
        return service.build_router_graph(engine=engine)

    @router.get("/graph/org", response_model=OrganizationChartResponse)
    def get_org_chart(
        engine: str | None = Query(default=None),
        service: DashboardService = Depends(get_dashboard_service),
    ) -> OrganizationChartResponse:
        return service.build_org_chart(engine=engine)

    @router.get("/dashboard", response_model=DashboardResponse)
    def get_dashboard(
        engine: str | None = Query(default=None),
        service: DashboardService = Depends(get_dashboard_service),
    ) -> DashboardResponse:
        return service.build_dashboard(engine=engine)

    @router.get("/inventory", response_model=InventoryResponse)
    def get_inventory(
        engine: str | None = Query(default=None),
        service: DashboardService = Depends(get_dashboard_service),
    ) -> InventoryResponse:
        return service.build_inventory(engine=engine)

    @router.get("/agents/executable", response_model=ExecutableAgentsResponse)
    def get_executable_agents(
        engine: str | None = Query(default=None),
        service: DashboardService = Depends(get_dashboard_service),
    ) -> ExecutableAgentsResponse:
        inventory = service.build_inventory(engine=engine)
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
        return ExecutableAgentsResponse(agents=agents)
def register_inspector_routes(router: APIRouter) -> None:
    @router.get("/agents/{agent_name}/inspector", response_model=AgentInspectorResponse)
    def get_agent_inspector(
        agent_name: str,
        engine: str | None = Query(default=None),
        service: DashboardService = Depends(get_dashboard_service),
        inspector_service: AgentInspectorService = Depends(get_inspector_service),
    ) -> AgentInspectorResponse:
        target = _find_agent_or_404(service, agent_name, engine=engine)
        return inspector_service.build_inspector_response(target, engine=engine)

    @router.post("/agents/{agent_name}/inspector/files", response_model=AgentInspectorFileSaveResponse)
    def save_agent_inspector_file(
        agent_name: str,
        payload: AgentInspectorFileSaveRequest,
        service: DashboardService = Depends(get_dashboard_service),
        inspector_service: AgentInspectorService = Depends(get_inspector_service),
        settings: AppSettings = Depends(get_settings),
        _=Depends(verify_write_access),
    ) -> AgentInspectorFileSaveResponse:
        if len(payload.content) > settings.safe_read_text_max_chars * 10:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="file content is too large")

        engine = payload.engine
        
        if payload.path.lower().endswith(".json"):
            try:
                json.loads(payload.content)
            except json.JSONDecodeError as err:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid json: {err.msg}") from err

        try:
            saved_path = inspector_service.save_file(
                agent_name=agent_name,
                file_path_str=payload.path,
                content=payload.content,
                engine=engine
            )
            return AgentInspectorFileSaveResponse(
                status="ok", 
                file=inspector_service.build_file_model(saved_path, kind="updated")
            )
        except (PermissionError, FileNotFoundError) as err:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err)) from err
        except Exception as err:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"save failed: {err}",
            ) from err


def register_config_routes(router: APIRouter) -> None:
    @router.get("/run-config", response_model=RunConfigResponse)
    def get_run_config(
        run_orchestrator: RunOrchestrator = Depends(get_run_orchestrator),
        settings: AppSettings = Depends(get_settings),
    ) -> RunConfigResponse:
        return RunConfigResponse(
            default_workspace_root=str(run_orchestrator.default_workspace_root),
            write_api_enabled=bool(settings.write_api_token),
            default_write_api_token=settings.write_api_token,
            available_engines=["gemini", "codex"],
            default_engine=settings.default_engine,
        )

    @router.get("/workflows/ui-config", response_model=WorkflowUiConfigResponse)
    def get_workflow_ui_config(settings: AppSettings = Depends(get_settings)) -> WorkflowUiConfigResponse:
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
            recommendation_max_agents=settings.workflow_recommendation_max_agents,
        )

    @router.get("/fs/directories", response_model=DirectoryBrowseResponse)
    def list_directories(
        path: str | None = Query(default=None),
        run_orchestrator: RunOrchestrator = Depends(get_run_orchestrator),
        settings: AppSettings = Depends(get_settings),
    ) -> DirectoryBrowseResponse:
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

        directories = [DirectoryItemModel(name=item.name, path=str(item)) for item in items[:settings.directory_list_limit]]
        parent_path = str(resolved.parent) if resolved.parent != resolved else None
        return DirectoryBrowseResponse(current_path=str(resolved), parent_path=parent_path, directories=directories)


def _to_run_status(raw_status: str) -> str:
    allowed = {"queued", "running", "completed", "failed", "canceled"}
    return raw_status if raw_status in allowed else "failed"


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


def _get_workflow_run_detail_or_404(workflow_orchestrator: WorkflowOrchestrator, workflow_run_id: str) -> WorkflowRunDetailModel:
    run = workflow_orchestrator.get_workflow_run(workflow_run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
    steps = workflow_orchestrator.list_workflow_steps(workflow_run_id)
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


def register_maintenance_routes(router: APIRouter) -> None:
    @router.post("/scan")
    async def trigger_scan(broker: EventBroker = Depends(get_event_broker), _=Depends(verify_write_access)) -> dict[str, str]:
        await broker.publish("scan:completed", {"source": "manual"})
        await broker.publish("dashboard:updated", {"source": "manual"})
        return {"status": "ok"}

    @router.post("/activity/refresh")
    async def refresh_activity(broker: EventBroker = Depends(get_event_broker), _=Depends(verify_write_access)) -> dict[str, str]:
        await broker.publish("activity:updated", {"source": "manual"})
        await broker.publish("dashboard:updated", {"source": "manual"})
        return {"status": "ok"}

    @router.post("/backups/skills-agents", response_model=SkillAgentBackupResponse)
    async def backup_skills_agents(
        engine: str | None = Query(default=None),
        purge_after_backup: bool = Query(default=False),
        backup_service: SkillAgentBackupService = Depends(get_backup_service),
        _=Depends(verify_write_access),
    ) -> SkillAgentBackupResponse:
        try:
            backup_result = backup_service.backup(engine=engine, purge_after_backup=purge_after_backup)
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

    @router.post("/backups/skills-agents/restore", response_model=SkillAgentRestoreResponse)
    async def restore_skills_agents(
        engine: str | None = Query(default=None),
        backup_service: SkillAgentBackupService = Depends(get_backup_service),
        _=Depends(verify_write_access),
    ) -> SkillAgentRestoreResponse:
        try:
            restore_result = backup_service.restore_latest(engine=engine)
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


def register_run_routes(router: APIRouter) -> None:
    @router.get("/runs", response_model=RunsResponse)
    def list_runs(
        limit: int = Query(default=50, ge=1, le=100),
        engine: str | None = Query(default=None),
        run_orchestrator: RunOrchestrator = Depends(get_run_orchestrator),
        settings: AppSettings = Depends(get_settings),
    ) -> RunsResponse:
        runs = run_orchestrator.list_runs(limit=limit, engine=engine)
        return RunsResponse(
            runs=[
                RunSummaryModel(
                    run_id=run.run_id,
                    agent_name=run.agent_name,
                    workspace_root=run.workspace_root,
                    status=_to_run_status(run.status),
                    prompt_preview=run_orchestrator.to_prompt_preview(run.prompt),
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

    @router.get("/runs/{run_id}", response_model=RunDetailModel)
    def get_run(run_id: str, run_orchestrator: RunOrchestrator = Depends(get_run_orchestrator)) -> RunDetailModel:
        run = run_orchestrator.get_run(run_id)
        if run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        return _to_run_detail_model(run)

    @router.get("/runs/{run_id}/events", response_model=RunEventsResponse)
    def get_run_events(
        run_id: str,
        limit: int = Query(default=100, ge=1, le=2000),
        run_orchestrator: RunOrchestrator = Depends(get_run_orchestrator),
    ) -> RunEventsResponse:
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
        run_orchestrator: RunOrchestrator = Depends(get_run_orchestrator),
        service: DashboardService = Depends(get_dashboard_service),
        settings: AppSettings = Depends(get_settings),
        _=Depends(verify_write_access),
    ) -> RunDetailModel:
        try:
            prompt = run_orchestrator.validate_prompt(request.prompt)
            workspace_root = run_orchestrator.validate_workspace_root(request.workspace_root)
            sandbox_mode = run_orchestrator.validate_sandbox_mode(request.sandbox_mode)
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
            engine=request.engine or settings.default_engine,
        )
        return _to_run_detail_model(created.record)

    @router.post("/runs/{run_id}/cancel", response_model=RunDetailModel)
    async def cancel_run(
        run_id: str,
        run_orchestrator: RunOrchestrator = Depends(get_run_orchestrator),
        _=Depends(verify_write_access),
    ) -> RunDetailModel:
        updated = await run_orchestrator.cancel_run(run_id)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        return _to_run_detail_model(updated)

    @router.post("/runs/{run_id}/retry", response_model=RunDetailModel)
    async def retry_run(
        run_id: str,
        engine: str | None = Body(None, embed=True),
        run_orchestrator: RunOrchestrator = Depends(get_run_orchestrator),
        _=Depends(verify_write_access),
    ) -> RunDetailModel:
        retried = await run_orchestrator.retry_run(run_id, engine=engine)
        if retried is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        return _to_run_detail_model(retried.record)

    @router.post("/runs/{run_id}/reply")
    async def reply_to_run(
        run_id: str,
        message: str = Body(..., embed=True),
        run_orchestrator: RunOrchestrator = Depends(get_run_orchestrator),
        _=Depends(verify_write_access),
    ) -> dict[str, bool]:
        success = await run_orchestrator.reply_to_run(run_id, message)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail="failed to send reply (run may be finished or not found)"
            )
        return {"success": True}


def register_workflow_routes(router: APIRouter) -> None:
    @router.post("/workflows/recommend", response_model=WorkflowRecommendResponse)
    async def recommend_workflow_agents(
        payload: WorkflowRecommendRequest,
        engine: str | None = Query(default=None),
        workflow_orchestrator: WorkflowOrchestrator = Depends(get_workflow_orchestrator),
        _=Depends(verify_write_access),
    ) -> WorkflowRecommendResponse:
        try:
            recommendations = await workflow_orchestrator.recommend_agents(
                goal_prompt=payload.goal_prompt,
                max_agents=payload.max_agents,
                engine=engine,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        return WorkflowRecommendResponse(goal=payload.goal_prompt.strip(), recommended_agents=recommendations)

    @router.get("/workflow-runs", response_model=WorkflowRunsResponse)
    def list_workflow_runs(
        limit: int = Query(default=50, ge=1, le=100),
        engine: str | None = Query(default=None),
        workflow_orchestrator: WorkflowOrchestrator = Depends(get_workflow_orchestrator),
    ) -> WorkflowRunsResponse:
        runs = workflow_orchestrator.list_workflow_runs(limit=limit, engine=engine)
        return WorkflowRunsResponse(
            runs=[
                WorkflowRunSummaryModel(
                    workflow_run_id=run.workflow_run_id,
                    goal_prompt_preview=workflow_orchestrator.to_goal_preview(run.goal_prompt),
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

    @router.get("/workflow-runs/{workflow_run_id}", response_model=WorkflowRunDetailModel)
    def get_workflow_run(
        workflow_run_id: str,
        workflow_orchestrator: WorkflowOrchestrator = Depends(get_workflow_orchestrator),
    ) -> WorkflowRunDetailModel:
        return _get_workflow_run_detail_or_404(workflow_orchestrator, workflow_run_id)

    @router.get("/workflow-runs/{workflow_run_id}/events", response_model=WorkflowEventsResponse)
    def get_workflow_events(
        workflow_run_id: str,
        limit: int = Query(default=100, ge=1, le=2000),
        workflow_orchestrator: WorkflowOrchestrator = Depends(get_workflow_orchestrator),
    ) -> WorkflowEventsResponse:
        run = workflow_orchestrator.get_workflow_run(workflow_run_id)
        if run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        events = workflow_orchestrator.list_workflow_events(workflow_run_id, limit=limit)
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

    @router.post("/workflow-runs", response_model=WorkflowRunDetailModel)
    async def create_workflow_run(
        payload: WorkflowRunCreateRequest,
        engine: str | None = Query(default=None),
        workflow_orchestrator: WorkflowOrchestrator = Depends(get_workflow_orchestrator),
        _=Depends(verify_write_access),
    ) -> WorkflowRunDetailModel:
        try:
            created = await workflow_orchestrator.create_workflow_run(
                goal_prompt=payload.goal_prompt,
                steps=payload.steps,
                workspace_root=payload.workspace_root,
                sandbox_mode=payload.sandbox_mode,
                approval_policy=payload.approval_policy,
                engine=engine,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        return _get_workflow_run_detail_or_404(workflow_orchestrator, created.workflow_run_id)

    @router.post("/workflow-runs/{workflow_run_id}/cancel", response_model=WorkflowRunDetailModel)
    async def cancel_workflow_run(
        workflow_run_id: str,
        workflow_orchestrator: WorkflowOrchestrator = Depends(get_workflow_orchestrator),
        _=Depends(verify_write_access),
    ) -> WorkflowRunDetailModel:
        updated = await workflow_orchestrator.cancel_workflow_run(workflow_run_id)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return _get_workflow_run_detail_or_404(workflow_orchestrator, updated.workflow_run_id)

    @router.post("/workflow-runs/{workflow_run_id}/retry", response_model=WorkflowRunDetailModel)
    async def retry_workflow_run(
        workflow_run_id: str,
        engine: str | None = Body(None, embed=True),
        workflow_orchestrator: WorkflowOrchestrator = Depends(get_workflow_orchestrator),
        _=Depends(verify_write_access),
    ) -> WorkflowRunDetailModel:
        retried = await workflow_orchestrator.retry_workflow_run(workflow_run_id, engine=engine)
        if retried is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return _get_workflow_run_detail_or_404(workflow_orchestrator, retried.workflow_run_id)

    @router.post("/workflow-runs/{workflow_run_id}/retry-from-step", response_model=WorkflowRunDetailModel)
    async def retry_workflow_run_from_step(
        workflow_run_id: str,
        request: WorkflowStepActionRequest = Body(None),
        workflow_orchestrator: WorkflowOrchestrator = Depends(get_workflow_orchestrator),
        _=Depends(verify_write_access),
    ) -> WorkflowRunDetailModel:
        try:
            retried = await workflow_orchestrator.retry_workflow_run_from_step(
                workflow_run_id,
                step_index=request.step_index,
                follow_up_note=request.follow_up_note,
                engine=request.engine,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        if retried is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return _get_workflow_run_detail_or_404(workflow_orchestrator, retried.workflow_run_id)

    @router.post("/workflow-runs/{workflow_run_id}/skip-step", response_model=WorkflowRunDetailModel)
    async def skip_workflow_step(
        workflow_run_id: str,
        request: WorkflowStepActionRequest,
        workflow_orchestrator: WorkflowOrchestrator = Depends(get_workflow_orchestrator),
        _=Depends(verify_write_access),
    ) -> WorkflowRunDetailModel:
        try:
            created = await workflow_orchestrator.skip_workflow_step_and_continue(
                workflow_run_id,
                request.step_index,
                engine=request.engine,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        if created is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return _get_workflow_run_detail_or_404(workflow_orchestrator, created.workflow_run_id)


def register_event_routes(router: APIRouter) -> None:
    @router.get("/events")
    async def stream_events(broker: EventBroker = Depends(get_event_broker)) -> StreamingResponse:
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
