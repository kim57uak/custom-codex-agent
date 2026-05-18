/**
 * AppSettings — 애플리케이션 전역 설정 싱글톤.
 *
 * @what
 * - 엔진별(codex, gemini, opencode, claudecode) 홈 디렉토리, 실행 제한, CLI 경로,
 *   작업 공간, 백업 경로 등 모든 전역 설정을 보유합니다.
 * - 환경 변수(CODEX_AGENT_*)로 설정을 오버라이드할 수 있습니다.
 *
 * @design
 * - 싱글톤(SETTINGS)으로 애플리케이션 전체에서 일관된 설정에 접근합니다.
 * - 엔진별 경로 해석을 switch 문으로 중앙화하여 getSkillsRoot()/getAgentsRoot() 등에서
 *   일관된 경로를 반환합니다.
 * - _envInt / _envPath 헬퍼로 환경 변수 파싱을 안전하게 처리합니다.
 *
 * @usage
 *   import { SETTINGS } from './AppSettings';
 *   const skillsRoot = SETTINGS.getSkillsRoot('gemini');
 *   SETTINGS.setDefaultEngine('claudecode');
 */
import path from 'path';
import os from 'os';
import fs from 'fs';


/** 지원하는 AI 엔진 타입 */
export type EngineType = 'codex' | 'gemini' | 'opencode' | 'claudecode';

export class AppSettings {
  /** Codex 엔진 홈 디렉토리 (기본: ~/.codex) */
  readonly codexHome: string;
  /** Gemini 엔진 홈 디렉토리 (기본: ~/.gemini/antigravity) */
  readonly geminiHome: string;
  /** OpenCode 엔진 홈 디렉토리 (기본: ~/.opencode) */
  readonly opencodeHome: string;
  /** Claude Code 엔진 홈 디렉토리 (기본: ~/.claude) */
  readonly claudecodeHome: string;
  /** 히스토리 파일명 */
  readonly historyFileName = 'history.jsonl';
  /** 상태 DB 파일명 */
  readonly stateDbName = 'state_5.sqlite';
  /** 로그 DB 파일명 */
  readonly logDbName = 'logs_2.sqlite';
  /** 실행 레코드 DB 파일명 */
  readonly runDbName = 'runs.db';
  /** 최대 동시 실행 수 */
  readonly runMaxConcurrency: number;
  /** 실행 타임아웃 (초) */
  readonly runTimeoutSeconds: number;
  /** 실행 프롬프트 최대 길이 */
  readonly runPromptMaxLength: number;
  /** 백업 아카이브 이름 접미사 */
  readonly backupArchiveNameSuffix: string;
  /** codex CLI 실행 파일명 */
  readonly codexCliExecutable: string;
  /** gemini CLI 실행 파일명 */
  readonly geminiCliExecutable: string;
  /** opencode CLI 실행 파일명 */
  readonly opencodeCliExecutable: string;
  /** claude CLI 실행 파일명 */
  readonly claudecodeCliExecutable: string;
  /** 창업자(대표) 이름 */
  readonly founderName: string;
  /** 작업 공간 루트 경로 */
  readonly workspaceRoot: string;
  /** 기본 엔진 오버라이드 (null이면 환경변수 또는 'gemini') */
  private _defaultEngineOverride: EngineType | null = null;

  /**
   * 현재 설정된 기본 엔진을 반환합니다.
   * 오버라이드 → 환경변수(CODEX_AGENT_DEFAULT_ENGINE) → 'gemini' 순으로 결정됩니다.
   */
  get defaultEngine(): EngineType {
    if (this._defaultEngineOverride) return this._defaultEngineOverride;
    const env = process.env.CODEX_AGENT_DEFAULT_ENGINE;
    const valid: EngineType[] = ['codex', 'gemini', 'opencode', 'claudecode'];
    return valid.includes(env as EngineType) ? (env as EngineType) : 'gemini';
  }

  /**
   * 기본 엔진을 런타임에 오버라이드합니다.
   * @param engine - 설정할 엔진 타입
   */
  setDefaultEngine(engine: EngineType): void {
    this._defaultEngineOverride = engine;
  }

  /** 워크플로우 추천 최대 에이전트 수 */
  readonly workflowRecommendationMaxAgents: number;
  /** 실행 목록 기본 조회 개수 */
  readonly runListLimitDefault = 30;
  /** 실행 이벤트 목록 기본 조회 개수 */
  readonly runEventListLimitDefault = 100;
  /** 워크플로우 이벤트 목록 기본 조회 개수 */
  readonly workflowEventListLimitDefault = 100;
  /** 안전한 텍스트 읽기 최대 문자 수 */
  readonly safeReadTextMaxChars = 160000;
  /** 실행 프롬프트 미리보기 최대 문자 수 */
  readonly runPromptPreviewMaxChars = 120;
  /** 워크플로우 목표 미리보기 최대 문자 수 */
  readonly workflowGoalPreviewMaxChars = 140;
  /** 트렌드 분석 기간 (일) */
  readonly trendWindowDays = 7;
  /** 트렌드 버킷 개수 */
  readonly trendBuckets = 12;
  /** 대시보드 최근 스레드 조회 개수 */
  readonly dashboardRecentThreadsLimit = 10;
  /** 대시보드 최근 로그 조회 개수 */
  readonly dashboardRecentLogsLimit = 20;
  /** 대시보드 최근 히스토리 조회 개수 */
  readonly dashboardRecentHistoryLimit = 20;
  /** 백업 저장 루트 디렉토리 */
  readonly backupsRoot: string;
  /** 디렉토리 목록 최대 조회 개수 */
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

  /** codex 엔진의 skills 디렉토리 경로 */
  get skillsRoot(): string { return path.join(this.codexHome, 'skills'); }
  /** codex 엔진의 agents 디렉토리 경로 */
  get agentsRoot(): string { return path.join(this.codexHome, 'agents'); }
  /** gemini 엔진의 skills 디렉토리 경로 */
  get geminiSkillsRoot(): string { return path.join(this.geminiHome, 'skills'); }
  /** gemini 엔진의 agents 디렉토리 경로 */
  get geminiAgentsRoot(): string { return path.join(this.geminiHome, 'agents'); }
  /** opencode 엔진의 skills 디렉토리 경로 */
  get opencodeSkillsRoot(): string { return path.join(this.opencodeHome, 'skills'); }
  /** opencode 엔진의 agents 디렉토리 경로 */
  get opencodeAgentsRoot(): string { return path.join(this.opencodeHome, 'agents'); }
  /** claudecode 엔진의 skills 디렉토리 경로 */
  get claudecodeSkillsRoot(): string { return path.join(this.claudecodeHome, 'skills'); }
  /** claudecode 엔진의 agents 디렉토리 경로 */
  get claudecodeAgentsRoot(): string { return path.join(this.claudecodeHome, 'agents'); }
  /** codex config.toml 파일 경로 */
  get configTomlPath(): string { return path.join(this.codexHome, 'config.toml'); }
  /** codex 히스토리 파일 경로 */
  get historyFilePath(): string { return path.join(this.codexHome, this.historyFileName); }

  /**
   * 지정된 엔진의 홈 디렉토리를 반환합니다.
   * @param engine - 엔진 이름 (기본값: defaultEngine)
   * @returns 엔진 홈 디렉토리 경로
   */
  getHome(engine?: string): string {
    const target = engine || this.defaultEngine;
    switch (target) {
      case 'gemini': return this.geminiHome;
      case 'opencode': return this.opencodeHome;
      case 'claudecode': return this.claudecodeHome;
      default: return this.codexHome;
    }
  }

  /**
   * 지정된 엔진의 skills 루트 디렉토리를 반환합니다.
   * @param engine - 엔진 이름 (기본값: defaultEngine)
   * @returns skills 디렉토리 경로
   */
  getSkillsRoot(engine?: string): string {
    const target = engine || this.defaultEngine;
    switch (target) {
      case 'gemini': return this.geminiSkillsRoot;
      case 'opencode': return this.opencodeSkillsRoot;
      case 'claudecode': return this.claudecodeSkillsRoot;
      default: return this.skillsRoot;
    }
  }

  /**
   * 지정된 엔진의 agents 루트 디렉토리를 반환합니다.
   * @param engine - 엔진 이름 (기본값: defaultEngine)
   * @returns agents 디렉토리 경로
   */
  getAgentsRoot(engine?: string): string {
    const target = engine || this.defaultEngine;
    switch (target) {
      case 'gemini': return this.geminiAgentsRoot;
      case 'opencode': return this.opencodeAgentsRoot;
      case 'claudecode': return this.claudecodeAgentsRoot;
      default: return this.agentsRoot;
    }
  }

  /**
   * 지정된 엔진의 히스토리 파일 경로를 반환합니다.
   * @param engine - 엔진 이름 (기본값: defaultEngine)
   * @returns 히스토리 파일 절대 경로
   */
  getHistoryFilePath(engine?: string): string {
    const target = engine || this.defaultEngine;
    switch (target) {
      case 'gemini': return path.join(this.geminiHome, this.historyFileName);
      case 'opencode': return path.join(this.opencodeHome, this.historyFileName);
      case 'claudecode': return path.join(this.claudecodeHome, this.historyFileName);
      default: return path.join(this.codexHome, this.historyFileName);
    }
  }

  /**
   * 지정된 엔진의 state DB 파일 경로를 반환합니다.
   * @param engine - 엔진 이름 (기본값: defaultEngine)
   * @returns state DB 파일 절대 경로
   */
  getStateDbPath(engine?: string): string {
    const target = engine || this.defaultEngine;
    switch (target) {
      case 'gemini': return path.join(this.geminiHome, this.stateDbName);
      case 'opencode': return path.join(this.opencodeHome, this.stateDbName);
      case 'claudecode': return path.join(this.claudecodeHome, this.stateDbName);
      default: return path.join(this.codexHome, this.stateDbName);
    }
  }

  /**
   * 지정된 엔진의 log DB 파일 경로를 반환합니다.
   * @param engine - 엔진 이름 (기본값: defaultEngine)
   * @returns log DB 파일 절대 경로
   */
  getLogDbPath(engine?: string): string {
    const target = engine || this.defaultEngine;
    switch (target) {
      case 'gemini': return path.join(this.geminiHome, this.logDbName);
      case 'opencode': return path.join(this.opencodeHome, this.logDbName);
      case 'claudecode': return path.join(this.claudecodeHome, this.logDbName);
      default: return path.join(this.codexHome, this.logDbName);
    }
  }

  /**
   * 환경 변수에서 경로 문자열을 안전하게 읽습니다. ~는 홈 디렉토리로 확장됩니다.
   * @param key - 환경 변수 이름
   * @returns 해석된 절대 경로, 값이 없으면 null
   */
  private _envPath(key: string): string | null {
    const v = process.env[key];
    if (v && v.trim()) return path.resolve(v.trim().replace(/^~/, os.homedir()));
    return null;
  }

  /**
   * 환경 변수에서 정수 값을 안전하게 읽습니다. 범위를 벗어나면 clamp 처리됩니다.
   * @param key - 환경 변수 이름
   * @param def - 기본값
   * @param min - 최소값 (선택)
   * @param max - 최대값 (선택)
   * @returns 파싱된 정수 값
   */
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
