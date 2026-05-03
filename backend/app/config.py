from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

EngineType = Literal["codex", "gemini"]

DEFAULT_PROJECT_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_GEMINI_HOME = Path.home() / ".gemini" / "antigravity"
DEFAULT_CODEX_HOME = Path.home() / ".codex"


class AppSettings(BaseModel):
    """
    summary: 애플리케이션 경로와 기본 동작 설정을 보관한다.
    purpose/context: Codex 전역 설정 스캔 경로와 API 공통 설정의 소유권을 한 곳에 둔다.
    input: 환경 변수 대신 코드 레벨 기본값을 사용하되, 운영 경로는 명시적인 상수로 정의한다.
    output: 서버 전반에서 재사용할 수 있는 불변 설정 객체를 반환한다.
    rules/constraints: 비즈니스 경계가 되는 경로 문자열을 핸들러 곳곳에 하드코딩하지 않는다.
    failure behavior: 경로가 실제로 존재하지 않으면 후속 서비스가 진단 응답으로 처리한다.
    """

    codex_home: Path = Field(default=DEFAULT_CODEX_HOME)
    history_file_name: str = Field(default="history.jsonl")
    state_db_name: str = Field(default="state_5.sqlite")
    log_db_name: str = Field(default="logs_2.sqlite")
    refresh_interval_seconds: int = Field(default=5)
    allowed_origins: tuple[str, ...] = Field(
        default=(
            "http://127.0.0.1:8000",
            "http://localhost:8000",
        )
    )
    write_api_token: str | None = Field(default=None)
    run_db_name: str = Field(default="custom_codex_agent_runs.sqlite")
    run_max_concurrency: int = Field(default=2)
    run_timeout_seconds: int = Field(default=1800)
    run_prompt_max_length: int = Field(default=12000)
    codex_cli_executable: str = Field(default="codex")
    codex_cli_subcommand: tuple[str, ...] = Field(default=("exec",))
    gemini_cli_executable: str = Field(default="gemini")
    gemini_home: Path = Field(default=DEFAULT_GEMINI_HOME)
    default_engine: EngineType = Field(default="gemini")
    workspace_root: Path = Field(default=DEFAULT_PROJECT_ROOT)
    founder_name: str = Field(default="대표이사")
    workflow_recommendation_max_agents: int = Field(default=6)
    run_list_limit_default: int = Field(default=30)
    run_list_limit_max: int = Field(default=200)
    run_event_list_limit_default: int = Field(default=500)
    run_event_list_limit_max: int = Field(default=2000)
    workflow_event_list_limit_default: int = Field(default=500)
    workflow_event_list_limit_max: int = Field(default=4000)
    safe_read_text_max_chars: int = Field(default=160000)
    workflow_skill_summary_max_chars: int = Field(default=1200)
    workflow_agent_summary_max_chars: int = Field(default=900)
    workflow_catalog_text_max_chars: int = Field(default=2200)
    workflow_recommendation_timeout_seconds: int = Field(default=20)
    workflow_recommendation_min_score: int = Field(default=6)
    workflow_recommendation_relative_score_ratio: float = Field(default=0.5)
    fallback_run_db_path: Path = Field(default=Path("/tmp/custom_codex_agent_runs.sqlite"))
    default_workflow_icon_key: str = Field(default="bot")
    default_workflow_step_title_prefix: str = Field(default="단계")
    workflow_step_summary_max_chars: int = Field(default=320)
    workflow_goal_preview_max_chars: int = Field(default=140)
    run_prompt_preview_max_chars: int = Field(default=120)
    directory_list_limit: int = Field(default=500)
    default_department_label_ko: str = Field(default="관리지원")
    default_role_label_ko: str = Field(default="관리지원 담당")
    trend_window_days: int = Field(default=7)
    trend_buckets: int = Field(default=12)
    dashboard_recent_threads_limit: int = Field(default=10)
    dashboard_recent_logs_limit: int = Field(default=20)
    dashboard_recent_history_limit: int = Field(default=20)
    backups_root: Path = Field(default=DEFAULT_PROJECT_ROOT / "backups")
    backup_archive_name_suffix: str = Field(default="-skills-agents-backup-")

    @property
    def history_file_path(self) -> Path:
        return self.codex_home / self.history_file_name

    @property
    def state_db_path(self) -> Path:
        return self.codex_home / self.state_db_name

    @property
    def log_db_path(self) -> Path:
        return self.codex_home / self.log_db_name

    def get_history_file_path(self, engine: str | None = None) -> Path:
        target = engine or self.default_engine
        if target == "gemini":
            return self.gemini_home / self.history_file_name
        return self.codex_home / self.history_file_name

    def get_state_db_path(self, engine: str | None = None) -> Path:
        target = engine or self.default_engine
        if target == "gemini":
            return self.gemini_home / self.state_db_name
        return self.codex_home / self.state_db_name

    def get_log_db_path(self, engine: str | None = None) -> Path:
        target = engine or self.default_engine
        if target == "gemini":
            return self.gemini_home / self.log_db_name
        return self.codex_home / self.log_db_name

    @property
    def skills_root(self) -> Path:
        return self.codex_home / "skills"

    @property
    def agents_root(self) -> Path:
        return self.codex_home / "agents"

    @property
    def gemini_skills_root(self) -> Path:
        """summary: Gemini 엔진용 스킬 디렉토리 경로를 반환한다."""
        return self.gemini_home / "skills"

    @property
    def gemini_agents_root(self) -> Path:
        """summary: Gemini 엔진용 에이전트 디렉토리 경로를 반환한다."""
        return self.gemini_home / "agents"

    @property
    def config_toml_path(self) -> Path:
        return self.codex_home / "config.toml"

    @property
    def run_db_path(self) -> Path:
        return self.codex_home / self.run_db_name

    def get_skills_root(self, engine: str | None = None) -> Path:
        """summary: 엔진 타입에 따른 스킬 디렉토리 경로를 반환한다."""
        target = engine or self.default_engine
        return self.gemini_skills_root if target == "gemini" else self.skills_root

    def get_agents_root(self, engine: str | None = None) -> Path:
        """summary: 엔진 타입에 따른 에이전트 디렉토리 경로를 반환한다."""
        target = engine or self.default_engine
        return self.gemini_agents_root if target == "gemini" else self.agents_root

    def get_home(self, engine: str | None = None) -> Path:
        """summary: 엔진 타입에 따른 홈 디렉토리 경로를 반환한다."""
        target = engine or self.default_engine
        return self.gemini_home if target == "gemini" else self.codex_home


def _parse_allowed_origins(raw: str | None) -> tuple[str, ...]:
    if not raw:
        return (
            "http://127.0.0.1:8000",
            "http://localhost:8000",
        )
    parsed = tuple(item.strip() for item in raw.split(",") if item.strip())
    return parsed or ("http://127.0.0.1:8000",)


def _parse_codex_subcommand(raw: str | None) -> tuple[str, ...]:
    if not raw:
        return ("exec",)
    parsed = tuple(item.strip() for item in raw.split(",") if item.strip())
    return parsed or ("exec",)


def _parse_path(raw: str | None, default: Path) -> Path:
    if raw is None or not raw.strip():
        return default
    return Path(raw.strip()).expanduser()


def _parse_optional_token(raw: str | None) -> str | None:
    if raw is None:
        return None
    token = raw.strip()
    return token or None


def _parse_int_env(raw: str | None, default: int, min_value: int | None = None, max_value: int | None = None) -> int:
    if raw is None or not raw.strip():
        value = default
    else:
        try:
            value = int(raw.strip())
        except ValueError:
            value = default
    if min_value is not None:
        value = max(min_value, value)
    if max_value is not None:
        value = min(max_value, value)
    return value


def _parse_engine(raw: str | None) -> EngineType:
    """summary: 환경변수에서 엔진 타입을 파싱하고 유효하지 않으면 기본값 gemini를 반환한다."""
    if raw and raw.strip().lower() in ("codex", "gemini"):
        return raw.strip().lower()  # type: ignore[return-value]
    return "gemini"


SETTINGS = AppSettings(
    codex_home=_parse_path(os.getenv("CUSTOM_CODEX_AGENT_CODEX_HOME"), DEFAULT_CODEX_HOME),
    allowed_origins=_parse_allowed_origins(os.getenv("CUSTOM_CODEX_AGENT_ALLOWED_ORIGINS")),
    write_api_token=_parse_optional_token(os.getenv("CUSTOM_CODEX_AGENT_WRITE_API_TOKEN")),
    run_db_name=os.getenv("CUSTOM_CODEX_AGENT_RUN_DB_NAME", "custom_codex_agent_runs.sqlite"),
    run_max_concurrency=_parse_int_env(os.getenv("CUSTOM_CODEX_AGENT_RUN_MAX_CONCURRENCY"), 2, min_value=1, max_value=16),
    run_timeout_seconds=_parse_int_env(os.getenv("CUSTOM_CODEX_AGENT_RUN_TIMEOUT_SECONDS"), 1800, min_value=30, max_value=86400),
    run_prompt_max_length=_parse_int_env(os.getenv("CUSTOM_CODEX_AGENT_RUN_PROMPT_MAX_LENGTH"), 12000, min_value=100, max_value=100000),
    codex_cli_executable=os.getenv("CUSTOM_CODEX_AGENT_CODEX_CLI_EXECUTABLE", "codex"),
    codex_cli_subcommand=_parse_codex_subcommand(os.getenv("CUSTOM_CODEX_AGENT_CODEX_CLI_SUBCOMMAND")),
    gemini_cli_executable=os.getenv("CUSTOM_CODEX_AGENT_GEMINI_CLI_EXECUTABLE", "gemini"),
    gemini_home=_parse_path(os.getenv("CUSTOM_CODEX_AGENT_GEMINI_HOME"), DEFAULT_GEMINI_HOME),
    default_engine=_parse_engine(os.getenv("CUSTOM_CODEX_AGENT_DEFAULT_ENGINE")),
    workspace_root=_parse_path(os.getenv("CUSTOM_CODEX_AGENT_WORKSPACE_ROOT"), DEFAULT_PROJECT_ROOT),
    founder_name=os.getenv("CUSTOM_CODEX_AGENT_FOUNDER_NAME", "대표이사"),
    workflow_recommendation_max_agents=_parse_int_env(os.getenv("CUSTOM_CODEX_AGENT_WORKFLOW_RECOMMENDATION_MAX_AGENTS"), 6, min_value=1, max_value=12),
)
