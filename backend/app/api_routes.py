from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.config import AppSettings
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
from app.services.dashboard_service import DashboardService
from app.services.event_stream import EventBroker
from app.services.run_orchestrator import RunOrchestrator
from app.services.skill_agent_backup_service import SkillAgentBackupService
from app.services.workflow_catalog import (
    WORKFLOW_APPROVAL_OPTIONS,
    WORKFLOW_ICON_RULES,
    WORKFLOW_SANDBOX_OPTIONS,
    WORKFLOW_STEP_STATUS_OPTIONS,
)
from app.services.workflow_orchestrator import WorkflowOrchestrator


@dataclass(frozen=True)
class ApiContext:
    router: APIRouter
    service: DashboardService
    broker: EventBroker
    run_orchestrator: RunOrchestrator
    workflow_orchestrator: WorkflowOrchestrator
    settings: AppSettings
    write_api_token: str | None
    backup_service: SkillAgentBackupService


def _to_run_status(raw_status: str) -> str:
    allowed = {"queued", "running", "completed", "failed", "canceled"}
    return raw_status if raw_status in allowed else "failed"


def _verify_write_token(write_api_token: str | None, x_api_token: str | None) -> None:
    if not write_api_token:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="write api disabled")
    if x_api_token != write_api_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid write api token")


def _safe_read_text(path: Path, max_chars: int = 160000) -> tuple[str, bool]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) <= max_chars:
        return text, False
    return text[:max_chars], True


def _is_within_root(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _to_file_model(path: Path, kind: str) -> AgentInspectorFileModel:
    content, truncated = _safe_read_text(path)
    try:
        stat = path.stat()
        modified_at = datetime.fromtimestamp(stat.st_mtime)
        size_bytes = stat.st_size
    except OSError:
        modified_at = None
        size_bytes = 0
    return AgentInspectorFileModel(
        name=path.name,
        path=str(path),
        kind=kind,
        size_bytes=size_bytes,
        modified_at=modified_at,
        content=content,
        truncated=truncated,
    )


def _find_agent_or_404(ctx: ApiContext, agent_name: str):
    inventory = ctx.service.build_inventory()
    target = next((agent for agent in inventory.agents if agent.name == agent_name), None)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    return target


def _inspector_paths_for_agent(ctx: ApiContext, agent_name: str, skill_path_value: str | None) -> dict[Path, str]:
    editable_paths: dict[Path, str] = {}
    agent_dir = ctx.settings.agents_root / agent_name
    skill_path = Path(skill_path_value).expanduser() if skill_path_value else None
    skill_dir = skill_path.parent if skill_path else None

    def add_file(path: Path, kind: str) -> None:
        if path.exists() and path.is_file() and _is_within_root(path, ctx.settings.codex_home):
            editable_paths[path.resolve()] = kind

    add_file(agent_dir / "agent.toml", "agent-toml")
    add_file(agent_dir / "config.json", "agent-json")
    if skill_path:
        add_file(skill_path, "skill-md")
    if skill_dir and skill_dir.exists() and _is_within_root(skill_dir, ctx.settings.codex_home):
        for subdir_name, kind in (("references", "reference"), ("scripts", "script")):
            subdir = skill_dir / subdir_name
            if not subdir.exists() or not subdir.is_dir():
                continue
            for file_path in sorted(subdir.rglob("*")):
                add_file(file_path, kind)
    return editable_paths


def _to_run_detail_model(record) -> RunDetailModel:
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
    def get_overview() -> OverviewModel:
        return ctx.service.build_overview()

    @ctx.router.get("/graph/router", response_model=RouterGraphResponse)
    def get_router_graph() -> RouterGraphResponse:
        return ctx.service.build_router_graph()

    @ctx.router.get("/graph/org", response_model=OrganizationChartResponse)
    def get_org_chart() -> OrganizationChartResponse:
        return ctx.service.build_org_chart()

    @ctx.router.get("/dashboard", response_model=DashboardResponse)
    def get_dashboard() -> DashboardResponse:
        return ctx.service.build_dashboard()

    @ctx.router.get("/inventory", response_model=InventoryResponse)
    def get_inventory() -> InventoryResponse:
        return ctx.service.build_inventory()

    @ctx.router.get("/agents/executable", response_model=ExecutableAgentsResponse)
    def get_executable_agents() -> ExecutableAgentsResponse:
        inventory = ctx.service.build_inventory()
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
    def get_agent_inspector(agent_name: str) -> AgentInspectorResponse:
        target = _find_agent_or_404(ctx, agent_name)
        agent_dir = ctx.settings.agents_root / agent_name
        agent_toml_path = agent_dir / "agent.toml"
        agent_json_path = agent_dir / "config.json"
        skill_path = Path(target.skill_path).expanduser() if target.skill_path else None
        skill_dir = skill_path.parent if skill_path else None

        skill_markdown = None
        if skill_path and skill_path.exists() and skill_path.is_file() and _is_within_root(skill_path, ctx.settings.codex_home):
            skill_markdown = _to_file_model(skill_path, "skill-md")

        agent_toml = None
        if agent_toml_path.exists() and agent_toml_path.is_file() and _is_within_root(agent_toml_path, ctx.settings.codex_home):
            agent_toml = _to_file_model(agent_toml_path, "agent-toml")

        agent_json = None
        if agent_json_path.exists() and agent_json_path.is_file() and _is_within_root(agent_json_path, ctx.settings.codex_home):
            agent_json = _to_file_model(agent_json_path, "agent-json")

        references: list[AgentInspectorFileModel] = []
        scripts: list[AgentInspectorFileModel] = []
        if skill_dir and skill_dir.exists() and _is_within_root(skill_dir, ctx.settings.codex_home):
            for subdir_name, collection, kind in (
                ("references", references, "reference"),
                ("scripts", scripts, "script"),
            ):
                subdir = skill_dir / subdir_name
                if not subdir.exists() or not subdir.is_dir():
                    continue
                for file_path in sorted(subdir.rglob("*")):
                    if file_path.is_file():
                        collection.append(_to_file_model(file_path, kind))

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

    @ctx.router.post("/agents/{agent_name}/inspector/files", response_model=AgentInspectorFileSaveResponse)
    def save_agent_inspector_file(
        agent_name: str,
        payload: AgentInspectorFileSaveRequest,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> AgentInspectorFileSaveResponse:
        _verify_write_token(ctx.write_api_token, x_api_token)
        target = _find_agent_or_404(ctx, agent_name)
        try:
            requested_path = Path(payload.path).expanduser().resolve()
        except OSError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid path: {err}") from err

        editable_paths = _inspector_paths_for_agent(ctx, agent_name, target.skill_path)
        file_kind = editable_paths.get(requested_path)
        if file_kind is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="file is not editable from this inspector")
        if len(payload.content) > 1000000:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="file content is too large")
        if file_kind == "agent-json" or requested_path.suffix.lower() == ".json":
            try:
                json.loads(payload.content)
            except json.JSONDecodeError as err:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid json: {err.msg}") from err

        try:
            tmp_path = requested_path.with_name(f".{requested_path.name}.tmp")
            tmp_path.write_text(payload.content, encoding="utf-8")
            tmp_path.replace(requested_path)
        except OSError as err:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"save failed: {err}") from err

        return AgentInspectorFileSaveResponse(status="ok", file=_to_file_model(requested_path, file_kind))


def register_config_routes(ctx: ApiContext) -> None:
    @ctx.router.get("/run-config", response_model=RunConfigResponse)
    def get_run_config() -> RunConfigResponse:
        return RunConfigResponse(
            default_workspace_root=str(ctx.run_orchestrator.default_workspace_root),
            write_api_enabled=bool(ctx.write_api_token),
            default_write_api_token=ctx.write_api_token,
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

        directories = [DirectoryItemModel(name=item.name, path=str(item)) for item in items[:500]]
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
        purge_after_backup: bool = Query(default=False),
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> SkillAgentBackupResponse:
        _verify_write_token(ctx.write_api_token, x_api_token)
        try:
            backup_result = ctx.backup_service.backup(purge_after_backup=purge_after_backup)
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
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> SkillAgentRestoreResponse:
        _verify_write_token(ctx.write_api_token, x_api_token)
        try:
            restore_result = ctx.backup_service.restore_latest()
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
    def list_runs(limit: int = Query(default=30, ge=1, le=200)) -> RunsResponse:
        runs = ctx.run_orchestrator.list_runs(limit=limit)
        return RunsResponse(
            runs=[
                RunSummaryModel(
                    run_id=run.run_id,
                    agent_name=run.agent_name,
                    workspace_root=run.workspace_root,
                    status=_to_run_status(run.status),
                    prompt_preview=ctx.run_orchestrator.to_prompt_preview(run.prompt),
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
    def get_run_events(run_id: str, limit: int = Query(default=300, ge=1, le=2000)) -> RunEventsResponse:
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
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> RunDetailModel:
        _verify_write_token(ctx.write_api_token, x_api_token)
        retried = await ctx.run_orchestrator.retry_run(run_id)
        if retried is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        return _to_run_detail_model(retried.record)


def register_workflow_routes(ctx: ApiContext) -> None:
    @ctx.router.post("/workflows/recommend", response_model=WorkflowRecommendResponse)
    async def recommend_workflow_agents(
        request: WorkflowRecommendRequest,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRecommendResponse:
        _verify_write_token(ctx.write_api_token, x_api_token)
        try:
            recommendations = await ctx.workflow_orchestrator.recommend_agents(
                request.goal_prompt,
                max_agents=request.max_agents,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        return WorkflowRecommendResponse(goal=request.goal_prompt.strip(), recommended_agents=recommendations)

    @ctx.router.get("/workflow-runs", response_model=WorkflowRunsResponse)
    def list_workflow_runs(limit: int = Query(default=30, ge=1, le=200)) -> WorkflowRunsResponse:
        runs = ctx.workflow_orchestrator.list_workflow_runs(limit=limit)
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
        limit: int = Query(default=500, ge=1, le=4000),
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
        request: WorkflowRunCreateRequest,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        _verify_write_token(ctx.write_api_token, x_api_token)
        try:
            created = await ctx.workflow_orchestrator.create_workflow_run(
                goal_prompt=request.goal_prompt,
                steps=request.steps,
                workspace_root=request.workspace_root,
                sandbox_mode=request.sandbox_mode,
                approval_policy=request.approval_policy,
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
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        _verify_write_token(ctx.write_api_token, x_api_token)
        created = await ctx.workflow_orchestrator.retry_workflow_run(workflow_run_id)
        if created is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return _get_workflow_run_detail_or_404(ctx, created.workflow_run_id)

    @ctx.router.post("/workflow-runs/{workflow_run_id}/retry-from-step", response_model=WorkflowRunDetailModel)
    async def retry_workflow_run_from_step(
        workflow_run_id: str,
        request: WorkflowStepActionRequest,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        _verify_write_token(ctx.write_api_token, x_api_token)
        try:
            created = await ctx.workflow_orchestrator.retry_workflow_run_from_step(
                workflow_run_id,
                request.step_index,
                request.follow_up_note,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        if created is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return _get_workflow_run_detail_or_404(ctx, created.workflow_run_id)

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
