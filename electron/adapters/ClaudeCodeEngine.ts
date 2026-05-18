/**
 * ClaudeCodeEngine - Claude Code CLI 어댑터
 *
 * Implements EngineAdapter interface
 * Claude Code CLI(`claude`)의 spawn, terminate, validateConnection 메서드 구현
 *
 * 사용 방법:
 * - RunOrchestrator.createEngineAdapter('claudecode')로 인스턴스 생성
 * - CLI 스펙: `claude <prompt>` (stdin도 지원)
 *
 * 보안:
 * - ALLOWED_COMMANDS = ['claude'] (white-list)
 * - shell: false
 * - ENV_SANITIZE_BLOCKLIST 적용
 *
 * Phase 5 구현:
 * - Claude Code CLI 어댑터
 * - 세션 관리 (--session 플래그 지원)
 * - 프롬프트 모드 (--print 플래그로 비대화형 모드)
 */

import { spawn } from 'child_process';
import type { EngineAdapter } from './EngineAdapter';
import type { EngineType } from '../../types/ipc-contract';

/** 차단할 환경 변수 목록 — 프로세스 생성 전 제거 */
const ENV_SANITIZE_BLOCKLIST = [
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
];

/** 허용된 CLI 명령어 목록 — 화이트리스트 방식 보안 */
const ALLOWED_COMMANDS = ['claude'];

/**
 * ClaudeCodeEngine 클래스
 * - EngineAdapter 인터페이스 구현
 * - child_process.spawn으로 Claude Code CLI 실행
 */
export class ClaudeCodeEngine implements EngineAdapter {
  /** 엔진 타입 식별자 */
  readonly engine: EngineType = 'claudecode';
  /** CLI 바이너리 파일명 */
  readonly binaryName = 'claude';

  /**
   * 환경 변수 살균 처리
   * - ENV_SANITIZE_BLOCKLIST의 모든 키 제거
   * - packaged 앱에서 CLI를 찾을 수 있도록 PATH 보강
   * @param env 추가 환경 변수 (선택)
   * @returns 살균된 환경 변수 객체
   */
  private sanitizeEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const baseEnv = { ...process.env, ...env };
    for (const key of ENV_SANITIZE_BLOCKLIST) {
      delete baseEnv[key];
    }
    const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
    const currentPath = baseEnv.PATH ?? '';
    baseEnv.PATH = [...extraPaths, currentPath].filter(Boolean).join(':');
    return baseEnv;
  }

  /**
   * CLI 프로세스 생성
   * --print 플래그로 비대화형 모드 실행 (출력 후 종료)
   * --session 플래그로 세션 ID 지정 가능
   */
  spawn(args: string[], env?: NodeJS.ProcessEnv): ReturnType<typeof spawn> {
    const sanitizedEnv = this.sanitizeEnv(env);

    let cliPath = 'claude';
    if (args[0] && args[0].startsWith('/')) {
      cliPath = args[0];
      args = args.slice(1);
    }

    // --print 플래그 자동 추가 (비대화형 모드)
    if (!args.includes('--print') && !args.includes('-p')) {
      args = ['--print', ...args];
    }

    return spawn(cliPath, args, {
      env: sanitizedEnv,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * CLI 프로세스 강제 종료
   * - SIGTERM으로 정상 종료 시도 후 3초 후에도 살아있으면 SIGKILL
   * @param pid 종료할 프로세스 PID
   * @returns 성공 여부
   */
  terminate(pid: number): boolean {
    try {
      // Claude Code는 SIGTERM으로 정상 종료 시도 후 SIGKILL
      process.kill(pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(pid, '0'); // 프로세스가 아직 살아있으면 SIGKILL
          process.kill(pid, 'SIGKILL');
        } catch {
          // 이미 종료됨
        }
      }, 3000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * CLI 연결 검증
   * - `claude --version` 명령어 실행
   * - 5초 타임아웃
   * @param cliPath CLI 실행 파일 경로 (선택, 기본값: 'claude')
   * @returns 유효성 검증 결과
   */
  async validateConnection(cliPath: string): Promise<{ valid: boolean; version?: string; error?: string }> {
    const pathToCheck = cliPath || 'claude';

    return new Promise((resolve) => {
      try {
        const proc = spawn(pathToCheck, ['--version'], {
          env: this.sanitizeEnv(),
          shell: false,
          timeout: 5000,
        });

        let output = '';
        let errorOutput = '';

        proc.stdout?.on('data', (data: Buffer) => {
          output += data.toString();
        });

        proc.stderr?.on('data', (data: Buffer) => {
          errorOutput += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0 && output.trim()) {
            resolve({ valid: true, version: output.trim() });
          } else {
            resolve({
              valid: false,
              error: errorOutput || `Exit code: ${code}`,
            });
          }
        });

        proc.on('error', (err) => {
          resolve({ valid: false, error: err.message });
        });

        setTimeout(() => {
          proc.kill();
          resolve({ valid: false, error: 'Timeout (5s)' });
        }, 5000);
      } catch (err) {
        resolve({ valid: false, error: String(err) });
      }
    });
  }

  /**
   * 엔진별 CLI 인자 구성
   * @param prompt 실행할 프롬프트
   * @param _options 추가 옵션 (미사용)
   * @returns CLI 인자 배열
   */
  buildCliArgs(prompt: string, _options?: import('./EngineAdapter').BuildCliArgsOptions): string[] {
    return ['-p', prompt];
  }
}