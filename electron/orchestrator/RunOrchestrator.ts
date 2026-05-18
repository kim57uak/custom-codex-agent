/**
 * RunOrchestrator — AI 에이전트 실행 오케스트레이터.
 *
 * @what
 * - AI 에이전트 CLI(gemini, opencode, claudecode)를 자식 프로세스로 실행하고 생명주기를 관리합니다.
 * - 동시 실행 제한(semaphore), 실행 취소, HITL(Human-In-The-Loop) 감지 및 응답, 실행 타임아웃을 처리합니다.
 *
 * @design
 * - EventBroker + LogBuffer를 통해 실시간 로그/이벤트를 구독자에게 전달합니다.
 * - PID 레지스트리와 프로세스 그룹 kill을 통해 트리 전체를 안전하게 종료합니다.
 * - opencode 서버 모드를 HTTP API로 연동할 수 있습니다.
 *
 * @usage
 *   const orchestrator = new RunOrchestrator({ logBuffer, eventBroker });
 *   const { runId } = await orchestrator.startRun({ agentId, prompt, ... });
 *   orchestrator.cancelRun(runId);
 */
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
import { createEngineAdapter } from '../adapters/EngineAdapter';
import type { RunOptions, RunStatus, EngineType } from '../../types/ipc-contract';
import type { RunRecord } from '../stores/RunStore';
import type { BuildCliArgsOptions } from '../adapters/EngineAdapter';

/**
 * 프로세스 ID와 실행 정보를 연결하는 레지스트리 항목.
 * 실행 중인 자식 프로세스의 PID, Run ID, 엔진 타입, 프로세스 핸들을 보관합니다.
 */
interface PidInfo {
  pid: number;
  runId: string;
  engine: EngineType;
  proc: ChildProcess;
}



/* ── HITL types ──────────────────────────────────── */
/**
 * HITL(Human-In-The-Loop) 권한 요청 데이터.
 * 에이전트가 외부 접근 권한이 필요한 작업을 요청할 때 사용됩니다.
 */
export interface HitlRequestData {
  id: string;
  runId: string;
  agentName: string;
  message: string;
  permission: string;
  stepIndex: number;
  workflowRunId: string;
}

/**
 * 자식 프로세스 환경변수에서 제거할 위험 변수 목록.
 * 프로세스 생성 시 전파되지 않도록 차단하여 보안을 강화합니다.
 */
const ENV_SANITIZE_BLOCKLIST = [
  'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE',
];

/**
 * Run 생성 결과. 새로 생성된 Run의 ID를 반환합니다.
 */
export interface RunCreateResult {
  runId: string;
}

/**
 * Run 실행 중 세부 상태 타입.
 * initializing(초기화 중), executing_cli(CLI 실행 중), processing_output(출력 처리 중).
 */
export type RunningSubStatus = 'initializing' | 'executing_cli' | 'processing_output';

export class RunOrchestrator {
  /** 로그 버퍼: 실시간 로그를 수집하고 일괄 플러시합니다. */
  private logBuffer: LogBuffer;
  /** 이벤트 브로커: Run 상태/로그/이벤트를 구독자에게 전파합니다. */
  private eventBroker: EventBroker;
  /** SQLite RunStore: Run 실행 상태와 이벤트를 영구 저장합니다. */
  private runStore: RunStore;
  /** ConfigReader: 엔진 경로, 에이전트 설정 등을 읽어옵니다. */
  private configReader: ConfigReader;
  /** PID → PidInfo 레지스트리: 프로세스 트리 종료에 사용됩니다. */
  private pidRegistry = new Map<number, PidInfo>();
  /** Run ID → 실행 상태 맵. */
  private runningRuns = new Map<string, RunStatus>();
  /** Run ID → 세부 실행 상태 맵 (initializing / executing_cli / processing_output). */
  private runningSubStatuses = new Map<string, RunningSubStatus>();
  /** Run ID → 시작 시간(Unix 타임스탬프) 맵. */
  private startTimes = new Map<string, number>();
  /** Run ID → 자식 프로세스 핸들 맵. */
  private activeProcesses = new Map<string, ChildProcess>();
  /** 취소 요청된 Run ID 집합. 실행 전이나 실행 중에 참조됩니다. */
  private cancelledRunIds = new Set<string>();
  /** 최대 동시 실행 가능한 Run 수. */
  private maxConcurrency: number;
  /** 현재 실행 중인 세마포어 카운트. */
  private semaphoreCount = 0;
  /** 세마포어 대기열: 동시 실행 제한 초과 시 대기할 resolve 함수들. */
  private runQueue: Array<() => void> = [];
  /** opencode 서버 모드 프로세스 핸들. */
  private opencodeServer: ChildProcess | null = null;
  /** opencode 서버 HTTP 포트. */
  private readonly OPENCODE_PORT = 21789;
  /** HITL 요청 데이터 맵 (runId → HitlRequestData). */
  private hitlPending = new Map<string, HitlRequestData>();
  /** HITL 단계 컨텍스트 맵 (runId → { workflowRunId, stepIndex }). */
  private hitlStepContext = new Map<string, { workflowRunId: string; stepIndex: number }>();
  /** Run별 HITL 감지용 출력 버퍼 (최신 N줄 유지). */
  private outputBuffers = new Map<string, string[]>();
  /** Run별 전체 출력 수집 버퍼. */
  private fullOutput = new Map<string, string[]>();
  /** HITL 감지용 출력 버퍼 최대 크기. */
  private readonly HITL_BUFFER_SIZE = 30;
  /** HITL 요청 감지 정규식 패턴 목록. */
  private readonly HITL_PATTERNS = [
    /allow\s+once/i,
    /allow\s+always/i,
    /permission\s+required/i,
    /reject/i,
  ];

  /**
   * RunOrchestrator를 초기화합니다.
   * @param deps.logBuffer - 실시간 로그 수집 버퍼
   * @param deps.eventBroker - 이벤트 전파용 브로커
   */
  constructor(deps: { logBuffer: LogBuffer; eventBroker: EventBroker }) {
    this.logBuffer = deps.logBuffer;
    this.eventBroker = deps.eventBroker;
    this.runStore = new RunStore();
    this.configReader = new ConfigReader();
    this.maxConcurrency = SETTINGS.runMaxConcurrency;
    this.setupLogBufferHandlers();
  }

  /** 기본 작업 디렉터리 경로를 반환합니다. */
  get defaultWorkspaceRoot(): string {
    return SETTINGS.workspaceRoot;
  }

  /**
   * LogBuffer의 플러시 이벤트를 구독하여 모든 로그 항목을 EventBroker를 통해 전파합니다.
   */
  private setupLogBufferHandlers(): void {
    this.logBuffer.onFlush((entries) => {
      for (const entry of entries) {
        this.eventBroker.pushLog(entry.runId, entry.level, entry.message, entry.raw, entry.source);
      }
    });
  }

  /**
   * 동시 실행 제한 세마포어를 획득합니다.
   * 현재 실행 중인 Run 수가 maxConcurrency 미만이면 즉시 획득하고,
   * 초과 시 대기열에 등록되어 이전 Run 완료 시 획득합니다.
   */
  private async _acquireSemaphore(): Promise<void> {
    if (this.semaphoreCount < this.maxConcurrency) {
      this.semaphoreCount++;
      return;
    }
    return new Promise((resolve) => {
      this.runQueue.push(resolve);
    });
  }

  /**
   * 세마포어를 해제합니다.
   * 대기 중인 Run이 있으면 즉시 실행을 시작하고, 없으면 카운트를 감소시킵니다.
   */
  private _releaseSemaphore(): void {
    const next = this.runQueue.shift();
    if (next) {
      next();
    } else {
      this.semaphoreCount = Math.max(0, this.semaphoreCount - 1);
    }
  }

  /**
   * 보안 위험이 있는 환경변수를 제거한 복사본을 반환합니다.
   * ENV_SANITIZE_BLOCKLIST에 등록된 변수(LD_PRELOAD, NODE_OPTIONS 등)를 필터링합니다.
   * @returns 필터링된 환경변수 객체
   */
  private sanitizeEnv(): NodeJS.ProcessEnv {
    const sanitized: NodeJS.ProcessEnv = { ...process.env };
    for (const key of ENV_SANITIZE_BLOCKLIST) {
      delete sanitized[key];
    }
    return sanitized;
  }

  /**
   * 엔진에 해당하는 CLI 바이너리 경로를 반환합니다.
   * 우선순위: 에이전트 설정의 cliPath > ConfigReader 엔진 경로 > PATH 검색 > 기본 바이너리 이름.
   * @param engine - 엔진 타입
   * @param agentConfig - 에이전트 설정 (선택적 cliPath 포함)
   * @returns CLI 바이너리 전체 경로 또는 바이너리 이름
   */
  private getCliPath(engine: EngineType, agentConfig?: { cliPath?: string | undefined }): string {
    if (agentConfig?.cliPath) return agentConfig.cliPath;
    const resolved = this.configReader.getEnginePath(engine);
    if (resolved) return resolved;
    const binary = createEngineAdapter(engine).binaryName;
    for (const dir of (process.env.PATH ?? '').split(':')) {
      const candidate = `${dir}/${binary}`;
      try { if (fs.existsSync(candidate)) return candidate; } catch {}
    }
    return binary;
  }

  /**
   * 새 Run을 생성하고 큐에 등록한 후 비동기 실행을 시작합니다.
   * RunStore에 레코드를 생성하고, HITL 단계 컨텍스트를 설정한 뒤 _executeRun을 호출합니다.
   * @param agentName - 실행할 에이전트 이름
   * @param prompt - 에이전트에 전달할 프롬프트
   * @param workspaceRoot - 작업 디렉터리 경로
   * @param sandboxMode - 샌드박스 모드 (read-only / workspace-write / danger-full-access)
   * @param approvalPolicy - 승인 정책 (untrusted / on-request / never)
   * @param engine - 사용할 엔진
   * @param stepContext - 워크플로우 단계 컨텍스트 (워크플로우 실행 중인 경우)
   * @returns 생성된 Run ID
   */
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

  /**
   * 실제로 CLI 프로세스를 spawn하고 실행 생명주기를 관리합니다.
   * 세마포어 획득, 환경변수 정리, CLI 인자 구성, 프로세스 모니터링, 타임아웃 처리, HITL 감지 등 모든 실행 단계를 포함합니다.
   * @param runId - 실행할 Run ID
   * @param agentName - 에이전트 이름
   * @param prompt - 실행 프롬프트
   * @param workspaceRoot - 작업 디렉터리 경로
   * @param engine - 사용할 엔진
   * @param sandboxMode - 샌드박스 모드
   * @param approvalPolicy - 승인 정책
   */
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
      this._setRunningSubStatus(runId, 'initializing');
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

      for (const key of ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
        if (process.env[key]) sanitizedEnv[key] = process.env[key];
      }

      const includeDirs: string[] = [];
      if (skillInfo.skillPath) {
        includeDirs.push(path.dirname(skillInfo.skillPath));
      }
      const adapter = createEngineAdapter(engine as EngineType);
      const args = adapter.buildCliArgs(effectivePrompt, { sandboxMode, approvalPolicy, includeDirs: includeDirs.length > 0 ? includeDirs : undefined } as BuildCliArgsOptions);

      this._setRunningSubStatus(runId, 'executing_cli');

      const resolvedCwd = workspaceRoot || this._extractCwdFromPrompt(effectivePrompt) || this.defaultWorkspaceRoot;
      proc = spawn(cliPath, args, {
        env: sanitizedEnv,
        shell: false,
        cwd: resolvedCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.pidRegistry.set(proc.pid!, { pid: proc.pid!, runId, engine: engine as EngineType, proc });
      this.activeProcesses.set(runId, proc);
      proc.stdin?.end();
      // opencode/gemini/claudecode: prompt in args, stdin reserved for HITL responses
      // cancel during buffering (race) → kill immediately
      if (this.cancelledRunIds.has(runId)) {
        this._killProcTree(proc);
        this.cancelledRunIds.delete(runId);
      }


      let gotFirstOutput = false;

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
        if (!gotFirstOutput) {
          gotFirstOutput = true;
          this._setRunningSubStatus(runId, 'processing_output');
        }
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
          this.runningSubStatuses.delete(runId);
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
          this.runningSubStatuses.delete(runId);
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

  /**
   * 실행 중인 Run을 취소합니다.
   * PID 레지스트리나 활성 프로세스 맵에서 프로세스를 찾아 프로세스 트리를 종료합니다.
   * @param runId - 취소할 Run ID
   * @returns 취소 성공 여부
   */
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

  /**
   * 자식 프로세스와 그 하위 프로세스 트리를 안전하게 종료합니다.
   * 먼저 프로세스 그룹에 SIGTERM을 보내고, 직접 자식에는 SIGKILL을 보냅니다.
   * @param proc - 종료할 자식 프로세스
   */
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
  /**
   * 에이전트 출력에서 HITL(Human-In-The-Loop) 요청 패턴을 감지합니다.
   * "allow once" + "reject" 선택지가 동시에 나타나면 권한 요청 이벤트를 발생시킵니다.
   * @param runId - 관련 Run ID
   * @param lines - 감지할 출력 라인 배열
   * @param agentName - 에이전트 이름
   */
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

  /**
   * HITL 요청에 대한 사용자 응답을 처리합니다.
   * 응답을 해당 Run의 stdin으로 전달합니다.
   * @param requestId - HITL 요청 ID
   * @param response - 응답 문자열 (allow_once / allow_always / reject)
   * @returns 전달 성공 여부
   */
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

  /**
   * 실행 중인 Run의 stdin으로 메시지를 전송합니다.
   * 사용자와 에이전트 간 인터랙티브 응답에 사용됩니다.
   * @param runId - 대상 Run ID
   * @param message - 전송할 메시지
   * @returns 전송 성공 여부
   */
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

  /**
   * 이전에 실행된 Run과 동일한 설정으로 새 Run을 생성하고 실행합니다.
   * @param runId - 재시도할 기존 Run ID
   * @param engine - 재시도에 사용할 엔진
   * @returns 새 Run 생성 결과, 실패 시 null
   */
  async retryRun(runId: string, engine?: string): Promise<RunCreateResult | null> {
    const record = this.runStore.getRun(runId);
    if (!record) return null;
    const ws = record.workspace || this.defaultWorkspaceRoot;
    return this.createRun(record.agentName, record.prompt, ws, record.sandboxMode, record.approvalPolicy, engine);
  }

  /**
   * Run의 전체 출력을 반환하고 버퍼에서 제거합니다(1회 소비).
   * @param runId - 대상 Run ID
   * @returns 출력 라인 배열
   */
  popRunOutput(runId: string): string[] {
    const out = this.fullOutput.get(runId);
    this.fullOutput.delete(runId);
    return out ?? [];
  }

  /**
   * Run이 완료(completed / failed / cancelled) 상태가 될 때까지 대기합니다.
   * 200ms 간격으로 폴링하며, 최대 타임아웃까지 대기합니다.
   * @param runId - 대기할 Run ID
   * @returns 완료된 Run 레코드 또는 null
   */
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

  /**
   * RunOptions 객체로 새 Run을 시작합니다(하위 호환성 인터페이스).
   * @param options - Run 실행 옵션 (agentId, prompt, workspace, 등)
   * @returns 생성된 Run ID
   */
  async startRun(options: RunOptions): Promise<RunCreateResult> {
    const agents = this.configReader.listAgents();
    const agent = agents.find(a => a.id === options.agentId);
    const engine: EngineType = (options.engine ?? agent?.engine ?? SETTINGS.defaultEngine) as EngineType;

    return this.createRun(
      options.agentId, options.prompt, options.workspace,
      options.sandboxMode, options.approvalPolicy, engine,
    );
  }

  /**
   * Run의 실행 시간(밀리초)을 반환합니다.
   * @param runId - 대상 Run ID
   * @returns 실행 시간 (ms), 정보가 없으면 0
   */
  private getRunDuration(runId: string): number {
    const start = this.startTimes.get(runId);
    return start ? Date.now() - start : 0;
  }

  /**
   * Run 목록을 최신순으로 반환합니다.
   * @param limit - 최대 조회 개수
   * @param engine - 엔진 필터 (선택)
   * @returns Run 레코드 배열
   */
  listRuns(limit?: number, engine?: string) {
    return this.runStore.listRuns(limit, engine);
  }

  /**
   * 특정 Run의 상세 정보를 조회합니다.
   * @param runId - 조회할 Run ID
   * @returns Run 레코드 또는 null
   */
  getRun(runId: string) {
    return this.runStore.getRun(runId);
  }

  /**
   * Run의 이벤트 목록을 조회합니다.
   * @param runId - 대상 Run ID
   * @param limit - 최대 조회 개수
   * @returns 이벤트 배열
   */
  listRunEvents(runId: string, limit?: number) {
    return this.runStore.getEvents(runId, limit);
  }

  /**
   * 프롬프트의 유효성을 검증하고 정리합니다.
   * 빈 프롬프트나 최대 길이를 초과하는 프롬프트를 거부합니다.
   * @param prompt - 검증할 프롬프트 문자열
   * @returns 정리된 프롬프트
   * @throws 프롬프트가 비어있거나 최대 길이를 초과한 경우
   */
  validatePrompt(prompt: string): string {
    const cleaned = prompt.trim();
    if (!cleaned) throw new Error('prompt must not be empty');
    if (cleaned.length > SETTINGS.runPromptMaxLength) {
      throw new Error(`prompt length exceeds max: ${SETTINGS.runPromptMaxLength}`);
    }
    return cleaned;
  }

  /**
   * 작업 디렉터리 경로의 유효성을 검증합니다.
   * 경로가 없으면 기본 workspaceRoot를 반환하고, ~ 확장을 지원하며, 디렉터리 존재 여부를 확인합니다.
   * @param rawPath - 검증할 원시 경로
   * @returns 검증된 절대 경로
   * @throws 경로가 존재하지 않거나 디렉터리가 아닌 경우
   */
  validateWorkspaceRoot(rawPath: string | null | undefined): string {
    const candidate = (rawPath ?? '').trim();
    if (!candidate) return SETTINGS.workspaceRoot;
    const resolved = path.resolve(candidate.replace(/^~/, require('os').homedir()));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('workspace_root must point to an existing directory');
    }
    return resolved;
  }

  /**
   * 샌드박스 모드 값의 유효성을 검증합니다.
   * @param value - 검증할 샌드박스 모드 문자열
   * @returns 검증된 샌드박스 모드 값 (유효하지 않으면 null)
   * @throws 허용되지 않은 값인 경우
   */
  validateSandboxMode(value: string | null | undefined): string | null {
    if (!value) return null;
    const allowed = new Set(['read-only', 'workspace-write', 'danger-full-access']);
    if (!allowed.has(value)) throw new Error('invalid sandbox_mode');
    return value;
  }

  /**
   * 승인 정책 값의 유효성을 검증합니다.
   * @param value - 검증할 승인 정책 문자열
   * @returns 검증된 승인 정책 값 (유효하지 않으면 null)
   * @throws 허용되지 않은 값인 경우
   */
  validateApprovalPolicy(value: string | null | undefined): string | null {
    if (!value) return null;
    const allowed = new Set(['untrusted', 'on-request', 'never']);
    if (!allowed.has(value)) throw new Error('invalid approval_policy');
    return value;
  }

  /**
   * 프롬프트를 미리보기용으로 축약합니다.
   * 연속된 공백을 하나로 압축하고, 최대 길이를 초과하면 말줄임표로 자릅니다.
   * @param prompt - 원본 프롬프트
   * @param maxChars - 최대 문자 수 (기본값: SETTINGS.runPromptPreviewMaxChars)
   * @returns 축약된 프롬프트 문자열
   */
  toPromptPreview(prompt: string, maxChars?: number): string {
    const limit = maxChars ?? SETTINGS.runPromptPreviewMaxChars;
    const compact = prompt.trim().split(/\s+/).join(' ');
    if (compact.length <= limit) return compact;
    return compact.slice(0, limit - 3) + '...';
  }

  /**
   * ANSI 이스케이프 시퀀스와 비인쇄 문자를 제거합니다.
   * 한글, 영문, 숫자, 기본 구두점을 제외한 제어 문자를 필터링합니다.
   * @param text - 원본 텍스트
   * @returns 정리된 텍스트
   */
  private _stripAnsi(text: string): string {
    return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\].*?(?:\x1B\\|\x07))/g, '')
      .replace(/[^\x20-\x7E\n\r\tㄱ-ㅎㅏ-ㅣ가-힣a-zA-Z0-9.,!?()\-_=+@#$%^&*[\]{}|;:'"<>,.?\/`~ ]/g, '');
  }

  /**
   * 엔진 CLI를 통해 AI와 단일 채팅 메시지를 주고받습니다.
   * opencode 엔진은 서버 모드 HTTP API를 통해 처리하고, 나머지는 직접 spawn합니다.
   * @param message - 사용자 메시지
   * @param systemPrompt - 시스템 프롬프트 (선택)
   * @param engine - 사용할 엔진
   * @returns AI 응답 문자열
   */
  async chat(message: string, systemPrompt?: string, engine?: string): Promise<string> {
    const valid: EngineType[] = ['gemini', 'opencode', 'claudecode'];
    const targetEngine = valid.includes(engine as EngineType) ? (engine as EngineType) : SETTINGS.defaultEngine;
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${message}` : message;

    const binary = createEngineAdapter(targetEngine).binaryName;
    let cliPath = this.configReader.getEnginePath(targetEngine);
    if (!cliPath) {
      cliPath = binary;
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

  /**
   * opencode 서버 모드가 실행 중인지 확인하고, 없으면 새로 시작합니다.
   * HTTP 헬스 체크로 서버 가용성을 확인하며, 최대 20초간 대기합니다.
   * @returns 서버 준비 완료 여부
   */
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
      const opencodeCli = this.configReader.getEnginePath('opencode') ?? createEngineAdapter('opencode').binaryName;
      this.opencodeServer = spawn(opencodeCli, ['serve', '--port', String(this.OPENCODE_PORT), '--hostname', '127.0.0.1'], {
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

  /**
   * 실행 중인 opencode 서버 프로세스를 종료합니다.
   */
  stopOpencodeServer(): void {
    if (this.opencodeServer && !this.opencodeServer.killed) {
      this.opencodeServer.kill('SIGTERM');
      this.opencodeServer = null;
    }
  }

  /**
   * HTTP POST 요청을 전송하고 응답을 문자열로 반환합니다.
   * opencode 서버 API 호출에 사용됩니다.
   * @param host - 대상 호스트
   * @param port - 포트 번호
   * @param urlPath - 요청 경로
   * @param body - 요청 본문
   * @param timeoutMs - 타임아웃 (ms)
   * @returns 응답 본문
   * @throws 타임아웃 또는 네트워크 에러 시
   */
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

  /**
   * opencode 서버 모드를 통해 Run을 실행합니다.
   * HTTP API로 세션을 생성하고 메시지를 전송한 후 응답을 수집합니다.
   * @param runId - 실행할 Run ID
   * @param agentName - 에이전트 이름
   * @param prompt - 실행 프롬프트
   * @param _workspaceRoot - 작업 디렉터리 (opencode 서버 모드에서는 사용하지 않음)
   */
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

  /**
   * opencode 서버 모드를 통해 채팅 메시지를 전송하고 응답을 받습니다.
   * @param prompt - 전송할 프롬프트
   * @returns AI 응답 문자열
   */
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

  /**
   * Run의 세부 실행 상태를 설정하고 이벤트를 발행합니다.
   * @param runId - 대상 Run ID
   * @param subStatus - 설정할 세부 상태 (initializing / executing_cli / processing_output)
   */
  private _setRunningSubStatus(runId: string, subStatus: RunningSubStatus): void {
    this.runningSubStatuses.set(runId, subStatus);
    this.runStore.appendEvent(runId, 'run:sub-status', subStatus);
    this._publishRunEvent(runId, 'run:sub-status', `sub-status: ${subStatus}`);
  }

  /**
   * Run 이벤트를 EventBroker를 통해 구독자에게 전파합니다.
   * @param runId - 관련 Run ID
   * @param eventType - 이벤트 타입
   * @param message - 이벤트 메시지
   */
  private _publishRunEvent(runId: string, eventType: string, message: string): void {
    this.eventBroker.pushEvent({
      runId,
      type: eventType as 'start' | 'progress' | 'log' | 'output' | 'done' | 'error',
      timestamp: new Date().toISOString(),
      data: { eventType, message },
    });
  }

  /**
   * 에이전트 실행에 사용할 최종 프롬프트를 구성합니다.
   * 엔진 식별, 에이전트 역할 정의, 스킬 컨텍스트, 파일 안전 규칙을 헤더로 추가합니다.
   * @param agentName - 에이전트 이름
   * @param prompt - 사용자 원본 프롬프트
   * @param skillContent - 에이전트 스킬 정의 내용 (선택)
   * @param engine - 사용할 엔진
   * @returns 구성된 전체 프롬프트
   */
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

  /**
   * 프롬프트에서 파일 경로 패턴을 찾아 작업 디렉터리로 추출합니다.
   * CSV, JSON, XLSX, TSV, Parquet 파일의 상위 디렉터리를 반환합니다.
   * @param prompt - 프롬프트 문자열
   * @returns 추출된 디렉터리 경로, 없으면 null
   */
  private _extractCwdFromPrompt(prompt: string): string | null {
    const fileMatch = prompt.match(/[-\w/]+\/([\w-]+\.(csv|json|xlsx?|tsv|parquet))/);
    if (fileMatch) {
      const dir = path.dirname(fileMatch[0]);
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    }
    return null;
  }

  /**
   * 에이전트 설정에서 스킬 파일 경로를 읽고 파일 내용을 반환합니다.
   * agentName/config.json의 skill_path를 참조합니다.
   * @param agentName - 에이전트 이름
   * @param engine - 에이전트 루트 경로를 결정할 엔진
   * @returns 스킬 파일 내용과 경로, 없으면 null
   */
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
