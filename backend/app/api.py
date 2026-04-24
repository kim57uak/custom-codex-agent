from __future__ import annotations

import asyncio
import shutil
import tarfile
from datetime import datetime, timezone
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
    UiOptionModel,
    RunsResponse,
    RunSummaryModel,
    SkillAgentBackupResponse,
    SkillAgentRestoreResponse,
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
from app.config import AppSettings
from app.services.dashboard_service import DashboardService
from app.services.event_stream import EventBroker
from app.services.run_orchestrator import RunOrchestrator
from app.services.workflow_catalog import (
    WORKFLOW_APPROVAL_OPTIONS,
    WORKFLOW_ICON_RULES,
    WORKFLOW_SANDBOX_OPTIONS,
    WORKFLOW_STEP_STATUS_OPTIONS,
)
from app.services.workflow_orchestrator import WorkflowOrchestrator


def _to_run_status(raw_status: str) -> str:
    allowed = {"queued", "running", "completed", "failed", "canceled"}
    return raw_status if raw_status in allowed else "failed"


def build_api_router(
    service: DashboardService,
    broker: EventBroker,
    run_orchestrator: RunOrchestrator,
    workflow_orchestrator: WorkflowOrchestrator,
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

    def _create_skill_agent_backup_archive() -> tuple[Path, list[str]]:
        skills_root = settings.skills_root
        agents_root = settings.agents_root

        def _root_has_entries(root: Path) -> bool:
            if not root.exists() or not root.is_dir():
                return False
            try:
                next(root.iterdir())
                return True
            except StopIteration:
                return False

        included_roots: list[str] = []
        if _root_has_entries(skills_root):
            included_roots.append("skills")
        if _root_has_entries(agents_root):
            included_roots.append("agents")
        if not included_roots:
            raise FileNotFoundError("skills/agents have no entries to backup")

        app_root = Path(__file__).resolve().parents[2]
        backups_root = app_root / "backups"
        backups_root.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
        archive_name = f"skills-agents-backup-{timestamp}.tar.gz"
        archive_path = backups_root / archive_name

        with tarfile.open(archive_path, mode="w:gz") as archive:
            if "skills" in included_roots:
                archive.add(skills_root, arcname="skills")
            if "agents" in included_roots:
                archive.add(agents_root, arcname="agents")

        return archive_path, included_roots

    def _purge_backed_up_entries(included_roots: list[str]) -> int:
        deleted_count = 0
        root_map = {
            "skills": settings.skills_root,
            "agents": settings.agents_root,
        }
        for root_name in included_roots:
            root_path = root_map.get(root_name)
            if root_path is None or not root_path.exists() or not root_path.is_dir():
                continue
            for entry in root_path.iterdir():
                if entry.is_dir():
                    shutil.rmtree(entry)
                    deleted_count += 1
                    continue
                entry.unlink(missing_ok=True)
                deleted_count += 1
        return deleted_count

    def _validate_restore_members(members: list[tarfile.TarInfo]) -> list[str]:
        restored_file_counts: dict[str, int] = {"skills": 0, "agents": 0}
        for member in members:
            member_path = Path(member.name)
            if member_path.is_absolute() or ".." in member_path.parts:
                raise ValueError(f"invalid backup member path: {member.name}")
            if len(member_path.parts) == 0:
                continue
            top = member_path.parts[0]
            if top not in {"skills", "agents"}:
                raise ValueError(f"invalid backup member root: {member.name}")
            if member.isfile() and len(member_path.parts) >= 2:
                restored_file_counts[top] += 1
        restored_roots = sorted(root for root, count in restored_file_counts.items() if count > 0)
        if not restored_roots:
            raise ValueError("backup archive has no restorable files")
        return restored_roots

    def _archive_payload_counts(archive_path: Path) -> dict[str, int]:
        counts: dict[str, int] = {"skills": 0, "agents": 0}
        with tarfile.open(archive_path, mode="r:gz") as archive:
            for member in archive.getmembers():
                member_path = Path(member.name)
                if member_path.is_absolute() or ".." in member_path.parts or len(member_path.parts) == 0:
                    raise ValueError(f"invalid backup member path: {member.name}")
                top = member_path.parts[0]
                if top not in {"skills", "agents"}:
                    raise ValueError(f"invalid backup member root: {member.name}")
                if member.isfile() and len(member_path.parts) >= 2:
                    counts[top] += 1
        return counts

    def _find_latest_backup_archive() -> Path:
        app_root = Path(__file__).resolve().parents[2]
        backups_root = app_root / "backups"
        if not backups_root.exists() or not backups_root.is_dir():
            raise FileNotFoundError("backup directory not found")
        archives = sorted(backups_root.glob("skills-agents-backup-*.tar.gz"), key=lambda item: item.stat().st_mtime, reverse=True)
        if not archives:
            raise FileNotFoundError("no backup archive found")
        for archive_path in archives:
            try:
                payload = _archive_payload_counts(archive_path)
            except (OSError, ValueError, tarfile.TarError):
                continue
            if sum(payload.values()) > 0:
                return archive_path
        raise FileNotFoundError("no usable backup archive found")

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

    @router.get("/workflows/ui-config", response_model=WorkflowUiConfigResponse)
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
            recommendation_max_agents=settings.workflow_recommendation_max_agents,
        )

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

    @router.post("/backups/skills-agents", response_model=SkillAgentBackupResponse)
    async def backup_skills_agents(
        purge_after_backup: bool = Query(default=False),
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> SkillAgentBackupResponse:
        verify_write_token(x_api_token)
        try:
            archive_path, included_roots = _create_skill_agent_backup_archive()
            deleted_entry_count = _purge_backed_up_entries(included_roots) if purge_after_backup else 0
            stat = archive_path.stat()
        except FileNotFoundError as err:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err
        except OSError as err:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"backup failed: {err}") from err

        return SkillAgentBackupResponse(
            backup_path=str(archive_path),
            backup_file_name=archive_path.name,
            included_roots=included_roots,
            deleted_entry_count=deleted_entry_count,
            created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
            size_bytes=stat.st_size,
        )

    @router.post("/backups/skills-agents/restore", response_model=SkillAgentRestoreResponse)
    async def restore_skills_agents(
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> SkillAgentRestoreResponse:
        verify_write_token(x_api_token)
        try:
            archive_path = _find_latest_backup_archive()
            with tarfile.open(archive_path, mode="r:gz") as archive:
                members = archive.getmembers()
                restored_roots = _validate_restore_members(members)
                deleted_entry_count = _purge_backed_up_entries(restored_roots)
                settings.skills_root.mkdir(parents=True, exist_ok=True)
                settings.agents_root.mkdir(parents=True, exist_ok=True)
                archive.extractall(path=settings.codex_home)
            restored_member_count = sum(1 for item in members if item.isfile())
        except (FileNotFoundError, ValueError) as err:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err
        except OSError as err:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"restore failed: {err}") from err

        return SkillAgentRestoreResponse(
            restored_from_path=str(archive_path),
            restored_roots=restored_roots,
            restored_member_count=restored_member_count,
            deleted_entry_count_before_restore=deleted_entry_count,
            restored_at=datetime.now(tz=timezone.utc),
        )

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

    @router.post("/workflows/recommend", response_model=WorkflowRecommendResponse)
    async def recommend_workflow_agents(
        request: WorkflowRecommendRequest,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRecommendResponse:
        verify_write_token(x_api_token)
        try:
            recommendations = await workflow_orchestrator.recommend_agents(
                request.goal_prompt,
                max_agents=request.max_agents,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        return WorkflowRecommendResponse(goal=request.goal_prompt.strip(), recommended_agents=recommendations)

    @router.get("/workflow-runs", response_model=WorkflowRunsResponse)
    def list_workflow_runs(limit: int = Query(default=30, ge=1, le=200)) -> WorkflowRunsResponse:
        runs = workflow_orchestrator.list_workflow_runs(limit=limit)
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
    def get_workflow_run(workflow_run_id: str) -> WorkflowRunDetailModel:
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

    @router.get("/workflow-runs/{workflow_run_id}/events", response_model=WorkflowEventsResponse)
    def get_workflow_events(
        workflow_run_id: str,
        limit: int = Query(default=500, ge=1, le=4000),
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
        request: WorkflowRunCreateRequest,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        verify_write_token(x_api_token)
        try:
            created = await workflow_orchestrator.create_workflow_run(
                goal_prompt=request.goal_prompt,
                steps=request.steps,
                workspace_root=request.workspace_root,
                sandbox_mode=request.sandbox_mode,
                approval_policy=request.approval_policy,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        return get_workflow_run(created.workflow_run_id)

    @router.post("/workflow-runs/{workflow_run_id}/cancel", response_model=WorkflowRunDetailModel)
    async def cancel_workflow_run(
        workflow_run_id: str,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        verify_write_token(x_api_token)
        updated = await workflow_orchestrator.cancel_workflow_run(workflow_run_id)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return get_workflow_run(updated.workflow_run_id)

    @router.post("/workflow-runs/{workflow_run_id}/retry", response_model=WorkflowRunDetailModel)
    async def retry_workflow_run(
        workflow_run_id: str,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        verify_write_token(x_api_token)
        created = await workflow_orchestrator.retry_workflow_run(workflow_run_id)
        if created is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return get_workflow_run(created.workflow_run_id)

    @router.post("/workflow-runs/{workflow_run_id}/retry-from-step", response_model=WorkflowRunDetailModel)
    async def retry_workflow_run_from_step(
        workflow_run_id: str,
        request: WorkflowStepActionRequest,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        verify_write_token(x_api_token)
        try:
            created = await workflow_orchestrator.retry_workflow_run_from_step(
                workflow_run_id,
                request.step_index,
                request.follow_up_note,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        if created is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return get_workflow_run(created.workflow_run_id)

    @router.post("/workflow-runs/{workflow_run_id}/skip-step", response_model=WorkflowRunDetailModel)
    async def skip_workflow_step(
        workflow_run_id: str,
        request: WorkflowStepActionRequest,
        x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    ) -> WorkflowRunDetailModel:
        verify_write_token(x_api_token)
        try:
            created = await workflow_orchestrator.skip_workflow_step_and_continue(
                workflow_run_id,
                request.step_index,
            )
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        if created is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow run not found")
        return get_workflow_run(created.workflow_run_id)

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
