from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


def _utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _to_unix_seconds(value: datetime | None) -> int | None:
    if value is None:
        return None
    return int(value.timestamp())


def _from_unix_seconds(value: object) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    agent_name: str
    workspace_root: str
    prompt: str
    status: str
    engine: str
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    exit_code: int | None
    error_message: str | None


@dataclass(frozen=True)
class RunEventRecord:
    event_id: int
    run_id: str
    event_type: str
    message: str
    created_at: datetime


class RunStore:
    """
    summary: 에이전트 실행(run) 메타데이터와 이벤트 로그를 SQLite에 저장한다.
    purpose/context: 실행 이력 조회, 상태 전이 관리, 디버깅 가능한 이벤트 추적을 보장한다.
    input: SQLite 파일 경로를 받아 스키마를 자동 초기화한다.
    output: run 생성/갱신/조회 및 run_event append/list 기능을 제공한다.
    rules/constraints: 모든 상태 변경은 영속 계층을 통해 기록하고, run_id를 기준으로 일관되게 조회한다.
    failure behavior: DB 파일 접근 불가 또는 쿼리 실패 시 예외를 상위 서비스로 전달해 API가 오류를 명시적으로 반환한다.
    """

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(str(self._db_path))
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _init_schema(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                create table if not exists runs (
                    run_id text primary key,
                    agent_name text not null,
                    workspace_root text not null,
                    prompt text not null,
                    status text not null,
                    created_at integer not null,
                    started_at integer null,
                    completed_at integer null,
                    exit_code integer null,
                    error_message text null
                );

                create table if not exists run_events (
                    event_id integer primary key autoincrement,
                    run_id text not null,
                    event_type text not null,
                    message text not null,
                    created_at integer not null,
                    foreign key (run_id) references runs(run_id)
                );

                create index if not exists idx_runs_created_at on runs(created_at desc);
                create index if not exists idx_run_events_run_created on run_events(run_id, created_at desc);
                """
            )
            try:
                connection.execute("alter table runs add column workspace_root text not null default ''")
            except sqlite3.OperationalError:
                # 이미 컬럼이 존재하는 경우는 마이그레이션 성공으로 간주한다.
                pass
            try:
                connection.execute("alter table runs add column engine text not null default 'codex'")
            except sqlite3.OperationalError:
                # engine 컬럼이 이미 존재하면 무시한다.
                pass

    def create_run(self, run_id: str, agent_name: str, workspace_root: str, prompt: str, engine: str = "codex") -> RunRecord:
        now = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                insert into runs (run_id, agent_name, workspace_root, prompt, status, engine, created_at)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (run_id, agent_name, workspace_root, prompt, "queued", engine, _to_unix_seconds(now)),
            )
        return self.get_run(run_id)

    def mark_running(self, run_id: str) -> RunRecord | None:
        now = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                update runs
                set status = ?, started_at = ?, error_message = null
                where run_id = ? and status = ?
                """,
                ("running", _to_unix_seconds(now), run_id, "queued"),
            )
        return self.get_run(run_id)

    def finish_run(self, run_id: str, *, status: str, exit_code: int | None, error_message: str | None) -> RunRecord | None:
        now = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                update runs
                set status = ?, completed_at = ?, exit_code = ?, error_message = ?
                where run_id = ?
                """,
                (status, _to_unix_seconds(now), exit_code, error_message, run_id),
            )
        return self.get_run(run_id)

    def append_event(self, run_id: str, event_type: str, message: str) -> RunEventRecord:
        now = _utc_now()
        with self._connect() as connection:
            cursor = connection.execute(
                """
                insert into run_events (run_id, event_type, message, created_at)
                values (?, ?, ?, ?)
                """,
                (run_id, event_type, message, _to_unix_seconds(now)),
            )
            event_id = int(cursor.lastrowid)
        return RunEventRecord(event_id=event_id, run_id=run_id, event_type=event_type, message=message, created_at=now)

    def get_run(self, run_id: str) -> RunRecord | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                select run_id, agent_name, workspace_root, prompt, status, engine, created_at, started_at, completed_at, exit_code, error_message
                from runs
                where run_id = ?
                """,
                (run_id,),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_run_record(row)

    def list_runs(self, limit: int = 30) -> list[RunRecord]:
        bounded_limit = max(1, min(limit, 200))
        with self._connect() as connection:
            rows = connection.execute(
                """
                select run_id, agent_name, workspace_root, prompt, status, engine, created_at, started_at, completed_at, exit_code, error_message
                from runs
                order by created_at desc
                limit ?
                """,
                (bounded_limit,),
            ).fetchall()
        return [self._row_to_run_record(row) for row in rows]

    def list_run_events(self, run_id: str, limit: int = 500) -> list[RunEventRecord]:
        bounded_limit = max(1, min(limit, 2000))
        with self._connect() as connection:
            rows = connection.execute(
                """
                select event_id, run_id, event_type, message, created_at
                from run_events
                where run_id = ?
                order by event_id desc
                limit ?
                """,
                (run_id, bounded_limit),
            ).fetchall()
        records = [self._row_to_event_record(row) for row in rows]
        records.reverse()
        return records

    @staticmethod
    def _row_to_run_record(row: sqlite3.Row) -> RunRecord:
        # engine 컬럼은 마이그레이션 전 레코드에서 누락될 수 있으므로 안전하게 조회한다.
        try:
            engine_value = str(row["engine"])
        except (IndexError, KeyError):
            engine_value = "codex"
        return RunRecord(
            run_id=str(row["run_id"]),
            agent_name=str(row["agent_name"]),
            workspace_root=str(row["workspace_root"] or ""),
            prompt=str(row["prompt"]),
            status=str(row["status"]),
            engine=engine_value,
            created_at=_from_unix_seconds(row["created_at"]) or _utc_now(),
            started_at=_from_unix_seconds(row["started_at"]),
            completed_at=_from_unix_seconds(row["completed_at"]),
            exit_code=int(row["exit_code"]) if row["exit_code"] is not None else None,
            error_message=str(row["error_message"]) if row["error_message"] else None,
        )

    @staticmethod
    def _row_to_event_record(row: sqlite3.Row) -> RunEventRecord:
        return RunEventRecord(
            event_id=int(row["event_id"]),
            run_id=str(row["run_id"]),
            event_type=str(row["event_type"]),
            message=str(row["message"]),
            created_at=_from_unix_seconds(row["created_at"]) or _utc_now(),
        )
