from __future__ import annotations

import os
from pathlib import Path
from pydantic import BaseModel, Field

DEFAULT_PROJECT_ROOT = Path(__file__).resolve().parents[4]
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
    workspace_root: Path = Field(default=DEFAULT_PROJECT_ROOT)
    founder_name: str = Field(default="대표이사")
    workflow_recommendation_max_agents: int = Field(default=6)

    @property
    def history_file_path(self) -> Path:
        return self.codex_home / self.history_file_name

    @property
    def state_db_path(self) -> Path:
        return self.codex_home / self.state_db_name

    @property
    def log_db_path(self) -> Path:
        return self.codex_home / self.log_db_name

    @property
    def skills_root(self) -> Path:
        return self.codex_home / "skills"

    @property
    def agents_root(self) -> Path:
        return self.codex_home / "agents"

    @property
    def config_toml_path(self) -> Path:
        return self.codex_home / "config.toml"

    @property
    def run_db_path(self) -> Path:
        return self.codex_home / self.run_db_name


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
    workspace_root=_parse_path(os.getenv("CUSTOM_CODEX_AGENT_WORKSPACE_ROOT"), DEFAULT_PROJECT_ROOT),
    founder_name=os.getenv("CUSTOM_CODEX_AGENT_FOUNDER_NAME", "대표이사"),
    workflow_recommendation_max_agents=_parse_int_env(os.getenv("CUSTOM_CODEX_AGENT_WORKFLOW_RECOMMENDATION_MAX_AGENTS"), 6, min_value=1, max_value=12),
)
