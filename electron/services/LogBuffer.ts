/**
 * LogBuffer - CLI 로그 버퍼링 서비스
 *
 * 설계 목표:
 * - CLI stdout/stderr를 버퍼링하여 IPC 포화 방지
 * - Adaptive flush: 50ms 간격 OR 100줄 단위 OR Renderer pull signal
 * - 50MB 최대 크기 제한 (초과 시 oldest entries부터 삭제)
 *
 * 사용 패턴:
 * 1. RunOrchestrator가 CLI stdout/stderr를 LogBuffer에 푸시
 * 2. LogBuffer가 flush 타이머 또는 버퍼 가득 참 조건으로 flush
 * 3. flush 시 EventBroker.onFlush 콜백 호출 → Renderer로 전달
 * 4. Renderer에서 'log:entry' 채널 수신 후 'log:ack' 백프레셔 전송
 */

import { EventEmitter } from 'events';

interface LogEntry {
  runId: string;                                   // 실행 ID
  source?: string;                                 // 에이전트명/소스 (기본: runId)
  level: 'debug' | 'info' | 'warn' | 'error';     // 로그 레벨
  message: string;                                 // 파싱된 로그 메시지
  timestamp: string;                               // ISO 8601 타임스탬프
  raw?: string;                                    // 원본 출력 (raw)
}

interface LogBufferOptions {
  maxSize?: number;        // 최대 버퍼 크기 (기본: 50MB)
  flushInterval?: number;  // flush 간격 (기본: 50ms)
  maxLines?: number;       // 최대 버퍼 라인 수 (기본: 100줄)
}

const DEFAULT_MAX_SIZE = 50 * 1024 * 1024;       // 50MB
const DEFAULT_FLUSH_INTERVAL = 10;                 // 10ms
const DEFAULT_MAX_LINES = 100;                     // 100줄

/**
 * LogBuffer 클래스
 * - EventEmitter 상속 (flush/overflow 이벤트 발생)
 * - Ring buffer 구조: 최대 크기 초과 시 oldest entries부터 삭제
 * - Adaptive flush: 세 가지 조건 중 하나 만족 시 flush
 *   1. flushInterval (50ms) 경과
 *   2. 버퍼 라인 수가 maxLines (100)에 도달
 *   3. Renderer에서 pull signal + 'log:ack' 백프레셔 수신
 */
export class LogBuffer {
  private buffer: LogEntry[] = [];                 // 로그 엔트리 버퍼
  private maxSize: number;                          // 최대 버퍼 크기 (bytes)
  private flushInterval: number;                    // flush 간격 (ms)
  private maxLines: number;                         // 최대 버퍼 라인 수
  private flushTimer: NodeJS.Timeout | null = null;  // flush 타이머
  private size = 0;                                 // 현재 버퍼 크기 (bytes)
  private emitter: EventEmitter;                    // 이벤트 발생기
  private paused = false;                           // 일시 정지 플래그

  constructor(options: LogBufferOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    this.emitter = new EventEmitter();

    // flush 타이머 시작
    this.startFlushTimer();
  }

  /**
   * 로그 엔트리 푸시
   * - paused 상태이면 무시
   * - 버퍼 크기가 maxSize 초과 시 overflow 이벤트 발생 후 버퍼 초기화
   * - 버퍼 라인 수가 maxLines 도달 시 즉시 flush
   *
   * @param entry 로그 엔트리 (runId, level, message, timestamp, raw)
   */
  push(entry: LogEntry): void {
    // 일시 정지 중이면 무시 (백프레셔 상황에서 사용)
    if (this.paused) return;

    // 버퍼 크기 계산
    const entrySize = JSON.stringify(entry).length;

    // 최대 크기 초과 시 oldest entries부터 삭제 (ring buffer)
    if (this.size + entrySize > this.maxSize) {
      this.emitter.emit('overflow', {
        dropped: this.buffer.length,
        reason: 'max-size-exceeded',
      });
      this.buffer = [];
      this.size = 0;
    }

    // 버퍼에 추가
    this.buffer.push(entry);
    this.size += entrySize;

    // 버퍼 라인 수가 maxLines 도달 시 즉시 flush
    if (this.buffer.length >= this.maxLines) {
      this.flush();
    }
  }

  /**
   * 버퍼 flush
   * - flush 타이머 정지
   * - 버퍼의 모든 엔트리 반환
   * - 버퍼 초기화
   * - 'flush' 이벤트 발생 (EventBroker에 전달)
   * - flush 타이머 재시작
   *
   * @returns flush된 로그 엔트리 배열
   */
  async flush(): Promise<LogEntry[]> {
    // 타이머 정지
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // 버퍼 복사 및 초기화
    const entries = this.buffer;
    this.buffer = [];
    this.size = 0;

    // flush 이벤트 발생 (EventBroker.onFlush 핸들러 호출)
    if (entries.length > 0) {
      this.emitter.emit('flush', entries);
    }

    // flush 타이머 재시작
    this.startFlushTimer();

    return entries;
  }

  /**
   * 버퍼 flush 일시 정지
   * - Renderer가 'log:ack' 백프레셔를 보낼 때 사용
   * - push() 호출 시 무시됨
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * 버퍼 flush 재개
   * - 'log:ack' 백프레셔 처리 완료 후 호출
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * 현재 버퍼 내용 조회 (복사본)
   * @returns 로그 엔트리 배열의 복사본
   */
  getBuffer(): LogEntry[] {
    return [...this.buffer];
  }

  /**
   * 버퍼 내용 삭제
   */
  clear(): void {
    this.buffer = [];
    this.size = 0;
  }

  /**
   * flush 이벤트 핸들러 등록
   * - EventBroker.setupLogBufferHandlers()에서 호출
   * - flush 시 호출될 콜백 함수 등록
   *
   * @param handler flush 시 호출될 콜백 (entries: LogEntry[]) => void
   */
  onFlush(handler: (entries: LogEntry[]) => void): void {
    this.emitter.on('flush', handler);
  }

  /**
   * overflow 이벤트 핸들러 등록
   * - 버퍼가 최대 크기 초과 시 oldest entries 삭제됨
   * - 삭제事件的 알림용으로 사용
   *
   * @param handler overflow 시 호출될 콜백 ({ dropped, reason }) => void
   */
  onOverflow(handler: (info: { dropped: number; reason: string }) => void): void {
    this.emitter.on('overflow', handler);
  }

  /**
   * flush 타이머 시작 (비공개)
   * - flushInterval마다 flush() 호출
   */
  private startFlushTimer(): void {
    this.flushTimer = setTimeout(() => {
      this.flush();
    }, this.flushInterval);
  }
}