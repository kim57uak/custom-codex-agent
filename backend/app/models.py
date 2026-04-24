from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


NodeType = Literal["department", "agent", "skill", "router", "keyword"]
HealthStatus = Literal["healthy", "partial", "broken", "passive"]
RunStatus = Literal["queued", "running", "completed", "failed", "canceled"]
SandboxMode = Literal["read-only", "workspace-write", "danger-full-access"]
ApprovalPolicy = Literal["untrusted", "on-request", "never"]
WorkflowRunStatus = Literal["draft", "queued", "running", "completed", "failed", "canceled"]
WorkflowStepStatus = Literal["recommended", "ready", "queued", "running", "approval_required", "completed", "failed", "canceled", "skipped"]


class SkillModel(BaseModel):
    name: str
    path: str
    installed: bool
    enabled: bool


class AgentModel(BaseModel):
    name: str
    role_label_ko: str
    department_label_ko: str
    description: str
    short_description: str | None = None
    one_click_prompt: str | None = None
    skill_name: str | None = None
    skill_path: str | None = None
    routing_type: str
    routed: bool
    status: HealthStatus
    reason: str


class RouteModel(BaseModel):
    keyword: str
    agent_name: str


class GraphNodeModel(BaseModel):
    id: str
    type: NodeType
    label: str
    sublabel: str | None = None
    status: HealthStatus = "healthy"
    metadata: dict[str, str] = Field(default_factory=dict)


class GraphEdgeModel(BaseModel):
    id: str
    source: str
    target: str
    label: str | None = None


class DashboardMetricModel(BaseModel):
    key: str
    label: str
    value: int
    trend_values: list[int] = Field(default_factory=list)


class ActivityItemModel(BaseModel):
    title: str
    subtitle: str
    timestamp: datetime | None = None


class OverviewModel(BaseModel):
    total_skills: int
    total_agents: int
    routed_agents: int
    route_hints: int
    broken_mappings: int
    active_threads: int
    active_agents: int
    last_scanned_at: datetime


class RouterGraphResponse(BaseModel):
    nodes: list[GraphNodeModel]
    edges: list[GraphEdgeModel]


class OrganizationChartResponse(BaseModel):
    nodes: list[GraphNodeModel]
    edges: list[GraphEdgeModel]


class DashboardResponse(BaseModel):
    metrics: list[DashboardMetricModel]
    active_agents: list[ActivityItemModel]
    recent_skills: list[ActivityItemModel]
    recent_threads: list[ActivityItemModel]
    timeline: list[ActivityItemModel]
    department_breakdown: list[DashboardMetricModel]
    status_breakdown: list[DashboardMetricModel]


class InventoryResponse(BaseModel):
    skills: list[SkillModel]
    agents: list[AgentModel]
    routes: list[RouteModel]


class ExecutableAgentModel(BaseModel):
    name: str
    role_label_ko: str
    department_label_ko: str
    runnable: bool
    reason: str
    short_description: str | None = None
    one_click_prompt: str | None = None


class ExecutableAgentsResponse(BaseModel):
    agents: list[ExecutableAgentModel]


class RunCreateRequest(BaseModel):
    agent_name: str
    prompt: str
    workspace_root: str | None = None
    sandbox_mode: SandboxMode | None = None
    approval_policy: ApprovalPolicy | None = None


class RunSummaryModel(BaseModel):
    run_id: str
    agent_name: str
    workspace_root: str
    status: RunStatus
    prompt_preview: str
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    exit_code: int | None = None
    error_message: str | None = None


class RunDetailModel(BaseModel):
    run_id: str
    agent_name: str
    workspace_root: str
    prompt: str
    status: RunStatus
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    exit_code: int | None = None
    error_message: str | None = None


class RunEventModel(BaseModel):
    event_id: int
    run_id: str
    event_type: str
    message: str
    created_at: datetime


class RunsResponse(BaseModel):
    runs: list[RunSummaryModel]


class RunEventsResponse(BaseModel):
    events: list[RunEventModel]


class RunConfigResponse(BaseModel):
    default_workspace_root: str


class DirectoryItemModel(BaseModel):
    name: str
    path: str


class DirectoryBrowseResponse(BaseModel):
    current_path: str
    parent_path: str | None = None
    directories: list[DirectoryItemModel]


class AgentInspectorFileModel(BaseModel):
    name: str
    path: str
    kind: str
    size_bytes: int
    modified_at: datetime | None = None
    content: str
    truncated: bool = False


class AgentInspectorResponse(BaseModel):
    agent_name: str
    role_label_ko: str
    department_label_ko: str
    description: str
    short_description: str | None = None
    one_click_prompt: str | None = None
    skill_name: str | None = None
    skill_path: str | None = None
    agent_toml_path: str | None = None
    agent_json_path: str | None = None
    skill_markdown: AgentInspectorFileModel | None = None
    agent_toml: AgentInspectorFileModel | None = None
    agent_json: AgentInspectorFileModel | None = None
    references: list[AgentInspectorFileModel]
    scripts: list[AgentInspectorFileModel]


class SkillAgentBackupResponse(BaseModel):
    backup_path: str
    backup_file_name: str
    included_roots: list[str]
    deleted_entry_count: int
    created_at: datetime
    size_bytes: int


class SkillAgentRestoreResponse(BaseModel):
    restored_from_path: str
    restored_roots: list[str]
    restored_member_count: int
    deleted_entry_count_before_restore: int
    restored_at: datetime


class UiOptionModel(BaseModel):
    value: str
    label: str


class WorkflowAgentIconModel(BaseModel):
    key: str
    label: str
    keywords: list[str]


class WorkflowUiConfigResponse(BaseModel):
    sandbox_modes: list[UiOptionModel]
    approval_policies: list[UiOptionModel]
    workflow_step_statuses: list[UiOptionModel]
    agent_icons: list[WorkflowAgentIconModel]
    recommendation_max_agents: int


class WorkflowRecommendedAgentModel(BaseModel):
    agent_name: str
    skill_name: str | None = None
    role_label_ko: str
    department_label_ko: str
    icon_key: str
    reason: str
    default_prompt: str
    short_description: str | None = None


class WorkflowRecommendRequest(BaseModel):
    goal_prompt: str
    max_agents: int | None = None


class WorkflowRecommendResponse(BaseModel):
    goal: str
    recommended_agents: list[WorkflowRecommendedAgentModel]


class WorkflowStepInputModel(BaseModel):
    agent_name: str
    prompt: str
    title: str | None = None
    icon_key: str | None = None
    skill_name: str | None = None


class WorkflowRunCreateRequest(BaseModel):
    goal_prompt: str
    steps: list[WorkflowStepInputModel]
    workspace_root: str | None = None
    sandbox_mode: SandboxMode | None = None
    approval_policy: ApprovalPolicy | None = None


class WorkflowStepActionRequest(BaseModel):
    step_index: int
    follow_up_note: str | None = None


class WorkflowStepRunModel(BaseModel):
    step_index: int
    agent_name: str
    skill_name: str | None = None
    icon_key: str
    title: str
    prompt: str
    status: WorkflowStepStatus
    run_id: str | None = None
    reason: str | None = None
    summary: str | None = None
    last_event_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    exit_code: int | None = None
    error_message: str | None = None


class WorkflowRunSummaryModel(BaseModel):
    workflow_run_id: str
    goal_prompt_preview: str
    workspace_root: str
    status: WorkflowRunStatus
    current_step_index: int | None = None
    total_steps: int
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None


class WorkflowRunDetailModel(BaseModel):
    workflow_run_id: str
    goal_prompt: str
    workspace_root: str
    sandbox_mode: SandboxMode | None = None
    approval_policy: ApprovalPolicy | None = None
    status: WorkflowRunStatus
    current_step_index: int | None = None
    total_steps: int
    steps: list[WorkflowStepRunModel]
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None


class WorkflowRunsResponse(BaseModel):
    runs: list[WorkflowRunSummaryModel]


class WorkflowEventModel(BaseModel):
    event_id: int
    workflow_run_id: str
    step_index: int | None = None
    event_type: str
    message: str
    created_at: datetime


class WorkflowEventsResponse(BaseModel):
    events: list[WorkflowEventModel]
