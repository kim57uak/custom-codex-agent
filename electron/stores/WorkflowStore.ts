/**
 * WorkflowStore — 워크플로우/워크플로우 실행 SQLite 저장소.
 *
 * @what
 * - 워크플로우 정의(workflows), 워크플로우 실행(workflow_runs), 실행 단계(workflow_steps),
 *   워크플로우 이벤트(workflow_events)를 SQLite(workflows.db)에 저장하고 관리합니다.
 *
 * @design
 * - 단계 제거 시 step_index를 순차적으로 재정렬하여 일관성을 유지합니다.
 * - 스키마 마이그레이션을 자동 수행하여 버전 간 호환성을 보장합니다.
 * - 외래키 제약으로 데이터 무결성을 유지합니다.
 *
 * @usage
 *   const store = new WorkflowStore();
 *   const run = store.createWorkflowRun(goalPrompt, steps);
 *   store.updateWorkflowRunStatus(run.workflowRunId, 'running', 0);
 *   const steps = store.getWorkflowSteps(run.workflowRunId);
 */
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import type { Workflow } from '../../types/ipc-contract';

/** 워크플로우 실행 레코드. 하나의 워크플로우 실행 전체를 나타냅니다. */
export interface WorkflowRunRecord {
  /** 워크플로우 실행 고유 ID */
  workflowRunId: string;
  /** 실행 목표 프롬프트 */
  goalPrompt: string;
  /** 작업 공간 루트 경로 */
  workspaceRoot: string;
  /** 샌드박스 모드 (null 가능) */
  sandboxMode: string | null;
  /** 승인 정책 (null 가능) */
  approvalPolicy: string | null;
  /** 사용 엔진 (null 가능) */
  engine: string | null;
  /** 실행 상태 (draft/running/completed/failed/cancelled) */
  status: string;
  /** 현재 진행 중인 단계 인덱스 */
  currentStepIndex: number | null;
  /** 전체 단계 수 */
  totalSteps: number;
  /** 생성 시간 (ISO-8601) */
  createdAt: string;
  /** 시작 시간 (ISO-8601) */
  startedAt: string | null;
  /** 완료 시간 (ISO-8601) */
  completedAt: string | null;
  /** 오류 메시지 (null 가능) */
  errorMessage: string | null;
}

/** 워크플로우 실행의 개별 단계 레코드. */
export interface WorkflowStepRecord {
  /** 단계 인덱스 (0-based) */
  stepIndex: number;
  /** 소속 워크플로우 실행 ID */
  workflowRunId: string;
  /** 담당 에이전트 이름 */
  agentName: string;
  /** 사용 스킬 이름 (null 가능) */
  skillName: string | null;
  /** 아이콘 키 */
  iconKey: string;
  /** 단계 제목 */
  title: string;
  /** 단계 실행 프롬프트 */
  prompt: string;
  /** 단계 상태 (ready/running/completed/failed/skipped) */
  status: string;
  /** 연결된 실행 레코드 ID */
  runId: string | null;
  /** 실행 사유 */
  reason: string | null;
  /** 실행 요약 */
  summary: string | null;
  /** 마지막 이벤트 메시지 */
  lastEventMessage: string | null;
  /** 시작 시간 (ISO-8601) */
  startedAt: string | null;
  /** 완료 시간 (ISO-8601) */
  completedAt: string | null;
  /** 종료 코드 */
  exitCode: number | null;
  /** 오류 메시지 */
  errorMessage: string | null;
}

/** 워크플로우 실행 중 발생한 이벤트 레코드. */
export interface WorkflowEventRecord {
  /** 이벤트 자동 증가 ID */
  eventId: number;
  /** 소속 워크플로우 실행 ID */
  workflowRunId: string;
  /** 관련 단계 인덱스 (null 가능) */
  stepIndex: number | null;
  /** 이벤트 타입 */
  eventType: string;
  /** 이벤트 메시지 */
  message: string;
  /** 이벤트 생성 시간 (ISO-8601) */
  createdAt: string;
}

export class WorkflowStore {
  /** SQLite 데이터베이스 인스턴스 */
  private db: Database.Database;

  /**
   * WorkflowStore 인스턴스를 생성합니다.
   * workflows.db 파일을 열고 WAL 모드를 활성화한 후 스키마를 초기화합니다.
   */
  constructor() {
    const dbPath = path.join(os.homedir(), '.config', 'agent-orchestrator', 'workflows.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  /**
   * 워크플로우 관련 모든 테이블(workflows, workflow_runs, workflow_steps, workflow_events)을 생성하고
   * 인덱스를 설정합니다. 이후 스키마 마이그레이션을 실행합니다.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        nodes TEXT NOT NULL,
        edges TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        workflow_run_id TEXT PRIMARY KEY,
        goal_prompt TEXT NOT NULL,
        workspace_root TEXT NOT NULL DEFAULT '',
        sandbox_mode TEXT,
        approval_policy TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        current_step_index INTEGER,
        total_steps INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS workflow_steps (
        step_index INTEGER NOT NULL,
        workflow_run_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        skill_name TEXT,
        icon_key TEXT NOT NULL DEFAULT 'bot',
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        run_id TEXT,
        reason TEXT,
        summary TEXT,
        last_event_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        exit_code INTEGER,
        error_message TEXT,
        PRIMARY KEY (workflow_run_id, step_index),
        FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(workflow_run_id)
      );

      CREATE TABLE IF NOT EXISTS workflow_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_run_id TEXT NOT NULL,
        step_index INTEGER,
        event_type TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(workflow_run_id)
      );

      CREATE INDEX IF NOT EXISTS idx_wf_runs_created ON workflow_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_wf_steps_run_id ON workflow_steps(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_wf_events_run_id ON workflow_events(workflow_run_id);
    `);
    this._migrateSchema();
  }

  /**
   * 기존 테이블에 누락된 컬럼이 있으면 추가합니다.
   * 실행 시점의 실제 테이블 스키마를 조회하여 마이그레이션을 수행합니다.
   */
  private _migrateSchema(): void {
    for (const table of ['workflow_runs', 'workflow_steps', 'workflow_events']) {
      const existing = this.db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
      const existingNames = new Set(existing.map(c => c.name));
      const cols: Array<{ name: string; def: string }> = [
        { name: 'created_at', def: 'TEXT' },
        { name: 'started_at', def: 'TEXT' },
        { name: 'completed_at', def: 'TEXT' },
        { name: 'error_message', def: 'TEXT' },
        { name: 'engine', def: 'TEXT' },
        { name: 'sandbox_mode', def: 'TEXT' },
        { name: 'approval_policy', def: 'TEXT' },
        { name: 'skill_name', def: 'TEXT' },
        { name: 'icon_key', def: 'TEXT' },
        { name: 'summary', def: 'TEXT' },
        { name: 'last_event_message', def: 'TEXT' },
        { name: 'exit_code', def: 'INTEGER' },
        { name: 'run_id', def: 'TEXT' },
        { name: 'reason', def: 'TEXT' },
      ];
      for (const col of cols) {
        if (!existingNames.has(col.name)) {
          try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.def}`); } catch { /* ok */ }
        }
      }
    }
  }

  /**
   * 새 워크플로우 정의를 저장합니다.
   * @param workflow - 저장할 워크플로우 객체
   * @returns 저장된 워크플로우 객체
   */
  createWorkflow(workflow: Workflow): Workflow {
    const stmt = this.db.prepare(`
      INSERT INTO workflows (id, name, nodes, edges, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(workflow.id, workflow.name, JSON.stringify(workflow.nodes), JSON.stringify(workflow.edges), workflow.createdAt, workflow.updatedAt);
    return workflow;
  }

  /**
   * ID로 워크플로우 정의를 조회합니다.
   * @param id - 워크플로우 ID
   * @returns 워크플로우 객체, 없으면 null
   */
  getWorkflow(id: string): Workflow | null {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this._rowToWorkflow(row);
  }

  /**
   * 기존 워크플로우 정의를 갱신합니다.
   * @param workflow - 갱신할 워크플로우 객체
   * @returns 갱신된 워크플로우, 업데이트 실패 시 null
   */
  updateWorkflow(workflow: Workflow): Workflow | null {
    const result = this.db.prepare('UPDATE workflows SET name = ?, nodes = ?, edges = ?, updated_at = ? WHERE id = ?')
      .run(workflow.name, JSON.stringify(workflow.nodes), JSON.stringify(workflow.edges), workflow.updatedAt, workflow.id);
    return result.changes > 0 ? workflow : null;
  }

  /**
   * ID로 워크플로우 정의를 삭제합니다.
   * @param id - 삭제할 워크플로우 ID
   * @returns 삭제 성공 여부
   */
  deleteWorkflow(id: string): boolean {
    return this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id).changes > 0;
  }

  /**
   * 모든 워크플로우 정의를 최근 업데이트순으로 조회합니다.
   * @returns 워크플로우 객체 배열
   */
  listWorkflows(): Workflow[] {
    const rows = this.db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC').all() as Record<string, unknown>[];
    return rows.map(row => this._rowToWorkflow(row));
  }

  /**
   * 새 워크플로우 실행을 생성합니다. 실행 레코드와 모든 단계 레코드를 함께 저장합니다.
   * @param goalPrompt - 실행 목표 프롬프트
   * @param steps - 실행 단계 배열 (에이전트 이름, 프롬프트, 제목 등)
   * @param workspaceRoot - 작업 공간 경로 (선택)
   * @param sandboxMode - 샌드박스 모드 (선택)
   * @param approvalPolicy - 승인 정책 (선택)
   * @param engine - 엔진 이름 (선택)
   * @returns 생성된 워크플로우 실행 레코드
   */
  createWorkflowRun(goalPrompt: string, steps: Array<{ agentName: string; prompt: string; title?: string; iconKey?: string; skillName?: string | null }>,
    workspaceRoot?: string, sandboxMode?: string | null, approvalPolicy?: string | null, engine?: string | null): WorkflowRunRecord {
    const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO workflow_runs (workflow_run_id, goal_prompt, workspace_root, sandbox_mode, approval_policy, engine, status, current_step_index, total_steps, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)
    `).run(id, goalPrompt, workspaceRoot ?? '', sandboxMode ?? null, approvalPolicy ?? null, engine ?? null, steps.length, now);

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      this.db.prepare(`
        INSERT INTO workflow_steps (step_index, workflow_run_id, agent_name, skill_name, icon_key, title, prompt, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ready')
      `).run(i, id, s.agentName, s.skillName ?? null, s.iconKey ?? 'bot', s.title ?? `단계 ${i + 1}`, s.prompt);
    }

    return this.getWorkflowRun(id)!;
  }

  /**
   * ID로 워크플로우 실행 레코드를 조회합니다.
   * @param workflowRunId - 워크플로우 실행 ID
   * @returns 워크플로우 실행 레코드, 없으면 null
   */
  getWorkflowRun(workflowRunId: string): WorkflowRunRecord | null {
    const row = this.db.prepare('SELECT * FROM workflow_runs WHERE workflow_run_id = ?').get(workflowRunId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this._rowToWorkflowRun(row);
  }

  /**
   * 워크플로우 실행의 상태를 갱신합니다. 시작/완료 시간을 자동으로 설정합니다.
   * @param workflowRunId - 워크플로우 실행 ID
   * @param status - 새 상태 (running/completed/failed/cancelled)
   * @param currentStepIndex - 현재 단계 인덱스 (선택)
   * @param errorMessage - 오류 메시지 (선택)
   */
  updateWorkflowRunStatus(workflowRunId: string, status: string, currentStepIndex?: number, errorMessage?: string | null): void {
    const now = new Date().toISOString();
    const startedAt = status === 'running' ? now : undefined;
    const completedAt = (status === 'completed' || status === 'failed' || status === 'cancelled') ? now : undefined;
    const sets: string[] = ['status = ?'];
    const params: unknown[] = [status];
    if (currentStepIndex !== undefined) { sets.push('current_step_index = ?'); params.push(currentStepIndex); }
    if (errorMessage !== undefined) { sets.push('error_message = ?'); params.push(errorMessage); }
    if (startedAt) { sets.push('started_at = ?'); params.push(startedAt); }
    if (completedAt) { sets.push('completed_at = ?'); params.push(completedAt); }
    params.push(workflowRunId);
    this.db.prepare(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE workflow_run_id = ?`).run(...params);
  }

  /**
   * 워크플로우 실행의 모든 단계를 단계 인덱스 순으로 조회합니다.
   * @param workflowRunId - 워크플로우 실행 ID
   * @returns 단계 레코드 배열
   */
  getWorkflowSteps(workflowRunId: string): WorkflowStepRecord[] {
    const rows = this.db.prepare('SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY step_index ASC').all(workflowRunId) as Record<string, unknown>[];
    return rows.map(r => this._rowToStep(r));
  }

  /**
   * 워크플로우 실행에 새 단계를 추가합니다. total_steps를 자동으로 증가시킵니다.
   * @param workflowRunId - 워크플로우 실행 ID
   * @param step - 추가할 단계 정보
   */
  addWorkflowStep(workflowRunId: string, step: { agentName: string; prompt: string; title?: string; iconKey?: string; skillName?: string | null }): void {
    const steps = this.getWorkflowSteps(workflowRunId);
    const nextIndex = steps.length;
    this.db.prepare(`
      INSERT INTO workflow_steps (step_index, workflow_run_id, agent_name, skill_name, icon_key, title, prompt, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ready')
    `).run(nextIndex, workflowRunId, step.agentName, step.skillName ?? null, step.iconKey ?? 'bot', step.title ?? `${step.agentName}`, step.prompt);
    this.db.prepare(`UPDATE workflow_runs SET total_steps = ? WHERE workflow_run_id = ?`).run(nextIndex + 1, workflowRunId);
  }

  /**
   * 워크플로우 실행의 특정 단계를 부분 갱신합니다.
   * 상태 변경 시 시작/완료 시간을 자동으로 설정합니다.
   * @param workflowRunId - 워크플로우 실행 ID
   * @param stepIndex - 갱신할 단계 인덱스
   * @param updates - 갱신할 필드의 부분 객체
   */
  updateWorkflowStep(workflowRunId: string, stepIndex: number, updates: Partial<WorkflowStepRecord>): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(updates)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (col === 'started_at' && value === null) continue;
      sets.push(`${col} = ?`);
      params.push(value !== undefined ? value : null);
    }
    if (updates.status === 'running' && !updates.startedAt) {
      sets.push('started_at = ?');
      params.push(now);
    }
    if (updates.status && ['completed', 'failed', 'cancelled', 'skipped'].includes(updates.status) && !updates.completedAt) {
      sets.push('completed_at = ?');
      params.push(now);
    }
    if (sets.length === 0) return;
    params.push(workflowRunId, stepIndex);
    this.db.prepare(`UPDATE workflow_steps SET ${sets.join(', ')} WHERE workflow_run_id = ? AND step_index = ?`).run(...params);
  }

  /**
   * 워크플로우 실행에서 특정 단계를 제거하고 나머지 단계의 인덱스를 재정렬합니다.
   * @param workflowRunId - 워크플로우 실행 ID
   * @param stepIndex - 제거할 단계 인덱스
   */
  removeWorkflowStep(workflowRunId: string, stepIndex: number): void {
    const del = this.db.prepare('DELETE FROM workflow_steps WHERE workflow_run_id = ? AND step_index = ?');
    const reindex = this.db.prepare('UPDATE workflow_steps SET step_index = ? WHERE workflow_run_id = ? AND step_index = ?');
    const remaining = this.db.prepare('SELECT step_index FROM workflow_steps WHERE workflow_run_id = ? AND step_index != ? ORDER BY step_index')
      .all(workflowRunId, stepIndex) as Array<{ step_index: number }>;
    this.db.transaction(() => {
      del.run(workflowRunId, stepIndex);
      for (let i = 0; i < remaining.length; i++) {
        reindex.run(i, workflowRunId, remaining[i]!.step_index);
      }
      this.db.prepare('UPDATE workflow_runs SET total_steps = ?, current_step_index = NULL WHERE workflow_run_id = ?')
        .run(remaining.length, workflowRunId);
    })();
  }

  /**
   * 워크플로우 실행과 연관된 모든 데이터(단계, 이벤트)를 함께 삭제합니다.
   * @param workflowRunId - 삭제할 워크플로우 실행 ID
   * @returns 삭제 성공 여부
   */
  deleteWorkflowRun(workflowRunId: string): boolean {
    const run = this.getWorkflowRun(workflowRunId);
    if (!run) return false;
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM workflow_events WHERE workflow_run_id = ?').run(workflowRunId);
      this.db.prepare('DELETE FROM workflow_steps WHERE workflow_run_id = ?').run(workflowRunId);
      this.db.prepare('DELETE FROM workflow_runs WHERE workflow_run_id = ?').run(workflowRunId);
    })();
    return true;
  }

  /**
   * 워크플로우 실행의 목표 프롬프트를 갱신합니다.
   * @param workflowRunId - 워크플로우 실행 ID
   * @param goalPrompt - 새 목표 프롬프트
   */
  updateWorkflowRunGoalPrompt(workflowRunId: string, goalPrompt: string): void {
    this.db.prepare('UPDATE workflow_runs SET goal_prompt = ? WHERE workflow_run_id = ?').run(goalPrompt, workflowRunId);
  }

  /**
   * 워크플로우 실행에 이벤트를 추가합니다.
   * @param workflowRunId - 워크플로우 실행 ID
   * @param eventType - 이벤트 타입
   * @param message - 이벤트 메시지
   * @param stepIndex - 관련 단계 인덱스 (선택)
   * @returns 생성된 이벤트 레코드
   */
  addWorkflowEvent(workflowRunId: string, eventType: string, message: string, stepIndex?: number | null): WorkflowEventRecord {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO workflow_events (workflow_run_id, step_index, event_type, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(workflowRunId, stepIndex ?? null, eventType, message, now);
    return { eventId: Number(result.lastInsertRowid), workflowRunId, stepIndex: stepIndex ?? null, eventType, message, createdAt: now };
  }

  /**
   * 워크플로우 실행의 이벤트 목록을 시간순으로 조회합니다.
   * @param workflowRunId - 워크플로우 실행 ID
   * @param limit - 최대 조회 개수 (선택)
   * @returns 이벤트 레코드 배열
   */
  getWorkflowEvents(workflowRunId: string, limit?: number): WorkflowEventRecord[] {
    let query = 'SELECT * FROM workflow_events WHERE workflow_run_id = ? ORDER BY created_at ASC';
    if (limit) query += ' LIMIT ?';
    const rows = this.db.prepare(query).all(workflowRunId, ...(limit ? [limit] : [])) as Record<string, unknown>[];
    return rows.map(r => ({
      eventId: r.event_id as number,
      workflowRunId: r.workflow_run_id as string,
      stepIndex: r.step_index as number | null,
      eventType: r.event_type as string,
      message: r.message as string,
      createdAt: r.created_at as string,
    }));
  }

  /**
   * 모든 워크플로우 실행을 최근 생성순으로 조회합니다.
   * @param limit - 최대 조회 개수 (기본값 50)
   * @returns 워크플로우 실행 레코드 배열
   */
  listWorkflowRuns(limit?: number): WorkflowRunRecord[] {
    const rows = this.db.prepare(`SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT ${limit ?? 50}`).all() as Record<string, unknown>[];
    return rows.map(r => this._rowToWorkflowRun(r));
  }

  /**
   * 데이터베이스 연결을 종료합니다.
   */
  close(): void {
    this.db.close();
  }

  /**
   * SQLite 행 데이터를 Workflow 객체로 변환합니다.
   * @param row - workflows 테이블의 행
   * @returns 변환된 Workflow 객체
   */
  private _rowToWorkflow(row: Record<string, unknown>): Workflow {
    return {
      id: row.id as string,
      name: row.name as string,
      nodes: JSON.parse(row.nodes as string),
      edges: JSON.parse(row.edges as string),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /**
   * SQLite 행 데이터를 WorkflowRunRecord 객체로 변환합니다.
   * @param row - workflow_runs 테이블의 행
   * @returns 변환된 WorkflowRunRecord 객체
   */
  private _rowToWorkflowRun(row: Record<string, unknown>): WorkflowRunRecord {
    return {
      workflowRunId: row.workflow_run_id as string,
      goalPrompt: row.goal_prompt as string,
      workspaceRoot: row.workspace_root as string,
      sandboxMode: row.sandbox_mode as string | null,
      approvalPolicy: row.approval_policy as string | null,
      engine: row.engine as string | null,
      status: row.status as string,
      currentStepIndex: row.current_step_index as number | null,
      totalSteps: row.total_steps as number,
      createdAt: row.created_at as string,
      startedAt: row.started_at as string | null,
      completedAt: row.completed_at as string | null,
      errorMessage: row.error_message as string | null,
    };
  }

  /**
   * SQLite 행 데이터를 WorkflowStepRecord 객체로 변환합니다.
   * @param row - workflow_steps 테이블의 행
   * @returns 변환된 WorkflowStepRecord 객체
   */
  private _rowToStep(row: Record<string, unknown>): WorkflowStepRecord {
    return {
      stepIndex: row.step_index as number,
      workflowRunId: row.workflow_run_id as string,
      agentName: row.agent_name as string,
      skillName: row.skill_name as string | null,
      iconKey: row.icon_key as string,
      title: row.title as string,
      prompt: row.prompt as string,
      status: row.status as string,
      runId: row.run_id as string | null,
      reason: row.reason as string | null,
      summary: row.summary as string | null,
      lastEventMessage: row.last_event_message as string | null,
      startedAt: row.started_at as string | null,
      completedAt: row.completed_at as string | null,
      exitCode: row.exit_code as number | null,
      errorMessage: row.error_message as string | null,
    };
  }
}
