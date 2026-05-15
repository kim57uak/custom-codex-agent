/**
 * ErrorRegistry.ts
 * 모든 알려진 오류 유형을 등록하고(code registry) 오류 분류/쿼리를 담당하는 중앙 레지스트리
 *
 * CEO 리포트에서 정의한 4-tier 오류 분류 체계:
 * - FATAL: 복구 불가, 즉각 앱 종료 필요
 * - ERROR: 복구 가능, 사용자에게 표시 + 로깅
 * - WARNING: 비정상 상태, 자동 복구 시도
 * - INFO: 정상 로그, 디버깅용
 *
 * 설계 원칙 (Eng Review E8):
 * - 오류 메시지 → 오류 코드 매핑 (uiErrorCode과 쌍을 이루는 code registry)
 * - 각 오류 코드에 severity, category, visibleToUser 플래그 포함
 * - RescueMap.ts가 실제 복구 전략을 결정하고 ErrorRegistry는 쿼리 인터페이스만 제공
 */

// 오류 심각도 티어
export type ErrorSeverity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO';

// 오류 카테고리 (도메인별 분류)
export type ErrorCategory =
  | 'IPC'           // IPC 통신 오류
  | 'CLI'           // CLI 실행/스폰 오류
  | 'DB'            // 데이터베이스 오류 (SQLite)
  | 'WORKER'        // Worker Thread 오류
  | 'CONFIG'        // 설정/에이전트 JSON 오류
  | 'RUNTIME'       // 런타임 환경 오류
  | 'UI';           // UI 렌더링 오류

// 등록된 오류 레코드 구조
export interface ErrorRecord {
  // 고유 오류 코드 (예: IPC_HANDLER_NOT_FOUND)
  code: string;
  // 사용자 표시용 메시지 (번역 가능하게)
  message: string;
  // 심각도 티어
  severity: ErrorSeverity;
  // 카테고리
  category: ErrorCategory;
  // 사용자에게 표시할지 여부 (true면 UI 토스트/모달)
  visibleToUser: boolean;
  // 복구 불가능 여부 (true면 일반적으로 FATAL)
  unrecoverable: boolean;
}

/**
 * ErrorRegistry 클래스
 * 오류 코드 → ErrorRecord 매핑을 내부에 유지하고 쿼리 인터페이스 제공
 * Singleton 패턴으로 앱 전체에서 단일 인스턴스 사용
 */
export class ErrorRegistry {
  private static instance: ErrorRegistry;
  private registry: Map<string, ErrorRecord> = new Map();

  private constructor() {
    this.init();
  }

  /**
   * Singleton 접근자
   */
  static getInstance(): ErrorRegistry {
    if (!ErrorRegistry.instance) {
      ErrorRegistry.instance = new ErrorRegistry();
    }
    return ErrorRegistry.instance;
  }

  /**
   * 내부 레지스트리 초기화
   * 사전 정의된 오류 코드들을 등록한다
   */
  private init(): void {
    // === IPC 오류 ===
    this.register({
      code: 'IPC_HANDLER_NOT_FOUND',
      message: '요청한 IPC 핸들러를 찾을 수 없습니다',
      severity: 'ERROR',
      category: 'IPC',
      visibleToUser: true,
      unrecoverable: false,
    });

    this.register({
      code: 'IPC_VERSION_MISMATCH',
      message: 'IPC 프로토콜 버전이 일치하지 않습니다. 앱을 다시 시작해 주세요',
      severity: 'ERROR',
      category: 'IPC',
      visibleToUser: true,
      unrecoverable: false,
    });

    this.register({
      code: 'IPC_VALIDATION_FAILED',
      message: '입력 데이터 검증에 실패했습니다',
      severity: 'WARNING',
      category: 'IPC',
      visibleToUser: false,
      unrecoverable: false,
    });

    this.register({
      code: 'IPC_INVOKE_TIMEOUT',
      message: 'IPC 호출이 시간 초과되었습니다',
      severity: 'WARNING',
      category: 'IPC',
      visibleToUser: false,
      unrecoverable: false,
    });

    this.register({
      code: 'IPC_CHANNEL_NOT_REGISTERED',
      message: 'IPC 채널이 등록되지 않았습니다',
      severity: 'ERROR',
      category: 'IPC',
      visibleToUser: true,
      unrecoverable: false,
    });

    // === CLI 오류 ===
    this.register({
      code: 'CLI_NOT_FOUND',
      message: '지정된 CLI 경로에서 실행 파일을 찾을 수 없습니다',
      severity: 'FATAL',
      category: 'CLI',
      visibleToUser: true,
      unrecoverable: true,
    });

    this.register({
      code: 'CLI_PERMISSION_DENIED',
      message: 'CLI 실행 권한이 거부되었습니다',
      severity: 'FATAL',
      category: 'CLI',
      visibleToUser: true,
      unrecoverable: true,
    });

    this.register({
      code: 'CLI_SPAWN_FAILED',
      message: 'CLI 프로세스를 시작할 수 없습니다',
      severity: 'ERROR',
      category: 'CLI',
      visibleToUser: true,
      unrecoverable: false,
    });

    this.register({
      code: 'CLI_STDIN_WRITE_FAILED',
      message: 'CLI stdin 쓰기 실패',
      severity: 'WARNING',
      category: 'CLI',
      visibleToUser: false,
      unrecoverable: false,
    });

    this.register({
      code: 'CLI_PROCESS_EXIT_NON_ZERO',
      message: 'CLI 프로세스가 非제로 종료 코드로 종료되었습니다',
      severity: 'WARNING',
      category: 'CLI',
      visibleToUser: true,
      unrecoverable: false,
    });

    this.register({
      code: 'CLI_ENV_BLOCKLISTED',
      message: '보안 정책에 의해 CLI 실행이 거부되었습니다',
      severity: 'FATAL',
      category: 'CLI',
      visibleToUser: true,
      unrecoverable: true,
    });

    this.register({
      code: 'CLI_PATH_NOT_ABSOLUTE',
      message: 'CLI 경로는 절대 경로여야 합니다',
      severity: 'ERROR',
      category: 'CLI',
      visibleToUser: true,
      unrecoverable: false,
    });

    // === DB 오류 ===
    this.register({
      code: 'DB_INIT_FAILED',
      message: '데이터베이스 초기화에 실패했습니다',
      severity: 'FATAL',
      category: 'DB',
      visibleToUser: true,
      unrecoverable: true,
    });

    this.register({
      code: 'DB_QUERY_FAILED',
      message: '데이터베이스 쿼리 실행에 실패했습니다',
      severity: 'ERROR',
      category: 'DB',
      visibleToUser: false,
      unrecoverable: false,
    });

    this.register({
      code: 'DB_MIGRATION_FAILED',
      message: '데이터베이스 마이그레이션에 실패했습니다',
      severity: 'FATAL',
      category: 'DB',
      visibleToUser: true,
      unrecoverable: true,
    });

    this.register({
      code: 'DB_WAL_INIT_FAILED',
      message: 'SQLite WAL 모드 활성화에 실패했습니다',
      severity: 'ERROR',
      category: 'DB',
      visibleToUser: false,
      unrecoverable: false,
    });

    // === Worker Thread 오류 ===
    this.register({
      code: 'WORKER_CRASHED',
      message: 'Worker Thread가 충돌했습니다',
      severity: 'ERROR',
      category: 'WORKER',
      visibleToUser: true,
      unrecoverable: false,
    });

    this.register({
      code: 'WORKER_HEARTBEAT_TIMEOUT',
      message: 'Worker Thread 하트비트 응답 없음',
      severity: 'WARNING',
      category: 'WORKER',
      visibleToUser: false,
      unrecoverable: false,
    });

    this.register({
      code: 'WORKER_MESSAGE_DEMUX_FAILED',
      message: 'Worker 메시지 디멀렉싱 실패',
      severity: 'WARNING',
      category: 'WORKER',
      visibleToUser: false,
      unrecoverable: false,
    });

    this.register({
      code: 'WORKER_BACKPRESSURE',
      message: 'Worker 메시지 버퍼 용량 초과 (백프레셔)',
      severity: 'WARNING',
      category: 'WORKER',
      visibleToUser: false,
      unrecoverable: false,
    });

    // === 설정 오류 ===
    this.register({
      code: 'CONFIG_AGENT_NOT_FOUND',
      message: '에이전트 설정을 찾을 수 없습니다',
      severity: 'ERROR',
      category: 'CONFIG',
      visibleToUser: true,
      unrecoverable: false,
    });

    this.register({
      code: 'CONFIG_INVALID_JSON',
      message: '설정 파일 JSON 파싱 실패',
      severity: 'ERROR',
      category: 'CONFIG',
      visibleToUser: true,
      unrecoverable: false,
    });

    this.register({
      code: 'CONFIG_CLI_PATH_NOT_FOUND',
      message: '설정된 CLI 경로에서 실행 파일을 찾을 수 없습니다',
      severity: 'ERROR',
      category: 'CONFIG',
      visibleToUser: true,
      unrecoverable: false,
    });

    // === 런타임 오류 ===
    this.register({
      code: 'RUNTIME_UNHANDLED_REJECTION',
      message: '처리되지 않은 Promise 거절 발생',
      severity: 'ERROR',
      category: 'RUNTIME',
      visibleToUser: false,
      unrecoverable: false,
    });

    this.register({
      code: 'RUNTIME_UNCAUGHT_EXCEPTION',
      message: '포착되지 않은 예외 발생',
      severity: 'FATAL',
      category: 'RUNTIME',
      visibleToUser: true,
      unrecoverable: true,
    });

    // === UI 오류 ===
    this.register({
      code: 'UI_REACT_RENDER_ERROR',
      message: 'React 컴포넌트 렌더링 중 오류 발생',
      severity: 'ERROR',
      category: 'UI',
      visibleToUser: true,
      unrecoverable: false,
    });

    this.register({
      code: 'UI_STATE_SYNC_FAILED',
      message: 'UI 상태 동기화 실패',
      severity: 'WARNING',
      category: 'UI',
      visibleToUser: false,
      unrecoverable: false,
    });
  }

  /**
   * 오류 레코드 등록 (내부용, 초기화에서만 호출)
   */
  private register(record: ErrorRecord): void {
    this.registry.set(record.code, record);
  }

  /**
   * 오류 코드로 ErrorRecord 조회
   * @param code 오류 코드
   * @returns ErrorRecord 또는 undefined
   */
  getByCode(code: string): ErrorRecord | undefined {
    return this.registry.get(code);
  }

  /**
   * 카테고리로 오류 레코드 필터링
   * @param category 오류 카테고리
   * @returns 해당 카테고리의 모든 ErrorRecord
   */
  getByCategory(category: ErrorCategory): ErrorRecord[] {
    const results: ErrorRecord[] = [];
    for (const record of this.registry.values()) {
      if (record.category === category) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * 심각도로 오류 레코드 필터링
   * @param severity 오류 심각도
   * @returns 해당 심각도의 모든 ErrorRecord
   */
  getBySeverity(severity: ErrorSeverity): ErrorRecord[] {
    const results: ErrorRecord[] = [];
    for (const record of this.registry.values()) {
      if (record.severity === severity) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * 사용자에게 표시해야 하는 모든 오류 코드 조회
   * @returns visibleToUser === true인 ErrorRecord 배열
   */
  getUserVisibleErrors(): ErrorRecord[] {
    const results: ErrorRecord[] = [];
    for (const record of this.registry.values()) {
      if (record.visibleToUser) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * 모든 등록된 오류 코드 목록 반환
   * @returns 오류 코드 문자열 배열
   */
  getAllCodes(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * 등록된 오류 개수 반환 (디버깅/테스트용)
   */
  get size(): number {
    return this.registry.size;
  }

  /**
   * 동적으로 새 오류 코드 등록 (런타임에서 동적으로 추가할 경우)
   * @param record 등록할 ErrorRecord
   */
  registerDynamic(record: ErrorRecord): void {
    this.registry.set(record.code, record);
  }

  /**
   * 오류 코드가 등록되어 있는지 확인
   * @param code 오류 코드
   */
  has(code: string): boolean {
    return this.registry.has(code);
  }
}

export default ErrorRegistry;