import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { SETTINGS } from '../settings/AppSettings';

export interface BackupMetadata {
  id: string;
  timestamp: string;
  type: 'manual' | 'auto' | 'pre-migration';
  engine: string;
  archiveName: string;
  sizeBytes: number;
  includedRoots: string[];
  deletedEntryCount: number;
  description?: string;
}

export class BackupService {
  private backupDir: string;
  private engine: string;

  constructor(deps: { engine?: string } = {}) {
    this.engine = deps.engine || SETTINGS.defaultEngine;
    this.backupDir = path.join(SETTINGS.backupsRoot, this.engine);
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  private getEngineRoots(): { skillsRoot: string; agentsRoot: string } {
    const skillsRoot = SETTINGS.getSkillsRoot(this.engine);
    const agentsRoot = SETTINGS.getAgentsRoot(this.engine);
    return { skillsRoot, agentsRoot };
  }

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
      const tarCmd = `cd / && tar -czf "${archivePath}" ${exists.map(e => `"${e.replace(/^\/+/, '')}"`).join(' ')} 2>/dev/null || true`;
      try {
        execSync(tarCmd, { timeout: 30000 });
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

  restoreBackup(backupId: string): { restoredRoots: string[]; restoredCount: number } {
    const metadata = this._getMetadata(backupId);
    if (!metadata) throw new Error(`백업을 찾을 수 없습니다: ${backupId}`);

    this.createBackup('auto', `자동 백업: ${backupId} 복원 전`);

    const archivePath = path.join(this.backupDir, metadata.archiveName);
    if (!fs.existsSync(archivePath)) throw new Error(`아카이브를 찾을 수 없습니다: ${metadata.archiveName}`);

    let restoredRoots: string[] = [];
    if (archivePath.endsWith('.tar.gz')) {
      const tarCmd = `tar -xzf "${archivePath}" -C / 2>/dev/null || true`;
      try {
        execSync(tarCmd, { timeout: 30000 });
        restoredRoots = metadata.includedRoots;
      } catch {
        throw new Error('아카이브 복원에 실패했습니다.');
      }
    } else {
      const backupContentPath = archivePath;
      if (fs.existsSync(backupContentPath)) {
        const entries = fs.readdirSync(backupContentPath);
        for (const entry of entries) {
          const src = path.join(backupContentPath, entry);
          const dst = path.join(os.homedir(), '.codex', entry);
          if (fs.existsSync(src)) {
            fs.cpSync(src, dst, { recursive: true, force: true });
            restoredRoots.push(dst);
          }
        }
      }
    }

    return { restoredRoots, restoredCount: restoredRoots.length };
  }

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

  deleteBackup(backupId: string): boolean {
    const metadata = this._getMetadata(backupId);
    if (!metadata) return false;
    const metadataPath = path.join(this.backupDir, `${backupId}.json`);
    const archivePath = path.join(this.backupDir, metadata.archiveName);
    if (fs.existsSync(metadataPath)) fs.unlinkSync(metadataPath);
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    return true;
  }

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

  pruneOldBackups(maxBackups: number = 10): number {
    const backups = this.listBackups();
    if (backups.length <= maxBackups) return 0;
    let deleted = 0;
    for (const b of backups.slice(maxBackups)) {
      if (this.deleteBackup(b.id)) deleted++;
    }
    return deleted;
  }

  private _getMetadata(backupId: string): BackupMetadata | null {
    const metadataPath = path.join(this.backupDir, `${backupId}.json`);
    if (!fs.existsSync(metadataPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    } catch {
      return null;
    }
  }

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

  private _createEmptyArchive(archivePath: string): void {
    const dir = path.dirname(archivePath);
    const tmpFile = path.join(dir, '.empty');
    fs.writeFileSync(tmpFile, '');
    try {
      execSync(`cd "${dir}" && tar -czf "${archivePath}" .empty 2>/dev/null`, { timeout: 5000 });
    } catch {
      fs.writeFileSync(archivePath, '');
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  }
}
