import path from 'path';
import os from 'os';
import fs from 'fs';


export type EngineType = 'codex' | 'gemini' | 'opencode' | 'claudecode';

export class AppSettings {
  readonly codexHome: string;
  readonly geminiHome: string;
  readonly opencodeHome: string;
  readonly claudecodeHome: string;
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
  readonly opencodeCliExecutable: string;
  readonly claudecodeCliExecutable: string;
  readonly founderName: string;
  readonly workspaceRoot: string;
  private _defaultEngineOverride: EngineType | null = null;

  get defaultEngine(): EngineType {
    if (this._defaultEngineOverride) return this._defaultEngineOverride;
    const env = process.env.CODEX_AGENT_DEFAULT_ENGINE;
    const valid: EngineType[] = ['codex', 'gemini', 'opencode', 'claudecode'];
    return valid.includes(env as EngineType) ? (env as EngineType) : 'gemini';
  }

  setDefaultEngine(engine: EngineType): void {
    this._defaultEngineOverride = engine;
  }

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
    this.opencodeHome = this._envPath('CODEX_AGENT_OPENCODE_HOME') || path.join(os.homedir(), '.opencode');
    this.claudecodeHome = this._envPath('CODEX_AGENT_CLAUDE_HOME') || path.join(os.homedir(), '.claude');
    this.runMaxConcurrency = this._envInt('CODEX_AGENT_RUN_MAX_CONCURRENCY', 2, 1, 16);
    this.runTimeoutSeconds = this._envInt('CODEX_AGENT_RUN_TIMEOUT_SECONDS', 1800, 30, 86400);
    this.runPromptMaxLength = this._envInt('CODEX_AGENT_RUN_PROMPT_MAX_LENGTH', 12000, 100, 100000);
    this.codexCliExecutable = process.env.CODEX_AGENT_CODEX_CLI || 'codex';
    this.geminiCliExecutable = process.env.CODEX_AGENT_GEMINI_CLI || 'gemini';
    this.opencodeCliExecutable = process.env.CODEX_AGENT_OPENCODE_CLI || 'opencode';
    this.claudecodeCliExecutable = process.env.CODEX_AGENT_CLAUDE_CLI || 'claude';
    this.founderName = process.env.CODEX_AGENT_FOUNDER_NAME || '대표이사';
    this.workspaceRoot = this._envPath('CODEX_AGENT_WORKSPACE_ROOT') || path.resolve('.');
    this.workflowRecommendationMaxAgents = this._envInt('CODEX_AGENT_WORKFLOW_RECOMMENDATION_MAX_AGENTS', 6, 1, 12);
    this.backupArchiveNameSuffix = process.env.CODEX_AGENT_BACKUP_ARCHIVE_SUFFIX || '-skills-agents-backup-';
    this.backupsRoot = this._envPath('CODEX_AGENT_BACKUPS_ROOT') || path.join(this.codexHome, 'backups');
  }

  get skillsRoot(): string { return path.join(this.codexHome, 'skills'); }
  get agentsRoot(): string { return path.join(this.codexHome, 'agents'); }
  get geminiSkillsRoot(): string { return path.join(this.geminiHome, 'skills'); }
  get geminiAgentsRoot(): string { return path.join(this.geminiHome, 'agents'); }
  get opencodeSkillsRoot(): string { return path.join(this.opencodeHome, 'skills'); }
  get opencodeAgentsRoot(): string { return path.join(this.opencodeHome, 'agents'); }
  get claudecodeSkillsRoot(): string { return path.join(this.claudecodeHome, 'skills'); }
  get claudecodeAgentsRoot(): string { return path.join(this.claudecodeHome, 'agents'); }
  get configTomlPath(): string { return path.join(this.codexHome, 'config.toml'); }
  get historyFilePath(): string { return path.join(this.codexHome, this.historyFileName); }

  getHome(engine?: string): string {
    const target = engine || this.defaultEngine;
    switch (target) {
      case 'gemini': return this.geminiHome;
      case 'opencode': return this.opencodeHome;
      case 'claudecode': return this.claudecodeHome;
      default: return this.codexHome;
    }
  }

  getSkillsRoot(engine?: string): string {
    const target = engine || this.defaultEngine;
    switch (target) {
      case 'gemini': return this.geminiSkillsRoot;
      case 'opencode': return this.opencodeSkillsRoot;
      case 'claudecode': return this.claudecodeSkillsRoot;
      default: return this.skillsRoot;
    }
  }

  getAgentsRoot(engine?: string): string {
    const target = engine || this.defaultEngine;
    switch (target) {
      case 'gemini': return this.geminiAgentsRoot;
      case 'opencode': return this.opencodeAgentsRoot;
      case 'claudecode': return this.claudecodeAgentsRoot;
      default: return this.agentsRoot;
    }
  }

  getHistoryFilePath(engine?: string): string {
    const target = engine || this.defaultEngine;
    switch (target) {
      case 'gemini': return path.join(this.geminiHome, this.historyFileName);
      case 'opencode': return path.join(this.opencodeHome, this.historyFileName);
      case 'claudecode': return path.join(this.claudecodeHome, this.historyFileName);
      default: return path.join(this.codexHome, this.historyFileName);
    }
  }

  getStateDbPath(engine?: string): string {
    const target = engine || this.defaultEngine;
    switch (target) {
      case 'gemini': return path.join(this.geminiHome, this.stateDbName);
      case 'opencode': return path.join(this.opencodeHome, this.stateDbName);
      case 'claudecode': return path.join(this.claudecodeHome, this.stateDbName);
      default: return path.join(this.codexHome, this.stateDbName);
    }
  }

  getLogDbPath(engine?: string): string {
    const target = engine || this.defaultEngine;
    switch (target) {
      case 'gemini': return path.join(this.geminiHome, this.logDbName);
      case 'opencode': return path.join(this.opencodeHome, this.logDbName);
      case 'claudecode': return path.join(this.claudecodeHome, this.logDbName);
      default: return path.join(this.codexHome, this.logDbName);
    }
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
