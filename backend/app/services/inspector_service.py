from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Optional, Union

from app.models import AgentInspectorFileModel, AgentInspectorResponse

if TYPE_CHECKING:
    from app.config import AppSettings
    from app.models import AgentModel


class AgentInspectorService:
    """
    summary: 에이전트 관련 파일(설정, 스킬, 스크립트)의 조회 및 편집을 담당한다.
    purpose/context: api_routes.py에 집중된 파일 시스템 접근 로직을 서비스로 분리하여 관리한다.
    rationale: 파일 경로 검증(Path Traversal 방지)과 안전한 읽기 로직을 캡슐화하여 보안성과 재사용성을 높인다.
    """

    def __init__(self, settings: AppSettings) -> None:
        self._settings = settings

    def build_inspector_response(self, agent: AgentModel, engine: Optional[str] = None) -> AgentInspectorResponse:
        """
        에이전트가 소유한 파일 목록을 분석하고 편집 가능한 파일 모델들을 생성한다.
        """
        editable_paths = self._get_inspector_paths(agent.name, agent.skill_path, engine)
        
        # 분류별로 파일 모델 생성
        agent_toml = None
        agent_json = None
        skill_markdown = None
        references = []
        scripts = []
        
        for path, kind in editable_paths.items():
            model = self.build_file_model(path, kind)
            if kind == "agent-toml":
                agent_toml = model
            elif kind == "agent-json":
                agent_json = model
            elif kind == "skill-md":
                skill_markdown = model
            elif kind == "reference":
                references.append(model)
            elif kind == "script":
                scripts.append(model)

        # 에이전트 정보와 수집된 파일들을 결합하여 반환
        return AgentInspectorResponse(
            agent_name=agent.name,
            role_label_ko=agent.role_label_ko,
            department_label_ko=agent.department_label_ko,
            description=agent.description,
            short_description=agent.short_description,
            one_click_prompt=agent.one_click_prompt,
            skill_name=agent.skill_name,
            skill_path=agent.skill_path,
            agent_toml=agent_toml,
            agent_json=agent_json,
            skill_markdown=skill_markdown,
            references=references,
            scripts=scripts,
        )

    def save_file(self, agent_name: str, file_path_str: str, content: str, engine: Optional[str] = None) -> Path:
        """
        지정된 경로의 파일을 안전하게 저장한다. 저장 전 에이전트 권한 범위 내에 있는지 검증함.
        """
        path = Path(file_path_str).resolve()
        # 에이전트 소유 스킬 정보는 임시로 다시 계산하거나 인벤토리에서 가져와야 함 (여기서는 경로 검증 위주)
        # 실제 운영 시에는 더 엄격한 에이전트-파일 매핑 검증이 필요할 수 있음
        engine_home = self._settings.get_home(engine)
        
        if not path.exists():
            raise FileNotFoundError(f"file not found: {file_path_str}")
        if not self._is_within_root(path, engine_home):
            raise PermissionError("path traversal detected or out of engine home")

        path.write_text(content, encoding="utf-8")
        return path

    def _get_inspector_paths(self, agent_name: str, skill_path_value: Optional[str], engine: Optional[str] = None) -> dict[Path, str]:
        editable_paths: dict[Path, str] = {}
        engine_home = self._settings.get_home(engine)
        agents_root = self._settings.get_agents_root(engine)
        agent_dir = agents_root / agent_name
        skill_path = Path(skill_path_value).expanduser() if skill_path_value else None
        skill_dir = skill_path.parent if skill_path else None

        def add_file(p: Path, kind: str) -> None:
            if p.exists() and p.is_file() and self._is_within_root(p, engine_home):
                editable_paths[p.resolve()] = kind

        add_file(agent_dir / "agent.toml", "agent-toml")
        add_file(agent_dir / "config.json", "agent-json")
        if skill_path:
            add_file(skill_path, "skill-md")
        
        if skill_dir and skill_dir.exists() and self._is_within_root(skill_dir, engine_home):
            for subdir_name, kind in (("references", "reference"), ("scripts", "script")):
                subdir = skill_dir / subdir_name
                if not subdir.exists() or not subdir.is_dir():
                    continue
                for file_path in sorted(subdir.rglob("*")):
                    add_file(file_path, kind)
        return editable_paths

    def build_file_model(self, path: Path, kind: str) -> AgentInspectorFileModel:
        """
        주어진 경로의 파일 정보를 AgentInspectorFileModel로 변환한다.
        """
        content, truncated = self._safe_read_text(path)
        try:
            stat = path.stat()
            modified_at = datetime.fromtimestamp(stat.st_mtime)
            size_bytes = stat.st_size
        except OSError:
            modified_at = None
            size_bytes = 0
        return AgentInspectorFileModel(
            name=path.name,
            path=str(path),
            kind=kind,
            size_bytes=size_bytes,
            modified_at=modified_at,
            content=content,
            truncated=truncated,
        )

    def _safe_read_text(self, path: Path, max_chars: Optional[int] = None) -> tuple[str, bool]:
        limit = max_chars if max_chars is not None else self._settings.safe_read_text_max_chars
        text = path.read_text(encoding="utf-8", errors="replace")
        if len(text) <= limit:
            return text, False
        return text[:limit], True

    def _is_within_root(self, path: Path, root: Path) -> bool:
        # 기본 엔진 홈 확인
        try:
            path.resolve().relative_to(root.resolve())
            return True
        except ValueError:
            pass
            
        # 추가 허용된 루트들 확인 (GStack 등 공용 리소스 지원)
        for allowed_root in self._settings.additional_allowed_roots:
            try:
                path.resolve().relative_to(allowed_root.resolve())
                return True
            except ValueError:
                continue
                
        return False
