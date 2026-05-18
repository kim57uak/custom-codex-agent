/**
 * BackupService — 에이전트/스킬 설정 백업 및 복원 서비스.
 *
 * @what
 * - tar/gzip 아카이브로 skills/agents 디렉토리를 백업하고 복원합니다.
 * - 수동(manual), 자동(auto), 마이그레이션 전(pre-migration) 세 가지 백업 타입을 지원합니다.
 * - 오래된 백업 정리(prune), 전체 백업 용량 조회 기능을 제공합니다.
 *
 * @design
 * - tar CLI를 spawn하여 아카이브를 생성/해제하며, fallback으로 fs.cpSync 복사를 지원합니다.
 * - 복원 전 자동 백업을 선행하여 안전성을 보장합니다.
 * - 백업 메타데이터는 JSON 파일로 별도 저장되어 목록 조회가 빠릅니다.
 *
 * @usage
 *   const backup = new BackupService({ engine: 'gemini' });
 *   const meta = backup.createBackup('manual', 'release v1.0');
 *   backup.restoreBackup(meta.id);
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { SETTINGS } from '../settings/AppSettings';

/** 백업 메타데이터를 나타냅니다. 각 백업은 JSON 메타데이터 파일로 관리됩니다. */
export interface BackupMetadata {
  /** 백업 고유 ID (timestamp 기반) */
  id: string;
  /** 백업 생성 시간 (ISO-8601) */
  timestamp: string;
  /** 백업 타입 (manual/auto/pre-migration) */
  type: 'manual' | 'auto' | 'pre-migration';
  /** 백업 대상 엔진 이름 */
  engine: string;
  /** 생성된 아카이브 파일명 */
  archiveName: string;
  /** 아카이브 파일 크기 (바이트) */
  sizeBytes: number;
  /** 백업에 포함된 루트 디렉토리 경로 목록 */
  includedRoots: string[];
  /** 정리된 삭제된 엔트리 개수 */
  deletedEntryCount: number;
  /** 백업 설명 (선택) */
  description?: string;
}

export class BackupService {
  /** 백업 파일이 저장되는 디렉토리 경로 */
  private backupDir: string;
  /** 백업 대상 엔진 이름 */
  private engine: string;

  /**
   * BackupService 인스턴스를 생성합니다.
   * 백업 디렉토리가 없으면 생성합니다.
   * @param deps - 엔진 이름을 포함한 의존성 객체
   */
  constructor(deps: { engine?: string } = {}) {
    this.engine = deps.engine || SETTINGS.defaultEngine;
    this.backupDir = path.join(SETTINGS.backupsRoot, this.engine);
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * 현재 엔진의 skills/agents 루트 경로를 반환합니다.
   * @returns skillsRoot와 agentsRoot를 포함한 객체
   */
  private getEngineRoots(): { skillsRoot: string; agentsRoot: string } {
    const skillsRoot = SETTINGS.getSkillsRoot(this.engine);
    const agentsRoot = SETTINGS.getAgentsRoot(this.engine);
    return { skillsRoot, agentsRoot };
  }

  /**
   * tar CLI를 사용하여 아카이브 명령을 실행합니다.
   * @param args - tar 명령어 인수
   * @param cwd - 실행 작업 디렉토리 (기본값: /)
   * @returns 완료 시 resolve되는 Promise
   */
  private _spawnTar(args: string[], cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('tar', args, {
        shell: false,
        cwd: cwd ?? '/',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar exited ${code}: ${stderr.slice(0, 200)}`));
      });
      proc.on('error', (err) => reject(err));
    });
  }

  /**
   * 새 백업을 생성합니다. tar.gz 아카이브와 JSON 메타데이터 파일을 저장합니다.
   * @param type - 백업 타입 (기본값: manual)
   * @param description - 백업 설명 (선택)
   * @returns 생성된 백업 메타데이터
   */
  createBackup(type: BackupMetadata['type'] = 'manual', description?: string): BackupMetadata {
    const id = `backup-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const { skillsRoot, agentsRoot } = this.getEngineRoots();
    const archiveName = `${this.engine}${SETTINGS.backupArchiveNameSuffix || '-skills-agents-backup-'}${Date.now()}.tar.gz`;
    const archivePath = path.join(this.backupDir, archiveName);

    const includedRoots: string[] = [];
    const exists: string[] = [];

    if (fs.existsSync(skillsRoot)) {
      includedRoots.push(skillsRoot);
      exists.push(skillsRoot);
    }
    if (fs.existsSync(agentsRoot)) {
      includedRoots.push(agentsRoot);
      exists.push(agentsRoot);
    }

    const deletedEntryCount = this._purgeDeletedEntries(exists);

    if (exists.length > 0) {
      try {
        this._spawnTar(['-czf', archivePath, ...exists]);
      } catch {
        if (!fs.existsSync(archivePath)) {
          this._fallbackCopy(exists, archivePath.replace('.tar.gz', ''));
        }
      }
    } else {
      this._createEmptyArchive(archivePath);
    }

    const sizeBytes = fs.existsSync(archivePath) ? fs.statSync(archivePath).size : 0;

    const metadata: BackupMetadata = {
      id, timestamp, type, engine: this.engine,
      archiveName, sizeBytes, includedRoots, deletedEntryCount,
      ...(description !== undefined ? { description } : {}),
    };

    fs.writeFileSync(
      path.join(this.backupDir, `${id}.json`),
      JSON.stringify(metadata, null, 2), 'utf-8',
    );

    return metadata;
  }

  /**
   * 지정된 백업 ID의 아카이브를 복원합니다.
   * 복원 전 자동 백업을 먼저 생성하여 안전성을 보장합니다.
   * @param backupId - 복원할 백업 ID
   * @returns 복원된 루트 경로와 개수
   */
  restoreBackup(backupId: string): { restoredRoots: string[]; restoredCount: number } {
    const metadata = this._getMetadata(backupId);
    if (!metadata) throw new Error(`백업을 찾을 수 없습니다: ${backupId}`);

    this.createBackup('auto', `자동 백업: ${backupId} 복원 전`);

    const archivePath = path.join(this.backupDir, metadata.archiveName);
    if (!fs.existsSync(archivePath)) throw new Error(`아카이브를 찾을 수 없습니다: ${metadata.archiveName}`);

    let restoredRoots: string[] = [];
    if (archivePath.endsWith('.tar.gz')) {
      try {
        this._spawnTar(['-xzf', archivePath, '-C', '/']);
        restoredRoots = metadata.includedRoots;
      } catch {
        throw new Error('아카이브 복원에 실패했습니다.');
      }
    }

    return { restoredRoots, restoredCount: restoredRoots.length };
  }

  /**
   * 현재 엔진의 모든 백업 목록을 최신순으로 반환합니다.
   * @returns 백업 메타데이터 배열
   */
  listBackups(): BackupMetadata[] {
    if (!fs.existsSync(this.backupDir)) return [];
    const backups: BackupMetadata[] = [];
    const files = fs.readdirSync(this.backupDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(path.join(this.backupDir, file), 'utf-8');
          const md: BackupMetadata = JSON.parse(content);
          backups.push(md);
        } catch {}
      }
    }
    return backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * 지정된 ID의 백업을 삭제합니다. 메타데이터와 아카이브 파일을 모두 제거합니다.
   * @param backupId - 삭제할 백업 ID
   * @returns 삭제 성공 여부
   */
  deleteBackup(backupId: string): boolean {
    const metadata = this._getMetadata(backupId);
    if (!metadata) return false;
    const metadataPath = path.join(this.backupDir, `${backupId}.json`);
    const archivePath = path.join(this.backupDir, metadata.archiveName);
    if (fs.existsSync(metadataPath)) fs.unlinkSync(metadataPath);
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    return true;
  }

  /**
   * 현재 엔진의 모든 백업 파일 크기 합계를 반환합니다.
   * @returns 총 백업 크기 (바이트)
   */
  getTotalBackupSize(): number {
    if (!fs.existsSync(this.backupDir)) return 0;
    let total = 0;
    const files = fs.readdirSync(this.backupDir);
    for (const file of files) {
      const fp = path.join(this.backupDir, file);
      try { total += fs.statSync(fp).size; } catch {}
    }
    return total;
  }

  /**
   * 오래된 백업을 정리하여 최대 보관 개수를 유지합니다.
   * @param maxBackups - 유지할 최대 백업 개수 (기본값 10)
   * @returns 삭제된 백업 개수
   */
  pruneOldBackups(maxBackups: number = 10): number {
    const backups = this.listBackups();
    if (backups.length <= maxBackups) return 0;
    let deleted = 0;
    for (const b of backups.slice(maxBackups)) {
      if (this.deleteBackup(b.id)) deleted++;
    }
    return deleted;
  }

  /**
   * 지정된 백업 ID의 메타데이터를 JSON 파일에서 읽어 반환합니다.
   * @param backupId - 조회할 백업 ID
   * @returns 백업 메타데이터, 없으면 null
   */
  private _getMetadata(backupId: string): BackupMetadata | null {
    const metadataPath = path.join(this.backupDir, `${backupId}.json`);
    if (!fs.existsSync(metadataPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * 백업 대상 디렉토리에서 7일 이상 지난 빈 디렉토리를 정리합니다.
   * @param roots - 정리할 루트 디렉토리 경로 목록
   * @returns 삭제된 디렉토리 개수
   */
  private _purgeDeletedEntries(roots: string[]): number {
    let count = 0;
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      try {
        const entries = fs.readdirSync(root);
        for (const entry of entries) {
          const fullPath = path.join(root, entry);
          if (!fs.existsSync(fullPath)) continue;
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const modifiedAgo = Date.now() - stat.mtimeMs;
            if (modifiedAgo > 7 * 24 * 60 * 60 * 1000 && fs.readdirSync(fullPath).length === 0) {
              fs.rmdirSync(fullPath);
              count++;
            }
          }
        }
      } catch {}
    }
    return count;
  }

  /**
   * tar 사용이 실패할 경우 fs.cpSync로 디렉토리를 직접 복사하는 fallback.
   * @param roots - 복사할 루트 디렉토리 목록
   * @param destDir - 복사 대상 디렉토리
   */
  private _fallbackCopy(roots: string[], destDir: string): void {
    fs.mkdirSync(destDir, { recursive: true });
    for (const root of roots) {
      const name = path.basename(root);
      const target = path.join(destDir, name);
      if (fs.existsSync(root)) {
        fs.cpSync(root, target, { recursive: true, force: true });
      }
    }
  }

  /**
   * 백업할 내용이 없을 때 빈 tar.gz 아카이브를 생성합니다.
   * @param archivePath - 생성할 아카이브 경로
   */
  private _createEmptyArchive(archivePath: string): void {
    const dir = path.dirname(archivePath);
    const tmpFile = path.join(dir, '.empty');
    fs.writeFileSync(tmpFile, '');
    try {
      this._spawnTar(['-czf', archivePath, '.empty'], dir);
    } catch {
      fs.writeFileSync(archivePath, '');
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  }
}
