/**
 * EngineAdapter - CLI 엔진 어댑터 인터페이스
 *
 * 설계 목표:
 * - CLI 엔진 (Codex, Gemini 등)의 공통 인터페이스 정의
 * - 각 엔진 어댑터는 이 인터페이스를 구현
 * - child_process.spawn은 Main Process에서만 수행 (Worker Thread 금지)
 *
 * 구현 요구사항:
 * - spawn(): CLI 프로세스 생성
 * - terminate(): CLI 프로세스 강제 종료
 * - validateConnection(): CLI 경로 및 버전 검증
 * - buildCliArgs(): 엔진별 CLI 인자 구성
 *
 * 보안 요구사항:
 * - ALLOWED_COMMANDS 목록 사용 (white-list)
 * - shell: false (shell injection 방지)
 * - ENV_SANITIZE_BLOCKLIST 적용
 */

import type { EngineType } from '../../types/ipc-contract';
import { CodexEngine } from './CodexEngine';
import { GeminiEngine } from './GeminiEngine';
import { OpenCodeEngine } from './OpenCodeEngine';
import { ClaudeCodeEngine } from './ClaudeCodeEngine';

export interface BuildCliArgsOptions {
  /** 샌드박스 모드 (read-only / workspace-write / danger-full-access) */
  sandboxMode?: string | null;
  /** 승인 정책 (never / on-request / always) */
  approvalPolicy?: string | null;
  /** CLI 실행 시 포함할 디렉토리 목록 */
  includeDirs?: string[];
}

/**
 * 엔진 어댑터 공통 인터페이스
 * 모든 엔진 어댑터가 구현해야 하는 메서드 정의
 */
export interface EngineAdapter {
  /** 엔진 타입 (codex/gemini/opencode/claudecode) */
  readonly engine: EngineType;

  /** CLI 바이너리 파일명 (codex/gemini/opencode/claude) */
  readonly binaryName: string;

  /**
   * CLI 프로세스 생성
   * @param args CLI 인자 (명령줄 인자)
   * @param env 환경 변수
   * @returns child_process.ChildProcessWithoutNullStreams
   */
  spawn(args: string[], env?: NodeJS.ProcessEnv): ReturnType<typeof import('child_process').spawn>;

  /**
   * CLI 프로세스 강제 종료
   * @param pid 종료할 프로세스 PID
   * @returns 성공 여부
   */
  terminate(pid: number): boolean;

  /**
   * CLI 연결 검증
   * @param cliPath CLI 실행 파일 경로
   * @returns 유효성 검증 결과
   */
  validateConnection(cliPath: string): Promise<{ valid: boolean; version?: string; error?: string }>;

  /**
   * 엔진별 CLI 인자 구성
   * @param prompt 실행할 프롬프트
   * @param options 추가 옵션 (sandbox, approval, includeDirs)
   * @returns CLI 인자 배열
   */
  buildCliArgs(prompt: string, options?: BuildCliArgsOptions): string[];
}

/**
 * 엔진 어댑터 팩토리 함수
 * 엔진 타입에 따라 적절한 어댑터 인스턴스 생성
 *
 * @param engine 엔진 타입
 * @returns EngineAdapter 인스턴스
 */
/**
 * 엔진 타입별 어댑터 클래스 매핑
 * - key: EngineType
 * - value: 해당 엔진의 EngineAdapter 생성자
 */
const ENGINE_ADAPTERS: Record<EngineType, new () => EngineAdapter> = {
  codex: CodexEngine,
  gemini: GeminiEngine,
  opencode: OpenCodeEngine,
  claudecode: ClaudeCodeEngine,
};

export function createEngineAdapter(engine: EngineType): EngineAdapter {
  const Adapter = ENGINE_ADAPTERS[engine];
  if (!Adapter) throw new Error(`Unsupported engine type: ${engine}`);
  return new Adapter();
}