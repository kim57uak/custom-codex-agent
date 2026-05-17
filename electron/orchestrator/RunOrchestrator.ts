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

/* ── HITL types ──────────────────────────────────── */
export interface HitlRequestData {
  id: string;
  runId: string;
  agentName: string;
  message: string;
  permission: string;
  stepIndex: number;
  workflowRunId: string;
}

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
  private cancelledRunIds = new Set<string>();
  private maxConcurrency: number;
  private semaphoreCount = 0;
  private runQueue: Array<() => void> = [];
  private opencodeServer: ChildProcess | null = null;
  private readonly OPENCODE_PORT = 21789;
  private hitlPending = new Map<string, HitlRequestData>();
  private hitlStepContext = new Map<string, { workflowRunId: string; stepIndex: number }>();
  private outputBuffers = new Map<string, string[]>();
  private fullOutput = new Map<string, string[]>();
  private readonly HITL_BUFFER_SIZE = 30;
  private readonly HITL_PATTERNS = [
    /allow\s+once/i,
    /allow\s+always/i,
    /permission\s+required/i,
    /reject/i,
  ];

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
        this.eventBroker.pushLog(entry.runId, entry.level, entry.message, entry.raw, entry.source);
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
    stepContext?: { workflowRunId?: string; stepIndex?: number },
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

    if (stepContext?.workflowRunId && stepContext.stepIndex !== undefined) {
      this.hitlStepContext.set(run.id, {
        workflowRunId: stepContext.workflowRunId,
        stepIndex: stepContext.stepIndex,
      });
    }

    this._executeRun(run.id, agentName, prompt, run.workspace, effectiveEngine, sandboxMode, approvalPolicy);
    return { runId: run.id };
  }

  private async _executeRun(
    runId: string, agentName: string, prompt: string, workspaceRoot: string | null,
    engine: string, sandboxMode?: string | null, approvalPolicy?: string | null,
  ): Promise<void> {
    await this._acquireSemaphore();
    if (this.cancelledRunIds.has(runId)) {
      this.runStore.finishRun(runId, 'cancelled', null, 'cancelled before start');
      this.runningRuns.set(runId, 'cancelled');
      this.cancelledRunIds.delete(runId);
      this._publishRunEvent(runId, 'run:cancelled', 'cancelled while queued');
      this._releaseSemaphore();
      return;
    }
    let proc: ChildProcess | null = null;
    try {
      const updated = this.runStore.markRunning(runId);
      if (!updated) return;
      this.runningRuns.set(runId, 'running');
      this.runStore.appendEvent(runId, 'run:started', `run started (engine=${engine})`);
      this._publishRunEvent(runId, 'run:started', `run started (engine=${engine})`);

      const skillInfo = this._fetchSkillInfo(agentName, engine);
      const effectivePrompt = this._buildEffectivePrompt(agentName, prompt, skillInfo.content, engine);
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

      const includeDirs: string[] = [];
      if (skillInfo.skillPath) {
        includeDirs.push(path.dirname(skillInfo.skillPath));
      }
      const args = this._buildCliArgs(engine as EngineType, effectivePrompt, sandboxMode, approvalPolicy, includeDirs.length > 0 ? includeDirs : undefined);

      const resolvedCwd = workspaceRoot || this._extractCwdFromPrompt(effectivePrompt) || this.defaultWorkspaceRoot;
      proc = spawn(cliPath, args, {
        env: sanitizedEnv,
        shell: false,
        cwd: resolvedCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.pidRegistry.set(proc.pid!, { pid: proc.pid!, runId, engine: engine as EngineType, proc });
      this.activeProcesses.set(runId, proc);
      // pipe prompt via stdin when engine uses '-' convention (codex exec -)
      const lastArg = args[args.length - 1];
      if (engine === 'codex' && lastArg === '-') {
        proc.stdin?.write(effectivePrompt);
        proc.stdin?.end();
      } else {
        proc.stdin?.end();
      }
      // opencode/gemini/claudecode: prompt in args, stdin reserved for HITL responses
      // cancel during buffering (race) → kill immediately
      if (this.cancelledRunIds.has(runId)) {
        this._killProcTree(proc);
        this.cancelledRunIds.delete(runId);
      }


      let inactivityTimer: NodeJS.Timeout | null = null;
      let inactivityKill = false;
      const INACTIVITY_MS = 120_000;
      const resetInactivity = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (engine === 'opencode') {
          inactivityTimer = setTimeout(() => {
            if (proc && !proc.killed) {
              inactivityKill = true;
              proc.kill('SIGTERM');
            }
          }, INACTIVITY_MS);
        }
      };

      proc.stdout?.on('data', (data: Buffer) => {
        const text = this._stripAnsi(data.toString());
        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          this.runStore.addEvent(runId, 'run:stdout', line);
          this._publishRunEvent(runId, 'run:stdout', line);
          this.logBuffer.push({
            runId, source: agentName, level: 'info', message: line, timestamp: new Date().toISOString(), raw: line,
          });
        }
        let out = this.fullOutput.get(runId);
        if (!out) { out = []; this.fullOutput.set(runId, out); }
        out.push(...lines);
        this._detectHitl(runId, lines, agentName);
        resetInactivity();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = this._stripAnsi(data.toString());
        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          this.runStore.addEvent(runId, 'run:stderr', line);
          this._publishRunEvent(runId, 'run:stderr', line);
          this.logBuffer.push({
            runId, source: agentName, level: 'error', message: line, timestamp: new Date().toISOString(), raw: line,
          });
        }
        let out = this.fullOutput.get(runId);
        if (!out) { out = []; this.fullOutput.set(runId, out); }
        out.push(...lines);
        this._detectHitl(runId, lines, agentName);
        resetInactivity();
      });

      const startTime = Date.now();
      this.startTimes.set(runId, startTime);
      resetInactivity();

      const runTimeout = setTimeout(() => {
        if (proc && !proc.killed) {
          proc.kill('SIGTERM');
          this.runStore.finishRun(runId, 'failed', null, 'run timeout');
          this.runningRuns.set(runId, 'failed');
          this._publishRunEvent(runId, 'run:failed', 'run timeout');
        }
      }, SETTINGS.runTimeoutSeconds * 1000);

      await new Promise<void>((resolve) => {
        proc!.on('close', (code) => {
          clearTimeout(runTimeout);
          if (inactivityTimer) clearTimeout(inactivityTimer);
          this.logBuffer.flush().catch(() => {});
          let status: RunStatus;
          if (this.cancelledRunIds.has(runId)) {
            this.cancelledRunIds.delete(runId);
            this.runStore.finishRun(runId, 'cancelled', null, 'cancelled by user');
            this.runningRuns.set(runId, 'cancelled');
            status = 'cancelled';
          } else if (inactivityKill) {
            this.runStore.finishRun(runId, 'completed', 0, null);
            this.runningRuns.set(runId, 'completed');
            status = 'completed';
          } else {
            status = code === 0 ? 'completed' : 'failed';
            const errMsg = code === 0 ? null : `${engine} exited with non-zero code: ${code}`;
            this.runStore.finishRun(runId, status, code, errMsg);
            this.runningRuns.set(runId, status);
          }
          this.pidRegistry.delete(proc!.pid!);
          this.activeProcesses.delete(runId);
          this.hitlPending.delete(runId);
          this.hitlStepContext.delete(runId);
          this.outputBuffers.delete(runId);
          this.runStore.addEvent(runId, 'done', { code, status: this.runningRuns.get(runId) });
          const durationMs = this.getRunDuration(runId);
          this.eventBroker.pushRunEnded(runId, code ?? -1, durationMs);
          this.startTimes.delete(runId);
          this._publishRunEvent(runId, status === 'completed' ? 'run:completed' : 'run:failed',
            status === 'completed' ? 'run completed' : `${engine} exited with code=${code}`);
          resolve();
        });

        proc!.on('error', (err) => {
          clearTimeout(runTimeout);
          if (inactivityTimer) clearTimeout(inactivityTimer);
          this.logBuffer.flush().catch(() => {});
          let status: RunStatus;
          if (this.cancelledRunIds.has(runId)) {
            this.cancelledRunIds.delete(runId);
            this.runStore.finishRun(runId, 'cancelled', null, 'cancelled by user');
            this.runningRuns.set(runId, 'cancelled');
            status = 'cancelled';
          } else {
            this.runStore.finishRun(runId, 'failed', null, err.message);
            this.runningRuns.set(runId, 'failed');
            status = 'failed';
          }
          this.pidRegistry.delete(proc!.pid!);
          this.activeProcesses.delete(runId);
          this.hitlPending.delete(runId);
          this.hitlStepContext.delete(runId);
          this.outputBuffers.delete(runId);
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
    this.cancelledRunIds.add(runId);

    // try pidRegistry first
    for (const [pid, info] of this.pidRegistry) {
      if (info.runId === runId) {
        try {
          this._killProcTree(info.proc);
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

    // try activeProcesses fallback
    const proc = this.activeProcesses.get(runId);
    if (proc) {
      try {
        this._killProcTree(proc);
        this.runStore.updateRunStatus(runId, 'cancelled');
        this.runningRuns.set(runId, 'cancelled');
        this.activeProcesses.delete(runId);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  private _killProcTree(proc: ChildProcess): void {
    if (proc.killed) return;
    // kill process group (covers grandchildren)
    if (typeof proc.pid === 'number') {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
    }
    // kill direct child
    try { proc.kill('SIGKILL'); } catch {}
  }

  /* ── HITL ──────────────────────────────────────── */
  private _detectHitl(runId: string, lines: string[], agentName: string): void {
    if (this.hitlPending.has(runId)) return;

    let buf = this.outputBuffers.get(runId);
    if (!buf) {
      buf = [];
      this.outputBuffers.set(runId, buf);
    }
    for (const line of lines) {
      buf.push(line);
      if (buf.length > this.HITL_BUFFER_SIZE) buf.shift();
    }
    const joined = buf.join(' ');

    const hasChoices = /allow\s+once/i.test(joined) && /reject/i.test(joined);
    if (!hasChoices) return;

    const context = this.hitlStepContext.get(runId);
    const id = `hitl_${runId}_${Date.now()}`;
    const stepIndex = context ? context.stepIndex : -1;
    const workflowRunId = context ? context.workflowRunId : '';
    const request: HitlRequestData = {
      id, runId, agentName,
      message: buf.slice(-10).join('\n'),
      permission: 'external_access',
      stepIndex,
      workflowRunId,
    };
    this.hitlPending.set(runId, request);

    this.eventBroker.pushPermissionRequest({
      id, runId, agentName,
      message: buf.slice(-10).join('\n'),
      permission: 'external_access',
      stepIndex,
    });
    this.runStore.appendEvent(runId, 'run:hitl', `HITL: ${request.message}`);
  }

  async respondToHitl(requestId: string, response: string): Promise<boolean> {
    let targetRunId: string | null = null;
    for (const [runId, req] of this.hitlPending) {
      if (req.id === requestId) { targetRunId = runId; break; }
    }
    if (!targetRunId) return false;

    const proc = this.activeProcesses.get(targetRunId);
    if (!proc || !proc.stdin || proc.killed) {
      this.hitlPending.delete(targetRunId);
      return false;
    }

    const responseMap: Record<string, string> = {
      allow_once: 'Allow once\n',
      allow_always: 'Allow always\n',
      reject: 'Reject\n',
    };
    const payload = responseMap[response] ?? response + '\n';
    try {
      proc.stdin.write(payload);
      this.hitlPending.delete(targetRunId);
      return true;
    } catch {
      this.hitlPending.delete(targetRunId);
      return false;
    }
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

  popRunOutput(runId: string): string[] {
    const out = this.fullOutput.get(runId);
    this.fullOutput.delete(runId);
    return out ?? [];
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
      setTimeout(() => { clearInterval(check); resolve(this.runStore.getRun(runId)); }, SETTINGS.runTimeoutSeconds * 1000 + 60000);
    });
  }

  startRun(options: RunOptions): { runId: string } {
    const agents = this.configReader.listAgents();
    const agent = agents.find(a => a.id === options.agentId);
    const engine: EngineType = (options.engine ?? agent?.engine ?? SETTINGS.defaultEngine) as EngineType;
    const sanitizedEnv = this.sanitizeEnv();
    const cliPath = this.getCliPath(engine, agent ? { cliPath: agent.cliPath } : undefined);
    const run = this.runStore.createRun(options as Parameters<typeof this.runStore.createRun>[0]);
    this.runningRuns.set(run.id, 'queued');
    this.runStore.updateRunStatus(run.id, 'running');
    this.runningRuns.set(run.id, 'running');

    const agentName = agent?.name ?? options.agentId;
    const skillInfo = this._fetchSkillInfo(agentName, engine);
    const effectivePrompt = this._buildEffectivePrompt(agentName, options.prompt, skillInfo.content, engine);

    const args = this._buildCliArgs(engine, effectivePrompt, options.sandboxMode, options.approvalPolicy);
    const startCwd = this._extractCwdFromPrompt(effectivePrompt) || this.defaultWorkspaceRoot;
    const proc = spawn(cliPath, args, {
      env: { ...sanitizedEnv, ...agent?.env },
      shell: false,
      cwd: startCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.pidRegistry.set(proc.pid!, { pid: proc.pid!, runId: run.id, engine, proc });

    if (engine === 'codex') {
      proc.stdin?.write(effectivePrompt);
      proc.stdin?.end();
    }
    if (engine === 'opencode') {
      proc.stdin?.end();
    }

    proc.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.runStore.addEvent(run.id, 'run:stdout', line);
        this._publishRunEvent(run.id, 'run:stdout', line);
        this.logBuffer.push({ runId: run.id, source: agentName, level: 'info', message: line, timestamp: new Date().toISOString(), raw: line });
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.runStore.addEvent(run.id, 'run:stderr', line);
        this._publishRunEvent(run.id, 'run:stderr', line);
        this.logBuffer.push({ runId: run.id, source: agentName, level: 'error', message: line, timestamp: new Date().toISOString(), raw: line });
      }
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
    const valid: EngineType[] = ['codex', 'gemini', 'opencode', 'claudecode'];
    const targetEngine = valid.includes(engine as EngineType) ? (engine as EngineType) : SETTINGS.defaultEngine;
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

  private _httpPost(host: string, port: number, urlPath: string, body: string, timeoutMs: number): Promise<string> {
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
  }

  private async _executeRunOpencode(
    runId: string, agentName: string, prompt: string, _workspaceRoot: string | null,
  ): Promise<void> {
    const ready = await this._ensureOpencodeServer();
    if (!ready) {
      this.runStore.finishRun(runId, 'failed', null, 'opencode serve not available');
      this.runningRuns.set(runId, 'failed');
      this._publishRunEvent(runId, 'run:failed', 'opencode serve not available');
      return;
    }

    this.eventBroker.pushRunStarted(runId, agentName);
    this.startTimes.set(runId, Date.now());

    try {
      const sessionRes = await this._httpPost('127.0.0.1', this.OPENCODE_PORT, '/session', JSON.stringify({ title: runId }), 5000);
      const sessionObj = JSON.parse(sessionRes);
      if (!sessionObj?.id) throw new Error('no session id from opencode serve');

      const msgRes = await this._httpPost('127.0.0.1', this.OPENCODE_PORT, `/session/${sessionObj.id}/message`, JSON.stringify({ parts: [{ type: 'text', text: prompt }] }), 120000);
      const msg = JSON.parse(msgRes);

      let responseText = '';
      for (const part of msg.parts || []) {
        if (part.type === 'text' && part.text) responseText += part.text;
      }

      if (responseText) {
        const lines = this._stripAnsi(responseText).split('\n').filter(Boolean);
        for (const line of lines) {
          this.runStore.addEvent(runId, 'run:stdout', line);
          this._publishRunEvent(runId, 'run:stdout', line);
          this.logBuffer.push({ runId, source: agentName, level: 'info', message: line, timestamp: new Date().toISOString(), raw: line });
        }
        let out = this.fullOutput.get(runId);
        if (!out) { out = []; this.fullOutput.set(runId, out); }
        out.push(...lines);
      }

      this.runStore.finishRun(runId, 'completed', 0, null);
      this.runningRuns.set(runId, 'completed');
      this.runStore.addEvent(runId, 'done', { code: 0, status: 'completed' });
      const durationMs = this.getRunDuration(runId);
      this.eventBroker.pushRunEnded(runId, 0, durationMs);
      this._publishRunEvent(runId, 'run:completed', 'opencode completed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.runStore.finishRun(runId, 'failed', null, msg);
      this.runningRuns.set(runId, 'failed');
      this.runStore.addEvent(runId, 'done', { code: -1, status: 'failed' });
      const durationMs = this.getRunDuration(runId);
      this.eventBroker.pushRunEnded(runId, -1, durationMs);
      this._publishRunEvent(runId, 'run:failed', `opencode: ${msg}`);
    }
  }

  private async _opencodeChat(prompt: string): Promise<string> {
    const ready = await this._ensureOpencodeServer();
    if (!ready) return 'OpenCode server could not be started. Please use Gemini or ClaudeCode engine for chat.';

    try {
      const sessionRes = await this._httpPost('127.0.0.1', this.OPENCODE_PORT, '/session', JSON.stringify({ title: 'chat' }), 5000);
      const sessionObj = JSON.parse(sessionRes);
      if (!sessionObj?.id) return 'Failed to create session on OpenCode server.';

      const msgRes = await this._httpPost('127.0.0.1', this.OPENCODE_PORT, `/session/${sessionObj.id}/message`, JSON.stringify({ parts: [{ type: 'text', text: prompt }] }), 120000);
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

  private _buildEffectivePrompt(agentName: string, prompt: string, skillContent: string | null, engine?: string): string {
    const engineLabel = engine ?? SETTINGS.defaultEngine;
    const header = `You are running from Custom ${engineLabel} Agent Execution Console.\nSelected agent: ${agentName}\nFollow the selected agent's role and constraints while completing the request.\n\n`;
    const skillSection = skillContent
      ? `## Agent Workflow Definition\nFollow these instructions strictly:\n\n${skillContent}\n\n---\n\n`
      : '';
    const fileSafety = 'If the task requires reading or analyzing a file but the user did not provide an explicit file path and file name, do not proceed with file operations. First ask the user to provide the exact file path and file name.\n\n';
    const outputDir = 'When creating output files (analysis results, reports, charts), save them in the same directory as the input files. For example, if input is /path/to/data.csv, write output files to /path/to/ directory.\n\n';
    return `${header}${skillSection}${fileSafety}${outputDir}${prompt}`;
  }

  private _extractCwdFromPrompt(prompt: string): string | null {
    const fileMatch = prompt.match(/[-\w/]+\/([\w-]+\.(csv|json|xlsx?|tsv|parquet))/);
    if (fileMatch) {
      const dir = path.dirname(fileMatch[0]);
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    }
    return null;
  }

  private _buildCliArgs(engine: string, prompt: string, sandboxMode?: string | null, approvalPolicy?: string | null, includeDirs?: string[]): string[] {
    switch (engine) {
      case 'gemini': {
        const args: string[] = [];
        args.push('--output-format', 'text');
        if (sandboxMode === 'danger-full-access' || approvalPolicy === 'never') {
          args.push('--approval-mode', 'yolo');
        } else if (sandboxMode === 'workspace-write' || approvalPolicy === 'on-request') {
          args.push('--approval-mode', 'auto_edit');
        } else if (sandboxMode === 'read-only') {
          args.push('--sandbox', '--approval-mode', 'default');
        } else {
          args.push('--approval-mode', 'default');
        }
        if (includeDirs) {
          for (const d of includeDirs) {
            args.push('--include-directories', d);
          }
        }
        args.push('--prompt', prompt);
        return args;
      }
      case 'codex': {
        const args: string[] = ['exec'];
        let forceNoApproval = false;
        if (approvalPolicy === 'never') {
          if (sandboxMode === 'workspace-write') {
            args.push('--full-auto');
            sandboxMode = undefined;
          } else if (sandboxMode === 'danger-full-access') {
            args.push('--dangerously-bypass-approvals-and-sandbox');
            sandboxMode = undefined;
          } else if (!sandboxMode) {
            forceNoApproval = true;
          }
        }
        if (sandboxMode) {
          args.push('--sandbox', sandboxMode);
        }
        if (forceNoApproval) {
          args.push('--dangerously-bypass-approvals-and-sandbox');
        }
        args.push('-');
        return args;
      }
      case 'claudecode':
        return ['-p', prompt];
      case 'opencode':
        return ['run', prompt, '--print-logs', '--dangerously-skip-permissions'];
      default:
        return [prompt];
    }
  }

  private _fetchSkillInfo(agentName: string, engine?: string): { content: string | null; skillPath: string | null } {
    try {
      const agentsRoot = SETTINGS.getAgentsRoot(engine);
      const agentDir = path.join(agentsRoot, agentName);
      const configFile = path.join(agentDir, 'config.json');
      if (!fs.existsSync(configFile)) return { content: null, skillPath: null };
      const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      const skillPathStr = config.skill_path;
      if (!skillPathStr) return { content: null, skillPath: null };
      const skillPath = path.resolve(skillPathStr.replace(/^~/, require('os').homedir()));
      if (fs.existsSync(skillPath)) {
        return { content: fs.readFileSync(skillPath, 'utf-8'), skillPath };
      }
    } catch {}
    return { content: null, skillPath: null };
  }
}
