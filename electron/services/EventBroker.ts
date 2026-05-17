/**
 * EventBroker - IPC 이벤트 브로커 서비스
 *
 * 설계 목표:
 * - Main Process에서 Renderer로 이벤트 푸시
 * - Worker Thread 메시지 라우팅 (demux)
 * - 파일 변경 이벤트 푸시
 *
 * 사용 패턴:
 * 1. registerWindow(): 메인 창 등록 (브라우저 창 참조 저장)
 * 2. pushEvent(): 실행 이벤트를 모든 등록된 창으로 푸시
 * 3. pushLog(): 로그 엔트리를 모든 등록된 창으로 푸시
 * 4. onWorkerMessage(): Worker Thread 메시지 핸들러 등록 (demux)
 *
 * IPC 채널:
 * - 'run:event': 실행 이벤트 (start/progress/log/done/error)
 * - 'log:entry': 로그 엔트리 (LogBuffer flush 시)
 * - 'file:change': 파일 변경 이벤트 (FileWatcher 연동)
 */

import { BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import type { RunEvent } from '../../types/ipc-contract';

/**
 * EventBroker 클래스
 * - EventEmitter 상속
 * - BrowserWindow 집합 관리 (레지istered windows)
 * - IPC 채널별 이벤트 라우팅
 */
export class EventBroker {
  private emitter = new EventEmitter();              // 이벤트 발생기
  private windows = new Set<BrowserWindow>();       // 등록된 창 집합

  /**
   * BrowserWindow 등록
   * - windows 집합에 창 추가
   * - 창关闭 시 자동으로 집합에서 제거 (on('closed') 콜백)
   *
   * @param window 등록할 BrowserWindow 인스턴스
   */
  registerWindow(window: BrowserWindow): void {
    this.windows.add(window);

    // 창关闭 시 집합에서 제거 (메모리 누수 방지)
    window.on('closed', () => {
      this.windows.delete(window);
    });
  }

  /**
   * 실행 이벤트 푸시
   * - 모든 등록된 창으로 'run:event' 채널 전송
   * - isDestroyed() 체크로无效 창 제외
   *
   * @param event 실행 이벤트 (runId, type, timestamp, data)
   */
  pushEvent(event: RunEvent): void {
    for (const win of this.windows) {
      // isDestroyed(): 창이 이미 destroyed되었는지 체크
      if (!win.isDestroyed()) {
        win.webContents.send('run:event', event);
      }
    }
    // 자체 EventEmitter에도 이벤트 발생 (내부 핸들러용)
    this.emitter.emit('run:event', event);
  }

  /**
   * 로그 엔트리 푸시
   * - LogBuffer.flush() 시 호출
   * - 모든 등록된 창으로 'log:entry' 채널 전송
   *
   * @param runId 실행 ID
   * @param level 로그 레벨 (debug/info/warn/error)
   * @param message 로그 메시지
   * @param raw 원본 출력 (선택적)
   */
  pushLog(runId: string, level: string, message: string, raw?: string, source?: string): void {
    const entry = {
      runId,
      level,
      message,
      source: source ?? runId,
      timestamp: new Date().toISOString(),
      raw,
    };

    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('log:entry', entry);
      }
    }

    this.emitter.emit('log:entry', entry);
  }

  /**
   * 로그 엔트리 배열 푸시
   * - LogBuffer.flush() 시 호출
   * - 모든 등록된 창으로 'log:entries' 채널 전송
   *
   * @param entries 로그 엔트리 배열
   */
  pushLogs(entries: any[]): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('log:entries', entries);
      }
    }

    this.emitter.emit('log:entries', entries);
  }

  /**
   * Worker Thread 메시지 핸들러 등록 (demux)
   * - workerId + messageType 조합으로 핸들러 구분
   * - EventBroker.onWorkerMsg() 규격 (Plan-eng-review E6)
   *
   * @param workerId Worker Thread 식별자
   * @param messageType 메시지 타입
   * @param handler 메시지 수신 시 호출될 콜백
   */
  onWorkerMessage(workerId: string, messageType: string, handler: (data: unknown) => void): void {
    const key = `${workerId}:${messageType}`;
    this.emitter.on(key, handler);
  }

  /**
   * Worker Thread 메시지 발생
   * - 특정 Worker Thread의 특정 메시지 타입으로 브로드캐스트
   *
   * @param workerId Worker Thread 식별자
   * @param messageType 메시지 타입
   * @param data 메시지 데이터
   */
  emitWorkerMessage(workerId: string, messageType: string, data: unknown): void {
    const key = `${workerId}:${messageType}`;
    this.emitter.emit(key, data);
  }

  /**
   * 실행 시작 이벤트 푸시 ('run:started')
   */
  pushRunStarted(runId: string, agentId: string): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('run:started', { runId, agentId });
      }
    }
  }

  /**
   * 실행 종료 이벤트 푸시 ('run:ended')
   */
  pushRunEnded(runId: string, exitCode: number, durationMs: number): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('run:ended', { runId, exitCode, durationMs });
      }
    }
  }

  /**
   * 워크플로 이벤트 푸시 ('workflow:event')
   * - WorkflowEngine에서 실행 중인 워크플로의 단계별 이벤트를 renderer로 전송
   */
  pushWorkflowEvent(event: {
    eventId: number;
    workflowRunId: string;
    stepIndex: number | null;
    eventType: string;
    message: string;
    createdAt: string;
  }): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('workflow:event', event);
      }
    }
  }

  /**
   * 워크플로 실행 상태 변경 푸시 ('workflow:run-status')
   * - WorkflowEngine에서 워크플로 실행 상태가 변경될 때 renderer로 전송
   */
  pushWorkflowRunStatus(workflowRunId: string, status: string, currentStepIndex: number): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('workflow:run-status', { workflowRunId, status, currentStepIndex });
      }
    }
  }

  /**
   * HITL 권한 요청 이벤트 푸시 ('workflow:permission-request')
   * - RunOrchestrator에서 CLI permission 프롬프트 감지 시 renderer로 전송
   */
  pushPermissionRequest(data: {
    id: string;
    runId: string;
    agentName: string;
    message: string;
    permission: string;
    stepIndex: number;
    workflowRunId?: string;
  }): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('workflow:permission-request', data);
      }
    }
  }

  /**
   * 파일 변경 이벤트 푸시
   * - FileWatcher 연동 (InspectorService)
   * - 모든 등록된 창으로 'file:change' 채널 전송
   *
   * @param path 변경된 파일 경로
   * @param event 변경 타입 (add/change/delete)
   * @param content 파일 내용 (선택적, add/change 시)
   */
  pushFileChange(path: string, event: string, content?: string): void {
    const change = { path, event, content };

    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('file:change', change);
      }
    }
  }

  /**
   * 실행 이벤트 수신 핸들러 등록
   * - EventEmitter.on() 래퍼
   *
   * @param handler (event: RunEvent) => void
   */
  onEvent(handler: (event: RunEvent) => void): void {
    this.emitter.on('run:event', handler);
  }

  /**
   * 모든 이벤트 리스너 제거
   * - 테스트 또는 정리 시 사용
   */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}