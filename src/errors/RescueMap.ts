/**
 * RescueMap.ts
 * 오류 코드 → 복구 전략 매핑을 담당하는 레지스트리
 *
 * CEO 리포트에서 정의한 4-tier 오류 분류 체계의 3단계 복구 전략:
 * - RETRY: 자동 재시도 (지수 백오프 포함)
 * - FALLBACK: 대체 수단으로 전환 (별도 에이전트, 캐시, 모드 전환 등)
 * - ESCALATE: 사용자에게 표시하거나 상위 수준 처리 위임
 *
 * ErrorRegistry.ts와 쌍을 이루며, 오류 조회 + 복구 실행을 분리한다:
 * - ErrorRegistry: 오류 정보 쿼리 (code, severity, category, visibleToUser)
 * - RescueMap: 복구 전략 실행 (RETRY / FALLBACK / ESCALATE)
 *
 * 설계 원칙 (Eng Review E8):
 * - 각 오류 코드에 대해 단일 복구 전략만 매핑 (복잡성 방지)
 * - 복구 불가능한 오류(FATAL unrecoverable)는 ESCALATE만 가능
 * - 전략 실행 결과는 EventBroker를 통해 IPC로 Renderer에 전달
 */

import { ErrorSeverity } from './ErrorRegistry';

/**
 * 복구 전략 유형
 * - RETRY: 자동 재시도 (maxAttempts 횟수만큼 지수 백오프)
 * - FALLBACK: 대체 수단으로 전환
 * - ESCALATE: 사용자에게 표시하거나 상위 처리 위임
 */
export type RescueStrategy = 'RETRY' | 'FALLBACK' | 'ESCALATE';

/**
 * 복구 작업 단위
 * rescue()가 반환하는 구조로, 실행 결과와 다음 액션을 포함
 */
export interface RescueResult {
  // 성공 여부
  success: boolean;
  // 실행된 전략
  strategy: RescueStrategy;
  // 결과 메시지 (성공/실패 이유)
  message: string;
  // 다음 액션 (success === false일 때 의미 있음)
  nextAction: RescueStrategy | 'ABORT';
  // 재시도 횟수 (RETRY 전략 사용 시)
  attempts?: number;
}

/**
 * 복구 전략 설정
 * 각 오류 코드에 대한 재시도 정책, 폴백 대상, escalation 대상을 정의
 */
export interface RescueConfig {
  // 복구 전략
  strategy: RescueStrategy;
  // 최대 재시도 횟수 (RETRY 전략만 해당)
  maxAttempts?: number;
  // 초기 재시도 지연 ms (지수 백오프 기준)
  baseDelayMs?: number;
  // 최대 재시도 지연 ms (지수 백오프 상한)
  maxDelayMs?: number;
  // 폴백 대상 (FALLBACK 전략만 해당)
  fallbackTarget?: string;
  // escalation 대상 (ESCALATE 전략만 해당)
  escalateTo?: string;
}

/**
 * RescueMap 클래스
 * 오류 코드 → RescueConfig 매핑을 내부에 유지하고 복구 실행 인터페이스 제공
 * Singleton 패턴으로 앱 전체에서 단일 인스턴스 사용
 */
export class RescueMap {
  private static instance: RescueMap;
  private map: Map<string, RescueConfig> = new Map();

  private constructor() {
    this.init();
  }

  /**
   * Singleton 접근자
   */
  static getInstance(): RescueMap {
    if (!RescueMap.instance) {
      RescueMap.instance = new RescueMap();
    }
    return RescueMap.instance;
  }

  /**
   * 내부 매핑 초기화
   * 사전 정의된 오류 코드 → 복구 전략 매핑을 등록한다
   */
  private init(): void {
    // === IPC 복구 전략 ===

    // IPC_HANDLER_NOT_FOUND: 핸들러 재등록 시도 → 실패 시 ESCALATE
    this.register('IPC_HANDLER_NOT_FOUND', {
      strategy: 'ESCALATE',
      escalateTo: 'user-notification',
    });

    // IPC_VERSION_MISMATCH: 앱 재시작 요구 → ESCALATE (복구 불가)
    this.register('IPC_VERSION_MISMATCH', {
      strategy: 'ESCALATE',
      escalateTo: 'app-restart-required',
    });

    // IPC_VALIDATION_FAILED: 입력 검증 재시도 → RETRY
    this.register('IPC_VALIDATION_FAILED', {
      strategy: 'RETRY',
      maxAttempts: 2,
      baseDelayMs: 100,
      maxDelayMs: 1000,
    });

    // IPC_INVOKE_TIMEOUT: 재시도 → RETRY
    this.register('IPC_INVOKE_TIMEOUT', {
      strategy: 'RETRY',
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    });

    // IPC_CHANNEL_NOT_REGISTERED: ESCALATE
    this.register('IPC_CHANNEL_NOT_REGISTERED', {
      strategy: 'ESCALATE',
      escalateTo: 'user-notification',
    });

    // === CLI 복구 전략 ===

    // CLI_NOT_FOUND: 경로 재확인 → FALLBACK (기본 경로 시도)
    this.register('CLI_NOT_FOUND', {
      strategy: 'FALLBACK',
      fallbackTarget: 'default-cli-path',
    });

    // CLI_PERMISSION_DENIED: 권한 상승 시도 → 실패 시 ESCALATE
    this.register('CLI_PERMISSION_DENIED', {
      strategy: 'ESCALATE',
      escalateTo: 'permission-dialog',
    });

    // CLI_SPAWN_FAILED: 재시도 → RETRY
    this.register('CLI_SPAWN_FAILED', {
      strategy: 'RETRY',
      maxAttempts: 2,
      baseDelayMs: 200,
      maxDelayMs: 2000,
    });

    // CLI_STDIN_WRITE_FAILED: 재시도 → RETRY
    this.register('CLI_STDIN_WRITE_FAILED', {
      strategy: 'RETRY',
      maxAttempts: 2,
      baseDelayMs: 100,
      maxDelayMs: 500,
    });

    // CLI_PROCESS_EXIT_NON_ZERO: 종료 코드 로깅 → WARNING (복구 불필요)
    this.register('CLI_PROCESS_EXIT_NON_ZERO', {
      strategy: 'ESCALATE',
      escalateTo: 'log-only',
    });

    // CLI_ENV_BLOCKLISTED: 즉각 FATAL → ESCALATE
    this.register('CLI_ENV_BLOCKLISTED', {
      strategy: 'ESCALATE',
      escalateTo: 'security-dialog',
    });

    // CLI_PATH_NOT_ABSOLUTE: 설정 재검증 → ESCALATE
    this.register('CLI_PATH_NOT_ABSOLUTE', {
      strategy: 'ESCALATE',
      escalateTo: 'config-validation',
    });

    // === DB 복구 전략 ===

    // DB_INIT_FAILED: 앱 종료 필요 → ESCALATE
    this.register('DB_INIT_FAILED', {
      strategy: 'ESCALATE',
      escalateTo: 'app-terminate',
    });

    // DB_QUERY_FAILED: 재시도 → RETRY
    this.register('DB_QUERY_FAILED', {
      strategy: 'RETRY',
      maxAttempts: 3,
      baseDelayMs: 50,
      maxDelayMs: 500,
    });

    // DB_MIGRATION_FAILED: 백업 복원 시도 → FALLBACK
    this.register('DB_MIGRATION_FAILED', {
      strategy: 'FALLBACK',
      fallbackTarget: 'db-backup-restore',
    });

    // DB_WAL_INIT_FAILED: 일반 모드 폴백 → FALLBACK
    this.register('DB_WAL_INIT_FAILED', {
      strategy: 'FALLBACK',
      fallbackTarget: 'db-no-wal',
    });

    // === Worker Thread 복구 전략 ===

    // WORKER_CRASHED: Worker 재시작 → RETRY
    this.register('WORKER_CRASHED', {
      strategy: 'RETRY',
      maxAttempts: 2,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
    });

    // WORKER_HEARTBEAT_TIMEOUT: Worker 상태 확인 → RETRY
    this.register('WORKER_HEARTBEAT_TIMEOUT', {
      strategy: 'RETRY',
      maxAttempts: 2,
      baseDelayMs: 2000,
      maxDelayMs: 10000,
    });

    // WORKER_MESSAGE_DEMUX_FAILED: 메시지 버퍼 플러시 → FALLBACK
    this.register('WORKER_MESSAGE_DEMUX_FAILED', {
      strategy: 'FALLBACK',
      fallbackTarget: 'flush-message-buffer',
    });

    // WORKER_BACKPRESSURE: 백프레셔 해제 대기 → RETRY (대기 후 재시도)
    this.register('WORKER_BACKPRESSURE', {
      strategy: 'RETRY',
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 3000,
    });

    // === 설정 복구 전략 ===

    // CONFIG_AGENT_NOT_FOUND: 기본 에이전트 폴백 → FALLBACK
    this.register('CONFIG_AGENT_NOT_FOUND', {
      strategy: 'FALLBACK',
      fallbackTarget: 'default-agent',
    });

    // CONFIG_INVALID_JSON: 설정 파일 재생성 → FALLBACK
    this.register('CONFIG_INVALID_JSON', {
      strategy: 'FALLBACK',
      fallbackTarget: 'reset-config',
    });

    // CONFIG_CLI_PATH_NOT_FOUND: CLI 경로 재검증 → ESCALATE
    this.register('CONFIG_CLI_PATH_NOT_FOUND', {
      strategy: 'ESCALATE',
      escalateTo: 'config-revalidation',
    });

    // === 런타임 복구 전략 ===

    // RUNTIME_UNHANDLED_REJECTION: 로깅 → ESCALATE
    this.register('RUNTIME_UNHANDLED_REJECTION', {
      strategy: 'ESCALATE',
      escalateTo: 'log-and-notify',
    });

    // RUNTIME_UNCAUGHT_EXCEPTION: 앱 종료 필요 → ESCALATE
    this.register('RUNTIME_UNCAUGHT_EXCEPTION', {
      strategy: 'ESCALATE',
      escalateTo: 'app-terminate',
    });

    // === UI 복구 전략 ===

    // UI_REACT_RENDER_ERROR: 컴포넌트 재마운트 → RETRY
    this.register('UI_REACT_RENDER_ERROR', {
      strategy: 'RETRY',
      maxAttempts: 1,
      baseDelayMs: 100,
      maxDelayMs: 500,
    });

    // UI_STATE_SYNC_FAILED: 상태 재동기 → RETRY
    this.register('UI_STATE_SYNC_FAILED', {
      strategy: 'RETRY',
      maxAttempts: 2,
      baseDelayMs: 100,
      maxDelayMs: 500,
    });
  }

  /**
   * 복구 전략 등록 (내부용, 초기화에서만 호출)
   */
  private register(code: string, config: RescueConfig): void {
    this.map.set(code, config);
  }

  /**
   * 오류 코드에 대한 복구 설정 조회
   * @param code 오류 코드
   * @returns RescueConfig 또는 undefined
   */
  getConfig(code: string): RescueConfig | undefined {
    return this.map.get(code);
  }

  /**
   * 복구 전략 실행
   * 지정된 오류 코드에 대한 복구 작업을 수행하고 결과를 반환
   *
   * @param code 오류 코드
   * @param context 추가 컨텍스트 (재시도 카운트, 이전 오류 등)
   * @returns RescueResult 실행 결과
   */
  rescue(code: string, context?: { attemptCount?: number; previousError?: string }): RescueResult {
    const config = this.map.get(code);

    if (!config) {
      return {
        success: false,
        strategy: 'ESCALATE',
        message: `복구 전략을 찾을 수 없습니다: ${code}`,
        nextAction: 'ABORT',
      };
    }

    switch (config.strategy) {
      case 'RETRY': {
        const attemptCount = context?.attemptCount ?? 0;
        const maxAttempts = config.maxAttempts ?? 1;
        const baseDelayMs = config.baseDelayMs ?? 1000;
        const maxDelayMs = config.maxDelayMs ?? 10000;

        if (attemptCount >= maxAttempts) {
          return {
            success: false,
            strategy: 'RETRY',
            message: `최대 재시도 횟수(${maxAttempts}) 초과`,
            nextAction: 'ESCALATE',
            attempts: attemptCount,
          };
        }

        // 지수 백오프 계산 (baseDelay * 2^attempt, maxDelayMs 이내)
        const delayMs = Math.min(baseDelayMs * Math.pow(2, attemptCount), maxDelayMs);

        return {
          success: true,
          strategy: 'RETRY',
          message: `${attemptCount + 1}번째 재시도 예정 (지연 ${delayMs}ms)`,
          nextAction: 'RETRY',
          attempts: attemptCount + 1,
        };
      }

      case 'FALLBACK': {
        return {
          success: true,
          strategy: 'FALLBACK',
          message: `폴백 실행: ${config.fallbackTarget ?? '알 수 없는 폴백 대상'}`,
          nextAction: 'ESCALATE',
        };
      }

      case 'ESCALATE': {
        return {
          success: true,
          strategy: 'ESCALATE',
          message: `escalation 실행: ${config.escalateTo ?? '알 수 없는 escalation 대상'}`,
          nextAction: 'ABORT',
        };
      }
    }
  }

  /**
   * 특정 심각도 이상의 오류에 대한 복구 전략 조회
   * @param minSeverity 최소 심각도
   * @returns 해당 심각도 이상의 모든 RescueConfig
   */
  getConfigsAboveSeverity(minSeverity: ErrorSeverity): Array<{ code: string; config: RescueConfig }> {
    const severityOrder: ErrorSeverity[] = ['INFO', 'WARNING', 'ERROR', 'FATAL'];
    const minIndex = severityOrder.indexOf(minSeverity);
    const results: Array<{ code: string; config: RescueConfig }> = [];

    for (const [code, config] of this.map.entries()) {
      const entrySeverity = this.getEntrySeverity(code);
      if (entrySeverity && severityOrder.indexOf(entrySeverity) >= minIndex) {
        results.push({ code, config });
      }
    }

    return results;
  }

  /**
   * 내부 헬퍼: 오류 코드의 심각도 조회 (복구 전략 매핑에서 추정)
   * 실제 구현에서는 ErrorRegistry와 연동해야 하지만 순환 참조 방지를 위해 분리
   */
  private getEntrySeverity(code: string): ErrorSeverity | undefined {
    // FATAL 관련 코드 매핑
    const fatalCodes = ['CLI_NOT_FOUND', 'CLI_PERMISSION_DENIED', 'CLI_ENV_BLOCKLISTED', 'DB_INIT_FAILED', 'DB_MIGRATION_FAILED', 'RUNTIME_UNCAUGHT_EXCEPTION'];
    if (fatalCodes.includes(code)) return 'FATAL';

    // ERROR 관련 코드 매핑
    const errorCodes = ['IPC_HANDLER_NOT_FOUND', 'IPC_VERSION_MISMATCH', 'IPC_CHANNEL_NOT_REGISTERED', 'CLI_SPAWN_FAILED', 'DB_QUERY_FAILED', 'WORKER_CRASHED', 'CONFIG_AGENT_NOT_FOUND', 'CONFIG_INVALID_JSON', 'UI_REACT_RENDER_ERROR'];
    if (errorCodes.includes(code)) return 'ERROR';

    // WARNING 관련 코드 매핑
    const warningCodes = ['IPC_VALIDATION_FAILED', 'IPC_INVOKE_TIMEOUT', 'CLI_STDIN_WRITE_FAILED', 'CLI_PROCESS_EXIT_NON_ZERO', 'CLI_PATH_NOT_ABSOLUTE', 'DB_WAL_INIT_FAILED', 'WORKER_HEARTBEAT_TIMEOUT', 'WORKER_MESSAGE_DEMUX_FAILED', 'WORKER_BACKPRESSURE', 'UI_STATE_SYNC_FAILED'];
    if (warningCodes.includes(code)) return 'WARNING';

    // INFO 관련 코드 매핑 (현재는 없음)
    return undefined;
  }

  /**
   * 등록된 복구 전략 개수 반환 (디버깅/테스트용)
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * 오류 코드가 복구 전략을 가지고 있는지 확인
   * @param code 오류 코드
   */
  has(code: string): boolean {
    return this.map.has(code);
  }

  /**
   * 동적으로 새 복구 전략 등록 (런타임에서 동적으로 추가할 경우)
   * @param code 오류 코드
   * @param config 복구 설정
   */
  registerDynamic(code: string, config: RescueConfig): void {
    this.map.set(code, config);
  }
}

export default RescueMap;