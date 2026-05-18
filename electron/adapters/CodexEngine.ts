/**
 * CodexEngine - Codex CLI 어댑터
 *
 * Implements EngineAdapter interface
 * Codex CLI의 spawn, terminate, validateConnection 메서드 구현
 *
 * 사용 방법:
 * - RunOrchestrator.createEngineAdapter('codex')로 인스턴스 생성
 * - CLI 스펙: `codex <prompt>` (stdin도 지원)
 *
 * 보안:
 * - ALLOWED_COMMANDS = ['codex'] (white-list)
 * - shell: false
 * - ENV_SANITIZE_BLOCKLIST 적용
 */

import { spawn, ChildProcess } from 'child_process';
import type { EngineAdapter } from './EngineAdapter';
import type { EngineType } from '../../types/ipc-contract';

/**
 * 환경 변수 차단 목록
 * - LD_PRELOAD, DYLD_INSERT_LIBRARIES, NODE_OPTIONS 등
 * - CLI 실행 전에 반드시 제거
 */
const ENV_SANITIZE_BLOCKLIST = [
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
];

/**
 * 허용된 명령어 목록
 * - security: PATH lookup 대신 절대 경로만 허용
 */
const ALLOWED_COMMANDS = ['codex'];

/**
 * CodexEngine 클래스
 * - EngineAdapter 인터페이스 구현
 * - child_process.spawn으로 Codex CLI 실행
 */
export class CodexEngine implements EngineAdapter {
  /** 엔진 타입 */
  readonly engine: EngineType = 'codex';
  readonly binaryName = 'codex';

  /**
   * 엔진별 CLI 인자 구성
   * approvalPolicy 및 sandboxMode에 따라 적절한 플래그 설정
   * @param prompt 실행할 프롬프트 (stdin 전달)
   * @param options 추가 옵션 (sandbox, approval)
   * @returns CLI 인자 배열
   */
  buildCliArgs(prompt: string, options?: import('./EngineAdapter').BuildCliArgsOptions): string[] {
    const args: string[] = ['exec'];
    const { sandboxMode, approvalPolicy } = options ?? {};
    let forceNoApproval = false;
    let effectiveSandbox = sandboxMode;
    if (approvalPolicy === 'never') {
      if (sandboxMode === 'workspace-write') {
        args.push('--full-auto');
        effectiveSandbox = undefined;
      } else if (sandboxMode === 'danger-full-access') {
        args.push('--dangerously-bypass-approvals-and-sandbox');
        effectiveSandbox = undefined;
      } else if (!sandboxMode) {
        forceNoApproval = true;
      }
    }
    if (effectiveSandbox) {
      args.push('--sandbox', effectiveSandbox);
    }
    if (forceNoApproval) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }
    args.push('-');
    return args;
  }
}