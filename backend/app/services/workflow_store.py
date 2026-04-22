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
class WorkflowRunRecord:
    workflow_run_id: str
    goal_prompt: str
    workspace_root: str
    sandbox_mode: str | None
    approval_policy: str | None
    status: str
    current_step_index: int | None
    total_steps: int
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    error_message: str | None


@dataclass(frozen=True)
class WorkflowStepRecord:
    workflow_run_id: str
    step_index: int
    agent_name: str
    skill_name: str | None
    icon_key: str
    title: str
    prompt: str
    status: str
    run_id: str | None
    reason: str | None
    summary: str | None
    last_event_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    exit_code: int | None
    error_message: str | None


@dataclass(frozen=True)
class WorkflowEventRecord:
    event_id: int
    workflow_run_id: str
    step_index: int | None
    event_type: str
    message: str
    created_at: datetime


class WorkflowStore:
    """
    summary: 워크플로 run, 단계 상태, 이벤트 로그를 SQLite에 저장한다.
    purpose/context: 멀티 에이전트 순차 실행의 진행 상황과 상세 진단 이력을 재조회 가능한 형태로 유지한다.
    input: SQLite 파일 경로를 받아 필요한 워크플로 스키마를 초기화한다.
    output: workflow run/step/event 생성, 상태 전이, 조회 기능을 제공한다.
    rules/constraints: 단계 상태와 워크플로 상태는 저장소를 통해 일관되게 변경하고, step_index를 기준으로 정렬 조회한다.
    failure behavior: DB 접근 실패 시 예외를 상위 오케스트레이터/API로 전달해 실패를 명시적으로 처리한다.
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
                create table if not exists workflow_runs (
                    workflow_run_id text primary key,
                    goal_prompt text not null,
                    workspace_root text not null,
                    sandbox_mode text null,
                    approval_policy text null,
                    status text not null,
                    current_step_index integer null,
                    total_steps integer not null,
                    created_at integer not null,
                    started_at integer null,
                    completed_at integer null,
                    error_message text null
                );

                create table if not exists workflow_steps (
                    workflow_run_id text not null,
                    step_index integer not null,
                    agent_name text not null,
                    skill_name text null,
                    icon_key text not null,
                    title text not null,
                    prompt text not null,
                    status text not null,
                    run_id text null,
                    reason text null,
                    summary text null,
                    last_event_message text null,
                    started_at integer null,
                    completed_at integer null,
                    exit_code integer null,
                    error_message text null,
                    primary key (workflow_run_id, step_index),
                    foreign key (workflow_run_id) references workflow_runs(workflow_run_id)
                );

                create table if not exists workflow_events (
                    event_id integer primary key autoincrement,
                    workflow_run_id text not null,
                    step_index integer null,
                    event_type text not null,
                    message text not null,
                    created_at integer not null,
                    foreign key (workflow_run_id) references workflow_runs(workflow_run_id)
                );

                create index if not exists idx_workflow_runs_created_at on workflow_runs(created_at desc);
                create index if not exists idx_workflow_steps_run on workflow_steps(workflow_run_id, step_index asc);
                create index if not exists idx_workflow_events_run_created on workflow_events(workflow_run_id, event_id desc);
                """
            )

    def create_workflow_run(
        self,
        workflow_run_id: str,
        goal_prompt: str,
        workspace_root: str,
        sandbox_mode: str | None,
        approval_policy: str | None,
        steps: list[dict[str, str | None]],
    ) -> WorkflowRunRecord:
        now = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                insert into workflow_runs (
                    workflow_run_id, goal_prompt, workspace_root, sandbox_mode, approval_policy,
                    status, current_step_index, total_steps, created_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workflow_run_id,
                    goal_prompt,
                    workspace_root,
                    sandbox_mode,
                    approval_policy,
                    "queued",
                    None,
                    len(steps),
                    _to_unix_seconds(now),
                ),
            )
            connection.executemany(
                """
                insert into workflow_steps (
                    workflow_run_id, step_index, agent_name, skill_name, icon_key, title, prompt, status
                ) values (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        workflow_run_id,
                        int(step["step_index"] or 0),
                        str(step["agent_name"] or ""),
                        step["skill_name"],
                        str(step["icon_key"] or "bot"),
                        str(step["title"] or ""),
                        str(step["prompt"] or ""),
                        "queued",
                    )
                    for step in steps
                ],
            )
        return self.get_workflow_run(workflow_run_id)  # type: ignore[return-value]

    def mark_workflow_running(self, workflow_run_id: str) -> WorkflowRunRecord | None:
        now = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                update workflow_runs
                set status = ?, started_at = ?, error_message = null
                where workflow_run_id = ? and status = ?
                """,
                ("running", _to_unix_seconds(now), workflow_run_id, "queued"),
            )
        return self.get_workflow_run(workflow_run_id)

    def update_workflow_current_step(self, workflow_run_id: str, step_index: int | None) -> WorkflowRunRecord | None:
        with self._connect() as connection:
            connection.execute(
                """
                update workflow_runs
                set current_step_index = ?
                where workflow_run_id = ?
                """,
                (step_index, workflow_run_id),
            )
        return self.get_workflow_run(workflow_run_id)

    def finish_workflow_run(self, workflow_run_id: str, *, status: str, error_message: str | None) -> WorkflowRunRecord | None:
        now = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                update workflow_runs
                set status = ?, completed_at = ?, error_message = ?
                where workflow_run_id = ?
                """,
                (status, _to_unix_seconds(now), error_message, workflow_run_id),
            )
        return self.get_workflow_run(workflow_run_id)

    def update_step_status(
        self,
        workflow_run_id: str,
        step_index: int,
        *,
        status: str,
        run_id: str | None = None,
        reason: str | None = None,
        summary: str | None = None,
        last_event_message: str | None = None,
        exit_code: int | None = None,
        error_message: str | None = None,
        mark_started: bool = False,
        mark_completed: bool = False,
    ) -> WorkflowStepRecord | None:
        now = _utc_now()
        started_at_value = _to_unix_seconds(now) if mark_started else None
        completed_at_value = _to_unix_seconds(now) if mark_completed else None
        with self._connect() as connection:
            connection.execute(
                """
                update workflow_steps
                set status = ?,
                    run_id = coalesce(?, run_id),
                    reason = coalesce(?, reason),
                    summary = coalesce(?, summary),
                    last_event_message = coalesce(?, last_event_message),
                    exit_code = coalesce(?, exit_code),
                    error_message = ?,
                    started_at = case when ? is not null then ? else started_at end,
                    completed_at = case when ? is not null then ? else completed_at end
                where workflow_run_id = ? and step_index = ?
                """,
                (
                    status,
                    run_id,
                    reason,
                    summary,
                    last_event_message,
                    exit_code,
                    error_message,
                    started_at_value,
                    started_at_value,
                    completed_at_value,
                    completed_at_value,
                    workflow_run_id,
                    step_index,
                ),
            )
        return self.get_workflow_step(workflow_run_id, step_index)

    def append_event(
        self,
        workflow_run_id: str,
        event_type: str,
        message: str,
        step_index: int | None = None,
    ) -> WorkflowEventRecord:
        now = _utc_now()
        with self._connect() as connection:
            cursor = connection.execute(
                """
                insert into workflow_events (workflow_run_id, step_index, event_type, message, created_at)
                values (?, ?, ?, ?, ?)
                """,
                (workflow_run_id, step_index, event_type, message, _to_unix_seconds(now)),
            )
            event_id = int(cursor.lastrowid)
        return WorkflowEventRecord(
            event_id=event_id,
            workflow_run_id=workflow_run_id,
            step_index=step_index,
            event_type=event_type,
            message=message,
            created_at=now,
        )

    def get_workflow_run(self, workflow_run_id: str) -> WorkflowRunRecord | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                select workflow_run_id, goal_prompt, workspace_root, sandbox_mode, approval_policy, status,
                       current_step_index, total_steps, created_at, started_at, completed_at, error_message
                from workflow_runs
                where workflow_run_id = ?
                """,
                (workflow_run_id,),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_workflow_run(row)

    def list_workflow_runs(self, limit: int = 30) -> list[WorkflowRunRecord]:
        bounded_limit = max(1, min(limit, 200))
        with self._connect() as connection:
            rows = connection.execute(
                """
                select workflow_run_id, goal_prompt, workspace_root, sandbox_mode, approval_policy, status,
                       current_step_index, total_steps, created_at, started_at, completed_at, error_message
                from workflow_runs
                order by created_at desc
                limit ?
                """,
                (bounded_limit,),
            ).fetchall()
        return [self._row_to_workflow_run(row) for row in rows]

    def list_workflow_steps(self, workflow_run_id: str) -> list[WorkflowStepRecord]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                select workflow_run_id, step_index, agent_name, skill_name, icon_key, title, prompt,
                       status, run_id, reason, summary, last_event_message, started_at, completed_at, exit_code, error_message
                from workflow_steps
                where workflow_run_id = ?
                order by step_index asc
                """,
                (workflow_run_id,),
            ).fetchall()
        return [self._row_to_workflow_step(row) for row in rows]

    def get_workflow_step(self, workflow_run_id: str, step_index: int) -> WorkflowStepRecord | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                select workflow_run_id, step_index, agent_name, skill_name, icon_key, title, prompt,
                       status, run_id, reason, summary, last_event_message, started_at, completed_at, exit_code, error_message
                from workflow_steps
                where workflow_run_id = ? and step_index = ?
                """,
                (workflow_run_id, step_index),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_workflow_step(row)

    def list_workflow_events(self, workflow_run_id: str, limit: int = 500) -> list[WorkflowEventRecord]:
        bounded_limit = max(1, min(limit, 4000))
        with self._connect() as connection:
            rows = connection.execute(
                """
                select event_id, workflow_run_id, step_index, event_type, message, created_at
                from workflow_events
                where workflow_run_id = ?
                order by event_id desc
                limit ?
                """,
                (workflow_run_id, bounded_limit),
            ).fetchall()
        records = [self._row_to_workflow_event(row) for row in rows]
        records.reverse()
        return records

    @staticmethod
    def _row_to_workflow_run(row: sqlite3.Row) -> WorkflowRunRecord:
        current_step_index = row["current_step_index"]
        return WorkflowRunRecord(
            workflow_run_id=str(row["workflow_run_id"]),
            goal_prompt=str(row["goal_prompt"]),
            workspace_root=str(row["workspace_root"]),
            sandbox_mode=str(row["sandbox_mode"]) if row["sandbox_mode"] else None,
            approval_policy=str(row["approval_policy"]) if row["approval_policy"] else None,
            status=str(row["status"]),
            current_step_index=int(current_step_index) if current_step_index is not None else None,
            total_steps=int(row["total_steps"]),
            created_at=_from_unix_seconds(row["created_at"]) or _utc_now(),
            started_at=_from_unix_seconds(row["started_at"]),
            completed_at=_from_unix_seconds(row["completed_at"]),
            error_message=str(row["error_message"]) if row["error_message"] else None,
        )

    @staticmethod
    def _row_to_workflow_step(row: sqlite3.Row) -> WorkflowStepRecord:
        return WorkflowStepRecord(
            workflow_run_id=str(row["workflow_run_id"]),
            step_index=int(row["step_index"]),
            agent_name=str(row["agent_name"]),
            skill_name=str(row["skill_name"]) if row["skill_name"] else None,
            icon_key=str(row["icon_key"]),
            title=str(row["title"]),
            prompt=str(row["prompt"]),
            status=str(row["status"]),
            run_id=str(row["run_id"]) if row["run_id"] else None,
            reason=str(row["reason"]) if row["reason"] else None,
            summary=str(row["summary"]) if row["summary"] else None,
            last_event_message=str(row["last_event_message"]) if row["last_event_message"] else None,
            started_at=_from_unix_seconds(row["started_at"]),
            completed_at=_from_unix_seconds(row["completed_at"]),
            exit_code=int(row["exit_code"]) if row["exit_code"] is not None else None,
            error_message=str(row["error_message"]) if row["error_message"] else None,
        )

    @staticmethod
    def _row_to_workflow_event(row: sqlite3.Row) -> WorkflowEventRecord:
        step_index = row["step_index"]
        return WorkflowEventRecord(
            event_id=int(row["event_id"]),
            workflow_run_id=str(row["workflow_run_id"]),
            step_index=int(step_index) if step_index is not None else None,
            event_type=str(row["event_type"]),
            message=str(row["message"]),
            created_at=_from_unix_seconds(row["created_at"]) or _utc_now(),
        )
