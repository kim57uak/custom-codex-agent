/**
 * LogBuffer — 순환 버퍼 기반 로그 수집기.
 *
 * @what
 * - AI 에이전트 실행 로그를 메모리 내 순환 버퍼에 저장하고 주기적으로 플러시합니다.
 * - 최대 용량(maxSize) 초과 시 버퍼를 초기화하고 overflow 이벤트를 발생시킵니다.
 *
 * @design
 * - 고정 크기 배열을 head/tail 포인터로 순환하는 링 버퍼 구조입니다.
 * - flush() 호출 또는 설정된 주기(flushInterval)마다 'flush' 이벤트를 emit합니다.
 * - pause/resume으로 일시적 로그 수집 중단을 지원합니다.
 *
 * @usage
 *   const buf = new LogBuffer({ maxLines: 1000 });
 *   buf.push({ runId, level: 'info', message: '...', timestamp: new Date().toISOString() });
 *   buf.onFlush((entries) => { console.log(entries); });
 */
import { EventEmitter } from 'events';

/** 로그 버퍼에 저장되는 단일 로그 항목 */
interface LogEntry {
  /** 로그가 속한 실행 ID */
  runId: string;
  /** 로그 출처 (선택) */
  source?: string;
  /** 로그 레벨 (debug/info/warn/error) */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** 로그 메시지 본문 */
  message: string;
  /** 로그 발생 타임스탬프 */
  timestamp: string;
  /** 원본 로그 데이터 (선택) */
  raw?: string;
}

/** LogBuffer 생성자에 전달되는 옵션 */
interface LogBufferOptions {
  /** 최대 버퍼 크기 (바이트, 기본값 50MB) */
  maxSize?: number;
  /** 자동 플러시 주기 (초, 기본값 10) */
  flushInterval?: number;
  /** 최대 로그 라인 수 (기본값 100) */
  maxLines?: number;
}

const DEFAULT_MAX_SIZE = 50 * 1024 * 1024;
const DEFAULT_FLUSH_INTERVAL = 10;
const DEFAULT_MAX_LINES = 100;

export class LogBuffer {
  /** 순환 버퍼 배열 (고정 크기) */
  private buffer: (LogEntry | null)[];
  /** 버퍼 읽기 포인터 (가장 오래된 항목) */
  private head = 0;
  /** 버퍼 쓰기 포인터 (다음 항목이 들어갈 위치) */
  private tail = 0;
  /** 버퍼 내 유효 항목 개수 */
  private count = 0;
  /** 버퍼 최대 용량 (최대 라인 수) */
  private capacity: number;
  /** 버퍼 최대 크기 (바이트) */
  private maxSize: number;
  /** 자동 플러시 간격 (밀리초) */
  private flushInterval: number;
  /** 플러시 타이머 핸들 */
  private flushTimer: NodeJS.Timeout | null = null;
  /** 현재 버퍼의 총 크기 (바이트) */
  private size = 0;
  /** 이벤트 이미터 인스턴스 */
  private emitter: EventEmitter;
  /** 로그 수집 일시 중지 상태 */
  private paused = false;

  /**
   * LogBuffer 인스턴스를 생성합니다.
   * @param options - 버퍼 설정 옵션 (maxSize, flushInterval, maxLines)
   */
  constructor(options: LogBufferOptions = {}) {
    this.capacity = options.maxLines ?? DEFAULT_MAX_LINES;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.buffer = new Array(this.capacity).fill(null);
    this.emitter = new EventEmitter();
    this.startFlushTimer();
  }

  /**
   * 로그 항목을 버퍼에 추가합니다.
   * 버퍼가 가득 차거나 최대 크기를 초과하면 자동으로 플러시하거나 초기화합니다.
   * @param entry - 추가할 로그 항목
   */
  push(entry: LogEntry): void {
    if (this.paused) return;

    const entrySize = JSON.stringify(entry).length;

    if (this.size + entrySize > this.maxSize) {
      const dropped = this.count;
      this.emitter.emit('overflow', { dropped, reason: 'max-size-exceeded' });
      this.buffer.fill(null);
      this.head = 0;
      this.tail = 0;
      this.count = 0;
      this.size = 0;
    }

    this.buffer[this.tail] = entry;
    this.tail = (this.tail + 1) % this.capacity;
    this.size += entrySize;

    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }

    if (this.count >= this.capacity) {
      this.flush();
    }
  }

  /**
   * 버퍼의 모든 항목을 반환하고 버퍼를 비웁니다.
   * flush 이벤트를 emit한 후 타이머를 재시작합니다.
   * @returns 플러시된 로그 항목 배열
   */
  async flush(): Promise<LogEntry[]> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const entries: LogEntry[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const entry = this.buffer[idx];
      if (entry) entries.push(entry);
    }

    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.size = 0;

    if (entries.length > 0) {
      this.emitter.emit('flush', entries);
    }

    this.startFlushTimer();
    return entries;
  }

  /**
   * 로그 수집을 일시 중지합니다. push() 호출이 무시됩니다.
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * 일시 중지된 로그 수집을 재개합니다.
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * 현재 버퍼의 내용을 읽기 전용으로 반환합니다. 버퍼는 유지됩니다.
   * @returns 현재 버퍼의 로그 항목 배열
   */
  getBuffer(): LogEntry[] {
    const result: LogEntry[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const entry = this.buffer[idx];
      if (entry) result.push(entry);
    }
    return result;
  }

  /**
   * 버퍼를 완전히 비웁니다. 모든 포인터와 카운터를 초기화합니다.
   */
  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.size = 0;
  }

  /**
   * 버퍼 플러시 시 호출될 핸들러를 등록합니다.
   * @param handler - 플러시된 로그 항목 배열을 받는 콜백
   */
  onFlush(handler: (entries: LogEntry[]) => void): void {
    this.emitter.on('flush', handler);
  }

  /**
   * 버퍼 오버플로우 시 호출될 핸들러를 등록합니다.
   * @param handler - 드롭된 항목 수와 사유를 받는 콜백
   */
  onOverflow(handler: (info: { dropped: number; reason: string }) => void): void {
    this.emitter.on('overflow', handler);
  }

  /**
   * 설정된 간격마다 자동으로 flush를 호출하는 타이머를 시작합니다.
   */
  private startFlushTimer(): void {
    this.flushTimer = setTimeout(() => {
      this.flush();
    }, this.flushInterval);
  }
}
