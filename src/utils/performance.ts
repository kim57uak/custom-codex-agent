/**
 * performance.ts
 * 성능 측정 유틸리티 (E12 구현)
 *
 * Planning.md E12: "Performance measurement hooks missing (budgets aspirational)"
 * 해결: performance.mark()를 IPC entry/exit에 추가 + cold start timestamp 로깅
 *
 * 측정 대상:
 * - IPC 호출 시간 (<50ms budget)
 * - UI 렌더링 시간 (<16ms budget, 60fps)
 * - Cold start 시간
 * - 로그 플러시 간격
 *
 * 사용법:
 * ```typescript
 * const perf = PerformanceTracker.getInstance();
 * perf.mark('run:agent:start');
 * // ... 작업 ...
 * perf.mark('run:agent:end');
 * const duration = perf.measure('run:agent:start', 'run:agent:end');
 * ```
 */

/** 성능 마커 레코드 */
interface PerfMarker {
  name: string;
  timestamp: number;
  detail?: string | undefined;
}

/** 성능 측정 결과 */
interface PerfMeasureResult {
  name: string;
  durationMs: number;
  budgetOk: boolean;
  budgetMs: number;
}

/** 측정 유형 */
export type PerfMeasureType = 'IPC' | 'UI' | 'COLD_START' | 'LOG_FLUSH';

export class PerformanceTracker {
  private static instance: PerformanceTracker;
  private markers: Map<string, PerfMarker> = new Map();
  private eventBroker?: { push: (channel: string, data: unknown) => void };

  private constructor() {}

  static getInstance(): PerformanceTracker {
    if (!PerformanceTracker.instance) {
      PerformanceTracker.instance = new PerformanceTracker();
    }
    return PerformanceTracker.instance;
  }

  /** EventBroker 연결 (선택적, 로깅용) */
  setEventBroker(broker: { push: (channel: string, data: unknown) => void }): void {
    this.eventBroker = broker;
  }

  /** 마커 등록 */
  mark(name: string, detail?: string): void {
    this.markers.set(name, {
      name,
      timestamp: performance.now(),
      detail,
    });
  }

  /** 두 마커 사이 시간 측정 */
  measure(startMarker: string, endMarker: string, budgetMs: number = 50): PerfMeasureResult | null {
    const start = this.markers.get(startMarker);
    const end = this.markers.get(endMarker);

    if (!start || !end) return null;

    const durationMs = end.timestamp - start.timestamp;
    return {
      name: `${startMarker} → ${endMarker}`,
      durationMs: Math.round(durationMs * 100) / 100,
      budgetOk: durationMs < budgetMs,
      budgetMs,
    };
  }

  /** 특정 유형의 budget 측정 */
  measureType(type: PerfMeasureType): number | null {
    const budgets: Record<PerfMeasureType, { start: string; end: string; budget: number }> = {
      IPC: { start: 'ipc:entry', end: 'ipc:exit', budget: 50 },
      UI: { start: 'ui:render:start', end: 'ui:render:end', budget: 16 },
      COLD_START: { start: 'cold:start', end: 'cold:end', budget: 2000 },
      LOG_FLUSH: { start: 'log:flush:start', end: 'log:flush:end', budget: 50 },
    };

    const config = budgets[type];
    const result = this.measure(config.start, config.end, config.budget);
    return result ? result.durationMs : null;
  }

  /** budget 초과 여부 확인 */
  isWithinBudget(type: PerfMeasureType): boolean {
    const duration = this.measureType(type);
    if (duration === null) return true;

    const budgets: Record<PerfMeasureType, number> = {
      IPC: 50,
      UI: 16,
      COLD_START: 2000,
      LOG_FLUSH: 50,
    };

    return duration < budgets[type];
  }

  /** 모든 마커 클리어 */
  clear(): void {
    this.markers.clear();
  }

  /** 마커 목록 반환 (디버깅용) */
  getMarkers(): PerfMarker[] {
    return Array.from(this.markers.values());
  }

  /** performance.mark() 래퍼 (브라우저 native API 활용) */
  nativeMark(name: string): void {
    if (typeof performance !== 'undefined' && 'mark' in performance) {
      performance.mark(name);
    }
  }

  /** performance.measure() 래퍼 */
  nativeMeasure(name: string, startMark: string, endMark: string): number | null {
    if (typeof performance === 'undefined' || !('measure' in performance)) return null;

    try {
      performance.measure(name, startMark, endMark);
      const entries = performance.getEntriesByName(name);
      const lastEntry = entries[entries.length - 1];
      if (lastEntry) {
        return lastEntry.duration;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /** 모든 performance measure entries 클리어 */
  nativeClear(): void {
    if (typeof performance !== 'undefined' && 'clearMeasures' in performance) {
      performance.clearMeasures();
    }
  }
}

/** IPC entry/exit 데코레이터용 래퍼 */
export function withPerformanceTracking<T extends (...args: unknown[]) => unknown>(
  channelName: string,
  fn: T,
  tracker: PerformanceTracker = PerformanceTracker.getInstance()
): T {
  return ((...args: unknown[]) => {
    const startMark = `ipc:${channelName}:start`;
    const endMark = `ipc:${channelName}:end`;

    tracker.nativeMark(startMark);
    tracker.mark(startMark);

    try {
      const result = fn(...args);
      tracker.mark(endMark);
      tracker.nativeMark(endMark);

      const duration = tracker.nativeMeasure(`ipc:${channelName}`, startMark, endMark);
      if (duration !== null && duration > 50) {
        console.warn(`[Performance] IPC ${channelName} exceeded budget: ${duration.toFixed(2)}ms (budget: 50ms)`);
      }

      return result;
    } catch (err) {
      tracker.mark(`ipc:${channelName}:error`);
      throw err;
    }
  }) as T;
}

/** Cold start tracking용 헬퍼 */
export function startColdMeasure(): void {
  PerformanceTracker.getInstance().mark('cold:start');
  PerformanceTracker.getInstance().nativeMark('cold:start');
}

export function endColdMeasure(): { durationMs: number; withinBudget: boolean } {
  PerformanceTracker.getInstance().mark('cold:end');
  PerformanceTracker.getInstance().nativeMark('cold:end');

  const tracker = PerformanceTracker.getInstance();
  const duration = tracker.nativeMeasure('cold', 'cold:start', 'cold:end');
  const durationMs = duration ?? 0;

  return {
    durationMs: Math.round(durationMs * 100) / 100,
    withinBudget: durationMs < 2000,
  };
}

export default PerformanceTracker;