/**
 * LogBuffer 통합 테스트
 *
 * 테스트 대상: electron/services/LogBuffer.ts
 * 테스트 방식: 통합 테스트 (실제 LogBuffer 인스턴스 생성 및 조작)
 * 주요 검증 시나리오:
 * - push 및 수동 flush 동작 (콜백 수신 확인)
 * - maxLines 초과 시 자동 flush (auto-flush)
 * - maxSize 초과 시 overflow 이벤트 트리거
 * - clear() 버퍼 초기화
 * - pause()/resume() 동작 (일시 중지 중 로그 무시)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('LogBuffer Integration', () => {
  let LogBuffer: typeof import('../LogBuffer').LogBuffer;
  let logBuffer: import('../LogBuffer').LogBuffer;

  beforeAll(async () => {
    const mod = await import('../LogBuffer');
    LogBuffer = mod.LogBuffer;
  });

  afterAll(() => {
    logBuffer?.clear();
  });

  it('should push and manually flush log entries', async () => {
    logBuffer = new LogBuffer({ maxLines: 100, flushInterval: 50000 });
    const entries: Array<{ runId: string; level: string; message: string }> = [];
    logBuffer.onFlush((batch) => entries.push(...batch));

    logBuffer.push({ runId: 'run-1', level: 'info', message: 'test message', timestamp: new Date().toISOString() });

    const flushed = await logBuffer.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.message).toBe('test message');
  });

  it('should auto-flush when maxLines reached', async () => {
    logBuffer = new LogBuffer({ maxLines: 3, flushInterval: 50000 });
    const entries: Array<{ runId: string; level: string; message: string }> = [];
    logBuffer.onFlush((batch) => entries.push(...batch));

    logBuffer.push({ runId: 'run-1', level: 'info', message: 'msg 1', timestamp: new Date().toISOString() });
    logBuffer.push({ runId: 'run-1', level: 'info', message: 'msg 2', timestamp: new Date().toISOString() });
    logBuffer.push({ runId: 'run-1', level: 'info', message: 'msg 3', timestamp: new Date().toISOString() });

    await new Promise(r => setTimeout(r, 50));
    expect(entries).toHaveLength(3);
  });

  it('should trigger overflow event when max size exceeded', async () => {
    logBuffer = new LogBuffer({ maxSize: 80, maxLines: 1000, flushInterval: 50000 });
    let overflowed = false;
    logBuffer.onOverflow(() => { overflowed = true; });

    const longMsg = 'x'.repeat(40);
    logBuffer.push({ runId: 'run-1', level: 'info', message: longMsg, timestamp: new Date().toISOString() });
    logBuffer.push({ runId: 'run-1', level: 'info', message: longMsg, timestamp: new Date().toISOString() });
    logBuffer.push({ runId: 'run-1', level: 'info', message: longMsg, timestamp: new Date().toISOString() });

    expect(overflowed).toBe(true);
  });

  it('should clear buffer', () => {
    logBuffer = new LogBuffer({ maxLines: 100, flushInterval: 50000 });
    logBuffer.push({ runId: 'run-1', level: 'info', message: 'test', timestamp: new Date().toISOString() });
    logBuffer.clear();
    expect(logBuffer.getBuffer()).toHaveLength(0);
  });

  it('should pause and resume', () => {
    logBuffer = new LogBuffer({ maxLines: 5, flushInterval: 50000 });
    logBuffer.pause();
    logBuffer.push({ runId: 'run-1', level: 'info', message: 'should be ignored', timestamp: new Date().toISOString() });
    expect(logBuffer.getBuffer()).toHaveLength(0);

    logBuffer.resume();
    logBuffer.push({ runId: 'run-1', level: 'info', message: 'after resume', timestamp: new Date().toISOString() });
    expect(logBuffer.getBuffer()).toHaveLength(1);
  });
});
