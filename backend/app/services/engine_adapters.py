from typing import Protocol, List
from app.config import AppSettings


class EngineAdapter(Protocol):
    @property
    def name(self) -> str:
        """엔진 식별자"""
        ...
        
    @property
    def executable_path(self) -> str:
        """실행 파일 경로"""
        ...
        
    @property
    def uses_stdin_for_prompt(self) -> bool:
        """프롬프트를 표준 입력(stdin)으로 전달하는지 여부"""
        ...

    def build_command(self, sandbox_mode: str | None, approval_policy: str | None, prompt: str) -> List[str]:
        """최종적으로 subprocess로 실행할 명령어 리스트를 반환"""
        ...


class CodexEngineAdapter:
    def __init__(self, settings: AppSettings):
        self._settings = settings

    @property
    def name(self) -> str:
        return "codex"
        
    @property
    def executable_path(self) -> str:
        return self._settings.codex_cli_executable
        
    @property
    def uses_stdin_for_prompt(self) -> bool:
        return True

    def build_command(self, sandbox_mode: str | None, approval_policy: str | None, prompt: str) -> List[str]:
        base_args = list(self._settings.codex_cli_subcommand)
        sanitized_args: list[str] = []
        skip_next = False
        for index, token in enumerate(base_args):
            if skip_next:
                skip_next = False
                continue
            if token in {"--sandbox", "-s", "--ask-for-approval", "-a"}:
                if index + 1 < len(base_args):
                    skip_next = True
                continue
            if token in {"--search"}:
                continue
            sanitized_args.append(token)

        command = [self.executable_path, *sanitized_args]
        force_no_approval = False
        if approval_policy == "never":
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


class GeminiEngineAdapter:
    def __init__(self, settings: AppSettings):
        self._settings = settings

    @property
    def name(self) -> str:
        return "gemini"
        
    @property
    def executable_path(self) -> str:
        return self._settings.gemini_cli_executable
        
    @property
    def uses_stdin_for_prompt(self) -> bool:
        return False

    def build_command(self, sandbox_mode: str | None, approval_policy: str | None, prompt: str) -> List[str]:
        command = [self.executable_path]
        command.extend(["--output-format", "text"])

        # Sandbox/Approval 매핑: 기획서 기준 우선순위 적용
        if sandbox_mode == "danger-full-access" or approval_policy == "never":
            command.extend(["--approval-mode", "yolo"])
        elif sandbox_mode == "workspace-write" or approval_policy == "on-request":
            command.extend(["--approval-mode", "auto_edit"])
        elif sandbox_mode == "read-only":
            command.extend(["--sandbox", "--approval-mode", "default"])
        else:
            command.extend(["--approval-mode", "default"])

        command.extend(["--prompt", prompt])
        return command


class EngineAdapterFactory:
    def __init__(self, settings: AppSettings):
        self._adapters = {
            "codex": CodexEngineAdapter(settings),
            "gemini": GeminiEngineAdapter(settings),
        }
        self._default = "codex"
        
    def get_adapter(self, engine_name: str) -> EngineAdapter:
        return self._adapters.get(engine_name, self._adapters[self._default])
