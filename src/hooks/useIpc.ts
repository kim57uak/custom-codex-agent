/**
 * useIpc - IPC invoke 래퍼 훅
 *
 * 기능:
 * - window.electronAPI.invoke() 호출
 * - 로딩/에러/데이터 상태 관리
 * - TypeScript 제네릭 지원
 *
 * 사용 예:
 * ```typescript
 * const { data, isLoading, error, invoke } = useIpc<AgentConfig[]>('agents:list');
 *
 * // 데이터 fetch
 * useEffect(() => { invoke(); }, []);
 *
 * // 특정 인자로 호출
 * const runAgent = (options: RunOptions) => invoke('run:agent', options);
 * ```
 */

import { useState, useCallback, useEffect } from 'react';

/**
 * useIpc 훅 옵션
 */
interface UseIpcOptions<T> {
  /** 자동 fetch 여부 (기본값: true) */
  autoFetch?: boolean;
  /** 초기 데이터 */
  initialData?: T;
  /** 에러 핸들러 */
  onError?: (error: unknown) => void;
}

/**
 * useIpc 훅 반환 타입
 */
interface UseIpcReturn<T> {
  /** 응답 데이터 */
  data: T | null;
  /** 로딩 상태 */
  isLoading: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** IPC 호출 함수 */
  invoke: (...args: unknown[]) => Promise<void>;
  /** 데이터 재설정 */
  reset: () => void;
}

/**
 * IPC invoke 훅
 * - 제네릭 T: 응답 데이터 타입
 *
 * @param channel IPC 채널 (IPC_CHANNELS.invoke 목록)
 * @param options 옵션 (autoFetch, initialData, onError)
 * @returns { data, isLoading, error, invoke, reset }
 */
export function useIpc<T>(
  channel: string,
  options: UseIpcOptions<T> = {}
): UseIpcReturn<T> {
  const { autoFetch = false, initialData = null, onError } = options;

  const [data, setData] = useState<T | null>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * IPC invoke 함수
   * - window.electronAPI.invoke() 호출
   * - 로딩/에러 상태 자동 관리
   */
  const invoke = useCallback(
    async (...args: unknown[]) => {
      // window.electronAPI가 없으면 early return (development mode 등)
      if (typeof window === 'undefined' || !window.electronAPI) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await window.electronAPI.invoke(channel, ...args);
        setData(result as T);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        onError?.(err);
      } finally {
        setIsLoading(false);
      }
    },
    [channel, onError]
  );

  /**
   * 초기 fetch (autoFetch: true인 경우)
   */
  useEffect(() => {
    if (autoFetch) {
      invoke();
    }
  }, [autoFetch, invoke]);

  /**
   * 데이터 재설정
   */
  const reset = useCallback(() => {
    setData(initialData);
    setError(null);
  }, [initialData]);

  return { data, isLoading, error, invoke, reset };
}

/**
 * useIpcCall - 단일 IPC 호출 훅 (매번 호출마다 새로 실행)
 *
 * @param channel IPC 채널
 * @returns invoke 함수 (호출 시 마다 새로운 Promise 생성)
 */
export function useIpcCall<T>(channel: string) {
  return useCallback(
    async (...args: unknown[]): Promise<T | null> => {
      if (typeof window === 'undefined' || !window.electronAPI) {
        return null;
      }

      try {
        const result = await window.electronAPI.invoke(channel, ...args);
        return result as T;
      } catch (err) {
        console.error(`[IPC Error] ${channel}:`, err);
        return null;
      }
    },
    [channel]
  );
}