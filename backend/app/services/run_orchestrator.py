from __future__ import annotations

import asyncio
import json
import os
from asyncio.subprocess import Process
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from app.config import AppSettings
from app.services.engine_adapters import EngineAdapterFactory
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
    rationale: LLM 실행은 비용이 높고 시스템 자원을 많이 소모하므로, 세마포어를 통해 동시 실행 수를 제한하고
               모든 실행 과정을 DB와 SSE 이벤트를 통해 추적 가능하게 관리한다.
    input: 설정(AppSettings), 이벤트 브로커, run 저장소를 주입받아 비동기 subprocess 실행에 사용한다.
    output: run 생성/조회/취소/재시도 기능과 stdout/stderr 스트림 이벤트를 제공한다.
    rules/constraints: 모델/버전 플래그는 주입하지 않고 Codex CLI 기본 선택 상태를 상속한다.
    failure behavior: CLI 실행 실패, 타임아웃, 취소는 run 상태를 failed/canceled로 기록하고 명시적인 이벤트를 발행한다.
    """

    def __init__(self, settings: AppSettings, broker: EventBroker, store: RunStore) -> None:
        self._settings = settings
        self._broker = broker
        self._store = store
        self._engine_factory = EngineAdapterFactory(settings)
        # LLM 실행의 과도한 자원 사용을 막기 위해 Semaphore를 사용하여 동시 실행 수를 제어함
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
        engine: str | None = None,
    ) -> RunCreateResult:
        """
        새로운 에이전트 실행 작업을 생성하고 비동기적으로 프로세스를 시작한다.
        실행 전 큐잉 상태를 즉시 반환하여 클라이언트가 대기하지 않도록 설계됨.
        """
        engine = engine or self._settings.default_engine
        run_id = uuid4().hex
        record = self._store.create_run(
            run_id=run_id,
            agent_name=agent_name,
            workspace_root=str(workspace_root),
            prompt=prompt,
            engine=engine,
            sandbox_mode=sandbox_mode,
            approval_policy=approval_policy,
        )
        await self._publish_run_event(run_id, "run:queued", f"run queued for agent={agent_name} engine={engine}")
        task = asyncio.create_task(
            self._execute_run(
                run_id=run_id,
                agent_name=agent_name,
                prompt=prompt,
                workspace_root=workspace_root,
                sandbox_mode=sandbox_mode,
                approval_policy=approval_policy,
                engine=engine,
            )
        )
        self._run_tasks[run_id] = task
        task.add_done_callback(lambda _done, current_run_id=run_id: self._run_tasks.pop(current_run_id, None))
        return RunCreateResult(run_id=run_id, record=record)

    async def cancel_run(self, run_id: str) -> RunRecord | None:
        """
        진행 중인 프로세스를 안전하게 종료(terminate)하고 관련 비동기 task를 취소한다.
        시스템 자원 릭을 방지하기 위해 프로세스 객체와 task를 모두 정리함.
        """
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

    async def retry_run(self, run_id: str, engine: str | None = None) -> RunCreateResult | None:
        record = self._store.get_run(run_id)
        if record is None:
            return None
        workspace_root = self.validate_workspace_root(record.workspace_root or None)
        return await self.create_run(
            agent_name=record.agent_name,
            prompt=record.prompt,
            workspace_root=workspace_root,
            sandbox_mode=record.sandbox_mode,
            approval_policy=record.approval_policy,
            engine=engine,
        )

    async def wait_for_run(self, run_id: str) -> RunRecord | None:
        """
        summary: 특정 run이 종료될 때까지 기다린 뒤 최신 run 레코드를 반환한다.
        purpose/context: 워크플로 오케스트레이터가 단계별 단일 run을 순차 실행할 때 공용 대기 지점으로 사용한다.
        input: create_run 이후 발급된 run_id를 받는다.
        output: 완료/실패/취소 상태로 갱신된 RunRecord 또는 미존재 시 None을 반환한다.
        rules/constraints: 이미 종료된 run이면 추가 대기 없이 즉시 현재 상태를 반환한다.
        failure behavior: 내부 task 예외는 기존 실행 로직에서 상태를 기록하므로 여기서는 최신 레코드 조회만 수행한다.
        """

        record = self._store.get_run(run_id)
        if record is None:
            return None
        if record.status in {"completed", "failed", "canceled"}:
            return record
        task = self._run_tasks.get(run_id)
        if task is not None:
            try:
                await task
            except asyncio.CancelledError:
                raise
            except Exception:
                # 실행 task 내부에서 상태와 이벤트를 이미 기록하므로 여기서는 후속 조회만 수행한다.
                pass
        return self._store.get_run(run_id)

    async def reply_to_run(self, run_id: str, message: str) -> bool:
        """
        실행 중인 에이전트 프로세스의 stdin으로 추가 메시지를 보낸다 (Multi-turn 대화 지원).
        """
        process = self._active_processes.get(run_id)
        if process is None or process.returncode is not None:
            return False

        if process.stdin is None:
            return False

        try:
            # 사용자의 답변을 이벤트로 기록하여 로그에 남김
            await self._publish_run_event(run_id, "run:reply", message)

            # stdin으로 메시지 전송 (개행 추가 필수)
            payload = (message if message.endswith("\n") else message + "\n").encode("utf-8")
            process.stdin.write(payload)
            await process.stdin.drain()
            return True
        except Exception as err:
            await self._publish_run_event(run_id, "run:error", f"failed to send reply: {err}")
            return False

    async def execute_codex_text(
        self,
        prompt: str,
        workspace_root: Path | None = None,
        sandbox_mode: str | None = None,
        approval_policy: str | None = None,
    ) -> tuple[int | None, str, str]:
        """
        summary: Codex CLI를 단발성 텍스트 실행으로 호출하고 stdout/stderr를 수집한다.
        purpose/context: 워크플로 추천처럼 run 저장이 필요 없는 메타 작업에서 동일한 CLI 실행 규칙을 재사용한다.
        input: prompt, 선택적 작업 폴더, 샌드박스/승인 정책을 받는다.
        output: `(return_code, stdout_text, stderr_text)` 튜플을 반환한다.
        rules/constraints: 실행 커맨드 구성은 일반 run과 동일한 규칙을 사용한다. 항상 codex 엔진을 사용한다.
        failure behavior: 실행 파일이 없으면 `FileNotFoundError`를 그대로 올려 호출자가 진단 메시지를 만든다.
        """

        adapter = self._engine_factory.get_adapter(self._settings.default_engine)
        command = adapter.build_command(
            sandbox_mode=sandbox_mode,
            approval_policy=approval_policy,
            prompt=prompt,
        )

        # 터미널과 동일한 실행 환경을 보장하기 위해 현재 환경 변수와 설정을 병합함
        env = os.environ.copy()
        # 맥 표준 경로 추가
        extra_paths = ["/opt/homebrew/bin", "/usr/local/bin"]
        current_path = env.get("PATH", "")
        env["PATH"] = ":".join(extra_paths + ([current_path] if current_path else []))

        if self._settings.gemini_home:
            env["GEMINI_HOME"] = str(self._settings.gemini_home)
        if self._settings.codex_home:
            env["CODEX_HOME"] = str(self._settings.codex_home)

        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(workspace_root or self.default_workspace_root),
            env=env,
            stdin=asyncio.subprocess.PIPE if adapter.uses_stdin_for_prompt else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        if adapter.uses_stdin_for_prompt:
            await self._write_prompt(process, prompt)

        stdout_bytes, stderr_bytes = await process.communicate()
        stdout_text = stdout_bytes.decode("utf-8", errors="replace") if stdout_bytes else ""
        stderr_text = stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else ""
        return process.returncode, stdout_text, stderr_text

    async def _execute_run(
        self,
        run_id: str,
        agent_name: str,
        prompt: str,
        workspace_root: Path,
        engine: str,
        sandbox_mode: str | None = None,
        approval_policy: str | None = None,
    ) -> None:
        """
        에이전트 실행의 핵심 라이프사이클을 수행한다:
        1. 스킬 정의 및 에이전트 제약 사항을 포함한 Effective Prompt 생성
        2. OS 레벨의 서브 프로세스 생성 (격리된 실행 환경)
        3. 실시간 stdout/stderr 스트림 소비 및 이벤트 발행
        4. 타임아웃 관리 및 종료 상태 기록
        """
        process: Process | None = None
        try:
            async with self._semaphore:
                updated = self._store.mark_running(run_id)
                if updated is None:
                    return
                await self._publish_run_event(run_id, "run:started", f"run started (engine={engine})")

                # 에이전트에 매핑된 스킬 정보(프롬프트 뼈대)를 로드할 때도 선택된 엔진의 경로를 참조하도록 수정
                skill_content, skill_path = self._fetch_skill_info(agent_name, engine=engine)
                effective_prompt = self._build_effective_prompt(
                    agent_name=agent_name,
                    prompt=prompt,
                    skill_content=skill_content,
                )

                include_dirs: list[str] = []
                if skill_path:
                    # 스킬 디렉토리를 포함하여 서브 프로세스에서 스크립트 등에 접근 가능하게 함
                    include_dirs.append(str(skill_path.parent))

                adapter = self._engine_factory.get_adapter(engine)

                command = adapter.build_command(
                    sandbox_mode=sandbox_mode,
                    approval_policy=approval_policy,
                    prompt=effective_prompt,
                    include_directories=include_dirs,
                )

                # 터미널과 동일한 실행 환경을 보장하기 위해 현재 환경 변수와 설정을 병합함
                env = os.environ.copy()
                # 맥 표준 경로 추가
                extra_paths = ["/opt/homebrew/bin", "/usr/local/bin"]
                current_path = env.get("PATH", "")
                env["PATH"] = ":".join(extra_paths + ([current_path] if current_path else []))

                if self._settings.gemini_home:
                    env["GEMINI_HOME"] = str(self._settings.gemini_home)
                if self._settings.codex_home:
                    env["CODEX_HOME"] = str(self._settings.codex_home)

                # API Key 전파: CLI에서 LLM에 접근할 수 있도록 현재 프로세스의 환경변수를 명시적으로 주입
                for key in ["GOOGLE_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]:
                    if key in os.environ:
                        env[key] = os.environ[key]

                if adapter.uses_stdin_for_prompt:
                    process = await asyncio.create_subprocess_exec(
                        *command,
                        cwd=str(workspace_root),
                        env=env,
                        stdin=asyncio.subprocess.PIPE,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    await self._write_prompt(process, effective_prompt)
                else:
                    process = await asyncio.create_subprocess_exec(
                        *command,
                        cwd=str(workspace_root),
                        env=env,
                        stdin=asyncio.subprocess.DEVNULL,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )

                self._active_processes[run_id] = process

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
                        error_message=f"{engine} exited with non-zero code: {return_code}",
                    )
                    await self._publish_run_event(run_id, "run:failed", f"{engine} exited with code={return_code}")
        except FileNotFoundError:
            adapter = self._engine_factory.get_adapter(engine)
            self._store.finish_run(
                run_id,
                status="failed",
                exit_code=None,
                error_message=f"{engine} cli not found: {adapter.executable_path}",
            )
            await self._publish_run_event(run_id, "run:failed", f"{engine} cli executable not found")
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

    def _build_effective_prompt(self, agent_name: str, prompt: str, skill_content: str | None = None) -> str:
        """
        사용자의 원본 프롬프트에 에이전트의 역할 정의와 스킬 명세(SKILL.md)를 결합한다.
        LLM이 에이전트의 정체성과 가이드라인을 유지하면서 작업을 수행하도록 컨텍스트를 주입하는 역할임.
        """
        header = (
            "You are running from Custom Gemini Agent Execution Console.\n"
            f"Selected agent: {agent_name}\n"
            "Follow the selected agent's role and constraints while completing the request.\n\n"
        )
        
        skill_section = ""
        if skill_content:
            skill_section = (
                "## Agent Workflow Definition\n"
                "Follow these instructions strictly:\n\n"
                f"{skill_content}\n\n"
                "---\n\n"
            )

        file_safety = (
            "If the task requires reading or analyzing a file but the user did not provide an explicit file path and file name, "
            "do not proceed with file operations. First ask the user to provide the exact file path and file name.\n\n"
        )
        
        return f"{header}{skill_section}{file_safety}{prompt}"

    def _fetch_skill_info(self, agent_name: str, engine: str | None = None) -> tuple[str | None, Path | None]:
        """
        summary: 에이전트에 매핑된 스킬 파일 내용과 경로를 읽어온다.
        rationale: 에이전트의 페르소나는 스킬 파일에 정의되어 있으므로, 실행 시점에 항상 최신 스킬 정의를 로드해야 함.
        """
        try:
            # 엔진별 에이전트 루트를 사용하여 config.json 위치를 동적으로 결정함
            agents_root = self._settings.get_agents_root(engine)
            agent_dir = agents_root / agent_name
            config_file = agent_dir / "config.json"
            if not config_file.exists():
                return None, None

            config = json.loads(config_file.read_text(encoding="utf-8"))
            skill_path_str = config.get("skill_path")
            if not skill_path_str:
                return None, None

            skill_path = Path(skill_path_str).expanduser()
            if skill_path.exists():
                return skill_path.read_text(encoding="utf-8"), skill_path
        except Exception:
            pass
        return None, None

    @staticmethod
    async def _write_prompt(process: Process, prompt: str) -> None:
        if process.stdin is None:
            return
        process.stdin.write(prompt.encode("utf-8"))
        process.stdin.write(b"\n")
        await process.stdin.drain()
        process.stdin.close()

    def list_runs(self, limit: int | None = None, engine: str | None = None) -> list[RunRecord]:
        actual_limit = limit if limit is not None else self._settings.run_list_limit_default
        return self._store.list_runs(limit=actual_limit, engine=engine)

    def get_run(self, run_id: str) -> RunRecord | None:
        return self._store.get_run(run_id)

    def list_run_events(self, run_id: str, limit: int | None = None) -> list[RunEventRecord]:
        actual_limit = limit if limit is not None else self._settings.run_event_list_limit_default
        return self._store.list_run_events(run_id=run_id, limit=actual_limit)

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

    def to_prompt_preview(self, prompt: str, max_chars: int | None = None) -> str:
        limit = max_chars if max_chars is not None else self._settings.run_prompt_preview_max_chars
        compact = " ".join(prompt.strip().split())
        if len(compact) <= limit:
            return compact
        return f"{compact[: limit - 3]}..."

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
