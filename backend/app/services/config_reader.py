from __future__ import annotations

import json
import sqlite3
import tomllib
from datetime import datetime, timezone
from pathlib import Path

from app.config import AppSettings


class CodexConfigReader:
    """
    summary: Codex/Gemini 전역 설정과 상태 저장소를 읽는다.
    purpose/context: API 응답이 실제 로컬 설정을 기반으로 동작하도록 파일과 SQLite 조회를 캡슐화한다.
    input: Codex 홈 경로와 각 파일/DB 위치를 담은 설정 객체를 받는다.
    output: skills, agents, router config, enabled skill, 최근 thread/log 정보를 위한 raw 데이터를 반환한다.
    rules/constraints: 엔진 타입에 따라 스캔 경로를 동적으로 전환한다.
    failure behavior: 손상 파일이나 접근 불가 경로는 예외를 삼키지 않고 빈 구조로 축소해 서비스 지속성을 유지한다.
    """

    def __init__(self, settings: AppSettings) -> None:
        self._settings = settings

    def _get_engine_roots(self, engine: str | None) -> tuple[Path, Path]:
        """
        summary: 엔진 타입에 맞춰 스킬과 에이전트의 루트 경로를 동적으로 결정한다.
        rationale: 하드코딩된 경로 대신 AppSettings에서 제공하는 엔진별 경로를 사용하여 유연성을 확보함.
        """
        return self._settings.get_skills_root(engine), self._settings.get_agents_root(engine)

    def read_skills(self, engine: str | None = None) -> list[dict[str, str]]:
        skills_root, _ = self._get_engine_roots(engine)
        if not skills_root.exists():
            return []
        skills: list[dict[str, str]] = []
        for skill_dir in sorted(path for path in skills_root.iterdir() if path.is_dir()):
            skill_file = skill_dir / "SKILL.md"
            if skill_file.exists():
                skills.append({"name": skill_dir.name, "path": str(skill_file)})
        return skills

    def read_agents(self, engine: str | None = None) -> list[dict[str, object]]:
        _, agents_root = self._get_engine_roots(engine)
        if not agents_root.exists():
            return []
        agents: list[dict[str, object]] = []
        for agent_dir in sorted(path for path in agents_root.iterdir() if path.is_dir()):
            config_file = agent_dir / "config.json"
            toml_file = agent_dir / "agent.toml"
            if not config_file.exists() and not toml_file.exists():
                continue
            try:
                if toml_file.exists():
                    parsed = tomllib.loads(toml_file.read_text(encoding="utf-8"))
                else:
                    parsed = json.loads(config_file.read_text(encoding="utf-8"))
                if not isinstance(parsed, dict):
                    raise ValueError("invalid agent config payload")
                if not parsed.get("name"):
                    parsed["name"] = agent_dir.name
                agents.append(parsed)
            except (json.JSONDecodeError, tomllib.TOMLDecodeError, OSError, ValueError):
                agents.append(
                    {
                        "name": agent_dir.name,
                        "description": "손상된 설정 파일",
                        "routing_type": "unknown",
                        "skill_name": None,
                        "skill_path": None,
                        "broken": True,
                    }
                )
        return agents

    def read_router_config(self, engine: str | None = None) -> dict[str, object]:
        _, agents_root = self._get_engine_roots(engine)
        router_path = agents_root / "router-agent" / "config.json"
        if not router_path.exists():
            return {}
        try:
            return json.loads(router_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

    def read_enabled_skill_paths(self) -> set[str]:
        # enabled 설정은 현재 전역 config.toml(Codex 기준)을 따르거나 추후 분리 가능
        config_path = self._settings.config_toml_path
        if not config_path.exists():
            return set()
        try:
            parsed = tomllib.loads(config_path.read_text(encoding="utf-8"))
        except (tomllib.TOMLDecodeError, OSError):
            return set()
        enabled_paths: set[str] = set()
        skills_section = parsed.get("skills", {})
        config_items = skills_section.get("config", []) if isinstance(skills_section, dict) else []
        if not isinstance(config_items, list):
            return set()
        for item in config_items:
            if not isinstance(item, dict):
                continue
            if item.get("enabled") and item.get("path"):
                enabled_paths.add(str(item["path"]))
        return enabled_paths

    def read_recent_threads(self, limit: int = 10, engine: str | None = None) -> list[dict[str, object]]:
        query = """
        select id, title, updated_at, agent_role, agent_nickname
        from threads
        order by updated_at desc
        limit ?
        """
        return self._read_sqlite_rows(self._settings.get_state_db_path(engine), query, (limit,))

    def read_threads_since(self, unix_ts: int, engine: str | None = None) -> list[dict[str, object]]:
        query = """
        select id, title, updated_at, agent_role, agent_nickname
        from threads
        where updated_at >= ?
        order by updated_at desc
        """
        return self._read_sqlite_rows(self._settings.get_state_db_path(engine), query, (unix_ts,))

    def read_recent_logs(self, limit: int = 20, engine: str | None = None) -> list[dict[str, object]]:
        query = """
        select ts, level, target, feedback_log_body
        from logs
        order by ts desc, ts_nanos desc, id desc
        limit ?
        """
        return self._read_sqlite_rows(self._settings.get_log_db_path(engine), query, (limit,))

    def read_logs_since(self, unix_ts: int, engine: str | None = None) -> list[dict[str, object]]:
        query = """
        select ts, level, target, feedback_log_body
        from logs
        where ts >= ?
        order by ts desc, ts_nanos desc, id desc
        """
        return self._read_sqlite_rows(self._settings.get_log_db_path(engine), query, (unix_ts,))

    def read_recent_history(self, limit: int = 20, engine: str | None = None) -> list[dict[str, object]]:
        history_path = self._settings.get_history_file_path(engine)
        if not history_path.exists():
            return []
        lines = history_path.read_text(encoding="utf-8").splitlines()[-limit:]
        items: list[dict[str, object]] = []
        for line in lines:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            record["timestamp"] = datetime.fromtimestamp(record.get("ts", 0), tz=timezone.utc)
            items.append(record)
        return list(reversed(items))

    def read_history_since(self, unix_ts: int, engine: str | None = None) -> list[dict[str, object]]:
        history_path = self._settings.get_history_file_path(engine)
        if not history_path.exists():
            return []
        items: list[dict[str, object]] = []
        for line in history_path.read_text(encoding="utf-8").splitlines():
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts = int(record.get("ts") or 0)
            if ts < unix_ts:
                continue
            record["timestamp"] = datetime.fromtimestamp(ts, tz=timezone.utc)
            items.append(record)
        return items

    def read_history(self, engine: str | None = None) -> list[dict[str, object]]:
        history_path = self._settings.get_history_file_path(engine)
        if not history_path.exists():
            return []
        items: list[dict[str, object]] = []
        for line in history_path.read_text(encoding="utf-8").splitlines():
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            record["timestamp"] = datetime.fromtimestamp(record.get("ts", 0), tz=timezone.utc)
            items.append(record)
        return items

    def get_scan_timestamp(self) -> datetime:
        return datetime.now(tz=timezone.utc)

    @staticmethod
    def _read_sqlite_rows(db_path: Path, query: str, params: tuple[object, ...]) -> list[dict[str, object]]:
        if not db_path.exists():
            return []
        connection = sqlite3.connect(str(db_path))
        connection.row_factory = sqlite3.Row
        try:
            rows = connection.execute(query, params).fetchall()
            return [dict(row) for row in rows]
        except sqlite3.DatabaseError:
            return []
        finally:
            connection.close()
