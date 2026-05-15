import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import type { RunOptions, RunStatus, EngineType } from '../../types/ipc-contract';

export interface RunRecord {
  id: string;
  agentId: string;
  agentName: string;
  prompt: string;
  status: RunStatus;
  workspace: string | null;
  engine: string;
  sandboxMode: string | null;
  approvalPolicy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  error: string | null;
}

export interface RunEventRecord {
  eventId: number;
  runId: string;
  eventType: string;
  message: string;
  createdAt: string;
}

export class RunStore {
  private db: Database.Database;
  private pendingEvents: Array<{ runId: string; type: string; message: string; createdAt: string }> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const dbPath = path.join(os.homedir(), '.config', 'agent-orchestrator', 'runs.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        workspace TEXT,
        engine TEXT NOT NULL DEFAULT 'codex',
        sandbox_mode TEXT,
        approval_policy TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        exit_code INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
      CREATE INDEX IF NOT EXISTS idx_runs_agent_id ON runs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS run_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id);
      CREATE INDEX IF NOT EXISTS idx_run_events_run_created ON run_events(run_id, created_at DESC);
    `);

    this._migrateSchema();
  }

  private _migrateSchema(): void {
    this._migrateTable('runs', [
      { name: 'exit_code', def: 'INTEGER' },
      { name: 'agent_name', def: "TEXT NOT NULL DEFAULT ''" },
      { name: 'engine', def: "TEXT NOT NULL DEFAULT 'codex'" },
      { name: 'sandbox_mode', def: 'TEXT' },
      { name: 'approval_policy', def: 'TEXT' },
      { name: 'started_at', def: 'TEXT' },
      { name: 'created_at', def: 'TEXT' },
      { name: 'completed_at', def: 'TEXT' },
      { name: 'error', def: 'TEXT' },
    ]);
    this._migrateTable('run_events', [
      { name: 'created_at', def: 'TEXT' },
    ]);
  }

  private _migrateTable(table: string, columns: Array<{ name: string; def: string }>): void {
    const existing = this.db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
    const existingNames = new Set(existing.map(c => c.name));
    for (const col of columns) {
      if (!existingNames.has(col.name)) {
        try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.def}`); } catch { /* ok */ }
      }
    }
  }

  createRun(options: RunOptions & { agentName?: string; engine?: string; sandboxMode?: string | null; approvalPolicy?: string | null }): RunRecord {
    const id = randomUUID().replace(/-/g, '');
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, agent_id, agent_name, prompt, status, workspace, engine, sandbox_mode, approval_policy, created_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      options.agentId,
      options.agentName ?? options.agentId,
      options.prompt,
      options.workspace ?? null,
      options.engine ?? 'codex',
      options.sandboxMode ?? null,
      options.approvalPolicy ?? null,
      now,
    );
    return this.getRun(id)!;
  }

  getRun(id: string): RunRecord | null {
    const stmt = this.db.prepare('SELECT * FROM runs WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this._rowToRecord(row);
  }

  markRunning(id: string): RunRecord | null {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE runs SET status = 'running', started_at = ?, error = NULL WHERE id = ? AND status = 'queued'
    `).run(now, id);
    return this.getRun(id);
  }

  finishRun(id: string, status: RunStatus, exitCode: number | null, errorMessage: string | null): RunRecord | null {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE runs SET status = ?, completed_at = ?, exit_code = ?, error = ? WHERE id = ?
    `).run(status, now, exitCode, errorMessage, id);
    return this.getRun(id);
  }

  updateRunStatus(id: string, status: RunStatus, error?: string): void {
    const completedAt = (status === 'completed' || status === 'failed' || status === 'cancelled')
      ? new Date().toISOString() : null;
    this.db.prepare('UPDATE runs SET status = ?, completed_at = ?, error = ? WHERE id = ?')
      .run(status, completedAt, error ?? null, id);
  }

  listRuns(limit?: number, engine?: string): RunRecord[] {
    let query = 'SELECT * FROM runs';
    const params: unknown[] = [];
    if (engine) {
      query += ' WHERE engine = ?';
      params.push(engine);
    }
    query += ' ORDER BY created_at DESC';
    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    } else {
      query += ' LIMIT 100';
    }
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map(row => this._rowToRecord(row));
  }

  addEvent(runId: string, type: string, data: unknown): void {
    this.pendingEvents.push({
      runId,
      type,
      message: JSON.stringify(data),
      createdAt: new Date().toISOString()
    });

    if (this.pendingEvents.length >= 100) {
      this.flushEvents();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushEvents(), 50);
    }
  }

  private flushEvents(): void {
    if (this.pendingEvents.length === 0) return;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const events = [...this.pendingEvents];
    this.pendingEvents = [];

    const stmt = this.db.prepare(`
      INSERT INTO run_events (run_id, event_type, message, created_at) VALUES (?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const event of events) {
        stmt.run(event.runId, event.type, event.message, event.createdAt);
      }
    })();
  }

  appendEvent(runId: string, eventType: string, message: string): RunEventRecord {
    this.flushEvents();
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO run_events (run_id, event_type, message, created_at) VALUES (?, ?, ?, ?)
    `).run(runId, eventType, message, now);
    return { eventId: Number(result.lastInsertRowid), runId, eventType, message, createdAt: now };
  }

  getEvents(runId: string, limit?: number): RunEventRecord[] {
    this.flushEvents();
    let query = 'SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC';
    if (limit) query += ' LIMIT ?';
    const rows = this.db.prepare(query).all(runId, ...(limit ? [limit] : [])) as Record<string, unknown>[];
    return rows.map(row => ({
      eventId: row.event_id as number,
      runId: row.run_id as string,
      eventType: row.event_type as string,
      message: row.message as string,
      createdAt: row.created_at as string,
    }));
  }

  close(): void {
    this.db.close();
  }

  private _rowToRecord(row: Record<string, unknown>): RunRecord {
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      agentName: (row.agent_name as string) ?? '',
      prompt: row.prompt as string,
      status: row.status as RunStatus,
      workspace: row.workspace as string | null,
      engine: (row.engine as string) ?? 'codex',
      sandboxMode: row.sandbox_mode as string | null,
      approvalPolicy: row.approval_policy as string | null,
      createdAt: row.created_at as string,
      startedAt: row.started_at as string | null,
      completedAt: row.completed_at as string | null,
      exitCode: row.exit_code as number | null,
      error: row.error as string | null,
    };
  }
}
