/**
 * KiroCliEngine - kiro-cli CLI 어댑터
 *
 * Implements EngineAdapter interface
 * kiro-cli CLI의 spawn, terminate, validateConnection 메서드 구현
 *
 * 사용 방법:
 * - RunOrchestrator.createEngineAdapter('kiro-cli')로 인스턴스 생성
 * - CLI 스펙: `kiro-cli <prompt>` 또는 stdin 입력 지원
 *
 * 보안:
 * - ALLOWED_COMMANDS = ['kiro-cli'] (white-list)
 * - shell: false
 * - ENV_SANITIZE_BLOCKLIST 적용
 */

import { spawn } from 'child_process';
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
const ALLOWED_COMMANDS = ['kiro-cli'];

/**
 * KiroCliEngine 클래스
 * - EngineAdapter 인터페이스 구현
 * - child_process.spawn으로 kiro-cli CLI 실행
 */
export class KiroCliEngine implements EngineAdapter {
  /** 엔진 타입 */
  readonly engine: EngineType = 'kiro-cli';
  readonly binaryName = 'kiro-cli';

  /**
   * 환경 변수 살균 처리
   * - ENV_SANITIZE_BLOCKLIST의 모든 키 제거
   * - packaged 앱에서 node/cli를 찾을 수 있도록 PATH 보강
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
   * - shell: false (shell injection 방지)
   * - env: 살균된 환경 변수 + 사용자 지정 환경 변수
   *
   * @param args CLI 인자 배열
   * @param env 추가 환경 변수 (선택)
   * @returns ChildProcess 인스턴스
   */
  spawn(args: string[], env?: NodeJS.ProcessEnv): ReturnType<typeof spawn> {
    const sanitizedEnv = this.sanitizeEnv(env);

    // 절대 경로가 없으면 PATH에서 탐색
    let cliPath = 'kiro-cli';
    if (args[0] && args[0].startsWith('/')) {
      cliPath = args[0];
      args = args.slice(1);
    }

    return spawn(cliPath, args, {
      env: sanitizedEnv,
      shell: false,    // shell injection 방지
      stdio: ['pipe', 'pipe', 'pipe'],  // stdin/stdout/stderr 모두 pipe
    });
  }

  /**
   * CLI 프로세스 강제 종료
   * - process.kill(pid, 'SIGKILL') 사용
   * - zombie 프로세스 방지
   *
   * @param pid 종료할 프로세스 PID
   * @returns 성공 여부
   */
  terminate(pid: number): boolean {
    try {
      process.kill(pid, 'SIGKILL');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * CLI 연결 검증
   * - `kiro-cli --version` 또는 `kiro-cli version` 명령어 실행
   * - 5초 타임아웃
   *
   * @param cliPath CLI 실행 파일 경로 (선택, 기본값: 'kiro-cli')
   * @returns 유효성 검증 결과
   */
  async validateConnection(cliPath?: string): Promise<{ valid: boolean; version?: string; error?: string }> {
    const pathToCheck = cliPath ?? 'kiro-cli';

    return new Promise((resolve) => {
      try {
        // kiro-cli CLI는 --version 또는 version 서브커맨드 사용
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
          } else if (code !== 0) {
            // version 서브커맨드가 다른 형태일 수 있음
            resolve({
              valid: false,
              error: errorOutput || `Exit code: ${code}`,
            });
          } else {
            resolve({ valid: false, error: 'No version output' });
          }
        });

        proc.on('error', (err) => {
          resolve({ valid: false, error: err.message });
        });

        // 5초 타임아웃
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
   * kiro-cli는 `kiro-cli chat [OPTIONS] [INPUT]` 형식 사용
   * @param prompt 실행할 프롬프트
   * @param options 추가 옵션 (sandbox, approval, includeDirs)
   * @returns CLI 인자 배열
   */
  buildCliArgs(prompt: string, options?: import('./EngineAdapter').BuildCliArgsOptions): string[] {
    const args: string[] = ['chat', '--no-interactive'];
    const { sandboxMode, approvalPolicy } = options ?? {};
    if (sandboxMode === 'danger-full-access' || approvalPolicy === 'never') {
      args.push('--trust-all-tools');
    }
    if (prompt) args.push(prompt);
    return args;
  }
}
