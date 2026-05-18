/**
 * RunStore — AI 에이전트 실행(Run) 레코드 SQLite 저장소.
 *
 * @what
 * - Run 생성, 상태 변경(queued → running → completed/failed/cancelled), 이벤트 로그를
 *   SQLite(runs.db)에 저장하고 조회합니다.
 * - 동시 실행 상황에서도 안전하게 상태를 변경할 수 있습니다.
 *
 * @design
 * - better-sqlite3의 동기 API를 사용하며 WAL 모드로 동시성을 확보합니다.
 * - run_events는 배치 INSERT로 지연写入(write)하여 부하를 줄입니다.
 * - 스키마 마이그레이션을 자동으로 수행하여 필드 추가에 대응합니다.
 *
 * @usage
 *   const store = new RunStore();
 *   const record = store.createRun({ agentId, prompt, ... });
 *   store.markRunning(record.id);
 *   store.finishRun(record.id, 'completed', 0, null);
 */
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import type { RunOptions, RunStatus, EngineType } from '../../types/ipc-contract';

/** AI 에이전트 실행(Run) 레코드. 하나의 실행 전체를 나타냅니다. */
export interface RunRecord {
  /** 실행 고유 ID */
  id: string;
  /** 요청한 에이전트 ID */
  agentId: string;
  /** 요청한 에이전트 이름 */
  agentName: string;
  /** 실행 프롬프트 */
  prompt: string;
  /** 실행 상태 (queued/running/completed/failed/cancelled) */
  status: RunStatus;
  /** 작업 공간 경로 (null 가능) */
  workspace: string | null;
  /** 사용 엔진 */
  engine: string;
  /** 샌드박스 모드 (null 가능) */
  sandboxMode: string | null;
  /** 승인 정책 (null 가능) */
  approvalPolicy: string | null;
  /** 생성 시간 (ISO-8601) */
  createdAt: string;
  /** 시작 시간 (ISO-8601) */
  startedAt: string | null;
  /** 완료 시간 (ISO-8601) */
  completedAt: string | null;
  /** 종료 코드 (null 가능) */
  exitCode: number | null;
  /** 오류 메시지 (null 가능) */
  error: string | null;
}

/** 실행 중 발생한 이벤트 레코드. */
export interface RunEventRecord {
  /** 이벤트 자동 증가 ID */
  eventId: number;
  /** 소속 실행 ID */
  runId: string;
  /** 이벤트 타입 */
  eventType: string;
  /** 이벤트 메시지 */
  message: string;
  /** 이벤트 생성 시간 (ISO-8601) */
  createdAt: string;
}

export class RunStore {
  /** SQLite 데이터베이스 인스턴스 */
  private db: Database.Database;
  /** 지연 쓰기를 위한 보류 이벤트 버퍼 */
  private pendingEvents: Array<{ runId: string; type: string; message: string; createdAt: string }> = [];
  /** 플러시 타이머 핸들 */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * RunStore 인스턴스를 생성합니다.
   * runs.db 파일을 열고 WAL 모드를 활성화한 후 스키마를 초기화합니다.
   */
  constructor() {
    const dbPath = path.join(os.homedir(), '.config', 'agent-orchestrator', 'runs.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  /**
   * runs와 run_events 테이블을 생성하고 인덱스를 설정한 후 스키마 마이그레이션을 실행합니다.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        workspace TEXT,
        engine TEXT NOT NULL DEFAULT 'gemini',
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

  /**
   * runs와 run_events 테이블에 누락된 컬럼을 추가합니다.
   */
  private _migrateSchema(): void {
    this._migrateTable('runs', [
      { name: 'exit_code', def: 'INTEGER' },
      { name: 'agent_name', def: "TEXT NOT NULL DEFAULT ''" },
      { name: 'engine', def: "TEXT NOT NULL DEFAULT 'gemini'" },
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

  /**
   * 특정 테이블에 누락된 컬럼을 추가하는 마이그레이션을 수행합니다.
   * @param table - 대상 테이블 이름
   * @param columns - 추가할 컬럼 정의 배열
   */
  private _migrateTable(table: string, columns: Array<{ name: string; def: string }>): void {
    const existing = this.db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
    const existingNames = new Set(existing.map(c => c.name));
    for (const col of columns) {
      if (!existingNames.has(col.name)) {
        try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.def}`); } catch { /* ok */ }
      }
    }
  }

  /**
   * 새 실행 레코드를 생성하고 반환합니다. 상태는 'queued'로 시작합니다.
   * @param options - 실행 옵션 (agentId, prompt, workspace, engine 등)
   * @returns 생성된 실행 레코드
   */
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
      options.engine ?? 'gemini',
      options.sandboxMode ?? null,
      options.approvalPolicy ?? null,
      now,
    );
    return this.getRun(id)!;
  }

  /**
   * ID로 실행 레코드를 조회합니다.
   * @param id - 실행 ID
   * @returns 실행 레코드, 없으면 null
   */
  getRun(id: string): RunRecord | null {
    const stmt = this.db.prepare('SELECT * FROM runs WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this._rowToRecord(row);
  }

  /**
   * 실행 상태를 'running'으로 변경하고 시작 시간을 기록합니다.
   * queued 상태인 경우에만 변경됩니다.
   * @param id - 실행 ID
   * @returns 갱신된 실행 레코드, 변경 실패 시 (상태가 queued가 아님) null
   */
  markRunning(id: string): RunRecord | null {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE runs SET status = 'running', started_at = ?, error = NULL WHERE id = ? AND status = 'queued'
    `).run(now, id);
    return this.getRun(id);
  }

  /**
   * 실행을 완료 상태로 변경하고 종료 코드와 오류 메시지를 기록합니다.
   * @param id - 실행 ID
   * @param status - 완료 상태 (completed/failed/cancelled)
   * @param exitCode - 종료 코드 (null 가능)
   * @param errorMessage - 오류 메시지 (null 가능)
   * @returns 갱신된 실행 레코드
   */
  finishRun(id: string, status: RunStatus, exitCode: number | null, errorMessage: string | null): RunRecord | null {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE runs SET status = ?, completed_at = ?, exit_code = ?, error = ? WHERE id = ?
    `).run(status, now, exitCode, errorMessage, id);
    return this.getRun(id);
  }

  /**
   * 실행 상태를 갱신하고 완료 상태인 경우 완료 시간을 자동으로 설정합니다.
   * @param id - 실행 ID
   * @param status - 새 상태
   * @param error - 오류 메시지 (선택)
   */
  updateRunStatus(id: string, status: RunStatus, error?: string): void {
    const completedAt = (status === 'completed' || status === 'failed' || status === 'cancelled')
      ? new Date().toISOString() : null;
    this.db.prepare('UPDATE runs SET status = ?, completed_at = ?, error = ? WHERE id = ?')
      .run(status, completedAt, error ?? null, id);
  }

  /**
   * 실행 목록을 최근 생성순으로 조회합니다. 엔진별 필터링을 지원합니다.
   * @param limit - 최대 조회 개수 (기본값 100)
   * @param engine - 엔진 이름 (선택, 필터)
   * @returns 실행 레코드 배열
   */
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

  /**
   * 실행 이벤트를 보류 버퍼에 추가합니다. 100개 이상 쌓이면 자동 플러시합니다.
   * @param runId - 실행 ID
   * @param type - 이벤트 타입
   * @param data - 이벤트 데이터 (JSON 직렬화됨)
   */
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

  /**
   * 보류 중인 이벤트를 배치 INSERT로 DB에 기록합니다.
   */
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

  /**
   * 모든 보류 이벤트를 플러시한 후 새 이벤트를 즉시 DB에 추가합니다.
   * @param runId - 실행 ID
   * @param eventType - 이벤트 타입
   * @param message - 이벤트 메시지
   * @returns 생성된 이벤트 레코드
   */
  appendEvent(runId: string, eventType: string, message: string): RunEventRecord {
    this.flushEvents();
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO run_events (run_id, event_type, message, created_at) VALUES (?, ?, ?, ?)
    `).run(runId, eventType, message, now);
    return { eventId: Number(result.lastInsertRowid), runId, eventType, message, createdAt: now };
  }

  /**
   * 실행의 이벤트 목록을 시간순으로 조회합니다. 조회 전 보류 이벤트를 먼저 플러시합니다.
   * @param runId - 실행 ID
   * @param limit - 최대 조회 개수 (선택)
   * @returns 이벤트 레코드 배열
   */
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

  /**
   * 데이터베이스 연결을 종료합니다.
   */
  close(): void {
    this.db.close();
  }

  /**
   * SQLite 행 데이터를 RunRecord 객체로 변환합니다.
   * @param row - runs 테이블의 행
   * @returns 변환된 RunRecord 객체
   */
  private _rowToRecord(row: Record<string, unknown>): RunRecord {
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      agentName: (row.agent_name as string) ?? '',
      prompt: row.prompt as string,
      status: row.status as RunStatus,
      workspace: row.workspace as string | null,
      engine: (row.engine as string) ?? 'gemini',
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
