from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# 명시적인 리터럴 타입을 사용하여 상태 전이 및 구성의 유효성을 보장함
NodeType = Literal["department", "agent", "skill", "router", "keyword", "founder"]
HealthStatus = Literal["healthy", "partial", "broken", "passive"]
RunStatus = Literal["queued", "running", "completed", "failed", "canceled"]
SandboxMode = Literal["read-only", "workspace-write", "danger-full-access"]
ApprovalPolicy = Literal["untrusted", "on-request", "never"]
EngineType = Literal["codex", "gemini"]
WorkflowRunStatus = Literal["draft", "queued", "running", "completed", "failed", "canceled"]
WorkflowStepStatus = Literal["recommended", "ready", "queued", "running", "approval_required", "completed", "failed", "canceled", "skipped"]


class SkillModel(BaseModel):
    """
    Codex 시스템에 등록된 개별 스킬의 메타데이터 모델.
    설치 여부와 활성화 상태를 관리하여 에이전트가 사용 가능한 기능을 필터링하는 데 사용됨.
    """
    name: str
    path: str
    installed: bool
    enabled: bool


class AgentModel(BaseModel):
    """
    에이전트의 역할, 소속, 설명 및 매핑된 스킬 정보를 담는 모델.
    UI에서 조직도 및 에이전트 인벤토리를 렌더링하는 핵심 데이터 소스임.
    """
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
    """라우터 에이전트가 특정 키워드에 따라 어떤 전문 에이전트로 연결되는지 정의함."""
    keyword: str
    agent_name: str


class GraphNodeModel(BaseModel):
    """Cytoscape.js 등 그래프 라이브러리 시각화를 위한 노드 데이터 모델."""
    id: str
    type: NodeType
    label: str
    sublabel: str | None = None
    status: HealthStatus = "healthy"
    metadata: dict[str, str] = Field(default_factory=dict)


class GraphEdgeModel(BaseModel):
    """그래프 시각화에서 노드 간의 연결 관계(Edge)를 정의함."""
    id: str
    source: str
    target: str
    label: str | None = None


class DashboardMetricModel(BaseModel):
    """대시보드 상단의 통계 지표 및 트렌드 데이터를 위한 모델."""
    key: str
    label: str
    value: int
    trend_values: list[int] = Field(default_factory=list)


class ActivityItemModel(BaseModel):
    """최근 활동 로그(에이전트 실행, 스킬 추가 등)를 UI에 표시하기 위한 범용 모델."""
    title: str
    subtitle: str
    timestamp: datetime | None = None


class OverviewModel(BaseModel):
    """시스템 전체 현황(에이전트 수, 활성 쓰레드 등)을 요약하여 제공함."""
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
    """사용자가 직접 실행 버튼을 누를 수 있는 에이전트 정보를 UI 최적화된 형태로 제공함."""
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
    """단일 에이전트 실행 요청을 위한 파라미터 셋."""
    agent_name: str
    prompt: str
    workspace_root: str | None = None
    sandbox_mode: SandboxMode | None = None
    approval_policy: ApprovalPolicy | None = None
    engine: EngineType | None = None


class RunSummaryModel(BaseModel):
    """실행 목록 조회 시 사용하는 경량화된 Run 정보 모델."""
    run_id: str
    agent_name: str
    workspace_root: str
    status: RunStatus
    prompt_preview: str
    engine: str = "gemini"
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    exit_code: int | None = None
    error_message: str | None = None


class RunDetailModel(BaseModel):
    """특정 Run의 상세 상태 및 전체 프롬프트를 포함하는 모델."""
    run_id: str
    agent_name: str
    workspace_root: str
    prompt: str
    status: RunStatus
    engine: str = "gemini"
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    exit_code: int | None = None
    error_message: str | None = None

class RunRetryRequest(BaseModel):
    engine: str | None = None


class RunEventModel(BaseModel):
    """실행 중 발생하는 개별 이벤트(stdout, stderr, 상태 변경 등)를 기록함."""
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
    """UI에서 실행 폼 구성을 위해 필요한 서버 설정 정보."""
    default_workspace_root: str
    write_api_enabled: bool
    default_write_api_token: str | None = None
    available_engines: list[str] = Field(default_factory=lambda: ["gemini", "codex"])
    default_engine: str = "gemini"


class DirectoryItemModel(BaseModel):
    name: str
    path: str


class DirectoryBrowseResponse(BaseModel):
    """서버 측 파일 시스템 탐색 결과를 반환함."""
    current_path: str
    parent_path: str | None = None
    directories: list[DirectoryItemModel]


class AgentInspectorFileModel(BaseModel):
    """에이전트 관련 파일(TOML, JSON, MD)의 내용과 메타데이터."""
    name: str
    path: str
    kind: str
    size_bytes: int
    modified_at: datetime | None = None
    content: str
    truncated: bool = False


class AgentInspectorResponse(BaseModel):
    """에이전트 설정을 검사하고 편집하기 위해 필요한 모든 파일 데이터를 집계함."""
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


class AgentInspectorFileSaveRequest(BaseModel):
    path: str
    content: str
    engine: str | None = None


class AgentInspectorFileSaveResponse(BaseModel):
    status: str
    file: AgentInspectorFileModel


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
    """UI 드롭다운 등 선택 옵션을 위한 범용 키-값 쌍 모델."""
    value: str
    label: str


class WorkflowAgentIconModel(BaseModel):
    """워크플로 단계별 에이전트 아이콘 매핑 정보."""
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
    """작업 목표에 따라 추천된 단일 에이전트와 추천 사유."""
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
    """워크플로를 구성하는 개별 단계의 입력 값."""
    agent_name: str
    prompt: str
    title: str | None = None
    icon_key: str | None = None
    skill_name: str | None = None


class WorkflowRunCreateRequest(BaseModel):
    """다단계 워크플로 실행 생성을 위한 요청 파라미터."""
    goal_prompt: str
    steps: list[WorkflowStepInputModel]
    workspace_root: str | None = None
    sandbox_mode: SandboxMode | None = None
    approval_policy: ApprovalPolicy | None = None


class WorkflowStepActionRequest(BaseModel):
    """실행 중인 워크플로 단계에 대한 제어 요청(재시도, 건너뛰기 등)."""
    step_index: int
    follow_up_note: str | None = None
    engine: str | None = None


class WorkflowStepRunModel(BaseModel):
    """워크플로 내 개별 단계의 실행 상태와 결과 요약."""
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
    """워크플로 목록 조회 시 사용하는 요약 데이터 모델."""
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
    """워크플로 전체 진행 상태와 모든 단계의 상세 정보를 포함함."""
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
    """워크플로 수준에서 발생하는 주요 이벤트(단계 시작/종료 등)."""
    event_id: int
    workflow_run_id: str
    step_index: int | None = None
    event_type: str
    message: str
    created_at: datetime


class WorkflowEventsResponse(BaseModel):
    events: list[WorkflowEventModel]
