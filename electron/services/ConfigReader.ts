import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import type { AgentConfig } from '../../types/ipc-contract';
import { SETTINGS } from '../settings/AppSettings';

interface ConfigData {
  agents?: AgentConfig[];
  settings?: Record<string, unknown>;
}

export class ConfigReader {
  private configPath: string;
  private data: ConfigData = {};

  constructor() {
    const configDir = path.join(os.homedir(), '.config', 'agent-orchestrator');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    this.configPath = path.join(configDir, 'config.json');
    this.load();
  }

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

  private save(): void {
    fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2));
  }

  get(key: string): unknown {
    return this.data.settings?.[key];
  }

  set(key: string, value: unknown): void {
    if (!this.data.settings) {
      this.data.settings = {};
    }
    this.data.settings[key] = value;
    this.save();
  }

  getEngineRoots(engine?: string): { skillsRoot: string; agentsRoot: string } {
    return {
      skillsRoot: SETTINGS.getSkillsRoot(engine),
      agentsRoot: SETTINGS.getAgentsRoot(engine),
    };
  }

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

  readRecentThreads(limit = 10, engine?: string): Array<Record<string, unknown>> {
    return this._readSqlite(SETTINGS.getStateDbPath(engine),
      'SELECT id, title, updated_at, agent_role, agent_nickname FROM threads ORDER BY updated_at DESC LIMIT ?',
      [limit]);
  }

  readRecentLogs(limit = 20, engine?: string): Array<Record<string, unknown>> {
    return this._readSqlite(SETTINGS.getLogDbPath(engine),
      'SELECT ts, level, target, feedback_log_body FROM logs ORDER BY ts DESC, ts_nanos DESC, id DESC LIMIT ?',
      [limit]);
  }

  readHistory(engine?: string): Array<Record<string, unknown>> {
    return this._readJsonLines(SETTINGS.getHistoryFilePath(engine));
  }

  readRecentHistory(limit = 20, engine?: string): Array<Record<string, unknown>> {
    const items = this._readJsonLines(SETTINGS.getHistoryFilePath(engine));
    return items.slice(-limit).reverse();
  }

  getScanTimestamp(): string {
    return new Date().toISOString();
  }

  listAgents(): AgentConfig[] {
    const configured = this.data.agents ?? [];
    const configuredIds = new Set(configured.map(a => a.id));
    const discovered: AgentConfig[] = [];
    const engines = ['gemini', 'codex', 'opencode', 'claudecode'] as const;
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
          engine: engine as 'gemini' | 'codex' | 'opencode' | 'claudecode',
          description: `Auto-generated from ${engine} skill`,
          department: engine,
        });
      }
      return agents;
    } catch {
      return [];
    }
  }

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
          engine: agentEngine as 'gemini' | 'codex' | 'opencode' | 'claudecode',
          description: description || undefined,
          department: department || undefined,
        });
      }
      return agents;
    } catch {
      return [];
    }
  }

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

  deleteAgent(agentId: string): boolean {
    if (!this.data.agents) return false;
    const idx = this.data.agents.findIndex(a => a.id === agentId);
    if (idx < 0) return false;
    this.data.agents.splice(idx, 1);
    this.save();
    return true;
  }

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

  readDir(dirPath: string, recursive: boolean): ReturnType<typeof this._readDir> | null {
    try {
      return this._readDir(path.resolve(dirPath), recursive);
    } catch {
      return null;
    }
  }

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

  getEnginePath(engine: string): string | null {
    const binaryMap: Record<string, string> = {
      codex: 'codex', gemini: 'gemini', opencode: 'opencode', claudecode: 'claude',
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

  getStats(): { totalRuns: number; totalAgents: number; uptime: number } {
    return { totalRuns: 0, totalAgents: this.listAgents().length, uptime: 0 };
  }

  isAllowedPath(p: string): boolean {
    try {
      return fs.realpathSync(p).startsWith(fs.realpathSync(os.homedir()));
    } catch {
      return p.startsWith(os.homedir());
    }
  }

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
