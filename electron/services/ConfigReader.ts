/**
 * ConfigReader — 설정/에이전트/스킬 파일 읽기 및 관리 서비스.
 *
 * @what
 * - JSON/Toml 설정 파일, 에이전트 디렉토리, 스킬 디렉토리, SQLite DB, JSONL 히스토리
 *   등을 읽고 쓰는 통합 파일 시스템 접근 계층입니다.
 * - 엔진별(gemini, opencode, claudecode) 루트 경로를 기준으로 데이터를 탐색합니다.
 *
 * @design
 * - fs 직접 호출 대신 모든 파일 접근을 이 클래스로 중앙화하여 보안(허용 경로 검사)과
 *   일관성을 확보합니다.
 * - 자체 TOML 파서를 내장하여 외부 의존성 없이 agent.toml을 읽습니다.
 *
 * @usage
 *   const reader = new ConfigReader();
 *   const agents = reader.listAgents();
 *   const skills = reader.readSkills('gemini');
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import type { AgentConfig } from '../../types/ipc-contract';
import { SETTINGS } from '../settings/AppSettings';

/** 설정 파일의 최상위 데이터 구조. agents 목록과 settings 키-값 쌍을 포함합니다. */
interface ConfigData {
  /** 등록된 에이전트 설정 배열 */
  agents?: AgentConfig[];
  /** 키-값 형태의 일반 설정 */
  settings?: Record<string, unknown>;
}

export class ConfigReader {
  /** 설정 파일의 절대 경로 */
  private configPath: string;
  /** 메모리에 로드된 설정 데이터 */
  private data: ConfigData = {};

  /**
   * ConfigReader 인스턴스를 생성합니다.
   * 설정 디렉토리가 없으면 생성하고 config.json을 로드합니다.
   */
  constructor() {
    const configDir = path.join(os.homedir(), '.config', 'agent-orchestrator');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    this.configPath = path.join(configDir, 'config.json');
    this.load();
  }

  /**
   * config.json 파일을 디스크에서 읽어 this.data에 로드합니다.
   * 파일이 없거나 파싱에 실패하면 빈 객체로 초기화합니다.
   */
  private load(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        this.data = JSON.parse(content);
      }
    } catch {
      this.data = {};
    }
  }

  /**
   * 현재 this.data를 config.json 파일로 디스크에 저장합니다.
   */
  private save(): void {
    fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2));
  }

  /**
   * 설정에서 지정된 키의 값을 반환합니다.
   * @param key - 조회할 설정 키
   * @returns 키에 해당하는 값, 없으면 undefined
   */
  get(key: string): unknown {
    return this.data.settings?.[key];
  }

  /**
   * 설정에 키-값 쌍을 저장하고 즉시 디스크에 씁니다.
   * @param key - 저장할 설정 키
   * @param value - 저장할 값
   */
  set(key: string, value: unknown): void {
    if (!this.data.settings) {
      this.data.settings = {};
    }
    this.data.settings[key] = value;
    this.save();
  }

  /**
   * 지정된 엔진의 skills 루트와 agents 루트 경로를 반환합니다.
   * @param engine - 엔진 이름 (기본값: SETTINGS.defaultEngine)
   * @returns skillsRoot와 agentsRoot를 포함한 객체
   */
  getEngineRoots(engine?: string): { skillsRoot: string; agentsRoot: string } {
    return {
      skillsRoot: SETTINGS.getSkillsRoot(engine),
      agentsRoot: SETTINGS.getAgentsRoot(engine),
    };
  }

  /**
   * 지정된 엔진의 skills 디렉토리에서 SKILL.md 파일이 있는 모든 스킬을 읽습니다.
   * @param engine - 엔진 이름 (선택)
   * @returns 스킬 이름과 경로 배열 (이름순 정렬)
   */
  readSkills(engine?: string): Array<{ name: string; path: string }> {
    const { skillsRoot } = this.getEngineRoots(engine);
    if (!fs.existsSync(skillsRoot)) return [];
    const skills: Array<{ name: string; path: string }> = [];
    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        skills.push({ name: entry.name, path: skillFile });
      }
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return skills;
  }

  /**
   * 지정된 엔진의 agents 디렉토리에서 config.json/agent.toml 파일이 있는 모든 에이전트를 읽습니다.
   * @param engine - 엔진 이름 (선택)
   * @returns 파싱된 에이전트 설정 객체 배열
   */
  readAgents(engine?: string): Array<Record<string, unknown>> {
    const { agentsRoot } = this.getEngineRoots(engine);
    if (!fs.existsSync(agentsRoot)) return [];
    const agents: Array<Record<string, unknown>> = [];
    const entries = fs.readdirSync(agentsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const agentDir = path.join(agentsRoot, entry.name);
      const configFile = path.join(agentDir, 'config.json');
      const tomlFile = path.join(agentDir, 'agent.toml');
      if (!fs.existsSync(configFile) && !fs.existsSync(tomlFile)) continue;
      try {
        let parsed: Record<string, unknown>;
        if (fs.existsSync(tomlFile)) {
          const raw = fs.readFileSync(tomlFile, 'utf-8');
          parsed = this._parseToml(raw);
        } else {
          parsed = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        }
        if (!parsed.name) parsed.name = entry.name;
        agents.push(parsed);
      } catch {
        agents.push({
          name: entry.name,
          description: '손상된 설정 파일',
          routing_type: 'unknown',
          skill_name: null,
          skill_path: null,
          broken: true,
        });
      }
    }
    return agents;
  }

  /**
   * 지정된 엔진의 router-agent config.json 파일을 읽어 반환합니다.
   * @param engine - 엔진 이름 (선택)
   * @returns 라우터 설정 객체, 없으면 빈 객체
   */
  readRouterConfig(engine?: string): Record<string, unknown> {
    const { agentsRoot } = this.getEngineRoots(engine);
    const routerPath = path.join(agentsRoot, 'router-agent', 'config.json');
    if (!fs.existsSync(routerPath)) return {};
    try {
      return JSON.parse(fs.readFileSync(routerPath, 'utf-8'));
    } catch {
      return {};
    }
  }

  /**
   * config.toml에서 활성화된 스킬 경로를 읽어 Set으로 반환합니다.
   * @returns 활성화된 스킬 디렉토리 경로 Set
   */
  readEnabledSkillPaths(): Set<string> {
    const configPath = SETTINGS.configTomlPath;
    if (!fs.existsSync(configPath)) return new Set();
    const enabled = new Set<string>();
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = this._parseToml(raw);
      const skillsSection = parsed.skills;
      if (skillsSection && typeof skillsSection === 'object') {
        const configItems = (skillsSection as Record<string, unknown>).config;
        if (Array.isArray(configItems)) {
          for (const item of configItems) {
            if (item && typeof item === 'object' && (item as Record<string, unknown>).enabled && (item as Record<string, unknown>).path) {
              enabled.add(String((item as Record<string, unknown>).path));
            }
          }
        }
      }
    } catch { /* ignore */ }
    return enabled;
  }

  /**
   * 엔진의 state DB에서 최근 스레드 목록을 조회합니다.
   * @param limit - 최대 조회 개수 (기본값 10)
   * @param engine - 엔진 이름 (선택)
   * @returns 스레드 레코드 배열
   */
  readRecentThreads(limit = 10, engine?: string): Array<Record<string, unknown>> {
    return this._readSqlite(SETTINGS.getStateDbPath(engine),
      'SELECT id, title, updated_at, agent_role, agent_nickname FROM threads ORDER BY updated_at DESC LIMIT ?',
      [limit]);
  }

  /**
   * 엔진의 log DB에서 최근 로그 항목을 조회합니다.
   * @param limit - 최대 조회 개수 (기본값 20)
   * @param engine - 엔진 이름 (선택)
   * @returns 로그 레코드 배열
   */
  readRecentLogs(limit = 20, engine?: string): Array<Record<string, unknown>> {
    return this._readSqlite(SETTINGS.getLogDbPath(engine),
      'SELECT ts, level, target, feedback_log_body FROM logs ORDER BY ts DESC, ts_nanos DESC, id DESC LIMIT ?',
      [limit]);
  }

  /**
   * 엔진의 JSONL 히스토리 파일 전체를 읽어 배열로 반환합니다.
   * @param engine - 엔진 이름 (선택)
   * @returns 히스토리 항목 배열
   */
  readHistory(engine?: string): Array<Record<string, unknown>> {
    return this._readJsonLines(SETTINGS.getHistoryFilePath(engine));
  }

  /**
   * 엔진의 JSONL 히스토리에서 최근 N개 항목을 역순으로 읽습니다.
   * @param limit - 최대 조회 개수 (기본값 20)
   * @param engine - 엔진 이름 (선택)
   * @returns 최근 히스토리 항목 배열 (최신순)
   */
  readRecentHistory(limit = 20, engine?: string): Array<Record<string, unknown>> {
    const items = this._readJsonLines(SETTINGS.getHistoryFilePath(engine));
    return items.slice(-limit).reverse();
  }

  /**
   * 현재 시간의 ISO-8601 문자열을 반환합니다.
   * @returns ISO-8601 형식의 현재 시각
   */
  getScanTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * 설정된 에이전트와 디스크에서 발견된 모든 에이전트를 병합하여 반환합니다.
   * 여러 엔진(gemini, opencode, claudecode)을 순회하며 스캔합니다.
   * @returns 모든 에이전트 설정 배열
   */
  listAgents(): AgentConfig[] {
    const configured = this.data.agents ?? [];
    const configuredIds = new Set(configured.map(a => a.id));
    const discovered: AgentConfig[] = [];
    const engines = ['gemini', 'opencode', 'claudecode'] as const;
    for (const engine of engines) {
      const engineSeen = new Set(configuredIds);
      const agentsDir = SETTINGS.getAgentsRoot(engine);
      let agents = this.scanAgentDir(agentsDir, engine, engineSeen);
      if (agents.length === 0) {
        let skillsDir = SETTINGS.getSkillsRoot(engine);
        agents = this._agentsFromSkills(skillsDir, engine, engineSeen);
        if (agents.length === 0 && fs.existsSync(SETTINGS.getSkillsRoot('claudecode'))) {
          agents = this._agentsFromSkills(SETTINGS.getSkillsRoot('claudecode'), engine, engineSeen);
        }
      }
      discovered.push(...agents);
    }
    return [...configured, ...discovered];
  }

  /**
   * skills 디렉토리의 SKILL.md 파일을 기반으로 에이전트 설정을 생성합니다.
   * @param skillsDir - 스킬 디렉토리 경로
   * @param engine - 엔진 이름
   * @param seenIds - 이미 발견된 에이전트 ID 집합 (중복 방지)
   * @returns 생성된 에이전트 설정 배열
   */
  private _agentsFromSkills(skillsDir: string, engine: string, seenIds: Set<string>): AgentConfig[] {
    try {
      if (!fs.existsSync(skillsDir)) return [];
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      const agents: AgentConfig[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (seenIds.has(entry.name)) continue;
        const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        seenIds.add(entry.name);
        agents.push({
          id: `skill-${entry.name}`,
          name: entry.name,
          engine: engine as 'gemini' | 'opencode' | 'claudecode',
          description: `Auto-generated from ${engine} skill`,
          department: engine,
        });
      }
      return agents;
    } catch {
      return [];
    }
  }

  /**
   * 에이전트 디렉토리를 스캔하여 config.json 또는 agent.toml 파일에서 에이전트 설정을 읽습니다.
   * @param dirPath - 에이전트 디렉토리 경로
   * @param engine - 엔진 이름
   * @param seenIds - 이미 발견된 에이전트 ID 집합 (중복 방지)
   * @returns 발견된 에이전트 설정 배열
   */
  private scanAgentDir(dirPath: string, engine: string, seenIds: Set<string>): AgentConfig[] {
    try {
      if (!fs.existsSync(dirPath)) return [];
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const agents: AgentConfig[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (seenIds.has(entry.name)) continue;
        const configPath = path.join(dirPath, entry.name, 'config.json');
        const tomlPath = path.join(dirPath, entry.name, 'agent.toml');
        let name = entry.name;
        let description = '';
        let department = '';
        let agentEngine = engine;
        try {
          if (fs.existsSync(configPath)) {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            name = cfg.name ?? entry.name;
            description = cfg.description ?? '';
            department = cfg.department ?? '';
            if (cfg.engine && typeof cfg.engine === 'string') agentEngine = cfg.engine;
          } else if (fs.existsSync(tomlPath)) {
            const cfg = this._parseToml(fs.readFileSync(tomlPath, 'utf-8'));
            name = (cfg.name as string) ?? entry.name;
            description = (cfg.description as string) ?? '';
            department = (cfg.department as string) ?? '';
            if (cfg.engine && typeof cfg.engine === 'string') agentEngine = cfg.engine as string;
          }
        } catch {}
        seenIds.add(entry.name);
        agents.push({
          id: entry.name,
          name,
          engine: agentEngine as 'gemini' | 'opencode' | 'claudecode',
          description: description || undefined,
          department: department || undefined,
        });
      }
      return agents;
    } catch {
      return [];
    }
  }

  /**
   * 에이전트 설정을 저장합니다. 기존 항목은 갱신, 신규 항목은 추가합니다.
   * @param agent - 저장할 에이전트 설정
   */
  saveAgent(agent: AgentConfig): void {
    const existing = (this.data.agents ?? []).findIndex(a => a.id === agent.id);
    if (existing >= 0) {
      this.data.agents![existing] = agent;
    } else {
      if (!this.data.agents) this.data.agents = [];
      this.data.agents.push(agent);
    }
    this.save();
  }

  /**
   * 지정된 ID의 에이전트를 설정에서 제거합니다.
   * @param agentId - 삭제할 에이전트 ID
   * @returns 삭제 성공 여부
   */
  deleteAgent(agentId: string): boolean {
    if (!this.data.agents) return false;
    const idx = this.data.agents.findIndex(a => a.id === agentId);
    if (idx < 0) return false;
    this.data.agents.splice(idx, 1);
    this.save();
    return true;
  }

  /**
   * 지정된 파일을 읽어 내용과 언어 정보를 반환합니다. 경로 보안 검사를 수행합니다.
   * @param filePath - 읽을 파일의 절대/상대 경로
   * @returns 파일 내용과 추정된 언어, 실패 시 null
   */
  readFile(filePath: string): { content: string; language: string } | null {
    try {
      const resolved = path.resolve(filePath);
      if (!this.isAllowedPath(resolved)) throw new Error('Path traversal detected');
      const content = fs.readFileSync(resolved, 'utf-8');
      const ext = path.extname(resolved).toLowerCase().slice(1);
      const languageMap: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        json: 'json', md: 'markdown', py: 'python', go: 'go', rs: 'rust',
        java: 'java', css: 'css', scss: 'scss', html: 'html', xml: 'xml',
        yaml: 'yaml', yml: 'yaml', sh: 'shell', bash: 'shell', sql: 'sql',
      };
      return { content, language: languageMap[ext] ?? 'plaintext' };
    } catch {
      return null;
    }
  }

  /**
   * 지정된 디렉토리 목록을 재귀적으로 읽어 트리 구조로 반환합니다.
   * @param dirPath - 읽을 디렉토리 경로
   * @param recursive - 하위 디렉토리까지 재귀 탐색 여부
   * @returns 디렉토리 엔트리 트리, 실패 시 null
   */
  readDir(dirPath: string, recursive: boolean): ReturnType<typeof this._readDir> | null {
    try {
      return this._readDir(path.resolve(dirPath), recursive);
    } catch {
      return null;
    }
  }

  /**
   * 내부 재귀 디렉토리 읽기 구현. 경로 보안 검사를 수행합니다.
   * @param resolved - 확인된 절대 경로
   * @param recursive - 하위 디렉토리 재귀 탐색 여부
   * @returns 디렉토리 엔트리 트리, 경로 없으면 null
   */
  private _readDir(resolved: string, recursive: boolean): { entries: Array<{ name: string; path: string; type: 'file' | 'directory'; children?: Array<{ name: string; path: string; type: 'file' | 'directory' }> }> } | null {
    if (!this.isAllowedPath(resolved)) throw new Error('Path traversal detected');
    if (!fs.existsSync(resolved)) return null;
    const entries: Array<{ name: string; path: string; type: 'file' | 'directory'; children?: Array<{ name: string; path: string; type: 'file' | 'directory' }> }> = [];
    const items = fs.readdirSync(resolved, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(resolved, item.name);
      const node: { name: string; path: string; type: 'file' | 'directory'; children?: Array<{ name: string; path: string; type: 'file' | 'directory' }> } = {
        name: item.name, path: fullPath, type: item.isDirectory() ? 'directory' : 'file',
      };
      if (item.isDirectory() && recursive) {
        const sub = this._readDir(fullPath, false);
        if (sub) node.children = sub.entries;
      }
      entries.push(node);
    }
    return { entries };
  }

  /**
   * 지정된 경로에 파일을 씁니다. 경로 보안 검사를 수행하고 필요시 상위 디렉토리를 생성합니다.
   * @param filePath - 쓸 파일의 경로
   * @param content - 파일에 쓸 내용
   * @returns 쓰기 성공 여부
   */
  writeFile(filePath: string, content: string): boolean {
    try {
      const resolved = path.resolve(filePath);
      if (!this.isAllowedPath(resolved)) throw new Error('Path traversal detected');
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, content, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 지정된 디렉토리의 파일/폴더 이름 목록을 반환합니다. 디렉토리에는 '/' 접미사를 붙입니다.
   * @param dirPath - 조회할 디렉토리 경로
   * @returns 엔트리 이름 배열 (실패 시 null)
   */
  listDir(dirPath: string): string[] | null {
    try {
      const resolved = path.resolve(dirPath);
      if (!fs.existsSync(resolved)) return null;
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      return entries.map(e => `${e.name}${e.isDirectory() ? '/' : ''}`);
    } catch {
      return null;
    }
  }

  /**
   * CLI 실행 파일의 유효성을 검증합니다. --version 플래그로 실행 가능 여부와 버전을 확인합니다.
   * @param cliPath - 검증할 CLI 실행 파일 경로
   * @returns 유효성, 버전, 오류 메시지를 포함한 객체
   */
  async validateCliPath(cliPath: string): Promise<{ valid: boolean; version?: string; error?: string }> {
    if (!cliPath) return { valid: false, error: 'CLI path is required' };
    const resolved = path.resolve(cliPath);
    if (!fs.existsSync(resolved)) return { valid: false, error: 'CLI not found at path' };
    try {
      return new Promise((resolve) => {
        const proc = spawn(resolved, ['--version'], { timeout: 5000 });
        let output = '';
        proc.stdout?.on('data', (data) => { output += data.toString(); });
        proc.on('close', (code) => {
          if (code === 0 && output.trim()) resolve({ valid: true, version: output.trim() });
          else resolve({ valid: false, error: `Exit code: ${code}` });
        });
        proc.on('error', (err) => resolve({ valid: false, error: err.message }));
        setTimeout(() => { proc.kill(); resolve({ valid: false, error: 'Timeout' }); }, 5000);
      });
    } catch (err) {
      return { valid: false, error: String(err) };
    }
  }

  /**
   * 엔진 이름에 해당하는 CLI 실행 파일의 절대 경로를 검색하여 반환합니다.
   * 여러 표준 경로(/opt/homebrew/bin, /usr/local/bin 등)와 PATH를 순회합니다.
   * @param engine - 엔진 이름 (gemini, opencode, claudecode)
   * @returns CLI 실행 파일의 절대 경로, 없으면 null
   */
  getEnginePath(engine: string): string | null {
    const binaryMap: Record<string, string> = {
      gemini: 'gemini', opencode: 'opencode', claudecode: 'claude',
    };
    const binary = binaryMap[engine] ?? engine;
    const searchDirs = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/home/linuxbrew/.linuxbrew/bin',
      path.join(os.homedir(), '.nvm', 'versions', 'node', '*', 'bin'),
      path.join(os.homedir(), '.local', 'bin'),
    ];
    const pathDirs = (process.env.PATH ?? '').split(':');
    const allDirs = [...new Set([...searchDirs, ...pathDirs])];
    for (const dir of allDirs) {
      try {
        const candidate = path.join(dir, binary);
        if (fs.existsSync(candidate)) {
          return fs.realpathSync(candidate);
        }
      } catch {}
    }
    return null;
  }

  /**
   * 기본 통계 정보를 반환합니다. 현재는 총 에이전트 수만 실제로 계산합니다.
   * @returns 총 실행 수, 총 에이전트 수, 업타임을 포함한 통계 객체
   */
  getStats(): { totalRuns: number; totalAgents: number; uptime: number } {
    return { totalRuns: 0, totalAgents: this.listAgents().length, uptime: 0 };
  }

  /**
   * 주어진 경로가 허용된 경로(사용자 홈 디렉토리 내)인지 확인합니다.
   * @param p - 검증할 파일 경로
   * @returns 허용된 경로면 true
   */
  isAllowedPath(p: string): boolean {
    try {
      return fs.realpathSync(p).startsWith(fs.realpathSync(os.homedir()));
    } catch {
      return p.startsWith(os.homedir());
    }
  }

  /**
   * SQLite DB에 읽기 전용으로 연결하여 쿼리를 실행하고 결과를 반환합니다.
   * @param dbPath - SQLite 데이터베이스 파일 경로
   * @param query - 실행할 SQL 쿼리
   * @param params - 쿼리 바인딩 파라미터
   * @returns 쿼리 결과 레코드 배열
   */
  private _readSqlite(dbPath: string, query: string, params: unknown[]): Array<Record<string, unknown>> {
    if (!fs.existsSync(dbPath)) return [];
    try {
      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare(query).all(...params) as Array<Record<string, unknown>>;
      db.close();
      return rows;
    } catch {
      return [];
    }
  }

  /**
   * JSONL(Newline-delimited JSON) 파일을 읽어 각 줄을 파싱하여 배열로 반환합니다.
   * @param filePath - JSONL 파일 경로
   * @returns 파싱된 JSON 객체 배열
   */
  private _readJsonLines(filePath: string): Array<Record<string, unknown>> {
    if (!fs.existsSync(filePath)) return [];
    const items: Array<Record<string, unknown>> = [];
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n').filter(Boolean)) {
      try {
        items.push(JSON.parse(line));
      } catch { /* skip malformed lines */ }
    }
    return items;
  }

  /**
   * 최소 TOML 파서. 중첩 섹션 및 기본 타입(문자열, 숫자, boolean)을 지원합니다.
   * @param raw - 파싱할 TOML 원본 문자열
   * @returns 파싱된 객체
   */
  private _parseToml(raw: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let currentSection: Record<string, unknown> = result;
    const sectionStack: Array<{ key: string; obj: Record<string, unknown> }> = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        const keys = sectionMatch[1]!.split('.');
        currentSection = result;
        for (const key of keys) {
          if (!currentSection[key] || typeof currentSection[key] !== 'object') {
            currentSection[key] = {};
          }
          currentSection = currentSection[key] as Record<string, unknown>;
        }
        continue;
      }
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value: unknown = trimmed.slice(eqIdx + 1).trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (/^[0-9]+$/.test(String(value))) value = parseInt(String(value), 10);
      else if ((String(value).startsWith('"') || String(value).startsWith("'")) && (String(value).endsWith('"') || String(value).endsWith("'"))) {
        value = String(value).slice(1, -1);
      }
      currentSection[key] = value;
    }
    return result;
  }
}
