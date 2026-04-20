from __future__ import annotations

import json
import sqlite3
import tomllib
from datetime import datetime, timezone
from pathlib import Path

from app.config import AppSettings


class CodexConfigReader:
    """
    summary: Codex 전역 설정과 상태 저장소를 읽는다.
    purpose/context: API 응답이 실제 로컬 설정을 기반으로 동작하도록 파일과 SQLite 조회를 캡슐화한다.
    input: Codex 홈 경로와 각 파일/DB 위치를 담은 설정 객체를 받는다.
    output: skills, agents, router config, enabled skill, 최근 thread/log 정보를 위한 raw 데이터를 반환한다.
    rules/constraints: 파일 부재나 SQLite 오류는 상위 서비스가 처리할 수 있게 빈 값 중심으로 반환한다.
    failure behavior: 손상 파일이나 접근 불가 경로는 예외를 삼키지 않고 빈 구조로 축소해 서비스 지속성을 유지한다.
    """

    def __init__(self, settings: AppSettings) -> None:
        self._settings = settings

    def read_skills(self) -> list[dict[str, str]]:
        skills_root = self._settings.skills_root
        if not skills_root.exists():
            return []
        skills: list[dict[str, str]] = []
        for skill_dir in sorted(path for path in skills_root.iterdir() if path.is_dir()):
            skill_file = skill_dir / "SKILL.md"
            if skill_file.exists():
                skills.append({"name": skill_dir.name, "path": str(skill_file)})
        return skills

    def read_agents(self) -> list[dict[str, object]]:
        agents_root = self._settings.agents_root
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

    def read_router_config(self) -> dict[str, object]:
        router_path = self._settings.agents_root / "router-agent" / "config.json"
        if not router_path.exists():
            return {}
        try:
            return json.loads(router_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

    def read_enabled_skill_paths(self) -> set[str]:
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

    def read_recent_threads(self, limit: int = 10) -> list[dict[str, object]]:
        query = """
        select id, title, updated_at, agent_role, agent_nickname
        from threads
        order by updated_at desc
        limit ?
        """
        return self._read_sqlite_rows(self._settings.state_db_path, query, (limit,))

    def read_recent_logs(self, limit: int = 20) -> list[dict[str, object]]:
        query = """
        select ts, level, target, feedback_log_body
        from logs
        order by ts desc, ts_nanos desc, id desc
        limit ?
        """
        return self._read_sqlite_rows(self._settings.log_db_path, query, (limit,))

    def read_recent_history(self, limit: int = 20) -> list[dict[str, object]]:
        history_path = self._settings.history_file_path
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
