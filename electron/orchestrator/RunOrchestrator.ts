import { spawn, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { request as httpReq } from 'http';
import { randomUUID } from 'crypto';
import { LogBuffer } from '../services/LogBuffer';
import { EventBroker } from '../services/EventBroker';
import { RunStore } from '../stores/RunStore';
import { ConfigReader } from '../services/ConfigReader';
import { SETTINGS } from '../settings/AppSettings';
import type { RunOptions, RunStatus, EngineType } from '../../types/ipc-contract';
import type { RunRecord } from '../stores/RunStore';

interface PidInfo {
  pid: number;
  runId: string;
  engine: EngineType;
  proc: ChildProcess;
}

const ALLOWED_COMMANDS = ['codex', 'gemini'] as const;

const ENV_SANITIZE_BLOCKLIST = [
  'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE',
];

export interface RunCreateResult {
  runId: string;
}

export class RunOrchestrator {
  private logBuffer: LogBuffer;
  private eventBroker: EventBroker;
  private runStore: RunStore;
  private configReader: ConfigReader;
  private pidRegistry = new Map<number, PidInfo>();
  private runningRuns = new Map<string, RunStatus>();
  private startTimes = new Map<string, number>();
  private activeProcesses = new Map<string, ChildProcess>();
  private maxConcurrency: number;
  private semaphoreCount = 0;
  private runQueue: Array<() => void> = [];
  private opencodeServer: ChildProcess | null = null;
  private readonly OPENCODE_PORT = 21789;

  constructor(deps: { logBuffer: LogBuffer; eventBroker: EventBroker }) {
    this.logBuffer = deps.logBuffer;
    this.eventBroker = deps.eventBroker;
    this.runStore = new RunStore();
    this.configReader = new ConfigReader();
    this.maxConcurrency = SETTINGS.runMaxConcurrency;
    this.setupLogBufferHandlers();
  }

  get defaultWorkspaceRoot(): string {
    return SETTINGS.workspaceRoot;
  }

  private setupLogBufferHandlers(): void {
    this.logBuffer.onFlush((entries) => {
      for (const entry of entries) {
        this.eventBroker.pushLog(entry.runId, entry.level, entry.message, entry.raw);
      }
    });
  }

  private async _acquireSemaphore(): Promise<void> {
    if (this.semaphoreCount < this.maxConcurrency) {
      this.semaphoreCount++;
      return;
    }
    return new Promise((resolve) => {
      this.runQueue.push(resolve);
    });
  }

  private _releaseSemaphore(): void {
    const next = this.runQueue.shift();
    if (next) {
      next();
    } else {
      this.semaphoreCount = Math.max(0, this.semaphoreCount - 1);
    }
  }

  private sanitizeEnv(): NodeJS.ProcessEnv {
    const sanitized: NodeJS.ProcessEnv = { ...process.env };
    for (const key of ENV_SANITIZE_BLOCKLIST) {
      delete sanitized[key];
    }
    return sanitized;
  }

  private _engineBinary(engine: string): string {
    const map: Record<string, string> = { codex: 'codex', gemini: 'gemini', opencode: 'opencode', claudecode: 'claude' };
    return map[engine] ?? engine;
  }

  private getCliPath(engine: EngineType, agentConfig?: { cliPath?: string | undefined }): string {
    if (agentConfig?.cliPath) return agentConfig.cliPath;
    const binary = this._engineBinary(engine);
    const pathEnv = process.env.PATH ?? '';
    for (const dir of pathEnv.split(':')) {
      const candidate = `${dir}/${binary}`;
      try { if (fs.existsSync(candidate)) return candidate; } catch {}
    }
    return binary;
  }

  async createRun(
    agentName: string, prompt: string, workspaceRoot?: string,
    sandboxMode?: string | null, approvalPolicy?: string | null, engine?: string,
  ): Promise<RunCreateResult> {
    const effectiveEngine = (engine || SETTINGS.defaultEngine) as EngineType;
    const run = this.runStore.createRun({
      agentId: agentName,
      agentName,
      prompt,
      workspace: workspaceRoot || SETTINGS.workspaceRoot,
      engine: effectiveEngine,
      sandboxMode: sandboxMode ?? null,
      approvalPolicy: approvalPolicy ?? null,
    } as Parameters<typeof this.runStore.createRun>[0]);
    this.runningRuns.set(run.id, 'queued');

    this.runStore.appendEvent(run.id, 'run:queued', `run queued for agent=${agentName} engine=${effectiveEngine}`);
    this._publishRunEvent(run.id, 'run:queued', `run queued for agent=${agentName} engine=${effectiveEngine}`);

    this._executeRun(run.id, agentName, prompt, run.workspace, effectiveEngine, sandboxMode, approvalPolicy);
    return { runId: run.id };
  }

  private async _executeRun(
    runId: string, agentName: string, prompt: string, workspaceRoot: string | null,
    engine: string, sandboxMode?: string | null, approvalPolicy?: string | null,
  ): Promise<void> {
    await this._acquireSemaphore();
    let proc: ChildProcess | null = null;
    try {
      const updated = this.runStore.markRunning(runId);
      if (!updated) return;
      this.runningRuns.set(runId, 'running');
      this.runStore.appendEvent(runId, 'run:started', `run started (engine=${engine})`);
      this._publishRunEvent(runId, 'run:started', `run started (engine=${engine})`);

      const skillContent = this._fetchSkillInfo(agentName, engine);
      const effectivePrompt = this._buildEffectivePrompt(agentName, prompt, skillContent);
      const sanitizedEnv = this.sanitizeEnv();
      const cliPath = this.getCliPath(engine as EngineType);

      const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
      const currentPath = sanitizedEnv.PATH ?? '';
      sanitizedEnv.PATH = [...extraPaths, currentPath].filter(Boolean).join(':');

      if (SETTINGS.geminiHome) sanitizedEnv.GEMINI_HOME = SETTINGS.geminiHome;
      if (SETTINGS.codexHome) sanitizedEnv.CODEX_HOME = SETTINGS.codexHome;

      for (const key of ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
        if (process.env[key]) sanitizedEnv[key] = process.env[key];
      }

      proc = spawn(cliPath, [effectivePrompt], {
        env: sanitizedEnv,
        shell: false,
        cwd: workspaceRoot ?? this.defaultWorkspaceRoot,
      });

      this.pidRegistry.set(proc.pid!, { pid: proc.pid!, runId, engine: engine as EngineType, proc });
      this.activeProcesses.set(runId, proc);

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        for (const line of text.split('\n').filter(Boolean)) {
          this.runStore.addEvent(runId, 'run:stdout', line);
          this._publishRunEvent(runId, 'run:stdout', line);
          this.logBuffer.push({
            runId, level: 'info', message: line, timestamp: new Date().toISOString(), raw: line,
          });
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        for (const line of text.split('\n').filter(Boolean)) {
          this.runStore.addEvent(runId, 'run:stderr', line);
          this.logBuffer.push({
            runId, level: 'error', message: line, timestamp: new Date().toISOString(), raw: line,
          });
        }
      });

      const startTime = Date.now();
      this.startTimes.set(runId, startTime);

      const timeout = setTimeout(() => {
        if (proc && !proc.killed) {
          proc.kill('SIGTERM');
          this.runStore.finishRun(runId, 'failed', null, 'run timeout');
          this.runningRuns.set(runId, 'failed');
          this._publishRunEvent(runId, 'run:failed', 'run timeout');
        }
      }, SETTINGS.runTimeoutSeconds * 1000);

      await new Promise<void>((resolve) => {
        proc!.on('close', (code) => {
          clearTimeout(timeout);
          const status: RunStatus = code === 0 ? 'completed' : 'failed';
          const errMsg = code === 0 ? null : `${engine} exited with non-zero code: ${code}`;
          this.runStore.finishRun(runId, status, code, errMsg);
          this.runningRuns.set(runId, status);
          this.pidRegistry.delete(proc!.pid!);
          this.activeProcesses.delete(runId);
          this.runStore.addEvent(runId, 'done', { code, status });
          const durationMs = this.getRunDuration(runId);
          this.eventBroker.pushRunEnded(runId, code ?? -1, durationMs);
          this.startTimes.delete(runId);
          this._publishRunEvent(runId, status === 'completed' ? 'run:completed' : 'run:failed',
            status === 'completed' ? 'run completed' : `${engine} exited with code=${code}`);
          resolve();
        });

        proc!.on('error', (err) => {
          clearTimeout(timeout);
          this.runStore.finishRun(runId, 'failed', null, err.message);
          this.runningRuns.set(runId, 'failed');
          this.pidRegistry.delete(proc!.pid!);
          this.activeProcesses.delete(runId);
          this.runStore.addEvent(runId, 'error', { message: err.message });
          const durationMs = this.getRunDuration(runId);
          this.eventBroker.pushRunEnded(runId, -1, durationMs);
          this.startTimes.delete(runId);
          this._publishRunEvent(runId, 'run:failed', `unexpected error: ${err.message}`);
          resolve();
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.runStore.finishRun(runId, 'failed', null, msg);
      this.runningRuns.set(runId, 'failed');
      this._publishRunEvent(runId, 'run:failed', `exception: ${msg}`);
    } finally {
      this._releaseSemaphore();
    }
  }

  cancelRun(runId: string): boolean {
    for (const [pid, info] of this.pidRegistry) {
      if (info.runId === runId) {
        try {
          process.kill(pid, 'SIGKILL');
          this.runStore.updateRunStatus(runId, 'cancelled');
          this.runningRuns.set(runId, 'cancelled');
          this.pidRegistry.delete(pid);
          this.activeProcesses.delete(runId);
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }

  async replyToRun(runId: string, message: string): Promise<boolean> {
    const proc = this.activeProcesses.get(runId);
    if (!proc || !proc.stdin || proc.killed) return false;
    try {
      this.runStore.appendEvent(runId, 'run:reply', message);
      this._publishRunEvent(runId, 'run:reply', message);
      const payload = (message.endsWith('\n') ? message : message + '\n');
      proc.stdin.write(payload);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.runStore.appendEvent(runId, 'run:error', `failed to send reply: ${msg}`);
      return false;
    }
  }

  async retryRun(runId: string, engine?: string): Promise<RunCreateResult | null> {
    const record = this.runStore.getRun(runId);
    if (!record) return null;
    const ws = record.workspace || this.defaultWorkspaceRoot;
    return this.createRun(record.agentName, record.prompt, ws, record.sandboxMode, record.approvalPolicy, engine);
  }

  async waitForRun(runId: string): Promise<RunRecord | null> {
    const record = this.runStore.getRun(runId);
    if (!record) return null;
    if (['completed', 'failed', 'cancelled'].includes(record.status)) return record;
    return new Promise((resolve) => {
      const check = setInterval(() => {
        const r = this.runStore.getRun(runId);
        if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) {
          clearInterval(check);
          resolve(r);
        }
      }, 200);
      setTimeout(() => { clearInterval(check); resolve(this.runStore.getRun(runId)); }, 30000);
    });
  }

  startRun(options: RunOptions): { runId: string } {
    const agents = this.configReader.listAgents();
    const agent = agents.find(a => a.id === options.agentId);
    const engine: EngineType = (options.engine ?? agent?.engine ?? 'codex') as EngineType;
    const sanitizedEnv = this.sanitizeEnv();
    const cliPath = this.getCliPath(engine, agent ? { cliPath: agent.cliPath } : undefined);
    const run = this.runStore.createRun(options as Parameters<typeof this.runStore.createRun>[0]);
    this.runningRuns.set(run.id, 'queued');
    this.runStore.updateRunStatus(run.id, 'running');
    this.runningRuns.set(run.id, 'running');

    const agentName = agent?.name ?? options.agentId;
    const skillContent = this._fetchSkillInfo(agentName, engine);
    const effectivePrompt = this._buildEffectivePrompt(agentName, options.prompt, skillContent);

    const proc = spawn(cliPath, [effectivePrompt], {
      env: { ...sanitizedEnv, ...agent?.env },
      shell: false,
    });

    this.pidRegistry.set(proc.pid!, { pid: proc.pid!, runId: run.id, engine, proc });

    proc.stdout?.on('data', (data: Buffer) => {
      const line = data.toString();
      this.logBuffer.push({ runId: run.id, level: 'info', message: line, timestamp: new Date().toISOString(), raw: line });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const line = data.toString();
      this.logBuffer.push({ runId: run.id, level: 'error', message: line, timestamp: new Date().toISOString(), raw: line });
    });

    proc.on('close', (code) => {
      const status: RunStatus = code === 0 ? 'completed' : 'failed';
      this.runStore.updateRunStatus(run.id, status);
      this.runningRuns.set(run.id, status);
      this.pidRegistry.delete(proc.pid!);
      this.runStore.addEvent(run.id, 'done', { code, status });
      const durationMs = this.getRunDuration(run.id);
      this.eventBroker.pushRunEnded(run.id, code ?? -1, durationMs);
      this.startTimes.delete(run.id);
    });

    proc.on('error', (err) => {
      this.runStore.updateRunStatus(run.id, 'failed', err.message);
      this.runningRuns.set(run.id, 'failed');
      this.pidRegistry.delete(proc.pid!);
      this.runStore.addEvent(run.id, 'error', { message: err.message });
      const durationMs = this.getRunDuration(run.id);
      this.eventBroker.pushRunEnded(run.id, -1, durationMs);
      this.startTimes.delete(run.id);
    });

    const startTime = Date.now();
    this.startTimes.set(run.id, startTime);
    this.runStore.addEvent(run.id, 'start', { pid: proc.pid, engine, cliPath });
    this.eventBroker.pushRunStarted(run.id, options.agentId);

    return { runId: run.id };
  }

  private getRunDuration(runId: string): number {
    const start = this.startTimes.get(runId);
    return start ? Date.now() - start : 0;
  }

  listRuns(limit?: number, engine?: string) {
    return this.runStore.listRuns(limit, engine);
  }

  getRun(runId: string) {
    return this.runStore.getRun(runId);
  }

  listRunEvents(runId: string, limit?: number) {
    return this.runStore.getEvents(runId, limit);
  }

  validatePrompt(prompt: string): string {
    const cleaned = prompt.trim();
    if (!cleaned) throw new Error('prompt must not be empty');
    if (cleaned.length > SETTINGS.runPromptMaxLength) {
      throw new Error(`prompt length exceeds max: ${SETTINGS.runPromptMaxLength}`);
    }
    return cleaned;
  }

  validateWorkspaceRoot(rawPath: string | null | undefined): string {
    const candidate = (rawPath ?? '').trim();
    if (!candidate) return SETTINGS.workspaceRoot;
    const resolved = path.resolve(candidate.replace(/^~/, require('os').homedir()));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('workspace_root must point to an existing directory');
    }
    return resolved;
  }

  validateSandboxMode(value: string | null | undefined): string | null {
    if (!value) return null;
    const allowed = new Set(['read-only', 'workspace-write', 'danger-full-access']);
    if (!allowed.has(value)) throw new Error('invalid sandbox_mode');
    return value;
  }

  validateApprovalPolicy(value: string | null | undefined): string | null {
    if (!value) return null;
    const allowed = new Set(['untrusted', 'on-request', 'never']);
    if (!allowed.has(value)) throw new Error('invalid approval_policy');
    return value;
  }

  toPromptPreview(prompt: string, maxChars?: number): string {
    const limit = maxChars ?? SETTINGS.runPromptPreviewMaxChars;
    const compact = prompt.trim().split(/\s+/).join(' ');
    if (compact.length <= limit) return compact;
    return compact.slice(0, limit - 3) + '...';
  }

  private _stripAnsi(text: string): string {
    return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\].*?(?:\x1B\\|\x07))/g, '')
      .replace(/[^\x20-\x7E\n\r\tㄱ-ㅎㅏ-ㅣ가-힣a-zA-Z0-9.,!?()\-_=+@#$%^&*[\]{}|;:'"<>,.?\/`~ ]/g, '');
  }

  async chat(message: string, systemPrompt?: string, engine?: string): Promise<string> {
    const targetEngine = (engine === 'codex' || engine === 'gemini' || engine === 'opencode' || engine === 'claudecode') ? engine : 'gemini';
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${message}` : message;

    const binary = this._engineBinary(targetEngine);
    const brewPaths: Record<string, string> = { gemini: '/opt/homebrew/bin/gemini', codex: '/opt/homebrew/bin/codex', claude: '/opt/homebrew/bin/claude' };
    let cliPath = binary;
    const brewPath = brewPaths[binary];
    if (brewPath && fs.existsSync(brewPath)) {
      cliPath = brewPath;
    } else {
      for (const dir of (process.env.PATH ?? '').split(':')) {
        const candidate = `${dir}/${binary}`;
        try { if (fs.existsSync(candidate)) { cliPath = candidate; break; } } catch {}
      }
    }

    if (targetEngine === 'opencode') {
      return this._opencodeChat(fullPrompt);
    }

    const cliArgs: Record<string, string[]> = {
      gemini: ['-p', fullPrompt],
      codex: ['exec', '-'],
      claudecode: ['-p', fullPrompt],
    };

    return new Promise((resolve) => {
      const env: NodeJS.ProcessEnv = { ...this.sanitizeEnv(), GEMINI_API_KEY: process.env.GEMINI_API_KEY || '', OPENAI_API_KEY: process.env.OPENAI_API_KEY || '', ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '' };
      const args = cliArgs[targetEngine] || [fullPrompt];
      const proc = spawn(cliPath, args, { env, shell: false });
      let output = '', errorOutput = '';
      let settled = false;
      const finish = (result: string) => {
        if (settled) return;
        settled = true;
        resolve(this._stripAnsi(result).trim() || '...');
      };
      proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { errorOutput += data.toString(); });
      const timeout = setTimeout(() => { proc.kill(); finish(output || errorOutput || ''); }, 60000);
      proc.on('close', (code) => { clearTimeout(timeout); finish(output || errorOutput || ''); });
      proc.on('error', (err) => { clearTimeout(timeout); finish(err.message); });
      if (args[args.length - 1] === '-') {
        proc.stdin?.write(fullPrompt);
        proc.stdin?.end();
      }
    });
  }

  private async _ensureOpencodeServer(): Promise<boolean> {
    if (this.opencodeServer && !this.opencodeServer.killed) return true;

    const httpGet = (host: string, port: number, urlPath: string): Promise<boolean> => {
      return new Promise((resolve) => {
        const req = httpReq({ hostname: host, port, path: urlPath, method: 'GET', timeout: 3000 }, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      });
    };

      const isRunning = await httpGet('127.0.0.1', this.OPENCODE_PORT, '/global/health');
    if (isRunning) return true;

    try {
      const binary = this._engineBinary('opencode');
      this.opencodeServer = spawn(binary, ['serve', '--port', String(this.OPENCODE_PORT), '--hostname', '127.0.0.1'], {
        env: this.sanitizeEnv(),
        shell: false,
        stdio: 'ignore',
      });
      this.opencodeServer.on('exit', () => { this.opencodeServer = null; });
      this.opencodeServer.on('error', () => { this.opencodeServer = null; });

      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const ok = await httpGet('127.0.0.1', this.OPENCODE_PORT, '/global/health');
        if (ok) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  stopOpencodeServer(): void {
    if (this.opencodeServer && !this.opencodeServer.killed) {
      this.opencodeServer.kill('SIGTERM');
      this.opencodeServer = null;
    }
  }

  private async _opencodeChat(prompt: string): Promise<string> {
    const httpPost = (host: string, port: number, urlPath: string, body: string, timeoutMs: number): Promise<string> => {
      return new Promise((resolve, reject) => {
        const req = httpReq({ hostname: host, port, path: urlPath, method: 'POST', timeout: timeoutMs, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => data += chunk.toString());
          res.on('end', () => resolve(data));
        });
        req.on('error', (err: Error) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(body);
        req.end();
      });
    };

    const ready = await this._ensureOpencodeServer();
    if (!ready) return 'OpenCode server could not be started. Please use Gemini or ClaudeCode engine for chat.';

    try {
      const sessionRes = await httpPost('127.0.0.1', this.OPENCODE_PORT, '/session', JSON.stringify({ title: 'chat' }), 5000);
      const sessionObj = JSON.parse(sessionRes);
      if (!sessionObj?.id) return 'Failed to create session on OpenCode server.';

      const msgRes = await httpPost('127.0.0.1', this.OPENCODE_PORT, `/session/${sessionObj.id}/message`, JSON.stringify({ parts: [{ type: 'text', text: prompt }] }), 120000);
      const msg = JSON.parse(msgRes);
      for (const part of msg.parts || []) {
        if (part.type === 'text' && part.text) return this._stripAnsi(part.text).trim();
      }
      return '...';
    } catch {
      return 'OpenCode chat request failed. Try again or use Gemini/ClaudeCode.';
    }
  }

  private _publishRunEvent(runId: string, eventType: string, message: string): void {
    this.eventBroker.pushEvent({
      runId,
      type: eventType as 'start' | 'progress' | 'log' | 'output' | 'done' | 'error',
      timestamp: new Date().toISOString(),
      data: { eventType, message },
    });
  }

  private _buildEffectivePrompt(agentName: string, prompt: string, skillContent: string | null): string {
    const header = `You are running from Custom Gemini Agent Execution Console.\nSelected agent: ${agentName}\nFollow the selected agent's role and constraints while completing the request.\n\n`;
    const skillSection = skillContent
      ? `## Agent Workflow Definition\nFollow these instructions strictly:\n\n${skillContent}\n\n---\n\n`
      : '';
    const fileSafety = 'If the task requires reading or analyzing a file but the user did not provide an explicit file path and file name, do not proceed with file operations. First ask the user to provide the exact file path and file name.\n\n';
    return `${header}${skillSection}${fileSafety}${prompt}`;
  }

  private _fetchSkillInfo(agentName: string, engine?: string): string | null {
    try {
      const agentsRoot = SETTINGS.getAgentsRoot(engine);
      const agentDir = path.join(agentsRoot, agentName);
      const configFile = path.join(agentDir, 'config.json');
      if (!fs.existsSync(configFile)) return null;
      const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      const skillPathStr = config.skill_path;
      if (!skillPathStr) return null;
      const skillPath = path.resolve(skillPathStr.replace(/^~/, require('os').homedir()));
      if (fs.existsSync(skillPath)) {
        return fs.readFileSync(skillPath, 'utf-8');
      }
    } catch {}
    return null;
  }
}
