from __future__ import annotations

import shutil
import tarfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from abc import ABC, abstractmethod

from app.config import AppSettings


@dataclass(frozen=True)
class SkillAgentBackupResult:
    archive_path: Path
    included_roots: list[str]
    deleted_entry_count: int
    created_at: datetime
    size_bytes: int


@dataclass(frozen=True)
class SkillAgentRestoreResult:
    archive_path: Path
    restored_roots: list[str]
    restored_member_count: int
    deleted_entry_count: int
    restored_at: datetime


class EngineBackupStrategy(ABC):
    @abstractmethod
    def backup(self, purge_after_backup: bool = False) -> SkillAgentBackupResult:
        ...

    @abstractmethod
    def restore_latest(self) -> SkillAgentRestoreResult:
        ...


class BaseSkillAgentBackupStrategy(EngineBackupStrategy):
    """
    summary: 특정 엔진의 skills/agents 백업 및 복구 로직을 구현하는 베이스 클래스다.
    purpose/context: 엔진별 경로와 접두사만 추상화하고, 실제 tar.gz 생성 및 추출 로직을 공유한다.
    input: AppSettings와 백업 저장 폴더를 받는다.
    output: 백업 결과(경로, 통계) 또는 복구 결과(복구된 파일 수)를 반환한다.
    rules/constraints: 백업 대상은 skills, agents 루트 폴더만 허용하며, 복구 시 기존 폴더를 정리(purge)할 수 있다.
    failure behavior: 백업할 파일이 없거나 백업 디렉토리 접근 실패 시 FileNotFoundError를 발생시킨다.
    """

    _ALLOWED_ROOTS = {"skills", "agents"}

    def __init__(self, settings: AppSettings, backups_root: Path | None = None) -> None:
        self._settings = settings
        self._backups_root = backups_root or settings.backups_root

    @property
    @abstractmethod
    def engine_prefix(self) -> str:
        ...

    @property
    @abstractmethod
    def home_root(self) -> Path:
        ...

    @property
    @abstractmethod
    def skills_root(self) -> Path:
        ...

    @property
    @abstractmethod
    def agents_root(self) -> Path:
        ...

    def backup(self, purge_after_backup: bool = False) -> SkillAgentBackupResult:
        archive_path, included_roots = self._create_archive()
        deleted_entry_count = self._purge_entries(included_roots) if purge_after_backup else 0
        stat = archive_path.stat()
        return SkillAgentBackupResult(
            archive_path=archive_path,
            included_roots=included_roots,
            deleted_entry_count=deleted_entry_count,
            created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
            size_bytes=stat.st_size,
        )

    def restore_latest(self) -> SkillAgentRestoreResult:
        archive_path = self._find_latest_archive()
        with tarfile.open(archive_path, mode="r:gz") as archive:
            members = archive.getmembers()
            restored_roots = self._validate_restore_members(members)
            deleted_entry_count = self._purge_entries(restored_roots)
            self.skills_root.mkdir(parents=True, exist_ok=True)
            self.agents_root.mkdir(parents=True, exist_ok=True)
            restored_member_count = self._extract_validated_members(archive, members)
        return SkillAgentRestoreResult(
            archive_path=archive_path,
            restored_roots=restored_roots,
            restored_member_count=restored_member_count,
            deleted_entry_count=deleted_entry_count,
            restored_at=datetime.now(tz=timezone.utc),
        )

    def _create_archive(self) -> tuple[Path, list[str]]:
        included_roots: list[str] = []
        if self._root_has_entries(self.skills_root):
            included_roots.append("skills")
        if self._root_has_entries(self.agents_root):
            included_roots.append("agents")
        if not included_roots:
            raise FileNotFoundError(f"{self.engine_prefix} skills/agents have no entries to backup")

        self._backups_root.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
        suffix = self._settings.backup_archive_name_suffix
        archive_path = self._backups_root / f"{self.engine_prefix}{suffix}{timestamp}.tar.gz"

        with tarfile.open(archive_path, mode="w:gz") as archive:
            if "skills" in included_roots:
                archive.add(self.skills_root, arcname="skills")
            if "agents" in included_roots:
                archive.add(self.agents_root, arcname="agents")

        return archive_path, included_roots

    def _find_latest_archive(self) -> Path:
        if not self._backups_root.exists() or not self._backups_root.is_dir():
            raise FileNotFoundError("backup directory not found")
        
        suffix = self._settings.backup_archive_name_suffix
        archives = sorted(
            self._backups_root.glob(f"{self.engine_prefix}{suffix}*.tar.gz"),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        if not archives:
            raise FileNotFoundError(f"no backup archive found for {self.engine_prefix}")
        for archive_path in archives:
            try:
                payload = self._archive_payload_counts(archive_path)
            except (OSError, ValueError, tarfile.TarError):
                continue
            if sum(payload.values()) > 0:
                return archive_path
        raise FileNotFoundError(f"no usable backup archive found for {self.engine_prefix}")

    def _archive_payload_counts(self, archive_path: Path) -> dict[str, int]:
        counts: dict[str, int] = {"skills": 0, "agents": 0}
        with tarfile.open(archive_path, mode="r:gz") as archive:
            members = archive.getmembers()
            self._validate_restore_members(members)
            for member in members:
                member_path = Path(member.name)
                if member.isfile() and len(member_path.parts) >= 2:
                    counts[member_path.parts[0]] += 1
        return counts

    def _validate_restore_members(self, members: list[tarfile.TarInfo]) -> list[str]:
        restored_file_counts: dict[str, int] = {"skills": 0, "agents": 0}
        for member in members:
            member_path = self._validated_member_path(member)
            if member.isfile() and len(member_path.parts) >= 2:
                restored_file_counts[member_path.parts[0]] += 1
        restored_roots = sorted(root for root, count in restored_file_counts.items() if count > 0)
        if not restored_roots:
            raise ValueError("backup archive has no restorable files")
        return restored_roots

    def _validated_member_path(self, member: tarfile.TarInfo) -> Path:
        member_path = Path(member.name)
        if member_path.is_absolute() or ".." in member_path.parts or len(member_path.parts) == 0:
            raise ValueError(f"invalid backup member path: {member.name}")
        if member_path.parts[0] not in self._ALLOWED_ROOTS:
            raise ValueError(f"invalid backup member root: {member.name}")
        if member.issym() or member.islnk():
            raise ValueError(f"backup links are not supported: {member.name}")
        if not (member.isdir() or member.isfile()):
            raise ValueError(f"unsupported backup member type: {member.name}")
        return member_path

    def _extract_validated_members(self, archive: tarfile.TarFile, members: list[tarfile.TarInfo]) -> int:
        home_root = self.home_root.resolve()
        restored_member_count = 0
        for member in members:
            member_path = self._validated_member_path(member)
            target_path = (home_root / member_path).resolve()
            try:
                target_path.relative_to(home_root)
            except ValueError as err:
                raise ValueError(f"backup member escapes {self.engine_prefix} home: {member.name}") from err

            if member.isdir():
                target_path.mkdir(parents=True, exist_ok=True)
                continue

            source = archive.extractfile(member)
            if source is None:
                raise ValueError(f"backup member cannot be extracted: {member.name}")
            target_path.parent.mkdir(parents=True, exist_ok=True)
            with source, target_path.open("wb") as destination:
                shutil.copyfileobj(source, destination)
            restored_member_count += 1
        return restored_member_count

    def _purge_entries(self, included_roots: list[str]) -> int:
        deleted_count = 0
        root_map = {
            "skills": self.skills_root,
            "agents": self.agents_root,
        }
        for root_name in included_roots:
            root_path = root_map.get(root_name)
            if root_path is None or not root_path.exists() or not root_path.is_dir():
                continue
            for entry in root_path.iterdir():
                if entry.is_dir():
                    shutil.rmtree(entry)
                    deleted_count += 1
                    continue
                entry.unlink(missing_ok=True)
                deleted_count += 1
        return deleted_count

    @staticmethod
    def _root_has_entries(root: Path) -> bool:
        if not root.exists() or not root.is_dir():
            return False
        try:
            next(root.iterdir())
            return True
        except StopIteration:
            return False


class CodexBackupStrategy(BaseSkillAgentBackupStrategy):
    @property
    def engine_prefix(self) -> str:
        return "codex"

    @property
    def home_root(self) -> Path:
        return self._settings.codex_home

    @property
    def skills_root(self) -> Path:
        return self._settings.skills_root

    @property
    def agents_root(self) -> Path:
        return self._settings.agents_root


class GeminiBackupStrategy(BaseSkillAgentBackupStrategy):
    @property
    def engine_prefix(self) -> str:
        return "gemini"

    @property
    def home_root(self) -> Path:
        return self._settings.gemini_home

    @property
    def skills_root(self) -> Path:
        return self._settings.gemini_skills_root

    @property
    def agents_root(self) -> Path:
        return self._settings.gemini_agents_root


class SkillAgentBackupService:
    """
    summary: Codex와 Gemini 엔진의 skills/agents 백업 및 복구를 오케스트레이션한다.
    purpose/context: 엔진 타입에 따라 적절한 백업 전략(Strategy)을 선택하여 실행한다.
    rules/constraints: 지원하지 않는 엔진이 입력되면 ValueError를 발생시킨다.
    """

    def __init__(self, settings: AppSettings, backups_root: Path | None = None) -> None:
        self.default_engine = settings.default_engine
        self._strategies: dict[str, EngineBackupStrategy] = {
            "codex": CodexBackupStrategy(settings, backups_root),
            "gemini": GeminiBackupStrategy(settings, backups_root),
        }

    def backup(self, engine: str | None = None, purge_after_backup: bool = False) -> SkillAgentBackupResult:
        target_engine = engine or self.default_engine
        if target_engine not in self._strategies:
            raise ValueError(f"unsupported engine: {target_engine}")
        return self._strategies[target_engine].backup(purge_after_backup)

    def restore_latest(self, engine: str | None = None) -> SkillAgentRestoreResult:
        target_engine = engine or self.default_engine
        if target_engine not in self._strategies:
            raise ValueError(f"unsupported engine: {target_engine}")
        return self._strategies[target_engine].restore_latest()
