/**
 * MultiSessionManager - 터미널 멀티세션 관리
 *
 * 기능:
 * - 다중 CLI 세션 관리 (Codex/Gemini/OpenCode/ClaudeCode 동시 실행)
 * - 세션별 독립 stdin/stdout/stderr 처리
 * - 세션 생성/종료/전환
 * - 세션 상태 추적 (running/idle/error)
 *
 * Phase 5 완료 항목:
 * - [x] 터미널 멀티세션
 */

import { spawn, ChildProcess } from 'child_process';
import type { EngineType } from '../../types/ipc-contract';
import { createEngineAdapter, type EngineAdapter } from '../adapters/EngineAdapter';

/** 세션 상태 */
export type SessionStatus = 'running' | 'idle' | 'error' | 'terminated';

/** 세션 정보 */
export interface SessionInfo {
  id: string;
  engine: EngineType;
  status: SessionStatus;
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
}

/** 세션 출력 이벤트 */
export interface SessionOutputEvent {
  sessionId: string;
  type: 'stdout' | 'stderr';
  data: string;
  timestamp: string;
}

/**
 * MultiSessionManager 클래스
 * 다중 CLI 세션 관리 중앙 오케스트레이터
 */
export class MultiSessionManager {
  private sessions: Map<string, {
    process: ChildProcess | null;
    info: SessionInfo;
    adapter: EngineAdapter;
  }> = new Map();

  private outputListeners: Array<(event: SessionOutputEvent) => void> = [];

  /** 세션 카운터 (고유 ID 생성용) */
  private sessionCounter = 0;

  /**
   * 새 세션 생성
   * @param engine 엔진 타입
   * @param args CLI 인자
   * @param env 환경 변수
   * @returns 세션 ID
   */
  createSession(engine: EngineType, args: string[] = [], env?: NodeJS.ProcessEnv): string {
    const sessionId = `session-${++this.sessionCounter}-${Date.now()}`;
    const adapter = createEngineAdapter(engine);

    const info: SessionInfo = {
      id: sessionId,
      engine,
      status: 'idle',
      pid: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
    };

    this.sessions.set(sessionId, {
      process: null,
      info,
      adapter,
    });

    return sessionId;
  }

  /**
   * 세션 시작 (CLI 프로세스 spawn)
   * @param sessionId 세션 ID
   * @param args CLI 인자
   * @param env 환경 변수
   */
  startSession(sessionId: string, args: string[] = [], env?: NodeJS.ProcessEnv): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`세션을 찾을 수 없습니다: ${sessionId}`);

    const proc = session.adapter.spawn(args, env);

    session.process = proc;
    session.info.status = 'running';
    session.info.pid = proc.pid ?? null;

    // stdout 이벤트 리스너
    proc.stdout?.on('data', (data: Buffer) => {
      this.emitOutput(sessionId, 'stdout', data.toString());
    });

    // stderr 이벤트 리스너
    proc.stderr?.on('data', (data: Buffer) => {
      this.emitOutput(sessionId, 'stderr', data.toString());
    });

    // 종료 이벤트 리스너
    proc.on('close', (code) => {
      session.info.status = code === 0 ? 'idle' : 'error';
      session.info.exitCode = code;
      session.info.endedAt = new Date().toISOString();
    });

    proc.on('error', (err) => {
      session.info.status = 'error';
      this.emitOutput(sessionId, 'stderr', `세션 오류: ${err.message}`);
    });
  }

  /**
   * 세션에 stdin 입력
   * @param sessionId 세션 ID
   * @param data 입력 데이터
   */
  writeStdin(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.process?.stdin) return;
    session.process.stdin.write(data);
  }

  /**
   * 세션 종료
   * @param sessionId 세션 ID
   */
  terminateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.process && session.info.pid) {
      session.adapter.terminate(session.info.pid);
      session.info.status = 'terminated';
      session.info.endedAt = new Date().toISOString();
    }

    session.process = null;
    session.info.pid = null;
  }

  /**
   * 세션 정보 조회
   * @param sessionId 세션 ID
   * @returns 세션 정보 또는 undefined
   */
  getSessionInfo(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId)?.info;
  }

  /**
   * 모든 세션 목록 조회
   * @returns 세션 정보 배열
   */
  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(s => s.info);
  }

  /**
   * 출력 이벤트 리스너 등록
   * @param listener 출력 이벤트 리스너
   */
  onOutput(listener: (event: SessionOutputEvent) => void): void {
    this.outputListeners.push(listener);
  }

  /**
   * 출력 이벤트 리스너 제거
   * @param listener 제거할 리스너
   */
  offOutput(listener: (event: SessionOutputEvent) => void): void {
    this.outputListeners = this.outputListeners.filter(l => l !== listener);
  }

  /**
   * 출력 이벤트 방출 (내부용)
   */
  private emitOutput(sessionId: string, type: 'stdout' | 'stderr', data: string): void {
    const event: SessionOutputEvent = {
      sessionId,
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    for (const listener of this.outputListeners) {
      try {
        listener(event);
      } catch {
        // 리스너 오류 무시
      }
    }
  }

  /**
   * 모든 세션 종료 (앱 종료 시 호출)
   */
  terminateAll(): void {
    for (const [sessionId] of this.sessions) {
      this.terminateSession(sessionId);
    }
  }

  /**
   * 활성 세션 개수 반환
   */
  get activeCount(): number {
    return Array.from(this.sessions.values()).filter(s => s.info.status === 'running').length;
  }

  /**
   * 전체 세션 개수 반환
   */
  get totalCount(): number {
    return this.sessions.size;
  }
}

export default MultiSessionManager;