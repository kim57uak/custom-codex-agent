from __future__ import annotations

from dataclasses import dataclass
from app.config import SETTINGS


@dataclass(frozen=True)
class WorkflowIconRule:
    key: str
    label: str
    keywords: tuple[str, ...]


WORKFLOW_SANDBOX_OPTIONS: tuple[tuple[str, str], ...] = (
    ("workspace-write", "workspace-write"),
    ("read-only", "read-only"),
    ("danger-full-access", "danger-full-access"),
)

WORKFLOW_APPROVAL_OPTIONS: tuple[tuple[str, str], ...] = (
    ("on-request", "on-request"),
    ("untrusted", "untrusted"),
    ("never", "never"),
)

WORKFLOW_STEP_STATUS_OPTIONS: tuple[tuple[str, str], ...] = (
    ("recommended", "추천됨"),
    ("ready", "준비 완료"),
    ("queued", "대기"),
    ("running", "실행 중"),
    ("approval_required", "승인 대기"),
    ("completed", "완료"),
    ("failed", "실패"),
    ("canceled", "중단됨"),
    ("skipped", "건너뜀"),
)

WORKFLOW_ICON_RULES: tuple[WorkflowIconRule, ...] = (
    WorkflowIconRule(key="shield", label="보안", keywords=("security", "auth", "springboot-security")),
    WorkflowIconRule(key="check-circle", label="검증", keywords=("review", "qa", "verification", "test")),
    WorkflowIconRule(key="file-text", label="문서", keywords=("docs", "openai-docs", "research")),
    WorkflowIconRule(key="database", label="데이터", keywords=("database", "sql", "data", "rag")),
    WorkflowIconRule(key="layout", label="UI", keywords=("frontend", "ui", "design", "figma")),
    WorkflowIconRule(key="server", label="백엔드", keywords=("backend", "api", "server", "springboot")),
    WorkflowIconRule(key="play-square", label="자동화", keywords=("automation", "workflow", "runner")),
    WorkflowIconRule(key="folder", label="파일", keywords=("files", "filesystem", "storage")),
    WorkflowIconRule(key="table", label="스프레드시트", keywords=("excel", "sheet", "csv")),
    WorkflowIconRule(key="presentation", label="프레젠테이션", keywords=("ppt", "slides", "presentation")),
)

# Constants now refer to SETTINGS
DEFAULT_WORKFLOW_ICON_KEY = SETTINGS.default_workflow_icon_key
DEFAULT_WORKFLOW_RECOMMENDATION_MAX_AGENTS = SETTINGS.workflow_recommendation_max_agents
DEFAULT_WORKFLOW_STEP_TITLE_PREFIX = SETTINGS.default_workflow_step_title_prefix
WORKFLOW_STEP_SUMMARY_MAX_CHARS = SETTINGS.workflow_step_summary_max_chars
WORKFLOW_GOAL_PREVIEW_MAX_CHARS = SETTINGS.workflow_goal_preview_max_chars


def resolve_workflow_icon_key(*values: str | None) -> str:
    """
    summary: 에이전트/스킬 메타데이터를 기준으로 워크플로 아이콘 키를 결정한다.
    purpose/context: 프런트엔드가 동일한 규칙으로 카드 아이콘을 렌더링할 수 있게 서버 쪽 기준을 통일한다.
    input: 스킬명, 에이전트명, 설명처럼 검색 가능한 문자열 목록을 받는다.
    output: 허용된 icon key 문자열을 반환한다.
    rules/constraints: 가장 구체적인 규칙부터 순서대로 검사하고, 매칭이 없으면 기본 아이콘을 사용한다.
    failure behavior: 입력값이 비어 있거나 예상치 못한 타입이어도 기본 아이콘으로 안전하게 폴백한다.
    """

    haystack = " ".join(str(value or "").strip().lower() for value in values if value)
    if not haystack:
        return DEFAULT_WORKFLOW_ICON_KEY
    for rule in WORKFLOW_ICON_RULES:
        if any(keyword in haystack for keyword in rule.keywords):
            return rule.key
    return DEFAULT_WORKFLOW_ICON_KEY
