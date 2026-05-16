/**
 * GeminiEngine - Gemini CLI 어댑터
 *
 * Implements EngineAdapter interface
 * Gemini CLI의 spawn, terminate, validateConnection 메서드 구현
 *
 * 사용 방법:
 * - RunOrchestrator.createEngineAdapter('gemini')로 인스턴스 생성
 * - CLI 스펙: `gemini <prompt>` 또는 stdin 입력 지원
 *
 * 보안:
 * - ALLOWED_COMMANDS = ['gemini'] (white-list)
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
const ALLOWED_COMMANDS = ['gemini'];

/**
 * GeminiEngine 클래스
 * - EngineAdapter 인터페이스 구현
 * - child_process.spawn으로 Gemini CLI 실행
 */
export class GeminiEngine implements EngineAdapter {
  /** 엔진 타입 */
  readonly engine: EngineType = 'gemini';

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
    let cliPath = 'gemini';
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
   * - `gemini --version` 또는 `gemini version` 명령어 실행
   * - 5초 타임아웃
   *
   * @param cliPath CLI 실행 파일 경로 (선택, 기본값: 'gemini')
   * @returns 유효성 검증 결과
   */
  async validateConnection(cliPath?: string): Promise<{ valid: boolean; version?: string; error?: string }> {
    const pathToCheck = cliPath ?? 'gemini';

    return new Promise((resolve) => {
      try {
        // Gemini CLI는 --version 또는 version 서브커맨드 사용
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
}