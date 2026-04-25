from __future__ import annotations

import shutil
import tarfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

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


class SkillAgentBackupService:
    """
    summary: Codex skills/agents 백업과 복구 파일 작업을 담당한다.
    purpose/context: API 라우터에서 파일 시스템 변경과 tar 검증 책임을 분리한다.
    rules/constraints: 복구 archive는 skills/agents 루트 아래의 일반 파일/디렉터리만 허용한다.
    failure behavior: 호출자가 HTTP 상태로 변환할 수 있도록 FileNotFoundError, ValueError, OSError를 유지한다.
    """

    _ALLOWED_ROOTS = {"skills", "agents"}

    def __init__(self, settings: AppSettings, backups_root: Path | None = None) -> None:
        self._settings = settings
        self._backups_root = backups_root or Path(__file__).resolve().parents[3] / "backups"

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
            self._settings.skills_root.mkdir(parents=True, exist_ok=True)
            self._settings.agents_root.mkdir(parents=True, exist_ok=True)
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
        if self._root_has_entries(self._settings.skills_root):
            included_roots.append("skills")
        if self._root_has_entries(self._settings.agents_root):
            included_roots.append("agents")
        if not included_roots:
            raise FileNotFoundError("skills/agents have no entries to backup")

        self._backups_root.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
        archive_path = self._backups_root / f"skills-agents-backup-{timestamp}.tar.gz"

        with tarfile.open(archive_path, mode="w:gz") as archive:
            if "skills" in included_roots:
                archive.add(self._settings.skills_root, arcname="skills")
            if "agents" in included_roots:
                archive.add(self._settings.agents_root, arcname="agents")

        return archive_path, included_roots

    def _find_latest_archive(self) -> Path:
        if not self._backups_root.exists() or not self._backups_root.is_dir():
            raise FileNotFoundError("backup directory not found")
        archives = sorted(
            self._backups_root.glob("skills-agents-backup-*.tar.gz"),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        if not archives:
            raise FileNotFoundError("no backup archive found")
        for archive_path in archives:
            try:
                payload = self._archive_payload_counts(archive_path)
            except (OSError, ValueError, tarfile.TarError):
                continue
            if sum(payload.values()) > 0:
                return archive_path
        raise FileNotFoundError("no usable backup archive found")

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
        codex_home = self._settings.codex_home.resolve()
        restored_member_count = 0
        for member in members:
            member_path = self._validated_member_path(member)
            target_path = (codex_home / member_path).resolve()
            try:
                target_path.relative_to(codex_home)
            except ValueError as err:
                raise ValueError(f"backup member escapes codex home: {member.name}") from err

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
            "skills": self._settings.skills_root,
            "agents": self._settings.agents_root,
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
