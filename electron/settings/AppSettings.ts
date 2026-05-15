import path from 'path';
import os from 'os';
import fs from 'fs';


export type EngineType = 'codex' | 'gemini';

export class AppSettings {
  readonly codexHome: string;
  readonly geminiHome: string;
  readonly historyFileName = 'history.jsonl';
  readonly stateDbName = 'state_5.sqlite';
  readonly logDbName = 'logs_2.sqlite';
  readonly runDbName = 'runs.db';
  readonly runMaxConcurrency: number;
  readonly runTimeoutSeconds: number;
  readonly runPromptMaxLength: number;
  readonly backupArchiveNameSuffix: string;
  readonly codexCliExecutable: string;
  readonly geminiCliExecutable: string;
  readonly founderName: string;
  readonly defaultEngine: EngineType;
  readonly workspaceRoot: string;
  readonly workflowRecommendationMaxAgents: number;
  readonly runListLimitDefault = 30;
  readonly runEventListLimitDefault = 100;
  readonly workflowEventListLimitDefault = 100;
  readonly safeReadTextMaxChars = 160000;
  readonly runPromptPreviewMaxChars = 120;
  readonly workflowGoalPreviewMaxChars = 140;
  readonly trendWindowDays = 7;
  readonly trendBuckets = 12;
  readonly dashboardRecentThreadsLimit = 10;
  readonly dashboardRecentLogsLimit = 20;
  readonly dashboardRecentHistoryLimit = 20;
  readonly backupsRoot: string;
  readonly directoryListLimit = 500;

  constructor() {
    this.codexHome = this._envPath('CODEX_AGENT_CODEX_HOME') || path.join(os.homedir(), '.codex');
    this.geminiHome = this._envPath('CODEX_AGENT_GEMINI_HOME') || path.join(os.homedir(), '.gemini', 'antigravity');
    this.runMaxConcurrency = this._envInt('CODEX_AGENT_RUN_MAX_CONCURRENCY', 2, 1, 16);
    this.runTimeoutSeconds = this._envInt('CODEX_AGENT_RUN_TIMEOUT_SECONDS', 1800, 30, 86400);
    this.runPromptMaxLength = this._envInt('CODEX_AGENT_RUN_PROMPT_MAX_LENGTH', 12000, 100, 100000);
    this.codexCliExecutable = process.env.CODEX_AGENT_CODEX_CLI || 'codex';
    this.geminiCliExecutable = process.env.CODEX_AGENT_GEMINI_CLI || 'gemini';
    this.founderName = process.env.CODEX_AGENT_FOUNDER_NAME || '대표이사';
    this.defaultEngine = (process.env.CODEX_AGENT_DEFAULT_ENGINE === 'codex' ? 'codex' : 'gemini');
    this.workspaceRoot = this._envPath('CODEX_AGENT_WORKSPACE_ROOT') || path.resolve('.');
    this.workflowRecommendationMaxAgents = this._envInt('CODEX_AGENT_WORKFLOW_RECOMMENDATION_MAX_AGENTS', 6, 1, 12);
    this.backupArchiveNameSuffix = process.env.CODEX_AGENT_BACKUP_ARCHIVE_SUFFIX || '-skills-agents-backup-';
    this.backupsRoot = this._envPath('CODEX_AGENT_BACKUPS_ROOT') || path.join(this.codexHome, 'backups');
  }

  get skillsRoot(): string { return path.join(this.codexHome, 'skills'); }
  get agentsRoot(): string { return path.join(this.codexHome, 'agents'); }
  get geminiSkillsRoot(): string { return path.join(this.geminiHome, 'skills'); }
  get geminiAgentsRoot(): string { return path.join(this.geminiHome, 'agents'); }
  get configTomlPath(): string { return path.join(this.codexHome, 'config.toml'); }
  get historyFilePath(): string { return path.join(this.codexHome, this.historyFileName); }

  getHome(engine?: string): string {
    const target = engine || this.defaultEngine;
    return target === 'gemini' ? this.geminiHome : this.codexHome;
  }

  getSkillsRoot(engine?: string): string {
    const target = engine || this.defaultEngine;
    return target === 'gemini' ? this.geminiSkillsRoot : this.skillsRoot;
  }

  getAgentsRoot(engine?: string): string {
    const target = engine || this.defaultEngine;
    return target === 'gemini' ? this.geminiAgentsRoot : this.agentsRoot;
  }

  getHistoryFilePath(engine?: string): string {
    const target = engine || this.defaultEngine;
    return target === 'gemini'
      ? path.join(this.geminiHome, this.historyFileName)
      : path.join(this.codexHome, this.historyFileName);
  }

  getStateDbPath(engine?: string): string {
    const target = engine || this.defaultEngine;
    return target === 'gemini'
      ? path.join(this.geminiHome, this.stateDbName)
      : path.join(this.codexHome, this.stateDbName);
  }

  getLogDbPath(engine?: string): string {
    const target = engine || this.defaultEngine;
    return target === 'gemini'
      ? path.join(this.geminiHome, this.logDbName)
      : path.join(this.codexHome, this.logDbName);
  }

  private _envPath(key: string): string | null {
    const v = process.env[key];
    if (v && v.trim()) return path.resolve(v.trim().replace(/^~/, os.homedir()));
    return null;
  }

  private _envInt(key: string, def: number, min?: number, max?: number): number {
    const raw = process.env[key];
    if (!raw || !raw.trim()) return def;
    const n = parseInt(raw.trim(), 10);
    if (isNaN(n)) return def;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  }
}

export const SETTINGS = new AppSettings();
