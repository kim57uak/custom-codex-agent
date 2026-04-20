from __future__ import annotations

import asyncio
from asyncio.subprocess import Process
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from app.config import AppSettings
from app.services.event_stream import EventBroker
from app.services.run_store import RunEventRecord, RunRecord, RunStore


@dataclass(frozen=True)
class RunCreateResult:
    run_id: str
    record: RunRecord


class RunOrchestrator:
    """
    summary: Codex CLI 실행 생명주기를 관리한다.
    purpose/context: API 요청으로 생성된 run을 큐잉하고, 상태 전이/이벤트 발행/취소를 일관되게 수행한다.
    input: 설정(AppSettings), 이벤트 브로커, run 저장소를 주입받아 비동기 subprocess 실행에 사용한다.
    output: run 생성/조회/취소/재시도 기능과 stdout/stderr 스트림 이벤트를 제공한다.
    rules/constraints: 모델/버전 플래그는 주입하지 않고 Codex CLI 기본 선택 상태를 상속한다.
    failure behavior: CLI 실행 실패, 타임아웃, 취소는 run 상태를 failed/canceled로 기록하고 명시적인 이벤트를 발행한다.
    """

    def __init__(self, settings: AppSettings, broker: EventBroker, store: RunStore) -> None:
        self._settings = settings
        self._broker = broker
        self._store = store
        self._semaphore = asyncio.Semaphore(max(1, settings.run_max_concurrency))
        self._run_tasks: dict[str, asyncio.Task[None]] = {}
        self._active_processes: dict[str, Process] = {}

    @property
    def default_workspace_root(self) -> Path:
        return self._settings.workspace_root

    async def create_run(
        self,
        agent_name: str,
        prompt: str,
        workspace_root: Path,
        sandbox_mode: str | None = None,
        approval_policy: str | None = None,
    ) -> RunCreateResult:
        run_id = uuid4().hex
        record = self._store.create_run(
            run_id=run_id,
            agent_name=agent_name,
            workspace_root=str(workspace_root),
            prompt=prompt,
        )
        await self._publish_run_event(run_id, "run:queued", f"run queued for agent={agent_name}")
        task = asyncio.create_task(
            self._execute_run(
                run_id=run_id,
                agent_name=agent_name,
                prompt=prompt,
                workspace_root=workspace_root,
                sandbox_mode=sandbox_mode,
                approval_policy=approval_policy,
            )
        )
        self._run_tasks[run_id] = task
        task.add_done_callback(lambda _done, current_run_id=run_id: self._run_tasks.pop(current_run_id, None))
        return RunCreateResult(run_id=run_id, record=record)

    async def cancel_run(self, run_id: str) -> RunRecord | None:
        record = self._store.get_run(run_id)
        if record is None:
            return None
        if record.status in {"completed", "failed", "canceled"}:
            return record

        task = self._run_tasks.get(run_id)
        process = self._active_processes.get(run_id)

        if process is not None and process.returncode is None:
            process.terminate()
        if task is not None and not task.done():
            task.cancel()

        self._store.append_event(run_id, "run:canceled", "run canceled by user")
        updated = self._store.finish_run(run_id, status="canceled", exit_code=None, error_message="canceled by user")
        await self._broker.publish("run:canceled", {"runId": run_id, "status": "canceled"})
        return updated

    async def retry_run(self, run_id: str) -> RunCreateResult | None:
        record = self._store.get_run(run_id)
        if record is None:
            return None
        workspace_root = self.validate_workspace_root(record.workspace_root or None)
        return await self.create_run(agent_name=record.agent_name, prompt=record.prompt, workspace_root=workspace_root)

    async def _execute_run(
        self,
        run_id: str,
        agent_name: str,
        prompt: str,
        workspace_root: Path,
        sandbox_mode: str | None = None,
        approval_policy: str | None = None,
    ) -> None:
        process: Process | None = None
        try:
            async with self._semaphore:
                updated = self._store.mark_running(run_id)
                if updated is None:
                    return
                await self._publish_run_event(run_id, "run:started", "run started")

                command = self._build_command(
                    sandbox_mode=sandbox_mode,
                    approval_policy=approval_policy,
                )
                process = await asyncio.create_subprocess_exec(
                    *command,
                    cwd=str(workspace_root),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                self._active_processes[run_id] = process
                await self._write_prompt(process, self._build_effective_prompt(agent_name=agent_name, prompt=prompt))

                stdout_task = asyncio.create_task(self._consume_stream(run_id, process.stdout, "run:stdout"))
                stderr_task = asyncio.create_task(self._consume_stream(run_id, process.stderr, "run:stderr"))
                try:
                    await asyncio.wait_for(process.wait(), timeout=self._settings.run_timeout_seconds)
                except TimeoutError:
                    process.terminate()
                    await asyncio.wait_for(process.wait(), timeout=5)
                    self._store.finish_run(run_id, status="failed", exit_code=None, error_message="run timeout")
                    await self._publish_run_event(run_id, "run:failed", "run timeout")
                    return
                finally:
                    await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)

                return_code = process.returncode
                if return_code == 0:
                    self._store.finish_run(run_id, status="completed", exit_code=return_code, error_message=None)
                    await self._publish_run_event(run_id, "run:completed", "run completed")
                else:
                    self._store.finish_run(
                        run_id,
                        status="failed",
                        exit_code=return_code,
                        error_message=f"codex exited with non-zero code: {return_code}",
                    )
                    await self._publish_run_event(run_id, "run:failed", f"codex exited with code={return_code}")
        except FileNotFoundError:
            self._store.finish_run(
                run_id,
                status="failed",
                exit_code=None,
                error_message=f"codex cli not found: {self._settings.codex_cli_executable}",
            )
            await self._publish_run_event(run_id, "run:failed", "codex cli executable not found")
        except asyncio.CancelledError:
            self._store.finish_run(run_id, status="canceled", exit_code=None, error_message="canceled by user")
            await self._publish_run_event(run_id, "run:canceled", "run canceled")
            raise
        except Exception as err:
            self._store.finish_run(run_id, status="failed", exit_code=None, error_message=str(err))
            await self._publish_run_event(run_id, "run:failed", f"unexpected error: {err}")
        finally:
            self._active_processes.pop(run_id, None)

    async def _consume_stream(
        self,
        run_id: str,
        stream: asyncio.StreamReader | None,
        event_type: str,
    ) -> None:
        if stream is None:
            return
        while True:
            line = await stream.readline()
            if not line:
                return
            text = line.decode("utf-8", errors="replace").rstrip("\n")
            if not text:
                continue
            await self._publish_run_event(run_id, event_type, text)

    async def _publish_run_event(self, run_id: str, event_type: str, message: str) -> None:
        event_record = self._store.append_event(run_id, event_type, message)
        payload = {
            "runId": run_id,
            "eventId": event_record.event_id,
            "eventType": event_type,
            "message": message,
            "createdAt": event_record.created_at.isoformat(),
        }
        await self._broker.publish(event_type, payload)

    @staticmethod
    async def _write_prompt(process: Process, prompt: str) -> None:
        if process.stdin is None:
            return
        process.stdin.write(prompt.encode("utf-8"))
        process.stdin.write(b"\n")
        await process.stdin.drain()
        process.stdin.close()

    @staticmethod
    def _build_effective_prompt(agent_name: str, prompt: str) -> str:
        return (
            "You are running from Custom Codex Agent Execution Console.\n"
            f"Selected agent: {agent_name}\n"
            "Follow the selected agent's role and constraints while completing the request.\n\n"
            f"{prompt}"
        )

    def list_runs(self, limit: int = 30) -> list[RunRecord]:
        return self._store.list_runs(limit=limit)

    def get_run(self, run_id: str) -> RunRecord | None:
        return self._store.get_run(run_id)

    def list_run_events(self, run_id: str, limit: int = 500) -> list[RunEventRecord]:
        return self._store.list_run_events(run_id=run_id, limit=limit)

    def validate_prompt(self, prompt: str) -> str:
        cleaned = prompt.strip()
        if not cleaned:
            raise ValueError("prompt must not be empty")
        if len(cleaned) > self._settings.run_prompt_max_length:
            raise ValueError(f"prompt length exceeds max: {self._settings.run_prompt_max_length}")
        return cleaned

    def validate_workspace_root(self, raw_path: str | None) -> Path:
        candidate = (raw_path or "").strip()
        if not candidate:
            return self._settings.workspace_root

        path = Path(candidate).expanduser()
        if not path.is_absolute():
            raise ValueError("workspace_root must be an absolute path")
        if not path.exists() or not path.is_dir():
            raise ValueError("workspace_root must point to an existing directory")
        return path.resolve()

    @staticmethod
    def to_prompt_preview(prompt: str, max_chars: int = 120) -> str:
        compact = " ".join(prompt.strip().split())
        if len(compact) <= max_chars:
            return compact
        return f"{compact[: max_chars - 3]}..."

    @staticmethod
    def to_iso_or_none(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    def validate_sandbox_mode(self, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        allowed = {"read-only", "workspace-write", "danger-full-access"}
        if cleaned not in allowed:
            raise ValueError("invalid sandbox_mode")
        return cleaned

    def validate_approval_policy(self, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        allowed = {"untrusted", "on-request", "never"}
        if cleaned not in allowed:
            raise ValueError("invalid approval_policy")
        return cleaned

    def _build_command(self, sandbox_mode: str | None, approval_policy: str | None) -> list[str]:
        base_args = list(self._settings.codex_cli_subcommand)
        sanitized_args: list[str] = []
        skip_next = False
        for index, token in enumerate(base_args):
            if skip_next:
                skip_next = False
                continue
            if token in {"--sandbox", "-s", "--ask-for-approval", "-a"}:
                # 구버전/기본 인자를 제거하고 UI 선택값으로 덮어쓴다.
                if index + 1 < len(base_args):
                    skip_next = True
                continue
            if token in {"--search"}:
                # 최신 Codex CLI에서는 제거된 플래그이므로 무시한다.
                continue
            sanitized_args.append(token)

        command = [self._settings.codex_cli_executable, *sanitized_args]
        force_no_approval = False
        if approval_policy == "never":
            # 최신 Codex CLI에는 --ask-for-approval 옵션이 없어 동등한 옵션으로 매핑한다.
            if sandbox_mode == "workspace-write":
                command.append("--full-auto")
                sandbox_mode = None
            elif sandbox_mode == "danger-full-access":
                command.append("--dangerously-bypass-approvals-and-sandbox")
                sandbox_mode = None
            elif sandbox_mode is None:
                force_no_approval = True

        if sandbox_mode:
            command.extend(["--sandbox", sandbox_mode])
        if force_no_approval:
            command.append("--dangerously-bypass-approvals-and-sandbox")
        command.append("-")
        return command
