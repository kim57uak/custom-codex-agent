import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import type { Workflow } from '../../types/ipc-contract';

export interface WorkflowRunRecord {
  workflowRunId: string;
  goalPrompt: string;
  workspaceRoot: string;
  sandboxMode: string | null;
  approvalPolicy: string | null;
  status: string;
  currentStepIndex: number | null;
  totalSteps: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface WorkflowStepRecord {
  stepIndex: number;
  workflowRunId: string;
  agentName: string;
  skillName: string | null;
  iconKey: string;
  title: string;
  prompt: string;
  status: string;
  runId: string | null;
  reason: string | null;
  summary: string | null;
  lastEventMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  errorMessage: string | null;
}

export interface WorkflowEventRecord {
  eventId: number;
  workflowRunId: string;
  stepIndex: number | null;
  eventType: string;
  message: string;
  createdAt: string;
}

export class WorkflowStore {
  private db: Database.Database;

  constructor() {
    const dbPath = path.join(os.homedir(), '.config', 'agent-orchestrator', 'workflows.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

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

  private _migrateSchema(): void {
    for (const table of ['workflow_runs', 'workflow_steps', 'workflow_events']) {
      const existing = this.db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
      const existingNames = new Set(existing.map(c => c.name));
      const cols: Array<{ name: string; def: string }> = [
        { name: 'created_at', def: 'TEXT' },
        { name: 'started_at', def: 'TEXT' },
        { name: 'completed_at', def: 'TEXT' },
        { name: 'error_message', def: 'TEXT' },
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

  createWorkflow(workflow: Workflow): Workflow {
    const stmt = this.db.prepare(`
      INSERT INTO workflows (id, name, nodes, edges, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(workflow.id, workflow.name, JSON.stringify(workflow.nodes), JSON.stringify(workflow.edges), workflow.createdAt, workflow.updatedAt);
    return workflow;
  }

  getWorkflow(id: string): Workflow | null {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this._rowToWorkflow(row);
  }

  updateWorkflow(workflow: Workflow): Workflow | null {
    const result = this.db.prepare('UPDATE workflows SET name = ?, nodes = ?, edges = ?, updated_at = ? WHERE id = ?')
      .run(workflow.name, JSON.stringify(workflow.nodes), JSON.stringify(workflow.edges), workflow.updatedAt, workflow.id);
    return result.changes > 0 ? workflow : null;
  }

  deleteWorkflow(id: string): boolean {
    return this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id).changes > 0;
  }

  listWorkflows(): Workflow[] {
    const rows = this.db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC').all() as Record<string, unknown>[];
    return rows.map(row => this._rowToWorkflow(row));
  }

  createWorkflowRun(goalPrompt: string, steps: Array<{ agentName: string; prompt: string; title?: string; iconKey?: string; skillName?: string | null }>,
    workspaceRoot?: string, sandboxMode?: string | null, approvalPolicy?: string | null): WorkflowRunRecord {
    const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO workflow_runs (workflow_run_id, goal_prompt, workspace_root, sandbox_mode, approval_policy, status, current_step_index, total_steps, created_at)
      VALUES (?, ?, ?, ?, ?, 'draft', NULL, ?, ?)
    `).run(id, goalPrompt, workspaceRoot ?? '', sandboxMode ?? null, approvalPolicy ?? null, steps.length, now);

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      this.db.prepare(`
        INSERT INTO workflow_steps (step_index, workflow_run_id, agent_name, skill_name, icon_key, title, prompt, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ready')
      `).run(i, id, s.agentName, s.skillName ?? null, s.iconKey ?? 'bot', s.title ?? `단계 ${i + 1}`, s.prompt);
    }

    return this.getWorkflowRun(id)!;
  }

  getWorkflowRun(workflowRunId: string): WorkflowRunRecord | null {
    const row = this.db.prepare('SELECT * FROM workflow_runs WHERE workflow_run_id = ?').get(workflowRunId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this._rowToWorkflowRun(row);
  }

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

  getWorkflowSteps(workflowRunId: string): WorkflowStepRecord[] {
    const rows = this.db.prepare('SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY step_index ASC').all(workflowRunId) as Record<string, unknown>[];
    return rows.map(r => this._rowToStep(r));
  }

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

  addWorkflowEvent(workflowRunId: string, eventType: string, message: string, stepIndex?: number | null): WorkflowEventRecord {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO workflow_events (workflow_run_id, step_index, event_type, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(workflowRunId, stepIndex ?? null, eventType, message, now);
    return { eventId: Number(result.lastInsertRowid), workflowRunId, stepIndex: stepIndex ?? null, eventType, message, createdAt: now };
  }

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

  listWorkflowRuns(limit?: number): WorkflowRunRecord[] {
    const rows = this.db.prepare(`SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT ${limit ?? 50}`).all() as Record<string, unknown>[];
    return rows.map(r => this._rowToWorkflowRun(r));
  }

  close(): void {
    this.db.close();
  }

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

  private _rowToWorkflowRun(row: Record<string, unknown>): WorkflowRunRecord {
    return {
      workflowRunId: row.workflow_run_id as string,
      goalPrompt: row.goal_prompt as string,
      workspaceRoot: row.workspace_root as string,
      sandboxMode: row.sandbox_mode as string | null,
      approvalPolicy: row.approval_policy as string | null,
      status: row.status as string,
      currentStepIndex: row.current_step_index as number | null,
      totalSteps: row.total_steps as number,
      createdAt: row.created_at as string,
      startedAt: row.started_at as string | null,
      completedAt: row.completed_at as string | null,
      errorMessage: row.error_message as string | null,
    };
  }

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
